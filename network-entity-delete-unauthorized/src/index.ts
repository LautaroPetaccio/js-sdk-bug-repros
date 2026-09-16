import { Engine, Entity, EntityState, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import { Transform as TransformComponent, NetworkEntity, SyncComponents } from '@dcl/ecs/dist/components'
import { componentNumberFromName } from '@dcl/ecs/dist/components/component-number'
import { Color4, Vector3 } from '@dcl/sdk/math'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { DeleteEntityNetwork } from '@dcl/ecs/dist/serialization/crdt/network/deleteEntityNetwork'

// This client owns a synced entity. A different player — not the owner — deletes it.
// Distinct from `network-delete-wrong-entity` (#1571): there the OWNER deletes its
// own entity and the renderer aliases the wrong one; here a NON-OWNER deletes an
// entity that is not theirs, and the engine accepts it at all.
const ATTACKER = '0xATTACKER'
const attackerNetworkId = componentNumberFromName(ATTACKER)

const FRAMES_PER_STEP = 45

type Sender = { address: string; networkId: number }
type Phase = 'idle' | 'deleted'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''

let myEntity: Entity
let myNetworkId: number
let stateAfter: EntityState = EntityState.UsedEntity
let hadTransformAfter = false
let localValueAfter = NaN

// A private engine standing in for this client's own one.
const probe = Engine()
const ProbeTransform = TransformComponent(probe)
const ProbeNetworkEntity = NetworkEntity(probe)
const ProbeSyncComponents = SyncComponents(probe)

const network: Transport = { type: 'network', filter: () => true, send: async () => {} }
probe.addTransport(network)

/** A non-owner deleting this client's entity, addressed by its (networkId, entityId). */
function attackerDeletes() {
  const message = new ReadWriteByteBuffer()
  DeleteEntityNetwork.write(myEntity, myNetworkId, message)
  const sender: Sender = { address: ATTACKER, networkId: attackerNetworkId }
  ;(network.onmessage as (m: Uint8Array, s?: Sender) => void)(message.toBinary(), sender)
}

function render() {
  const lines = ['a player deleting a synced entity it does not own', '']

  let verdict = ''
  if (phase === 'deleted') {
    lines.push(`this client owns entity ${myEntity} (networkId ${myNetworkId})`)
    lines.push(`${ATTACKER} (networkId ${attackerNetworkId}) sent a delete for it`)
    lines.push('')
    lines.push(`entity state on this client now: ${EntityState[stateAfter]}`)
    lines.push(`it still has its Transform:       ${hadTransformAfter ? 'yes' : 'no'}`)
    lines.push('')

    if (stateAfter === EntityState.Removed || !hadTransformAfter) {
      verdict =
        `ISSUE PRESENT: a player who does not own the entity destroyed it on the ` +
        `owner’s own client. #1608 permits this: the entity already existed, so its ` +
        `networkId was never checked against the sender.`
    } else {
      verdict = `FIXED: the delete from a non-owner was refused; the entity survives.`
    }
    lines.push(verdict)
  } else {
    lines.push(`deleting in ${FRAMES_PER_STEP - frames} frames`)
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
  if (phase === 'idle' && frames >= FRAMES_PER_STEP) {
    attackerDeletes()
    void probe.update(1 / 30).then(() => {
      stateAfter = probe.getEntityState(myEntity)
      hadTransformAfter = ProbeTransform.getOrNull(myEntity) !== null
      localValueAfter = ProbeTransform.getOrNull(myEntity)?.position.x ?? NaN
      phase = 'deleted'
    })
  }
  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  // This client creates and syncs its own entity.
  myEntity = probe.addEntity()
  ProbeTransform.create(myEntity, {
    position: Vector3.create(8, 1, 8),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: Vector3.One(),
    parent: 0 as Entity
  })
  myNetworkId = componentNumberFromName('0xME')
  ProbeNetworkEntity.create(myEntity, { networkId: myNetworkId, entityId: myEntity })
  ProbeSyncComponents.create(myEntity, { componentIds: [ProbeTransform.componentId] })
  void probe.update(1 / 30)

  engine.addSystem(driver, 0, 'repro/driver')
}
