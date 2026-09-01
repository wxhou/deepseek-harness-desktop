import type { Copy } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { formatCompact, useDownloadCount } from '../hooks/use-download-count'
import { AppleIcon, ChevronDownIcon, DownloadIcon, WindowsIcon } from './icons'

// 下载地址：经站点自有 Cloudflare 反代（functions/dl，中国可达）下载 GitHub Release
// 资产，不直连 github.com。用同域绝对地址而非相对路径：release zip 等静态托管场景下
// 按钮仍可用。资产文件名与 tag 均含版本号，版本升级后需同步更新 RELEASE_TAG 与文件名。
const RELEASE_TAG = 'v0.10.1'
const RELEASE_BASE = `https://dshdesktop.pages.dev/dl/wxhou/deepseek-harness-desktop/releases/download/${RELEASE_TAG}`
const DOWNLOAD_MAC_URL = `${RELEASE_BASE}/Deepseek.Harness.Desktop_0.10.1_aarch64.dmg`
const DOWNLOAD_MAC_INTEL_URL = `${RELEASE_BASE}/Deepseek.Harness.Desktop_0.10.1_x64.dmg`
const DOWNLOAD_WINDOWS_URL = `${RELEASE_BASE}/Deepseek.Harness.Desktop_0.10.1_x64-setup.exe`

/** 主视觉左列：标题、简介、免责声明、平台下载按钮（Mac 为架构选择下拉）与累计下载量 */
export function Hero(props: {
  copy: Copy
}) {
  const downloads = useDownloadCount()
  const [macMenuOpen, setMacMenuOpen] = useState(false)
  const macMenuRef = useRef<HTMLDivElement>(null)

  // 点击下拉外部任意区域关闭
  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (macMenuRef.current && !macMenuRef.current.contains(event.target as Node)) {
        setMacMenuOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  return (
    <div className="relative z-10 -translate-y-4 lg:-translate-x-8 lg:-translate-y-7">
      <h1 className="max-w-[590px] text-[44px] font-medium leading-[1.12] text-white md:text-[56px] xl:text-[62px]">
        {props.copy.title}
      </h1>
      <p className="mt-6 max-w-[550px] text-[18px] font-normal leading-[1.55] text-white/55 md:mt-8 md:text-[20px]">
        {props.copy.productDesc}
      </p>
      <div className="mt-6 flex flex-col gap-4 sm:flex-row md:mt-7">
        {/* 下载链接预留：见文件顶部 DOWNLOAD_*_URL */}
        <div ref={macMenuRef} className="relative w-fit">
          <button
            type="button"
            aria-expanded={macMenuOpen}
            onClick={() => setMacMenuOpen(open => !open)}
            className="flex h-[54px] w-fit items-center justify-center gap-2.5 whitespace-nowrap rounded-[14px] bg-white px-5 text-[15px] font-semibold text-black transition-colors hover:bg-white/90"
          >
            <AppleIcon className="h-6 w-6 shrink-0" />
            {props.copy.downloadMac}
            <ChevronDownIcon className={`h-4 w-4 shrink-0 transition-transform ${macMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          <If cond={macMenuOpen}>
            <div className="absolute left-0 top-[calc(100%+8px)] z-20 w-fit min-w-[220px] overflow-hidden rounded-[14px] bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
              <a
                href={DOWNLOAD_MAC_URL}
                onClick={() => setMacMenuOpen(false)}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-black/5"
              >
                <AppleIcon className="h-5 w-5 shrink-0 text-black" />
                <span className="flex flex-col">
                  <span className="text-[14px] font-semibold leading-5 text-black">{props.copy.macChipApple}</span>
                  <span className="text-[12px] leading-4 text-black/50">M1 / M2 / M3 / M4 · dmg</span>
                </span>
              </a>
              <a
                href={DOWNLOAD_MAC_INTEL_URL}
                onClick={() => setMacMenuOpen(false)}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-black/5"
              >
                <AppleIcon className="h-5 w-5 shrink-0 text-black" />
                <span className="flex flex-col">
                  <span className="text-[14px] font-semibold leading-5 text-black">{props.copy.macChipIntel}</span>
                  <span className="text-[12px] leading-4 text-black/50">Intel · dmg</span>
                </span>
              </a>
            </div>
          </If>
        </div>
        <a
          href={DOWNLOAD_WINDOWS_URL}
          className="flex h-[54px] w-fit items-center justify-center gap-2.5 whitespace-nowrap rounded-[14px] bg-white px-5 text-[15px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          <WindowsIcon className="h-6 w-6 shrink-0" />
          {props.copy.downloadWindows}
        </a>
      </div>
      {/* 累计下载量：接口未就绪时显示 '--' */}
      <div className="mt-4 flex w-fit items-center gap-2 text-[13px] text-white/45" aria-live="polite">
        <DownloadIcon className="size-4 text-white/55" />
        <span>
          {props.copy.totalDownloadsPrefix && <span className="mr-1">{props.copy.totalDownloadsPrefix}</span>}
          <span className="font-medium tabular-nums text-white/75">
            {downloads === null ? '--' : formatCompact(downloads)}
          </span>
          {props.copy.totalDownloadsSuffix && <span className="ml-1">{props.copy.totalDownloadsSuffix}</span>}
        </span>
      </div>
    </div>
  )
}
