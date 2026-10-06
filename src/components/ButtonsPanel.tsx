import { useTranslation } from 'react-i18next'
import { useActiveProfile, useNagaStore } from '../store/useNagaStore'
import { BUTTON_ACTION_IDS, MOUSE_BUTTONS } from '../lib/constants'
import type { ButtonActionKind, ButtonBinding } from '../../electron/types'

const needsValue = (action: ButtonActionKind) =>
  action === 'key' || action === 'mouse-button' || action === 'macro'

export function ButtonsPanel() {
  const { t } = useTranslation()
  const profile = useActiveProfile()
  const device = useNagaStore((state) => state.device)
  const updateActive = useNagaStore((state) => state.updateActive)

  const updateButton = (next: ButtonBinding) =>
    updateActive((current) => ({
      ...current,
      buttons: current.buttons.map((button) => (button.id === next.id ? next : button)),
    }))

  const applyF13Preset = () =>
    updateActive((current) => ({
      ...current,
      buttons: current.buttons.map((button) => {
        const match = /^side-(\d+)$/.exec(button.id)
        if (!match) return button
        const index = Number(match[1])
        if (index < 1 || index > 12) return button
        return {
          ...button,
          action: 'key',
          value: `F${12 + index}`,
          macroId: undefined,
        }
      }),
    }))

  const baseButtons = profile.buttons.filter((button) => button.id.startsWith('base-'))
  const sideButtons = profile.buttons.filter((button) => button.id.startsWith('side-'))
  const plateBadge =
    profile.sidePlate === 'twelve' ? 'MMO' : profile.sidePlate === 'seven' ? 'MOBA' : 'FPS'
  const showF13Preset = device.model === 'naga-pro-wired' && profile.sidePlate === 'twelve'

  return (
    <div className="section buttons-section">
      <div className="card buttons-card">
        <header className="card-head">
          <div>
            <p className="eyebrow">{t('buttons.baseEyebrow')}</p>
            <h3>{t('buttons.baseTitle')}</h3>
          </div>
          <span className="badge muted">
            {baseButtons.length} {t('buttons.bindings')}
          </span>
        </header>
        <div className="button-grid">
          {baseButtons.map((button) => (
            <BindingRow
              key={button.id}
              binding={button}
              macros={profile.macros}
              onChange={updateButton}
            />
          ))}
        </div>
      </div>

      <div className="card buttons-card">
        <header className="card-head">
          <div>
            <p className="eyebrow">
              {t('buttons.sidePlateEyebrow')} {profile.sidePlate.toUpperCase()}
            </p>
            <h3>{t('buttons.sideTitle', { count: sideButtons.length })}</h3>
          </div>
          <div className="card-head-actions">
            {showF13Preset && (
              <button type="button" className="ghost-button compact" onClick={applyF13Preset}>
                F13–F24 preset
              </button>
            )}
            <span className="badge muted">{plateBadge}</span>
          </div>
        </header>
        <div className="button-grid">
          {sideButtons.map((button) => (
            <BindingRow
              key={button.id}
              binding={button}
              macros={profile.macros}
              onChange={updateButton}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface BindingRowProps {
  binding: ButtonBinding
  macros: ReturnType<typeof useActiveProfile>['macros']
  onChange(next: ButtonBinding): void
}

function BindingRow({ binding, macros, onChange }: BindingRowProps) {
  const { t, i18n } = useTranslation()
  const showInput = needsValue(binding.action)
  const labelKey = `buttons.labels.${binding.id}`
  const displayLabel = i18n.exists(labelKey) ? (t(labelKey) as string) : binding.label

  return (
    <div className="binding-row">
      <div className="binding-label">
        <span className="binding-index">#{binding.hardwareIndex}</span>
        <strong>{displayLabel}</strong>
      </div>
      <select
        value={binding.action}
        onChange={(event) =>
          onChange({
            ...binding,
            action: event.target.value as ButtonActionKind,
            value: event.target.value === 'mouse-button' ? 'Mouse 4' : binding.value,
          })
        }
      >
        {BUTTON_ACTION_IDS.map((action) => (
          <option key={action} value={action}>
            {t(`actions.${action}`)}
          </option>
        ))}
      </select>
      {showInput && binding.action === 'macro' ? (
        <select
          value={binding.macroId ?? ''}
          onChange={(event) =>
            onChange({ ...binding, macroId: event.target.value, value: event.target.value })
          }
        >
          <option value="">{t('buttons.macroPick')}</option>
          {macros.map((macro) => (
            <option key={macro.id} value={macro.id}>
              {macro.name}
            </option>
          ))}
        </select>
      ) : showInput && binding.action === 'mouse-button' ? (
        <select
          value={binding.value}
          onChange={(event) => onChange({ ...binding, value: event.target.value })}
        >
          {MOUSE_BUTTONS.map((mouseButton) => (
            <option key={mouseButton} value={mouseButton}>
              {mouseButton}
            </option>
          ))}
        </select>
      ) : showInput ? (
        <input
          value={binding.value}
          placeholder={binding.action === 'key' ? t('buttons.keyPlaceholder') : 'Mouse 4'}
          onChange={(event) => onChange({ ...binding, value: event.target.value })}
        />
      ) : (
        <div className="binding-static">{binding.value || '—'}</div>
      )}
    </div>
  )
}
