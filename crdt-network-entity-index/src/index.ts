import { Entity, Material, MeshRenderer, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { NetworkEntity } from '@dcl/sdk/ecs'
import { syncEntity } from '@dcl/sdk/network'
import { Color4, Vector3 } from '@dcl/sdk/math'

// Synchronized entities held for the whole run. Every inbound network message is
// resolved against this population, which is what the index changes.
const SYNCED = 400
// Entities mutated each frame, so outgoing CRDT traffic keeps flowing.
const MUTATED_PER_FRAME = 40
const WARMUP_FRAMES = 60
const MEASURED_FRAMES = 300

const local: Entity[] = []
const localSet = new Set<Entity>()
let frame = 0
let frameStart = 0
let totalMs = 0
let worstMs = 0
let reported = false
let sign: Entity

function report() {
  // Entities carrying NetworkEntity that this scene did not create came from a peer.
  let remote = 0
  for (const [entity] of engine.getEntitiesWith(NetworkEntity)) {
    if (!localSet.has(entity)) remote++
  }

  const lines = [
    'crdt network entity index',
    `synced entities created here: ${local.length}`,
    `entities received from peers: ${remote}`,
    `avg frame: ${(totalMs / MEASURED_FRAMES).toFixed(2)} ms   worst: ${worstMs.toFixed(2)} ms`,
    remote > 0
      ? 'INBOUND TRAFFIC OBSERVED: this measurement exercises entity resolution'
      : 'SOLO: no peer traffic, so inbound resolution is not exercised — open a second client'
  ]
  const text = lines.join('\n')
  TextShape.createOrReplace(sign, {
    text,
    fontSize: 1.6,
    textColor: remote > 0 ? Color4.Green() : Color4.White()
  })
  console.log(text)
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 4, 8) })

  for (let i = 0; i < SYNCED; i++) {
    const entity = engine.addEntity()
    const x = 1 + (i % 20) * 0.7
    const z = 1 + Math.floor(i / 20) * 0.7
    Transform.create(entity, { position: Vector3.create(x, 1, z), scale: Vector3.create(0.2, 0.2, 0.2) })
    MeshRenderer.setBox(entity)
    Material.setPbrMaterial(entity, { albedoColor: Color4.create(1, 0.5, 0.2, 1) })
    // Each entity needs a stable id so both clients agree on the mapping.
    syncEntity(entity, [Transform.componentId], i + 1)
    local.push(entity)
    localSet.add(entity)
  }

  engine.addSystem(
    () => {
      frameStart = Date.now()
    },
    Number.MAX_VALUE,
    'repro/clock-start'
  )

  engine.addSystem(
    () => {
      const elapsed = Date.now() - frameStart
      frame++

      // Keep outgoing traffic flowing so peers keep sending updates back.
      for (let i = 0; i < MUTATED_PER_FRAME; i++) {
        const entity = local[(frame * MUTATED_PER_FRAME + i) % local.length]
        const transform = Transform.getMutableOrNull(entity)
        if (transform) transform.position.y = 1 + Math.sin((frame + i) * 0.1) * 0.4
      }

      if (frame > WARMUP_FRAMES && frame <= WARMUP_FRAMES + MEASURED_FRAMES) {
        totalMs += elapsed
        if (elapsed > worstMs) worstMs = elapsed
      }

      if (frame === WARMUP_FRAMES + MEASURED_FRAMES && !reported) {
        reported = true
        report()
      }
    },
    Number.MIN_SAFE_INTEGER,
    'repro/clock-end'
  )
}
