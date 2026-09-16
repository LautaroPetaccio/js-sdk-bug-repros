import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import { Transform as TransformComponent, NetworkEntity, NetworkParent, CreatedBy } from '@dcl/ecs/dist/components'
import { Color4, Vector3 } from '@dcl/sdk/math'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { PutNetworkComponentOperation } from '@dcl/ecs/dist/serialization/crdt/network/putComponentNetwork'
import { createServerValidator } from '@dcl/sdk/network/server'
import { CommsMessage } from '@dcl/sdk/network/binary-message-bus'

// LWW resolves by comparing a timestamp the *sender* chooses. Honest clients increment
// it by one from zero and the field is a uint32, so a peer that names the maximum wins
// every later comparison. On this branch that lands in the authoritative state, which is
// what every client is then served and corrected against.
const MAX_U32 = 4294967295
const NETWORK_ID = 7
const OWNER = '0xOWNER'
const ATTACKER = '0xATTACKER'
const REMOTE_ENTITY = 900 as Entity

const FRAMES_PER_STEP = 45

type Phase = 'idle' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''
let valueAfterAttack = NaN
let valueAfterOwnerRetries = NaN
let relayedAttack = 0
let ownerUpdatesRelayed = 0
let correctionsToOwner = 0

const server = Engine()
const ServerTransform = TransformComponent(server)
const ServerNetworkEntity = NetworkEntity(server)
NetworkParent(server)
CreatedBy(server)

const transport: Transport = { type: 'network', filter: () => false, send: async () => {} }
server.addTransport(transport)

let relayed = 0
let corrections = 0
const validator = createServerValidator({
  engine: server as any,
  binaryMessageBus: {
    emit: (type: number) => {
      if (type === CommsMessage.CRDT) relayed++
      if (type === CommsMessage.CRDT_AUTHORITATIVE) corrections++
    },
    on: () => {}
  } as any
})

function update(timestamp: number, x: number): Uint8Array {
  const data = new ReadWriteByteBuffer()
  ServerTransform.schema.serialize(
    {
      position: Vector3.create(x, 1, 1),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: Vector3.One(),
      parent: 0 as Entity
    },
    data
  )
  const buf = new ReadWriteByteBuffer()
  PutNetworkComponentOperation.write(
    REMOTE_ENTITY,
    timestamp,
    ServerTransform.componentId,
    NETWORK_ID,
    data.toBinary(),
    buf
  )
  return buf.toBinary()
}

async function feed(bytes: Uint8Array, sender: string) {
  const applied = validator.processServerMessages(bytes, sender)
  if (applied.byteLength) transport.onmessage!(applied)
  await server.update(1 / 30)
}

function serverValue(): number {
  const mapped = Array.from(server.getEntitiesWith(ServerNetworkEntity))[0]
  return mapped ? (ServerTransform.getOrNull(mapped[0])?.position.x ?? NaN) : NaN
}

function render() {
  const lines = ['a peer pinning a component with the maximum timestamp', '']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`${OWNER} created the entity at x=1`)
    lines.push(`${ATTACKER} wrote x=999 with timestamp ${MAX_U32}`)
    lines.push('')
    lines.push(`server value after the attack:   ${valueAfterAttack}`)
    lines.push(`attack relayed to the room:      ${relayedAttack > 0 ? 'yes' : 'no'}`)
    lines.push('')
    lines.push(`${OWNER} then sent 4 genuine updates`)
    lines.push(`server value now:                ${valueAfterOwnerRetries}`)
    lines.push(`owner updates relayed:           ${ownerUpdatesRelayed}`)
    lines.push(`corrections sent back to owner:  ${correctionsToOwner}`)
    lines.push('')

    if (valueAfterOwnerRetries === 999) {
      verdict =
        'BUG REPRODUCED: the authoritative state is pinned at the attacker value. The ' +
        'owner cannot move its own entity, and the server corrects it back on every try.'
    } else {
      verdict = `FIXED: the owner's updates were accepted (x=${valueAfterOwnerRetries}).`
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
    width: 22,
    height: 12
  })
  console.log(text)
}

function driver() {
  frames++
  if (phase === 'idle' && frames >= FRAMES_PER_STEP) {
    phase = 'done'
    void (async () => {
      await feed(update(1, 1), OWNER)

      relayed = 0
      await feed(update(MAX_U32, 999), ATTACKER)
      valueAfterAttack = serverValue()
      relayedAttack = relayed

      relayed = 0
      corrections = 0
      for (const timestamp of [2, 3, 4, 50]) {
        await feed(update(timestamp, timestamp), OWNER)
      }
      valueAfterOwnerRetries = serverValue()
      ownerUpdatesRelayed = relayed
      correctionsToOwner = corrections
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
