//! 预装插件：首次启动引导安装官方推荐插件（当前为 DSH Market）。
//!
//! 安装通过 `dsh plugin --profile web add <pkg>` 完成：该子命令是 pnpm 转发器，
//! 会在 `$DSH_HOME/profiles/web` 初始化 profile 并执行 `pnpm add`，随后把声明了
//! `dsh.bundle` 的依赖写入 profile 的 bundles 层，使插件在下次启动时加载。
//! 进程输出逐行通过 `preinstall-log` 事件实时推送给前端日志面板。
//! 调用 dsh 前会先按需补齐捆绑 pnpm（老版本升级后可能缺失，见 [`ensure_pnpm`]）。
//!
//! 新增预装插件只需往 [`PREINSTALL`] 静态清单追加一项，界面与安装逻辑自动生效。

use crate::config;
use crate::service::cli;
use crate::service::download;
use crate::service::download::Installable;
use crate::service::workflow;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
#[cfg(not(windows))]
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// Windows 进程句柄包装：原始句柄是 `*mut c_void`（非 Send），
/// 但 `WaitForSingleObject`/`GetExitCodeProcess` 均为线程安全的系统调用，
/// 包一层以安全地移入 `spawn_blocking` 等待进程退出。
#[cfg(windows)]
struct WaitableHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for WaitableHandle {}

/// 预装插件安装到的 profile（与 dsh 服务启动的 profile 一致）
const PREINSTALL_PROFILE: &str = "web";

/// 前端监听的控制台事件名（进程输出行）
const PREINSTALL_LOG_EVENT: &str = "preinstall-log";

/// 预装插件静态清单：以后新增预装插件在此追加，界面与安装逻辑自动渲染。
/// `spec` 为传给 `dsh plugin add` 的包名/依赖形式（npm 包名或 git 依赖形式）；
/// `id` 是前端主键与仓库跳转查找用（与 spec 不同：id 必须是合法的 npm 依赖名，
/// 而 git 依赖的主键是包内的 name 字段，二者可能不一致）。
const PREINSTALL: &[PreinstallPluginInfo] = &[
     // Windows 极简模式修复（issue #12）：注入 win32 terminal inspector。
    // 仅 Windows 用户可见；chip 显示为黄色「修复」并默认勾选；确认后走
    // `dsh plugin add` 从 GitHub 安装（插件代码不随桌面端仓库内置），随后由
    // win_inspector::apply 写入 profile patch 行并创作 minimal-win 用户 preset。
    PreinstallPluginInfo {
        id: "dsh-win-terminal-inspector",
        spec: "github:clearkurt/dsh-win-terminal-inspector",
        name: "Windows Terminal Inspector",
        description:
            "Fix Minimal mode on Windows: injects the win32 ProcessInspector that persistent shells require (upstream throws `terminal inspection is unsupported on platform win32`). · 修复 Windows 极简模式：注入 persistent shell 必需的 win32 进程监视（上游在 win32 上直接抛错）。",
        repo_url: "https://github.com/clearkurt/dsh-win-terminal-inspector",
        recommended: false,
        fix: true,
        win_only: true,
    },
    PreinstallPluginInfo {
        id: "dshmarket",
        spec: "dshmarket",
        name: "DSH Market",
        description:
            "Visual plugin market inside DeepSeek Harness — browse, search, and one-click install community plugins. · DSH 可视化插件市场：逛一逛，点一下，装好。",
        repo_url: "https://github.com/dsh-market/dsh-market",
        recommended: true,
        fix: false,
        win_only: false,
    },
];

/// 预装插件静态信息（不含运行时检测的 installed 状态）
struct PreinstallPluginInfo {
    /// 前端主键 / 仓库跳转查找键
    id: &'static str,
    /// 传给 `dsh plugin add` 的依赖形式（npm 包名或 git 依赖形式）
    spec: &'static str,
    name: &'static str,
    description: &'static str,
    repo_url: &'static str,
    /// 绿色「推荐」chip，默认勾选（普通推荐插件）
    recommended: bool,
    /// 黄色「修复」chip，默认勾选（Windows 极简模式修复项）
    fix: bool,
    /// 仅 Windows 平台列出
    win_only: bool,
}

