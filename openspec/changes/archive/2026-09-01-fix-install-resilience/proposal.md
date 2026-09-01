# fix-install-resilience

## Why

一位 0.10.0 macOS 用户的排障日志（《环境信息.docx》）暴露了安装/启动管线中的三个叠加缺陷：磁盘满后残留在 `dependencies/.dsh.installing-<pid>` 的数据从未被清理；GitHub API 限流时 dsh 包下载 URL 用 `releases/latest/download/` 回退、digest 却来自 pinned tag，两者必然不一致导致 `INTEGRITY_CHECK_FAILED`；`~/.local/bin` 不可写（EACCES）时内部插件安装把 shim 写入失败硬传播成 `INTERNAL_PLUGIN_INSTALL_FAILED`，用户被永久困在启动失败重试循环里，且无任何可操作提示。

## What Changes

- **Shim 失败降级 + 回退目录**：插件安装/单插件操作路径上的 `cli::ensure_shims` 失败不再使启动致命失败——降级为带修复指引（`~/.local/bin` 属主/权限）的 WARN 继续安装；同时 bin 目录不可写时把 shim 写入 AppData 私有回退目录并优先供插件安装子进程的 PATH 解析（dsh 按名 `spawnSync("pnpm")`，PATH shim 是功能必需）；CLI 集成开关在设置页如实呈现 degraded 状态。
- **元数据先行（URL/digest 同源）**：dsh 包安装把 release 元数据解析（API → Atom → expanded_assets 现有兜底链）从下载之后移到选 URL 之前——URL 与 digest 恒同源于同一次解析；元数据彻底不可用时提前失败（`DSH_INTEGRITY_UNAVAILABLE`）且不再白白下载 40MB 后报误导性的 `INTEGRITY_CHECK_FAILED`。
- **孤儿 staging 清理**：下载/解压启动时按 `.{leaf}.installing-*` 模式清理历史残留（可校验归属 pid 不存活后再删，避免误删并发运行实例的目录）；当前运行解压失败时也清理自己的 staging。

## Capabilities

### New Capabilities

- `install-resilience`: 安装/启动管线对环境异常（bin 目录不可写、GitHub 限流、磁盘满）的容错要求：shim 失败降级不阻断启动且回退目录保障插件安装、dsh 包元数据先行解析使 URL 与校验 digest 恒同源、staging 临时目录无永久残留。

### Modified Capabilities

<!-- 无现有 spec（openspec/specs 为空），全部为新增。 -->

## Impact

- **代码**：`src-tauri/src/service/cli/`（ensure_shims 调用方容错）、`src-tauri/src/service/plugin/install/mod.rs` 与 `single.rs`（调用点）、`src-tauri/src/service/workflow/install.rs`（URL/digest 对齐）、`src-tauri/src/service/download/core.rs`（staging 清理常量与逻辑）。
- **行为影响**：启动成功率提升；单插件升级/卸载在 bin 目录不可写时不再整体失败；多实例并发下清理不会误伤。
- **风险**：降级后 shim 缺失时 `dsh`/`pnpm` 命令行集成不可用（GUI 功能不受影响），需在设置页可见；staging 清理需防止删除其他存活进程的目录。