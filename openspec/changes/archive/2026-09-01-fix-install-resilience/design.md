# fix-install-resilience — Design

## Context

三个缺陷的现场与代码现状（动机见 proposal.md，行为契约见 specs/install-resilience/spec.md）：

1. **shim 硬依赖**：`cli::ensure_shims`（`service/cli/core.rs:75`）写 shim，bin 目录创建失败即 `SHIM_MKDIR_FAILED`。lifecycle 的 cli 集成路径已将其降为 WARN（最佳努力），但插件安装批量路径（`plugin/install/mod.rs:146`）与单插件操作路径（`plugin/install/single.rs:159`）用 `?` 上抛 → 被 `plugin/internal/mod.rs:603` 包装为 `INTERNAL_PLUGIN_INSTALL_FAILED` → 启动失败、前端重试死循环（实测 3 轮）。两处失败等级不一致是本设计要消掉的不一致。
2. **URL/digest 分叉**：`workflow/install.rs` 中 dsh 任务下载 URL 取 `dsh_latest.asset_url`，为空时 `unwrap_or(config::get_dsh_download_url()?)`——即 `releases/latest/download/`（latest，内容随上游新 release 漂移）；而 digest 解析路径带 3 次重试，最终从 pinned tag 的 release HTML 恢复。竞态窗口：URL 在元数据成功前确定，digest 在其后恢复。
3. **staging 残留**：`download/core.rs ensure_extract` 用 `.{leaf}.installing-{pid}`，启动时仅 `remove_path_if_exists(&staging)` 清当前 pid；解压中途失败（如 ENOSPC）也不清自己的 staging。实测 `.dsh.installing-67933` 跨三次运行残留。

可用现成设施：`config::get_dsh_download_url_for_tag(tag)`（runtime.rs:102，由 tag 确定性推导直链）、`dsh_core_base_url()`、metadata 兜底链（github.rs 的 API → Atom → expanded_assets）。

## Goals / Non-Goals

**Goals:**

- shim 写入失败对插件安装路径与单插件路径降级（WARN + 指引），不阻断启动；设置页如实呈现 degraded。
- 元数据先行：下载发起前完成 release 元数据解析（含兜底链），URL 与 digest 恒同源；解析彻底不可达时快速失败，不发起下载。
- staging 历史残留按模式清理且不误伤并发实例；当前运行失败时清自己的 staging。

**Non-Goals:**

- 不改变「dsh digest 必须可信（API/HTML 恢复）」的安全设计，不引入跳过校验的降级路径。
- 不做磁盘空间预检或 ENOSPC 用户引导（另一个问题域）。
- 不改动 shim 内容、PATH 注册逻辑与 `~/.local/bin` 位置的选型。
- 不处理上游 `latest` 与 pinned tag 版本差异本身（那是上游数据面问题，本设计只保证客户端不消费不一致组合）。

## Decisions

**D1 — 调用方降级 + 应用私有回退 shim 目录（组合方案）。**
`ensure_shims` 保持 `Result` 语义；在 `plugin/install/mod.rs` 与 `single.rs` 两个调用点包一层「失败 → `log::warn!`（含 bin 路径与修复指引）+ 继续」。**仅降级不够**（调研实证）：dsh CLI 源码（`plugin-9h8shc4d.js`）为 `spawnSync("pnpm", …)` 按名字经子进程 PATH 解析 pnpm（不认 `DSH_PNPM`，dsh 自身只报 ENOENT 127），而 PATH shim 文件只能由 `write_shims` 生成——bin_dir 写不进去时插件会静默装不上。因此 bin_dir 不可写时把同一套 shim 模板写到 AppData 私有回退目录（必定可写；Windows `dsh` 用 `shell:true`，需含 `.cmd` 变体），并让 `build_plugin_envs` 的子进程 PATH 首位使用「标准 bin_dir 可写则用之，否则回退目录」。备选：只用现有 shim API 加"长度"参数返回 bool——第二套 API 且不解决插件安装，弃。

**D2 — degraded 状态通过现有 `CliLinkStatus` 表达，不新增 store 字段。**（不变）

**D3 — 元数据先行：解析成功后再选 URL，失败提前退出（放弃原 pinned-tag 离线兜底设想）。**
把 install.rs 中 digest 阶段（下载完成后）的 `dsh_latest` 获取重试块整体搬到「选 URL 之前」：元数据解析成功（现有 API → Atom → expanded_assets 兜底链）→ URL 取其 `asset_url`（或 tag 位确定性推导）、digest 同源；解析彻底失败 → `DSH_INTEGRITY_UNAVAILABLE` 提前失败，不发起下载。**为什么不能用原设想（store 记录的 pinned tag 拼 URL）**：`set_dsh_pkg_tag` 只在 `ensure_extract` 成功后（install.rs:211→217）才持久化——.docx 场景 run 1 死在解压、run 2 时 store 里没有 tag；且完整 tag 含 build id（`dsh-0.1.1-rc.2-32485170079`），bundled 清单 `version-recommend.json` 只有版本号，离线不可推导。备选：①元数据不可达仍回退 `latest/download`——必然 digest mismatch（.docx run 2 的 40MB 白下，弃）；②跳过校验——违反「digest 必须可信」安全设计，弃。该方案与 github.rs:322 既有注释「URL 与摘要必须始终来自同一个 release」逐字对齐。Trade-off：GitHub 完全不可达时从「下载 40MB 后失败」变为「快速失败」——严格更优。

**D4 — staging 清理按 `.{leaf}.installing-*` glob 扫描，pid 存活检测防误删。**
在 `ensure_extract` 开头：扫描 `parent` 下匹配 `.{leaf}.installing-<n>` 的条目，跳过当前 pid；对其它 pid 用 `sysinfo`/平台接口探测存活，不存活才删（Unix 先读 /proc 不可用时退化为直接删——macOS/Linux 桌面场景单实例由 `.harness.pid` 守卫，误删风险可接受；Windows 用 OpenProcess）。新增依赖优先利用现有 `windows-sys`，避免引入重库。解压主体用 inner 函数包装：失败路径 best-effort `remove_path_if_exists(&staging)` 后再返回错误。

## Risks / Trade-offs

- [降级后 shim 缺失，`dsh`/`pnpm` 命令行不可用且用户无感] → WARN 指引 + 设置页 degraded 展示 + 插件安装继续（插件运行不依赖宿主 PATH shim，pnpm 由捆绑路径解析）。
- [pid 复用导致旧 staging 未清理] → 概率极低（pid 重新分配到旧目录场景罕见）；下下次启动仍会再试，非永久失败。
- [元数据解析出的 release 资产已被上游删除 → 下载 404] → 失败快速且错误明确（此时 digest 同样不可得，元数据先行会提前失败），不劣化；镜像兜底仍在。
- [解压失败清理可能掩盖取证信息] → 清理前 `log::warn!` 记录 staging 路径与失败原因（错误信息本身已含文件路径）。

## Migration Plan

纯代码行为修正，无数据迁移。回滚 = revert 提交。验证单元测试：元数据先行时序（给定 dsh_latest None 时先解析后下载、失败不下载）、staging 清理含存活 pid 跳过；集成验证复刻 .docx 场景（chmod 000 ~/.local/bin 或以 root 属主模拟）。

## Open Questions

无。