/// 预装插件列表项（含已安装检测结果），序列化给前端
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreinstallPlugin {
    pub id: String,
    pub name: String,
    pub description: String,
    pub repo_url: String,
    pub recommended: bool,
    /// 是否为「修复」类项（前端渲染黄色 chip，默认勾选）
    pub fix: bool,
    pub installed: bool,
}

/// 进程输出行事件载荷
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreinstallLogPayload {
    pub line: String,
}

/// id 是否属于预装清单（安装与打开仓库前均需校验，避免执行任意包名）
pub fn is_known_id(id: &str) -> bool {
    PREINSTALL.iter().any(|p| p.id == id)
}

/// 预装清单中某 id 对应的仓库地址
pub fn repo_url_of(id: &str) -> Option<&'static str> {
    PREINSTALL.iter().find(|p| p.id == id).map(|p| p.repo_url)
}

/// 预装清单中某 id 对应的安装依赖形式（npm 包名或 git 依赖形式）
fn spec_of(id: &str) -> Option<&'static str> {
    PREINSTALL.iter().find(|p| p.id == id).map(|p| p.spec)
}

/// 预装插件所在的 profile 目录（$DSH_HOME/profiles/web）
fn profile_dir(app_handle: &AppHandle) -> PathBuf {
    config::get_dsh_data_path(app_handle)
        .join("profiles")
        .join(PREINSTALL_PROFILE)
}

/// 已安装的插件 id 集合：读取 profile 清单的 `dependencies` 键与 `bundles` 列表。
/// profile 尚未初始化（未安装过任何插件）时视为空集合。
fn list_installed(app_handle: &AppHandle) -> HashSet<String> {
    let manifest_path = profile_dir(app_handle).join("package.json");
    let Ok(content) = std::fs::read_to_string(&manifest_path) else {
        return HashSet::new();
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) else {
        return HashSet::new();
    };
    let mut set = HashSet::new();
    if let Some(deps) = manifest
        .get("dependencies")
        .and_then(serde_json::Value::as_object)
    {
        set.extend(deps.keys().cloned());
    }
    if let Some(bundles) = manifest
        .get("dsh")
        .and_then(|v| v.get("profile"))
        .and_then(|v| v.get("bundles"))
        .and_then(serde_json::Value::as_array)
    {
        for item in bundles {
            if let Some(name) = item.as_str() {
                set.insert(name.to_string());
            }
        }
    }
    set
}

/// 预装插件列表（含 installed 状态），前端渲染用。
/// `win_only` 项仅在 Windows 平台列出（如 Windows 极简模式修复）。
pub fn list(app_handle: &AppHandle) -> Vec<PreinstallPlugin> {
    let installed = list_installed(app_handle);
    let is_windows = cfg!(windows);
    PREINSTALL
        .iter()
        .filter(|p| !p.win_only || is_windows)
        .map(|p| PreinstallPlugin {
            id: p.id.to_string(),
            name: p.name.to_string(),
            description: p.description.to_string(),
            repo_url: p.repo_url.to_string(),
            recommended: p.recommended,
            fix: p.fix,
            installed: installed.contains(p.id),
        })
        .collect()
}

