import {
  AvatarBase,
  AvatarEmoteCommand,
  AvatarEquippedData,
  Entity,
  RealmInfo,
  TextShape,
  Transform,
  engine
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { onEnterSceneObservable, onPlayerClickedObservable } from '@dcl/sdk/observables'

type ObservedComponent = { onChange: (entity: Entity, cb: (value: unknown) => void) => void }

// Components that only the enter/leave, realm, expression and profile observables listen to.
const unrelatedComponents = [RealmInfo, AvatarBase, AvatarEquippedData, AvatarEmoteCommand]

const notificationsByUser = new Map<string, number>()
let onChangeCalls = 0
let listenersFromClickSubscription = 0
let renderedReport = ''

// Counts every listener the SDK installs on components the requested event does not need.
function countUnrelatedListeners() {
  for (const component of unrelatedComponents) {
    const target = component as unknown as ObservedComponent
    const onChange = target.onChange.bind(target)
    target.onChange = (entity, cb) => {
      onChangeCalls++
      onChange(entity, cb)
    }
  }
}

function buildReport(): { text: string; bug: boolean } {
  const lines = [
    'observable subscription fall-through',
    `unrelated listeners installed by the playerClicked subscription: ${listenersFromClickSubscription} (expected 0)`
  ]

  if (notificationsByUser.size === 0) {
    lines.push('waiting for an enter-scene event...')
    return { text: lines.join('\n'), bug: listenersFromClickSubscription > 0 }
  }

  let doubled = false
  for (const [userId, count] of notificationsByUser) {
    if (count > 1) doubled = true
    lines.push(`onEnterScene notifications for ${userId}: ${count} (expected 1)`)
  }
  lines.push(
    doubled
      ? 'BUG REPRODUCED: one enter-scene event notified the observable twice'
      : 'FIXED: one enter-scene event, one notification'
  )

  return { text: lines.join('\n'), bug: doubled || listenersFromClickSubscription > 0 }
}

export function main() {
  countUnrelatedListeners()

  // Poisons the switch: 'playerClicked' is its first case, so it falls through into every later subscriber.
  onPlayerClickedObservable.add(() => {})
  listenersFromClickSubscription = onChangeCalls

  // subscribeEnterScene() already ran above without being recorded, so this registers it a second time.
  onEnterSceneObservable.add((event) => {
    notificationsByUser.set(event.userId, (notificationsByUser.get(event.userId) ?? 0) + 1)
  })

  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, 1.6, 8) })

  engine.addSystem(() => {
    const report = buildReport()
    if (report.text === renderedReport) return
    renderedReport = report.text

    TextShape.createOrReplace(sign, {
      text: report.text,
      fontSize: 2,
      textColor: report.bug ? Color4.Red() : Color4.Green()
    })
    console.log(report.text)
  })
}
