import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

// Imported by both sides before any handler is registered.
export const room = registerMessages({
  runChecks: Schemas.Map({}),
  report: Schemas.Map({ json: Schemas.String })
})
