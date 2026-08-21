//! 用户数据目录迁移：旧版 AppData `data/dsh` → 官方 `$DSH_HOME`（`~/.dsh`）。
//!
//! 早期桌面版把 `$DSH_HOME` 隔离在应用数据目录
//! （`%APPDATA%/io.github.hairyf.deepseek-harness-desktop/data/dsh`），与官方
//! node 安装（`${DSH_HOME:-$HOME/.dsh}`）不一致，两边数据互不相通。本模块在
//! 启动早期把旧数据迁移到官方 `$DSH_HOME`，之后桌面版与官方安装共用同一份数据。
//!
//! 迁移规则：
//! - 目标不存在（场景 A）→ 整体搬移（同卷 `rename` 原子移动，跨卷自动退化为复制）；
//! - 目标已存在（场景 B）→ 递归合并，同名文件按 mtime「较新者胜」；
//! - `node_modules` 目录整体跳过：可再生的安装产物（dsh 启动时会按 profile 的
//!   package.json 重新安装），且 pnpm 的硬链接/junction 直接复制会损坏；
//! - 迁移成功并删除旧目录后，在 `.store.dat` 置位 `dsh_home_migrated` 幂等标记；
//! - 任何失败只告警不阻断启动：旧数据原地保留，下次启动重试。

use crate::config;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// 旧版（<0.x 迁移版）$DSH_HOME 位置：AppData 下的 `data/dsh`。
fn legacy_dsh_home(app_handle: &AppHandle) -> PathBuf {
    config::get_base_dir(app_handle)
        .join("data")
        .join(config::DSH_DATA_DIR_NAME)
}

/// 启动早期调用：把旧版 AppData 数据目录迁移到官方 `$DSH_HOME`。
///
/// 幂等：成功后会删除旧目录并置位 `.store.dat` 标记，重复调用为 no-op。
/// 失败返回 Err（不删除旧数据），由调用方决定是否阻断——本应用选择仅告警。
pub fn migrate(app_handle: &AppHandle) -> Result<(), String> {
    // 开发（debug）构建不执行旧数据迁移：旧版 AppData `data/dsh` 是生产的
    // 数据（release 尚未完成迁移时会把它整目录搬进开发版的 `.dsh.dev`，
    // 导致 release 丢失数据）。开发构建的数据目录从一开始就是独立的 `.dsh.dev`。
    if cfg!(debug_assertions) {
        log::debug!("skipping legacy data migration in debug build (data belongs to release)");
        return Ok(());
    }

    let setting = config::get_store_dat_setting(app_handle);
    if setting.dsh_home_migrated {
        log::debug!("dsh home migration already done, skipping");
        return Ok(());
    }

    let legacy = legacy_dsh_home(app_handle);
    let target = config::get_dsh_data_path(app_handle);

    // 旧目录不存在（全新安装 / 官方安装场景）→ 无需迁移
    if !legacy.exists() {
        return Ok(());
    }
    // 旧路径 == 新路径（用户显式把 DSH_HOME 指向 AppData）→ 跳过
    if legacy == target {
        return Ok(());
    }

    migrate_impl(&legacy, &target)?;

    // 置位幂等标记
    let mut setting = config::get_store_dat_setting(app_handle);
    setting.dsh_home_migrated = true;
    config::set_store_dat_setting(app_handle, setting);
    log::info!(
        "dsh home migrated: {} -> {}",
        legacy.display(),
        target.display()
    );
    Ok(())
}

/// 迁移实现（纯路径函数，便于单测）。成功时旧目录已被删除。
fn migrate_impl(legacy: &Path, target: &Path) -> Result<(), String> {
    if !legacy.exists() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create {} failed: {e}", parent.display()))?;
    }
    if !target.exists() {
        // 场景 A：目标不存在 → 整体搬移（rename 同卷原子，node_modules 一并
        // 无损搬入；跨卷 EXDEV 退化为复制合并，此时 node_modules 跳过）
        if fs::rename(legacy, target).is_ok() {
            return Ok(());
        }
        log::debug!(
            "rename {} -> {} failed, falling back to recursive copy",
            legacy.display(),
            target.display()
        );
    }
    // 场景 B（或跨卷回退）：递归合并，新数据优先
    merge_tree(legacy, target)?;
    fs::remove_dir_all(legacy).map_err(|e| {
        format!(
            "remove legacy {} after merge failed: {e}",
            legacy.display()
        )
    })
}

