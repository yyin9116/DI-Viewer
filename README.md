# DI-Viewer

DI-Viewer 是一个桌面悬浮浏览器项目，当前包含两套并行实现：

- `pyside-di-viewer/`：PySide6 版本
- `tauri-di-viewer/`：Tauri 版本（Rust + WebView）
- `shared/`：两端共用的注入资源（`inject.html/css/js`）

## 功能概览

- 悬浮浏览器窗口
- 侧边栏注入交互
- 透明度、置顶、吸附、窗口控制
- 多标签页能力
- 书签与基础配置

## 目录结构

```text
DI-Viewer/
  pyside-di-viewer/      # PySide6 实现
  tauri-di-viewer/       # Tauri 实现
  shared/                # 共用注入资源
```

## 环境要求

### PySide 版本

- Python 3.10+
- 依赖见 `pyside-di-viewer/requirements.txt`

### Tauri 版本

- Node.js 20+
- Rust stable
- Windows 打包依赖 NSIS

## 使用方法

### 1) 运行 PySide 版本

```powershell
cd pyside-di-viewer
pip install -r requirements.txt
python main.py
```

### 2) 运行 Tauri 版本（开发模式）

```powershell
cd tauri-di-viewer
npm ci
npm run tauri dev
```

### 3) 打包 Tauri 为 Windows EXE

```powershell
cd tauri-di-viewer
npm ci
npm run tauri build
```

构建产物通常位于：

`tauri-di-viewer/src-tauri/target/release/bundle/nsis/*.exe`

## 说明

- 本仓库包含较多前端静态资源文件（图标、字体、SVG 等）。
- `shared/` 中的注入文件会被 PySide 与 Tauri 两端共同使用。
