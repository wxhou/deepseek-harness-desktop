import { Plus } from '@gravity-ui/icons'
import { Button, Card, Checkbox, Chip, Description, Input, Label, Typography } from '@heroui/react'
import { useOverlay } from '@overlastic/react'
import { useState } from 'react'

import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { toast } from '@/utils'
import { Dialog } from './dialog'
import { Ellipsis } from './ellipsis'

/** 档案行：一个 dsh 配置档案（隔离的插件/补丁/设置集合） */
export interface Profile {
  id: string
  name: string
  /** 是否为默认档案 */
  default: boolean
  /** 是否为当前使用的档案 */
  active: boolean
  /** 简短说明的 i18n key（可选） */
  description?: string
}

export function ConfigProfile() {
  /**
   * 「档案」面板：展示 & 切换 dsh 配置档案，支持新建。
   *
   * 列表用 HeroUI `ListBox` 标准用法渲染：`selectionMode="single"` + 受控
   * `selectedKeys` 表示当前激活档案，`ListBox.ItemIndicator` 渲染选中标记。
   *
   * 注意：后端尚无 get_profiles / set_active_profile / create_profile 命令，
   * 按需求约定「仅前端 + 内置示范数据」在此用本地状态驱动 UI（含本地交互演示）；
   * 后端命令落地后，把 `useState` 初始值换成真实查询、把本地更新换成接口调用即可。
   */
  const DEMO_PROFILES: Profile[] = [
    { id: 'web', name: 'Web', default: true, active: true, description: '官方默认' },
  ]

  const [dialogHolder, openDialog] = useOverlay(Dialog, { type: 'holder' })

  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<Profile[]>(DEMO_PROFILES)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  async function activate(id: string) {
    const target = profiles.find(p => p.id === id)
    if (!target || target.active)
      return
    await openDialog({
      status: 'warning',
      title: '确认切换档案？',
      description: (
        <p>
          切换至
          {' '}
          <strong>{target.name}</strong>
          {' '}
          档案，相应的插件与设置将被一同切换。
        </p>
      ),
    })
    setProfiles(prev => prev.map(p => ({ ...p, active: p.id === id })))
    toast(t('profiles.activate_toast', { name: target.name }), {})
  }

  function startCreate() {
    setCreating(true)
    setName('')
  }

  function cancelCreate() {
    setCreating(false)
    setName('')
  }

  function commitCreate() {
    const trimmed = name.trim()
    if (!trimmed)
      return
    const id = trimmed.toLowerCase().replace(/\s+/g, '-')
    setProfiles(prev => [
      ...prev,
      { id, name: trimmed, default: false, active: false },
    ])
    setCreating(false)
    setName('')
    toast(t('profiles.created_toast', { name: trimmed }), {})
  }

  async function remove(id: string) {
    const target = profiles.find(p => p.id === id)
    if (!target)
      return
    await openDialog({
      title: 'Remove Profile',
      status: 'danger',
      description: (
        <p>
          This will permanently delete
          {' '}
          <strong>{target.name}</strong>
          {' '}
          and all of its
          data. This action cannot be undone.
        </p>
      ),
    })
    setProfiles(prev => prev.filter(p => p.id !== id))
    toast(t('profiles.removed_toast', { name: id }), {})
  }

  return (
    <div className="space-y-3">
      {/* 面板头：标题 + 说明 [i] */}
      <div className="space-y-2">
        <Typography type="h4">
          {t('profiles.title')}
        </Typography>
        <Typography color="muted" type="body-sm">
          {t('profiles.tooltip')}
        </Typography>
      </div>

      <div className="space-y-3 flex-wrap gap-2">
        {profiles.map(profile => (
          <Card key={profile.id} className="bg-[#f5f5f5] rounded-md py-3 cursor-pointer" onClick={() => activate(profile.id)}>
            <Card.Content className="flex flex-row justify-between">
              <div className="flex items-center gap-1">
                <Label className="min-w-0 truncate text-sm font-medium text-ink">
                  {profile.name}
                </Label>
                <If cond={profile.description != null}>
                  <Description className="min-w-0 text-xs text-muted">
                    <Ellipsis>{t(profile.description as string)}</Ellipsis>
                  </Description>
                </If>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  isSelected={profile.active}
                  aria-label={profile.name}
                  className="shrink-0"
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                  </Checkbox.Content>
                </Checkbox>
                <If cond={!profile.default}>
                  <Chip
                    className="rounded-md"
                    variant="primary"
                    color="danger"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      remove(profile.id)
                    }}
                  >
                    删除
                  </Chip>
                </If>
              </div>
            </Card.Content>
          </Card>
        ))}
        {/* 新建档案：内联输入 or 触发入口 */}
        <If
          cond={!creating}
          else={(
            <div className="flex items-center gap-2 px-1">
              <Input
                autoFocus
                variant="secondary"
                className="h-8 flex-1 rounded-md"
                placeholder={t('profiles.name_placeholder')}
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    commitCreate()
                }}
              />
              <Button size="sm" variant="tertiary" className="h-8 rounded-md" onPress={cancelCreate}>
                {t('profiles.create_cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="h-8 rounded-md"
                isDisabled={!name.trim()}
                onPress={commitCreate}
              >
                {t('profiles.create_confirm')}
              </Button>
            </div>
          )}
        >
          <Button
            onClick={startCreate}
            variant="tertiary"
            className="flex w-full rounded-md"
          >
            <Plus className="size-3.5" />
            <span>{t('profiles.new_profile')}</span>
          </Button>
        </If>
      </div>
      {dialogHolder}
    </div>
  )
}
