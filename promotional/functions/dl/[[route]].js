// Cloudflare Pages Function：GitHub Releases 资产流式反代（中国可达分发通道）
// 路由：/dl/<owner>/<repo>/releases/download/<tag>/<asset>
// 设计要点（openspec/changes/china-download-mirror）：
//   1. 白名单限域——仅代理两个源仓库，防止被滥用为开放代理；
//   2. 固定前缀拼接上游 URL（不透传原始路径），杜绝路径穿越/协议混用；
//   3. 流式转发响应体（不整文件缓冲），透传 Range 保留断点续传；
//   4. 资产文件名含版本号、内容不可变，可放心边缘缓存（cacheEverything）。
const ALLOWED_REPOS = new Set([
  'wxhou/deepseek-harness-desktop',
  'dsh-tauri-desk/deepseek-harness-pkg',
])

// 资产不可变 → 长缓存；与响应头 Cache-Control 保持一致
const CACHE_TTL = 86400

function notFound() {
  return new Response('Not Found', { status: 404 })
}

export async function onRequestGet(context) {
  const { params, request } = context
  const segments = params.route
  // 期望形状：[owner, repo, 'releases', 'download', tag, ...asset 段]
  if (!Array.isArray(segments) || segments.length < 6)
    return notFound()
  const [owner, repo, releases, download, tag] = segments
  if (releases !== 'releases' || download !== 'download')
    return notFound()
  if (!ALLOWED_REPOS.has(`${owner}/${repo}`))
    return notFound()

  // 逐段重新编码后再拼固定前缀：params 已被路由解码，重新编码可中和 `..`、
  // 额外斜杠等注入；asset 允许含 `/`（monorepo 内嵌路径的资产名）。
  const asset = segments.slice(5).map(encodeURIComponent).join('/')
  const upstream = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/download/${encodeURIComponent(tag)}/${asset}`

  const headers = { 'User-Agent': 'dshdesktop-promo' }
  const range = request.headers.get('range')
  if (range)
    headers.Range = range
  const upstreamRes = await fetch(upstream, {
    headers,
    redirect: 'follow',
    cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
  })
  // 上游 4xx/5xx（含 302 目标失效）按 404 对外，不泄露上游细节
  if (!upstreamRes.ok && upstreamRes.status !== 206)
    return notFound()

  const resHeaders = new Headers()
  for (const name of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified', 'accept-ranges']) {
    const value = upstreamRes.headers.get(name)
    if (value)
      resHeaders.set(name, value)
  }
  resHeaders.set('cache-control', `public, max-age=${CACHE_TTL}`)
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: resHeaders })
}
