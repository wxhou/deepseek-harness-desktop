import type { UnlistenFn } from '@tauri-apps/api/event'
import type { InstallerState, InstallProgress, SetupStatus, SidebarBusyAction } from './types'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import i18next from 'i18next'
import { defineStore } from 'valtio-define'
import { updater } from '../updater'

const MAX_RETRIES = 8
const IFRAME_LOAD_TIMEOUT = 20000

const initialInstaller: InstallerState = {
  title: '',
  detail: '',
  percentage: 0,
  logs: [],
}

/** 启动流程令牌：boot 并发/重复调用时只采纳最后一次的结果 */
let bootToken = 0
/** 首次自动启动去重（React StrictMode 会重复挂载 effect） */
let bootStarted = false

/** 构建带时间戳的 iframe URL，避免 WebView2 缓存旧页面 */
function generateTimestampedUrl(baseUrl: string): string {
  const timestamp = Date.now()
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}t=${timestamp}`
}

/** 通过 Rust 代理探测服务健康状态（超时 8s，网络抖动时重试） */
async function checkHealthViaProxy(): Promise<boolean> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('health check timeout')), 8000)
    })
    const resultPromise = invoke<string>('proxy_health_check')
    const result = await Promise.race([resultPromise, timeoutPromise])

    const lower = result.toLowerCase()
    if (
      lower.includes('healthy')
      || lower.includes('ready')
      || result.includes('200')
      || result.includes('201')
      || lower.includes('ok')
    ) {
      console.warn('[Harness] health check passed:', result)
      return true
    }
    console.warn('[Harness] health check returned:', result)
    return false
  }
  catch (err) {
    const message = String(err)
    if (message.includes('502') || message.includes('Bad Gateway')) {
      console.warn('[Harness] transient 502 during health check, retrying')
    }
    else {
      console.error('[Harness] health check failed:', err)
    }
    return false
  }
}

/**
 * 桌面外壳核心业务模块：安装/启动流程、服务生命周期（启动/健康检查/重启/停止）、
 * iframe 加载状态与挂起兜底。
 *
 * 拆分说明（参考 damn-reports 的 store 组织方式）：
 * 版本更新与下载完成提示分别收敛到 updater / download 模块，
 * 本模块专注服务生命周期与页面加载状态。
 */
export const harness = defineStore({
  state: () => ({
    status: 'ready' as SetupStatus,
    installer: initialInstaller,
    errorMsg: '',
    serviceUrl: 'http://127.0.0.1:3080',
    /** 带时间戳的 iframe 地址（boot 时生成一次，避免缓存） */
    iframeSrc: '',
    iframeLoaded: false,
    iframeError: false,
    iframeKey: 0,
    serviceHealthy: false,
    serviceRunning: false,
    busyAction: null as SidebarBusyAction,
  }),
  actions: {
    /** 首次挂载时自动启动（StrictMode 重复挂载下保证只执行一次） */
    startup() {
      if (bootStarted)
        return
      bootStarted = true
      void this.boot()
    },

    /** 刷新 iframe：清除加载态并延迟重新挂载 */
    refreshIframe() {
      this.iframeLoaded = false
      this.iframeError = false
      setTimeout(() => {
        this.iframeKey++
      }, 800)
    },

    /** iframe 加载成功/失败时由视图回调更新状态 */
    markIframeLoaded() {
      this.iframeLoaded = true
      this.iframeError = false
    },

    markIframeError() {
      this.iframeError = true
      this.iframeLoaded = false
    },

    /** 安装进度流：只前进不后退，供首次安装/手动更新共用 */
    async listenInstallProgress(): Promise<UnlistenFn> {
      return listen<InstallProgress>('install-progress', (e) => {
        const payload = e.payload
        if (payload.percentage < this.installer.percentage) {
          return
        }
        const logs = payload.log
          ? [...this.installer.logs, payload.log].slice(-5)
          : this.installer.logs
        this.installer = {
          title: payload.title || this.installer.title,
          detail: payload.detail || this.installer.detail,
          percentage: payload.percentage,
          logs,
        }
      })
    },

    /** 拉起服务并等待健康检查通过，通过后才允许挂载 iframe */
    async launchAndWait() {
      this.status = 'ready'
      this.installer = initialInstaller
      this.serviceHealthy = false
      this.iframeLoaded = false
      this.iframeError = false
      await invoke('launch_harness')
      this.serviceRunning = true

      let healthy = false
      for (let attempt = 0; attempt < MAX_RETRIES && !healthy; attempt++) {
        healthy = await checkHealthViaProxy()
        if (!healthy) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
      if (!healthy) {
        throw new Error(
          i18next.t('errors.service_start_timeout', { port: new URL(this.serviceUrl).port || '3080' }),
        )
      }
      this.serviceHealthy = true
    },

    /** 启动流程：检测环境/安装依赖 → 拉起服务 → 已安装时后台检查更新 */
    async boot() {
      const token = ++bootToken
      // 回到加载态：已安装时不再显示检测/启动界面，直接进入页面加载状态
      this.serviceHealthy = false
      this.iframeLoaded = false
      this.iframeError = false
      let unlistenInstall: UnlistenFn | null = null

      try {
        // 事件监听失败（例如 IPC 自定义协议被 CSP 拦截、回退 postMessage 也异常）
        // 不应阻断启动流程，因此容错跳过。
        try {
          unlistenInstall = await this.listenInstallProgress()
        }
        catch (err) {
          console.error('[Harness] failed to listen install-progress:', err)
        }
        const runtimeInfo = await invoke<{ service_url: string }>('get_runtime_info')
        this.serviceUrl = runtimeInfo.service_url
        this.iframeSrc = generateTimestampedUrl(runtimeInfo.service_url)

        // 已安装过则跳过安装界面，避免每次启动都闪现"正在安装依赖..."
        const config = await invoke<{ installed: boolean }>('get_app_config')

        // 仅首次使用需要检测环境/安装依赖；之后直接进入页面
        if (!config.installed) {
          this.status = 'installing'
          this.installer = { ...initialInstaller, title: i18next.t('status.installing') }
          await invoke('install_dependencies')
        }

        await this.launchAndWait()

        if (token !== bootToken)
          return
        // 已安装时后台静默检查新版，发现后提示用户
        if (config.installed) {
          void updater.checkForUpdate()
        }
      }
      catch (err) {
        if (token !== bootToken)
          return
        console.error('[Harness] startup failed:', err)
        this.fail(String(err))
      }
      finally {
        unlistenInstall?.()
      }
    },

    /** 进入安装态（手动更新前复用，标题区分"安装/更新"） */
    prepareInstall(title: string) {
      this.status = 'installing'
      this.installer = { ...initialInstaller, title }
    },

    /** 进入错误态（供本模块与 updater 模块共用） */
    fail(message: string) {
      this.errorMsg = message
      this.status = 'error'
      this.serviceRunning = false
    },

    /** 重启服务：先强杀再拉起，最终回到就绪/错误态 */
    async restart() {
      if (this.busyAction)
        return
      this.busyAction = 'restart'
      try {
        await invoke('shutdown_harness')
      }
      catch (err) {
        console.error('[Harness] shutdown during restart failed:', err)
      }
      this.serviceRunning = false
      this.iframeLoaded = false
      try {
        await this.boot()
      }
      finally {
        this.busyAction = null
      }
    },

    /** 停止服务并回到停止态界面 */
    async shutdown() {
      if (this.busyAction)
        return
      this.busyAction = 'shutdown'
      try {
        await invoke('shutdown_harness')
      }
      catch (err) {
        console.error('[Harness] shutdown failed:', err)
      }
      finally {
        this.busyAction = null
      }
      this.serviceRunning = false
      this.status = 'error'
      this.errorMsg = i18next.t('ui.stopped')
    },

    /** 服务未运行时点击"重试"：重新拉起服务并等待健康检查 */
    async start() {
      if (this.busyAction)
        return
      this.busyAction = 'start'
      try {
        await this.boot()
      }
      finally {
        this.busyAction = null
      }
    },

    /** 在系统浏览器中打开服务地址 */
    async openBrowser() {
      if (this.busyAction)
        return
      this.busyAction = 'openBrowser'
      try {
        await invoke('open_in_browser')
      }
      catch (err) {
        console.error('[Harness] open in browser failed:', err)
      }
      finally {
        this.busyAction = null
      }
    },
  },
})

// 进入 ready 后 iframe 长时间未加载（dsh 未就绪/挂起）→ 转为错误界面，
// 避免一直停在黑色加载遮罩
let iframeLoadTimer: ReturnType<typeof setTimeout> | null = null
harness.$subscribe(() => {
  const { status, serviceHealthy, iframeLoaded, iframeError } = harness.$state
  if (status === 'ready' && serviceHealthy && !iframeLoaded && !iframeError) {
    if (!iframeLoadTimer) {
      iframeLoadTimer = setTimeout(() => {
        iframeLoadTimer = null
        harness.iframeLoaded = false
        harness.iframeError = true
      }, IFRAME_LOAD_TIMEOUT)
    }
  }
  else {
    if (iframeLoadTimer) {
      clearTimeout(iframeLoadTimer)
      iframeLoadTimer = null
    }
  }
})
