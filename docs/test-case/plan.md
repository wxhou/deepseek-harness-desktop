# 测试计划（DeepSeek Harness 桌面版）

> 目标产品：DeepSeek Harness 桌面版（Tauri 2 外壳 + React 18 前端 + Rust 后端）
> 测试范围：全部核心功能
> 生成方式：基于等价类划分与边界值分析（见 `testcase-generator` skill）
> 输出目录：`docs/test-case/`

---

## 一、产品概述

桌面端一键运行 DeepSeek Harness（`dsh`）：首次启动自动装配内置 Node 运行时与 Harness 内核，无需用户安装 Node/pnpm/Docker；通过 Tauri 2 在 `127.0.0.1` 本地端口提供服务；包含核心多版本管理、档案隔离、插件管理、应用配置中心、命令行集成（`dsh` shim + PATH）、首次启动引导与桌面端自更新。纯本地运行、默认关闭遥测，中英双语界面、支持暗色模式。

## 二、测试策略

1. 以等价类划分法为主：对每个测试点（POINT）识别输入项的有效/无效等价类。
2. 以边界值分析法为辅：对范围型/长度型/枚举型输入覆盖临界值（离点、上点、内点）。
3. 一次测试只改变一个变量，其余输入保持有效值（正交干扰最小化）。
4. 测试数据必须具体、可验证；预期结果必须明确、可判定。

## 三、测试项（ITEM）与测试点（POINT）

> 目录映射：`docs/test-case/<ITEM 目录>/<POINT 文件>.md`
> 优先级：P1 核心正向 / P2 基本正向 / P3 核心异常 / P4 边界 / P5 低频

### ITEM 1：安装与首次启动（目录 `01-install`，风险：高）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 运行时与内核依赖安装 | 高 | 首次启动自动下载内置 Node 运行时与 Harness 内核；安装状态机（Initial→Installing→Running）；`install_dependencies` 返回 bool |
| 2 | 下载与解压进度 | 高 | 两阶段进度（下载 0–50、解压 50–100）；进度事件实时推送；失败重试（官方直连→ghfast.top 镜像兜底） |
| 3 | 本机 Node/Pnpm 复用 | 高 | 本机已有兼容 Node/pnpm 时直接复用，不修改系统环境；未检测到才走内置运行时 |
| 4 | 首次启动预设插件引导 | 高 | 预设清单（`resources/preset-plugins.json`）；`get_preinstall_plugins`/`install_preinstall_plugins`/`skip_preinstall_plugins`/`cancel_preinstall_plugins`/`get_preinstall_pending`/`open_preinstall_repo`；指纹（preset_hash）决定重新进入引导 |
| 5 | 安装失败与网络异常处理 | 高 | GitHub 不可达；下载/校验/解压失败；镜像兜底失败；提示与重试 |

### ITEM 2：Harness 核心管理（目录 `02-core`，风险：高）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 核心列表展示 | 高 | `get_cores`；本地核心（local）与预打包（app/app-<tag>）；同版本 tag 去重；离线/限流时降级磁盘扫描 |
| 2 | 激活核心切换 | 高 | `set_active_core`；local/app/app-<tag> 目录互换；切换前停服务；失败回滚 |
| 3 | 历史版本下载 | 高 | `download_core`（tag）；SHA-256 摘要校验（缺失安全中止）；幂等（已下载直接返回）；两阶段进度 |
| 4 | 历史版本卸载 | 中 | `remove_core`；激活中版本不可卸载；先停服务防句柄锁定；删除失败提示 |
| 5 | 本地核心更新 | 中 | `update_local_core`；npm/pnpm 布局探测；`@latest` 升级；失败返回输出尾部 |

### ITEM 3：进程生命周期与健康检查（目录 `03-lifecycle`，风险：高）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 服务启动 | 高 | `launch_harness`；`dsh --profile <当前档案> --host 127.0.0.1 --port <port>`；启动成功进入 Running |
| 2 | 服务停止与重启 | 高 | `shutdown_harness`/`restart_harness`；Windows 下 `taskkill /T /F` 杀进程树防 DLL 锁；重启后状态恢复 |
| 3 | 状态流转与健康检查 | 高 | `get_dsh_status`/`dsh-status-updated` 事件；Initial/Installing/Starting/Running/Stopped；定时健康检查与异常自愈 |

### ITEM 4：应用配置中心（目录 `04-config`，风险：中）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 配置对话框与管理 | 中 | `get_app_config`/`update_app_config`；调试/档案/插件/核心四个分页；字段校验与保存 |
| 2 | 语言与主题 | 中 | `set_language`（zh-CN/en）；`get_dsh_theme`（light/dark/system）；界面实时切换；i18n 扁平键 |
| 3 | 侧边栏与偏好设置 | 低 | `toggle_sidebar`；`auto_start`、`cli_link_enabled` 等开关 |
| 4 | 设置持久化 | 中 | `setting_updated` 事件；store 键（installed/port/active_profile/active_core/cli_link_enabled/preinstall_done/preset_hash/dsh_home_migrated/dsh_pkg_tag/dsh_pkg_commit） |

