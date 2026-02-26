#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use url::Url;

const BROWSER_LABEL: &str = "browser";
const CONTROL_LABEL: &str = "main";
const HOME_URL: &str = "https://limestart.cn/";
const MAX_TAB_SESSIONS: usize = 20;
const SNAP_DISTANCE: i32 = 10;
const SNAP_DEBOUNCE_MS: u64 = 180;
const LEGACY_INJECT_HTML_BYTES: &[u8] = include_bytes!("../../../shared/inject.html");
const LEGACY_INJECT_CSS_BYTES: &[u8] = include_bytes!("../../../shared/inject.css");
const LEGACY_INJECT_JS_BYTES: &[u8] = include_bytes!("../../../shared/inject.js");
const PAGE_NAV_PATCH_JS: &str = r##"
(() => {
  if (window.__diviewer_nav_patched_v2__) return;
  window.__diviewer_nav_patched_v2__ = true;

  const shouldHandleHref = (href) => {
    if (!href) return false;
    const s = String(href).trim().toLowerCase();
    return !(
      s.startsWith("javascript:") ||
      s.startsWith("mailto:") ||
      s.startsWith("tel:") ||
      s.startsWith("#")
    );
  };

  const gotoCurrent = (href) => {
    try {
      window.location.assign(href);
    } catch (_e) {
      window.location.href = href;
    }
  };

  const nativeOpen = window.open ? window.open.bind(window) : null;
  window.open = function(url, target, features) {
    if (typeof url === "string" && shouldHandleHref(url)) {
      gotoCurrent(url);
      return window;
    }
    if (!nativeOpen) return window;
    try {
      return nativeOpen(url, target, features);
    } catch (_e) {
      return window;
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!target || !target.closest) return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;

      const href = anchor.getAttribute("href") || anchor.href;
      if (!shouldHandleHref(href)) return;
      const targetAttr = (anchor.getAttribute("target") || "").toLowerCase();
      if (targetAttr === "" || targetAttr === "_self" || targetAttr === "_blank" || targetAttr === "blank") {
        event.preventDefault();
        gotoCurrent(anchor.href || href);
      }
    },
    true
  );
})();
"##;

#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE, LWA_ALPHA,
    WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

type AppResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyConfig {
    toggle_play_pause: String,
    toggle_show_hide: String,
    inside_mode: String,
    video_backward: String,
    video_forward: String,
    decrease_opacity: String,
    increase_opacity: String,
    request_full_screen: String,
    close_window: String,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            toggle_play_pause: "Backquote".to_string(),
            toggle_show_hide: "0".to_string(),
            inside_mode: "P".to_string(),
            video_backward: "5".to_string(),
            video_forward: "6".to_string(),
            decrease_opacity: "7".to_string(),
            increase_opacity: "8".to_string(),
            request_full_screen: "O".to_string(),
            close_window: "Ctrl+Q".to_string(),
        }
    }
}

impl HotkeyConfig {
    fn sanitize(self) -> Self {
        let default = Self::default();
        Self {
            toggle_play_pause: normalize_hotkey(self.toggle_play_pause, &default.toggle_play_pause),
            toggle_show_hide: normalize_hotkey(self.toggle_show_hide, &default.toggle_show_hide),
            inside_mode: normalize_hotkey(self.inside_mode, &default.inside_mode),
            video_backward: normalize_hotkey(self.video_backward, &default.video_backward),
            video_forward: normalize_hotkey(self.video_forward, &default.video_forward),
            decrease_opacity: normalize_hotkey(self.decrease_opacity, &default.decrease_opacity),
            increase_opacity: normalize_hotkey(self.increase_opacity, &default.increase_opacity),
            request_full_screen: normalize_hotkey(
                self.request_full_screen,
                &default.request_full_screen,
            ),
            close_window: normalize_hotkey(self.close_window, &default.close_window),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookmarkItem {
    title: String,
    url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedState {
    last_url: String,
    window_start_x: f64,
    window_start_y: f64,
    window_width: f64,
    window_height: f64,
    window_opacity: f64,
    window_on_top: bool,
    window_inside: bool,
    window_visible: bool,
    window_maximized: bool,
    #[serde(default)]
    window_position_locked: bool,
    #[serde(default)]
    bookmarks: Vec<BookmarkItem>,
    #[serde(default)]
    tab_urls: Vec<String>,
    #[serde(default)]
    active_tab_index: usize,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            last_url: HOME_URL.to_string(),
            window_start_x: 560.0,
            window_start_y: 240.0,
            window_width: 980.0,
            window_height: 680.0,
            window_opacity: 1.0,
            window_on_top: true,
            window_inside: false,
            window_visible: true,
            window_maximized: false,
            window_position_locked: false,
            bookmarks: Vec::new(),
            tab_urls: vec![HOME_URL.to_string()],
            active_tab_index: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontendState {
    last_url: String,
    opacity: f64,
    on_top: bool,
    inside: bool,
    visible: bool,
    maximized: bool,
    position_locked: bool,
    sidebar_visible: bool,
    bookmarks: Vec<BookmarkItem>,
    hotkeys: HotkeyConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionTabItem {
    index: i32,
    title: String,
    url: String,
    active: bool,
}

#[derive(Debug, Clone)]
struct BrowserTab {
    label: String,
    title: String,
    url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TabSessionSnapshot {
    tabs: Vec<SessionTabItem>,
    active_index: i32,
}

#[derive(Debug)]
struct RuntimeState {
    persist: PersistedState,
    hotkeys: HotkeyConfig,
    tabs: Vec<BrowserTab>,
    active_tab: usize,
}

struct AppState {
    history_path: PathBuf,
    hotkeys_path: PathBuf,
    ui_lang_zh: bool,
    data: Mutex<RuntimeState>,
    next_tab_id: AtomicU64,
    closing_windows: Mutex<HashSet<String>>,
    snapping: AtomicBool,
    move_seq: AtomicU64,
    sidebar_visible: AtomicBool,
}

#[derive(Clone, Copy)]
enum HotkeyAction {
    TogglePlayPause,
    ToggleShowHide,
    ToggleInsideMode,
    VideoBackward,
    VideoForward,
    DecreaseOpacity,
    IncreaseOpacity,
    RequestFullScreen,
    CloseApp,
}

struct SnapGuard<'a> {
    flag: &'a AtomicBool,
}

impl Drop for SnapGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

fn normalize_hotkey(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    if trimmed == "\u{0060}" {
        return "Backquote".to_string();
    }
    trimmed.to_string()
}

fn detect_ui_lang_zh() -> bool {
    if let Ok(value) = std::env::var("DI_VIEWER_LANG") {
        let normalized = value.trim().to_lowercase();
        if normalized == "zh" || normalized == "zh-cn" || normalized == "zh_hans" {
            return true;
        }
        if normalized == "en" || normalized == "en-us" {
            return false;
        }
    }

    for key in ["LC_ALL", "LANGUAGE", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            let normalized = value.trim().to_lowercase();
            if normalized.starts_with("zh") {
                return true;
            }
            if normalized.starts_with("en") {
                return false;
            }
        }
    }
    true
}

fn ui_text<'a>(zh: bool, zh_text: &'a str, en_text: &'a str) -> &'a str {
    if zh { zh_text } else { en_text }
}

fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return HOME_URL.to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

fn normalize_bookmark(url: &str, title: &str) -> AppResult<BookmarkItem> {
    let normalized_url = normalize_url(url);
    parse_url(&normalized_url)?;
    let normalized_title = {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            normalized_url.clone()
        } else {
            trimmed.to_string()
        }
    };
    Ok(BookmarkItem {
        title: normalized_title,
        url: normalized_url,
    })
}

fn sanitize_bookmarks(items: Vec<BookmarkItem>) -> Vec<BookmarkItem> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        if let Ok(normalized) = normalize_bookmark(&item.url, &item.title) {
            if seen.insert(normalized.url.clone()) {
                result.push(normalized);
            }
        }
    }
    result
}

fn sanitize_tab_urls(items: Vec<String>) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let normalized = normalize_url(&item);
        if parse_url(&normalized).is_ok() && seen.insert(normalized.clone()) {
            result.push(normalized);
            if result.len() >= MAX_TAB_SESSIONS {
                break;
            }
        }
    }
    result
}

