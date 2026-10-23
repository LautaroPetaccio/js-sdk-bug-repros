import { engine, Transform, TextShape } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// The payload/ files are never loaded: they only make the deployment big enough to go partial.
export function main() {
  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 2, 8) })
  TextShape.create(sign, {
    text: 'partial deployment upload\npublished in batches: payload/ holds 64 MiB of random files',
    fontSize: 2,
    textColor: Color4.White()
  })
}
