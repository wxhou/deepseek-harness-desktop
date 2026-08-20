//! 预装插件安装：校验选中项、准备环境（pnpm/dsh shim、按需补齐捆绑 pnpm、
//! 停止运行中的服务），随后调用 `dsh plugin --profile web add <specs...>`，
//! 成功后执行 Windows 极简模式专项修复。
//!
//! pnpm v11 对两类构建脚本默认不放行、缺白名单时报硬错误：
//! 1. git 托管插件的 `prepare` 构建（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）——
//!    其允许键（depPath = `name@<pkgResolutionId>`）随 pnpm 的克隆方式变化
//!    （git+ssh#sha / codeload tar.gz），无法预先确定；
//! 2. 传递依赖的原生构建（如 `node-pty`，`ERR_PNPM_IGNORED_BUILDS`）。
//! 因此在安装失败时从 pnpm 错误输出解析它建议的 `allowBuilds` 键，写入 profile
//! 的 `pnpm-workspace.yaml` 后重试，直至成功或无可解析项。

use crate::config;
use crate::service::cli;
use crate::service::download;
use crate::service::download::Installable;
use crate::service::workflow;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use super::installed::{PREINSTALL_PROFILE, profile_dir};
use super::preset::load_presets;
use super::process::{run_plugin_process, PreinstallLogPayload, PREINSTALL_LOG_EVENT};

/// 允许构建重试的上限。每次重试解决 pnpm 报出的一个允许键（git depPath 或
/// 传递构建包名），多个 git 插件 / 多个原生依赖各占一次，上限封顶防死循环。
const MAX_ALLOW_LIST_RETRIES: usize = 8;

/// 校验并安装选中的预装插件：`dsh plugin --profile web add <ids...>`
pub async fn install(app_handle: &AppHandle, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Err("PREINSTALL_EMPTY: no plugins selected".to_string());
    }

    // 单次读取预设并构建查找表，提升算法效率至 O(N)
    let presets = load_presets(app_handle);
    let preset_map: HashMap<&str, &str> = presets
        .iter()
        .map(|p| (p.id.as_str(), p.spec.as_str()))
        .collect();

    let mut specs = Vec::with_capacity(ids.len());
    for id in ids {
        let spec = preset_map
            .get(id.as_str())
            .ok_or_else(|| format!("PREINSTALL_INVALID_ID: {id}"))?;
        specs.push(spec.to_string());
    }

    // 确保 pnpm/dsh shim 存在
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

    // 按需补齐捆绑 pnpm
    ensure_pnpm(app_handle, &window).await?;

    // 安装前停止运行中的服务，避免资源冲突
    if workflow::has_owned_process() {
        log::info!("Stopping running harness service before installing preinstall plugins");
        if let Err(e) = workflow::stop(app_handle.clone()).await {
            log::warn!("failed to stop harness before preinstall: {e}");
        }
    }

    // 构建环境变量
    let bin_dir = cli::get_bin_dir(app_handle);
    let mut envs = HashMap::from([
        (
            "DSH_HOME".to_string(),
            config::get_dsh_data_path(app_handle)
                .to_string_lossy()
                .into_owned(),
        ),
        ("DSH_TELEMETRY_DISABLED".to_string(), "1".to_string()),
        ("NO_COLOR".to_string(), "1".to_string()),
    ]);

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

    // 拼装命令行参数
    let mut args = vec![
        dsh_bin.as_os_str().to_os_string(),
        OsString::from("plugin"),
        OsString::from("--profile"),
        OsString::from(PREINSTALL_PROFILE),
        OsString::from("add"),
    ];
    args.extend(specs.into_iter().map(OsString::from));

    let cwd = config::get_dsh_install_path(app_handle);
    log::info!("Running dsh plugin install for {ids:?}");

    // `dsh plugin add` 在 profile 目录里驱动 pnpm。pnpm v11 会拦下 git 托管
    // 插件的 prepare 构建与传递原生依赖（见模块头注），其允许键不可预知，因此
    // 失败时解析输出里印出的 `allowBuilds` 键写回 profile 的 pnpm-workspace.yaml
    // 后重试，直至成功或再无键可加。
    let mut retries = 0usize;
    let exit_code = loop {
        let (code, captured) =
            run_plugin_process(&node, &args, &cwd, &envs, &window).await?;
        if code == 0 {
            break 0;
        }

        let new_keys = parse_allowlist_keys(&captured);
        if new_keys.is_empty() || retries >= MAX_ALLOW_LIST_RETRIES {
            log::error!(
                "dsh plugin install failed with exit code {code}; no more allowBuilds entries to add"
            );
            break code;
        }

        retries += 1;
        add_allow_build_keys(app_handle, &new_keys)?;
        log::info!("pnpm allowBuilds updated with {new_keys:?}, retrying ({retries})");
        let _ = window.emit(
            PREINSTALL_LOG_EVENT,
            PreinstallLogPayload {
                line: "[pnpm] 已放行插件构建（allowBuilds），重试安装…".to_string(),
            },
        );
    };

    if exit_code != 0 {
        log::error!("dsh plugin install failed with exit code {exit_code}");
        return Err(format!(
            "PREINSTALL_FAILED: dsh plugin exited with code {exit_code}"
        ));
    }

    // Windows 极简模式专项修复
    if ids.iter().any(|id| id == "dsh-win-terminal-inspector") {
        if let Err(e) = workflow::win_inspector::apply(app_handle) {
            log::warn!("win inspector apply failed after install: {e}");
        }
    }

    log::info!("Preinstall plugins installed successfully: {ids:?}");
    Ok(())
}

