import { CircleExclamation } from '@gravity-ui/icons'
import { Button, Card, Chip, Label, Spinner, Tooltip, Typography } from '@heroui/react'
import { useOverlay } from '@overlastic/react'
import { useMutation } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { toast } from '@/utils'
import { useDshPlugins } from '../hooks/use-dsh-plugins'
import { Dialog } from './dialog'
import { Ellipsis as TextEllipsis } from './ellipsis'

/**
 * 「插件」面板：展示已安装插件，作为「插件出问题时」的卸载/升级入口。
 *
 * - 数据来自 `useDshPlugins`（`get_dsh_plugins` 查询 + `dsh-plugins-updated`
 *   实时事件，react-query 缓存同步）。
 * - 升级 `update_dsh_plugin` / 卸载 `remove_dsh_plugin` 已接入后端
 *   （`dsh plugin --profile <当前档案> update|remove <id>`，进程输出经
 *   `preinstall-log` 事件实时推送）。
 * - 「异常」标记：插件带 `error` 字段（安装/升级/卸载失败或页面运行期上报）
 *   时显示 danger 图标按钮，Tooltip 展示错误详情，行内可直接升级/卸载修复。
 */
export function ConfigPlugin() {
  const { t } = useTranslation()
  const { plugins, loading, error } = useDshPlugins()

  const [dialogHolder, openDialog] = useOverlay(Dialog, { type: 'holder' })

  /** 行内操作进行中状态：id + 操作类型（update/remove），保证单例运行 */
  const [busy, setBusy] = useState<{ id: string, action: 'update' | 'remove' } | null>(null)

  const upgrade = useMutation({
    mutationFn: (id: string) => invoke<void>('update_dsh_plugin', { id }),
    onSuccess: (_data, id) => {
      const name = plugins.find(p => p.id === id)?.name ?? id
      toast(t('plugins.updated_toast', { name }), {})
    },
    onError: (err, id) => {
      const name = plugins.find(p => p.id === id)?.name ?? id
      console.error('[ConfigPlugin] upgrade failed:', err)
      toast(t('plugins.upgrade_failed', { name }), {})
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => invoke<void>('remove_dsh_plugin', { id }),
    onSuccess: (_data, id) => {
      const name = plugins.find(p => p.id === id)?.name ?? id
      toast(t('plugins.removed_toast', { name }), {})
    },
    onError: (err, id) => {
      const name = plugins.find(p => p.id === id)?.name ?? id
      console.error('[ConfigPlugin] remove failed:', err)
      toast(t('plugins.remove_failed', { name }), {})
    },
  })

  async function onUpgrade(id: string) {
    if (busy)
      return
    setBusy({ id, action: 'update' })
    try {
      await upgrade.mutateAsync(id)
    }
    catch {
      // 错误提示已由 mutation 的 onError 处理
    }
    finally {
      setBusy(null)
    }
  }

  async function onRemove(id: string, name: string) {
    if (busy)
      return
    await openDialog({
      status: 'danger',
      title: t('plugins.remove_confirm_title'),
      description: (
        <p>
          {t('plugins.remove_confirm_desc', { name })}
        </p>
      ),
      confirmText: t('plugins.uninstall'),
    })
    setBusy({ id, action: 'remove' })
    try {
      await remove.mutateAsync(id)
    }
    catch {
      // 错误提示已由 mutation 的 onError 处理
    }
    finally {
      setBusy(null)
    }
  }

  return (
    <div>
      {/* 面板头：标题 + 说明 */}
      <div className="space-y-2 sticky top-0 bg-canvas z-10 pb-3">
        <Typography type="h4">
          {t('plugins.title')}
        </Typography>
        <Typography color="muted" type="body-sm">
          {t('plugins.panel_tooltip')}
        </Typography>
      </div>

      {/* 加载 / 失败 / 空态 */}
      <If
        cond={!loading && error === ''}
        else={(
          <If
            cond={loading}
            else={(
              <p className="rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
                {t('plugins.error')}
                ：
                {error}
              </p>
            )}
          >
            <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted">
              <Spinner size="sm" color="current" />
              {t('plugins.loading')}
            </div>
          </If>
        )}
      >
        <If
          cond={plugins.length > 0}
          else={(
            <p className="rounded-md border border-line bg-panel2/40 p-4 text-center text-xs text-muted">
              {t('plugins.empty')}
            </p>
          )}
        >
          <div className="space-y-3 flex-wrap gap-2">
            {plugins.map(plugin => (
              <Card key={plugin.id} className="rounded-md bg-[#f5f5f5] py-3">
                <Card.Content className="flex flex-row items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1">
                      <If cond={plugin.error != null}>
                        <Tooltip delay={0}>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            className="size-6 shrink-0 rounded-md text-danger"
                            aria-label={t('plugins.abnormal_tooltip')}
                          >
                            <CircleExclamation />
                          </Button>
                          <Tooltip.Content className="max-w-[320px]">
                            <div className="space-y-1">
                              <p className="text-xs font-medium">
                                {t('plugins.abnormal_desc', { name: plugin.name })}
                              </p>
                              <p className="whitespace-pre-wrap break-all font-mono text-[11px] opacity-80">
                                {plugin.error?.message}
                              </p>
                            </div>
                          </Tooltip.Content>
                        </Tooltip>
                      </If>
                      <Label className="min-w-0 truncate text-sm font-medium text-ink">
                        {plugin.name}
                      </Label>
                      <If cond={plugin.version !== ''}>
                        <code className="shrink-0 rounded bg-default px-1.5 py-0.5 font-mono text-[10px] text-muted">
                          {plugin.version}
                        </code>
                      </If>
                    </div>
                    <If cond={plugin.description !== ''}>
                      <TextEllipsis lineClamp={2} className="text-xs text-muted">
                        {plugin.description}
                      </TextEllipsis>
                    </If>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* 更新入口仅在插件异常时显示（需求 2：异常插件的修复入口） */}
                    <If cond={plugin.error != null}>
                      <Chip
                        className={`rounded-md${busy ? ' cursor-not-allowed opacity-50' : ' cursor-pointer'}`}
                        variant="primary"
                        color="accent"
                        size="sm"
                        onClick={() => onUpgrade(plugin.id)}
                      >
                        <span className="flex items-center gap-1">
                          {busy?.id === plugin.id && busy.action === 'update'
                            ? <Spinner size="sm" color="current" />
                            : null}
                          {t('plugins.upgrade')}
                        </span>
                      </Chip>
                    </If>
                    <Chip
                      className={`rounded-md${busy ? ' cursor-not-allowed opacity-50' : ' cursor-pointer'}`}
                      variant="primary"
                      color="danger"
                      size="sm"
                      onClick={() => onRemove(plugin.id, plugin.name)}
                    >
                      <span className="flex items-center gap-1">
                        {busy?.id === plugin.id && busy.action === 'remove'
                          ? <Spinner size="sm" color="current" />
                          : null}
                        {t('plugins.uninstall')}
                      </span>
                    </Chip>
                  </div>
                </Card.Content>
              </Card>
            ))}
          </div>
        </If>
      </If>

      {dialogHolder}
    </div>
  )
}
