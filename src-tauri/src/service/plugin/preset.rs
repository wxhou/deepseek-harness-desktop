//! 预设插件清单：读取并解析随安装包分发的 `resources/preset-plugins.json`。
//!
//! 社区新增推荐插件只需在该 JSON 中追加一项并提交 PR，无需改动 Rust 代码；
//! 界面与安装逻辑自动生效。资源缺失/损坏时报错并回落为空清单，不阻断启动。

use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 预设插件清单文件名
const PRESET_PLUGINS_FILE: &str = "preset-plugins.json";

/// 预装插件静态信息，对应 `resources/preset-plugins.json` 中的条目
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreinstallPluginInfo {
    /// 前端主键 / 仓库跳转查找键
    pub id: String,
    /// 传给 `dsh plugin add` 的依赖形式（npm 包名或 git 依赖形式）
    pub spec: String,
    pub name: String,
    pub description: String,
    pub repo_url: String,
    /// 绿色「推荐」chip，默认勾选（普通推荐插件）
    #[serde(default)]
    pub recommended: bool,
    /// 黄色「修复」chip，默认勾选（Windows 极简模式修复项）
    #[serde(default)]
    pub fix: bool,
    /// 无 chip 但默认勾选（如 dsh-notification：不标「推荐」，首次引导仍直接勾上）
    #[serde(default)]
    pub default_checked: bool,
    /// 仅 Windows 平台列出
    #[serde(default)]
    pub win_only: bool,
}

/// 在资源根目录下查找预设清单：先探测扁平布局（exe 同级），再探测
/// `resources/` 子目录布局（Tauri 2 的 `bundle.resources` 按相对路径保留前缀）。
fn find_in_resource_root(root: &std::path::Path) -> Option<PathBuf> {
    let flat = root.join(PRESET_PLUGINS_FILE);
    if flat.exists() {
        return Some(flat);
    }
    let nested = root.join("resources").join(PRESET_PLUGINS_FILE);
    nested.exists().then_some(nested)
}

/// 定位预设插件清单文件：优先使用随安装包分发的资源目录，回落到源码开发目录。
///
/// 注意：Tauri 2 在 Windows 上 `resource_dir()` 恒等于 exe 所在目录，而安装包
/// （NSIS/MSI）与开发产物都会把资源按 `resources/**` 前缀落盘到
/// `{resource_dir}/resources/` 子目录，因此必须探测该子目录；`CARGO_MANIFEST_DIR`
/// 是编译期路径，仅开发机有效（CI/发布版在本机不可用），只作最后兜底。
fn preset_plugins_path(app_handle: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app_handle.path().resource_dir() {
        if let Some(candidate) = find_in_resource_root(&dir) {
            return Some(candidate);
        }
    }
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(PRESET_PLUGINS_FILE);
    source.exists().then_some(source)
}

/// 解析预设清单 JSON
fn parse_presets(json: &str) -> Result<Vec<PreinstallPluginInfo>, String> {
    serde_json::from_str(json).map_err(|e| format!("PRESET_PLUGINS_INVALID_JSON: {e}"))
}

/// 读取并解析预设插件清单；资源缺失/损坏时记录错误并返回空清单
pub(crate) fn load_presets(app_handle: &AppHandle) -> Vec<PreinstallPluginInfo> {
    let Some(path) = preset_plugins_path(app_handle) else {
        log::warn!("PRESET_PLUGINS_MISSING: {PRESET_PLUGINS_FILE} not found in resource dir or source resources dir");
        return Vec::new();
    };

    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            log::error!("PRESET_PLUGINS_READ_FAILED: {}: {e}", path.display());
            return Vec::new();
        }
    };

    parse_presets(&raw).unwrap_or_else(|e| {
        log::error!("PRESET_PLUGINS_PARSE_FAILED: {}: {e}", path.display());
        Vec::new()
    })
}

/// 预装清单中某 id 对应的仓库地址
pub fn repo_url_of(app_handle: &AppHandle, id: &str) -> Option<String> {
    load_presets(app_handle)
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.repo_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_presets_for_test() -> Vec<PreinstallPluginInfo> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(PRESET_PLUGINS_FILE);
        let raw = std::fs::read_to_string(path).expect("preset-plugins.json should exist");
        parse_presets(&raw).expect("preset-plugins.json should be valid JSON")
    }

    #[test]
    fn preset_list_contains_dshmarket() {
        let presets = load_presets_for_test();
        assert!(presets.iter().any(|p| p.id == "dshmarket"));
        assert_eq!(
            presets
                .iter()
                .find(|p| p.id == "dshmarket")
                .map(|p| p.repo_url.as_str()),
            Some("https://github.com/dsh-market/dsh-market")
        );
        assert!(!presets.iter().any(|p| p.id == "unknown-package"));
    }

    #[test]
    fn preset_json_ids_are_unique() {
        let presets = load_presets_for_test();
        let ids: std::collections::HashSet<&str> =
            presets.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids.len(), presets.len(), "preset ids must be unique");
    }

    #[test]
    fn preset_discovery_finds_nested_resources_dir() {
        // 回归：Windows 安装包（NSIS/MSI）与开发产物把资源按 `resources/**` 前缀
        // 落盘到 `{resource_dir}/resources/` 子目录，此前只探测 exe 同级导致
        // 发布版预装页恒为空清单。
        let dir = std::env::temp_dir().join(format!("dsh-preset-layout-{}", std::process::id()));
        let nested = dir.join("resources");
        std::fs::create_dir_all(&nested).expect("create temp resources dir");
        std::fs::write(
            nested.join(PRESET_PLUGINS_FILE),
            r#"[{"id":"x","spec":"y","name":"X","description":"","repoUrl":"u"}]"#,
        )
        .expect("write temp preset file");

        let found = find_in_resource_root(&dir).expect("nested resources layout should be found");
        assert_eq!(found, nested.join(PRESET_PLUGINS_FILE));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn preset_discovery_prefers_flat_layout() {
        // 扁平布局（资源直接放在 exe 同级）仍应优先命中。
        let dir = std::env::temp_dir().join(format!("dsh-preset-flat-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        std::fs::write(
            dir.join(PRESET_PLUGINS_FILE),
            r#"[{"id":"x","spec":"y","name":"X","description":"","repoUrl":"u"}]"#,
        )
        .expect("write temp preset file");

        let found = find_in_resource_root(&dir).expect("flat layout should be found");
        assert_eq!(found, dir.join(PRESET_PLUGINS_FILE));

        std::fs::remove_dir_all(&dir).ok();
    }
}