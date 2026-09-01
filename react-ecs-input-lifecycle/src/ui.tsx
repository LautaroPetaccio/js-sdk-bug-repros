import ReactEcs, { Input, UiEntity } from '@dcl/sdk/react-ecs'

export type UiState = {
  /** Whether the first field still renders its onChange handler. */
  editing: boolean
  onChange: (value: string) => void
  /** What the second field is told to show. */
  restoredValue: string
  onRestoredChange: (value: string) => void
}

export const state: UiState = {
  editing: true,
  onChange: () => {},
  restoredValue: '',
  onRestoredChange: () => {}
}

export const Panel = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column', padding: 16 }}>
    <Input {...(state.editing ? { onChange: state.onChange } : {})} />
    <Input value={state.restoredValue} onChange={state.onRestoredChange} />
  </UiEntity>
)
