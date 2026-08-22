# 测试问题清单：deepseek-harness-desktop

> 本清单面向 GitHub 项目管理（Issue / 任务拆分），用中文列出各测试级别的具体 Issue，
> 附测试类型优先级、依赖、覆盖目标与工作量估算（story point）。标签与优先级遵循
> `docs/testing/test-strategy.md` 约定的命名规范。

---

## 1. 测试级别 Issue 创建

### 1.1 测试策略 Issue

- [ ] **测试策略整体**：为本项目建立 ISTQB + ISO 25010 测试计划（见 `test-strategy.md`）。
  - 标签：`test-strategy`、`istqb`、`iso25010`、`quality-gates`
  - 估算：3 点

### 1.2 单元测试 Issue

- [ ] `config`（Rust）：`setting`/`runtime`/`region`/`format`/`window_state`/`utils` 的路径、端口、数据隔离逻辑单测。
- [ ] `service/download`（Rust）：`Installable` 特征、下载进度、解压、失败重试单测。
- [ ] `service/core`（Rust）：多版本核心的下载/切换/卸载与「全局 dsh 优先」逻辑单测。
- [ ] `service/profile`（Rust）：档案新建/切换/删除与隔离单测。
- [ ] `service/plugin`（Rust）：安装/升级/卸载、`preset` 加载、`recovery`、`installed`、`errors` 单测。
- [ ] `service/cli`（Rust）：`shim` 生成、`path` 注册、`core` 探测单测（含 `%`→`%%`、`'`→`'\''` 转义）。
- [ ] `service/update` / `service/workflow`（Rust）：自更新、进程生命周期、`status`、`utils` 单测。
- [ ] `task/scheduler`（Rust）：健康检查轮询逻辑单测。
- [ ] 前端 `utils`：`iframe-origin`、`logger`、`toast` 单测。
- [ ] 前端 `config/client`：`invoke` 封装与命令参数单测。
- 标签：`unit-test`、`backend-test`/`frontend-test`
- 估算：每组件 0.5–1 点

### 1.3 集成测试 Issue

- [ ] 前后端命令桥集成：`invoke` 命令 ↔ `bridge/*` 参数/返回值契约测试。
- [ ] 核心切换后服务重启集成：切换 → 进程终止 → 重启 → 健康检查就绪。
- [ ] 档案切换集成：切换 → 服务重启 → WebView 加载对应档案。
- [ ] 插件安装→升级→卸载全链路集成。
- [ ] CLI shim 安装后 → 新终端调用 `dsh` 可用性集成。
- [ ] 预设插件清单（`preset-plugins.json`）与安装/修复流程集成。
- 标签：`integration-test`、`backend-test`、`api-test`
- 估算：每接口 1–2 点

### 1.4 端到端测试 Issue（Playwright）

- [ ] **首次装配 E2E**：首启自动下载 Node + Harness 内核 → 内嵌 WebView 加载 `127.0.0.1:3080`。
- [ ] **安装状态机 E2E**：下载进度 → 解压 → 装配 → 就绪，含中断/重试。
- [ ] **配置对话框 E2E**：调试/档案/插件/核心各面板操作与保存。
- [ ] **侧边栏与 iframe E2E**：通过消息桥控制 dsh Web 界面。
- [ ] **更新 E2E**：桌面自更新与内核更新流程。
- 标签：`e2e-test`、`playwright`、`frontend-test`
- 估算：每工作流 2–3 点

### 1.5 性能测试 Issue

- [ ] 首次装配耗时测量（下载/解压/装配）。
- [ ] 内存占用与 CPU 空闲占用测量（较 Electron 基线）。
- [ ] 核心切换重启时间测量。
- 标签：`performance-test`
- 估算：每性能需求 3–5 点

### 1.6 安全测试 Issue

- [ ] `dsh` 本地代码执行能力的风险审查与提示验证。
- [ ] 插件来源白名单校验（仅允许预设清单/受信来源）。
- [ ] WebView 跨源通信与 iframe origin 校验。
- [ ] 配置文件/数据目录权限（`~/.dsh`/`~/.dsh.dev`）检查。
- 标签：`security-test`、`risk-based`
- 估算：每安全需求 2–4 点