/// 递归把 `src` 目录树合并进 `dst`：
/// - 目标缺失的条目直接搬入（目录 `rename` 快路径，失败递归复制）；
/// - 两边都有的文件按 mtime 比较，目标不旧于源则保留目标（新数据优先）；
/// - `node_modules` 目录：目标缺失时尝试无损 `rename` 搬入（pnpm 硬链接/
///   junction 移动无损坏风险，且不丢依赖）；目标已有或跨卷 rename 失败时
///   跳过（依赖可再生，复制硬链接树会损坏）。
fn merge_tree(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create {} failed: {e}", dst.display()))?;
    for entry in fs::read_dir(src)
        .map_err(|e| format!("read {} failed: {e}", src.display()))?
    {
        let entry = entry.map_err(|e| format!("read_dir entry failed: {e}"))?;
        let name = entry.file_name();
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        if name == "node_modules" {
            // 依赖树特殊处理：目标已有 → 保留目标；目标缺失 → 无损 rename 搬入
            if !dst_path.exists() {
                let _ = fs::rename(&src_path, &dst_path);
            }
            continue;
        }
        let is_dir = entry
            .file_type()
            .map_err(|e| format!("file_type {} failed: {e}", src_path.display()))?
            .is_dir();
        if is_dir {
            if dst_path.exists() && dst_path.is_dir() {
                merge_tree(&src_path, &dst_path)?;
            } else if fs::rename(&src_path, &dst_path).is_err() {
                // 跨卷或目标被文件占用：退化为递归复制
                merge_tree(&src_path, &dst_path)?;
            }
        } else if !dst_path.exists() || src_newer(&src_path, &dst_path) {
            fs::copy(&src_path, &dst_path).map_err(|e| {
                format!("copy {} -> {} failed: {e}", src_path.display(), dst_path.display())
            })?;
        }
    }
    Ok(())
}