/// 校验并安装选中的预装插件：`dsh plugin --profile web add <ids...>`，
/// 进程输出逐行通过 `preinstall-log` 事件转发给前端日志面板。
pub async fn install(app_handle: &AppHandle, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Err("PREINSTALL_EMPTY: no plugins selected".to_string());
    }
    for id in ids {
        if !is_known_id(id) {
            return Err(format!("PREINSTALL_INVALID_ID: {id}"));
        }
    }
    // 确保 pnpm/dsh shim 存在（只落盘文件、不注册用户 PATH），
    // 让 dsh plugin 内部转发的 `pnpm` 在子进程 PATH 中可解析。
    cli::ensure_shims(app_handle)?;

    let node = config::get_node_binary_path(app_handle);
    let dsh_bin = config::get_dsh_binary_path(app_handle);
    if !node.exists() {
        return Err("NODE_NOT_FOUND: Node.js runtime missing".to_string());
    }
    if !dsh_bin.exists() {
        return Err("HARNESS_NOT_FOUND: dsh CLI missing".to_string());
    }

    let window = app_handle
        .get_webview_window("main")
        .ok_or("WINDOW_NOT_FOUND: main window missing")?;

    // 老版本升级场景自愈（issue #15）：升级后 `installed` 已为 true，首启的
    // 环境安装流程会被跳过，而 v0.3.0 新增的捆绑 pnpm 从未落盘；`dsh plugin
    // add` 内部经 pnpm 拉取依赖，缺 pnpm 时预装插件必然失败（pnpm shim 直接
    // 报 `[pnpm] pnpm not found ...` 并退出码 1）。这里在调用 dsh 前按需补齐
    // 捆绑 pnpm（用户 PATH 已有 pnpm 时跳过）；node/dsh 缺失时走上方明确报错，
    // 由正常安装流程自愈。
    ensure_pnpm(app_handle, &window).await?;

    // 新增/变更 bundle 需要服务重启才会加载：安装前先停掉正在运行的服务，
    // 后续 launch 会以全新进程加载新插件（首次安装场景服务尚未启动，跳过）。
    if workflow::utils::is_dsh_running(config::get_store_dat_setting(app_handle).port).await {
        log::info!("Stopping running harness service before installing preinstall plugins");
        if let Err(e) = workflow::stop(app_handle.clone()).await {
            log::warn!("failed to stop harness before preinstall: {e}");
        }
    }

    // 子进程环境：DSH_HOME 指向应用数据目录，PATH 前置 shim 与 node 目录，
    // 关闭颜色输出让日志面板保持纯文本。
    let bin_dir = cli::get_bin_dir(app_handle);
    let mut envs: HashMap<String, String> = HashMap::new();
    envs.insert(
        "DSH_HOME".to_string(),
        config::get_dsh_data_path(app_handle)
            .to_string_lossy()
            .into_owned(),
    );
    envs.insert("DSH_TELEMETRY_DISABLED".to_string(), "1".to_string());
    envs.insert("NO_COLOR".to_string(), "1".to_string());
    let mut paths = vec![bin_dir];
    if let Some(node_dir) = node.parent() {
        paths.push(node_dir.to_path_buf());
    }
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    if let Ok(joined) = std::env::join_paths(paths) {
        envs.insert("PATH".to_string(), joined.to_string_lossy().into_owned());
    }

    // 命令：`node <dsh_bin.js> plugin --profile web add <specs...>`
    // 注意脚本路径必须是第一个参数（node 会把首个非选项参数当作脚本加载，
    // 漏掉它会出现 `Cannot find module '.../dependencies/dsh/plugin'`）。
    // 传给 dsh 的是依赖形式（spec）而非 id：git 依赖形式（github:owner/repo）
    // 通过 pnpm 安装，主键是包内 name 字段，可能与界面 id 不一致。
    let mut args: Vec<OsString> = vec![dsh_bin.as_os_str().to_os_string()];
    args.extend([
        OsString::from("plugin"),
        OsString::from("--profile"),
        OsString::from(PREINSTALL_PROFILE),
        OsString::from("add"),
    ]);
    args.extend(
        ids.iter()
            .map(|id| spec_of(id).ok_or_else(|| format!("PREINSTALL_INVALID_ID: {id}")))
            .collect::<Result<Vec<_>, String>>()?
            .iter()
            .map(OsString::from),
    );

    let cwd = config::get_dsh_install_path(app_handle);
    log::info!("Running dsh plugin install for {ids:?}");

    let exit_code = run_plugin_process(&node, &args, &cwd, &envs, &window).await?;
    if exit_code != 0 {
        log::error!("dsh plugin install failed with exit code {exit_code}");
        return Err(format!(
            "PREINSTALL_FAILED: dsh plugin exited with code {exit_code}"
        ));
    }

    // Windows 极简模式修复：插件已装入 profile 后，写入 patch 行挂载
    // win32 inspector，并创作 minimal-win 用户 preset（Git Bash）。
    if ids.iter().any(|id| id == "dsh-win-terminal-inspector") {
        if let Err(e) = workflow::win_inspector::apply(app_handle) {
            log::warn!("win inspector apply failed after install: {e}");
        }
    }

    log::info!("Preinstall plugins installed successfully: {ids:?}");
    Ok(())
}

