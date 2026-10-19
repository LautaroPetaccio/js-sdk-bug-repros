// One participant of the simulated room: the real @dcl/sdk network module, evaluated once per vm context so
// the server and the client each get their own engine, transport and clock.
import { engine, RealmInfo, Schemas } from '@dcl/sdk/ecs'
import {
  freezeServerClock,
  getClockSyncStats,
  getPlayerLatency,
  getServerTime,
  registerMessages
} from '@dcl/sdk/network'

;(globalThis as any).__scene = {
  update: (dt: number) => engine.update(dt),
  setConnected(connected: boolean) {
    RealmInfo.createOrReplace(engine.RootEntity, {
      baseUrl: 'http://localhost:8000',
      realmName: 'LocalPreview',
      networkId: 1,
      commsAdapter: 'livekit',
      isPreview: true,
      room: 'clock-sync',
      isConnectedSceneRoom: connected
    })
  },
  getServerTime,
  getClockSyncStats,
  freezeServerClock,
  getPlayerLatency,
  rejectsReservedName() {
    try {
      registerMessages({ __sdkClockPing: Schemas.Map({ hijack: Schemas.Boolean }) })
      return false
    } catch {
      return true
    }
  }
}
