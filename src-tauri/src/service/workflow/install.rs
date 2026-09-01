//! 安装环境（Node.js 运行时 + 打包的 Harness 发行版 + pnpm；Windows 缺失
//! 系统 Git 时再自动安装免安装 MinGit）。原 `workflow::install`。

use crate::config;
use crate::service::download;
use tauri::Manager;

use super::process::{has_owned_process, stop, terminate_stale_harness_processes};

/// 安装环境（Node.js 运行时 + 打包的 Harness 发行版 + pnpm；Windows 缺失
/// 系统 Git 时再自动安装免安装 MinGit）。
///
/// 返回是否真正落盘更新了 Harness（dsh 任务实际下载并解压）；仅重装
/// Node/pnpm/Git 或全部任务被跳过时返回 false，供调用方决定是否重启页面。
pub async fn install(
    app_handle: &tauri::AppHandle,
    dsh_latest: Option<download::LatestDshPkg>,
) -> Result<bool, String> {
    log::info!("Starting installation process");
    // dsh 任务实际下载解压时置 true
    let mut dsh_updated = false;

    // 元数据先行：dsh 的下载 URL 与 SHA-256 digest 必须同源于同一次解析所得的
    // release。下载发起前先完成元数据解析（API → Atom → expanded_assets 兜底链
    // 在 fetch_dsh_pkg_version / fetch_latest_dsh_pkg_info 内部，这里带退避重试）；
    // 彻底失败时提前返回，绝不用 `releases/latest` 等未锚定源发起下载——否则
    // URL（latest 内容随上游漂移）与 digest（pinned tag）跨版本错配，表现为
    // 必然失败的 INTEGRITY_CHECK_FAILED，且白下一份 40MB 级资产（0.10.0 用户
    // API 限流现场复盘）。附带来的收益：outdated 版本判定不再因元数据缺失跳过。
    let dsh_latest = ensure_dsh_metadata(app_handle, dsh_latest).await?;

    // 安装前先停止本应用持有的 Harness 服务：运行中的 node 进程会把
    // 原生模块 DLL（如 sharp 的 libvips-42.dll）加载进内存并锁住文件，
    // 不停止的话覆盖解压必然失败（Windows os error 32）。
    // 进程归属以启动时记录的 PID 为准，不根据端口结束未知程序。
    if has_owned_process() {
        log::info!("Stopping running Harness service before installation");
        stop(app_handle.clone()).await?;
    }
    // 只停本应用持有的进程还不够：历史崩溃/强杀残留的孤儿 Harness 实例
    // （不在 .harness.pid 标记中）同样从 dependencies/dsh 启动、占用目录文件
    // 句柄，会导致更新切换目录失败（INSTALL_BACKUP_FAILED, os error 32）。
    // 按命令行路径精确清扫所有本应用 dsh 安装目录启动的进程。
    // 枚举/结束涉及 powershell 枚举与 taskkill（同步阻塞），移出 Tokio 线程。
    {
        let handle = app_handle.clone();
        tauri::async_runtime::spawn_blocking(move || {
            terminate_stale_harness_processes(&handle);
        })
        .await
        .map_err(|e| format!("STOP_FAILED: {e}"))?;
    }

    let window = app_handle
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;
    log::debug!("Main window obtained");
    let mut tasks: Vec<Box<dyn download::Installable>> = vec![
        Box::new(download::Nodejs),
        Box::new(download::Dsh),
        Box::new(download::Pnpm),
    ];
    // Windows Sandbox 等空白环境没有 Git；仅 Windows 加入第 4 项，若系统 Git
    // 可真实执行则 Installable 会跳过，不重复下载也不修改系统 PATH。
    #[cfg(windows)]
    tasks.push(Box::new(download::Git));
    // 每项均有下载/解压两个阶段，按实际平台任务数计算，避免进度提前到 100%。
    let mut tracker = download::ProgressTracker::new(&window, tasks.len() * 2);
    log::info!("Task list created, {} tasks total", tasks.len());

    for (index, task) in tasks.iter().enumerate() {
        let kind = task.kind();
        log::debug!("Processing task {}/{}", index + 1, tasks.len());
        // 已安装但版本/commit 与最新 release 不一致时强制重新下载。
        // 版本优先（与 resolve_update 的判定完全一致）：dsh 的 rc 发布会复用
        // 同一 git commit（record_commit 不变），只比 commit 会把 rc.8 之于
        // rc.7 误判为"已最新"而跳过下载——日志表现为"All installation tasks
        // completed"但实际什么都没下载，重启后仍是旧版，且前端丢掉更新提示。
        let outdated = kind == download::InstallKind::Dsh && {
            // 元数据先行后恒有解析结果，版本判定不再因元数据缺失而跳过
            let installed_version = config::get_dsh_version(app_handle);
            let latest_version = download::parse_version_from_tag(&dsh_latest.tag);
            // 版本号可解析且不同 → 必须更新；版本不可解析时退回同一发布判定
            let version_differs = match (installed_version.as_deref(), latest_version.as_deref()) {
                (Some(a), Some(b)) => a != b,
                _ => false,
            };
            // 「同一发布」判定与 resolve_update 完全一致：记录 tag 与最新 tag
            // 相同、或记录 commit 与 release 的任一合法标识（完整 SHA / build-id）
            // 一致。限流期安装会把 build-id 写进记录，API 恢复后解析出的完整
            // SHA 与之不等但仍是同一 release，不能据此误判为过期而重下。
            version_differs
                || !download::record_matches_latest_release(
                    config::get_dsh_pkg_commit(app_handle).as_deref(),
                    config::get_dsh_pkg_tag(app_handle).as_deref(),
                    &dsh_latest,
                )
        };
        if task.check_installed(app_handle) && !outdated {
            log::debug!(
                "Task {} already installed and up to date, skipping",
                index + 1
            );
            tracker.skip_phases(2);
            continue;
        }

        log::info!("Task {} not installed, starting installation", index + 1);

        // 1. 下载
        tracker.start_phase(
            "download",
            &format!(
                "{} {}",
                config::i18n::t("install.downloading"),
                task.title()
            ),
        );
        // 下载 URL 对 dsh 也是完全确定可算的（DSH_CORE_URL + 平台文件名），
        // 无需依赖 GitHub API 元数据；api.github.com 限流/被代理拦截时
        // （mac 首次启动常见）仍能拿到真实下载地址，避免整次安装被瞬时失败卡死。
        // dsh 核心按 官方直连 → 站点自有反代 → ghfast.top 镜像 的顺序兜底
        // （下载层会在界面上告知用户）；其余任务保持单一官方源。
        let (urls, name) = if kind == download::InstallKind::Dsh {
            // 元数据先行后 dsh_latest 为解析所得值；URL 与 digest 同源于该次
            // 解析（asset_url 缺失的防御性分支也按同一 tag 确定性推导）。
            let primary = dsh_primary_url(&dsh_latest)?;
            let name = primary.rsplit('/').next().unwrap_or("").to_string();
            let urls = dsh_source_urls(&primary);
            (urls, name)
        } else {
            let url = task.get_download_url()?;
            let name = url.rsplit('/').next().unwrap_or("").to_string();
            (vec![url], name)
        };
        // 取文件名用于解压类型判定；下载 URL 正常必含 '/'，但这里不 panic，
        // 防御性兜底为空串（后续 ensure_extract 会因无法判定类型而报错返回，
        // 不再让进程崩溃）。
        log::debug!("Download URL: {}", urls.join(" -> "));
        log::debug!("File name: {}", name);
        let buffer = download::download_file_from_sources(&tracker, urls).await?;
        log::info!("Download completed, file size: {} bytes", buffer.len());
        let expected_digest = match kind {
            download::InstallKind::Node => {
                download::fetch_node_sha256(task.get_download_url()?.as_str()).await?
            }
            download::InstallKind::Dsh => {
                // 元数据先行：digest 与下载 URL 同源于循环前完成的那次解析
                // （见 install 开头的 ensure_dsh_metadata）。这里直接取用，
                // 不再在下载之后才补拉元数据——那会让 URL 与 digest 来源分叉。
                dsh_latest.digest.clone().ok_or_else(|| {
                    "DSH_INTEGRITY_UNAVAILABLE: trusted release digest is required".to_string()
                })?
            }
            download::InstallKind::Pnpm => config::PNPM_SHA256.to_string(),
            #[cfg(windows)]
            download::InstallKind::Git => config::get_mingit_sha256()?.to_string(),
            #[cfg(not(windows))]
            download::InstallKind::Git => {
                return Err(
                    "INSTALL_TASK_INVALID: Git task not supported on this platform".to_string(),
                )
            }
        };
        download::verify_sha256(&buffer, &expected_digest)?;
        log::info!("Download integrity verified for task {}", index + 1);
        tracker.end_phase();

        // 2. 解压
        tracker.start_phase(
            "extract",
            &format!("{} {}", config::i18n::t("install.extracting"), task.title()),
        );
        let dest = task.get_install_path(app_handle);
        log::debug!("Installation path: {:?}", dest);
        download::ensure_extract(&tracker, name, buffer, dest).await?;
        log::info!("Extraction completed");
        tracker.end_phase();

        // 记录本次安装对应的 release tag 与 commit，供下次启动比对
        if kind == download::InstallKind::Dsh {
            dsh_updated = true;
            config::set_dsh_pkg_commit(app_handle, dsh_latest.commit.clone());
            config::set_dsh_pkg_tag(app_handle, dsh_latest.tag.clone());
        }
    }

    log::info!("All installation tasks completed");
    tracker.update(
        100.0,
        config::i18n::t("install.done"),
        "All tasks completed".into(),
    );

    Ok(dsh_updated)
}

