import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useStore } from 'valtio-define'
import { harness } from '../store/modules/harness'
import { setting, useI18n } from '../store/modules/setting'
import {
  button,
  codeBlock,
  dataDesc,
  dataTerm,
  drawer,
  input,
  logPanel,
  notice,
  overlay,
  sectionTitle,
  select,
  spinner,
  statusPill,
} from './primitives'

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
  bin_dir: string
  shim_path: string
}

/** 按钮内的小型加载指示器：边框旋转动画，颜色跟随当前文字 */
function Spinner() {
  return <span className={spinner()} />
}

/**
 * 右侧调试侧边栏：运行时信息、服务操作、设置与日志。
 * 展开状态来自 setting store；服务状态与操作（重启/停止/启动/打开浏览器）
 * 直接引用 harness store 的方法，不再接收 onClose/onRestart 等回调 props。
 */
export default function DebugSidebar() {
  const { t, language, setLanguage } = useI18n()
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
      const nextInfo = await invoke<RuntimeInfo>('get_runtime_info')
      setInfo(nextInfo)
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
    <>
      {/* 点击侧边栏外内容时关闭侧边栏；透明遮罩位于内容之上、侧边栏之下 */}
      {sidebarOpen && <div aria-hidden onClick={setting.closeSidebar} className={overlay()} />}
      <aside className={drawer({ open: sidebarOpen })}>
        <div className="px-3 pt-4 pb-5">
          <div className="mb-[18px]">
            <h3 className={sectionTitle()}>{t('ui.connection_status')}</h3>
            <span className={statusPill({ tone: serviceRunning ? 'running' : 'stopped' })}>
              {serviceRunning ? t('ui.running') : t('ui.stopped')}
            </span>
          </div>

          <div className="mb-[18px]">
            <h3 className={sectionTitle()}>{t('ui.service_url')}</h3>
            <div className="flex items-center gap-1.5">
              <code className={codeBlock()}>{info?.service_url ?? '-'}</code>
              <button
                className={button({ size: 'sm', tone: 'ghost' })}
                onClick={copyUrl}
                disabled={busy === 'copy'}
                title={t('app.copy_url')}
              >
                {busy === 'copy' && <Spinner />}
                {t('buttons.copy')}
              </button>
            </div>
            <button
              className={button({ size: 'sm', tone: 'ghost', block: true })}
              onClick={harness.openBrowser}
              disabled={busyAction !== null}
            >
              {busyAction === 'openBrowser' && <Spinner />}
              {t('app.open_browser')}
            </button>
          </div>

          <div className="mb-[18px]">
            <h3 className={sectionTitle()}>{t('ui.actions')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {serviceRunning
                ? (
                    <>
                      <button
                        className={button({ size: 'sm', tone: 'ghost' })}
                        onClick={harness.restart}
                        disabled={busyAction !== null}
                      >
                        {busyAction === 'restart' && <Spinner />}
                        {t('app.restart')}
                      </button>
                      <button
                        className={button({ size: 'sm', tone: 'danger' })}
                        onClick={harness.shutdown}
                        disabled={busyAction !== null}
                      >
                        {busyAction === 'shutdown' && <Spinner />}
                        {t('app.shutdown')}
                      </button>
                    </>
                  )
                : (
                    <button
                      className={button({ size: 'sm', tone: 'primary' })}
                      onClick={harness.start}
                      disabled={busyAction !== null}
                    >
                      {busyAction === 'start' && <Spinner />}
                      {t('app.retry')}
                    </button>
                  )}
              <button
                className={button({ size: 'sm', tone: 'ghost' })}
                onClick={refreshInfo}
                disabled={busy === 'refreshInfo'}
              >
                {busy === 'refreshInfo' && <Spinner />}
                {t('app.refresh')}
              </button>
            </div>
          </div>

          <div className="mb-[18px]">
            <h3 className={sectionTitle()}>{t('ui.app_info')}</h3>
            <dl className="m-0 text-xs">
              <dt className={dataTerm()}>{t('ui.current_version')}</dt>
              <dd className={dataDesc()}>{info?.app_version ?? '-'}</dd>
              <dt className={dataTerm()}>{t('ui.dsh_version')}</dt>
              <dd className={dataDesc()}>{info?.dsh_version ?? '-'}</dd>
              <dt className={dataTerm()}>{t('ui.node_version')}</dt>
              <dd className={dataDesc()}>
                v
                {info?.node_version ?? '-'}
              </dd>
              <dt className={dataTerm()}>Platform</dt>
              <dd className={dataDesc()}>
                {info?.platform ?? '-'}
                {' '}
                /
                {info?.arch ?? '-'}
              </dd>
              <dt className={dataTerm()}>{t('ui.data_dir')}</dt>
              <dd className="mt-0.5 flex items-center justify-center gap-2" title={info?.data_dir}>
                <div className="break-all truncate">{info?.data_dir ?? '-'}</div>
                <button
                  className={button({ size: 'sm', tone: 'ghost' })}
                  onClick={revealDataDir}
                  disabled={busy === 'revealDataDir'}
                >
                  {busy === 'revealDataDir' && <Spinner />}
                  {t('app.reveal_dir')}
                </button>
              </dd>
            </dl>
          </div>

          <div className="mb-[18px]">
            <h3 className={sectionTitle()}>{t('ui.settings')}</h3>
            <label className="mb-2 flex items-center gap-2">
              <span>{t('ui.port')}</span>
              <input
                className={input()}
                value={port}
                onChange={e => setPort(e.target.value)}
                inputMode="numeric"
              />
            </label>

            <p className="mb-1 mt-2 text-[11px] font-semibold text-muted">{t('ui.cli_link')}</p>
            <label className="mb-1 flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={cliLinkEnabled}
                onChange={(e) => {
                  setCliLinkEnabled(e.target.checked)
                  setCliToggled(true)
                }}
              />
              <span>{t('ui.cli_link_enabled')}</span>
            </label>
            <div className="mb-2 rounded-md border border-line bg-panel2 px-2 py-1.5">
              {cliStatus && (
                <code className="mt-1 block truncate break-all text-[10px] text-muted">{cliStatus.bin_dir}</code>
              )}
              <p className="mt-1 text-[11px] text-muted">{t('ui.cli_link_hint')}</p>
            </div>

            <button className={button({ size: 'sm', tone: 'primary', block: true })} onClick={saveConfig} disabled={saving}>
              {saving
                ? (
                    <>
                      <Spinner />
                      {t('ui.saved')}
                    </>
                  )
                : (
                    t('ui.save')
                  )}
            </button>
            <div className="mt-2.5 flex items-center gap-2 text-[13px]">
              <span>
                {t('ui.language')}
                :
              </span>
              <select
                className={select()}
                value={language}
                onChange={e => setLanguage(e.target.value as 'en' | 'zh')}
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <h3 className={sectionTitle()}>
              {t('ui.logs')}
              <button
                className={button({ size: 'sm', tone: 'ghost' })}
                onClick={refreshLogs}
                disabled={busy === 'refreshLogs'}
                title={t('buttons.refresh_logs')}
              >
                {busy === 'refreshLogs' ? <Spinner /> : '↻'}
              </button>
            </h3>
            <pre className={logPanel()}>{logs || t('ui.no_logs')}</pre>
            <button
              className={button({ size: 'sm', tone: 'ghost' })}
              onClick={clearLogs}
              disabled={busy === 'clearLogs'}
            >
              {busy === 'clearLogs' && <Spinner />}
              {t('buttons.clear_logs')}
            </button>
          </div>

          {noticeMsg && (
            <div className={notice()}>
              {noticeMsg}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