/// 确保捆绑 pnpm 已安装：缺失时下载并解压到 `dependencies/pnpm`。
///
/// 供 [`install`] 在 `dsh plugin add` 之前调用——dsh 的 plugin 子命令内部会
/// 转发 pnpm 拉取依赖。`Pnpm::check_installed` 已实现"用户 PATH 已有 pnpm 则
/// 视为已安装"的语义，与 pnpm shim 的"用户优先"策略保持一致；下载/解压期间
/// 通过 `preinstall-log` 事件转发提示行，让预装日志面板对用户可见（pnpm 为
/// 纯 JS 发行包，体积小，正常秒级完成）。
async fn ensure_pnpm(app_handle: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    if download::Pnpm.check_installed(app_handle) {
        return Ok(());
    }

    let _ = window.emit(
        PREINSTALL_LOG_EVENT,
        PreinstallLogPayload {
            line: "[pnpm] bundled pnpm not found, downloading before plugin install".to_string(),
        },
    );

    // 2 个阶段：下载 + 解压。ProgressTracker 对外发 `install-progress` 事件
    // （主安装界面监听，预装面板不监听、无害忽略），提示行走 preinstall-log。
    let tracker = download::ProgressTracker::new(window, 2);
    let url = download::Pnpm.get_download_url()?;
    let name = url.split('/').next_back().unwrap_or(&url).to_string();
    let buffer = download::download_file(&tracker, url)
        .await
        .map_err(|e| format!("PNPM_DOWNLOAD_FAILED: {e}"))?;
    let dest = download::Pnpm.get_install_path(app_handle);
    download::ensure_extract(&tracker, name, buffer, dest)
        .map_err(|e| format!("PNPM_EXTRACT_FAILED: {e}"))?;

    let _ = window.emit(
        PREINSTALL_LOG_EVENT,
        PreinstallLogPayload {
            line: "[pnpm] bundled pnpm ready".to_string(),
        },
    );
    Ok(())
}

/// 取消正在进行的预装插件安装：强制结束 dsh plugin 进程树。
///
/// `dsh plugin add` 会经 pnpm 拉取依赖，网络抖动/GitHub 限流（429）时可能长时间
/// 卡在重试；给用户取消入口，避免一直等待。通过 Windows CIM 匹配“正在跑
/// `plugin ... add` 的 node 进程”并整树强杀（subprocess 派生的 git / pnpm 会一起
/// 结束；taskkill /T 也能避免 DLL 驻留）。仅在 Windows 有意义，非 Windows 无操作。
pub async fn cancel(app_handle: &AppHandle) {
    // 仅预装场景需要取消；非 Windows 直接返回
    if !cfg!(windows) {
        return;
    }

    let window = match app_handle.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    #[cfg(windows)]
    {
        // 结束占用中/等待中的 dsh plugin add 进程树（匹配命令行里的 add 意图，
        // 避免误杀无关 node 进程；executable 限定在 dsh 打包目录下）。
        let base = crate::config::get_dsh_install_path(app_handle)
            .to_string_lossy()
            .replace('\\', "\\\\");
        let ps_cmd = format!(
            "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object {{ ($_.CommandLine -like '*plugin*--profile*web*add*') -and ($_.ExecutablePath -like '{base}\\*') }} | ForEach-Object {{ taskkill /PID $_.ProcessId /T /F 2>$null }}"
        );

        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &ps_cmd,
        ]);
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::null());

        if let Err(e) = cmd.output() {
            log::warn!("failed to run preinstall cancel: {e}");
        }
    }

    // 通知前端安装已被取消，回到可重试的选择态
    let _ = window.emit(
        preinstall_cancel_event(),
        PreinstallCancelPayload {},
    );
}

/// 前端监听“安装已取消”事件名
fn preinstall_cancel_event() -> &'static str {
    "preinstall-cancelled"
}

/// 取消事件载荷（预留扩展字段）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreinstallCancelPayload {}

