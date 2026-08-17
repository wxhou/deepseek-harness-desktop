import { defineStore } from 'valtio-define'
import { persist } from 'valtio-define/plugins'

/**
 * 设置模块：语言偏好（i18n 由 src/i18n 统一管理，组件直接用 react-i18next 的 useTranslation）
 * + 侧边栏开关等纯 UI 状态。store 内部动作直接调用 setting.t(...)。
 */
export const setting = defineStore({
  state: () => ({
    sidebarOpen: false,
    language: null as string | null,
  }),
  actions: {
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen
    },
    closeSidebar() {
      this.sidebarOpen = false
    },
  },
  persist: {
    key: 'setting',
    paths: ['sidebarOpen'],
  },
})

setting.use(persist({ hydrate: false }))