/// 确保捆绑 pnpm 已安装
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

    let tracker = download::ProgressTracker::new(window, 2);
    let url = download::Pnpm.get_download_url()?;
    let name = url.split('/').next_back().unwrap_or(&url).to_string();
    let buffer = download::download_file(&tracker, url)
        .await
        .map_err(|e| format!("PNPM_DOWNLOAD_FAILED: {e}"))?;
    download::verify_sha256(&buffer, config::PNPM_SHA256)
        .map_err(|e| format!("PNPM_INTEGRITY_FAILED: {e}"))?;
    let dest = download::Pnpm.get_install_path(app_handle);

    download::ensure_extract(&tracker, name, buffer, dest)
        .await
        .map_err(|e| format!("PNPM_EXTRACT_FAILED: {e}"))?;

    let _ = window.emit(
        PREINSTALL_LOG_EVENT,
        PreinstallLogPayload {
            line: "[pnpm] bundled pnpm ready".to_string(),
        },
    );
    Ok(())
}

/// 从 pnpm 失败输出中解析需写入 `allowBuilds` 的键集合：
/// - git 托管插件 prepare 被拦时，pnpm 会提示 `allowBuilds:\n  <depPath>: true`，
///   原样采纳 depPath（形式随克隆方式变化，只能是运行期报出的值）；
/// - 传递原生依赖被忽略构建（`Ignored build scripts:`）时，取其 `name@version` 的包名。
fn parse_allowlist_keys(output: &str) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    let lines: Vec<&str> = output.lines().collect();

    // 1) git depPath 允许键：跟随 `allowBuilds:` 示例行后的缩进 `<key>: true`。
    for (idx, line) in lines.iter().enumerate() {
        if line.trim() == "allowBuilds:" {
            if let Some(next) = lines.get(idx + 1) {
                if let Some(key) = extract_allow_line_key(next) {
                    if !keys.iter().any(|k| k == &key) {
                        keys.push(key);
                    }
                }
            }
        }
    }

    // 2) 传递原生构建包名：`Ignored build scripts: <name>@<ver>, ...`。
    for line in &lines {
        if let Some(sub) = line.split("Ignored build scripts:").nth(1) {
            for token in sub.split([',', ' ']) {
                let token = token.trim();
                if token.is_empty() {
                    continue;
                }
                let name = token.split('@').next().unwrap_or(token).trim();
                if !name.is_empty() && !keys.iter().any(|k| k == name) {
                    keys.push(name.to_string());
                }
            }
        }
    }

    keys
}

/// 若 `line` 形如 `  <key>: true`（有缩进），返回 `<key>`（去缩进与后缀）。
/// pnpm 报出的 depPath 键本身不带引号，这里只做剥离该行格式。
fn extract_allow_line_key(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if trimmed.len() == line.len() {
        return None; // 无缩进，不是白名单条目
    }
    let suffix = trimmed.strip_suffix(": true")?;
    let key = suffix.trim_end();
    if key.is_empty() {
        return None;
    }
    Some(key.to_string())
}