/// 启动 `dsh plugin` 进程并等待结束，返回退出码；输出实时转发事件。
async fn run_plugin_process(
    node: &std::path::Path,
    args: &[OsString],
    cwd: &std::path::Path,
    envs: &HashMap<String, String>,
    window: &WebviewWindow,
) -> Result<i32, String> {
    #[cfg(windows)]
    {
        let (stdout, stderr, handle) =
            workflow::win_spawn::spawn_with_hidden_console_tracked(node, args, Some(cwd), envs)
                .map_err(|e| format!("PREINSTALL_SPAWN: {e}"))?;
        spawn_line_emitter(Box::new(stdout), window.clone());
        spawn_line_emitter(Box::new(stderr), window.clone());

        let handle = WaitableHandle(handle);
        let exit_code = tauri::async_runtime::spawn_blocking(move || {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Threading::{
                GetExitCodeProcess, WaitForSingleObject, INFINITE,
            };
            // 整体 move 包装结构（而非其字段），确保闭包按包装类型捕获（Send）
            let handle = handle;
            unsafe {
                let wait = WaitForSingleObject(handle.0, INFINITE);
                let mut code: u32 = 0;
                if GetExitCodeProcess(handle.0, &mut code) == 0 {
                    code = wait;
                }
                CloseHandle(handle.0);
                code as i32
            }
        })
        .await
        .map_err(|e| format!("PREINSTALL_WAIT: {e}"))?;

        // 读取线程会在进程及其后代关闭管道写端后读到 EOF，稍等片刻避免遗漏尾部日志
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        Ok(exit_code)
    }

    #[cfg(not(windows))]
    {
        let mut child = Command::new(node)
            .args(args)
            .envs(envs)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("PREINSTALL_SPAWN: {e}"))?;
        if let Some(stdout) = child.stdout.take() {
            spawn_line_emitter(Box::new(stdout), window.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_line_emitter(Box::new(stderr), window.clone());
        }

        let exit_code = tauri::async_runtime::spawn_blocking(move || {
            let status = child
                .wait()
                .ok()
                .map(|s| s.code().unwrap_or(1))
                .unwrap_or(1);
            status
        })
        .await
        .map_err(|e| format!("PREINSTALL_WAIT: {e}"))?;

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        Ok(exit_code)
    }
}

/// 在独立线程中逐行读取进程输出并通过 `preinstall-log` 事件转发。
/// `std::process` 的 stdout/stderr 读取端实现了 `Read + Send`，
/// 两种平台实现（File / ChildStdout）统一装箱处理。
fn spawn_line_emitter(reader: Box<dyn Read + Send>, window: WebviewWindow) {
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines() {
            let Ok(line) = line else { break };
            let _ = window.emit(
                PREINSTALL_LOG_EVENT,
                PreinstallLogPayload {
                    line: line.trim_end().to_string(),
                },
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_list_contains_dshmarket() {
        assert!(is_known_id("dshmarket"));
        assert_eq!(
            repo_url_of("dshmarket"),
            Some("https://github.com/dsh-market/dsh-market")
        );
        assert!(!is_known_id("unknown-package"));
    }

    #[test]
    fn list_installed_parses_manifest() {
        // 构造临时 profile 清单并校验依赖/bundles 解析
        let dir = std::env::temp_dir().join(format!("dsh-plugin-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let manifest = serde_json::json!({
            "name": "dsh-profile-web",
            "private": true,
            "dependencies": {
                "dshmarket": "1.0.0",
                "@deepseek-ai/dsh-base": "1.0.0"
            },
            "dsh": {
                "profile": {
                    "bundles": ["@deepseek-ai/dsh-base", "dshmarket"]
                }
            }
        });
        std::fs::write(
            dir.join("package.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        // 直接调用内部解析逻辑（list_installed 依赖 AppHandle，仅测解析函数）
        let content = std::fs::read_to_string(dir.join("package.json")).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let mut set = HashSet::new();
        if let Some(deps) = parsed
            .get("dependencies")
            .and_then(serde_json::Value::as_object)
        {
            set.extend(deps.keys().cloned());
        }
        if let Some(bundles) = parsed
            .get("dsh")
            .and_then(|v| v.get("profile"))
            .and_then(|v| v.get("bundles"))
            .and_then(serde_json::Value::as_array)
        {
            for item in bundles {
                if let Some(name) = item.as_str() {
                    set.insert(name.to_string());
                }
            }
        }

        assert!(set.contains("dshmarket"));
        assert!(set.contains("@deepseek-ai/dsh-base"));
        assert_eq!(set.len(), 2);

        std::fs::remove_dir_all(&dir).ok();
    }
}