fn build_tabs_from_persist(persist: &mut PersistedState) -> (Vec<BrowserTab>, usize) {
    let mut urls = sanitize_tab_urls(std::mem::take(&mut persist.tab_urls));
    if urls.is_empty() {
        let fallback = normalize_url(&persist.last_url);
        if parse_url(&fallback).is_ok() {
            urls.push(fallback);
        }
    }
    if urls.is_empty() {
        urls.push(HOME_URL.to_string());
    }

    let active = persist.active_tab_index.min(urls.len() - 1);
    persist.active_tab_index = active;
    persist.last_url = urls[active].clone();
    persist.tab_urls = urls.clone();

    let tabs = urls
        .into_iter()
        .enumerate()
        .map(|(idx, url)| BrowserTab {
            label: if idx == 0 {
                BROWSER_LABEL.to_string()
            } else {
                format!("browser-tab-{idx}")
            },
            title: tab_title_from_url(&url),
            url,
        })
        .collect::<Vec<_>>();
    (tabs, active)
}

fn parse_url(input: &str) -> AppResult<Url> {
    Url::parse(input).map_err(|err| format!("Invalid URL `{input}`: {err}"))
}

fn tab_title_from_url(url: &str) -> String {
    if let Ok(parsed) = Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            return host.to_string();
        }
    }
    let trimmed = url.trim();
    if trimmed.is_empty() {
        HOME_URL.to_string()
    } else {
        trimmed.to_string()
    }
}

fn next_tab_label(state: &AppState) -> String {
    let next = state.next_tab_id.fetch_add(1, Ordering::SeqCst);
    format!("browser-tab-{next}")
}

fn tabs_snapshot_locked(locked: &RuntimeState) -> TabSessionSnapshot {
    let active = if locked.tabs.is_empty() {
        0
    } else {
        locked.active_tab.min(locked.tabs.len() - 1)
    };
    let items = locked
        .tabs
        .iter()
        .enumerate()
        .map(|(i, tab)| SessionTabItem {
            index: i as i32,
            title: tab.title.clone(),
            url: tab.url.clone(),
            active: i == active,
        })
        .collect();
    TabSessionSnapshot {
        tabs: items,
        active_index: active as i32,
    }
}

fn tabs_snapshot(state: &AppState) -> AppResult<TabSessionSnapshot> {
    let locked = state
        .data
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?;
    Ok(tabs_snapshot_locked(&locked))
}

fn set_active_tab_url(state: &AppState, url: String) -> AppResult<()> {
    {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        if locked.tabs.is_empty() {
            locked.tabs.push(BrowserTab {
                label: BROWSER_LABEL.to_string(),
                title: tab_title_from_url(&url),
                url: url.clone(),
            });
            locked.active_tab = 0;
        } else {
            let idx = locked.active_tab.min(locked.tabs.len() - 1);
            locked.active_tab = idx;
            locked.tabs[idx].url = url.clone();
            locked.tabs[idx].title = tab_title_from_url(&url);
        }
    }
    update_persist(state, |persist| {
        persist.last_url = url.clone();
        persist.window_visible = true;
    })
}

fn sync_tab_from_browser_label(app: &AppHandle, label: &str) -> AppResult<()> {
    let browser = browser_window_by_label(app, label)?;
    let current_url = browser
        .url()
        .map(|u| normalize_url(u.as_str()))
        .unwrap_or_else(|_| HOME_URL.to_string());
    let state = app.state::<AppState>();
    let mut locked = state
        .data
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?;
    if let Some(tab) = locked.tabs.iter_mut().find(|tab| tab.label == label) {
        tab.url = current_url.clone();
        tab.title = tab_title_from_url(&current_url);
    }
    Ok(())
}

fn browser_window_by_label(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("Browser window not found: {label}"))
}

fn active_browser_label(app: &AppHandle) -> AppResult<String> {
    let state = app.state::<AppState>();
    let locked = state
        .data
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?;
    if locked.tabs.is_empty() {
        return Err("No browser tabs".to_string());
    }
    let idx = locked.active_tab.min(locked.tabs.len() - 1);
    Ok(locked.tabs[idx].label.clone())
}

fn browser_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    let label = active_browser_label(app)?;
    browser_window_by_label(app, &label)
}

fn create_or_show_control_window(app: &AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window(CONTROL_LABEL) {
        let _ = window.unminimize();
        window
            .show()
            .map_err(|err| format!("Show control window failed: {err}"))?;
        let _ = window.set_focus();
        return Ok(());
    }

    let ui_lang_zh = app.state::<AppState>().ui_lang_zh;
    let window = WebviewWindowBuilder::new(
        app,
        CONTROL_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title(ui_text(
        ui_lang_zh,
        "DI-Viewer \u{63A7}\u{5236}\u{53F0}",
        "DI-Viewer Control",
    ))
    .inner_size(760.0, 940.0)
    .resizable(true)
    .build()
    .map_err(|err| format!("Create control window failed: {err}"))?;
    let _ = window.set_focus();
    Ok(())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| format!("Failed writing {}: {err}", path.display()))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<T>(&text).ok()
}

fn save_history(state: &AppState) -> AppResult<()> {
    let snapshot = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        let mut persist = locked.persist.clone();
        if locked.tabs.is_empty() {
            let fallback = normalize_url(&persist.last_url);
            persist.last_url = fallback.clone();
            persist.tab_urls = vec![fallback];
            persist.active_tab_index = 0;
        } else {
            let active = locked.active_tab.min(locked.tabs.len() - 1);
            persist.tab_urls = locked.tabs.iter().map(|tab| tab.url.clone()).collect();
            persist.active_tab_index = active;
            persist.last_url = locked.tabs[active].url.clone();
        }
        persist
    };
    write_json(&state.history_path, &snapshot)
}

fn save_hotkeys_file(state: &AppState) -> AppResult<()> {
    let snapshot = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.hotkeys.clone()
    };
    write_json(&state.hotkeys_path, &snapshot)
}

fn update_persist<F>(state: &AppState, mutator: F) -> AppResult<()>
where
    F: FnOnce(&mut PersistedState),
{
    {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        mutator(&mut locked.persist);
    }
    save_history(state)
}

fn js_for_action(action: &str) -> Option<&'static str> {
    match action {
        "toggle_play_pause" => Some(
            "(() => { const v = document.querySelector('video'); if (!v) return; if (v.paused) { v.play(); } else { v.pause(); } })();",
        ),
        "video_backward" => Some(
            "(() => { const v = document.querySelector('video'); if (v) { v.currentTime = Math.max(0, v.currentTime - 5); } })();",
        ),
        "video_forward" => Some(
            "(() => { const v = document.querySelector('video'); if (v) { v.currentTime += 5; } })();",
        ),
        "request_full_screen" => Some(
            "(() => { const target = document.querySelector('.bpx-player-container') || document.querySelector('video') || document.documentElement; if (document.fullscreenElement) { document.exitFullscreen(); } else if (target && target.requestFullscreen) { target.requestFullscreen(); } })();",
        ),
        _ => None,
    }
}

fn execute_video_action(app: &AppHandle, action: &str) -> AppResult<()> {
    let js = js_for_action(action)
        .ok_or_else(|| format!("Unsupported video action: {action}"))?;
    let browser = browser_window(app)?;
    browser
        .eval(js)
        .map_err(|err| format!("Evaluate JS failed: {err}"))
}

