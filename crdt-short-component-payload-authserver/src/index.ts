import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import {
  Transform as TransformComponent,
  NetworkEntity,
  NetworkParent,
  CreatedBy,
  GltfContainer
} from '@dcl/ecs/dist/components'
import { Color4, Vector3 } from '@dcl/sdk/math'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { PutNetworkComponentOperation } from '@dcl/ecs/dist/serialization/crdt/network/putComponentNetwork'
import { createServerValidator } from '@dcl/sdk/network/server'
import { CommsMessage } from '@dcl/sdk/network/binary-message-bus'

// On this branch a peer never reaches another client's engine directly: clients only
// accept CRDT from the authoritative server. So the seam that matters is the server's
// own validation, not the engine — which is why the non-auth-server scene reports a
// clean run here even though the defect is live.
const NETWORK_ID = 7
const PEER = '0xPEER'
const REMOTE_ENTITY = 900 as Entity

const FRAMES_PER_STEP = 45

type Phase = 'idle' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''
let corrections = 0
let relayed = 0
let survivedThrow = false

// A private engine standing in for the authoritative server's own one.
const server = Engine()
const ServerTransform = TransformComponent(server)
const ServerGltf = GltfContainer(server)
NetworkEntity(server)
NetworkParent(server)
CreatedBy(server)

const transport: Transport = { type: 'network', filter: () => false, send: async () => {} }
server.addTransport(transport)

const validator = createServerValidator({
  engine: server as any,
  binaryMessageBus: {
    emit: (type: number) => {
      if (type === CommsMessage.CRDT_AUTHORITATIVE) corrections++
      if (type === CommsMessage.CRDT) relayed++
    },
    on: () => {}
  } as any
})

function gltfBytes(src: string): Uint8Array {
  const data = new ReadWriteByteBuffer()
  ServerGltf.schema.serialize({ src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 }, data)
  return data.toBinary()
}

/** One peer message, framed exactly as it arrives over comms. */
function peerMessage(componentId: number, data: Uint8Array): Uint8Array {
  const buf = new ReadWriteByteBuffer()
  PutNetworkComponentOperation.write(REMOTE_ENTITY, 1, componentId, NETWORK_ID, data, buf)
  return buf.toBinary()
}

/** What the sync transport does with the validator's output. */
async function feed(bytes: Uint8Array) {
  const applied = validator.processServerMessages(bytes, PEER)
  if (applied.byteLength) transport.onmessage!(applied)
  await server.update(1 / 30)
}

function render() {
  const lines = ['a peer payload the server cannot read', '']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`the peer sent a good GltfContainer, then a truncated one for the same entity`)
    lines.push('')
    lines.push(`server survived the malformed message: ${survivedThrow ? 'yes' : 'no'}`)
    lines.push(`relayed the bad update to other peers: ${relayed > 0 ? 'yes' : 'no'}`)
    lines.push(`answered the sender with its own state: ${corrections > 0 ? 'yes' : 'no'}`)
    lines.push('')

    if (corrections === 0) {
      verdict =
        'BUG REPRODUCED: the update was dropped in silence. The sender is never told, ' +
        'so it keeps applying state the server rejected.'
    } else if (relayed > 0) {
      verdict = 'UNEXPECTED: an unreadable payload was relayed to the room.'
    } else {
      verdict = 'FIXED: the update was refused and the sender was sent the authoritative state.'
    }
    lines.push(verdict)
  } else {
    lines.push(`running in ${FRAMES_PER_STEP - frames} frames`)
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1,
    textColor: verdict === '' ? Color4.White() : verdict.startsWith('BUG') ? Color4.Red() : Color4.Green(),
    width: 20,
    height: 10
  })
  console.log(text)
}

function driver() {
  frames++
  if (phase === 'idle' && frames >= FRAMES_PER_STEP) {
    phase = 'done'
    void (async () => {
      // The server takes a good update first, so it holds state it could answer with.
      await feed(peerMessage(ServerGltf.componentId, gltfBytes('models/thing.glb')))
      relayed = 0
      corrections = 0

      // Not Transform: converting one deserializes for parent fixing and throws earlier,
      // which exercises a different guard than the payload one.
      try {
        await feed(peerMessage(ServerGltf.componentId, gltfBytes('models/thing.glb').subarray(0, 4)))
        survivedThrow = true
      } catch {
        survivedThrow = false
      }
      render()
    })()
  }
  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  void ServerTransform // keep the component registered on the server engine
  engine.addSystem(driver, 0, 'repro/driver')
}
