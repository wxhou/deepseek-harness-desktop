import { Card, Checkbox, Chip, Description, Label, Typography } from '@heroui/react'
import { useOverlay } from '@overlastic/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { If } from 'react-if-lite'
import { toast } from '@/utils'
import { Dialog } from './dialog'

/** 版本来源：local = 本机用 CLI 安装；app = 由桌面端管理 */
export type HarnessSource = 'local' | 'app'

/** Harness Core 版本行 */
export interface HarnessVersion {
  id: string
  version: string
  source: HarnessSource
  /** 本地是否已下载/存在（可卸载）。未下载过的版本没有卸载入口。 */
  present: boolean
  /** 当前正在使用的版本 */
  active: boolean
  /** 额外说明的 i18n key（可选） */
  hint?: string
  /** 是否存在错误信息 */
  error?: string
}
const DEMO_VERSIONS: HarnessVersion[] = [
  { id: 'local-rc7', version: 'v0.1.0-rc.7', source: 'local', present: true, active: false, hint: 'core.local_hint' },
  { id: 'app-rc8', version: 'v0.1.0-rc.8', source: 'app', present: true, active: true },
  { id: 'app-rc7', version: 'v0.1.0-rc.7', source: 'app', present: false, active: false },
  { id: 'app-rc6', version: 'v0.1.0-rc.6', source: 'app', present: false, active: false },
]

export function ConfigCore() {
  const [dialogHolder, openDialog] = useOverlay(Dialog, { type: 'holder' })

  const { t } = useTranslation()
  const [versions, setVersions] = useState<HarnessVersion[]>(DEMO_VERSIONS)

  async function onActivate(version: HarnessVersion) {
    if (version.active)
      return
    await openDialog({
      status: 'warning',
      title: t('core.switch_confirm_title'),
      description: (
        <p>
          {t('core.switch_confirm_desc', { version: version.version })}
        </p>
      ),
    })
    setVersions(prev => prev.map(v => ({ ...v, active: v.id === version.id })))
    toast(t('core.activate_toast', { version: version.version }), {})
  }

  async function onRemove(version: HarnessVersion) {
    await openDialog({
      status: 'danger',
      title: t('core.remove_confirm_title'),
      description: (
        <p>
          {t('core.remove_confirm_desc', { version: version.version })}
        </p>
      ),
      confirmText: t('core.uninstall'),
    })
    setVersions(prev => prev.map(v => (
      v.id === version.id ? { ...v, present: false, active: false } : v
    )))
    toast(t('core.uninstalled_toast', { version: version.version }), {})
  }

  return (
    <div className="space-y-3">
      {/* 面板头：标题 + 说明 */}
      <div className="space-y-2">
        <Typography type="h4">
          {t('core.title')}
        </Typography>
        <Typography color="muted" type="body-sm">
          {t('core.tooltip')}
        </Typography>
      </div>

      <div className="space-y-3 flex-wrap gap-2">
        {versions.map(version => (
          <Card
            key={version.id}
            className="cursor-pointer rounded-md bg-[#f5f5f5] py-3"
            onClick={() => onActivate(version)}
          >
            <Card.Content className="flex flex-row items-center justify-between">
              <div className="flex min-w-0 items-center gap-1">
                <Label className="min-w-0 truncate font-mono text-sm font-medium text-ink">
                  {version.version}
                </Label>
                <If cond={version.source === 'local'}>
                  <Chip size="sm" variant="soft" color="accent" className="shrink-0 font-medium">
                    {t('core.local')}
                  </Chip>
                </If>
                <If cond={version.hint != null}>
                  <Description className="min-w-0 text-xs text-muted">
                    {t(version.hint as string)}
                  </Description>
                </If>
                <If cond={!version.present && version.hint == null}>
                  <Description className="min-w-0 text-xs text-muted">
                    {t('core.not_downloaded')}
                  </Description>
                </If>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Checkbox
                  isSelected={version.active}
                  aria-label={version.version}
                  className="shrink-0"
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                  </Checkbox.Content>
                </Checkbox>
                <If cond={version.present}>
                  <Chip
                    className="rounded-md"
                    variant="primary"
                    color="danger"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemove(version)
                    }}
                  >
                    {t('core.uninstall')}
                  </Chip>
                </If>
              </div>
            </Card.Content>
          </Card>
        ))}
        {/* 未下载、无卸载入口的兜底提示 */}
        <If cond={versions.length === 0}>
          <p className="p-4 text-center text-xs text-muted">{t('plugins.empty')}</p>
        </If>
      </div>

      {dialogHolder}
    </div>
  )
}
