import { Card, Chip, Label, Spinner, Typography } from '@heroui/react'
import { useOverlay } from '@overlastic/react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { useDshPlugins } from '../hooks/use-dsh-plugins'
import { Dialog } from './dialog'
import { Ellipsis as TextEllipsis } from './ellipsis'

/**
 * 「插件」面板：只读展示已安装插件，作为「插件出问题时」的卸载/升级入口。
 *
 * 与「档案」面板保持一致：`Card` 行布局 + `Typography` 标题，行尾放交互操作，
 * 卸载用 `Dialog`（`useOverlay` holder）二次确认；异常详情因需「复制日志 +
 * 升级 + 卸载」三个动作，保留为独立 `Modal`。
 *
 * - 数据来自 `useDshPlugins`（`get_dsh_plugins` + `dsh-plugins-updated` 实时事件）。
 * - 卸载 `remove_dsh_plugin`、升级 `upgrade_dsh_plugin` 两个后端命令尚未实现，
 *   目前按需求约定接入「未来命令」（invoke 会失败并 toast 提示，不崩溃）。
 * - 「异常」标记：后端暂未提供插件错误字段，前端暂以「元信息解析失败
 *   （version 为空）」粗判为异常并允许查看详情；后端落地后替换为真实 error 字段。
 */

interface PluginErrorDialogState {
  id: string
  name: string
  log: string
}

export function ConfigPlugin() {
  const { t } = useTranslation()
  const { plugins, loading, error } = useDshPlugins()

  const [dialogHolder, openDialog] = useOverlay(Dialog, { type: 'holder' })

  /** 升级插件（接入尚未实现的后端命令） */
  function upgrade(_id: string, _source?: PluginErrorDialogState) {
  }

  /** 卸载插件（接入尚未实现的后端命令） */
  function remove(_id: string) {
  }

  /** 卸载确认（用与「档案」面板一致的 Dialog） */
  async function confirmRemove(id: string, name: string) {
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
    remove(id)
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
                  <div>
                    <div className="flex min-w-0 items-center gap-1">
                      {/* TODO: 检测该插件异常时显示
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        className="size-6 shrink-0 rounded-md text-danger"
                        aria-label={t('plugins.abnormal_tooltip')}
                      >
                        <CircleExclamation />
                      </Button> */}
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
                    <If cond={true /* isNewUpgrade */}>
                      <Chip
                        className="rounded-md cursor-pointer"
                        variant="primary"
                        color="accent"
                        onClick={() => upgrade(plugin.id)}
                        size="sm"
                      >
                        更新
                      </Chip>
                    </If>
                    <Chip
                      className="rounded-md cursor-pointer"
                      variant="primary"
                      color="danger"
                      size="sm"
                      onClick={() => confirmRemove(plugin.id, plugin.name)}
                    >
                      卸载
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
