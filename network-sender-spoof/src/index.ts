import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import { Transform as TransformComponent, NetworkEntity } from '@dcl/ecs/dist/components'
import { componentNumberFromName } from '@dcl/ecs/dist/components/component-number'
import { Color4, Vector3 } from '@dcl/sdk/math'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { PutNetworkComponentOperation } from '@dcl/ecs/dist/serialization/crdt/network/putComponentNetwork'

// Two players, identified by wallet address. Their networkId is a public,
// deterministic hash of that address, so either can compute the other's.
const VICTIM = '0xVICTIM'
const ATTACKER = '0xATTACKER'
const victimNetworkId = componentNumberFromName(VICTIM)
const attackerNetworkId = componentNumberFromName(ATTACKER)

// Every engine allocates from the same reserved offset, so the id a victim will
// hand out is knowable before they use it. 512 is simply their first entity.
const VICTIM_ENTITY = 512 as Entity
const ATTACKER_ENTITY = 777 as Entity

const FRAMES_PER_STEP = 45

// The one field a real client cannot forge: the runtime stamps the address a
// comms message arrived from before the scene sees it. `onmessage` gains this
// argument with the fix; the published SDK ignores it.
type Sender = { address: string; networkId: number }

type Phase = 'idle' | 'attacked'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let rendered = ''

// A private engine stands in for this client's own one, so what the engine does
// with an inbound message can be read back instead of vanishing into the host.
const probe = Engine()
const ProbeTransform = TransformComponent(probe)
const ProbeNetworkEntity = NetworkEntity(probe)

const network: Transport = { type: 'network', filter: () => true, send: async () => {} }
probe.addTransport(network)

function transform(x: number): Uint8Array {
  const data = new ReadWriteByteBuffer()
  ProbeTransform.schema.serialize(
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

/** Deliver a PUT_COMPONENT_NETWORK as if it came from `sender` over comms. */
function announce(entityId: Entity, networkId: number, x: number, sender: Sender) {
  const message = new ReadWriteByteBuffer()
  PutNetworkComponentOperation.write(entityId, 1, ProbeTransform.componentId, networkId, transform(x), message)
  // The published SDK's onmessage takes only the bytes; the fix adds the sender.
  ;(network.onmessage as (m: Uint8Array, s?: Sender) => void)(message.toBinary(), sender)
}

function mappings() {
  return Array.from(probe.getEntitiesWith(ProbeNetworkEntity)).map(([entity, net]) => ({
    entity,
    networkId: net.networkId,
    entityId: net.entityId
  }))
}

function render() {
  const lines = ['a peer announcing an entity under another player’s networkId', '']
  lines.push(`this client is honestly relaying comms from two peers:`)
  lines.push(`  ${ATTACKER}  networkId ${attackerNetworkId}`)
  lines.push(`  ${VICTIM}  networkId ${victimNetworkId}`)
  lines.push('')

  let verdict = ''
  if (phase === 'attacked') {
    const all = mappings()
    const legit = all.find((m) => m.networkId === attackerNetworkId && m.entityId === (ATTACKER_ENTITY as number))
    const spoof = all.find((m) => m.networkId === victimNetworkId && m.entityId === (VICTIM_ENTITY as number))

    lines.push(`the attacker sent two announcements, both stamped from ${ATTACKER}:`)
    lines.push(`  1. entity ${ATTACKER_ENTITY} under its OWN networkId  -> mapped: ${legit ? 'yes' : 'no'}`)
    lines.push(`  2. entity ${VICTIM_ENTITY} under the VICTIM's networkId -> mapped: ${spoof ? 'yes' : 'no'}`)
    lines.push('')

    if (spoof) {
      verdict =
        `BUG REPRODUCED: this client created an entity owned by ${victimNetworkId} ` +
        `from a message the attacker sent. It now carries the victim’s identity.`
    } else if (legit) {
      verdict =
        `FIXED: the attacker’s own entity was created, but the one it tried to ` +
        `mint under the victim’s networkId was refused.`
    } else {
      verdict = `UNEXPECTED: neither announcement was mapped (${JSON.stringify(all)})`
    }
    lines.push(verdict)
  } else {
    lines.push(`attacking in ${FRAMES_PER_STEP - frames} frames`)
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
    // (1) legitimate: the attacker announces its own entity. Always allowed.
    announce(ATTACKER_ENTITY, attackerNetworkId, 3, { address: ATTACKER, networkId: attackerNetworkId })
    // (2) spoof: the same attacker announces an entity owned by the victim.
    announce(VICTIM_ENTITY, victimNetworkId, 3, { address: ATTACKER, networkId: attackerNetworkId })
    void probe.update(1 / 30).then(() => {
      phase = 'attacked'
    })
  }
  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  void probe.update(1 / 30)
  engine.addSystem(driver, 0, 'repro/driver')
}