fn navigate_browser_to(browser: &WebviewWindow, normalized: &str) -> AppResult<()> {
    let parsed = parse_url(normalized)?;
    match browser.navigate(parsed) {
        Ok(_) => Ok(()),
        Err(nav_err) => {
            let js_url = serde_json::to_string(normalized).map_err(|err| err.to_string())?;
            let fallback_js = format!("window.location.assign({js_url});");
            browser.eval(fallback_js).map_err(|eval_err| {
                format!("Navigate failed: {nav_err}; fallback failed: {eval_err}")
            })
        }
    }
}

fn escape_js_template_literal(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${")
}

fn sidebar_script() -> String {
    let html = escape_js_template_literal(&String::from_utf8_lossy(LEGACY_INJECT_HTML_BYTES));
    let css = escape_js_template_literal(&String::from_utf8_lossy(LEGACY_INJECT_CSS_BYTES));
    let inject_js = String::from_utf8_lossy(LEGACY_INJECT_JS_BYTES);
    format!(
        r##"
(() => {{
  if (window.__diviewer_legacy_inject_v1__) return;
  window.__diviewer_legacy_inject_v1__ = true;

  const ensureBridge = () => {{
    const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (!invoke) return;
    const bridge = window.bridge || {{}};

    const warnBridge = (action, err) => {{
      try {{
        console.warn("[DI-Viewer bridge] " + action + " failed", err);
      }} catch (_e) {{}}
    }};

    bridge.navigate = (url) => invoke("navigate", {{ url: String(url || "") }}).catch((err) => {{
      warnBridge("navigate", err);
    }});
    bridge.toggle_on_top = () => invoke("toggle_on_top").catch((err) => {{
      warnBridge("toggle_on_top", err);
    }});
    bridge.toggle_inside_mode = () => invoke("toggle_inside_mode").catch((err) => {{
      warnBridge("toggle_inside_mode", err);
    }});
    bridge.increase_opacity = () => invoke("increase_opacity").catch((err) => {{
      warnBridge("increase_opacity", err);
    }});
    bridge.decrease_opacity = () => invoke("decrease_opacity").catch((err) => {{
      warnBridge("decrease_opacity", err);
    }});
    bridge.minimize = () => invoke("minimize_browser").catch((err) => {{
      warnBridge("minimize_browser", err);
    }});
    bridge.close_window = () => invoke("close_app").catch((err) => {{
      warnBridge("close_app", err);
    }});
    bridge.save_config = (configJson) => {{
      let config = {{}};
      try {{
        config = JSON.parse(String(configJson || "{{}}"));
      }} catch (_e) {{
        config = {{}};
      }}
      return invoke("save_hotkeys", {{ config }}).catch((err) => {{
        warnBridge("save_hotkeys", err);
      }});
    }};
    bridge.get_config = (callback) => invoke("get_hotkeys")
      .then((cfg) => {{
        if (typeof callback === "function") {{
          try {{
            callback(JSON.stringify(cfg));
          }} catch (err) {{
            warnBridge("get_hotkeys.callback", err);
          }}
        }}
        return cfg;
      }})
      .catch((err) => {{
        warnBridge("get_hotkeys", err);
        if (typeof callback === "function") {{
          try {{
            callback("{{}}");
          }} catch (cbErr) {{
            warnBridge("get_hotkeys.callback_fallback", cbErr);
          }}
        }}
        return {{}};
      }});
    bridge.reset_config = (callback) => invoke("reset_hotkeys")
      .then((cfg) => {{
        if (typeof callback === "function") {{
          try {{
            callback(JSON.stringify(cfg));
          }} catch (err) {{
            warnBridge("reset_hotkeys.callback", err);
          }}
        }}
        return cfg;
      }})
      .catch((err) => {{
        warnBridge("reset_hotkeys", err);
        if (typeof callback === "function") {{
          try {{
            callback("{{}}");
          }} catch (cbErr) {{
            warnBridge("reset_hotkeys.callback_fallback", cbErr);
          }}
        }}
        return {{}};
      }});
    bridge.toggle_lock_position = (callback) => invoke("toggle_lock_position")
      .then((locked) => {{
        if (typeof callback === "function") {{
          try {{
            callback(Boolean(locked));
          }} catch (err) {{
            warnBridge("toggle_lock_position.callback", err);
          }}
        }}
        return Boolean(locked);
      }})
      .catch((err) => {{
        warnBridge("toggle_lock_position", err);
        return false;
      }});
    bridge.resize_to_ratio = (ratio) =>
      invoke("resize_to_ratio", {{ ratio: Number(ratio || 0.5) }}).catch((err) => {{
        warnBridge("resize_to_ratio", err);
      }});
    bridge.get_bookmarks = (callback) => invoke("get_bookmarks")
      .then((items) => {{
        if (typeof callback === "function") {{
          try {{
            callback(JSON.stringify(items || []));
          }} catch (err) {{
            warnBridge("get_bookmarks.callback", err);
          }}
        }}
        return items || [];
      }})
      .catch((err) => {{
        warnBridge("get_bookmarks", err);
        if (typeof callback === "function") {{
          try {{
            callback("[]");
          }} catch (cbErr) {{
            warnBridge("get_bookmarks.callback_fallback", cbErr);
          }}
        }}
        return [];
      }});
    bridge.get_tabs = (callback) => invoke("list_tabs")
      .then((snapshot) => {{
        if (typeof callback === "function") {{
          try {{
            callback(JSON.stringify(snapshot || {{ tabs: [], activeIndex: 0 }}));
          }} catch (err) {{
            warnBridge("list_tabs.callback", err);
          }}
        }}
        return snapshot || {{ tabs: [], activeIndex: 0 }};
      }})
      .catch((err) => {{
        warnBridge("list_tabs", err);
        if (typeof callback === "function") {{
          try {{
            callback(JSON.stringify({{ tabs: [], activeIndex: 0 }}));
          }} catch (cbErr) {{
            warnBridge("list_tabs.callback_fallback", cbErr);
          }}
        }}
        return {{ tabs: [], activeIndex: 0 }};
      }});
    bridge.switch_tab = (index) => invoke("switch_tab", {{ index: Number(index ?? 0) }}).catch((err) => {{
      warnBridge("switch_tab", err);
    }});
    bridge.add_bookmark = (url, title) =>
      invoke("add_bookmark", {{ url: String(url || ""), title: String(title || "") }}).catch((err) => {{
        warnBridge("add_bookmark", err);
      }});
    bridge.remove_bookmark = (url) =>
      invoke("remove_bookmark", {{ url: String(url || "") }}).catch((err) => {{
        warnBridge("remove_bookmark", err);
      }});
    bridge.new_tab = (url) =>
      invoke("new_tab", {{ url: String(url || "https://limestart.cn/") }}).catch((err) => {{
        warnBridge("new_tab", err);
      }});
    bridge.close_tab = (index) =>
      invoke("close_tab", {{ index: Number(index ?? -1) }}).catch((err) => {{
        warnBridge("close_tab", err);
      }});

    window.bridge = bridge;
    if (typeof window.qt === "undefined") {{
      window.qt = {{ webChannelTransport: {{}} }};
    }}
    if (typeof window.QWebChannel === "undefined") {{
      window.QWebChannel = function(_transport, callback) {{
        if (typeof callback === "function") {{
          callback({{ objects: {{ bridge: window.bridge }} }});
        }}
      }};
    }}
  }};

  const ROOT_ID = "__diviewer_legacy_inject_root__";
  const STYLE_ID = "__diviewer_legacy_inject_style__";
  const HARDEN_STYLE_ID = "__diviewer_legacy_harden_style__";
  ensureBridge();

  if (!document.getElementById(STYLE_ID)) {{
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `{css}`;
    (document.head || document.documentElement).appendChild(style);
  }}

  if (!document.getElementById(HARDEN_STYLE_ID)) {{
    const style = document.createElement("style");
    style.id = HARDEN_STYLE_ID;
    style.textContent = `
      #__diviewer_legacy_inject_root__ {{
        position: fixed;
        inset: 0;
        z-index: 2147483640;
        pointer-events: none;
      }}
      #__diviewer_legacy_inject_root__ #diviewer-dock,
      #__diviewer_legacy_inject_root__ #diviewer-panel,
      #__diviewer_legacy_inject_root__ #diviewer-overlay {{
        pointer-events: auto !important;
      }}
      #__diviewer_legacy_inject_root__ #diviewer-overlay {{
        z-index: 2147483645 !important;
      }}
      #__diviewer_legacy_inject_root__ #diviewer-dock,
      #__diviewer_legacy_inject_root__ #diviewer-panel {{
        z-index: 2147483646 !important;
      }}
      #__diviewer_legacy_inject_root__ #diviewer-dock .dock-btn,
      #__diviewer_legacy_inject_root__ #diviewer-dock .dock-btn * {{
        pointer-events: auto !important;
      }}
    `;
    (document.head || document.documentElement).appendChild(style);
  }}

  if (!document.getElementById(ROOT_ID)) {{
    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.innerHTML = `{html}`;
    (document.body || document.documentElement).appendChild(host);
  }}

  const bindDockFallback = () => {{
    if (window.__diviewer_inject_ready__) return;
    if (window.__diviewer_fallback_bound__) return;
    window.__diviewer_fallback_bound__ = true;

    const dock = document.getElementById("diviewer-dock");
    const panel = document.getElementById("diviewer-panel");
    const overlay = document.getElementById("diviewer-overlay");
    if (!dock || !panel) return;

    const tabs = Array.from(panel.querySelectorAll(".diviewer-tab-box .tab-btn"));
    const allContent = Array.from(panel.querySelectorAll(".diviewer-content-box .content"));
    const dockBtns = Array.from(dock.querySelectorAll(".dock-btn"));
    const line = panel.querySelector(".diviewer-line");
    const tabBox = panel.querySelector(".diviewer-tab-box");

    const switchTab = (index) => {{
      if (tabs.length === 0 || allContent.length === 0) return;
      const idx = Math.max(0, Math.min(index, Math.min(tabs.length, allContent.length) - 1));
      tabs.forEach((t) => t.classList.remove("active"));
      allContent.forEach((c) => c.classList.remove("active"));
      tabs[idx].classList.add("active");
      allContent[idx].classList.add("active");
      if (line && tabBox) {{
        const w = tabBox.getBoundingClientRect().width || 0;
        line.style.left = (idx * w / tabs.length) + "px";
      }}
    }};

    const closePanel = () => {{
      panel.classList.remove("active");
      overlay && overlay.classList.remove("active");
      dock.classList.remove("expanded");
      dockBtns.forEach((b) => b.classList.remove("active"));
    }};

    if (overlay && !overlay.dataset.fallbackBound) {{
      overlay.dataset.fallbackBound = "1";
      overlay.addEventListener("click", closePanel);
    }}

    dockBtns.forEach((btn, i) => {{
      if (btn.dataset.fallbackBound) return;
      btn.dataset.fallbackBound = "1";
      btn.addEventListener("click", (e) => {{
        e.preventDefault();
        e.stopPropagation();
        const isOpen = panel.classList.contains("active");
        const wasActive = btn.classList.contains("active");
        dockBtns.forEach((b) => b.classList.remove("active"));
        if (isOpen && wasActive) {{
          closePanel();
          return;
        }}
        btn.classList.add("active");
        dock.classList.add("expanded");
        panel.classList.add("active");
        overlay && overlay.classList.add("active");
        switchTab(i);
      }});
    }});
  }};

  try {{
    {inject_js}
  }} catch (_e) {{}}
  bindDockFallback();
}})();
"##
    )
}

fn sidebar_visibility_script(visible: bool) -> String {
    let visible_js = if visible { "true" } else { "false" };
    format!(
        r##"
(() => {{
  const root = document.getElementById("__diviewer_legacy_inject_root__");
  const panel = document.getElementById("diviewer-panel");
  const overlay = document.getElementById("diviewer-overlay");
  const dock = document.getElementById("diviewer-dock");
  const show = {visible_js};

  if (root) {{
    root.style.display = show ? "block" : "none";
  }}
  if (dock) {{
    dock.style.display = show ? "" : "none";
  }}
  if (panel && !show) {{
    panel.classList.remove("active");
  }}
  if (overlay && !show) {{
    overlay.classList.remove("active");
  }}
}})();
"##
    )
}

fn refresh_browser_injected_scripts_for_label(app: &AppHandle, label: &str) {
    if let Ok(browser) = browser_window_by_label(app, label) {
        let _ = browser.eval(PAGE_NAV_PATCH_JS);
        let _ = browser.eval(sidebar_script());
        let visible = app
            .state::<AppState>()
            .sidebar_visible
            .load(Ordering::SeqCst);
        let _ = browser.eval(sidebar_visibility_script(visible));
    }
}

#[cfg(target_os = "windows")]
fn apply_window_effects(window: &WebviewWindow, opacity: f64, click_through: bool) -> AppResult<()> {
    let handle = window
        .window_handle()
        .map_err(|err| format!("Window handle error: {err}"))?;
    let hwnd = match handle.as_raw() {
        RawWindowHandle::Win32(raw) => raw.hwnd.get() as HWND,
        _ => return Ok(()),
    };

    let alpha = (opacity.clamp(0.2, 1.0) * 255.0).round() as u8;
    unsafe {
        let mut style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        style |= WS_EX_LAYERED;
        if click_through {
            style |= WS_EX_TRANSPARENT;
        } else {
            style &= !WS_EX_TRANSPARENT;
        }
        SetWindowLongW(hwnd, GWL_EXSTYLE, style as i32);
        if SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) == 0 {
            return Err("SetLayeredWindowAttributes failed".to_string());
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn apply_window_effects(_window: &WebviewWindow, _opacity: f64, _click_through: bool) -> AppResult<()> {
    Ok(())
}

fn snap_browser_to_edge_for_label(app: &AppHandle, label: &str) -> AppResult<()> {
    let state = app.state::<AppState>();
    if state.snapping.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let _guard = SnapGuard {
        flag: &state.snapping,
    };

    let browser = browser_window_by_label(app, label)?;
    let Some(monitor) = browser
        .current_monitor()
        .map_err(|err| format!("Read monitor failed: {err}"))?
    else {
        return Ok(());
    };
    let position = browser
        .outer_position()
        .map_err(|err| format!("Read position failed: {err}"))?;
    let size = browser
        .outer_size()
        .map_err(|err| format!("Read size failed: {err}"))?;

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let monitor_left = monitor_pos.x;
    let monitor_top = monitor_pos.y;
    let monitor_right = monitor_pos.x + monitor_size.width as i32;
    let monitor_bottom = monitor_pos.y + monitor_size.height as i32;

    let mut x = position.x;
    let mut y = position.y;
    let width = size.width as i32;
    let height = size.height as i32;

    if (x - monitor_left).abs() <= SNAP_DISTANCE {
        x = monitor_left;
    } else if (x + width - monitor_right).abs() <= SNAP_DISTANCE {
        x = monitor_right - width;
    }
    if (y - monitor_top).abs() <= SNAP_DISTANCE {
        y = monitor_top;
    } else if (y + height - monitor_bottom).abs() <= SNAP_DISTANCE {
        y = monitor_bottom - height;
    }

    if x != position.x || y != position.y {
        browser
            .set_position(Position::Physical(PhysicalPosition::new(x, y)))
            .map_err(|err| format!("Set position failed: {err}"))?;
    }

    Ok(())
}

fn persist_browser_state_for_label(app: &AppHandle, label: &str, do_snap: bool) -> AppResult<()> {
    if do_snap {
        let _ = snap_browser_to_edge_for_label(app, label);
    }

    let browser = browser_window_by_label(app, label)?;
    let position = browser
        .outer_position()
        .map_err(|err| format!("Read position failed: {err}"))?;
    let size = browser
        .outer_size()
        .map_err(|err| format!("Read size failed: {err}"))?;
    let visible = browser.is_visible().unwrap_or(true);
    let maximized = browser.is_maximized().unwrap_or(false);
    let current_url = browser
        .url()
        .map(|u| u.to_string())
        .unwrap_or_else(|_| HOME_URL.to_string());

    let state = app.state::<AppState>();
    update_persist(&state, |persist| {
        persist.last_url = if current_url.trim().is_empty() {
            persist.last_url.clone()
        } else {
            current_url.clone()
        };
        if !persist.window_position_locked {
            persist.window_start_x = position.x as f64;
            persist.window_start_y = position.y as f64;
        }
        persist.window_width = size.width as f64;
        persist.window_height = size.height as f64;
        persist.window_visible = visible;
        persist.window_maximized = maximized;
    })?;
    sync_tab_from_browser_label(app, label)
}

fn persist_browser_state(app: &AppHandle, do_snap: bool) -> AppResult<()> {
    let label = active_browser_label(app)?;
    persist_browser_state_for_label(app, &label, do_snap)
}

fn toggle_show_hide_impl(app: &AppHandle) -> AppResult<bool> {
    let browser = browser_window(app)?;
    let visible = browser.is_visible().unwrap_or(true);
    let next_visible = !visible;

    let _ = execute_video_action(app, "toggle_play_pause");
    if next_visible {
        browser
            .show()
            .map_err(|err| format!("Show window failed: {err}"))?;
        let _ = browser.set_focus();
    } else {
        browser
            .hide()
            .map_err(|err| format!("Hide window failed: {err}"))?;
    }

    let state = app.state::<AppState>();
    update_persist(&state, |persist| {
        persist.window_visible = next_visible;
    })?;
    Ok(next_visible)
}

fn set_inside_mode_impl(app: &AppHandle, inside: bool) -> AppResult<bool> {
    let browser = browser_window(app)?;
    browser
        .set_ignore_cursor_events(inside)
        .map_err(|err| format!("Set click-through failed: {err}"))?;

    let state = app.state::<AppState>();
    let opacity = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.window_opacity
    };
    apply_window_effects(&browser, opacity, inside)?;

    update_persist(&state, |persist| {
        persist.window_inside = inside;
    })?;
    Ok(inside)
}

fn toggle_inside_mode_impl(app: &AppHandle) -> AppResult<bool> {
    let state = app.state::<AppState>();
    let next = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        !locked.persist.window_inside
    };
    set_inside_mode_impl(app, next)
}

fn toggle_on_top_impl(app: &AppHandle) -> AppResult<bool> {
    let state = app.state::<AppState>();
    let next = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        !locked.persist.window_on_top
    };
    let browser = browser_window(app)?;
    browser
        .set_always_on_top(next)
        .map_err(|err| format!("Set always-on-top failed: {err}"))?;
    update_persist(&state, |persist| {
        persist.window_on_top = next;
    })?;
    Ok(next)
}

