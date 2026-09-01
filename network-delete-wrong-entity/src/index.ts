import { Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
// The per-engine component factories are not re-exported from the package root.
import { Transform as TransformComponent, NetworkEntity } from '@dcl/ecs/dist/components'
import { Color4, Vector3 } from '@dcl/sdk/math'
import type { Transport } from '@dcl/ecs/dist/systems/crdt/types'
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { readMessage } from '@dcl/ecs/dist/serialization/crdt/message'
import { PutNetworkComponentOperation } from '@dcl/ecs/dist/serialization/crdt/network/putComponentNetwork'
import { DeleteEntityNetwork } from '@dcl/ecs/dist/serialization/crdt/network/deleteEntityNetwork'
import { CrdtMessageType } from '@dcl/ecs/dist/serialization/crdt/types'

const PEER_NETWORK_ID = 7
// Every engine allocates from the same reserved offset, so the peer's first
// entity carries the same number as this scene's first entity. That collision
// is the normal case, not a contrived one.
const PEER_ENTITY = 512 as Entity

const FRAMES_PER_STEP = 45

type Phase = 'idle' | 'peer-announced' | 'peer-deleted'

let sign: Entity
let frames = 0
let phase: Phase = 'idle'
let localEntity: Entity
let mappedEntity: Entity | undefined
let deletedByRenderer: number[] = []
let rendered = ''

// A private engine stands in for the scene's own one so the messages the
// renderer would receive can be read back instead of vanishing into the host.
const probe = Engine()
const ProbeTransform = TransformComponent(probe)
const ProbeNetworkEntity = NetworkEntity(probe)

const rendererMessages: { type: number; entityId: number }[] = []
const renderer: Transport = {
  type: 'renderer',
  filter: () => true,
  send: async (message) => {
    for (const chunk of Array.isArray(message) ? message : [message]) {
      const buffer = new ReadWriteByteBuffer(chunk)
      let parsed
      while ((parsed = readMessage(buffer))) {
        rendererMessages.push({ type: parsed.type, entityId: parsed.entityId as number })
      }
    }
  }
}
const network: Transport = { type: 'network', filter: () => true, send: async () => {} }
probe.addTransport(renderer)
probe.addTransport(network)

/** The peer announcing one of its entities, which this engine maps to its own. */
function announcePeerEntity() {
  const componentData = new ReadWriteByteBuffer()
  ProbeTransform.schema.serialize(ProbeTransform.get(localEntity), componentData)

  const message = new ReadWriteByteBuffer()
  PutNetworkComponentOperation.write(
    PEER_ENTITY,
    1,
    ProbeTransform.componentId,
    PEER_NETWORK_ID,
    componentData.toBinary(),
    message
  )
  network.onmessage!(message.toBinary())
}

/** The peer deleting that same entity. */
function deletePeerEntity() {
  const message = new ReadWriteByteBuffer()
  DeleteEntityNetwork.write(PEER_ENTITY, PEER_NETWORK_ID, message)
  network.onmessage!(message.toBinary())
}

function render() {
  const lines = ['a peer deleting one of its synced entities']

  lines.push(`this scene's own live entity: ${localEntity}`)
  lines.push(`the peer's entity ${PEER_ENTITY} is mapped locally to: ${mappedEntity ?? 'not yet'}`)

  let verdict = ''
  if (phase === 'peer-deleted') {
    lines.push(`renderer was told to delete: ${deletedByRenderer.join(', ') || 'nothing'}`)

    if (deletedByRenderer.includes(localEntity as number)) {
      verdict = `BUG REPRODUCED: the renderer deleted ${localEntity}, this scene's own live entity, and the peer's entity is still there.`
    } else if (mappedEntity !== undefined && deletedByRenderer.includes(mappedEntity as number)) {
      verdict = `FIXED: the renderer deleted ${mappedEntity}, the entity the peer's one was mapped to.`
    } else {
      verdict = `UNEXPECTED: renderer deleted ${JSON.stringify(deletedByRenderer)}`
    }
    lines.push(verdict)
    lines.push(`this scene's entity still has a Transform: ${ProbeTransform.has(localEntity) ? 'yes' : 'no'}`)
  } else {
    lines.push(`deleting it in ${FRAMES_PER_STEP * 2 - frames} frames`)
  }

  const text = lines.join('\n')
  if (text === rendered) return
  rendered = text

  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.2,
    textColor: verdict === '' ? Color4.White() : verdict.startsWith('BUG') ? Color4.Red() : Color4.Green(),
    width: 16,
    height: 8
  })
  console.log(text)
}

function driver() {
  frames++

  switch (phase) {
    case 'idle':
      if (frames >= FRAMES_PER_STEP) {
        announcePeerEntity()
        void probe.update(1 / 30).then(() => {
          for (const [entity] of probe.getEntitiesWith(ProbeNetworkEntity)) {
            mappedEntity = entity
          }
          rendererMessages.length = 0
          phase = 'peer-announced'
        })
      }
      break

    case 'peer-announced':
      if (frames >= FRAMES_PER_STEP * 2) {
        deletePeerEntity()
        void probe.update(1 / 30).then(() => {
          deletedByRenderer = rendererMessages
            .filter((message) => message.type === CrdtMessageType.DELETE_ENTITY)
            .map((message) => message.entityId)
          phase = 'peer-deleted'
        })
      }
      break
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })

  // A live local entity that happens to carry the same number as the peer's.
  localEntity = probe.addEntity()
  ProbeTransform.create(localEntity)
  void probe.update(1 / 30)

  engine.addSystem(driver, 0, 'repro/driver')
}
