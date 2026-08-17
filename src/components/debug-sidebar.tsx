import type { ReactNode } from 'react'
import { ArrowRotateRight, ArrowsRotateRight, ArrowUpRightFromSquare, Copy, Folder, Power } from '@gravity-ui/icons'
import {
  Button,
  Chip,
  Drawer,
  Input,
  ListBox,
  Select,
  Spinner,
  Switch,
  TextArea,
} from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'valtio-define'
import { harness } from '../store/modules/harness'
import { setting } from '../store/modules/setting'

export interface RuntimeInfo {
  app_version: string
  dsh_version: string | null
  node_version: string
  service_url: string
  data_dir: string
  log_path: string
  platform: string
  arch: string
}

export interface AppConfig {
  port: number
  auto_start: boolean
  cli_link_enabled: boolean
}

export interface CliLinkStatus {
  enabled: boolean
  shim_exists: boolean
  path_registered: boolean
  user_dsh_preserved: boolean
  bin_dir: string
  shim_path: string
}

/** 分组卡片容器 */
function SectionCard({ children, className = '' }: { children: ReactNode, className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {children}
    </div>
  )
}

/** 分组小节标题 */
function SectionTitle({ children, action }: { children: ReactNode, action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted/80 border-b border-line/40 pb-2">
      <span>{children}</span>
      {action && <div>{action}</div>}
    </div>
  )
}

/** 信息列表的一行 */
function InfoRow({ term, children }: { term: string, children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs py-0.5">
      <dt className="shrink-0 text-muted font-medium">{term}</dt>
      <dd className="min-w-0 break-all text-ink text-right font-mono">{children}</dd>
    </div>
  )
}

