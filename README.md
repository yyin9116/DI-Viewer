# DI-Viewer

DI-Viewer 是一个面向桌面场景的悬浮浏览器项目，目标是用更轻量的方式，把网页能力嵌入到日常工作流中。

项目目前包含两套并行实现：

- `pyside-di-viewer/`：PySide6 版本（Python 技术栈）
- `tauri-di-viewer/`：Tauri 版本（Rust + WebView 技术栈）
- `shared/`：两端共享的注入 UI 资源（`inject.html` / `inject.css` / `inject.js`）

## 用途与定位

DI-Viewer 适合以下场景：

- 视频学习或直播时的悬浮控制
- 需要常驻网页工具面板的工作场景
- 对窗口透明、置顶、吸附、快捷控制有明确需求的用户
- 需要多标签并行浏览，同时保持轻量桌面体验的场景

核心定位是“可叠加在桌面上的高可控浏览器容器”，而不是传统全屏浏览器替代品。

## 核心特点

- 悬浮窗口：支持无边框、置顶、透明度调节
- 交互增强：侧边栏注入式控制面板
- 多标签：支持并行标签管理与切换
- 窗口控制：吸附、最小化、锁定位置、窗口尺寸预设
- 媒体辅助：播放控制、快进快退、全屏请求
- 数据能力：书签与配置持久化

## 创新点

- 双实现并行架构
- 同一产品同时保留 PySide 与 Tauri 两种实现路径，降低技术路线单点风险
- 共享注入资产层
- 将交互 UI 注入资源独立到 `shared/`，两端复用同一套界面与行为逻辑
- 真多 WebView 标签方案（Tauri）
- 通过多窗口模型实现更接近并行渲染的标签体验，而非单窗口伪会话切换
- 故障可观测性增强
- 桥接调用由静默失败升级为可观测日志，便于排障与稳定性演进
- 会话恢复机制
- 标签与窗口状态持久化，重启后可恢复到接近上次工作现场

## 设计架构

```text
DI-Viewer/
  pyside-di-viewer/      # Python + PySide6 实现
  tauri-di-viewer/       # Rust + Tauri 实现
  shared/                # 共用注入资源
```

架构分层：

- 宿主层：窗口生命周期、系统能力、持久化
- 浏览层：WebView 渲染与导航控制
- 注入层：侧边栏 UI、桥接协议、功能入口
- 配置层：热键、书签、窗口参数

## 技术栈

- PySide 方案：Python + PySide6 + Qt WebEngine + QWebChannel
- Tauri 方案：Rust + Tauri v2 + WebView + 前端注入
- 前端资源：HTML/CSS/JavaScript（共享注入资源）

## 环境要求

PySide 版本：

- Python 3.10+
- 依赖见 `pyside-di-viewer/requirements.txt`

Tauri 版本：

- Node.js 20+
- Rust stable
- Windows 打包依赖 NSIS

## 使用方法

运行 PySide 版本：

```powershell
cd pyside-di-viewer
pip install -r requirements.txt
python main.py
```

运行 Tauri 版本（开发模式）：

```powershell
cd tauri-di-viewer
npm ci
npm run tauri dev
```

打包 Tauri 为 Windows EXE：

```powershell
cd tauri-di-viewer
npm ci
npm run tauri build
```

构建产物通常位于：

`tauri-di-viewer/src-tauri/target/release/bundle/nsis/*.exe`

## 当前状态说明

- 项目已具备可运行的双实现结构
- 已配置 GitHub Actions 自动构建发布流程（按 tag 触发）
- 当前仍在持续优化跨平台打包稳定性与产物完整性
