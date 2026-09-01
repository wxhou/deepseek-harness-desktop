## 1. Pages Function 反代

- [x] 1.1 新增 `promotional/functions/dl/[[route]].js`：解析 `/dl/<owner>/<repo>/releases/download/<tag>/<asset>`，白名单（`wxhou/deepseek-harness-desktop`、`dsh-tauri-desk/deepseek-harness-pkg`）外返回 404；白名单内拼固定前缀 `https://github.com/...` 发起 `fetch`（`cf: { cacheTtl, cacheEverything }`），透传 `Range` 请求头与响应头（`Content-Length`/`Content-Type`/`ETag`）并流式返回 `res.body`，验证本地 `npx wrangler pages dev` 下直链下载 200、Range 请求 206、白名单外 404
- [x] 1.2 `pnpm -C promotional build && npx wrangler pages deploy dist` 部署后，线上 curl 验证三个安装包经 `/dl/` 全量可下、Range 206、白名单外 404，重复请求命中边缘缓存（响应头/耗时佐证）

## 2. 宣传页接入

- [x] 2.1 `promotional/src/components/Hero.tsx`：下载常量改为同域绝对反代地址 `https://dshdesktop.pages.dev/dl/wxhou/deepseek-harness-desktop/releases/download/<tag>/<asset>`（原「版本升级需同步更新文件名」注释同步改写为含 tag），验证 `pnpm -C promotional build` 通过
- [x] 2.2 部署后在大陆网络（或以代理域名可达性代替验证）点击三个下载按钮确认从站点域名下载；同步重建 release zip 并按既有惯例 `gh release upload --clobber`

## 3. App 源链接入

- [x] 3.1 `config` 新增自有代理前缀常量与 `proxy_download_url(url)`（拼 `/dl/` 路径，模式对齐 `mirror_download_url`），验证 `cargo check`
- [x] 3.2 `workflow/install.rs` dsh 任务的 `urls` 构造改为 官方直连 → 自有代理 → ghfast.top；`update/install.rs` `download_sources` 在官方直连后、镜像前插入自有代理（digest 门控条件原样保留），验证 `cargo check`
- [x] 3.3 单元测试：源列表顺序为 官方 → 代理 → 镜像；无可信 digest 时源列表仅含官方直连（`cargo test`）

## 4. 集成验证

- [ ] 4.1 端到端：屏蔽 github.com（模拟大陆网络）后经 App 完整安装 dsh 包，确认走自有代理源且 SHA-256 校验通过、安装成功
- [x] 4.2 `cargo check && cargo test`（src-tauri）与 `pnpm -C promotional build` 全量通过