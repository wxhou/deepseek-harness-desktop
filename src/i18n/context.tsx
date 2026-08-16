import type { ReactNode } from 'react'
import type { Language, Translations } from './index'
import { invoke } from '@tauri-apps/api/core'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { translations } from './index'

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextType | undefined>(undefined)

const STORAGE_KEY = 'deepseek-harness-desktop-language'

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

export const I18nProvider: React.FC<{ children: ReactNode, defaultLanguage?: Language }> = ({
  children,
  defaultLanguage = 'en',
}) => {
  const getInitialLanguage = (): Language => {
    const saved = localStorage.getItem(STORAGE_KEY) as Language | null
    if (saved === 'en' || saved === 'zh') {
      return saved
    }
    const browserLang = navigator.language.toLowerCase()
    return browserLang.startsWith('zh') ? 'zh' : defaultLanguage
  }

  const [languageState, setLanguageState] = useState<Language>(getInitialLanguage)

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem(STORAGE_KEY, lang)
    invoke('set_language', { lang }).catch(() => {
      // Backend language is best-effort only.
    })
  }

  const t = (key: string, params?: Record<string, string | number>): string =>
    getTranslation(translations[languageState], key, params)

  useEffect(() => {
    document.documentElement.lang = languageState
    document.documentElement.dir = 'ltr'
  }, [languageState])

  return (
    <I18nContext.Provider value={{ language: languageState, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

// useI18n 为消费 Context 的 hook，与 Provider 同文件导出，
// 会触发 react-refresh 的"仅导出组件"检查，属合理例外，故行内豁免
// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextType {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