fn set_opacity_impl(app: &AppHandle, opacity: f64) -> AppResult<f64> {
    let next = opacity.clamp(0.2, 1.0);
    let browser = browser_window(app)?;
    let state = app.state::<AppState>();
    let inside = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.window_inside
    };
    apply_window_effects(&browser, next, inside)?;
    update_persist(&state, |persist| {
        persist.window_opacity = next;
    })?;
    Ok(next)
}

fn adjust_opacity_impl(app: &AppHandle, delta: f64) -> AppResult<f64> {
    let state = app.state::<AppState>();
    let current = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.window_opacity
    };
    set_opacity_impl(app, current + delta)
}

fn toggle_position_lock_impl(app: &AppHandle) -> AppResult<bool> {
    let browser = browser_window(app)?;
    let position = browser
        .outer_position()
        .map_err(|err| format!("Read position failed: {err}"))?;
    let state = app.state::<AppState>();
    let next = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        !locked.persist.window_position_locked
    };
    update_persist(&state, |persist| {
        persist.window_position_locked = next;
        if next {
            persist.window_start_x = position.x as f64;
            persist.window_start_y = position.y as f64;
        }
    })?;
    Ok(next)
}

fn resize_to_ratio_impl(app: &AppHandle, ratio: f64) -> AppResult<f64> {
    let browser = browser_window(app)?;
    let ratio = ratio.clamp(0.2, 1.0);
    let monitor = browser
        .current_monitor()
        .map_err(|err| format!("Read monitor failed: {err}"))?
        .ok_or_else(|| "No monitor available".to_string())?;
    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();

    let width = ((monitor_size.width as f64) * ratio)
        .round()
        .clamp(600.0, monitor_size.width as f64) as u32;
    let height = ((monitor_size.height as f64) * ratio)
        .round()
        .clamp(320.0, monitor_size.height as f64) as u32;

    browser
        .set_size(Size::Physical(PhysicalSize::new(width, height)))
        .map_err(|err| format!("Set size failed: {err}"))?;

    let x = monitor_pos.x + ((monitor_size.width as i32 - width as i32) / 2);
    let y = monitor_pos.y + ((monitor_size.height as i32 - height as i32) / 2);
    browser
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|err| format!("Set position failed: {err}"))?;

    let current_url = browser
        .url()
        .map(|u| u.to_string())
        .unwrap_or_else(|_| HOME_URL.to_string());
    let state = app.state::<AppState>();
    update_persist(&state, |persist| {
        persist.window_start_x = x as f64;
        persist.window_start_y = y as f64;
        persist.window_width = width as f64;
        persist.window_height = height as f64;
        if !current_url.trim().is_empty() {
            persist.last_url = current_url.clone();
        }
    })?;

    Ok(ratio)
}

