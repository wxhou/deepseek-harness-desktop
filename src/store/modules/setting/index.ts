import type { Language, Translations } from '../../../i18n'
import { invoke } from '@tauri-apps/api/core'
import { defineStore, useStore } from 'valtio-define'
import { translations } from '../../../i18n'

const STORAGE_KEY = 'deepseek-harness-desktop-language'

/** 初始语言：优先取 localStorage，其次浏览器语言 */
function getInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY) as Language | null
  if (saved === 'en' || saved === 'zh') {
    return saved
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** 按 keyPath（如 'ui.running'）取翻译文案，支持 {{param}} 插值 */
function getTranslation(obj: Translations, keyPath: string, params?: Record<string, string | number>): string {
  const keys = keyPath.split('.')
  let value: unknown = obj

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = (value as Record<string, unknown>)[key]
    }
    else {
      return keyPath
    }
  }

  if (typeof value !== 'string') {
    return keyPath
  }

  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (match, paramName: string) => {
      return params[paramName]?.toString() ?? match
    })
  }
  return value
}

/** 从 localStorage 恢复侧边栏开关状态 */
function getInitialSidebarOpen(): boolean {
  const saved = localStorage.getItem('sidebarOpen')
  return saved === null ? false : saved === 'true'
}

/**
 * 设置模块：语言偏好与文案翻译 + 侧边栏开关等纯 UI 状态（由原 i18n / ui 模块合并而来）。
 * 组件通过 useI18n() 订阅语言变化；store 内部动作直接调用 setting.t(...)。
 */
export const setting = defineStore({
  state: () => ({
    language: getInitialLanguage() as Language,
    sidebarOpen: getInitialSidebarOpen(),
  }),
  actions: {
    setLanguage(lang: Language) {
      this.language = lang
      localStorage.setItem(STORAGE_KEY, lang)
      // 后端语言设置仅尽力而为
      invoke('set_language', { lang }).catch(() => {})
    },
    t(key: string, params?: Record<string, string | number>): string {
      return getTranslation(translations[this.language], key, params)
    },
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen
      localStorage.setItem('sidebarOpen', String(this.sidebarOpen))
    },
    closeSidebar() {
      this.sidebarOpen = false
      localStorage.setItem('sidebarOpen', 'false')
    },
  },
})

// 语言变化时同步 <html lang> 与方向（首次加载也立即生效）
function applyDocumentLanguage(language: Language) {
  document.documentElement.lang = language
  document.documentElement.dir = 'ltr'
}
applyDocumentLanguage(setting.language)
setting.$subscribeKey('language', (language) => {
  applyDocumentLanguage(language)
})

/** 订阅 setting store，返回语言与翻译函数（语言切换时自动重渲染） */
export function useI18n() {
  const { language } = useStore(setting)
  return {
    language,
    setLanguage: setting.setLanguage,
    t: setting.t,
  }
}
