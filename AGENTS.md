# AGENTS.md — 项目规范

DeepSeek Harness 桌面版（Tauri 2 + React 18）。内嵌运行 `http://127.0.0.1:3080` 的 Harness 界面。

## 技术栈与关键目录

- **前端**：React 18 + TS + Tailwind 4（无纯 CSS 文件），Vite 构建 (`src/`)
- **后端**：Rust / Tauri 2 (`src-tauri/src/`)
  - `bridge/cmd.rs`：Tauri 命令（定义后须在 `lib.rs` 的 `generate_handler!` 注册）
  - `config/`：常量、路径 (`runtime.rs`)、设置 (`setting.rs`)、i18n 与主题
  - `service/download/`：Node.js / Dsh / pnpm 下载解压（`Installable` trait）
  - `service/workflow/`：进程生命周期管理（Windows 无窗口启动：`win_spawn.rs`）
  - `service/cli/`：命令行集成（生成 `dsh` / `pnpm` shim 并注册 PATH）。内部划分：`mod.rs` 声明+导出、`shim.rs` 脚本内容生成、`path.rs` 路径计算/PATH 注册/用户 pnpm 探测、`core.rs` 对外接口（状态/启用/清理）
  - `service/scheduler/` + `task/`：健康检查与轮询

## 开发命令

```bash
pnpm install && pnpm dev    # 前端开发
pnpm typecheck              # 前端 TS 类型检查（改前端必跑）
pnpm tauri dev              # 桌面端全量调试
cargo check && cargo test   # Rust 编译检查与单测（src-tauri 下执行）

```

## 核心规范

1. **i18n**：禁用硬编码。文案需同步修改 `src/i18n/zh.ts`、`en.ts` 及 `types.ts`。
2. **注释**：统一使用中文。模块头用 `//!`，函数用 `///`（重点说明“为什么”）。
3. **错误与日志**：`Result<_, String>` 错误须包含大写前缀（如 `"NODE_NOT_FOUND: ..."`）；关键路径打 `log::*` 日志。
4. **设置持久化**：`Setting` 新增字段必须加 `#[serde(default...)]`，并在 `config/mod.rs` 导出。
5. **Windows 适配**：
* 拉子进程须设 `CREATE_NO_WINDOW (0x08000000)` 防止黑窗。
* 停止服务必须强杀**进程树**（`taskkill /T /F`），避免 DLL 锁死导致更新失败。
* 写 PATH（`HKCU\Environment\Path`）后需广播 `WM_SETTINGCHANGE`，提示用户新开终端生效。


6. **CLI shim (`service/cli`)**：
* 脚本位置：Win `%LOCALAPPDATA%\deepseek-harness\bin`，Unix `~/.local/bin`。
* 优先使用本地兼容 Node (v22.15+ / v23.8+ / v24+)，回退使用捆绑 Node。注意转义字符（`%` → `%%`，`'` → `''` 或 `'\''`）。
* **shim 文本必须全英文**：cmd/ps1 按系统代码页解析，中文注释会乱码成命令执行。
* **pnpm shim 用户优先**：先转发用户自装的 pnpm（`where pnpm` 遍历，跳过本 shim 目录、只收 `.cmd/.exe/.bat`），否则用捆绑 node 跑 `dependencies/pnpm/bin/pnpm.cjs`。cmd 里不要用 `findstr` 匹配路径（`\` 会被当正则转义）；块内变量判断用 for 变量（`%%~xp`）而非 `%VAR%`（解析时机陷阱）。
* 安装策略：`Pnpm::check_installed` = 捆绑已装 **或** PATH 有用户 pnpm（`cli::find_user_pnpm`）→ "有则跳过"，用户后续自装也优先。


7. **跨平台与测试**：
* Unix 专属代码加 `#[cfg_attr(windows, allow(dead_code))]`，跨平台测试代码加 `#[cfg_attr(all(not(windows), not(test)), allow(dead_code))]`。
* 单测写在模块内 `#[cfg(test)] mod tests`，受限环境测试要优雅跳过。


8. **依赖与文档**：不引入重型依赖，优先用现有的 `windows-sys`；README 保持极简且中英同步。

## 避坑要点

* **dsh 结构**：`dsh` CLI 为 Node 脚本（`dependencies/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`），命令行集成本质是 **shim + PATH**。pnpm 同样为 JS 发行（`dependencies/pnpm/bin/pnpm.cjs`，npm tarball `.tgz`，下载地址 `registry.npmjs.org/pnpm/-/pnpm-<version>.tgz`）。
* **AppData 结构**：`runtime/node.exe`、`dependencies/dsh/`、`dependencies/pnpm/`、`data/dsh` (DSH_HOME)、`logs/dsh-web.log`。
* **服务参数**：`node bin.js --profile web --host 127.0.0.1 --port <setting.port>`。安装完成后会自动调用 `cli::ensure` 初始化 CLI。
