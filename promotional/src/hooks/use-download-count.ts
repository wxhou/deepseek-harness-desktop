import { useEffect, useState } from 'react'

const RELEASES_API_URL = 'https://api.github.com/repos/wxhou/deepseek-harness-desktop/releases?per_page=100'

/** 数字缩写：12,340 → 12.3K；千位以内原样带分隔符 */
export function formatCompact(n: number): string {
  if (n >= 10000) {
    const k = n / 1000
    const text = k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, '')
    return `${text}K`
  }
  return n.toLocaleString('en-US')
}

/** 判断 release 资产是否为用户安装包（排除宣传页 zip 等非安装产物） */
function isInstaller(name: string): boolean {
  return /(?:dmg|exe|msi|AppImage|deb|rpm)$/i.test(name)
}

/** 客户端拉取所有 release 安装包的累计下载量；失败保持 null，由调用方显示 '--' */
export function useDownloadCount(): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch(RELEASES_API_URL, { signal: controller.signal })
      .then((res) => {
        if (!res.ok)
          throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((releases: Array<{ assets?: Array<{ name: string, download_count?: number }> }>) => {
        if (!Array.isArray(releases) || controller.signal.aborted)
          return
        const total = releases.reduce(
          (sum, release) =>
            sum
            + (release.assets ?? [])
              .filter(asset => isInstaller(asset.name))
              .reduce((s, asset) => s + (asset.download_count ?? 0), 0),
          0,
        )
        if (!controller.signal.aborted)
          setCount(total)
      })
      .catch(() => {
        // 静默失败（含卸载时 abort）：计数保持 '--'，不阻塞首屏
      })

    return () => {
      controller.abort()
    }
  }, [])

  return count
}
