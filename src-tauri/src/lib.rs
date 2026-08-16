mod bridge;
mod config;
mod core;
mod logger;
mod service;
mod task;

use core::utils::show_window;
use tauri::{
    ipc::Invoke,
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    webview::DownloadEvent,
    Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, Wry,
};

/// 下载完成事件载荷：`on_download` 的 Finished 分支向前端 emit，
/// 由桌面外壳展示"已保存 + 打开文件夹"提示（iframe 内的下载对用户不可见）。
#[derive(Clone, serde::Serialize)]
struct DownloadFinishedPayload {
    /// 原始下载地址（dsh 的 /api/session.export?sessionId=...）
    url: String,
    /// 保存到本地的完整路径；失败或平台拿不到路径时为 None
    path: Option<String>,
    /// 下载是否成功
    success: bool,
}

// setup app
fn setup(app_handle: tauri::AppHandle) {
    // 启动进程监控（tick 检测 dsh 服务状态）
    service::scheduler::start(&app_handle);

    // 开机自启动：已安装且开启 auto_start 时拉起服务
    let app_for_start = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let setting = config::get_store_dat_setting(&app_for_start);
        if !setting.auto_start {
            log::debug!("auto_start disabled, skipping startup");
            return;
        }
        if let Err(e) = service::workflow::start(app_for_start).await {
            log::error!("start failed: {}", e);
        }
    });

    // 命令行集成自愈：已安装且开启时，确保 shim 与 PATH 注册完整
    // （shim 被删除、PATH 条目丢失等情况下自动重建）
    tauri::async_runtime::spawn(async move {
        let setting = config::get_store_dat_setting(&app_handle);
        if !setting.installed || !setting.cli_link_enabled {
            return;
        }
        if let Err(e) = service::cli::ensure(&app_handle) {
            log::warn!("cli link self-heal failed: {e}");
        }
    });
}

// setup tray
fn tray<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    // 使用默认窗口图标
    let icon = app.default_window_icon().unwrap().clone();

    // 构建菜单
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "打开面板", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
        ],
    )?;

    fn handle_menu_event<R: Runtime>(app: &tauri::AppHandle<R>, event: &MenuEvent) {
        match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    show_window(&window);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        }
    }

    fn handle_tray_icon_event<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, event: &TrayIconEvent) {
        let app = tray.app_handle();
        match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } => {
                if let Some(window) = app.get_webview_window("main") {
                    show_window(&window);
                }
            }
            _ => {}
        }
    }

    // 构建托盘图标
    let _ = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Deepseek Harness Desktop")
        .on_menu_event(move |app, event| handle_menu_event(app, &event))
        .on_tray_icon_event(move |tray, event| handle_tray_icon_event(&tray, &event))
        .build(app)?;

    Ok(())
}

// configure invoke handler
fn handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        bridge::cmd::install_dependencies,
        bridge::cmd::check_dsh_update,
        bridge::cmd::launch_harness,
        bridge::cmd::shutdown_harness,
        bridge::cmd::restart_harness,
        bridge::cmd::get_dsh_status,
        bridge::cmd::proxy_health_check,
        bridge::cmd::get_runtime_info,
        bridge::cmd::get_app_config,
        bridge::cmd::update_app_config,
        bridge::cmd::get_cli_link_status,
        bridge::cmd::open_in_browser,
        bridge::cmd::copy_service_url,
        bridge::cmd::reveal_data_dir,
        bridge::cmd::reveal_in_folder,
        bridge::cmd::read_service_logs,
        bridge::cmd::clear_service_logs,
        bridge::cmd::set_language,
        bridge::cmd::toggle_sidebar,
        bridge::cmd::get_dsh_theme,
    ]
}

// configure tauri builder
fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        // 主窗口在这里手动创建（不再从 tauri.conf.json 声明）：
        // config 声明的窗口无法挂载 on_download，而内嵌 iframe 的 dsh 页面
        // 触发下载时 WebView2 静默保存、用户零感知，需要接管下载以给出反馈。
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Deepseek Harness Desktop")
                .inner_size(1280.0, 840.0)
                .min_inner_size(860.0, 620.0)
                .resizable(true)
                .decorations(true)
                // 恢复 iframe 内 HTML5 拖拽（拖入图片/拖动元素）：
                // Tauri 默认注册 wry drag_drop_handler → WebView2 SetAllowExternalDrop(false)
                // 并注入 IDropTarget 接管拖放，iframe 内拖拽被禁用。
                // 注意不能用 .drag_and_drop(false)：它只设置 tao 窗口层的拖放开关
                // （tauri issue #13761），不影响 webview 层，拖拽依旧失效；
                // disable_drag_drop_handler 才能关掉 wry 的接管（等价于旧配置 dragDropEnabled: false）。
                .disable_drag_drop_handler()
                .on_download(|webview, event| match event {
                    DownloadEvent::Requested { url, destination } => {
                        // 接管下载：保存到系统下载目录，重名时自动加 " (n)" 后缀
                        *destination = config::unique_download_path(destination);
                        log::info!(
                            "[download] requested {} -> {}",
                            url,
                            destination.display()
                        );
                        true
                    }
                    DownloadEvent::Finished {
                        url,
                        path,
                        success,
                    } => {
                        let path_str = path.as_ref().map(|p| p.to_string_lossy().to_string());
                        let payload = DownloadFinishedPayload {
                            url: url.to_string(),
                            path: path_str,
                            success,
                        };
                        let _ = webview.emit("harness-download-finished", payload);
                        log::info!(
                            "[download] finished {} success={} path={:?}",
                            url,
                            success,
                            path
                        );
                        true
                    }
                    // DownloadEvent 为 #[non_exhaustive]，预留未来变体
                    _ => true,
                })
                .build()?;
            tray(&app.handle())?;
            setup(app.handle().clone());
            Ok(())
        })
        // 点击关闭按钮时隐藏到托盘而不是退出程序
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        // Opener plugin
        .plugin(tauri_plugin_opener::init())
        // FS plugin
        .plugin(tauri_plugin_fs::init())
        // Simple Store plugin
        .plugin(tauri_plugin_store::Builder::new().build())
        // Clipboard plugin
        .plugin(tauri_plugin_clipboard_manager::init())
}

// run app
pub fn run() {
    // 初始化日志系统
    logger::init();

    builder()
        .invoke_handler(handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 退出时回收 Harness 进程：不回收的话，node 进程会在应用退出后
            // 残留并把原生模块 DLL（如 sharp 的 libvips-42.dll）锁在内存，
            // 下次启动重新解压时会失败（Windows os error 32）
            if let tauri::RunEvent::Exit = event {
                let setting = config::get_store_dat_setting(app_handle);
                if setting.installed {
                    service::workflow::stop_on_exit(app_handle.clone(), setting.port);
                }
            }
        });
}