/// profile 下的 `pnpm-workspace.yaml` 路径（$DSH_HOME/profiles/web）
fn profile_workspace_path(app_handle: &AppHandle) -> PathBuf {
    profile_dir(app_handle).join("pnpm-workspace.yaml")
}

/// 把新的 `allowBuilds` 键合并写回 profile 的 `pnpm-workspace.yaml`。
///
/// dsh 的 `initProfile` 仅在文件缺失时创建（其模板无 `allowBuilds`），因此桌面端
/// 自行维护该块：缺失时按 dsh 模板补建基础设置并追加 `allowBuilds`；已有时按键
/// 去重合并。git depPath 键含 `@`/`/`/`:`/`#`，按 YAML 单引号标量写入避免误解析；
/// `false` 不应出现于此（我们只放行）。重复写入同一键是无害的（幂等）。
fn add_allow_build_keys(app_handle: &AppHandle, keys: &[String]) -> Result<(), String> {
    let path = profile_workspace_path(app_handle);
    let dir = path
        .parent()
        .ok_or("PREINSTALL_BAD_PROFILE_DIR: no profile dir")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("PREINSTALL_MKDIR: {e}"))?;

    let mut content = if path.exists() {
        std::fs::read_to_string(&path)
            .map_err(|e| format!("PREINSTALL_READ_WORKSPACE: {e}"))?
    } else {
        // 与 dsh `initProfile` 生成的基础模板保持一致（尚无 allowBuilds）
        "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n".to_string()
    };

    let has_allow_builds = content
        .lines()
        .any(|l| l.trim_start().starts_with("allowBuilds:"));
    if !has_allow_builds {
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str("allowBuilds:\n");
    }

    // 收集已有 `  <key>: true` 条目（含单引号形式），避免重复。基础模板里
    // 的 `packages`/`nodeLinker`/`autoInstallPeers` 等行不会以 `: true` 结尾，
    // 天然被排除。
    let existing: Vec<String> = content
        .lines()
        .filter_map(|l| {
            let trimmed = l.trim_start();
            if trimmed.len() == l.len() {
                return None; // 非缩进行（顶层键）不参与
            }
            let suffix = trimmed.strip_suffix(": true")?;
            let key = suffix.trim().trim_matches(['\'', '"']);
            if key.is_empty() || key.contains(':') {
                return None;
            }
            Some(key.to_string())
        })
        .collect();

    let mut dirty = false;
    for key in keys {
        if existing.iter().any(|k| k == key) {
            continue;
        }
        // 单引号包裹键：git depPath 含 `:`/`#`/`@`，裸写会让 YAML 误解析
        content.push_str(&format!("  '{}': true\n", key.replace('\'', "''")));
        dirty = true;
    }
    if !dirty {
        return Ok(());
    }

    std::fs::write(&path, content).map_err(|e| format!("PREINSTALL_WRITE_WORKSPACE: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{extract_allow_line_key, parse_allowlist_keys};

    #[test]
    fn parse_git_dep_path_key() {
        let out = "\
[ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED] Failed to prepare git-hosted package fetched from \"...\"
The git-hosted package \"dsh-better-sidebar@0.14.0\" needs to execute build scripts but is not in the \"allowBuilds\" allowlist.
...
allowBuilds:
  dsh-better-sidebar@git+ssh://git@github.com/omdsh-dev/DSH-better-sidebar.git#6c89: true
";
        let keys = parse_allowlist_keys(out);
        assert!(keys.contains(&"dsh-better-sidebar@git+ssh://git@github.com/omdsh-dev/DSH-better-sidebar.git#6c89".to_string()));
        assert!(!keys.contains(&"dsh-better-sidebar".to_string()));
    }

    #[test]
    fn parse_ignored_builds_name() {
        let out = "[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: node-pty@1.1.0\n";
        let keys = parse_allowlist_keys(out);
        assert_eq!(keys, vec!["node-pty".to_string()]);
    }

    #[test]
    fn parse_empty_when_irrelevant() {
        let out = "everything looks fine output\nno allowlist here\n";
        assert!(parse_allowlist_keys(out).is_empty());
    }

    #[test]
    fn allow_line_key_requires_indent() {
        let key = extract_allow_line_key("  node-pty: true");
        assert_eq!(key.as_deref(), Some("node-pty"));

        // 无缩进（顶层键）不应被当作白名单条目
        assert_eq!(extract_allow_line_key("packages:"), None);
        assert_eq!(extract_allow_line_key("allowBuilds:"), None);
    }
}