fn bookmarks_snapshot(state: &AppState) -> AppResult<Vec<BookmarkItem>> {
    let locked = state
        .data
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?;
    Ok(locked.persist.bookmarks.clone())
}

fn add_bookmark_impl(state: &AppState, url: String, title: String) -> AppResult<Vec<BookmarkItem>> {
    let bookmark = normalize_bookmark(&url, &title)?;
    update_persist(state, |persist| {
        persist.bookmarks.retain(|item| item.url != bookmark.url);
        persist.bookmarks.insert(0, bookmark.clone());
        if persist.bookmarks.len() > 200 {
            persist.bookmarks.truncate(200);
        }
    })?;
    bookmarks_snapshot(state)
}

fn remove_bookmark_impl(state: &AppState, url: String) -> AppResult<Vec<BookmarkItem>> {
    let normalized_url = normalize_url(&url);
    update_persist(state, |persist| {
        persist.bookmarks.retain(|item| item.url != normalized_url);
    })?;
    bookmarks_snapshot(state)
}

fn maximize_restore_impl(app: &AppHandle) -> AppResult<bool> {
    let browser = browser_window(app)?;
    let maximized = browser.is_maximized().unwrap_or(false);
    if maximized {
        browser
            .unmaximize()
            .map_err(|err| format!("Restore window failed: {err}"))?;
    } else {
        browser
            .maximize()
            .map_err(|err| format!("Maximize window failed: {err}"))?;
    }
    let next = !maximized;
    let state = app.state::<AppState>();
    update_persist(&state, |persist| {
        persist.window_maximized = next;
    })?;
    Ok(next)
}

