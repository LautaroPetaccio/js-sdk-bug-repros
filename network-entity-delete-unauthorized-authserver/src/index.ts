import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import { Transform as TransformComponent, NetworkEntity, NetworkParent, CreatedBy } from '@dcl/ecs/dist/components'
import { Color4, Vector3 } from '@dcl/sdk/math'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { PutNetworkComponentOperation } from '@dcl/ecs/dist/serialization/crdt/network/putComponentNetwork'
import { DeleteEntityNetwork } from '@dcl/ecs/dist/serialization/crdt/network/deleteEntityNetwork'
import { createServerValidator } from '@dcl/sdk/network/server'
import { CommsMessage } from '@dcl/sdk/network/binary-message-bus'

// Clients here only accept CRDT from the authoritative server, so a peer cannot delete
// another client's entity directly. It asks the server to, and the server decides — which
// is the seam this scene drives. The non-auth-server variant injects into an engine that
// skips network messages entirely, so it reports a clean run while the defect is live.
const NETWORK_ID = 7
const OWNER = '0xOWNER'
const OTHER = '0xSOMEONE-ELSE'
const REMOTE_ENTITY = 900 as Entity

const FRAMES_PER_STEP = 45

type Phase = 'idle' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''
let relayedDelete = false
let survivedOnServer = false

const server = Engine()
const ServerTransform = TransformComponent(server)
const ServerNetworkEntity = NetworkEntity(server)
NetworkParent(server)
CreatedBy(server)

const transport: Transport = { type: 'network', filter: () => false, send: async () => {} }
server.addTransport(transport)

const validator = createServerValidator({
  engine: server as any,
  binaryMessageBus: {
    emit: (type: number) => {
      if (type === CommsMessage.CRDT) relayedDelete = true
    },
    on: () => {}
  } as any
})

function announce(): Uint8Array {
  const data = new ReadWriteByteBuffer()
  ServerTransform.schema.serialize(
    {
      position: Vector3.create(8, 1, 8),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: Vector3.One(),
      parent: 0 as Entity
    },
    data
  )
  const buf = new ReadWriteByteBuffer()
  PutNetworkComponentOperation.write(REMOTE_ENTITY, 1, ServerTransform.componentId, NETWORK_ID, data.toBinary(), buf)
  return buf.toBinary()
}

function deletion(): Uint8Array {
  const buf = new ReadWriteByteBuffer()
  DeleteEntityNetwork.write(REMOTE_ENTITY, NETWORK_ID, buf)
  return buf.toBinary()
}

async function feed(bytes: Uint8Array, sender: string) {
  const applied = validator.processServerMessages(bytes, sender)
  if (applied.byteLength) transport.onmessage!(applied)
  await server.update(1 / 30)
}

function render() {
  const lines = ['a peer deleting an entity it did not create', '']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`${OWNER} created the entity, so the server recorded it as the creator`)
    lines.push(`${OTHER} then asked the server to delete it`)
    lines.push('')
    lines.push(`entity still on the server: ${survivedOnServer ? 'yes' : 'no'}`)
    lines.push(`delete relayed to the room:  ${relayedDelete ? 'yes' : 'no'}`)
    lines.push('')

    if (!survivedOnServer || relayedDelete) {
      verdict =
        'BUG REPRODUCED: the server took a delete from a peer that did not create the ' +
        'entity, and nothing asked the scene whether that was allowed.'
    } else {
      verdict = 'FIXED: the scene was asked, and refused the delete.'
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
      await feed(announce(), OWNER)

      // What a scene would say if it were asked. On a build that never asks, this is
      // registered and simply never runs.
      ServerTransform.validateBeforeChange(
        ({ newValue, senderAddress, createdBy }: any) => newValue !== undefined || senderAddress === createdBy
      )

      relayedDelete = false
      await feed(deletion(), OTHER)

      const mapped = Array.from(server.getEntitiesWith(ServerNetworkEntity))[0]
      survivedOnServer = mapped !== undefined && ServerTransform.getOrNull(mapped[0]) !== null
      render()
    })()
  }
  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
