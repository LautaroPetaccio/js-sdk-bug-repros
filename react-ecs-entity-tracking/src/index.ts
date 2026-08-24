import { Entity, EntityState, Font, TextAlignMode, TextShape, Transform, engine } from '@dcl/sdk/ecs'
import { ReactEcsRenderer } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { ChurnPanel, PANEL_ROWS, setChurnFrame } from './ui'

// Frames the UI churns before destroy() is called. Half of them unmount the panel.
const CHURN_FRAMES = 250

// Runs before the react-ecs render system (priority 100e3) so the frame the UI
// renders is the frame this system just published.
const REPRO_SYSTEM_PRIORITY = 100e3 + 10

type Phase = 'churn' | 'destroy' | 'done'

let phase: Phase = 'churn'
let frame = 0
let churnRemovals = 0
let destroyRemovals = 0
let destroyRedundantRemovals = 0

// The reconciler's unmount path and ReactEcsRenderer.destroy() both reach
// removeEntity through this object, so one patch counts both.
const originalRemoveEntity = engine.removeEntity
engine.removeEntity = (entity: Entity) => {
  const alreadyRemoved = engine.getEntityState(entity) === EntityState.Removed
  if (phase === 'churn') {
    churnRemovals++
  } else if (phase === 'destroy') {
    destroyRemovals++
    if (alreadyRemoved) destroyRedundantRemovals++
  }
  return originalRemoveEntity(entity)
}

ReactEcsRenderer.setUiRenderer(ChurnPanel)

function report() {
  const componentDefs = Array.from(engine.componentsIter()).length
  const liveRemovals = destroyRemovals - destroyRedundantRemovals
  const lines = [
    'react-ecs unmounted entity tracking',
    `churn frames: ${CHURN_FRAMES}, panel rows: ${PANEL_ROWS}`,
    `removals during churn: ${churnRemovals}`,
    `removals during destroy(): ${destroyRemovals}`,
    `  ids already removed (leaked): ${destroyRedundantRemovals}`,
    `  ids still live: ${liveRemovals}`,
    `component defs scanned per removal: ${componentDefs}`,
    `wasted component scans: ${destroyRedundantRemovals * componentDefs}`
  ]
  for (const line of lines) console.log(line)

  // Machine-readable line for the headless harness.
  console.log(
    `REPRO_RESULT ${JSON.stringify({
      churnFrames: CHURN_FRAMES,
      panelRows: PANEL_ROWS,
      churnRemovals,
      destroyRemovals,
      destroyRedundantRemovals,
      liveRemovals,
      componentDefs
    })}`
  )

  // The UI is gone after destroy(), so the result is reported in-world.
  const board = engine.addEntity()
  Transform.create(board, { position: { x: 8, y: 2, z: 8 } })
  TextShape.create(board, {
    text: lines.join('\n'),
    fontSize: 1.2,
    font: Font.F_MONOSPACE,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textColor: Color4.White()
  })
}

function reproSystem() {
  if (phase !== 'churn') return

  if (frame < CHURN_FRAMES) {
    setChurnFrame(frame)
    frame++
    return
  }

  phase = 'destroy'
  ReactEcsRenderer.destroy()
  phase = 'done'
  report()
}

engine.addSystem(reproSystem, REPRO_SYSTEM_PRIORITY, 'repro-churn')