/// `src` 的 mtime 是否严格新于 `dst`（任一 metadata/modified 缺失时按“需要覆盖”处理）。
fn src_newer(src: &Path, dst: &Path) -> bool {
    let src_mtime = fs::metadata(src).and_then(|m| m.modified()).ok();
    let dst_mtime = fs::metadata(dst).and_then(|m| m.modified()).ok();
    match (src_mtime, dst_mtime) {
        (Some(s), Some(d)) => s > d,
        (Some(_), None) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一个带内容与 mtime 的临时目录树，返回 (root, 清理守卫)。
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "dsh-migrate-test-{}-{tag}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// 用标准库 FileTimes 设置 mtime（Rust 1.75+）。
    /// 注意必须以写权限打开：Windows 上只读句柄调用 set_times 会被拒绝。
    fn set_mtime(path: &Path, secs_since_epoch: u64) {
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs_since_epoch);
        let f = fs::OpenOptions::new().write(true).open(path).unwrap();
        f.set_times(std::fs::FileTimes::new().set_modified(t)).unwrap();
    }

    // ------------------------------------------------------------------
    // 场景 A：目标不存在 → 整体搬移
    // ------------------------------------------------------------------

    #[test]
    fn scenario_a_moves_whole_tree() {
        let legacy = temp_dir("a-legacy");
        let target = temp_dir("a-target-parent").join("dsh");
        let _ = fs::remove_dir_all(&target);

        write(&legacy.join("settings.yaml"), "theme: dark\n");
        write(&legacy.join("sessions/s1/data.json"), "{}");
        write(&legacy.join("profiles/web/package.json"), "{\"name\":\"web\"}");
        write(&legacy.join("profiles/web/node_modules/x/index.js"), "// x");

        migrate_impl(&legacy, &target).unwrap();

        assert!(!legacy.exists(), "legacy dir must be removed");
        assert!(target.join("settings.yaml").is_file());
        assert!(target.join("sessions/s1/data.json").is_file());
        assert!(target.join("profiles/web/package.json").is_file());
        // rename 无损搬移：node_modules 一并带入（不丢依赖）
        assert!(
            target.join("profiles/web/node_modules/x/index.js").is_file(),
            "rename must carry node_modules over losslessly"
        );
    }

    #[test]
    fn scenario_a_nonexistent_legacy_is_noop() {
        let legacy = temp_dir("a-none").join("nope");
        let target = temp_dir("a-none-target").join("dsh");
        let _ = fs::remove_dir_all(&target);
        migrate_impl(&legacy, &target).unwrap();
        assert!(!target.exists());
    }

    // ------------------------------------------------------------------
    // 场景 B：目标已存在 → 合并，新数据优先
    // ------------------------------------------------------------------

    #[test]
    fn scenario_b_merges_newer_wins() {
        let legacy = temp_dir("b-legacy");
        let target = temp_dir("b-target");

        // 两边都有同名文件：legacy 更新 → 覆盖；target 更新 → 保留
        write(&legacy.join("shared.txt"), "legacy-new");
        write(&target.join("shared.txt"), "target-old");
        set_mtime(&legacy.join("shared.txt"), 200);
        set_mtime(&target.join("shared.txt"), 100);

        write(&legacy.join("keep-target.txt"), "legacy-old");
        write(&target.join("keep-target.txt"), "target-new");
        set_mtime(&legacy.join("keep-target.txt"), 100);
        set_mtime(&target.join("keep-target.txt"), 200);

        // legacy 独有 → 复制进来
        write(&legacy.join("only-legacy.txt"), "L");
        // target 独有 → 保留
        write(&target.join("only-target.txt"), "T");
        // node_modules 两边都有 → 保留目标
        write(&legacy.join("profiles/web/node_modules/p/index.js"), "// legacy p");
        write(&target.join("profiles/web/node_modules/p/index.js"), "// target p");

        migrate_impl(&legacy, &target).unwrap();

        assert!(!legacy.exists(), "legacy dir must be removed after merge");
        assert_eq!(
            fs::read_to_string(target.join("shared.txt")).unwrap(),
            "legacy-new",
            "newer source file wins"
        );
        assert_eq!(
            fs::read_to_string(target.join("keep-target.txt")).unwrap(),
            "target-new",
            "newer target file is preserved"
        );
        assert!(target.join("only-legacy.txt").is_file());
        assert!(target.join("only-target.txt").is_file());
        assert_eq!(
            fs::read_to_string(target.join("profiles/web/node_modules/p/index.js")).unwrap(),
            "// target p",
            "existing target node_modules is preserved"
        );
    }

    #[test]
    fn scenario_b_carries_legacy_node_modules_when_target_lacks_it() {
        let legacy = temp_dir("b-nm-legacy");
        let target = temp_dir("b-nm-target");

        write(&legacy.join("profiles/web/node_modules/x/index.js"), "// x");
        write(&legacy.join("profiles/web/package.json"), "{}");

        migrate_impl(&legacy, &target).unwrap();
        assert!(target.join("profiles/web/package.json").is_file());
        assert!(
            target.join("profiles/web/node_modules/x/index.js").is_file(),
            "legacy node_modules is carried over when target has none"
        );
    }

    // ------------------------------------------------------------------
    // 失败场景：目标被文件占位 → 报错且不删源
    // ------------------------------------------------------------------

    #[test]
    fn failure_keeps_legacy_intact() {
        let legacy = temp_dir("f-legacy");
        // 目标路径被一个普通文件占位（模拟异常状态）→ merge 应失败且不删源
        let target = temp_dir("f-target-file").join("occupied");
        fs::write(&target, "i am a file").unwrap();
        write(&legacy.join("data.txt"), "precious");

        let err = migrate_impl(&legacy, &target).unwrap_err();
        assert!(err.contains("failed") || err.contains("create"));
        assert!(legacy.join("data.txt").is_file(), "source must stay intact");
        assert!(fs::read_to_string(&target).unwrap() == "i am a file");
    }

    // ------------------------------------------------------------------
    // 幂等：migrate() 标记层面（migrate_impl 天然幂等——旧目录已删）
    // ------------------------------------------------------------------

    #[test]
    fn merge_tree_is_idempotent() {
        let legacy = temp_dir("i-legacy");
        let target = temp_dir("i-target");
        write(&legacy.join("a.txt"), "1");
        merge_tree(&legacy, &target).unwrap();
        // 第二次：legacy 已空，无新增内容
        merge_tree(&legacy, &target).unwrap();
        assert_eq!(fs::read_to_string(target.join("a.txt")).unwrap(), "1");
    }
}
