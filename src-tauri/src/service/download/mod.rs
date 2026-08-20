mod core;
mod extractor;
mod installable;
mod progress;
mod utils;

// 导出公共接口
pub use core::{
    download_file, ensure_extract, fetch_dsh_pkg_tags, fetch_latest_dsh_pkg_info,
    fetch_node_sha256, parse_version_from_tag, resolve_update, verify_sha256, LatestDshPkg,
    UpdateCheck,
};
pub use installable::{Dsh, Installable, Nodejs, Pnpm};
pub use progress::ProgressTracker;
// GitHub API 限流冷却器：任何访问 api.github.com 的服务都应收敛到这一个入口
pub use utils::github_api;