### 1.7 可访问性测试 Issue

- [ ] WCAG 合规检查：键盘导航、焦点管理、对比度、暗色模式。
- [ ] 双语界面文案完整性与一致性。
- 标签：`accessibility-test`、`frontend-test`
- 估算：2 点

### 1.8 回归测试 Issue

- [ ] 内核/运行时版本升级后的全量回归。
- [ ] debug 构建热重启 / release 构建隔离回归。
- [ ] 修复关键缺陷后的确认测试（confirmation testing）。
- 标签：`regression-test`、`quality-gate`
- 估算：持续，按变更范围评估

---

## 2. 测试类型识别与优先级

| 优先级 | 范围 | 说明 |
| --- | --- | --- |
| **关键（Critical）** | 功能测试：首次装配、核心/档案切换、插件装卸、CLI、自更新 | 核心业务逻辑与用户主路径 |
| **高（High）** | 非功能：性能、可靠性、安全 | 对稳定性/可用性有重大影响 |
| **中（Medium）** | 结构测试：覆盖率目标、架构验证；可用性、可移植性 | 提升长期可维护性与体验 |
| **低（Low）** | 变更相关测试的低风险回归 | 按风险矩阵动态确定 |

---

## 3. 测试依赖文档

- [ ] **实现依赖**：E2E 与集成测试依赖对应后端任务完成（如装配、档案、插件）。
- [ ] **环境依赖**：需要三平台构建环境、断网/占用端口/磁盘满等模拟条件。
- [ ] **工具依赖**：`cargo tarpaulin`、Vitest coverage、Playwright 及对应浏览器内核安装。
- [ ] **跨团队依赖**：上游 `deepseek-harness-pkg` 发行版、GitHub 网络可达性、外部插件仓库。

---

## 4. 测试覆盖目标与度量

- [ ] **代码覆盖率**：关键路径行覆盖率 > 80%，分支覆盖率 > 90%。
- [ ] **功能覆盖率**：100% 验收标准被验证。
- [ ] **风险覆盖率**：100% 高风险场景被验证。
- [ ] **质量特性覆盖**：对每个适用 ISO 25010 特性给出验证方式（见 `test-strategy.md` 3.1）。

---

## 5. 任务级拆分与估算

### 5.1 测试实现任务

- [ ] 测试用例开发（Rust `#[cfg(test)]` / Vitest `*.test.ts`）。
- [ ] E2E 用例（Playwright Page Object Model、fixture、数据管理）。
- [ ] 测试环境搭建（三平台构建、模拟网络/端口/磁盘异常）。
- [ ] 测试数据准备（隔离档案、插件清单、断网/占用场景）。
- [ ] 测试自动化框架搭建（覆盖率聚合、CI 集成、报告）。

### 5.2 估算指南

| 任务类型 | 估算（story points） |
| --- | --- |
| 单元测试 | 0.5–1 点 / 组件 |
| 集成测试 | 1–2 点 / 接口 |
| E2E 测试 | 2–3 点 / 用户工作流 |
| 性能测试 | 3–5 点 / 性能需求 |
| 安全测试 | 2–4 点 / 安全需求 |

### 5.3 依赖与排序

- **顺序依赖**：E2E 依赖集成/单元通过；装配类 E2E 依赖下载/解压完成。
- **可并行**：单元测试可按模块（`config`/`download`/`plugin`/`cli`）并行开发；前端 `utils` 与后端独立。
- **关键路径**：首次装配 → 安装状态机 → 内核切换 → 档案切换 → 插件 → CLI → 自更新。
- **资源分配**：按团队技能（Rust/React/E2E）匹配；关键路径任务优先。

### 5.4 任务分配策略

- [ ] 技能匹配：后端逻辑归 Rust 成员，前端归 React 成员，E2E 归熟悉 Playwright 成员。
- [ ] 容量规划：平衡各成员负载，避免关键路径阻塞。
- [ ] 知识转移：资深与初级结对，覆盖高风险模块。
- [ ] 交叉培养：通过配置/插件/核心等关联任务培养整体视角。
