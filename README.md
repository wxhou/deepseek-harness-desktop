<p align="center">
  <a href="https://github.com/hairyf/deepseek-harness-desktop">
    <img src="public/favicon.svg" width="112" alt="DeepSeek Harness Desktop" />
  </a>
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  <em>A one-click desktop app for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> — run the full agent harness locally without installing Node.js, pnpm, or Docker.</em>
</p>

<p align="center">
  <strong>English</strong> · <a href="./README.zh.md">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.6-4D6BFE?style=flat-square" alt="version 0.1.6" />
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-black?style=flat-square" alt="Windows | macOS | Linux" />
</p>

<p align="center">
  <img src="docs/preivew.png" width="720" alt="DeepSeek Harness Desktop preview" />
</p>

> **Status: developer preview.** The upstream `dsh` is still iterating rapidly with compatibility-breaking changes; this project tracks it closely.

## Features

| | |
| --- | --- |
| **One-click install** | On first launch the app installs the prebuilt Harness bundle and reuses a compatible local Node.js (v22.15.0+ / v23.8.0+) when present, otherwise downloads the bundled Node.js runtime — no manual setup. |
| **Self-healing updates** | Each launch compares the installed bundle against the latest release commit from [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg) and re-downloads automatically when it differs, so upstream fixes ship without a manual reinstall. |
| **Silent update prompt** | Once installed, launches skip the setup screens and boot straight into the harness, then check for a newer release in the background and show a small "Update Now / Later" prompt. |
| **Runs 100% locally** | The `dsh web` service runs at `http://127.0.0.1:3080`. Profiles, sessions, and settings all live on your machine. |
| **Privacy by default** | Isolated `$DSH_HOME` and telemetry disabled out of the box (`DSH_TELEMETRY_DISABLED=1`). |
| **Native window shell** | A frameless window with a custom top drag bar and window controls (minimize / maximize / restore / close, double-click to maximize). |
| **Theme-aware chrome** | The desktop shell follows the dsh page theme, so the sidebar and window controls adapt to light and dark themes. |
| **Embedded web UI** | The complete DeepSeek Harness interface runs inside the native window, with a sidebar for version info, service address, port, auto-start, logs, connection status, and restart / stop / open-in-browser / copy URL / open data folder / language actions. |
| **Cross-platform** | Installers for Windows (NSIS/MSI), macOS (DMG), and Linux (AppImage). |
| **Bilingual UI** | The interface ships in Chinese and English. |

## Quick Start

1. Download the installer for your platform from the [Releases](https://github.com/hairyf/deepseek-harness-desktop/releases) page.
2. Install and launch the app.
3. On the first run the app installs its dependencies: if a compatible Node.js (v22.15.0+ / v23.8.0+) is already on your machine it is reused as-is; otherwise the Node.js runtime and the prebuilt Harness bundle are downloaded (a few hundred MB in total). When setup finishes, the embedded Harness UI opens at `http://127.0.0.1:3080`.

> First run requires a network connection. Everything after that runs locally. Once installed, later launches skip the setup screens and boot straight into the harness; a silent prompt appears when a newer Harness release is available.

**Requirements**

- Windows 10+ (64-bit)
- macOS 10.15+
- Linux (mainstream distributions that support AppImage)
- Network on first launch

The app bundles Node.js **v22.22.0 LTS**, which satisfies the Harness requirement of **v22.15.0+ or v23.8.0+**. On first launch it first checks for a local Node.js installation: any compatible version is reused directly and the bundled runtime download is skipped.

## Development

### Prerequisites

- Node.js 20+
- Rust 1.77+
- pnpm 9+
- Platform build toolchain (Windows: MSVC + WebView2; macOS: Xcode CLT; Linux: WebKit2GTK)

### Run in dev mode

```bash
git clone https://github.com/hairyf/deepseek-harness-desktop.git
cd deepseek-harness-desktop
pnpm install
pnpm tauri dev
```

### Build installers

```bash
pnpm tauri build
```

### Regenerate icons

```bash
pnpm icons
```

## How It Works

```text
┌──────────────────────────────────────────────┐
│ Tauri WebView (React)                        │
│   setup state machine → progress → iframe    │
│   loads the dsh web UI + sidebar controls    │
└──────────────────────┬───────────────────────┘
                       │ invoke commands + events
┌──────────────────────┴───────────────────────┐
│ Tauri Rust backend                           │
│   service/download  installer + extraction   │
│   service/workflow  dsh process lifecycle    │
│   task              dsh health checks        │
└──────┬───────────────────────────┬───────────┘
       │                           │
  runtime/ (Node.js v22.22.0)   dependencies/dsh/ (prebuilt bundle)
       └─────────────┬─────────────┘
                     ▼
   dsh --profile web --host 127.0.0.1 --port 3080
                     │  DSH_HOME=<app-data>/data/dsh
                     ▼
        http://127.0.0.1:3080/  ← embedded UI
```

- The prebuilt Harness bundle is published by [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg); see [docs/PKG-CONTRACT.md](docs/PKG-CONTRACT.md) for the release contract.
- On every launch the app fetches the latest release commit from `deepseek-harness-pkg` and re-downloads the bundle when the installed one is outdated (the local install is kept when GitHub is unreachable).
- Full architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Data Directory

The data directory follows the Tauri bundle identifier (`io.github.hairyf.deepseek-harness-desktop`):

- Windows: `%APPDATA%\io.github.hairyf.deepseek-harness-desktop\`
- macOS: `~/Library/Application Support/io.github.hairyf.deepseek-harness-desktop/`
- Linux: `~/.local/share/io.github.hairyf.deepseek-harness-desktop/`

It contains:

- `runtime/` — bundled Node.js runtime
- `dependencies/dsh/` — extracted Harness bundle
- `data/dsh/` — Harness user data (`$DSH_HOME`: profiles, sessions, settings)
- `logs/` — app and dsh service logs
- `.store.dat` — desktop settings (port, auto-start, language)

## FAQ

- **Port 3080 is already in use?** Change the port in the sidebar settings and restart the service.
- **What happens during the first-time setup?** The sidebar shows the install log and the live service log.
- **Why does the app download so much on first launch?** It downloads the Node.js runtime and the prebuilt Harness bundle (a few hundred MB) once; afterwards everything runs offline.
- **Why does the app contact GitHub on every launch?** It compares the installed Harness bundle against the latest release commit and re-downloads automatically when they differ, so upstream fixes arrive without a manual reinstall. If GitHub is unreachable, the local install is kept as-is.
- **How do updates work after the first install?** Later launches skip setup, check in the background for a newer release, and show a small "Update Now / Later" prompt — updating re-downloads the bundle and restarts the service.

## Security Notes

- This project is for personal learning, research, and testing only — please do not use it commercially.
- `dsh` is an agent harness with **local code execution capability**. Run it only in a trusted, isolated environment, and never import untrusted configurations or plugins from unknown sources.
- The developers are not liable for any data loss or security issues arising from the use of this project.

## Related Projects

| Project | Purpose |
| --- | --- |
| [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | The upstream `dsh` (CLI + web UI + plugin architecture) |
| [deepseek-harness-pkg](https://github.com/hairyf/deepseek-harness-pkg) | Prebuilt Harness bundles consumed by this app |
| [n8n-desktop](https://github.com/tangtao646/n8n-desktop) | Reference implementation for one-click local desktop apps |

## Acknowledgements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the upstream project
- [n8n-desktop](https://github.com/tangtao646/n8n-desktop) — reference implementation
- [Tauri](https://tauri.app/) — the desktop framework

## License

[MIT](./LICENSE) © deepseek-harness-desktop contributors