/// dsh 资产的下载源列表：官方直连 → 站点自有反代 → ghfast.top 公益镜像。
///
/// 顺序含义：自有反代域名在我们控制下（不受公益镜像限速/停服影响），
/// 排在公益镜像之前；三者内容一致，均受调用方的 SHA-256 校验约束。
fn dsh_source_urls(primary: &str) -> Vec<String> {
    vec![
        primary.to_string(),
        config::proxy_download_url(primary),
        config::mirror_download_url(primary),
    ]
}

/// 元数据先行：dshLatest 为 None 时带退避重取（重试 3 次）；彻底失败返回
/// `DSH_INTEGRITY_UNAVAILABLE`，调用方 MUST NOT 发起未锚定元数据的下载。
async fn ensure_dsh_metadata(
    app_handle: &tauri::AppHandle,
    dsh_latest: Option<download::LatestDshPkg>,
) -> Result<download::LatestDshPkg, String> {
    if let Some(info) = dsh_latest {
        return Ok(info);
    }
    fetch_dsh_metadata_with_retry(|| async {
        // 推荐版本清单存在时按版本精确匹配（rc 是 pre-release，不能走
        // `/releases/latest` 端点）；否则取最新非预览发行版。
        match config::recommended_dsh_version(app_handle) {
            Some(version) => download::fetch_dsh_pkg_version(&version).await,
            None => download::fetch_latest_dsh_pkg_info().await,
        }
    })
    .await
}

