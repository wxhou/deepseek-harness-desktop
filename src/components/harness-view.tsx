import type { InstallerState } from '../hooks/use-harness'
import type { SetupStatus } from './setup-screen'
import { useI18n } from '../i18n/i18n-context'
import Loadable from './loadable'
import SetupScreen from './setup-screen'

const btnPrimary
  = 'inline-flex cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3 py-1.5 text-[13px] text-white transition-colors hover:bg-accent2 disabled:cursor-not-allowed disabled:opacity-55'

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
            <iframe
              key={iframeKey}
              className="block h-full w-full border-none bg-load-bg"
              src={iframeSrc}
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
