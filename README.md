# Map Forge

![Map Forge](/.github/images/map-forge.png)

**Map Forge** is a modern Tibia OTBM map editor, fully **vibe coded** during my limited free time, so it doesn't follow any established good practices yet.

It is currently an **experiment** focused on delivering a new and improved map editing experience for Open Tibia projects.

## ⚠️ Important Warning

**Always create a backup of your map and its XMLs before using Map Forge.** This application is experimental and may corrupt your files. Map Forge can keep rolling backups for you - enable **Backup on save** in Preferences (on by default).

## Download

Grab the latest release for Windows:

- **Installer (recommended)**: [map-forge-setup.exe](https://github.com/Frenvius/map-forge/releases/latest/download/map-forge-setup.exe)
- **Portable**: [map-forge-portable.exe](https://github.com/Frenvius/map-forge/releases/latest/download/map-forge-portable.exe)

If installed the app updates itself automatically on launch.

## About

This project leverages modern web technologies to create a powerful desktop application:
- **Tauri**: For a lightweight, secure, and fast desktop experience.
- **React & Vite**: For a dynamic and high-performance user interface.
- **Shadcn UI**: For a beautiful and accessible design system.
- **Rust**: For fast OTBM/OTB parsing, sprite decoding, and binary IPC.

## Building from Source

### Prerequisites

- [Bun](https://bun.sh): package manager and JavaScript runtime
- [Rust](https://www.rust-lang.org/tools/install): stable toolchain (installed via `rustup`)
- Tauri system dependencies for your OS. Follow the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/). On Windows you mainly need the Microsoft C++ Build Tools and the WebView2 runtime.

### Setup

```bash
git clone https://github.com/Frenvius/map-forge.git
cd map-forge
bun install
```

### Development

```bash
bun run tauri:dev   # run the full desktop app (frontend + Rust backend)
bun run dev         # run the Vite frontend only (browser, no Tauri APIs)
```

### Production build

```bash
bun run tauri:build
```

The portable executable is written to `src-tauri/target/release/`, and the installer bundle to `src-tauri/target/release/bundle/`.

## Issues

If you encounter any problems, please open an issue.