### ITEM 5：档案隔离管理（目录 `05-profile`，风险：高）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 档案列表与展示 | 中 | `get_profiles`；默认档案 web 置顶；稳定排序；空目录/未初始化回退 web |
| 2 | 新建档案 | 高 | `create_profile`（name）；名称规范化（小写、非字母数字转 `-`、去首尾 `-`）；空名/纯无效字符/>64 字符/保留名/重名；初始化官方形态（package.json/cordis.patch.yml/pnpm-workspace.yaml/.npmrc）；幂等 |
| 3 | 切换档案 | 中 | `set_active_profile`；目录不存在报错；持久化到 store；服务重启按新档案 |
| 4 | 删除档案 | 中 | `remove_profile`；默认档案不可删、使用中档案不可删、不存在报错；删除后目录移除 |
| 5 | 档案隔离性 | 高 | 各档案插件/补丁/设置相互独立；切换档案后互不影响 |

### ITEM 6：插件管理（目录 `06-plugin`，风险：高）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 已安装插件列表与监控 | 中 | `get_dsh_plugins` 只读展示；文件监控轮询；`dsh-plugins-updated` 事件 |
| 2 | 插件升级与卸载 | 中 | `update_dsh_plugin`/`remove_dsh_plugin`；异常时提供升级/卸载入口；错误详情实时同步 |
| 3 | 插件异常与恢复 | 中 | `report_plugin_error`/`detect_plugin_recovery`/`recover_plugin`；错误持久化；自动检测损坏并恢复 |
| 4 | 预装插件安装引导 | 高 | `install_preinstall_plugins`（`dsh plugin --profile <当前档案> add <pkg>`）；`preinstall-log` 实时日志；Windows 修复项（dsh-win-terminal-inspector）；取消/跳过 |

### ITEM 7：命令行集成（目录 `07-cli`，风险：中）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | dsh 命令链接状态 | 中 | `get_cli_link_status`；`cli_link_enabled` 开关；安装后自动注册 `dsh` 命令 |
| 2 | PATH 注册与 shim | 中 | Win `%LOCALAPPDATA%\deepseek-harness\bin`、Unix `~/.local/bin`；shim 文本纯英文；本地 Node 优先、pnpm 用户优先；安装跳过条件 |

### ITEM 8：端口与数据隔离（目录 `08-isolation`，风险：中）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 端口隔离 | 中 | release 3080 / debug 3081；`cfg!(debug_assertions)` 区分；避免争用 |
| 2 | 数据目录隔离 | 中 | `$DSH_HOME` 默认 `~/.dsh`（release）/`~/.dsh.dev`（debug）；store 文件 `.store.dat`/`.store.dev.dat`；debug 不迁移/不注册 PATH/不写 shim；`~/.dsh.dev/.harness.pid` 精确回收 |

### ITEM 9：隐私与本地化（目录 `09-privacy`，风险：中）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 纯本地与隐私默认 | 中 | 服务仅监听 `127.0.0.1`；profile/会话/设置留在本机；默认关闭遥测 |
| 2 | 中英双语与暗色模式 | 低 | `set_language` 切换中英文；暗色模式适配；dsh 界面主题与桌面端一致 |

### ITEM 10：桌面端自更新（目录 `10-updater`，风险：中）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 版本检查与更新 | 中 | 检查 GitHub 最新版；下载安装包；开发/生产构建端口与数据目录隔离；更新失败处理 |

### ITEM 11：系统集成与兼容（目录 `11-system`，风险：中）

| # | 测试点（POINT） | 风险 | 输入项/关注点 |
|---|--------------|------|--------------|
| 1 | 系统操作集成 | 中 | `open_in_browser`/`copy_service_url`/`reveal_in_folder`/`read_clipboard_image`/`get_runtime_info`/`proxy_health_check` |
| 2 | 跨平台兼容与 Windows 极简模式 | 中 | Windows（MSVC+WebView2）/macOS（Gatekeeper 放行）/Linux（WebKit2GTK）；`win_inspector` 写 profile patch 与极简 preset |

---

## 四、用例生成约定

- 每个 POINT 生成一个 `docs/test-case/<ITEM>/<POINT>.md`，内含 4–8 条用例（依据复杂度）。
- 用例格式（文本协议 v0.2）：

```markdown
## [P1] 验证<行为>
[测试类型] 功能
[前置条件] <分号分隔的必要条件>
[测试步骤] 1. <具体数据操作>。2. <具体数据操作>
[预期结果] 1. <可验证结果>。2. <可验证结果>
```

- 标题以「验证」开头；优先级 P1–P5；反向用例标题加 `[反向]`。
- 测试步骤与预期结果编号连续、数量一致。

---

## 五、产物

- `docs/test-case/plan.md` — 本测试计划
- `docs/test-case/{ITEM}/{POINT}.md` — 各测试点用例
- `docs/test-case/all_cases.md` — 全部用例汇总（按 ITEM/POINT 分组）
- `docs/test-case/质量报告.md` — 生成统计与覆盖率
