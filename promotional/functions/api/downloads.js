// Cloudflare Pages Function：服务端汇总 GitHub Release 安装包累计下载量
// 访客浏览器不直连 api.github.com（国内不可达 + 匿名限流 60 次/h/IP），
// 由函数在边缘拉取并缓存；上游失败时返回 count: null，前端显示 '--'
const GH_API = 'https://api.github.com/repos/wxhou/deepseek-harness-desktop/releases?per_page=100'

// 只统计用户安装包，排除宣传页 zip 等资产
const INSTALLER_RE = /(?:dmg|exe|msi|AppImage|deb|rpm)$/i

export async function onRequest() {
  try {
    const res = await fetch(GH_API, {
      headers: { 'User-Agent': 'dshdesktop-promo' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`)
    const releases = await res.json()
    const count = Array.isArray(releases)
      ? releases.reduce(
          (sum, release) =>
            sum
            + (release.assets ?? [])
              .filter(asset => INSTALLER_RE.test(asset.name))
              .reduce((s, asset) => s + (asset.download_count ?? 0), 0),
          0,
        )
      : 0
    return Response.json({ count }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
  }
  catch {
    return Response.json({ count: null }, { headers: { 'Cache-Control': 'public, max-age=300' } })
  }
}
