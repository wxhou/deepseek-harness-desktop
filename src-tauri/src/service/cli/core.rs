//! 命令行集成对外接口：状态查询、启用/确保（幂等自愈）、禁用/清理。

use crate::config;
use serde::Serialize;
use std::fs;
use tauri::AppHandle;

use super::path::{get_bin_dir, get_shim_path, path_registered, register_path, unregister_path};
use super::shim::{user_dsh_preserved, write_shims};

/// 命令行集成状态（设置页展示）
#[derive(Debug, Clone, Serialize)]
pub struct CliLinkStatus {
    /// 用户开关（Setting.cli_link_enabled）
    pub enabled: bool,
    /// 主 shim 文件是否存在
    pub shim_exists: bool,
    /// bin 目录是否已在用户 PATH 中注册
    pub path_registered: bool,
    /// 检测到用户自行安装的同名 `dsh`（未被覆盖，已保留）
    pub user_dsh_preserved: bool,
    /// bin 目录绝对路径
    pub bin_dir: String,
    /// 主 shim 文件绝对路径
    pub shim_path: String,
}

/// 当前命令行集成状态
pub fn get_status(app_handle: &AppHandle) -> CliLinkStatus {
    let setting = config::get_store_dat_setting(app_handle);
    let shim_path = get_shim_path(app_handle);
    let bin_dir = get_bin_dir(app_handle);
    CliLinkStatus {
        enabled: setting.cli_link_enabled,
        shim_exists: shim_path.is_file(),
        path_registered: path_registered(app_handle),
        // 安装集成时若在 shim 路径检测到用户自装的同名 dsh，则已被保留、未被覆盖
        user_dsh_preserved: user_dsh_preserved(&bin_dir),
        bin_dir: bin_dir.to_string_lossy().into_owned(),
        shim_path: shim_path.to_string_lossy().into_owned(),
    }
}

/// 启用并确保命令行集成完整（幂等，可随时重跑自愈）
///
/// 只做 shim 生成与 PATH 注册，不要求 node/dsh/pnpm 已安装——运行时缺失时
/// shim 会给出友好报错，因此安装前后调用都是安全的。
pub fn ensure(app_handle: &AppHandle) -> Result<CliLinkStatus, String> {
    // 保证 DSH_HOME 目录存在（shim 会写入该路径）
    let dsh_home = config::get_dsh_data_path(app_handle);
    fs::create_dir_all(&dsh_home).map_err(|e| format!("create dsh home failed: {e}"))?;

    let bin_dir = get_bin_dir(app_handle);
    write_shims(app_handle, &bin_dir)?;
    // 开发（debug）构建不注册用户 PATH：bin 目录与 PATH 是共享的用户级状态，
    // 由生产版维护；开发版只写 shim（debug 下仅 pnpm shim，见 write_shims），
    // 既不增删 PATH 条目、也不覆盖生产的 dsh shim，避免干扰生产命令行集成。
    if cfg!(debug_assertions) {
        log::info!(
            "dsh/pnpm CLI shims ensured at {} (debug build: PATH registration skipped)",
            bin_dir.display()
        );
        return Ok(get_status(app_handle));
    }
    register_path(app_handle)?;

    log::info!("dsh/pnpm CLI links ensured at {}", bin_dir.display());
    Ok(get_status(app_handle))
}

/// 仅确保 shim 文件存在（写入 bin 目录，不注册用户 PATH）。
///
/// 供预装插件等应用内部流程使用：需要 `pnpm`/`dsh` 可被子进程解析，
/// 但不希望改动用户的 PATH 注册（避免与"命令行集成"开关状态不一致）。
///
/// 容错语义（与 [`ensure`] 的严格传播不同）：标准 bin 目录不可写（如
/// `~/.local/bin` 为 root 属主，EACCES）不阻断插件安装——降级为含修复
/// 指引的 WARN，并把 shim 写入应用私有回退目录，保证插件子进程仍能按名
/// 解析 `pnpm`/`dsh`（PATH 优先级由 [`super::path::get_effective_bin_dir`]
/// 对齐）。仅当回退目录也写失败（应用数据目录损坏）才返回 Err。
pub fn ensure_shims(app_handle: &AppHandle) -> Result<(), String> {
    let bin_dir = get_bin_dir(app_handle);
    match write_shims(app_handle, &bin_dir) {
        Ok(()) => {
            log::info!("dsh/pnpm shims ensured at {}", bin_dir.display());
            Ok(())
        }
        Err(e) => {
            let fallback_dir = super::path::get_fallback_bin_dir(app_handle);
            log::warn!(
                "SHIM_WRITE_DEGRADED: {e}; CLI integration degraded but app and plugin \
                 install continue via fallback. Fix hint: check ownership/permissions of {} \
                 (e.g. `sudo chown -R $(whoami) <dir>`) and restart the app",
                bin_dir.display()
            );
            write_shims(app_handle, &fallback_dir)?;
            log::info!("dsh/pnpm shims fell back to {}", fallback_dir.display());
            Ok(())
        }
    }
}

/// 禁用并清理命令行集成（删除 shim + 移除 PATH 注册）
pub fn remove(app_handle: &AppHandle) -> Result<CliLinkStatus, String> {
    // 开发（debug）构建不删除 shim、不注销 PATH：这些是共享的用户级状态，
    // 由生产版维护——开发版执行清理会让正在运行的生产版命令行集成失效。
    if cfg!(debug_assertions) {
        log::info!("cli link removal skipped in debug build (shared user state kept)");
        return Ok(get_status(app_handle));
    }
    let bin_dir = get_bin_dir(app_handle);

    #[cfg(windows)]
    {
        use super::shim::{PNPM_SHIM_CMD_NAME, PNPM_SHIM_PS1_NAME, SHIM_CMD_NAME, SHIM_PS1_NAME};
        let _ = fs::remove_file(bin_dir.join(SHIM_CMD_NAME));
        let _ = fs::remove_file(bin_dir.join(SHIM_PS1_NAME));
        let _ = fs::remove_file(bin_dir.join(PNPM_SHIM_CMD_NAME));
        let _ = fs::remove_file(bin_dir.join(PNPM_SHIM_PS1_NAME));
    }
    #[cfg(not(windows))]
    {
        use super::shim::{PNPM_SHIM_SH_NAME, SHIM_SH_NAME};
        let _ = fs::remove_file(bin_dir.join(SHIM_SH_NAME));
        let _ = fs::remove_file(bin_dir.join(PNPM_SHIM_SH_NAME));
    }

    unregister_path(app_handle)?;

    log::info!("dsh/pnpm CLI links removed");
    Ok(get_status(app_handle))
}