/// 带退避的元数据重取（3 次封顶）。独立成泛型函数以便注入 fetcher 做单测
/// （真实 fetch 依赖网络，测试需可离线复现失败/恢复路径）。
async fn fetch_dsh_metadata_with_retry<F, Fut, T>(mut fetch: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    for attempt in 0..3 {
        match fetch().await {
            Ok(info) => return Ok(info),
            Err(e) if attempt < 2 => {
                log::warn!(
                    "Retrying dsh release metadata fetch ({}/3), will retry: {}",
                    attempt + 1,
                    e
                );
                tokio::time::sleep(std::time::Duration::from_millis(500 * (attempt as u64 + 1)))
                    .await;
            }
            Err(e) => return Err(dsh_integrity_unavailable(&e)),
        }
    }
    unreachable!("loop returns on attempt < 2 or terminal error")
}

/// 元数据彻底不可得的统一错误（fail fast，不发起无锚定下载）。
fn dsh_integrity_unavailable(detail: &str) -> String {
    format!(
        "DSH_INTEGRITY_UNAVAILABLE: 无法获取 Harness 发行版的完整性校验信息（{detail}），请检查网络后重试"
    )
}

/// dsh 下载主源：元数据资产 URL 优先；为空（防御性）时按同一 tag 确定性推导，
/// 绝不回退 `releases/latest/download/`（与 digest 同源原则，见设计 D3）。
fn dsh_primary_url(info: &download::LatestDshPkg) -> Result<String, String> {
    if info.asset_url.is_empty() {
        config::get_dsh_download_url_for_tag(&info.tag)
    } else {
        Ok(info.asset_url.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        dsh_integrity_unavailable, dsh_primary_url, dsh_source_urls, fetch_dsh_metadata_with_retry,
    };
    use crate::service::download::LatestDshPkg;

    const ASSET: &str = "https://github.com/dsh-tauri-desk/deepseek-harness-pkg/releases/download/dsh-0.1.1-rc.2-32485170079/deepseek-harness-pkg-macos-x64.zip";

    fn info(asset_url: &str) -> LatestDshPkg {
        LatestDshPkg {
            tag: "dsh-0.1.1-rc.2-32485170079".into(),
            commit: "32485170079".into(),
            asset_url: asset_url.into(),
            digest: Some(format!("sha256:{}", "a".repeat(64))),
        }
    }

    #[test]
    fn dsh_sources_order_official_proxy_mirror() {
        let urls = dsh_source_urls(ASSET);
        assert_eq!(urls.len(), 3);
        assert_eq!(urls[0], ASSET);
        assert_eq!(
            urls[1],
            format!(
                "https://dshdesktop.pages.dev/dl/{}",
                ASSET.trim_start_matches("https://")
            )
        );
        assert_eq!(urls[2], format!("https://ghfast.top/{ASSET}"));
    }

    #[test]
    fn primary_url_prefers_metadata_asset_url() {
        assert_eq!(dsh_primary_url(&info(ASSET)).unwrap(), ASSET);
    }

    /// asset_url 为空（防御性分支）时按同一 tag 确定性推导，
    /// URL 含 `releases/download/<tag>/` 段且绝不回退 latest。
    #[test]
    fn primary_url_falls_back_to_pinned_tag_not_latest() {
        let url = dsh_primary_url(&info("")).unwrap();
        assert!(
            url.contains("/releases/download/dsh-0.1.1-rc.2-32485170079/"),
            "应锚定解析所得 tag: {url}"
        );
        assert!(!url.contains("/releases/latest/"), "不得回退 latest: {url}");
    }

    /// 元数据彻底失败 → 错误前缀 DSH_INTEGRITY_UNAVAILABLE（调用方不会发起下载）。
    #[tokio::test]
    async fn retry_fails_fast_with_integrity_unavailable() {
        let result = fetch_dsh_metadata_with_retry(|| async {
            Err::<LatestDshPkg, _>("rate limited".to_string())
        })
        .await;
        let err = result.unwrap_err();
        assert!(
            err.starts_with("DSH_INTEGRITY_UNAVAILABLE"),
            "错误前缀应为 DSH_INTEGRITY_UNAVAILABLE: {err}"
        );
        assert!(err.contains("rate limited"));
    }

    /// 瞬时失败后恢复 → 重试成功拿到元数据（不整体失败）。
    #[tokio::test]
    async fn retry_succeeds_after_transient_failure() {
        let mut attempts = 0;
        let result = fetch_dsh_metadata_with_retry(|| {
            attempts += 1;
            let attempts = attempts;
            async move {
                if attempts < 2 {
                    Err("transient".to_string())
                } else {
                    Ok(info(ASSET))
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(result.asset_url, ASSET);
    }

    #[test]
    fn integrity_unavailable_message_shape() {
        let msg = dsh_integrity_unavailable("HTTP 403");
        assert!(msg.starts_with("DSH_INTEGRITY_UNAVAILABLE"));
        assert!(msg.contains("HTTP 403"));
    }
}
