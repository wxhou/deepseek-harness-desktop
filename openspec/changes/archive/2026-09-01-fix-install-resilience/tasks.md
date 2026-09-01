## 1. Shim 失败降级与回退目录（P0）

- [x] 1.1 在 `plugin/install/mod.rs` 的 `cli::ensure_shims` 调用点包降级处理：失败时 `log::warn!` 输出含 bin 目录路径与修复指引（属主/权限命令）的消息并继续，验证 `cargo check` 通过
- [x] 1.2 在 `plugin/install/single.rs` 的同调用点应用相同降级，验证单插件升级/卸载路径不因 EACCES 整体失败（`cargo check`）
- [x] 1.3 实现应用私有回退 shim 目录：新增 bin_dir 不可写时的回退写入（复用 `write_shims` 模板 builder，Windows 含 `.cmd`/`.ps1` 变体）与「有效 shim 目录」选择函数，验证 `cargo check`
- [x] 1.4 `build_plugin_envs` 子进程 PATH 首位改用有效 shim 目录（标准 bin_dir 可写则用之，否则回退目录），验证 `cargo check`
- [x] 1.5 设置页 CLI 集成区域依 `CliLinkStatus.shim_exists` 呈现 degraded 状态与原因/指引文案，新增 i18n 平铺 key 并同步 `src/i18n/locales/en-US.json` / `zh-CN.json`，验证 `pnpm typecheck` 通过
- [x] 1.6 单元测试：模拟 `write_shims` 返回 SHIM_MKDIR_FAILED 时插件安装路径不返回 Err 且回退目录写入成功并进入子进程 PATH（`cargo test`）

## 2. 元数据先行：URL/digest 同源（P1）

- [x] 2.1 `workflow/install.rs`：把 digest 阶段的 `dsh_latest` 获取重试块（API → Atom → expanded_assets 兜底）整体搬到选 URL 之前；元数据成功后 URL 取其 `asset_url`（或 tag 位确定性推导），digest 同源取用，验证 `cargo check`
- [x] 2.2 删除下载后的元数据重试块，元数据彻底失败时以 `DSH_INTEGRITY_UNAVAILABLE` 提前返回且不发起下载，验证 `cargo check`
- [x] 2.3 单元测试：`dsh_latest == None` 且元数据解析失败时错误前缀为 `DSH_INTEGRITY_UNAVAILABLE`（下载未发起）；解析成功时构建的 URL 含 `releases/download/<tag>/` 段（`cargo test`）

## 3. Staging 清理（P2）

- [x] 3.1 实现 `.{leaf}.installing-*` 模式扫描清理函数：跳过当前 pid、用 `libc::kill(pid, 0)`（Unix）/ `OpenProcess`（Windows）探测其他 pid 存活后再删，在 `ensure_extract` 开头替换现有单目录清理，验证 `cargo check`
- [x] 3.2 解压主体包装 inner 函数：解压/flatten/commit 失败路径 best-effort 清理当前 staging（清理前 `log::warn!` 记录路径与原因），验证 `cargo check`
- [x] 3.3 单元测试：历史旧 pid 残留目录被清理、存活 pid 目录被跳过（`cargo test`）

## 4. 集成验证

- [x] 4.1 复刻 .docx 场景的 shim 失败验证：将 bin 目录置为不可写后启动应用，确认无致命错误界面、内部插件经回退目录正常安装、日志含 WARN 指引、设置页呈现 degraded
- [x] 4.2 复刻 URL/digest 竞态场景：模拟 API 限流（403）下安装，确认下载 URL 含 tag 段且校验通过；完全不可达时确认快速失败且无 40MB 残留
- [x] 4.3 `cargo check && cargo test`（src-tauri）与 `pnpm typecheck` 全量通过