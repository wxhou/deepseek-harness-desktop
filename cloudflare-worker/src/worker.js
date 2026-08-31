// Cloudflare Worker：反向代理 GitHub Pages 上的宣传页
// 上游：https://wxhou.github.io/deepseek-harness-desktop/
// 站点是纯静态单页（相对路径资源），按原样转发 pathname 即可；
// 未命中的路径回退 index.html，支持 /#xxx 形式的分享链接与未来的路由扩展。
const UPSTREAM = 'https://wxhou.github.io/deepseek-harness-desktop'

// Worker 边缘缓存：首次回源后同节点后续请求直接命中，减少对 GitHub Pages 的依赖
const EDGE_CACHE_TTL = 86400

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    // 忽略 query（语言切换是客户端状态），仅按 pathname 匹配
    const path = url.pathname === '/' ? '/index.html' : url.pathname

    const cache = caches.default
    const cacheKey = new Request(`${url.origin}${path}`)
    let response = await cache.match(cacheKey)

    if (!response) {
      const upstream = await fetch(`${UPSTREAM}${path}`, {
        cf: { cacheEverything: false },
      })
      const target = upstream.ok
        ? upstream
        // 上游 404（如不带 .html 的深链）回退单页入口
        : await fetch(`${UPSTREAM}/index.html`)

      response = new Response(target.body, target)
      response.headers.set('Cache-Control', `public, max-age=${EDGE_CACHE_TTL}`)
      response.headers.set('X-Worker-Cache', 'MISS')
      ctx.waitUntil(cache.put(cacheKey, response.clone()))
    } else {
      response = new Response(response.body, response)
      response.headers.set('X-Worker-Cache', 'HIT')
    }

    return response
  },
}