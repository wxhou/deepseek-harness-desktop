import type { Lang } from './i18n'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Background } from './components/Background'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { ScreenshotPanel } from './components/ScreenshotPanel'
import { COPY } from './i18n'

// three.js 粒子背景懒加载分包：移动端与桌面端都渲染
// （移动端画布按视口等比缩小，见 whale-particles.tsx 容器类名）
const WhaleParticles = lazy(() =>
  import('./components/whale-particles').then(m => ({ default: m.WhaleParticles })),
)

/** 宣传落地页：单屏布局（hero 左列 + 产品截图右列），语言切换即时生效 */
export function App() {
  const [lang, setLang] = useState<Lang>('zh')
  const copy = COPY[lang]

  // 语言切换时同步 <html lang> 与标签页标题
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = copy.docTitle
  }, [copy.docTitle, lang])

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden text-white">
      <Background />
      <Suspense fallback={null}><WhaleParticles /></Suspense>
      <div className="relative z-10 flex flex-1 flex-col">
        <Header lang={lang} onLangChange={setLang} />
        <div className="mx-auto grid h-full w-[calc(100%-48px)] max-w-[1140px] items-center gap-10 pt-[50px] md:w-[calc(100%-144px)] lg:grid-cols-[minmax(0,0.86fr)_minmax(560px,1.14fr)] lg:gap-8 lg:w-[calc(100%-144px)] xl:w-[calc(100%-160px)] xl:max-w-[1280px]">
          <Hero copy={copy} />
          <ScreenshotPanel copy={copy} />
        </div>
      </div>
    </main>
  )
}
