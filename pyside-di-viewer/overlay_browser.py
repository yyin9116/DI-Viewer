"""
DI-Viewer - PySide6 Overlay Browser
Author: Yin
"""
import os
import sys
import json
import ctypes

from PySide6.QtWidgets import (
    QMainWindow, QApplication, QWidget, QVBoxLayout, QHBoxLayout,
    QStackedWidget, QPushButton, QLabel, QSizePolicy,
    QSystemTrayIcon, QMenu,
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import (
    QWebEngineScript, QWebEnginePage, QWebEngineProfile, QWebEngineSettings
)
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtCore import Qt, QUrl, QPoint, QSize, Signal, QTimer
from PySide6.QtGui import QIcon, QFont

from js_bridge import JsBridge

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)
SHARED_DIR = os.path.join(PROJECT_DIR, "shared")
CONFIG_FILE = os.path.join(BASE_DIR, "config", "config.json")
HISTORY_FILE = os.path.join(BASE_DIR, "history", "history.json")
BOOKMARKS_FILE = os.path.join(BASE_DIR, "bookmarks", "bookmarks.json")
ICON_FILE = os.path.join(BASE_DIR, "assets", "icon", "favicon.ico")

# Win32 constants
GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020

DEFAULT_URL = "https://limestart.cn/"

# ─── Tab bar stylesheet ─────────────────────────────────────────
TAB_BAR_STYLE = """
QWidget#tabBar {
    background: #ffffff;
    border-bottom: 1px solid rgba(0, 0, 0, 8);
}
QPushButton[class="tabBtn"] {
    border: none; background: transparent;
    padding: 4px 12px; margin: 2px 1px;
    border-radius: 8px; font-size: 12px;
    color: #888; font-weight: 500;
    max-width: 160px;
}
QPushButton[class="tabBtn"]:hover { background: #f0f0f5; color: #555; }
QPushButton[class="tabBtn"][active="true"] {
    background: rgba(115, 96, 255, 30); color: #7360ff; font-weight: 600;
}
QPushButton#newTabBtn {
    border: none; background: transparent;
    padding: 2px 8px; margin: 2px 2px;
    border-radius: 8px; font-size: 18px;
    color: #aaa; font-weight: 300;
}
QPushButton#newTabBtn:hover { background: #f0f0f5; color: #7360ff; }
QPushButton[class="closeTabBtn"] {
    border: none; background: transparent;
    padding: 0px; margin-left: 2px;
    font-size: 13px; color: #ccc;
    border-radius: 4px; min-width: 16px; max-width: 16px;
}
QPushButton[class="closeTabBtn"]:hover { background: rgba(255, 80, 80, 30); color: #f44; }
QPushButton[class="winCtrlBtn"] {
    border: none; background: transparent;
    padding: 0px; margin: 0px 1px;
    border-radius: 6px; min-width: 28px; max-width: 28px;
    min-height: 28px; max-height: 28px;
    font-size: 14px; color: #999;
}
QPushButton[class="winCtrlBtn"]:hover { background: #f0f0f5; color: #555; }
QPushButton#winCloseBtn:hover { background: rgba(255, 80, 80, 40); color: #e33; }
"""


class OverlayPage(QWebEnginePage):
    """Custom page — new-window requests open as new tabs."""

    def __init__(self, browser, parent=None):
        super().__init__(parent)
        self._browser = browser

    def createWindow(self, window_type):
        return self._browser.new_tab()["page"]


