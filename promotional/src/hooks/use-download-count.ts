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

/** GitHub Releases 数组 → 安装包累计下载量 */
function sumInstallerDownloads(releases: Array<{ assets?: Array<{ name: string, download_count?: number }> }>): number | null {
  if (!Array.isArray(releases))
    return null
  return releases.reduce(
    (sum, release) =>
      sum
      + (release.assets ?? [])
        .filter(asset => isInstaller(asset.name))
        .reduce((s, asset) => s + (asset.download_count ?? 0), 0),
    0,
  )
}

/**
 * 客户端拉取安装包累计下载量；失败保持 null，由调用方显示 '--'。
 * 优先请求站点自带的 /api/downloads（Pages Function 服务端汇总 + 边缘缓存，
 * 不受访客网络对 api.github.com 可达性/限流影响）；该接口只在 Cloudflare Pages
 * 部署上存在，本地 dev 与独立 zip 场景自动回退 GitHub API 直连。
 */
export function useDownloadCount(): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function fetchCount(url: string): Promise<number | null> {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as unknown
      // Pages Function 返回 { count }；GitHub API 直连返回 releases 数组
      if (Array.isArray(data))
        return sumInstallerDownloads(data)
      const payload = data as { count?: number | null }
      return typeof payload.count === 'number' ? payload.count : null
    }

    fetchCount(`${import.meta.env.BASE_URL}api/downloads`)
      .catch(() => fetchCount(RELEASES_API_URL))
      .then((value) => {
        if (!controller.signal.aborted && value !== null)
          setCount(value)
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
