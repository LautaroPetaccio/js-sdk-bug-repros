import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Button, Label, UiEntity } from '@dcl/sdk/react-ecs'

/**
 * A palette the scene keeps around, the way a scene normally would, rather
 * than rebuilding it inside every render. One entry is handed to a disabled
 * Button; the other is only ever used by a Label.
 */
export const PALETTE = {
  brand: Color4.White(),
  untouched: Color4.White()
}

export const STARTING_ALPHA = PALETTE.brand.a

export const Panel = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', padding: 16 }}>
    <Button value="disabled button" disabled color={PALETTE.brand} uiBackground={{ color: PALETTE.brand }} />
    <Label value="a label sharing the same palette entry" color={PALETTE.brand} />
    <Label value="a label using an entry the button never saw" color={PALETTE.untouched} />
  </UiEntity>
)
