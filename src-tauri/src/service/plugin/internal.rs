//! 内置插件启动自愈：随安装包分发的内置插件（`preset-plugins.json` 标记
//! `internal: true`，产物目录 `resources/preset-plugins/<id>` 由构建期
//! `scripts/prebuild.ts` 拉取）在服务启动前核对「是否已安装 + 安装路径是否仍
//! 指向当前捆绑目录」：未安装 / 路径不正确 / 用户卸载后残留缺失 → 一律走常规
//! 安装流程强制重装，保证桌面外壳依赖的桥接层（如 dsh-tauri）随包可用。
//!
//! debug 构建可用仓库根 `.env` 的 `DEV_INTERNAL_PLUGINS_DIR` 把安装目标指到
//! 本地插件源码（热更新迭代，见 [`super::preset::bundled_plugin_dir`]）。
//!
//! 为什么放在启动而非安装流程：安装是用户主动行为，内置插件是应用自身的完整性
//! 要求——用户怎么卸载、何时卸载都不影响下次启动自动恢复，无需任何用户操作。

use std::collections::HashMap;
use tauri::AppHandle;

use super::installed::{installed_name, profile_dir, ProfilePackageJson};
use super::preset::{bundled_plugin_dir, file_dep_spec, load_presets};

/// 核对并强制安装缺失/路径不正确/被卸载的内置插件，在服务进程启动前调用。
///
/// 最佳努力：任何失败只记告警（调用方不阻断启动）；捆绑目录缺失（开发环境未跑
/// prebuild）时跳过，交由常规引导流程处理；批量待装列表为空则不触发任何安装。
pub(crate) async fn ensure(app_handle: &AppHandle) -> Result<(), String> {
    let presets = load_presets(app_handle);
    let internal: Vec<_> = presets.iter().filter(|p| p.internal).collect();
    if internal.is_empty() {
        return Ok(());
    }

    // 一次读取当前档案的依赖声明；档案未初始化（package.json 缺失/损坏）时按
    // 「全部缺失」处理，由安装流程自行初始化。
    let manifest_path = profile_dir(app_handle).join("package.json");
    let dependencies: HashMap<String, String> = match std::fs::read_to_string(&manifest_path) {
        Ok(raw) => serde_json::from_str::<ProfilePackageJson>(&raw)
            .map(|m| m.dependencies)
            .unwrap_or_default(),
        // 档案尚未初始化
        Err(_) => HashMap::new(),
    };

    let profile = profile_dir(app_handle);
    let mut need: Vec<String> = Vec::new();
    for preset in &internal {
        let Some(bundled) = bundled_plugin_dir(app_handle, &preset.id) else {
            // 未找到内置插件目录：release 说明构建期 prebuild 未拉取（发布缺陷，
            // 由 prebuild 响亮失败）；debug 可用 .env 的 DEV_INTERNAL_PLUGINS_DIR
            // 指向本地源码目录，未配置/缺 id 时跳过（「找不到则不装」）。
            log::warn!(
                "INTERNAL_PLUGIN_BUNDLE_MISSING: {}（release 需构建期 prebuild；debug 可配 .env DEV_INTERNAL_PLUGINS_DIR）",
                preset.id
            );
            continue;
        };
        let name = installed_name(preset).to_string();
        let expected = file_dep_spec(&bundled);
        // ① 依赖声明：未声明，或声明的值不再指向当前捆绑目录（路径变更/被改
        // 写）→ 重装；② 依赖真实性：node_modules 链接/拷贝须真实存在（用户
        // 手动清过 node_modules 时声明可能残留但产物已不在）→ 重装。
        let dep_ok = dependencies
            .get(&name)
            .is_some_and(|actual| dep_matches_spec(actual, &expected));
        let link_ok = profile.join("node_modules").join(&name).exists();
        if !dep_ok || !link_ok {
            log::info!(
                "INTERNAL_PLUGIN_NEEDS_REINSTALL: {name}（dep_ok={dep_ok}, link_ok={link_ok}, expected={expected}）"
            );
            need.push(preset.id.clone());
        }
    }
    if need.is_empty() {
        return Ok(());
    }

    log::info!("Reinstalling internal preset plugins: {need:?}");
    // 复用常规安装编排（环境准备/补齐 pnpm/`dsh plugin add file:<dir>`）；
    // 启动阶段无持有进程，install 内部不会停服务。失败同样交给调用方告警。
    if let Err(e) = super::install::install(app_handle, &need).await {
        return Err(format!("INTERNAL_PLUGIN_INSTALL_FAILED: {e}"));
    }
    Ok(())
}

/// 判断 pnpm 写入 profile 的依赖值与期望的 `file:` 捆绑路径是否一致。
///
/// 容忍：`file:` 前缀缺失/存在两种写法；Windows 下路径大小写不敏感；尾部斜杠
/// 差异（pnpm 各版本落盘形式略有出入）。
fn dep_matches_spec(actual: &str, expected: &str) -> bool {
    let norm = |spec: &str| {
        let stripped = spec.strip_prefix("file:").unwrap_or(spec);
        stripped.replace('\\', "/").trim_end_matches('/').to_string()
    };
    let actual = norm(actual);
    let expected = norm(expected);
    if cfg!(windows) {
        actual.eq_ignore_ascii_case(&expected)
    } else {
        actual == expected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dep_spec_matches_itself() {
        let expected = "file:C:/Apps/dsh/resources/preset-plugins/dsh-tauri";
        // 与自身一致
        assert!(dep_matches_spec(expected, expected));
        // 无 file: 前缀（pnpm 某些场景直接落路径）
        assert!(dep_matches_spec(
            "C:/Apps/dsh/resources/preset-plugins/dsh-tauri",
            expected
        ));
        // 尾部斜杠差异
        assert!(dep_matches_spec(
            "file:C:/Apps/dsh/resources/preset-plugins/dsh-tauri/",
            expected
        ));
        // 反斜杠（Windows 原生形式）
        assert!(dep_matches_spec(
            "file:C:\\Apps\\dsh\\resources\\preset-plugins\\dsh-tauri",
            expected
        ));
    }

    #[test]
    fn dep_spec_rejects_wrong_path_or_source() {
        let expected = "file:C:/Apps/dsh/resources/preset-plugins/dsh-tauri";
        // 仍指向 git 源（用户手动从仓库安装）
        assert!(!dep_matches_spec("github:hairyf/dsh-tauri", expected));
        // 指向其它位置（旧版本安装目录等）
        assert!(!dep_matches_spec("file:D:/elsewhere/dsh-tauri", expected));
        // 同名不同宿主盘符
        assert!(!dep_matches_spec("file:D:/Apps/dsh/resources/preset-plugins/dsh-tauri", expected));
    }

    #[cfg(windows)]
    #[test]
    fn dep_spec_case_insensitive_on_windows() {
        // Windows 文件系统大小写不敏感，路径比较须忽略大小写
        let expected = "file:C:/Apps/dsh/resources/preset-plugins/dsh-tauri";
        assert!(dep_matches_spec(
            "file:c:/apps/DSH/resources/preset-plugins/Dsh-Tauri",
            expected
        ));
    }
}