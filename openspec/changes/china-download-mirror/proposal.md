# china-download-mirror

## Why

中国大陆网络访问 `github.com` 及其 Releases CDN（`objects.githubusercontent.com`）经常缓慢或不可达：宣传页三个下载按钮直连 GitHub，访客点击大概率卡死（与下载计数接口此前遇到的问题同源）；App 内部的 dsh 包与桌面更新包下载虽有 ghfast.top 公益镜像兜底，但单一公益镜像存在限速、换域名、停服的已知反模式，且其可用性不受我们控制。

## What Changes

- **Cloudflare Pages Function 流式反代**：在现有 Pages 项目（`promotional/functions/`）新增 `/dl/*` 路由，反向代理 GitHub Releases 资产下载——owner/repo 白名单限域（仅 `wxhou/deepseek-harness-desktop` 与 `dsh-tauri-desk/deepseek-harness-pkg`）、跟随 302 流式转发（不缓冲整文件）、透传 `Range`（断点续传）、利用版本化文件名不可变的特性做边缘缓存（`cf.cacheTtl` + `cacheEverything`）。
- **宣传页下载按钮切换自有代理**：`Hero.tsx` 三个下载常量改为 `/dl/` 链接（相对 `BASE_URL`），访客下载不再触碰 github.com。
- **App 下载源链插入自有代理**：Rust 侧 dsh 包安装下载与桌面更新包下载的源列表在 GitHub 官方直连之后、ghfast.top 之前插入自有代理 URL 常量；**digest 门控安全设计原样保留**（代理只是 URL 源，SHA-256 校验逻辑不变）。

## Capabilities

### New Capabilities

- `download-mirror`: GitHub Releases 资产的中国可达分发契约：自有域名反代（白名单限域、流式转发、Range 透传、边缘缓存）作为官方直连之后的首要回退源；宣传页与 App 内部下载统一经由该通道；完整性校验（digest 门控）不因引入镜像而弱化。

### Modified Capabilities

<!-- 无现有 spec，全部为新增。 -->

## Impact

- **代码**：`promotional/functions/dl/[[route]].js`（新增 Pages Function）、`promotional/src/components/Hero.tsx`（下载常量）、`src-tauri/src/config/`（代理 URL 常量）与 `src-tauri/src/service/workflow/install.rs` / `service/update/install.rs`（源列表插入）；代理 URL 构造复用既有 `config::mirror_download_url` 模式。
- **部署**：`npx wrangler pages deploy`（现有流程，functions 目录已随部署编译）；release zip 需按既有惯例同步重建上传。
- **行为影响**：国内访客下载成功率显著提升；App 下载失败面从「官方 + 单一公益镜像」收窄；不改变任何校验与安装逻辑。
- **风险**：`*.pages.dev` 国内可达性无 SLA（但 `/api/downloads` 已在同域名验证可行）；代理不缓存时冷启动首字节依赖 Cloudflare 边缘到 GitHub 的链路（境外,通常良好）。
- **Non-goal**：多公益镜像 fallback 列表（保留为后续可选增强）；R2 存储镜像（发布 CI 需改、有存储成本，收益不大于按需反代）。