//! renderer 一行导出补丁：给活动核心的 dsh-client-ui-renderer 补上 SlotOutlet 导出。
//!
//! dsh-tauri-ui 插件的设置侧边栏依赖 `<SlotOutlet>`（任意槽渲染入口）。官方
//! renderer 的 `lib/client.js` 只导出 `{apply, inject}`——SlotOutlet 实现完整
//! 却未公开，上游也没提供跨键渲染 API（插件只能 shadow 官方条目再自己渲染他人
//! 声明的槽，而这必须经过 SlotOutlet）。补丁在文件末尾（`\treturn module.exports;`
//! 前）插入一行 `\texports.SlotOutlet = SlotOutlet;`，与开发期手工补丁逐字节一致。
//!
//! 幂等与容错：
//! - 目标已含 `exports.SlotOutlet` 即跳过——上游将来自己导出（或已提的一行 PR
//!   合入）后本模块自动退休，零维护；
//! - 文件缺失或锚点（`\treturn module.exports;`）因上游布局变更而找不到 → 跳过
//!   并告警，不阻断启动——插件侧另有降级（SlotOutlet 不可用时保留官方设置 dialog，
//!   绝不白屏）。
//!
//! 挂点：`service::workflow::launch` 启动 dsh 进程前，与 win_inspector / ensure_*
//! 自愈链同一位置（最佳努力，失败只告警）。

use std::fs;
use std::path::PathBuf;

use crate::config;

/// 唯一导出锚点：renderer 打包产物模块工厂末尾的返回语句（tab 缩进）。
const ANCHOR: &str = "\treturn module.exports;";

/// 插入的导出行（与锚点同 tab 缩进）。
const PATCH_LINE: &str = "\texports.SlotOutlet = SlotOutlet;\n";

/// 单个 renderer client.js 内容的补丁结果。
#[derive(Debug, PartialEq, Eq)]
enum PatchOutcome {
    /// 已含 `exports.SlotOutlet`，无需补丁（本补丁已生效或上游官方导出）。
    AlreadyPatched,
    /// 锚点缺失（上游布局变更），跳过；插件降级兜底，不阻断。
    AnchorMissing,
    /// 已插入导出行，携带补丁后的完整内容。
    Patched(String),
}

/// 幂等补丁逻辑的纯函数部分（便于单测，不触碰文件系统）。
fn patch_source(source: &str) -> PatchOutcome {
    if source.contains("exports.SlotOutlet") {
        return PatchOutcome::AlreadyPatched;
    }
    let Some(pos) = source.find(ANCHOR) else {
        return PatchOutcome::AnchorMissing;
    };
    let mut patched = source.to_string();
    patched.insert_str(pos, PATCH_LINE);
    PatchOutcome::Patched(patched)
}

/// 对活动核心的 dsh-client-ui-renderer `lib/client.js` 应用补丁（幂等）。
/// 返回 Err 表示读/写失败；文件缺失、已打过、锚点变更均静默跳过（Ok）。
pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let client_js: PathBuf = config::get_dsh_install_path(app_handle)
        .join("node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js");
    if !client_js.exists() {
        log::info!(
            "renderer client.js not found, skip SlotOutlet patch: {}",
            client_js.display()
        );
        return Ok(());
    }
    let source = fs::read_to_string(&client_js)
        .map_err(|e| format!("RENDERER_PATCH_READ: {} failed: {e}", client_js.display()))?;
    match patch_source(&source) {
        PatchOutcome::AlreadyPatched => {
            log::info!("renderer already exports SlotOutlet, skip patch");
        }
        PatchOutcome::AnchorMissing => {
            log::warn!(
                "renderer client.js anchor missing, skip SlotOutlet patch — plugin degrades to official settings dialog"
            );
        }
        PatchOutcome::Patched(patched) => {
            fs::write(&client_js, patched).map_err(|e| {
                format!("RENDERER_PATCH_WRITE: {} failed: {e}", client_js.display())
            })?;
            log::info!("renderer SlotOutlet export patched: {}", client_js.display());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真实打包产物末尾的五行（与运行时 client.js L982-986 一致）。
    const TAIL: &str = "\t\t//#endregion\n\t\texports.apply = apply;\n\t\texports.inject = inject;\n\treturn module.exports;\n\t}\n});\n";

    #[test]
    fn patch_inserts_export_before_return() {
        match patch_source(TAIL) {
            PatchOutcome::Patched(patched) => {
                assert!(patched.contains(PATCH_LINE.trim_end()));
                assert!(patched.starts_with(
                    "\t\t//#endregion\n\t\texports.apply = apply;\n\t\texports.inject = inject;\n\texports.SlotOutlet = SlotOutlet;\n\treturn module.exports;\n"
                ));
            }
            other => panic!("expected Patched, got {other:?}"),
        }
    }

    #[test]
    fn patch_is_idempotent() {
        let PatchOutcome::Patched(patched) = patch_source(TAIL) else {
            panic!("expected Patched");
        };
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn patch_skips_when_anchor_missing() {
        let altered = "\t\texports.apply = apply;\n\t\texports.inject = inject;\n";
        assert_eq!(patch_source(altered), PatchOutcome::AnchorMissing);
    }
}