class OverlayBrowser(QMainWindow):
    """Main overlay browser window with multi-tab support."""

    opacity_changed = Signal(float)

    def __init__(self):
        super().__init__()

        # --- state ---
        self._click_through = False
        self._dragging = False
        self._drag_pos = QPoint()
        self._snap_threshold = 20
        self._is_shown = True
        self._tabs = []          # list of {view, page, channel}
        self._active_idx = 0

        # --- load persisted state ---
        state = self._load_history()
        self._opacity = state.get("window_opacity", 1.0)
        self._on_top = state.get("window_on_top", True)
        self._position_locked = state.get("position_locked", False)
        saved_tabs = state.get("tabs", [state.get("last_url", DEFAULT_URL)])
        saved_active = state.get("active_tab", 0)
        win_x = state.get("window_start_x", 560)
        win_y = state.get("window_start_y", 290)
        win_w = state.get("window_width", 800)
        win_h = state.get("window_height", 600)

        # --- window flags ---
        flags = Qt.FramelessWindowHint | Qt.Tool
        if self._on_top:
            flags |= Qt.WindowStaysOnTopHint
        self.setWindowFlags(flags)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setWindowOpacity(self._opacity)
        self.setGeometry(win_x, win_y, win_w, win_h)

        if os.path.exists(ICON_FILE):
            self.setWindowIcon(QIcon(ICON_FILE))
        self.setWindowTitle("貂宝")

        # --- shared bridge ---
        self.bridge = JsBridge(self)

        # --- inject scripts on default profile (shared by all tabs) ---
        self._setup_injection()

        # --- central layout: tab bar + stacked views ---
        central = QWidget(self)
        central.setAttribute(Qt.WA_TranslucentBackground)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # tab bar
        self._tab_bar = QWidget(central)
        self._tab_bar.setObjectName("tabBar")
        self._tab_bar.setFixedHeight(32)
        self._tab_bar.setStyleSheet(TAB_BAR_STYLE)
        self._tab_bar_layout = QHBoxLayout(self._tab_bar)
        self._tab_bar_layout.setContentsMargins(6, 0, 4, 0)
        self._tab_bar_layout.setSpacing(0)

        # "+" new tab button (left side, after tabs)
        self._new_tab_btn = QPushButton("+")
        self._new_tab_btn.setObjectName("newTabBtn")
        self._new_tab_btn.setFixedSize(28, 28)
        self._new_tab_btn.clicked.connect(lambda: self.new_tab(DEFAULT_URL))
        self._tab_bar_layout.addWidget(self._new_tab_btn)

        self._tab_bar_layout.addStretch()

        # right side: window control buttons (minimize, maximize, close)
        for btn_id, label, slot in [
            ("winMinBtn", "\u2013", lambda: self.showMinimized()),
            ("winMaxBtn", "\u25a1", lambda: self._toggle_maximize()),
            ("winCloseBtn", "\u00d7", lambda: self.close()),
        ]:
            b = QPushButton(label)
            b.setObjectName(btn_id)
            b.setProperty("class", "winCtrlBtn")
            b.setFixedSize(28, 28)
            b.clicked.connect(slot)
            self._tab_bar_layout.addWidget(b)

        layout.addWidget(self._tab_bar)

        # stacked widget
        self._stack = QStackedWidget(central)
        self._stack.setAttribute(Qt.WA_TranslucentBackground)
        layout.addWidget(self._stack)

        self.setCentralWidget(central)

        # --- create tabs from saved state ---
        if not saved_tabs:
            saved_tabs = [DEFAULT_URL]
        for url in saved_tabs:
            self._create_tab(url)
        saved_active = min(saved_active, len(self._tabs) - 1)
        self.switch_tab(saved_active)

        # --- global hotkeys (deferred so window is ready) ---
        QTimer.singleShot(500, self._bind_hotkeys)

        # --- system tray icon ---
        self._setup_tray()

    # ─── web property (current active view) ──────────────────────

    @property
    def web(self):
        if self._tabs:
            return self._tabs[self._active_idx]["view"]
        return None

    # ─── tab management ──────────────────────────────────────────

    def _create_tab(self, url=DEFAULT_URL):
        """Create a new tab internally (view + page + channel). Returns tab dict."""
        page = OverlayPage(self)
        page.setBackgroundColor(Qt.transparent)

        settings = page.settings()
        settings.setAttribute(QWebEngineSettings.JavascriptEnabled, True)
        settings.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.PlaybackRequiresUserGesture, False)

        channel = QWebChannel(page)
        channel.registerObject("bridge", self.bridge)
        page.setWebChannel(channel)

        view = QWebEngineView()
        view.setPage(page)

        tab = {"view": view, "page": page, "channel": channel}
        idx = len(self._tabs)
        self._tabs.append(tab)
        self._stack.addWidget(view)

        # tab bar button
        tab_widget = QWidget()
        tab_layout = QHBoxLayout(tab_widget)
        tab_layout.setContentsMargins(0, 0, 0, 0)
        tab_layout.setSpacing(0)

        btn = QPushButton("新标签页")
        btn.setProperty("class", "tabBtn")
        btn.setToolTip(url)
        btn.clicked.connect(lambda checked, i=idx: self.switch_tab(i))
        tab_layout.addWidget(btn)

        close_btn = QPushButton("\u00d7")
        close_btn.setProperty("class", "closeTabBtn")
        close_btn.setFixedSize(16, 16)
        close_btn.clicked.connect(lambda checked, i=idx: self.close_tab(i))
        tab_layout.addWidget(close_btn)

        tab["bar_widget"] = tab_widget
        tab["bar_btn"] = btn
        tab["bar_close"] = close_btn

        # insert before the "+" button (which is at index 0 initially, then shifts)
        insert_pos = len(self._tabs) - 1  # tabs list already has this tab appended
        self._tab_bar_layout.insertWidget(insert_pos, tab_widget)

        # update title when page loads
        page.titleChanged.connect(lambda title, b=btn: self._on_title_changed(b, title))

        view.load(QUrl(url))
        return tab

    def _on_title_changed(self, btn, title):
        label = title[:18] + "…" if len(title) > 18 else title
        btn.setText(label or "新标签页")
        btn.setToolTip(title)

    def new_tab(self, url=DEFAULT_URL):
        """Public: create and switch to a new tab. Returns tab dict."""
        tab = self._create_tab(url)
        self.switch_tab(len(self._tabs) - 1)
        return tab

    def close_tab(self, index):
        if len(self._tabs) <= 1:
            return  # don't close last tab
        if index < 0 or index >= len(self._tabs):
            return

        tab = self._tabs.pop(index)
        self._stack.removeWidget(tab["view"])
        tab["bar_widget"].setParent(None)
        tab["view"].deleteLater()
        tab["page"].deleteLater()

        # fix click connections — reconnect all buttons with correct indices
        for i, t in enumerate(self._tabs):
            t["bar_btn"].clicked.disconnect()
            t["bar_btn"].clicked.connect(lambda checked, idx=i: self.switch_tab(idx))
            t["bar_close"].clicked.disconnect()
            t["bar_close"].clicked.connect(lambda checked, idx=i: self.close_tab(idx))

        if self._active_idx >= len(self._tabs):
            self._active_idx = len(self._tabs) - 1
        elif self._active_idx > index:
            self._active_idx -= 1
        self.switch_tab(self._active_idx)

    def switch_tab(self, index):
        if index < 0 or index >= len(self._tabs):
            return
        self._active_idx = index
        self._stack.setCurrentIndex(index)
        # update active styling
        for i, t in enumerate(self._tabs):
            t["bar_btn"].setProperty("active", "true" if i == index else "false")
            t["bar_btn"].style().unpolish(t["bar_btn"])
            t["bar_btn"].style().polish(t["bar_btn"])

    def tab_count(self):
        return len(self._tabs)

    # ─── JS injection (on default profile — shared by all tabs) ──

    def _setup_injection(self):
        profile = QWebEngineProfile.defaultProfile()

        # 1) qwebchannel.js (must run first)
        qwc_path = os.path.join(SHARED_DIR, "qwebchannel.js")
        if os.path.exists(qwc_path):
            with open(qwc_path, "r", encoding="utf-8") as f:
                qwc_src = f.read()
            s = QWebEngineScript()
            s.setName("qwebchannel")
            s.setSourceCode(qwc_src)
            s.setInjectionPoint(QWebEngineScript.DocumentCreation)
            s.setWorldId(QWebEngineScript.MainWorld)
            s.setRunsOnSubFrames(False)
            profile.scripts().insert(s)

        # 2) CSS injection
        css_path = os.path.join(SHARED_DIR, "inject.css")
        if os.path.exists(css_path):
            with open(css_path, "r", encoding="utf-8") as f:
                css = f.read()
            css_escaped = css.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
            s = QWebEngineScript()
            s.setName("diviewer-css")
            s.setSourceCode(f"""
                (function() {{
                    var style = document.createElement('style');
                    style.textContent = `{css_escaped}`;
                    document.head.appendChild(style);
                }})();
            """)
            s.setInjectionPoint(QWebEngineScript.DocumentReady)
            s.setWorldId(QWebEngineScript.MainWorld)
            s.setRunsOnSubFrames(False)
            profile.scripts().insert(s)

        # 3) HTML injection
        html_path = os.path.join(SHARED_DIR, "inject.html")
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as f:
                html = f.read()
            html_escaped = html.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
            s = QWebEngineScript()
            s.setName("diviewer-html")
            s.setSourceCode(f"""
                (function() {{
                    var div = document.createElement('div');
                    div.innerHTML = `{html_escaped}`;
                    document.body.appendChild(div);
                }})();
            """)
            s.setInjectionPoint(QWebEngineScript.DocumentReady)
            s.setWorldId(QWebEngineScript.MainWorld)
            s.setRunsOnSubFrames(False)
            profile.scripts().insert(s)

        # 4) JS injection (bridge init + UI logic)
        js_path = os.path.join(SHARED_DIR, "inject.js")
        if os.path.exists(js_path):
            with open(js_path, "r", encoding="utf-8") as f:
                js = f.read()
            s = QWebEngineScript()
            s.setName("diviewer-js")
            s.setSourceCode(js)
            s.setInjectionPoint(QWebEngineScript.DocumentReady)
            s.setWorldId(QWebEngineScript.MainWorld)
            s.setRunsOnSubFrames(False)
            profile.scripts().insert(s)

    # ─── click-through (Win32) ──────────────────────────────────

    def set_click_through(self, enable: bool):
        hwnd = int(self.winId())
        user32 = ctypes.windll.user32
        style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)

        if enable:
            style |= WS_EX_LAYERED | WS_EX_TRANSPARENT
        else:
            style &= ~WS_EX_TRANSPARENT

        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)
        alpha = int(self.windowOpacity() * 255)
        user32.SetLayeredWindowAttributes(hwnd, 0, alpha, 0x02)
        self._click_through = enable

    @property
    def click_through(self):
        return self._click_through

    # ─── opacity ────────────────────────────────────────────────

    def increase_opacity(self):
        self._opacity = min(1.0, self._opacity + 0.1)
        self.setWindowOpacity(self._opacity)
        self.opacity_changed.emit(self._opacity)

    def decrease_opacity(self):
        self._opacity = max(0.1, self._opacity - 0.1)
        self.setWindowOpacity(self._opacity)
        self.opacity_changed.emit(self._opacity)

    # ─── show / hide ────────────────────────────────────────────

    def toggle_show_hide(self):
        if self._is_shown:
            self.hide()
            self._run_js('try{document.querySelector("video").pause()}catch(e){}')
        else:
            self.show()
            self._run_js('try{document.querySelector("video").play()}catch(e){}')
        self._is_shown = not self._is_shown

    # ─── always on top ──────────────────────────────────────────

    def toggle_on_top(self):
        self._on_top = not self._on_top
        flags = self.windowFlags()
        if self._on_top:
            flags |= Qt.WindowStaysOnTopHint
        else:
            flags &= ~Qt.WindowStaysOnTopHint
        self.setWindowFlags(flags)
        self.show()

    def _toggle_maximize(self):
        if self.isMaximized():
            self.showNormal()
        else:
            self.showMaximized()

    # ─── system tray ────────────────────────────────────────────

    def _setup_tray(self):
        icon = QIcon(ICON_FILE) if os.path.exists(ICON_FILE) else QApplication.style().standardIcon(
            QApplication.style().StandardPixmap.SP_ComputerIcon
        )
        self._tray = QSystemTrayIcon(icon, self)
        self._tray.setToolTip("貂宝")

        menu = QMenu()
        menu.addAction("显示/隐藏", self.toggle_show_hide)
        menu.addAction("置顶切换", self.toggle_on_top)
        menu.addSeparator()
        menu.addAction("新建标签页", lambda: self.new_tab(DEFAULT_URL))
        menu.addSeparator()
        menu.addAction("退出", self.close)
        self._tray.setContextMenu(menu)

        self._tray.activated.connect(self._on_tray_activated)
        self._tray.show()

    def _on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.toggle_show_hide()

    # ─── lock position ──────────────────────────────────────────

    def toggle_lock_position(self):
        self._position_locked = not self._position_locked
        return self._position_locked

    # ─── window size presets ────────────────────────────────────

    def resize_to_ratio(self, ratio: float):
        screen = self.screen().availableGeometry()
        w = int(screen.width() * ratio)
        h = int(screen.height() * ratio)
        x = screen.x() + (screen.width() - w) // 2
        y = screen.y() + (screen.height() - h) // 2
        self.setGeometry(x, y, w, h)

    # ─── inside mode (click-through + frameless) ────────────────

    def toggle_inside_mode(self):
        self._click_through = not self._click_through
        self.set_click_through(self._click_through)

    # ─── video controls ─────────────────────────────────────────

    def toggle_play_pause(self):
        self._run_js("""
            (function(){
                var v = document.querySelector("video");
                if(v){ v.paused ? v.play() : v.pause(); }
            })();
        """)

    def video_forward(self, seconds=5):
        self._run_js(f'try{{document.querySelector("video").currentTime+={seconds}}}catch(e){{}}')

    def video_backward(self, seconds=5):
        self._run_js(f'try{{document.querySelector("video").currentTime-={seconds}}}catch(e){{}}')

    def request_fullscreen(self):
        self._run_js("""
            (function(){
                if(document.fullscreenElement){
                    document.exitFullscreen();
                } else {
                    var el = document.querySelector('.bpx-player-container') || document.querySelector('video');
                    if(el) el.requestFullscreen();
                }
            })();
        """)

    # ─── JS helper ──────────────────────────────────────────────

    def _run_js(self, code):
        if self._tabs:
            self._tabs[self._active_idx]["page"].runJavaScript(code)

    # ─── bookmarks ──────────────────────────────────────────────

    def _load_bookmarks(self):
        if os.path.exists(BOOKMARKS_FILE):
            with open(BOOKMARKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

    def _save_bookmarks(self, bookmarks):
        os.makedirs(os.path.dirname(BOOKMARKS_FILE), exist_ok=True)
        with open(BOOKMARKS_FILE, "w", encoding="utf-8") as f:
            json.dump(bookmarks, f, ensure_ascii=False, indent=2)

    def add_bookmark(self, url, title):
        bookmarks = self._load_bookmarks()
        for b in bookmarks:
            if b["url"] == url:
                return False
        bookmarks.append({"url": url, "title": title or url})
        self._save_bookmarks(bookmarks)
        return True

    def remove_bookmark(self, url):
        bookmarks = self._load_bookmarks()
        bookmarks = [b for b in bookmarks if b["url"] != url]
        self._save_bookmarks(bookmarks)

    def get_bookmarks(self):
        return json.dumps(self._load_bookmarks())

    # ─── drag (frameless window) ────────────────────────────────

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self._dragging = True
            self._drag_pos = event.globalPosition().toPoint() - self.frameGeometry().topLeft()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._position_locked:
            return super().mouseMoveEvent(event)
        if self._dragging and event.buttons() & Qt.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_pos)
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self._dragging = False
        super().mouseReleaseEvent(event)

    # ─── edge snapping ──────────────────────────────────────────

    def moveEvent(self, event):
        pos = self.pos()
        screen = self.screen().availableGeometry()
        snap = self._snap_threshold
        x, y = pos.x(), pos.y()
        w, h = self.width(), self.height()

        if abs(x - screen.left()) < snap:
            x = screen.left()
        elif abs(x + w - screen.right()) < snap:
            x = screen.right() - w

        if abs(y - screen.top()) < snap:
            y = screen.top()
        elif abs(y + h - screen.bottom()) < snap:
            y = screen.bottom() - h

        if (x, y) != (pos.x(), pos.y()):
            self.move(x, y)

        super().moveEvent(event)

    # ─── hotkeys ────────────────────────────────────────────────

    def _bind_hotkeys(self):
        try:
            import keyboard as k
        except ImportError:
            print("[warn] keyboard library not installed, hotkeys disabled")
            return

        config = self._load_config()

        k.add_hotkey(config["togglePlayPause"], self.toggle_play_pause)
        tpp = config["togglePlayPause"]
        for combo in [f"{tpp}+w", f"{tpp}+a", f"{tpp}+d", f"{tpp}+w+a", f"{tpp}+w+d"]:
            k.add_hotkey(combo, self.toggle_play_pause)

        k.add_hotkey(config["toggleShowHide"], self.toggle_show_hide)
        k.add_hotkey(config["insideMode"], self.toggle_inside_mode)
        k.add_hotkey(config["videoBackward"], self.video_backward)
        k.add_hotkey(config["videoForward"], self.video_forward)
        k.add_hotkey(config["decreaseOpacity"], self.decrease_opacity)
        k.add_hotkey(config["increaseOpacity"], self.increase_opacity)
        k.add_hotkey(config["requestFullScreen"], self.request_fullscreen)
        k.add_hotkey(config["closeWindow"], self.close)

    def rebind_hotkeys(self):
        try:
            import keyboard as k
            k.unhook_all()
        except ImportError:
            return
        self._bind_hotkeys()

    # ─── config ─────────────────────────────────────────────────

    def _load_config(self):
        default = {
            "togglePlayPause": "`",
            "toggleShowHide": "0",
            "insideMode": "p",
            "requestFullScreen": "o",
            "videoBackward": "5",
            "videoForward": "6",
            "decreaseOpacity": "7",
            "increaseOpacity": "8",
            "closeWindow": "Ctrl+q",
        }
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(default, f, ensure_ascii=False, indent=4)
        return default

    def save_config(self, config_dict):
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config_dict, f, ensure_ascii=False, indent=4)
        self.rebind_hotkeys()

    def get_config(self):
        return self._load_config()

    # ─── history (state persistence) ────────────────────────────

    def _load_history(self):
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _save_history(self):
        os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
        # collect all tab URLs
        tab_urls = []
        for t in self._tabs:
            url = t["view"].url().toString()
            if not url or url == "about:blank":
                url = DEFAULT_URL
            tab_urls.append(url)
        if not tab_urls:
            tab_urls = [DEFAULT_URL]
        data = {
            "tabs": tab_urls,
            "active_tab": self._active_idx,
            "window_start_x": self.x(),
            "window_start_y": self.y(),
            "window_width": self.width(),
            "window_height": self.height(),
            "window_opacity": self._opacity,
            "window_on_top": self._on_top,
            "position_locked": self._position_locked,
        }
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def closeEvent(self, event):
        self._save_history()
        if hasattr(self, '_tray'):
            self._tray.hide()
        try:
            import keyboard as k
            k.unhook_all()
        except Exception:
            pass
        super().closeEvent(event)
