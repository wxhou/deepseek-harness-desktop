/* eslint-disable react/dom-no-unsafe-iframe-sandbox */
import type { InstallerState } from '../hooks/use-harness'
import type { SetupStatus } from './setup-screen'
import { useI18n } from '../i18n/i18n-context'
import Loadable from './loadable'
import SetupScreen from './setup-screen'

// 官方 md 主按钮：h36 / 圆角 18px 胶囊 / 中性品牌色填充无边框（对应 ui-primitives Button）
const btnPrimary
  = 'inline-flex h-9 cursor-pointer items-center justify-center gap-1 rounded-[18px] bg-btn-fill px-3.5 text-sm leading-[22px] text-btn-ink transition-colors hover:bg-btn-fill-hover disabled:cursor-not-allowed disabled:opacity-40'

interface HarnessViewProps {
  status: SetupStatus
  installer: InstallerState
  errorMsg: string
  serviceHealthy: boolean
  iframeError: boolean
  iframeKey: number
  iframeSrc: string
  serviceUrl: string
  onRetry: () => void
  onIframeLoad: () => void
  onIframeError: () => void
  onRefresh: () => void
}

/**
 * 主区域视图：安装/错误态渲染 SetupScreen，
 * 就绪态渲染 iframe（挂载后加载职责交给 dsh 应用内官方 boot 页，避免两套 loading 叠加）。
 */
export default function HarnessView({
  status,
  installer,
  errorMsg,
  serviceHealthy,
  iframeError,
  iframeKey,
  iframeSrc,
  serviceUrl,
  onRetry,
  onIframeLoad,
  onIframeError,
  onRefresh,
}: HarnessViewProps) {
  const { t } = useI18n()

  if (status === 'error') {
    return (
      <main className="relative flex-1 bg-canvas">
        <SetupScreen
          status="error"
          title=""
          detail=""
          percentage={installer.percentage}
          logs={installer.logs}
          errorMsg={errorMsg}
          onRetry={onRetry}
        />
      </main>
    )
  }

  if (status !== 'ready') {
    return (
      <main className="relative w-full bg-canvas">
        <SetupScreen
          status={status}
          title={installer.title}
          detail={installer.detail}
          percentage={installer.percentage}
          logs={installer.logs}
          errorMsg=""
          onRetry={onRetry}
        />
      </main>
    )
  }

  return (
    <main className="relative flex-1 bg-canvas">
      {serviceHealthy
        ? (
            // 底色用 load-bg 与官方 boot 页一致，交接瞬间无闪白
            // allow="all"：dsh 页面与外壳跨源，Permissions Policy 的 clipboard-write
            // 默认 allowlist 仅 self，跨源 iframe 里 navigator.clipboard.writeText()
            // 会抛 NotAllowedError（dsh 的复制按钮/JSON 复制均依赖它，控制台报
            // "Permissions policy violation: The Clipboard API has been blocked"）。
            // 这里不做白名单限制，直接放行全部策略特性（同禁用拖拽的
            // disable_drag_drop_handler 一样，是外壳层面对 WebView2 默认行为的修正）。
            <iframe
              key={iframeKey}
              className="block h-full w-full border-none bg-load-bg"
              src={iframeSrc}
              allow="clipboard-read; clipboard-write; camera; microphone; geolocation; display-capture; autoplay; encrypted-media; fullscreen"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads allow-storage-access-by-user-activation"
              onLoad={onIframeLoad}
              onError={onIframeError}
              title={t('app.open_editor')}
            />
          )
        : (
            // 服务未就绪前的加载遮罩，与官方 boot 页同款视觉
            <div className="absolute inset-0 z-[1]">
              <Loadable subtitle={t('status.loading')} />
            </div>
          )}
      {serviceHealthy && iframeError && (
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-canvas text-ink">
          <p>{t('ui.iframe_error')}</p>
          <p className="text-muted">{t('ui.ensure_running', { url: serviceUrl })}</p>
          <button className={btnPrimary} onClick={onRefresh}>
            {t('app.retry')}
          </button>
        </div>
      )}
    </main>
  )
}
