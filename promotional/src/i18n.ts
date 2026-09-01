/** 站点语言：默认中文（与参考站一致），不持久化 */
export type Lang = 'zh' | 'en'

/** 单语文案词典；键按使用位置命名，双语一一对应 */
export interface Copy {
  productDesc: string
  downloadMac: string
  downloadWindows: string
  macChipApple: string
  macChipIntel: string
  latestVersionLabel: string
  totalDownloadsPrefix: string
  totalDownloadsSuffix: string
  appScreenshotAlt: string
  title: string
  docTitle: string
}

const zh: Copy = {
  productDesc: '在桌面上一键运行 DeepSeek Harness —— 无需 Node.js、无需 pnpm、无需 Docker，下载即用。',
  downloadMac: '下载 Mac 版',
  downloadWindows: '下载 Windows 版',
  macChipApple: 'Apple Silicon 芯片',
  macChipIntel: 'Intel 芯片',
  latestVersionLabel: '最新版本',
  totalDownloadsPrefix: '累计下载',
  totalDownloadsSuffix: '次',
  appScreenshotAlt: 'DeepSeek Harness Desktop 界面',
  title: 'DeepSeek Harness Desktop',
  docTitle: 'DeepSeek Harness Desktop｜DeepSeek Harness 桌面客户端',
}

const en: Copy = {
  productDesc: 'Run DeepSeek Harness on your desktop with one click — no Node.js, no pnpm, no Docker. Download and go.',
  downloadMac: 'Download for Mac',
  downloadWindows: 'Download for Windows',
  macChipApple: 'Apple Silicon',
  macChipIntel: 'Intel chip',
  latestVersionLabel: 'Latest version',
  totalDownloadsPrefix: '',
  totalDownloadsSuffix: 'total downloads',
  appScreenshotAlt: 'DeepSeek Harness Desktop interface',
  title: 'DeepSeek Harness Desktop',
  docTitle: 'DeepSeek Harness Desktop',
}

export const COPY: Record<Lang, Copy> = { zh, en }

export function isLang(value: unknown): value is Lang {
  return value === 'zh' || value === 'en'
}