fn close_app_impl(app: &AppHandle) {
    let labels = {
        let state = app.state::<AppState>();
        let collected = if let Ok(locked) = state.data.lock() {
            locked
                .tabs
                .iter()
                .map(|tab| tab.label.clone())
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        collected
    };
    if labels.is_empty() {
        let _ = persist_browser_state(app, false);
    } else {
        for label in labels {
            let _ = persist_browser_state_for_label(app, &label, false);
        }
    }
    app.exit(0);
}

fn run_hotkey_action(app: &AppHandle, action: HotkeyAction) -> AppResult<()> {
    match action {
        HotkeyAction::TogglePlayPause => execute_video_action(app, "toggle_play_pause"),
        HotkeyAction::ToggleShowHide => {
            toggle_show_hide_impl(app)?;
            Ok(())
        }
        HotkeyAction::ToggleInsideMode => {
            toggle_inside_mode_impl(app)?;
            Ok(())
        }
        HotkeyAction::VideoBackward => execute_video_action(app, "video_backward"),
        HotkeyAction::VideoForward => execute_video_action(app, "video_forward"),
        HotkeyAction::DecreaseOpacity => {
            adjust_opacity_impl(app, -0.1)?;
            Ok(())
        }
        HotkeyAction::IncreaseOpacity => {
            adjust_opacity_impl(app, 0.1)?;
            Ok(())
        }
        HotkeyAction::RequestFullScreen => execute_video_action(app, "request_full_screen"),
        HotkeyAction::CloseApp => {
            close_app_impl(app);
            Ok(())
        }
    }
}

fn register_hotkeys(app: &AppHandle, config: &HotkeyConfig) -> AppResult<()> {
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    let mappings = [
        (
            "togglePlayPause",
            config.toggle_play_pause.as_str(),
            HotkeyAction::TogglePlayPause,
        ),
        (
            "toggleShowHide",
            config.toggle_show_hide.as_str(),
            HotkeyAction::ToggleShowHide,
        ),
        (
            "insideMode",
            config.inside_mode.as_str(),
            HotkeyAction::ToggleInsideMode,
        ),
        (
            "videoBackward",
            config.video_backward.as_str(),
            HotkeyAction::VideoBackward,
        ),
        (
            "videoForward",
            config.video_forward.as_str(),
            HotkeyAction::VideoForward,
        ),
        (
            "decreaseOpacity",
            config.decrease_opacity.as_str(),
            HotkeyAction::DecreaseOpacity,
        ),
        (
            "increaseOpacity",
            config.increase_opacity.as_str(),
            HotkeyAction::IncreaseOpacity,
        ),
        (
            "requestFullScreen",
            config.request_full_screen.as_str(),
            HotkeyAction::RequestFullScreen,
        ),
        (
            "closeWindow",
            config.close_window.as_str(),
            HotkeyAction::CloseApp,
        ),
    ];

    let mut failures = Vec::new();
    for (name, shortcut, action) in mappings {
        let key = shortcut.trim();
        if key.is_empty() {
            continue;
        }
        let key = if key == "\u{0060}" { "Backquote" } else { key };
        let result = manager.on_shortcut(key, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = run_hotkey_action(app, action);
            }
        });
        if let Err(err) = result {
            failures.push(format!("{name}={key}: {err}"));
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("Hotkey registration failed: {}", failures.join(" | ")))
    }
}

fn setup_tray(app: &AppHandle) -> AppResult<()> {
    let ui_lang_zh = app.state::<AppState>().ui_lang_zh;
    let panel_item =
        MenuItem::with_id(
            app,
            "tray_panel",
            ui_text(ui_lang_zh, "\u{63A7}\u{5236}\u{9762}\u{677F}", "Control Panel"),
            true,
            None::<&str>,
        )
            .map_err(|err| format!("Create tray menu failed: {err}"))?;
    let show_item =
        MenuItem::with_id(
            app,
            "tray_show",
            ui_text(
                ui_lang_zh,
                "\u{663E}\u{793A}\u{6D4F}\u{89C8}\u{5668}",
                "Show Browser",
            ),
            true,
            None::<&str>,
        )
            .map_err(|err| format!("Create tray menu failed: {err}"))?;
    let hide_item =
        MenuItem::with_id(
            app,
            "tray_hide",
            ui_text(
                ui_lang_zh,
                "\u{9690}\u{85CF}\u{6D4F}\u{89C8}\u{5668}",
                "Hide Browser",
            ),
            true,
            None::<&str>,
        )
            .map_err(|err| format!("Create tray menu failed: {err}"))?;
    let exit_item =
        MenuItem::with_id(
            app,
            "tray_exit",
            ui_text(ui_lang_zh, "\u{9000}\u{51FA}", "Exit"),
            true,
            None::<&str>,
        )
            .map_err(|err| format!("Create tray menu failed: {err}"))?;
    let separator = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;
    let menu = Menu::with_items(
        app,
        &[&panel_item, &show_item, &hide_item, &separator, &exit_item],
    )
    .map_err(|err| format!("Create tray menu failed: {err}"))?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_panel" => {
                let _ = create_or_show_control_window(app);
            }
            "tray_show" => {
                if let Ok(browser) = browser_window(app) {
                    let _ = browser.show();
                    let _ = browser.set_focus();
                }
                let state = app.state::<AppState>();
                let _ = update_persist(&state, |persist| {
                    persist.window_visible = true;
                });
            }
            "tray_hide" => {
                if let Ok(browser) = browser_window(app) {
                    let _ = browser.hide();
                }
                let state = app.state::<AppState>();
                let _ = update_persist(&state, |persist| {
                    persist.window_visible = false;
                });
            }
            "tray_exit" => {
                close_app_impl(app);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    let _tray = tray_builder
        .build(app)
        .map_err(|err| format!("Create tray icon failed: {err}"))?;
    Ok(())
}

fn create_browser_tab_window(
    app: &AppHandle,
    label: &str,
    initial: &PersistedState,
    initial_url: &str,
    visible: bool,
) -> AppResult<WebviewWindow> {
    let url = parse_url(&normalize_url(initial_url))?;
    let app_for_popup = app.clone();
    let app_for_load = app.clone();
    let label_for_popup = label.to_string();
    let label_for_load = label.to_string();
    let ui_lang_zh = app.state::<AppState>().ui_lang_zh;

    let browser = WebviewWindowBuilder::new(app, label.to_string(), WebviewUrl::External(url))
        .title(ui_text(ui_lang_zh, "DI-Viewer Browser", "DI-Viewer Browser"))
        .inner_size(initial.window_width, initial.window_height)
        .min_inner_size(600.0, 320.0)
        .position(initial.window_start_x, initial.window_start_y)
        .resizable(true)
        .always_on_top(initial.window_on_top)
        .visible(visible)
        .on_navigation(|_url| true)
        .on_new_window(move |new_url, _features| {
            if let Some(browser) = app_for_popup.get_webview_window(&label_for_popup) {
                let _ = navigate_browser_to(&browser, new_url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(move |_window, _payload| {
            refresh_browser_injected_scripts_for_label(&app_for_load, &label_for_load);
            let _ = sync_tab_from_browser_label(&app_for_load, &label_for_load);
        })
        .build()
        .map_err(|err| format!("Create browser window failed: {err}"))?;

    if initial.window_maximized {
        let _ = browser.maximize();
    }
    apply_window_effects(&browser, initial.window_opacity, initial.window_inside)?;
    browser
        .set_ignore_cursor_events(initial.window_inside)
        .map_err(|err| format!("Set click-through failed: {err}"))?;

    let app_handle = app.clone();
    let label_for_event = label.to_string();
    browser.on_window_event(move |event| match event {
        WindowEvent::Moved(position) => {
            let (locked_position, target_x, target_y) = {
                let state = app_handle.state::<AppState>();
                let locked = state.data.lock();
                if let Ok(locked) = locked {
                    (
                        locked.persist.window_position_locked,
                        locked.persist.window_start_x as i32,
                        locked.persist.window_start_y as i32,
                    )
                } else {
                    (false, 0, 0)
                }
            };
            if locked_position {
                if position.x != target_x || position.y != target_y {
                    if let Some(browser) = app_handle.get_webview_window(&label_for_event) {
                        let _ = browser
                            .set_position(Position::Physical(PhysicalPosition::new(target_x, target_y)));
                    }
                }
                return;
            }

            let state = app_handle.state::<AppState>();
            let seq = state.move_seq.fetch_add(1, Ordering::SeqCst) + 1;
            let app_for_snap = app_handle.clone();
            let label_for_snap = label_for_event.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(SNAP_DEBOUNCE_MS));
                let state = app_for_snap.state::<AppState>();
                if state.move_seq.load(Ordering::SeqCst) == seq {
                    let _ = snap_browser_to_edge_for_label(&app_for_snap, &label_for_snap);
                    let _ = persist_browser_state_for_label(&app_for_snap, &label_for_snap, false);
                }
            });
        }
        WindowEvent::Resized(_) => {
            let _ = persist_browser_state_for_label(&app_handle, &label_for_event, false);
        }
        WindowEvent::CloseRequested { api, .. } => {
            let allow_close = {
                let state = app_handle.state::<AppState>();
                let removed = if let Ok(mut closing) = state.closing_windows.lock() {
                    closing.remove(&label_for_event)
                } else {
                    false
                };
                removed
            };
            if allow_close {
                return;
            }
            api.prevent_close();
            close_app_impl(&app_handle);
        }
        _ => {}
    });

    Ok(browser)
}

fn create_browser_window(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let (initial, tabs, active, visible) = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        let active = if locked.tabs.is_empty() {
            0
        } else {
            locked.active_tab.min(locked.tabs.len() - 1)
        };
        (
            locked.persist.clone(),
            locked.tabs.clone(),
            active,
            locked.persist.window_visible,
        )
    };
    if tabs.is_empty() {
        return Err("No browser tabs to create".to_string());
    }

    for (idx, tab) in tabs.iter().enumerate() {
        let should_show = idx == active && visible;
        let browser = create_browser_tab_window(app, &tab.label, &initial, &tab.url, should_show)?;
        if should_show {
            let _ = browser.show();
            let _ = browser.set_focus();
        }
    }
    Ok(())
}

