# Issue #63 — 自动记住调整后的窗口大小和位置

## 目标

调整窗口大小与位置后，重启应用保持窗口的大小、位置与最大化状态。

## 实现方案

不使用官方 `tauri-plugin-window-state`：本项目主窗口是程序化创建、无标题栏
（`decorations(false)`）、关闭时隐藏到托盘而非销毁、release 叠加单例复用，且要求
几何数据落进与本项目一致的 store 文件（`.store.dat` / `.store.dev.dat`）。因此基于
已有的 `tauri-plugin-store` 手动读写，几何记录的时机与恢复流程完全可控。

## 改动清单

- [x] `src-tauri/src/config/window_state.rs`（新增）：`WindowState` 几何结构体 +
      `get_window_state` / `save_geometry` / `restore_main_window`。读取/写入沿用
      `setting` 的 store 文件选择（debug 与生产隔离）；恢复时把几何夹紧到当前可见
      屏幕（防止外接屏被拔出后窗口跑到屏幕外），无历史记录时保持 builder 默认的
      1280×840（居中）。
- [x] `src-tauri/src/config/constants.rs`：新增 `STORE_WINDOW_STATE_KEY`。
- [x] `src-tauri/src/config/mod.rs`：导出 `window_state` 模块。
- [x] `src-tauri/src/desktop/builder.rs`：
  - `build_main_window` build() 成功后调用 `restore_main_window`（先设尺寸/位置，再
    按需 `maximize()`）。
  - `on_window_event` 处理 `Moved`/`Resized` 时调用 `save_geometry`。

## 验证

- 拖拽移动窗口 → 重启：位置还原。
- 调整大小 → 重启：尺寸还原。
- 最大化 → 重启：保持最大化。
- 首次启动（无历史）：落在默认 1280×840（居中）。
- 附带夹紧：保存的位置不可见时回落到主屏居中。
