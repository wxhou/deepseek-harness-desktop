# install-resilience Delta

## Purpose

安装/启动管线对环境异常（bin 目录不可写、GitHub API 限流、磁盘空间不足导致的中断残留）的容错契约：shim 写入失败不阻断应用启动且回退目录保障插件安装、dsh 包 release 元数据先行解析使下载 URL 与校验 digest 恒定同源、下载 staging 临时目录不产生永久残留。

## ADDED Requirements

### Requirement: Shim 写入失败不阻断启动且回退目录保障插件安装

当 CLI shim 的标准 bin 目录不可创建或不可写（例如 `~/.local/bin` 属主为 root 导致 EACCES）时，系统 SHALL 遵循以下行为：

1. 插件安装（启动自愈路径）与单插件操作（升级/卸载）SHALL 容忍 shim 写入失败并以包含可操作修复指引的 WARN 记录（指引需指明 bin 目录路径与建议命令），应用启动 SHALL 继续完成且不呈现致命错误界面；
2. 为保障插件安装继续可用，系统 SHALL 将 shim 写入应用私有的回退目录（AppData 内，必定可写），并让插件安装子进程的 PATH 优先解析回退目录中的 shim（Windows 需含 `.cmd` 变体，供 dsh 以名称解析 pnpm）；
3. CLI 集成状态（设置页展示）SHALL 如实呈现 shim 未写入标准目录的 degraded 状态。

#### Scenario: bin 目录不可写时启动成功且插件可安装
- **WHEN** `~/.local/bin` 权限拒绝写入且内部插件需要安装
- **THEN** 应用正常启动（无致命错误界面），日志含含 bin 路径的 WARN 与修复指引

#### Scenario: 回退目录保障子进程解析
- **WHEN** 标准 bin 目录不可写且插件安装启动 `dsh plugin add` 子进程
- **THEN** 子进程 PATH 首位为回退目录，`pnpm` 经其解析成功，插件安装完成

#### Scenario: 设置页呈现 degraded 状态
- **WHEN** shim 写入失败后用户打开设置页的 CLI 集成区域
- **THEN** 状态显示命令行集成未就绪（含原因与修复指引），而 GUI 功能不受影响

### Requirement: 依赖包下载 URL 与 digest 同源（元数据先行）

内部依赖（dsh 包）的 release 元数据（tag、资产 URL、digest）SHALL 在发起下载之前解析完成：解析 SHALL 复用现有兜底链（GitHub API → Releases 页/Atom → expanded_assets HTML），成功后下载 URL 与校验 digest SHALL 同源于同一次解析结果。元数据经重试仍不可用时，系统 SHALL 以 `DSH_INTEGRITY_UNAVAILABLE` 提前失败并且 MUST NOT 发起未锚定元数据的下载（MUST NOT 回退 `releases/latest/download/` 等非锚定源）。

#### Scenario: API 限流但兜底链可用时校验一致
- **WHEN** GitHub API 被限流而 Atom/expanded_assets 兜底解析出 tag 与 digest
- **THEN** 下载 URL 为该 tag 的确定性地址，digest 校验与该 tag 的资产一致且通过

#### Scenario: 元数据完全不可用时快速失败且不浪费下载
- **WHEN** GitHub API、release 页面与 expanded_assets 解析全部失败
- **THEN** 安装以 `DSH_INTEGRITY_UNAVAILABLE` 提前失败，磁盘上无 40MB 级别的无意义下载残余

### Requirement: Staging 临时目录无永久残留

依赖解压的 staging 目录（`.dsh.installing-<pid>` 等模式）SHALL 在每次下载开始时清理同 leaf 的历史残留目录（含此前异常中断遗留的旧 pid 目录）；清理 MUST NOT 删除其他存活运行实例正在使用的 staging 目录。

#### Scenario: 崩溃残留被下次启动清理
- **WHEN** 上一次运行因磁盘满在 `.dsh.installing-67933` 留下残留且该 pid 已不存在
- **THEN** 新一轮安装启动时该目录被删除，磁盘空间被回收

#### Scenario: 不误删并发实例的 staging
- **WHEN** 另一个应用实例（pid 存活）正在使用其 staging 目录解压
- **THEN** 本次清理跳过该目录

#### Scenario: 解压失败时清理本次 staging
- **WHEN** 当前运行的解压中途失败（如再次磁盘满）
- **THEN** 当前 staging 目录在失败处理路径中被清理