#[tauri::command]
fn get_state(app: AppHandle, state: tauri::State<AppState>) -> AppResult<FrontendState> {
    let mut snapshot = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        (locked.persist.clone(), locked.hotkeys.clone())
    };

    if let Ok(browser) = browser_window(&app) {
        if let Ok(url) = browser.url() {
            snapshot.0.last_url = url.to_string();
        }
        snapshot.0.window_visible = browser.is_visible().unwrap_or(snapshot.0.window_visible);
        snapshot.0.window_maximized = browser.is_maximized().unwrap_or(snapshot.0.window_maximized);
    }

    Ok(FrontendState {
        last_url: snapshot.0.last_url,
        opacity: snapshot.0.window_opacity,
        on_top: snapshot.0.window_on_top,
        inside: snapshot.0.window_inside,
        visible: snapshot.0.window_visible,
        maximized: snapshot.0.window_maximized,
        position_locked: snapshot.0.window_position_locked,
        sidebar_visible: state.sidebar_visible.load(Ordering::SeqCst),
        bookmarks: snapshot.0.bookmarks,
        hotkeys: snapshot.1,
    })
}

#[tauri::command]
fn get_hotkeys(state: tauri::State<AppState>) -> AppResult<HotkeyConfig> {
    let hotkeys = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.hotkeys.clone()
    };
    Ok(hotkeys)
}

#[tauri::command]
fn navigate(app: AppHandle, state: tauri::State<AppState>, url: String) -> AppResult<String> {
    let normalized = normalize_url(&url);
    let browser = browser_window(&app)?;
    navigate_browser_to(&browser, &normalized)?;
    set_active_tab_url(&state, normalized.clone())?;
    Ok(normalized)
}

#[tauri::command]
fn go_home(app: AppHandle, state: tauri::State<AppState>) -> AppResult<String> {
    navigate(app, state, HOME_URL.to_string())
}

#[tauri::command]
fn toggle_show_hide(app: AppHandle) -> AppResult<bool> {
    toggle_show_hide_impl(&app)
}

#[tauri::command]
fn toggle_inside_mode(app: AppHandle) -> AppResult<bool> {
    toggle_inside_mode_impl(&app)
}

#[tauri::command]
fn toggle_on_top(app: AppHandle) -> AppResult<bool> {
    toggle_on_top_impl(&app)
}

#[tauri::command]
fn set_opacity(app: AppHandle, opacity: f64) -> AppResult<f64> {
    set_opacity_impl(&app, opacity)
}

#[tauri::command]
fn increase_opacity(app: AppHandle) -> AppResult<f64> {
    adjust_opacity_impl(&app, 0.1)
}

#[tauri::command]
fn decrease_opacity(app: AppHandle) -> AppResult<f64> {
    adjust_opacity_impl(&app, -0.1)
}

#[tauri::command]
fn toggle_lock_position(app: AppHandle) -> AppResult<bool> {
    toggle_position_lock_impl(&app)
}

#[tauri::command]
fn resize_to_ratio(app: AppHandle, ratio: f64) -> AppResult<f64> {
    resize_to_ratio_impl(&app, ratio)
}

#[tauri::command]
fn get_bookmarks(state: tauri::State<AppState>) -> AppResult<Vec<BookmarkItem>> {
    bookmarks_snapshot(&state)
}

#[tauri::command]
fn add_bookmark(state: tauri::State<AppState>, url: String, title: String) -> AppResult<Vec<BookmarkItem>> {
    add_bookmark_impl(&state, url, title)
}

#[tauri::command]
fn remove_bookmark(state: tauri::State<AppState>, url: String) -> AppResult<Vec<BookmarkItem>> {
    remove_bookmark_impl(&state, url)
}

#[tauri::command]
fn list_tabs(state: tauri::State<AppState>) -> AppResult<TabSessionSnapshot> {
    tabs_snapshot(&state)
}

#[tauri::command]
fn switch_tab(app: AppHandle, state: tauri::State<AppState>, index: i32) -> AppResult<String> {
    let (from_label, target_label, target_url) = {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        if locked.tabs.is_empty() {
            return Err("No browser tabs".to_string());
        }
        let from_idx = locked.active_tab.min(locked.tabs.len() - 1);
        let idx = if index < 0 {
            from_idx
        } else {
            (index as usize).min(locked.tabs.len() - 1)
        };
        locked.active_tab = idx;
        (
            locked.tabs[from_idx].label.clone(),
            locked.tabs[idx].label.clone(),
            locked.tabs[idx].url.clone(),
        )
    };

    if from_label != target_label {
        if let Ok(current) = browser_window_by_label(&app, &from_label) {
            let _ = persist_browser_state_for_label(&app, &from_label, false);
            let _ = current.hide();
        }
    }

    let browser = browser_window_by_label(&app, &target_label)?;
    browser
        .show()
        .map_err(|err| format!("Show window failed: {err}"))?;
    let _ = browser.set_focus();
    refresh_browser_injected_scripts_for_label(&app, &target_label);

    update_persist(&state, |persist| {
        persist.last_url = target_url.clone();
        persist.window_visible = true;
    })?;
    Ok(target_url)
}

