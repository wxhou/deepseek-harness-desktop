import type { Lang } from '../i18n'

/** 顶部固定栏：仅右侧语言切换胶囊 */
export function Header(props: {
  lang: Lang
  onLangChange: (lang: Lang) => void
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 mx-auto w-[calc(100%-48px)] max-w-[1140px] pt-2 md:w-[calc(100%-144px)] lg:w-[calc(100%-144px)]">
      <div className="relative mx-auto flex h-[42px] items-center justify-end py-1">
        <div className="flex h-8 items-center rounded-full border border-white/[0.06] p-[3px]" aria-label="Language">
          {(['zh', 'en'] as const).map(lang => (
            <button
              key={lang}
              type="button"
              aria-pressed={props.lang === lang}
              onClick={() => props.onLangChange(lang)}
              className={`flex h-6 items-center justify-center rounded-full px-3 text-xs font-medium leading-[18px] transition-colors ${
                props.lang === lang
                  ? 'bg-white/25 text-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              {lang === 'zh' ? '中文' : 'EN'}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
