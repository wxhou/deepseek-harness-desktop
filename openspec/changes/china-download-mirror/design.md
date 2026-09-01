# china-download-mirror — Design

## Context

现状与调研结论（动机见 proposal.md，契约见 specs/download-mirror/spec.md）：

- 站点已在 Cloudflare Pages（`dshdesktop.pages.dev`）运行，`promotional/functions/api/downloads.js` 已验证「Pages Function 服务端访问 GitHub + 边缘缓存」这条路在国内可达且稳定（下载计数功能线上运行中）。
- 下载侧现状：宣传页按钮直连 `github.com/.../releases/latest/download/`；App 内 dsh 包下载源链 = 官方直连 + `config::mirror_download_url()`（ghfast.top 前缀，DSH_MIRROR_PREFIX），且 digest 门控已有严谨实现（`update/install.rs download_sources`：仅可信 digest 存在时才追加镜像）。
- 行业调研（exa）：Qwen-code（OSS 镜像 + SHA 校验后发布清单）、dockit/BitFun（updater 双端点）、Comfy-Desktop（镜像回退 + 门控）、CrossPaste（自有 CDN 域名）共同模式 = **GitHub 权威源 + 自有可达通道 + 校验不减配**；公共镜像的公认反模式是硬编码单镜像。

## Goals / Non-Goals

**Goals:**

- 自有域名反代 GitHub Releases 资产（白名单、流式、Range、边缘缓存）。
- 宣传页与 App 内部下载统一接入该通道，作为官方直连后的首要回退。
- 安全模型零减配：digest 门控与校验逻辑一字不动。

**Non-Goals:**

- 不做多公益镜像 fallback 列表（ghfast.top 保留为代理之后的既有兜底，位置不变）。
- 不做 R2 存储镜像与发布 CI 同步（按需反代已满足量级，R2 引入存储成本与 CI 改动）。
- 不改宣传页版本固定文件名机制（仍由 Hero.tsx 常量管理，版本升级手动同步）。
- 不给 `*.pages.dev` 找自定义域名/ICP 备案（超出当前需要）。

## Decisions

**D1 — Pages Function 流式反代，而非 R2 镜像。**
R2 需要发布 CI 同步资产、管理存储生命周期、还有类操作计费；反代零成本、零 CI 改动、GitHub 保持唯一权威源（无副本漂移问题）。安装包 5–8 MB、请求量级小，免费额度（10 万请求/天）充足；现行 Cloudflare 服务条款无旧 §2.8 式的非 HTML 内容限制。备选 R2——部署重、收益不增（GitHub 对 CF 边缘始终可达），弃。

**D2 — 路由形态 `/dl/<owner>/<repo>/releases/download/<tag>/<asset>`，白名单校验前缀段。**
路径式（非 `?url=` 查询参数）便于边缘缓存键稳定、URL 语义清晰、且天然防开放代理（owner/repo 白名单 + 路径段校验）。实现上 `promotional/functions/dl/[[route]].js` 单文件 catch-all，解析后拼 `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>`（固定前缀拼接而非透传任意路径，杜绝路径穿越/协议混用）。白名单外 404。

**D3 — 缓存策略：上游 fetch 挂 `cf: { cacheTtl, cacheEverything }`，响应透传。**
版本化文件名不可变 → 缓存无失效问题；`cacheEverything` 对 Function 的 `fetch()` 生效，把 GitHub 302 链的最终响应缓存在请求边缘。`Range` 请求透传给上游（GitHub 支持 Range），不做本地 206 切片（边缘缓存与 Range 的组合交由 Cloudflare 平台处理，未命中时回源也正确）。响应头透传 `Content-Length`/`Content-Type`/`ETag`；追加 `Cache-Control: public, max-age=<与 cacheTtl 一致>` 便于客户端侧缓存。

**D4 — App 侧接入点为「源列表插桩」，复用 `mirror_download_url` 同型函数。**
新增 `config::proxy_download_url(url)`（拼 `https://dshdesktop.pages.dev/dl/` 前缀）源列表构造处统一插入：官方直连 → 自有代理 → ghfast.top。改动面集中在 `workflow/install.rs` 的 `urls` 构造与 `update/install.rs download_sources`；digest 门控条件（`release.digest.is_some()`）不动，代理与镜像同受其管。宣传页侧把 `RELEASE_BASE` 从 GitHub 换成 `${BASE_URL}dl/...`（保持版本固定文件名注释）。

## Risks / Trade-offs

- [`*.pages.dev` 国内可达性无 SLA，理论上有地区/时段波动] → 与 `/api/downloads` 同域名实证可行；ghfast.top 仍在其后兜底，失败面不比现状差。
- [反代被恶意刷流量（盗链）] → 白名单 + 仅两个仓库资产，可刷面积极小；免费额度内无成本。暂不加 referer 校验（会破坏直链/下载器体验），留观察项。
- [GitHub 大文件 302 后的边缘缓存行为差异] → `cacheEverything` 下 Cloudflare 会缓存最终响应；首次冷请求多一跳（CF 边缘→GitHub，境外链路），可接受。
- [代理域名硬编码进 Rust 二进制] → 与既有 DSH_MIRROR_PREFIX 同一模式；将来换域名走一次发版，可接受。

## Migration Plan

纯增量：新 Function 文件 + URL 常量替换/插入。回滚 = revert。验证：本地 `wrangler pages dev` 测 `/dl/` 白名单/Range/缓存头；线上部署后 curl 校验三个安装包直链与 206；App 侧用 `cargo test` 覆盖源列表顺序与 digest 门控不变性。

## Open Questions

无。