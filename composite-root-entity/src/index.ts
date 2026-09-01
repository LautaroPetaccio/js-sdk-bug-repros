import { Composite, Engine, Entity, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { Transform as TransformComponent } from '@dcl/ecs/dist/components'

const FRAMES_BEFORE_RUN = 45
const COMPOSITE_SOURCE = 'two-children.composite'

/** Two entities, both parented to the composite's own root, which is entity 0. */
const COMPOSITE_JSON = {
  version: 1,
  components: [
    {
      name: 'core::Transform',
      data: {
        '518': { $case: 'json', json: { position: { x: 1, y: 1, z: 1 }, parent: 0 } },
        '519': { $case: 'json', json: { position: { x: 2, y: 2, z: 2 }, parent: 0 } }
      }
    }
  ]
}

let sign: Entity
let frames = 0
let done = false
let returnedRoot: Entity | undefined
let parents: number[] = []
let rendered = ''

function measure() {
  const probe = Engine()
  const ProbeTransform = TransformComponent(probe)

  const resource: Composite.Resource = { src: COMPOSITE_SOURCE, composite: Composite.fromJson(COMPOSITE_JSON) }
  const provider: Composite.Provider = {
    getCompositeOrNull: (src) => (src === COMPOSITE_SOURCE ? resource : null)
  }

  // The natural way to drop a composite into a scene at the top level.
  returnedRoot = Composite.instance(probe, resource, provider, { rootEntity: probe.RootEntity })

  parents = []
  for (const [, transform] of probe.getEntitiesWith(ProbeTransform)) {
    parents.push(transform.parent as number)
  }
}

function render() {
  const lines = ['a composite instanced onto the root entity']

  let verdict = ''
  if (done) {
    lines.push(`root entity handed back: ${returnedRoot}`)
    lines.push(`parents of the composite entities: ${parents.join(', ')}`)

    if (parents.length > 0 && parents.every((parent) => parent === 0)) {
      verdict = 'FIXED: the composite hangs off the root, which is what was asked for.'
    } else {
      verdict = `BUG REPRODUCED: the composite hangs off entity ${parents[0]}, which has no components and was never handed back.`
    }
    lines.push(verdict)
  } else {
    lines.push(`instancing in ${FRAMES_BEFORE_RUN - frames} frames`)
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

  if (!done && frames >= FRAMES_BEFORE_RUN) {
    measure()
    done = true
  }

  render()
}

export function main() {
  sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  engine.addSystem(driver, 0, 'repro/driver')
}
