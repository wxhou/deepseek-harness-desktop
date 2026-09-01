# download-mirror Delta

## Purpose

GitHub Releases 资产在中国大陆网络下的可达分发契约：通过自有 Cloudflare Pages 域名提供流式反向代理作为官方直连之后的首要回退源，宣传页与 App 内部下载统一经由该通道；反代以白名单限域防滥用、以边缘缓存加速重复下载、透传 Range 保留断点续传；完整性校验（SHA-256 digest 门控）不因引入镜像而弱化。

## ADDED Requirements

### Requirement: 自有域名反代 GitHub Releases 资产

站点 SHALL 在自有域名（Pages Function `/dl/*`）提供 GitHub release 资产的下载代理：仅代理白名单仓库（`wxhou/deepseek-harness-desktop`、`dsh-tauri-desk/deepseek-harness-pkg`）的 `releases/download` 路径，白名单之外的请求 MUST 返回 404；代理 SHALL 跟随 GitHub 的重定向并以流式方式转发响应体（不得整文件缓冲后转发），SHALL 透传 `Range` 请求头以保留断点续传。

#### Scenario: 白名单内资产可经代理下载
- **WHEN** 访客请求 `/dl/wxhou/deepseek-harness-desktop/releases/download/v0.10.0/Deepseek.Harness.Desktop_0.10.0_aarch64.dmg`
- **THEN** 代理返回该资产的完整内容（Content-Type/长度与 GitHub 一致），全程不依赖客户端可达 github.com

#### Scenario: Range 请求透传
- **WHEN** 客户端带 `Range: bytes=0-1048575` 请求代理
- **THEN** 代理返回 206 与对应字节区间，续传可用

#### Scenario: 白名单外请求拒绝
- **WHEN** 请求 `/dl/<其他仓库>/...` 或非 `releases/download` 路径
- **THEN** 返回 404，代理不被滥用为通用网关

### Requirement: 代理响应边缘缓存

对版本化（文件名含版本号、不可变）的资产，代理 SHALL 以边缘缓存（`cacheTtl`/`cacheEverything` 类选项）缓存上游响应，使重复下载命中 Cloudflare 边缘而非回源 GitHub；缓存键 SHALL 与资产路径一一对应，不存在跨版本串缓存的可能（版本化文件名天然隔离）。

#### Scenario: 重复下载命中边缘
- **WHEN** 同一资产已被代理过一次后，另一访客再次经代理请求该资产
- **THEN** 响应来自 Cloudflare 边缘缓存（不再回源 GitHub），内容与首次一致

### Requirement: 宣传页下载经自有代理

宣传页的平台下载入口（Mac/Windows 按钮）SHALL 指向自有代理地址（同域绝对地址，保证 release zip 等静态托管场景下按钮同样可用），MUST NOT 直连 github.com；下载入口的版本固定文件名规则（版本升级需同步更新）保持现状。

#### Scenario: 国内访客点击下载可用
- **WHEN** 中国大陆网络下的访客点击宣传页任一下载按钮
- **THEN** 浏览器向站点自有域名发起下载，不请求 github.com

### Requirement: App 下载源链插入自有代理（digest 门控不变）

App 内部对 dsh 包与桌面更新包的下载源列表 SHALL 在 GitHub 官方直连之后、公益镜像（ghfast.top）之前插入自有代理 URL；当存在可信 digest 时源列表扩展逻辑与现状一致，不存在可信 digest 时仍 MUST NOT 将不可校验的源（含自有代理）用于安装，完整性校验逻辑 MUST NOT 改变。

#### Scenario: 官方直连失败时代理兜底
- **WHEN** 官方 GitHub 直连下载失败且可信 digest 已知
- **THEN** 下一尝试源为自有代理，下载内容通过既有 SHA-256 校验后正常安装

#### Scenario: 无可信 digest 时不放开镜像源
- **WHEN** release 元数据完全不可得（无 digest）
- **THEN** 源列表保持官方直连（并按既有策略快速失败），不使用任何代理/镜像源绕过校验