#[tauri::command]
fn new_tab(app: AppHandle, state: tauri::State<AppState>, url: String) -> AppResult<String> {
    let target = normalize_url(if url.trim().is_empty() {
        HOME_URL
    } else {
        url.as_str()
    });
    let (label, previous_active, initial) = {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;

        if locked.tabs.len() >= MAX_TAB_SESSIONS {
            return Err(format!("Maximum tab count reached: {MAX_TAB_SESSIONS}"));
        }
        let previous = if locked.tabs.is_empty() {
            None
        } else {
            let idx = locked.active_tab.min(locked.tabs.len() - 1);
            Some(locked.tabs[idx].label.clone())
        };
        let label = next_tab_label(&state);
        locked.tabs.push(BrowserTab {
            label: label.clone(),
            title: tab_title_from_url(&target),
            url: target.clone(),
        });
        locked.active_tab = locked.tabs.len() - 1;
        (label, previous, locked.persist.clone())
    };

    let browser = create_browser_tab_window(&app, &label, &initial, &target, false)?;
    if let Some(previous_label) = previous_active {
        if previous_label != label {
            if let Ok(previous) = browser_window_by_label(&app, &previous_label) {
                let _ = persist_browser_state_for_label(&app, &previous_label, false);
                let _ = previous.hide();
            }
        }
    }
    browser
        .show()
        .map_err(|err| format!("Show window failed: {err}"))?;
    let _ = browser.set_focus();
    refresh_browser_injected_scripts_for_label(&app, &label);

    update_persist(&state, |persist| {
        persist.last_url = target.clone();
        persist.window_visible = true;
    })?;
    Ok(target)
}

#[tauri::command]
fn close_tab(app: AppHandle, state: tauri::State<AppState>, index: i32) -> AppResult<bool> {
    let closing = {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;

        if locked.tabs.is_empty() {
            return Ok(true);
        } else if locked.tabs.len() == 1 {
            locked.tabs[0].url = HOME_URL.to_string();
            locked.tabs[0].title = tab_title_from_url(HOME_URL);
            locked.active_tab = 0;
            None
        } else {
            let current_idx = locked.active_tab.min(locked.tabs.len() - 1);
            let remove_idx = if index < 0 {
                current_idx
            } else {
                (index as usize).min(locked.tabs.len() - 1)
            };
            let removed = locked.tabs.remove(remove_idx);
            let next_idx = if remove_idx >= locked.tabs.len() {
                locked.tabs.len() - 1
            } else {
                remove_idx
            };
            locked.active_tab = next_idx;
            Some((
                removed.label,
                locked.tabs[next_idx].label.clone(),
                locked.tabs[next_idx].url.clone(),
            ))
        }
    };

    if let Some((remove_label, next_label, next_url)) = closing {
        if let Ok(mut closing_set) = state.closing_windows.lock() {
            closing_set.insert(remove_label.clone());
        }
        if let Ok(to_close) = browser_window_by_label(&app, &remove_label) {
            let _ = persist_browser_state_for_label(&app, &remove_label, false);
            let _ = to_close.close();
        }
        let next = browser_window_by_label(&app, &next_label)?;
        next.show()
            .map_err(|err| format!("Show window failed: {err}"))?;
        let _ = next.set_focus();
        refresh_browser_injected_scripts_for_label(&app, &next_label);
        update_persist(&state, |persist| {
            persist.last_url = next_url.clone();
            persist.window_visible = true;
        })?;
        return Ok(true);
    }

    let browser = browser_window(&app)?;
    navigate_browser_to(&browser, HOME_URL)?;
    set_active_tab_url(&state, HOME_URL.to_string())?;
    Ok(true)
}

#[tauri::command]
fn minimize_browser(app: AppHandle) -> AppResult<()> {
    let browser = browser_window(&app)?;
    browser
        .minimize()
        .map_err(|err| format!("Minimize failed: {err}"))
}

#[tauri::command]
fn maximize_restore_browser(app: AppHandle) -> AppResult<bool> {
    maximize_restore_impl(&app)
}

#[tauri::command]
fn video_action(app: AppHandle, action: String) -> AppResult<()> {
    execute_video_action(&app, &action)
}

#[tauri::command]
fn toggle_sidebar(app: AppHandle) -> AppResult<bool> {
    let state = app.state::<AppState>();
    let next = !state.sidebar_visible.load(Ordering::SeqCst);
    state.sidebar_visible.store(next, Ordering::SeqCst);
    let labels = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked
            .tabs
            .iter()
            .map(|tab| tab.label.clone())
            .collect::<Vec<_>>()
    };
    let script = sidebar_visibility_script(next);
    for label in labels {
        if let Ok(browser) = browser_window_by_label(&app, &label) {
            let _ = browser.eval(script.clone());
        }
    }
    Ok(next)
}

#[tauri::command]
fn open_control_panel(app: AppHandle) -> AppResult<()> {
    create_or_show_control_window(&app)
}

#[tauri::command]
fn save_hotkeys(app: AppHandle, state: tauri::State<AppState>, config: HotkeyConfig) -> AppResult<()> {
    let sanitized = config.sanitize();
    {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.hotkeys = sanitized.clone();
    }
    save_hotkeys_file(&state)?;
    register_hotkeys(&app, &sanitized)
}

#[tauri::command]
fn reset_hotkeys(app: AppHandle, state: tauri::State<AppState>) -> AppResult<HotkeyConfig> {
    let defaults = HotkeyConfig::default();
    {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.hotkeys = defaults.clone();
    }
    save_hotkeys_file(&state)?;
    register_hotkeys(&app, &defaults)?;
    Ok(defaults)
}

#[tauri::command]
fn close_app(app: AppHandle) -> AppResult<()> {
    close_app_impl(&app);
    Ok(())
}

fn resolve_data_dir(app: &AppHandle) -> PathBuf {
    if let Ok(path) = app.path().app_local_data_dir() {
        return path;
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".di-viewer-tauri")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            let data_dir = resolve_data_dir(&app.handle().clone());
            fs::create_dir_all(&data_dir)?;

            let history_path = data_dir.join("history.json");
            let hotkeys_path = data_dir.join("hotkeys.json");

            let mut persist = read_json::<PersistedState>(&history_path).unwrap_or_default();
            persist.last_url = normalize_url(&persist.last_url);
            persist.window_opacity = persist.window_opacity.clamp(0.2, 1.0);
            persist.window_visible = true;
            persist.bookmarks = sanitize_bookmarks(persist.bookmarks);
            let (initial_tabs, initial_active_tab) = build_tabs_from_persist(&mut persist);
            let next_tab_id_seed = initial_tabs.len().max(1) as u64;

            let hotkeys = read_json::<HotkeyConfig>(&hotkeys_path)
                .unwrap_or_default()
                .sanitize();
            let ui_lang_zh = detect_ui_lang_zh();

            app.manage(AppState {
                history_path,
                hotkeys_path,
                ui_lang_zh,
                data: Mutex::new(RuntimeState {
                    tabs: initial_tabs,
                    active_tab: initial_active_tab,
                    persist,
                    hotkeys,
                }),
                next_tab_id: AtomicU64::new(next_tab_id_seed),
                closing_windows: Mutex::new(HashSet::new()),
                snapping: AtomicBool::new(false),
                move_seq: AtomicU64::new(0),
                sidebar_visible: AtomicBool::new(true),
            });

            create_browser_window(&app.handle().clone()).map_err(std::io::Error::other)?;
            setup_tray(&app.handle().clone()).map_err(std::io::Error::other)?;

            {
                let state = app.state::<AppState>();
                let config = {
                    let locked = state
                        .data
                        .lock()
                        .map_err(|_| std::io::Error::other("State lock poisoned"))?;
                    locked.hotkeys.clone()
                };
                register_hotkeys(&app.handle().clone(), &config).map_err(std::io::Error::other)?;
                save_history(&state).map_err(std::io::Error::other)?;
                save_hotkeys_file(&state).map_err(std::io::Error::other)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_hotkeys,
            navigate,
            go_home,
            toggle_show_hide,
            toggle_inside_mode,
            toggle_on_top,
            set_opacity,
            increase_opacity,
            decrease_opacity,
            toggle_lock_position,
            resize_to_ratio,
            get_bookmarks,
            add_bookmark,
            remove_bookmark,
            list_tabs,
            switch_tab,
            new_tab,
            close_tab,
            minimize_browser,
            maximize_restore_browser,
            video_action,
            toggle_sidebar,
            open_control_panel,
            save_hotkeys,
            reset_hotkeys,
            close_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}


