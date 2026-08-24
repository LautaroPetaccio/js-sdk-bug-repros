import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

// Rows the panel mounts; each row is one UI entity, plus one for the panel itself.
export const PANEL_ROWS = 24

let churnFrame = 0

export function setChurnFrame(value: number) {
  churnFrame = value
}

const rows: number[] = []
for (let i = 0; i < PANEL_ROWS; i++) rows.push(i)

/**
 * A panel mounted on even frames and unmounted on odd ones — the same churn a
 * real scene produces with a list that grows and shrinks, or a HUD toggled by
 * game state. Every unmount frees PANEL_ROWS + 1 engine entities.
 */
export function ChurnPanel() {
  const visible = churnFrame % 2 === 0
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
      key="root"
    >
      {visible && (
        <UiEntity
          uiTransform={{ width: 400, flexDirection: 'column', padding: 8 }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.6) }}
          key="panel"
        >
          {rows.map((row) => (
            <Label key={row} value={`row ${row} — frame ${churnFrame}`} fontSize={14} color={Color4.White()} />
          ))}
        </UiEntity>
      )}
    </UiEntity>
  )
}
