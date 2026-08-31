import type { Copy } from '../i18n'
import { AppleIcon, InfoIcon, WindowsIcon } from './icons'

// 下载地址：GitHub Release 资产直链（latest 模式，跟随最新 release）。
// 注意：资产文件名含版本号，版本升级后需同步更新。
const RELEASE_BASE = 'https://github.com/wxhou/deepseek-harness-desktop/releases/latest/download'
const DOWNLOAD_MAC_URL = `${RELEASE_BASE}/Deepseek.Harness.Desktop_0.10.0_aarch64.dmg`
const DOWNLOAD_MAC_INTEL_URL = `${RELEASE_BASE}/Deepseek.Harness.Desktop_0.10.0_x64.dmg`
const DOWNLOAD_WINDOWS_URL = `${RELEASE_BASE}/Deepseek.Harness.Desktop_0.10.0_x64-setup.exe`

/** 主视觉左列：标题、简介、免责声明、平台下载按钮 */
export function Hero(props: {
  copy: Copy
}) {
  return (
    <div className="relative z-10 -translate-y-4 lg:-translate-x-8 lg:-translate-y-7">
      <h1 className="max-w-[590px] text-[44px] font-medium leading-[1.12] text-white md:text-[56px] xl:text-[62px]">
        {props.copy.title}
      </h1>
      <p className="mt-6 max-w-[550px] text-[18px] font-normal leading-[1.55] text-white/55 md:mt-8 md:text-[20px]">
        {props.copy.productDesc}
      </p>
      <div className="mt-4 flex max-w-[550px] items-center gap-2 text-[13px] leading-5 text-white/45">
        <InfoIcon className="size-4 shrink-0 text-white/55" />
        <span>{props.copy.disclaimer}</span>
      </div>
      <div className="mt-6 flex flex-col gap-4 sm:flex-row md:mt-7">
        {/* 下载链接预留：见文件顶部 DOWNLOAD_*_URL */}
        <a
          href={DOWNLOAD_MAC_URL}
          className="flex h-[54px] w-fit items-center justify-center gap-2.5 whitespace-nowrap rounded-[14px] bg-white px-5 text-[15px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          <AppleIcon className="h-6 w-6 shrink-0" />
          {props.copy.downloadMac}
        </a>
        <a
          href={DOWNLOAD_MAC_INTEL_URL}
          className="flex h-[54px] w-fit items-center justify-center gap-2.5 whitespace-nowrap rounded-[14px] bg-white px-5 text-[15px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          <AppleIcon className="h-6 w-6 shrink-0" />
          {props.copy.downloadMacIntel}
        </a>
        <a
          href={DOWNLOAD_WINDOWS_URL}
          className="flex h-[54px] w-fit items-center justify-center gap-2.5 whitespace-nowrap rounded-[14px] bg-white px-5 text-[15px] font-semibold text-black transition-colors hover:bg-white/90"
        >
          <WindowsIcon className="h-6 w-6 shrink-0" />
          {props.copy.downloadWindows}
        </a>
      </div>
    </div>
  )
}