export default function DebugSidebar() {
  const { t, i18n } = useTranslation()
  const { sidebarOpen } = useStore(setting)
  const { serviceRunning, busyAction } = useStore(harness)
  const [info, setInfo] = useState<RuntimeInfo | null>(null)
  const [port, setPort] = useState('3080')
  const [autoStart, setAutoStart] = useState(true)
  const [cliLinkEnabled, setCliLinkEnabled] = useState(true)
  const [cliToggled, setCliToggled] = useState(false)
  const [cliStatus, setCliStatus] = useState<CliLinkStatus | null>(null)
  const [logs, setLogs] = useState('')
  const [noticeMsg, setNoticeMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function refreshInfo() {
    if (busy)
      return
    setBusy('refreshInfo')
    try {
      setInfo(await invoke<RuntimeInfo>('get_runtime_info'))
    }
    catch (err) {
      console.error('[DebugSidebar] failed to load runtime info:', err)
    }
    finally {
      setBusy(null)
    }
  }

  async function refreshConfig() {
    try {
      const nextConfig = await invoke<AppConfig>('get_app_config')
      setPort(String(nextConfig.port))
      setAutoStart(nextConfig.auto_start)
      setCliLinkEnabled(nextConfig.cli_link_enabled)
    }
    catch (err) {
      console.error('[DebugSidebar] failed to load config:', err)
    }
  }

  async function refreshCliStatus() {
    try {
      setCliStatus(await invoke<CliLinkStatus>('get_cli_link_status'))
    }
    catch (err) {
      console.error('[DebugSidebar] failed to load cli link status:', err)
    }
  }

  async function refreshLogs() {
    if (busy)
      return
    setBusy('refreshLogs')
    try {
      setLogs(await invoke<string>('read_service_logs', { maxBytes: 64 * 1024 }))
    }
    catch (err) {
      console.error('[DebugSidebar] failed to read logs:', err)
    }
    finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void refreshInfo()
    void refreshConfig()
    void refreshCliStatus()
    void refreshLogs()
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!noticeMsg)
      return
    const timer = setTimeout(setNoticeMsg, 2500, '')
    return () => clearTimeout(timer)
  }, [noticeMsg])

  async function saveConfig() {
    setSaving(true)
    try {
      const nextPort = Number(port)
      const nextConfig = await invoke<AppConfig>('update_app_config', {
        port: Number.isInteger(nextPort) && nextPort > 0 ? nextPort : null,
        autoStart,
        cliLinkEnabled,
      })
      setPort(String(nextConfig.port))
      setNoticeMsg(
        cliToggled
          ? cliLinkEnabled
            ? t('messages.cli_link_enabled')
            : t('messages.cli_link_disabled')
          : t('messages.config_saved'),
      )
      setCliToggled(false)
      await refreshCliStatus()
    }
    catch (err) {
      console.error('[DebugSidebar] failed to save config:', err)
      setNoticeMsg(t('messages.save_failed'))
    }
    finally {
      setSaving(false)
    }
  }

  async function copyUrl() {
    if (busy)
      return
    setBusy('copy')
    try {
      await invoke('copy_service_url')
      setNoticeMsg(t('messages.copy_success'))
    }
    catch {
      setNoticeMsg(t('messages.copy_failed'))
    }
    finally {
      setBusy(null)
    }
  }

  async function clearLogs() {
    if (busy)
      return
    setBusy('clearLogs')
    try {
      await invoke('clear_service_logs')
      setLogs('')
      setNoticeMsg(t('messages.logs_cleared'))
    }
    catch (err) {
      console.error('[DebugSidebar] failed to clear logs:', err)
    }
    finally {
      setBusy(null)
    }
  }

  async function revealDataDir() {
    if (busy)
      return
    setBusy('revealDataDir')
    try {
      await invoke('reveal_data_dir')
    }
    catch (err) {
      console.error('[DebugSidebar] failed to reveal data dir:', err)
    }
    finally {
      setBusy(null)
    }
  }

  return (
    <Drawer.Root>
      <Drawer.Backdrop
        isOpen={sidebarOpen}
        onOpenChange={open => (open ? setting.toggleSidebar() : setting.closeSidebar())}
      >
        <Drawer.Content placement="right">
          <Drawer.Dialog>
            <Drawer.Body className="space-y-4 relative">

              {/* 核心服务与地址状态 */}
              <SectionCard>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t('ui.connection_status')}
                  </span>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={serviceRunning ? 'success' : 'danger'}
                    className="font-medium"
                  >
                    {serviceRunning ? t('ui.running') : t('ui.stopped')}
                  </Chip>
                </div>

                <div className="space-y-1.5">
                  <div className="flex gap-1.5">
                    <Input
                      readOnly
                      variant="secondary"
                      value={info?.service_url ?? '-'}
                      aria-label={t('ui.service_url')}
                      className="font-mono text-xs flex-1 rounded-md"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      className="rounded-md"

                      onPress={copyUrl}
                      isDisabled={busy === 'copy'}
                      aria-label={t('buttons.copy')}
                    >
                      {busy === 'copy' ? <Spinner size="sm" color="current" /> : <Copy className="size-3.5" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-md"
                      isIconOnly
                      onPress={harness.openBrowser}
                      isDisabled={busyAction !== null}
                      aria-label={t('app.open_browser')}
                    >
                      {busyAction === 'openBrowser' ? <Spinner size="sm" color="current" /> : <ArrowUpRightFromSquare className="size-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* 服务操作 */}
                <div className="pt-2 border-t border-line/40 flex items-center gap-2">
                  {serviceRunning
                    ? (
                        <>
                          <Button
                            size="sm"
                            variant="tertiary"
                            className="flex-1 rounded-md"
                            onPress={harness.restart}
                            isDisabled={busyAction !== null}
                          >
                            {busyAction === 'restart' ? <Spinner size="sm" color="current" /> : <ArrowRotateRight className="size-3.5" />}
                            {t('app.restart')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            className="flex-1 rounded-md"
                            onPress={harness.shutdown}
                            isDisabled={busyAction !== null}
                          >
                            {busyAction === 'shutdown' ? <Spinner size="sm" color="current" /> : <Power className="size-3.5" />}
                            {t('app.shutdown')}
                          </Button>
                        </>
                      )
                    : (
                        <Button
                          size="sm"
                          variant="primary"
                          className="flex-1 rounded-md"
                          onPress={harness.start}
                          isDisabled={busyAction !== null}
                        >
                          {busyAction === 'start' && <Spinner size="sm" color="current" />}
                          {t('app.retry')}
                        </Button>
                      )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-md"
                    isIconOnly
                    onPress={refreshInfo}
                    isDisabled={busy === 'refreshInfo'}
                    aria-label={t('app.refresh')}
                  >
                    {busy === 'refreshInfo' ? <Spinner size="sm" color="current" /> : <ArrowsRotateRight className="size-3.5" />}
                  </Button>
                </div>
              </SectionCard>

              {/* 应用信息 */}
              <SectionCard>
                <SectionTitle>{t('ui.app_info')}</SectionTitle>
                <dl className="space-y-1">
                  <InfoRow term={t('ui.current_version')}>{info?.app_version ?? '-'}</InfoRow>
                  <InfoRow term={t('ui.dsh_version')}>{info?.dsh_version ?? '-'}</InfoRow>
                  <InfoRow term={t('ui.node_version')}>{info?.node_version ? `v${info.node_version}` : '-'}</InfoRow>
                  <InfoRow term="Platform">
                    {info ? `${info.platform} / ${info.arch}` : '-'}
                  </InfoRow>
                  <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-line/30">
                    <dt className="shrink-0 text-muted font-medium">{t('ui.data_dir')}</dt>
                    <dd className="min-w-0 flex items-center gap-1">
                      <span className="truncate max-w-[160px] font-mono text-[11px] text-muted/80" title={info?.data_dir ?? '-'}>
                        {info?.data_dir ?? '-'}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        className="size-6 min-w-6 rounded-md"
                        aria-label={t('app.reveal_dir')}
                        onPress={revealDataDir}
                        isDisabled={busy === 'revealDataDir'}
                      >
                        {busy === 'revealDataDir' ? <Spinner size="sm" color="current" /> : <Folder className="size-3.5" />}
                      </Button>
                    </dd>
                  </div>
                </dl>
              </SectionCard>

              {/* 设置 */}
              <SectionCard>
                <SectionTitle>{t('ui.settings')}</SectionTitle>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium text-ink">{t('ui.port')}</span>
                    <Input
                      variant="secondary"
                      aria-label={t('ui.port')}
                      value={port}
                      onChange={e => setPort(e.target.value)}
                      inputMode="numeric"
                      className="w-18 text-right h-5 rounded-md px-2 text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs font-medium text-ink">{t('ui.cli_link_enabled')}</span>
                    <Switch
                      isSelected={cliLinkEnabled}
                      onChange={(e) => {
                        setCliLinkEnabled(e)
                        setCliToggled(true)
                      }}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>

                  </div>

                  {cliStatus && (
                    <div className="rounded-lg border border-line/50 bg-background/50 p-2 text-[11px] space-y-1 text-muted">
                      <code className="block truncate font-mono text-[10px] text-muted/70">{cliStatus.bin_dir}</code>
                      <p>{t('ui.cli_link_hint')}</p>
                      {cliStatus.user_dsh_preserved && (
                        <p className="font-medium text-ink">{t('ui.cli_link_user_dsh_preserved')}</p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4 pt-1 border-t border-line/30">
                    <span className="text-xs font-medium text-ink">{t('ui.language')}</span>
                    <Select
                      variant="secondary"
                      selectedKey={i18n.language}
                      onSelectionChange={key => i18n.changeLanguage(String(key))}
                      className="w-32 rounded-md"
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover className="rounded-md">
                        <ListBox>
                          <ListBox.Item id="zh-CN" textValue="中文">中文</ListBox.Item>
                          <ListBox.Item id="en-US" textValue="English">English</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  <Button
                    size="sm"
                    variant="primary"
                    fullWidth
                    onPress={saveConfig}
                    isDisabled={saving}
                    className="mt-2 rounded-md"
                  >
                    {saving && <Spinner size="sm" color="current" />}
                    {saving ? t('ui.saved') : t('ui.save')}
                  </Button>
                </div>
              </SectionCard>

              {/* 日志 */}
              <SectionCard>
                <SectionTitle
                  action={(
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      className="size-6 min-w-6"
                      aria-label={t('buttons.refresh_logs')}
                      onPress={refreshLogs}
                      isDisabled={busy === 'refreshLogs'}
                    >
                      {busy === 'refreshLogs' ? <Spinner size="sm" color="current" /> : <ArrowRotateRight className="size-3.5" />}
                    </Button>
                  )}
                >
                  {t('ui.logs')}
                </SectionTitle>

                <TextArea
                  readOnly
                  variant="secondary"
                  value={logs || t('ui.no_logs')}
                  aria-label={t('ui.logs')}
                  className="min-h-[140px] max-h-[180px] font-mono text-[11px] w-full leading-relaxed"
                />

                <Button
                  size="sm"
                  variant="tertiary"
                  fullWidth
                  className="rounded-md"
                  onPress={clearLogs}
                  isDisabled={busy === 'clearLogs'}
                >
                  {busy === 'clearLogs' && <Spinner size="sm" color="current" />}
                  {t('buttons.clear_logs')}
                </Button>
              </SectionCard>

              {/* Toast 提示浮层 */}
              {noticeMsg && (
                <div className="sticky bottom-2 left-0 right-0 z-50 rounded-lg border border-line bg-panel2/95 px-3.5 py-2 text-xs text-center text-ink shadow-lg backdrop-blur transition-all">
                  {noticeMsg}
                </div>
              )}

            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  )
}
