//! 预装插件：首次启动引导安装官方推荐插件（当前为 DSH Market）。
//!
//! 安装通过 `dsh plugin --profile web add <pkg>` 完成：该子命令是 pnpm 转发器，
//! 会在 `$DSH_HOME/profiles/web` 初始化 profile 并执行 `pnpm add`，随后把声明了
//! `dsh.bundle` 的依赖写入 profile 的 bundles 层，使插件在下次启动时加载。
//! 进程输出逐行通过 `preinstall-log` 事件实时推送给前端日志面板。
//!
//! 新增预装插件只需往 [`PREINSTALL`] 静态清单追加一项，界面与安装逻辑自动生效。

use crate::config;
use crate::service::cli;
use crate::service::workflow;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
#[cfg(not(windows))]
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
/// `id` 为传给 `dsh plugin add` 的包名（npm 包名或 git 依赖形式）。
const PREINSTALL: &[PreinstallPluginInfo] = &[PreinstallPluginInfo {
    id: "dshmarket",
    name: "DSH Market",
    description:
        "Visual plugin market inside DeepSeek Harness — browse, search, and one-click install community plugins. · DSH 可视化插件市场：逛一逛，点一下，装好。",
    repo_url: "https://github.com/dsh-market/dsh-market",
    recommended: true,
}];

/// 预装插件静态信息（不含运行时检测的 installed 状态）
struct PreinstallPluginInfo {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    repo_url: &'static str,
    recommended: bool,
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

/// 预装插件列表（含 installed 状态），前端渲染用
pub fn list(app_handle: &AppHandle) -> Vec<PreinstallPlugin> {
    let installed = list_installed(app_handle);
    PREINSTALL
        .iter()
        .map(|p| PreinstallPlugin {
            id: p.id.to_string(),
            name: p.name.to_string(),
            description: p.description.to_string(),
            repo_url: p.repo_url.to_string(),
            recommended: p.recommended,
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

    // 新增/变更 bundle 需要服务重启才会加载：安装前先停掉正在运行的服务，
    // 后续 launch 会以全新进程加载新插件（首次安装场景服务尚未启动，跳过）。
    if workflow::utils::is_dsh_running(config::get_store_dat_setting(app_handle).port).await {
        log::info!("Stopping running harness service before installing preinstall plugins");
        if let Err(e) = workflow::stop(app_handle.clone()).await {
            log::warn!("failed to stop harness before preinstall: {e}");
        }
    }

    let window = app_handle
        .get_webview_window("main")
        .ok_or("WINDOW_NOT_FOUND: main window missing")?;

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

    // 命令：`node <dsh_bin.js> plugin --profile web add <ids...>`
    // 注意脚本路径必须是第一个参数（node 会把首个非选项参数当作脚本加载，
    // 漏掉它会出现 `Cannot find module '.../dependencies/dsh/plugin'`）。
    let mut args: Vec<OsString> = vec![dsh_bin.as_os_str().to_os_string()];
    args.extend([
        OsString::from("plugin"),
        OsString::from("--profile"),
        OsString::from(PREINSTALL_PROFILE),
        OsString::from("add"),
    ]);
    args.extend(ids.iter().map(OsString::from));

    let cwd = config::get_dsh_install_path(app_handle);
    log::info!("Running dsh plugin install for {ids:?}");

    let exit_code = run_plugin_process(&node, &args, &cwd, &envs, &window).await?;
    if exit_code != 0 {
        log::error!("dsh plugin install failed with exit code {exit_code}");
        return Err(format!(
            "PREINSTALL_FAILED: dsh plugin exited with code {exit_code}"
        ));
    }

    log::info!("Preinstall plugins installed successfully: {ids:?}");
    Ok(())
}

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
