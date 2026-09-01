import { InputAction, PBUiInputBinding } from '@dcl/sdk/ecs'
import ReactEcs, { Button, Dropdown, Input, Label, UiEntity } from '@dcl/sdk/react-ecs'

/** The binding every element below asks for. */
export const BINDING: PBUiInputBinding = { actions: [InputAction.IA_JUMP] }

/**
 * One of each wrapper component, plus a bare UiEntity as the control: that one
 * is the only component that has ever acted on uiInputBinding.
 */
export const Panel = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', padding: 16 }}>
    <UiEntity uiTransform={{ width: 200, height: 24 }} uiInputBinding={BINDING} />
    <Label value="a label" uiInputBinding={BINDING} />
    <Button value="a button" uiInputBinding={BINDING} />
    <Input uiInputBinding={BINDING} />
    <Dropdown options={['one', 'two']} uiInputBinding={BINDING} />
  </UiEntity>
)
