#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod persistence;

use persistence::{
    binding_is_global, current_timestamp_ms, read_json_or_default, write_json, BookmarkItem,
    HotkeyConfig, PersistedState,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, LogicalSize, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl,
    WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const BROWSER_LABEL: &str = "browser";
const CONTROL_LABEL: &str = "main";
const LEGACY_HOME_URL: &str = "https://limestart.cn/";
const LEGACY_HOME_URL_ALT: &str = "https://limestart.cn";
const LEGACY_HOME_URL_WWW: &str = "https://www.limestart.cn/";
const LEGACY_HOME_URL_WWW_ALT: &str = "https://www.limestart.cn";
const LOCAL_HOME_RESOURCE: &str = "lucid-start-page/index.html";
const MAX_TAB_SESSIONS: usize = 20;
const SNAP_DISTANCE: i32 = 10;
const SNAP_DEBOUNCE_MS: u64 = 180;
const RESIZE_DEBOUNCE_MS: u64 = 250;
/// Windows reports (-32000, -32000) for minimized/iconic windows; anything
/// at or below this coordinate is treated as a minimized-window artifact.
const MIN_VISIBLE_COORD: i32 = -30000;
/// Fixed, non-editable recovery shortcut. Deliberately obscure and always
/// registered, even when the user disabled the configurable hotkeys.
const RESCUE_SHORTCUT: &str = "Ctrl+Alt+Shift+R";
/// WebView2 must launch with the GPU sandbox disabled on some machines
/// (e.g. dual-AMD-GPU setups): otherwise the GPU process hangs and Windows
/// pops "msedgewebview2 has stopped working" on every launch.
/// NOTE: additional_browser_args REPLACES wry's defaults, so the default
/// disabled-features list must be restated here.
const WEBVIEW_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu-sandbox --no-sandbox";
/// Logical inner size that fits the start page without scrolling
/// (measured via CDP: content needs ~759px height at its 1180px max wrap
/// width; 1220x760 leaves the wrap fully expanded with a little slack).
const START_PAGE_FIT_WIDTH: f64 = 1220.0;
const START_PAGE_FIT_HEIGHT: f64 = 760.0;
const SHARED_DIST_CSS: &str = include_str!("../../../shared/dist/assets/app.css");
const SHARED_DIST_JS: &str = include_str!("../../../shared/dist/assets/app.js");
const DESKTOP_BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
#[allow(dead_code)]
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
    hotkeys_enabled: bool,
    sidebar_visible: bool,
    ui_lang: String,
    bookmarks: Vec<BookmarkItem>,
    hotkeys: HotkeyConfig,
    /// `name=combo` entries the OS refused; the settings panel marks those rows.
    hotkey_conflicts: Vec<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    ts: u128,
    source: String,
    action: String,
    detail: String,
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
    runtime_log_path: PathBuf,
    home_url: String,
    ui_lang_zh: AtomicBool,
    data: Mutex<RuntimeState>,
    closing_windows: Mutex<HashSet<String>>,
    snapping: AtomicBool,
    move_seq: AtomicU64,
    resize_seq: AtomicU64,
    sidebar_visible: AtomicBool,
    /// Monotonic counter used to mint stable, unique window labels for tabs.
    /// Labels are never derived from the tab index (indexes shift on close),
    /// so a tab keeps the same webview for its whole lifetime.
    next_tab_seq: AtomicU64,
    /// Bindings the OS refused (another application already owns that combo).
    /// Surfaced to the settings panel instead of aborting startup: a single
    /// occupied shortcut must never make the app unlaunchable.
    hotkey_conflicts: Mutex<Vec<String>>,
    log_store: Mutex<Vec<LogEntry>>,
}

#[derive(Clone, Copy)]
enum HotkeyAction {
    TogglePlayPause,
    ToggleRecording,
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

fn normalize_ui_lang(value: &str) -> Option<&'static str> {
    let lower = value.trim().to_lowercase();
    if lower.starts_with("zh") {
        Some("zh")
    } else if lower.starts_with("en") {
        Some("en")
    } else {
        None
    }
}

fn normalize_dock_color(value: &str) -> &'static str {
    match value.trim().to_lowercase().as_str() {
        "white" => "white",
        "ivory" => "ivory",
        "amber" => "amber",
        "blue" => "blue",
        "green" => "green",
        "rose" => "rose",
        "slate" => "slate",
        _ => "white",
    }
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
    if zh {
        zh_text
    } else {
        en_text
    }
}

fn is_legacy_home_url(url: &str) -> bool {
    let trimmed = url.trim();
    if matches!(
        trimmed,
        LEGACY_HOME_URL | LEGACY_HOME_URL_ALT | LEGACY_HOME_URL_WWW | LEGACY_HOME_URL_WWW_ALT
    ) {
        return true;
    }

    if let Ok(parsed) = Url::parse(trimmed) {
        if let Some(host) = parsed.host_str() {
            let normalized_host = host.trim().to_ascii_lowercase();
            return normalized_host == "limestart.cn" || normalized_host == "www.limestart.cn";
        }
    }

    false
}

fn normalize_url_with_home(url: &str, home_url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed == "about:blank" || is_legacy_home_url(trimmed) {
        return home_url.to_string();
    }
    // Any URL that points at the start page (whatever host it was recorded
    // with — old dev-server homes like http://127.0.0.1:17333/... must not
    // survive a session restore) collapses to the current home URL.
    if trimmed.contains("/lucid-start-page/index.html") {
        return home_url.to_string();
    }
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("file://")
    {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

/// The start page is served through Tauri's application protocol (embedded in
/// the frontend dist) so the injected shell gets a real HTTP origin. `file://`
/// pages cannot host the shell: the IPC layer rejects their `null` origin with
/// "Origin header is not a valid URL".
fn app_protocol_home_url() -> String {
    if cfg!(windows) {
        format!("http://tauri.localhost/{LOCAL_HOME_RESOURCE}")
    } else {
        format!("tauri://localhost/{LOCAL_HOME_RESOURCE}")
    }
}

fn resolve_home_url(app: &AppHandle) -> String {
    let _ = app; // signature kept for existing callers
    if let Ok(dev_home) = std::env::var("DI_VIEWER_HOME_URL") {
        let trimmed = dev_home.trim();
        if !trimmed.is_empty() && Url::parse(trimmed).is_ok() {
            return trimmed.to_string();
        }
    }
    app_protocol_home_url()
}

fn normalize_bookmark(url: &str, title: &str, home_url: &str) -> AppResult<BookmarkItem> {
    let normalized_url = normalize_url_with_home(url, home_url);
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

fn sanitize_bookmarks(items: Vec<BookmarkItem>, home_url: &str) -> Vec<BookmarkItem> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        if let Ok(normalized) = normalize_bookmark(&item.url, &item.title, home_url) {
            if seen.insert(normalized.url.clone()) {
                result.push(normalized);
            }
        }
    }
    result
}

fn sanitize_tab_urls(items: Vec<String>, home_url: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for item in items {
        let normalized = normalize_url_with_home(&item, home_url);
        if parse_url(&normalized).is_ok() && seen.insert(normalized.clone()) {
            result.push(normalized);
            if result.len() >= MAX_TAB_SESSIONS {
                break;
            }
        }
    }
    result
}

/// Restored tabs keep the legacy `browser` label for the first session and
/// mint `browser-<n>` for the rest, so `browser*` capabilities and any older
/// restore state keep working while every tab still owns its own webview.
fn restored_tab_label(slot: usize) -> String {
    if slot == 0 {
        BROWSER_LABEL.to_string()
    } else {
        format!("browser-{}", slot + 1)
    }
}

fn build_tabs_from_persist(
    persist: &mut PersistedState,
    home_url: &str,
) -> (Vec<BrowserTab>, usize) {
    let mut urls = sanitize_tab_urls(std::mem::take(&mut persist.tab_urls), home_url);
    if urls.is_empty() {
        let fallback = normalize_url_with_home(&persist.last_url, home_url);
        if parse_url(&fallback).is_ok() {
            urls.push(fallback);
        }
    }
    if urls.is_empty() {
        urls.push(home_url.to_string());
    }

    let active = persist.active_tab_index.min(urls.len() - 1);
    persist.active_tab_index = active;
    persist.last_url = urls[active].clone();
    persist.tab_urls = urls.clone();

    let tabs = urls
        .into_iter()
        .enumerate()
        .map(|(slot, url)| BrowserTab {
            label: restored_tab_label(slot),
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
    if url.contains("/lucid-start-page/index.html") || is_legacy_home_url(url) {
        return "Lucid Start Page".to_string();
    }
    if let Ok(parsed) = Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            return host.to_string();
        }
    }
    let trimmed = url.trim();
    if trimmed.is_empty() {
        LEGACY_HOME_URL.to_string()
    } else {
        trimmed.to_string()
    }
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
    let state = app.state::<AppState>();
    let home_url = state.home_url.clone();
    let current_url = browser
        .url()
        .map(|u| normalize_url_with_home(u.as_str(), &home_url))
        .unwrap_or_else(|_| home_url.clone());
    let mut locked = state
        .data
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?;

    if let Some(tab) = locked.tabs.iter_mut().find(|tab| tab.label == label) {
        tab.url = current_url.clone();
        tab.title = tab_title_from_url(&current_url);
    } else if !locked.tabs.is_empty() {
        // Legacy state where several tabs shared one label.
        let idx = locked.active_tab.min(locked.tabs.len() - 1);
        locked.tabs[idx].url = current_url.clone();
        locked.tabs[idx].title = tab_title_from_url(&current_url);
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

fn browser_labels(app: &AppHandle) -> Vec<String> {
    let state = app.state::<AppState>();
    let Ok(locked) = state.data.lock() else {
        return Vec::new();
    };
    locked.tabs.iter().map(|tab| tab.label.clone()).collect()
}

/// Create the webview for a tab that has not been opened yet in this session.
/// Tabs are created lazily and then kept alive (hidden) so switching back is a
/// show/hide, never a reload: scroll position, form state and video playback
/// all survive.
fn ensure_browser_window(app: &AppHandle, label: &str) -> AppResult<WebviewWindow> {
    if let Some(window) = app.get_webview_window(label) {
        return Ok(window);
    }
    let (initial, url) = {
        let state = app.state::<AppState>();
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        let url = locked
            .tabs
            .iter()
            .find(|tab| tab.label == label)
            .map(|tab| tab.url.clone())
            .unwrap_or_else(|| locked.persist.last_url.clone());
        (locked.persist.clone(), url)
    };
    let window = create_browser_tab_window(app, label, &initial, &url, false)?;
    push_log(app, "native", "create_tab_window", label.to_string());
    Ok(window)
}

fn browser_window(app: &AppHandle) -> AppResult<WebviewWindow> {
    let label = active_browser_label(app).unwrap_or_else(|_| BROWSER_LABEL.to_string());
    ensure_browser_window(app, &label)
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

    let ui_lang_zh = app.state::<AppState>().ui_lang_zh.load(Ordering::SeqCst);
    let window =
        WebviewWindowBuilder::new(app, CONTROL_LABEL, WebviewUrl::App("index.html".into()))
            .title(ui_text(
                ui_lang_zh,
                "DI-Viewer \u{63A7}\u{5236}\u{53F0}",
                "DI-Viewer Control",
            ))
            .inner_size(760.0, 940.0)
            .additional_browser_args(WEBVIEW_BROWSER_ARGS)
            .resizable(true)
            .build()
            .map_err(|err| format!("Create control window failed: {err}"))?;
    window
        .show()
        .map_err(|err| format!("Show control window failed: {err}"))?;
    let _ = window.set_focus();
    Ok(())
}

fn save_history(state: &AppState) -> AppResult<()> {
    let snapshot = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        let mut persist = locked.persist.clone();
        if locked.tabs.is_empty() {
            let fallback = normalize_url_with_home(&persist.last_url, &state.home_url);
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
        "toggle_recording" => Some(
            "(() => { const candidates = ['button[aria-label*=\"录制\"]','button[title*=\"录制\"]','button[aria-label*=\"record\" i]','button[title*=\"record\" i]','[data-action*=\"record\" i]']; for (const sel of candidates) { const node = document.querySelector(sel); if (node && typeof node.click === 'function') { node.click(); return; } } const ev = new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true }); document.dispatchEvent(ev); })();",
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
    let js = js_for_action(action).ok_or_else(|| format!("Unsupported video action: {action}"))?;
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

fn shared_shell_script(_app: &AppHandle) -> AppResult<String> {
    // Shared UI assets are embedded at compile time (include_str!), so the
    // shell works identically for dev, installed and single-file portable
    // builds with no on-disk resource layout dependency.
    let css = escape_js_template_literal(SHARED_DIST_CSS);
    let js = SHARED_DIST_JS;

    let template = r##"
(() => {
  const isTrustedStartPage = () => {
    const href = String(window.location.href || '').toLowerCase();
    return href.includes('/lucid-start-page/index.html');
  };

  const resolveInvoke = () => {
    const globalInvoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    const internalInvoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
    return typeof globalInvoke === 'function' ? globalInvoke : internalInvoke;
  };

  const allowedCommands = new Set([
    'get_state',
    'list_tabs',
    'get_logs',
    'get_dock_color',
    'navigate',
    'go_home',
    'go_back',
    'go_forward',
    'refresh_page',
    'toggle_show_hide',
    'toggle_on_top',
    'toggle_inside_mode',
    'set_inside_mode',
    'toggle_lock_position',
    'toggle_sidebar',
    'set_opacity',
    'set_shell_opacity',
    'increase_opacity',
    'decrease_opacity',
    'minimize_browser',
    'maximize_restore_browser',
    'close_app',
    'new_tab',
    'close_tab',
    'switch_tab',
    'get_bookmarks',
    'add_bookmark',
    'remove_bookmark',
    'save_hotkeys',
    'get_hotkeys',
    'reset_hotkeys',
    'video_action',
    'get_ui_language',
    'set_ui_language',
    'set_dock_color',
    'resize_to_ratio',
    'open_control_panel'
  ]);

  const call = (cmd, args) => {
    if (!isTrustedStartPage() && !allowedCommands.has(cmd)) {
      return Promise.reject(new Error(`DI-Viewer command is not allowed here: ${cmd}`));
    }
    const invokeRaw = resolveInvoke();
    if (typeof invokeRaw !== 'function') {
      return Promise.reject(new Error('DI-Viewer invoke bridge is unavailable'));
    }
    return invokeRaw(cmd, args);
  };

  const existingBridge = {};

  window.__diviewer_bridge = {
    ...existingBridge,
    get_state: () => call('get_state'),
    get_tabs: () => call('list_tabs'),
    get_logs: () => call('get_logs'),
    get_dock_color: () => call('get_dock_color'),
    navigate: (url) => call('navigate', { url: String(url || '') }),
    go_home: () => call('go_home'),
    go_back: () => call('go_back'),
    go_forward: () => call('go_forward'),
    refresh_page: () => call('refresh_page'),
    toggle_show_hide: () => call('toggle_show_hide'),
    toggle_on_top: () => call('toggle_on_top'),
    toggle_inside_mode: () => call('toggle_inside_mode'),
    set_inside_mode: (inside) => call('set_inside_mode', { inside: Boolean(inside) }),
    toggle_lock_position: () => call('toggle_lock_position'),
    toggle_sidebar: () => call('toggle_sidebar'),
    set_opacity: (opacity) => call('set_opacity', { opacity: Number(opacity || 1) }),
    set_shell_opacity: (opacity) => call('set_shell_opacity', { opacity: Number(opacity || 1) }),
    increase_opacity: () => call('increase_opacity'),
    decrease_opacity: () => call('decrease_opacity'),
    minimize: () => call('minimize_browser'),
    maximize_restore: () => call('maximize_restore_browser'),
    close_window: () => call('close_app'),
    new_tab: (url) => call('new_tab', { url: String(url || '') }),
    close_tab: (index) => call('close_tab', { index: Number(index ?? -1) }),
    switch_tab: (index) => call('switch_tab', { index: Number(index ?? 0) }),
    get_bookmarks: () => call('get_bookmarks'),
    add_bookmark: (url, title) => call('add_bookmark', { url: String(url || ''), title: String(title || '') }),
    remove_bookmark: (url) => call('remove_bookmark', { url: String(url || '') }),
    save_config: (configJson) => {
      const config = JSON.parse(String(configJson || '{}'));
      return call('save_hotkeys', { config });
    },
    get_config: () => call('get_hotkeys'),
    reset_config: () => call('reset_hotkeys'),
    video_action: (action) => call('video_action', { action: String(action || '') }),
    get_ui_language: () => call('get_ui_language'),
    set_ui_language: (lang) => call('set_ui_language', { lang: String(lang || 'zh') }),
    set_dock_color: (color) => call('set_dock_color', { color: String(color || 'white') }),
    resize_to_ratio: (ratio) => call('resize_to_ratio', { ratio: Number(ratio || 0.5) }),
    open_control_panel: () => call('open_control_panel'),
    close_app: () => call('close_app')
  };

  try {
    Object.defineProperty(window, "__diviewer_bridge", { value: window.__diviewer_bridge, writable: false, configurable: false });
  } catch (_e) {}

  // Initialization scripts run before the document exists: documentElement and
  // body are still null at that point, so DOM setup must defer to
  // DOMContentLoaded or the shell dies with a TypeError and never mounts.
  const setupShellDom = () => {
    let root = document.getElementById('__diviewer_shared_root__');
    if (!root) {
      root = document.createElement('div');
      root.id = '__diviewer_shared_root__';
      (document.documentElement || document.body).appendChild(root);
    }
    root.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;background:transparent;z-index:2147483646;display:block;';
    if (!root.hasAttribute('data-sidebar-visible')) {
      root.setAttribute('data-sidebar-visible', 'true');
    }

    const shadow = root.shadowRoot || root.attachShadow({ mode: 'open' });
    if (!shadow.getElementById('__diviewer_shared_mount__')) {
      const mount = document.createElement('div');
      mount.id = '__diviewer_shared_mount__';
      mount.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;background:transparent;';
      shadow.appendChild(mount);
    }

    // Dynamically inserted <style> elements are not parsed by this WebView2
    // build (style.sheet stays null even for attached elements), so the shell
    // CSS must go through a constructable stylesheet. Fallback to <style> for
    // engines without CSSStyleSheet support.
    const cssText = `__DIVIEWER_CSS__`;
    try {
      if (!shadow.adoptedStyleSheets.length) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        shadow.adoptedStyleSheets = [sheet];
      }
    } catch (_e) {
      if (!shadow.getElementById('__diviewer_shared_css__')) {
        const style = document.createElement('style');
        style.id = '__diviewer_shared_css__';
        style.textContent = cssText;
        shadow.appendChild(style);
      }
    }

    if (!window.__DIVIEWER_SHARED_BOOTSTRAPPED__) {
      window.__DIVIEWER_SHARED_BOOTSTRAPPED__ = true;
      __DIVIEWER_JS__
    }

    window.dispatchEvent(new CustomEvent('diviewer:sync'));
  };

  if (document.documentElement) {
    setupShellDom();
  } else {
    document.addEventListener('DOMContentLoaded', () => setupShellDom(), { once: true });
  }
})();
"##;

    Ok(template
        .replace("__DIVIEWER_CSS__", &css)
        .replace("__DIVIEWER_JS__", &js))
}

fn shared_shell_visibility_script(visible: bool) -> String {
    let visible_js = if visible { "true" } else { "false" };
    format!(
        r##"
(() => {{
  const host = document.getElementById('__diviewer_shared_root__');
  const root = host && host.shadowRoot ? host.shadowRoot.querySelector('.diviewer-host-root') : null;
  if (root) {{
    // Keep overlay mounted so collapsed handle is always reachable.
    root.style.display = 'block';
    root.setAttribute('data-sidebar-visible', {visible_js} ? 'true' : 'false');
  }}
  window.dispatchEvent(new CustomEvent('diviewer:sync'));
}})();
"##,
    )
}

#[allow(dead_code)]
fn refresh_browser_injected_scripts_for_label(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let visible = app
            .state::<AppState>()
            .sidebar_visible
            .load(Ordering::SeqCst);
        if let Err(err) = window.eval(shared_shell_visibility_script(visible)) {
            push_log(
                app,
                "native",
                "sync_shared_shell_visibility",
                format!("failed:{err}"),
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_window_effects(
    window: &WebviewWindow,
    opacity: f64,
    click_through: bool,
) -> AppResult<()> {
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
fn apply_window_effects(
    _window: &WebviewWindow,
    _opacity: f64,
    _click_through: bool,
) -> AppResult<()> {
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
    // Snapping a maximized/fullscreen window means SetWindowPos on it, which
    // Windows honours by restoring it to the monitor origin.
    if browser.is_maximized().unwrap_or(false) || browser.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }
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
    let browser = browser_window_by_label(app, label)?;
    // Never persist while minimized: Windows reports the iconic rect
    // (-32000, -32000, 0x0), which would poison the saved geometry and
    // make the next launch restore the window off-screen.
    if browser.is_minimized().unwrap_or(false) {
        return Ok(());
    }
    // A maximized / fullscreen window reports the maximized rect (often with a
    // negative origin) instead of the restore geometry. Snapping it would call
    // SetWindowPos on a maximized window, which un-maximizes it and drops it at
    // the monitor origin - the "it zooms then gets yanked to the corner" bug.
    let maximized_now = browser.is_maximized().unwrap_or(false);
    let fullscreen_now = browser.is_fullscreen().unwrap_or(false);
    if do_snap && !maximized_now && !fullscreen_now {
        let _ = snap_browser_to_edge_for_label(app, label);
    }
    let position = browser
        .outer_position()
        .map_err(|err| format!("Read position failed: {err}"))?;
    let inner = browser
        .inner_size()
        .map_err(|err| format!("Read inner size failed: {err}"))?;
    if position.x <= MIN_VISIBLE_COORD
        || position.y <= MIN_VISIBLE_COORD
        || inner.width == 0
        || inner.height == 0
    {
        return Ok(());
    }
    // Builder APIs (inner_size/position) work in logical pixels, so the
    // persisted geometry must be logical too; otherwise every relaunch on
    // a non-100%-scaled display grows the window by the scale factor.
    let scale = browser.scale_factor().unwrap_or(1.0).max(0.01);
    let visible = browser.is_visible().unwrap_or(true);
    let maximized = browser.is_maximized().unwrap_or(false);
    let state = app.state::<AppState>();
    let current_url = browser
        .url()
        .map(|u| u.to_string())
        .unwrap_or_else(|_| state.home_url.clone());
    // Only the tab that is actually on screen may drive the persisted
    // "last url" and "window visible" flags; background tab windows are
    // deliberately hidden and navigated on their own.
    let is_active_tab = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked
            .tabs
            .get(locked.active_tab.min(locked.tabs.len().saturating_sub(1)))
            .map(|tab| tab.label == label)
            .unwrap_or(true)
    };
    update_persist(&state, |persist| {
        if is_active_tab && !current_url.trim().is_empty() {
            persist.last_url = current_url.clone();
        }
        if !maximized_now && !fullscreen_now {
            if !persist.window_position_locked {
                persist.window_start_x = position.x as f64 / scale;
                persist.window_start_y = position.y as f64 / scale;
            }
            // Persist inner size because create uses .inner_size(...).
            // Using outer size here causes cumulative growth each tab/window cycle.
            persist.window_width = (inner.width as f64 / scale).round();
            persist.window_height = (inner.height as f64 / scale).round();
        }
        if is_active_tab {
            persist.window_visible = visible;
            persist.window_maximized = maximized;
        }
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
        apply_saved_window_state(app, &browser)?;
        let _ = browser.unminimize();
        browser
            .show()
            .map_err(|err| format!("Show window failed: {err}"))?;
        let _ = browser.set_focus();
        sync_shell_visibility(app, &browser);
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
    let state = app.state::<AppState>();
    let opacity = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.window_opacity
    };
    // Every tab owns a window, so the effect has to land on all of them;
    // otherwise switching tabs would reveal a stale click-through state.
    for label in browser_labels(app) {
        let Ok(browser) = browser_window_by_label(app, &label) else {
            continue;
        };
        browser
            .set_ignore_cursor_events(inside)
            .map_err(|err| format!("Set click-through failed: {err}"))?;
        apply_window_effects(&browser, opacity, inside)?;
    }

    update_persist(&state, |persist| {
        persist.window_inside = inside;
    })?;
    Ok(inside)
}

fn toggle_inside_mode_impl(app: &AppHandle) -> AppResult<bool> {
    let next = {
        let state = app.state::<AppState>();
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        !locked.persist.window_inside
    };
    set_inside_mode_impl(app, next)
}

fn set_inside_mode_command(app: AppHandle, inside: bool) -> AppResult<bool> {
    set_inside_mode_impl(&app, inside)
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
    for label in browser_labels(app) {
        if let Ok(browser) = browser_window_by_label(app, &label) {
            browser
                .set_always_on_top(next)
                .map_err(|err| format!("Set always-on-top failed: {err}"))?;
        }
    }
    update_persist(&state, |persist| {
        persist.window_on_top = next;
    })?;
    Ok(next)
}

fn set_opacity_impl(app: &AppHandle, opacity: f64) -> AppResult<f64> {
    let next = opacity.clamp(0.2, 1.0);
    let state = app.state::<AppState>();
    let inside = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.window_inside
    };
    for label in browser_labels(app) {
        if let Ok(browser) = browser_window_by_label(app, &label) {
            apply_window_effects(&browser, next, inside)?;
        }
    }
    update_persist(&state, |persist| {
        persist.window_opacity = next;
    })?;
    Ok(next)
}

fn set_shell_opacity_impl(app: &AppHandle, opacity: f64) -> AppResult<f64> {
    let next = opacity.clamp(0.2, 1.0);
    let state = app.state::<AppState>();
    update_persist(&state, |persist| {
        persist.window_opacity = next;
    })?;

    let script = format!("(() => {{ document.documentElement.style.opacity = '{}'; document.body.style.opacity = '{}'; }})();", next, next);
    for label in browser_labels(app) {
        if let Ok(browser) = browser_window_by_label(app, &label) {
            let _ = browser.eval(script.clone());
        }
    }
    Ok(next)
}

#[tauri::command]
async fn set_shell_opacity(app: AppHandle, opacity: f64) -> AppResult<f64> {
    set_shell_opacity_impl(&app, opacity)
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
    let scale = browser.scale_factor().unwrap_or(1.0).max(0.01);
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
            persist.window_start_x = position.x as f64 / scale;
            persist.window_start_y = position.y as f64 / scale;
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

    let state = app.state::<AppState>();
    let scale = browser.scale_factor().unwrap_or(1.0).max(0.01);
    let current_url = browser
        .url()
        .map(|u| u.to_string())
        .unwrap_or_else(|_| state.home_url.clone());
    update_persist(&state, |persist| {
        persist.window_start_x = x as f64 / scale;
        persist.window_start_y = y as f64 / scale;
        persist.window_width = (width as f64 / scale).round();
        persist.window_height = (height as f64 / scale).round();
        if !current_url.trim().is_empty() {
            persist.last_url = current_url.clone();
        }
    })?;

    Ok(ratio)
}

fn is_start_page_url(url: &str) -> bool {
    url.contains("lucid-start-page")
}

/// Resize the browser window to fit the start page (no scrolling) and
/// center it on the current monitor, persisting the resulting logical
/// geometry so the next non-home launch restores sensibly.
fn fit_window_to_start_page(app: &AppHandle) -> AppResult<()> {
    let browser = browser_window(app)?;
    let scale = browser.scale_factor().unwrap_or(1.0).max(0.01);
    browser
        .set_size(Size::Logical(LogicalSize::new(
            START_PAGE_FIT_WIDTH,
            START_PAGE_FIT_HEIGHT,
        )))
        .map_err(|err| format!("Set start page size failed: {err}"))?;
    // Give the window manager a moment to apply the resize before the
    // outer rect is read for centering.
    thread::sleep(Duration::from_millis(150));
    if let Ok(Some(monitor)) = browser.current_monitor() {
        if let Ok(outer) = browser.outer_size() {
            let x = monitor.position().x
                + (((monitor.size().width as i32 - outer.width as i32) / 2).max(0));
            let y = monitor.position().y
                + (((monitor.size().height as i32 - outer.height as i32) / 2).max(0));
            let _ = browser.set_position(Position::Physical(PhysicalPosition::new(x, y)));
            let state = app.state::<AppState>();
            update_persist(&state, |persist| {
                persist.window_start_x = x as f64 / scale;
                persist.window_start_y = y as f64 / scale;
                persist.window_width = START_PAGE_FIT_WIDTH;
                persist.window_height = START_PAGE_FIT_HEIGHT;
            })?;
        }
    }
    Ok(())
}

/// True when at least a readable chunk of the window sits inside a monitor.
fn window_is_reachable(window: &WebviewWindow) -> bool {
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.outer_size() else {
        return false;
    };
    if position.x <= MIN_VISIBLE_COORD
        || position.y <= MIN_VISIBLE_COORD
        || size.width == 0
        || size.height == 0
    {
        return false;
    }
    let Ok(monitors) = window.available_monitors() else {
        return true;
    };
    if monitors.is_empty() {
        return true;
    }
    monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let extent = monitor.size();
        let overlap_x = (position.x + size.width as i32).min(origin.x + extent.width as i32)
            - position.x.max(origin.x);
        let overlap_y = (position.y + size.height as i32).min(origin.y + extent.height as i32)
            - position.y.max(origin.y);
        overlap_x >= 160 && overlap_y >= 90
    })
}

/// Center and clamp the window onto the primary monitor. Used on launch and by
/// the rescue shortcut when the saved rect is off-screen (monitor unplugged,
/// resolution changed, or geometry captured while the window was iconic).
fn center_window_on_primary(window: &WebviewWindow) -> AppResult<()> {
    let monitor = window
        .primary_monitor()
        .map_err(|err| format!("Read monitor failed: {err}"))?
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|list| list.into_iter().next())
        });
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let origin = monitor.position();
    let extent = monitor.size();
    let fallback_width = ((extent.width as f64) * 0.6).round().max(900.0) as u32;
    let fallback_height = ((extent.height as f64) * 0.6).round().max(600.0) as u32;
    let (width, height) = match window.outer_size() {
        Ok(size) if size.width >= 600 && size.height >= 320 => {
            (size.width.min(extent.width), size.height.min(extent.height))
        }
        _ => (
            fallback_width.min(extent.width),
            fallback_height.min(extent.height),
        ),
    };
    let x = origin.x + ((extent.width as i32 - width as i32) / 2).max(0);
    let y = origin.y + ((extent.height as i32 - height as i32) / 2).max(0);
    let _ = window.set_size(Size::Physical(PhysicalSize::new(width, height)));
    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|err| format!("Set position failed: {err}"))?;
    Ok(())
}

fn ensure_window_on_screen(window: &WebviewWindow) -> AppResult<()> {
    if window_is_reachable(window) {
        return Ok(());
    }
    center_window_on_primary(window)
}

/// Recovery path for "I cannot find the window". Restores a visible, fully
/// opaque, clickable window on screen. Wired to a fixed shortcut, the tray and
/// the settings panel so it never depends on the user's own hotkey config
/// (which may be exactly what put the window out of reach).
fn rescue_window_impl(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let on_top = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.window_on_top
    };
    update_persist(&state, |persist| {
        persist.window_opacity = 1.0;
        persist.window_inside = false;
        persist.window_visible = true;
        // A locked position would snap the window straight back to the
        // off-screen rect we are about to correct.
        persist.window_position_locked = false;
    })?;

    for label in browser_labels(app) {
        let Ok(window) = browser_window_by_label(app, &label) else {
            continue;
        };
        let _ = window.set_ignore_cursor_events(false);
        let _ = apply_window_effects(&window, 1.0, false);
        let _ = window.set_always_on_top(on_top);
        let _ = window
            .eval("(() => { document.documentElement.style.opacity = '1'; document.body.style.opacity = '1'; })();");
    }

    let window = browser_window(app)?;
    let _ = window.unminimize();
    window
        .show()
        .map_err(|err| format!("Show window failed: {err}"))?;
    let _ = window.set_always_on_top(on_top);
    ensure_window_on_screen(&window)?;
    let _ = window.set_focus();
    sync_shell_visibility(app, &window);
    push_log(app, "native", "rescue_window", "ok");
    Ok(())
}

#[tauri::command]
async fn rescue_window(app: AppHandle) -> AppResult<()> {
    rescue_window_impl(&app)
}

/// Toggle the user-configurable global shortcuts without losing the rescued
/// window path: the fixed rescue shortcut is always re-registered.
#[tauri::command]
async fn set_hotkeys_enabled(app: AppHandle, state: tauri::State<'_, AppState>, enabled: bool) -> AppResult<bool> {
    update_persist(&state, |persist| {
        persist.hotkeys_enabled = enabled;
    })?;
    let config = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.hotkeys.clone()
    };
    register_hotkeys(&app, &config, enabled);
    Ok(enabled)
}

fn bookmarks_snapshot(state: &AppState) -> AppResult<Vec<BookmarkItem>> {
    let locked = state
        .data
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?;
    Ok(locked.persist.bookmarks.clone())
}

fn add_bookmark_impl(state: &AppState, url: String, title: String) -> AppResult<Vec<BookmarkItem>> {
    let bookmark = normalize_bookmark(&url, &title, &state.home_url)?;
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
    let normalized_url = normalize_url_with_home(&url, &state.home_url);
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
        HotkeyAction::ToggleRecording => execute_video_action(app, "toggle_recording"),
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

/// (Re)registers the OS-level shortcuts. Never fails: a binding another
/// application already owns is recorded as a conflict and surfaced in the
/// settings panel. Aborting the whole app because one combo is taken is how
/// 1.1.21 could not start at all when `Ctrl+Alt+P` happened to be in use.
fn register_hotkeys(app: &AppHandle, config: &HotkeyConfig, enabled: bool) {
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();

    let mut conflicts: Vec<String> = Vec::new();

    // The rescue shortcut is intentionally not user-editable and is registered
    // even when the user has switched global hotkeys off: it is the documented
    // way back from "hidden window / 20% opacity / click-through".
    if let Err(err) = manager.on_shortcut(RESCUE_SHORTCUT, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let _ = rescue_window_impl(app);
        }
    }) {
        push_log(app, "native", "register_rescue_hotkey", format!("failed:{err}"));
        conflicts.push(format!("rescue={RESCUE_SHORTCUT}: {err}"));
    }

    if enabled {
        let mappings = [
        (
            "togglePlayPause",
            config.toggle_play_pause.as_str(),
            HotkeyAction::TogglePlayPause,
        ),
        (
            "toggleRecording",
            config.toggle_recording.as_str(),
            HotkeyAction::ToggleRecording,
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

        let mut claimed: HashSet<String> = HashSet::new();
        for (name, shortcut, action) in mappings {
            let key = shortcut.trim();
            if key.is_empty() {
                continue;
            }
            let key = if key == "\u{0060}" { "Backquote" } else { key };
            if key.eq_ignore_ascii_case(RESCUE_SHORTCUT) {
                // The rescue shortcut is reserved and already registered above.
                push_log(app, "native", "register_hotkeys", format!("reserved:{name}"));
                continue;
            }
            if !binding_is_global(key) {
                // No modifier -> registered nowhere at the OS level. The shell
                // matches it on keydown and suppresses it while an IME
                // composition is open or an editable element has focus, so bare
                // keys stay usable inside the viewer without touching other
                // apps' typing.
                push_log(app, "native", "register_hotkeys", format!("in_app:{name}={key}"));
                continue;
            }
            // Two actions bound to the same combo: the OS would reject the
            // second, so claim the slot ourselves and report it once.
            if !claimed.insert(key.to_ascii_lowercase()) {
                push_log(app, "native", "register_hotkeys", format!("duplicate:{name}={key}"));
                conflicts.push(format!("{name}={key}: duplicate"));
                continue;
            }
            let result = manager.on_shortcut(key, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = run_hotkey_action(app, action);
                }
            });
            if let Err(err) = result {
                push_log(app, "native", "register_hotkeys", format!("conflict:{name}={key}"));
                conflicts.push(format!("{name}={key}: {err}"));
            }
        }
    } else {
        push_log(app, "native", "register_hotkeys", "disabled");
    }

    push_log(
        app,
        "native",
        "register_hotkeys",
        format!("done:conflicts={}", conflicts.len()),
    );
    {
        let state = app.state::<AppState>();
        let mut locked = state
            .hotkey_conflicts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *locked = conflicts;
    }
}

fn setup_tray(app: &AppHandle) -> AppResult<()> {
    let ui_lang_zh = app.state::<AppState>().ui_lang_zh.load(Ordering::SeqCst);
    let panel_item = MenuItem::with_id(
        app,
        "tray_panel",
        ui_text(
            ui_lang_zh,
            "\u{63A7}\u{5236}\u{9762}\u{677F}",
            "Control Panel",
        ),
        true,
        None::<&str>,
    )
    .map_err(|err| format!("Create tray menu failed: {err}"))?;
    let show_item = MenuItem::with_id(
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
    let hide_item = MenuItem::with_id(
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
    let exit_item = MenuItem::with_id(
        app,
        "tray_exit",
        ui_text(ui_lang_zh, "\u{9000}\u{51FA}", "Exit"),
        true,
        None::<&str>,
    )
    .map_err(|err| format!("Create tray menu failed: {err}"))?;
    let rescue_item = MenuItem::with_id(
        app,
        "tray_rescue",
        ui_text(
            ui_lang_zh,
            "\u{627E}\u{56DE}\u{7A97}\u{53E3}\u{FF08}\u{6062}\u{590D}\u{900F}\u{660E}\u{5EA6}/\u{4F4D}\u{7F6E}\u{FF09}",
            "Restore Window (reset opacity & position)",
        ),
        true,
        None::<&str>,
    )
    .map_err(|err| format!("Create tray menu failed: {err}"))?;
    let separator = PredefinedMenuItem::separator(app).map_err(|err| err.to_string())?;
    let menu = Menu::with_items(
        app,
        &[
            &panel_item,
            &show_item,
            &hide_item,
            &rescue_item,
            &separator,
            &exit_item,
        ],
    )
    .map_err(|err| format!("Create tray menu failed: {err}"))?;

    let mut tray_builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_panel" => {
                let _ = create_or_show_control_window(app);
            }
            "tray_rescue" => {
                let _ = rescue_window_impl(app);
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
    let home_url = app.state::<AppState>().home_url.clone();
    let url = parse_url(&normalize_url_with_home(initial_url, &home_url))?;
    let app_for_popup = app.clone();
    let app_for_load = app.clone();
    let label_for_popup = label.to_string();
    let label_for_load = label.to_string();
    let ui_lang_zh = app.state::<AppState>().ui_lang_zh.load(Ordering::SeqCst);

    let shell_script = shared_shell_script(app)?;

    // The home page must load through the application protocol (WebviewUrl::App)
    // so the injected shell gets a valid IPC origin.
    let webview_url = if url.as_str() == home_url {
        WebviewUrl::App(PathBuf::from(LOCAL_HOME_RESOURCE))
    } else {
        WebviewUrl::External(url)
    };

    let browser = WebviewWindowBuilder::new(app, label.to_string(), webview_url)
        .title(ui_text(
            ui_lang_zh,
            "DI-Viewer Browser",
            "DI-Viewer Browser",
        ))
        .inner_size(initial.window_width, initial.window_height)
        .min_inner_size(600.0, 320.0)
        .additional_browser_args(WEBVIEW_BROWSER_ARGS)
        .position(initial.window_start_x, initial.window_start_y)
        .resizable(true)
        .always_on_top(initial.window_on_top)
        .user_agent(DESKTOP_BROWSER_USER_AGENT)
        .visible(visible)
        .initialization_script(shell_script)
        .on_navigation(|_url| true)
        .on_new_window(move |new_url, _features| {
            if let Some(browser) = app_for_popup.get_webview_window(&label_for_popup) {
                let _ = navigate_browser_to(&browser, new_url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(move |window, _payload| {
            let visible = app_for_load
                .state::<AppState>()
                .sidebar_visible
                .load(Ordering::SeqCst);
            if let Err(err) = window.eval(shared_shell_visibility_script(visible)) {
                push_log(
                    &app_for_load,
                    "native",
                    "sync_shared_shell_visibility",
                    format!("failed:{err}"),
                );
            }
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
                        let _ = browser.set_position(Position::Physical(PhysicalPosition::new(
                            target_x, target_y,
                        )));
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
            // Resized fires continuously while dragging edges; debounce the
            // disk write instead of persisting on every tick.
            let state = app_handle.state::<AppState>();
            let seq = state.resize_seq.fetch_add(1, Ordering::SeqCst) + 1;
            let app_for_resize = app_handle.clone();
            let label_for_resize = label_for_event.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(RESIZE_DEBOUNCE_MS));
                let state = app_for_resize.state::<AppState>();
                if state.resize_seq.load(Ordering::SeqCst) == seq {
                    let _ =
                        persist_browser_state_for_label(&app_for_resize, &label_for_resize, false);
                }
            });
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
    let (initial, active_url, visible, active_label) = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        let active = if locked.tabs.is_empty() {
            0
        } else {
            locked.active_tab.min(locked.tabs.len() - 1)
        };
        let (active_url, active_label) = if locked.tabs.is_empty() {
            (
                locked.persist.last_url.clone(),
                BROWSER_LABEL.to_string(),
            )
        } else {
            (
                locked.tabs[active].url.clone(),
                locked.tabs[active].label.clone(),
            )
        };
        (
            locked.persist.clone(),
            active_url,
            locked.persist.window_visible,
            active_label,
        )
    };

    let browser = create_browser_tab_window(app, &active_label, &initial, &active_url, visible)?;
    if visible {
        let _ = browser.show();
        let _ = browser.set_focus();
    }
    Ok(())
}

fn push_log(app: &AppHandle, source: &str, action: &str, detail: impl Into<String>) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let detail_text = detail.into();
    let entry = LogEntry {
        ts,
        source: source.to_string(),
        action: action.to_string(),
        detail: detail_text.clone(),
    };

    let line = format!(
        "[diviewer-log] {} {}:{}:{}",
        ts, source, action, detail_text
    );
    eprintln!("{}", line);

    let state = app.state::<AppState>();
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&state.runtime_log_path)
    {
        let _ = writeln!(file, "{}", line);
    }

    if let Ok(mut locked) = state.log_store.lock() {
        locked.push(entry);
        if locked.len() > 300 {
            let excess = locked.len() - 300;
            locked.drain(0..excess);
        }
    };
}

fn append_runtime_log(path: &Path, source: &str, action: &str, detail: impl AsRef<str>) {
    let ts = current_timestamp_ms();
    let line = format!(
        "[diviewer-log] {} {}:{}:{}",
        ts,
        source,
        action,
        detail.as_ref()
    );
    eprintln!("{}", line);
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", line);
    }
}

fn initialize_runtime_log(path: &Path) -> AppResult<()> {
    let file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|err| format!("Failed initializing runtime log {}: {err}", path.display()))?;
    file.sync_all()
        .map_err(|err| format!("Failed syncing runtime log {}: {err}", path.display()))
}

fn current_ui_lang(state: &AppState) -> String {
    if state.ui_lang_zh.load(Ordering::SeqCst) {
        "zh".to_string()
    } else {
        "en".to_string()
    }
}

fn current_dock_color(state: &AppState) -> String {
    state
        .data
        .lock()
        .map(|locked| normalize_dock_color(&locked.persist.dock_color).to_string())
        .unwrap_or_else(|_| "white".to_string())
}

#[tauri::command]
async fn get_state(app: AppHandle, state: tauri::State<'_, AppState>) -> AppResult<FrontendState> {
    let mut snapshot = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        (locked.persist.clone(), locked.hotkeys.clone())
    };

    // Read-only: never take the lazy-creation path here, `get_state` is polled.
    if let Ok(label) = active_browser_label(&app) {
        if let Ok(browser) = browser_window_by_label(&app, &label) {
            if let Ok(url) = browser.url() {
                snapshot.0.last_url = url.to_string();
            }
            snapshot.0.window_visible = browser.is_visible().unwrap_or(snapshot.0.window_visible);
            snapshot.0.window_maximized = browser
                .is_maximized()
                .unwrap_or(snapshot.0.window_maximized);
        }
    }

    Ok(FrontendState {
        last_url: snapshot.0.last_url,
        opacity: snapshot.0.window_opacity,
        on_top: snapshot.0.window_on_top,
        inside: snapshot.0.window_inside,
        visible: snapshot.0.window_visible,
        maximized: snapshot.0.window_maximized,
        position_locked: snapshot.0.window_position_locked,
        hotkeys_enabled: snapshot.0.hotkeys_enabled,
        sidebar_visible: state.sidebar_visible.load(Ordering::SeqCst),
        ui_lang: current_ui_lang(&state),
        bookmarks: snapshot.0.bookmarks,
        hotkeys: snapshot.1,
        hotkey_conflicts: state
            .hotkey_conflicts
            .lock()
            .map(|locked| locked.clone())
            .unwrap_or_default(),
    })
}

#[tauri::command]
async fn get_hotkeys(state: tauri::State<'_, AppState>) -> AppResult<HotkeyConfig> {
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
async fn get_ui_language(state: tauri::State<'_, AppState>) -> AppResult<String> {
    Ok(current_ui_lang(&state))
}

#[tauri::command]
async fn set_ui_language(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    lang: String,
) -> AppResult<String> {
    let normalized = normalize_ui_lang(&lang).unwrap_or("zh");
    state.ui_lang_zh.store(normalized == "zh", Ordering::SeqCst);
    update_persist(&state, |persist| {
        persist.ui_language = normalized.to_string();
    })?;
    if let Some(window) = app.get_webview_window(CONTROL_LABEL) {
        let _ = window.set_title(ui_text(
            normalized == "zh",
            "DI-Viewer \u{63A7}\u{5236}\u{53F0}",
            "DI-Viewer Control",
        ));
    }
    Ok(normalized.to_string())
}

#[tauri::command]
async fn get_dock_color(state: tauri::State<'_, AppState>) -> AppResult<String> {
    Ok(current_dock_color(&state))
}

#[tauri::command]
async fn set_dock_color(state: tauri::State<'_, AppState>, color: String) -> AppResult<String> {
    let normalized = normalize_dock_color(&color).to_string();
    update_persist(&state, |persist| {
        persist.dock_color = normalized.clone();
    })?;
    Ok(normalized)
}

#[tauri::command]
async fn navigate(app: AppHandle, state: tauri::State<'_, AppState>, url: String) -> AppResult<String> {
    let normalized = normalize_url_with_home(&url, &state.home_url);
    push_log(&app, "ui", "navigate", format!("start:{}", normalized));
    let browser = browser_window(&app)?;
    navigate_browser_to(&browser, &normalized)?;
    set_active_tab_url(&state, normalized.clone())?;
    push_log(&app, "ui", "navigate", "ok");
    Ok(normalized)
}

#[tauri::command]
async fn go_home(app: AppHandle, state: tauri::State<'_, AppState>) -> AppResult<String> {
    let home = state.home_url.clone();
    navigate(app, state, home).await
}

#[tauri::command]
async fn toggle_show_hide(app: AppHandle) -> AppResult<bool> {
    toggle_show_hide_impl(&app)
}

#[tauri::command]
async fn toggle_inside_mode(app: AppHandle) -> AppResult<bool> {
    toggle_inside_mode_impl(&app)
}

#[tauri::command]
async fn set_inside_mode(app: AppHandle, inside: bool) -> AppResult<bool> {
    set_inside_mode_command(app, inside)
}

#[tauri::command]
async fn toggle_on_top(app: AppHandle) -> AppResult<bool> {
    toggle_on_top_impl(&app)
}

#[tauri::command]
async fn set_opacity(app: AppHandle, opacity: f64) -> AppResult<f64> {
    set_opacity_impl(&app, opacity)
}

#[tauri::command]
async fn increase_opacity(app: AppHandle) -> AppResult<f64> {
    adjust_opacity_impl(&app, 0.1)
}

#[tauri::command]
async fn decrease_opacity(app: AppHandle) -> AppResult<f64> {
    adjust_opacity_impl(&app, -0.1)
}

#[tauri::command]
async fn toggle_lock_position(app: AppHandle) -> AppResult<bool> {
    toggle_position_lock_impl(&app)
}

#[tauri::command]
async fn resize_to_ratio(app: AppHandle, ratio: f64) -> AppResult<f64> {
    resize_to_ratio_impl(&app, ratio)
}

#[tauri::command]
async fn get_bookmarks(state: tauri::State<'_, AppState>) -> AppResult<Vec<BookmarkItem>> {
    bookmarks_snapshot(&state)
}

#[tauri::command]
async fn add_bookmark(
    state: tauri::State<'_, AppState>,
    url: String,
    title: String,
) -> AppResult<Vec<BookmarkItem>> {
    add_bookmark_impl(&state, url, title)
}

#[tauri::command]
async fn remove_bookmark(state: tauri::State<'_, AppState>, url: String) -> AppResult<Vec<BookmarkItem>> {
    remove_bookmark_impl(&state, url)
}

#[tauri::command]
async fn list_tabs(state: tauri::State<'_, AppState>) -> AppResult<TabSessionSnapshot> {
    tabs_snapshot(&state)
}

#[tauri::command]
async fn get_logs(state: tauri::State<'_, AppState>) -> AppResult<Vec<LogEntry>> {
    let logs = state
        .log_store
        .lock()
        .map_err(|_| "State lock poisoned".to_string())?;
    Ok(logs.clone())
}

/// Re-apply the persisted layer effects to a single tab window. Each tab owns
/// a window, so opacity / click-through / always-on-top must be restored on the
/// one being presented, otherwise a freshly created tab would look different.
fn apply_saved_window_state(app: &AppHandle, window: &WebviewWindow) -> AppResult<()> {
    let state = app.state::<AppState>();
    let (opacity, inside, on_top) = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        (
            locked.persist.window_opacity,
            locked.persist.window_inside,
            locked.persist.window_on_top,
        )
    };
    apply_window_effects(window, opacity, inside)?;
    let _ = window.set_ignore_cursor_events(inside);
    let _ = window.set_always_on_top(on_top);
    Ok(())
}

fn sync_shell_visibility(app: &AppHandle, window: &WebviewWindow) {
    let visible = app
        .state::<AppState>()
        .sidebar_visible
        .load(Ordering::SeqCst);
    let _ = window.eval(shared_shell_visibility_script(visible));
}

/// Bring `target_label` on screen and hide every other tab window. Pages are
/// never reloaded here: a hidden webview keeps its document, so scroll
/// position, form input and media playback survive the switch.
fn present_tab_window(app: &AppHandle, target_label: &str, from_label: &str) -> AppResult<()> {
    let target = ensure_browser_window(app, target_label)?;
    let mut inherit_maximized = false;
    if target_label != from_label {
        if let Some(current) = app.get_webview_window(from_label) {
            inherit_maximized = current.is_maximized().unwrap_or(false);
            if let (Ok(position), Ok(size)) = (current.outer_position(), current.inner_size()) {
                let _ = target.set_position(Position::Physical(position));
                if !inherit_maximized {
                    let _ = target.set_size(Size::Physical(size));
                }
            }
        }
    }
    if inherit_maximized {
        let _ = target.maximize();
    }
    apply_saved_window_state(app, &target)?;
    let _ = target.unminimize();
    target
        .show()
        .map_err(|err| format!("Show window failed: {err}"))?;
    let _ = target.set_focus();
    sync_shell_visibility(app, &target);
    for label in browser_labels(app) {
        if label == target_label {
            continue;
        }
        if let Some(other) = app.get_webview_window(&label) {
            let _ = other.hide();
        }
    }
    Ok(())
}

#[tauri::command]
async fn switch_tab(app: AppHandle, state: tauri::State<'_, AppState>, index: i32) -> AppResult<String> {
    push_log(&app, "ui", "switch_tab", format!("start:{}", index));

    let (idx, target_url, target_label, current_label) = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        if locked.tabs.is_empty() {
            return Err("No browser tabs".to_string());
        }
        let current_idx = locked.active_tab.min(locked.tabs.len() - 1);
        let idx = if index < 0 {
            current_idx
        } else {
            (index as usize).min(locked.tabs.len() - 1)
        };
        (
            idx,
            locked.tabs[idx].url.clone(),
            locked.tabs[idx].label.clone(),
            locked.tabs[current_idx].label.clone(),
        )
    };

    {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.active_tab = idx;
    }

    present_tab_window(&app, &target_label, &current_label)?;

    update_persist(&state, |persist| {
        persist.last_url = target_url.clone();
        persist.window_visible = true;
    })?;

    push_log(&app, "ui", "switch_tab", "ok");
    Ok(target_url)
}

#[tauri::command]
async fn new_tab(app: AppHandle, state: tauri::State<'_, AppState>, url: String) -> AppResult<String> {
    push_log(&app, "ui", "new_tab", format!("start:{}", url));

    let target = normalize_url_with_home(
        if url.trim().is_empty() {
            state.home_url.as_str()
        } else {
            url.as_str()
        },
        &state.home_url,
    );

    let (label, current_label) = {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;

        if locked.tabs.len() >= MAX_TAB_SESSIONS {
            push_log(&app, "ui", "new_tab", "max_tabs");
            return Err(format!("Maximum tab count reached: {MAX_TAB_SESSIONS}"));
        }

        let current_label = if locked.tabs.is_empty() {
            String::new()
        } else {
            let current_idx = locked.active_tab.min(locked.tabs.len() - 1);
            locked.tabs[current_idx].label.clone()
        };
        let seq = state.next_tab_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let label = format!("browser-{seq}");
        locked.tabs.push(BrowserTab {
            label: label.clone(),
            title: tab_title_from_url(&target),
            url: target.clone(),
        });
        locked.active_tab = locked.tabs.len().saturating_sub(1);
        (label, current_label)
    };

    present_tab_window(&app, &label, &current_label)?;

    update_persist(&state, |persist| {
        persist.last_url = target.clone();
        persist.window_visible = true;
    })?;

    push_log(&app, "ui", "new_tab", "ok");
    Ok(target)
}

#[tauri::command]
async fn close_tab(app: AppHandle, state: tauri::State<'_, AppState>, index: i32) -> AppResult<bool> {
    push_log(&app, "ui", "close_tab", format!("start:{}", index));

    struct ClosePlan {
        removed_label: Option<String>,
        next_label: String,
        next_url: String,
        reset_to_home: bool,
        switch_now: bool,
    }

    let plan = {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;

        if locked.tabs.is_empty() {
            ClosePlan {
                removed_label: None,
                next_label: BROWSER_LABEL.to_string(),
                next_url: state.home_url.clone(),
                reset_to_home: true,
                switch_now: true,
            }
        } else if locked.tabs.len() == 1 {
            let label = locked.tabs[0].label.clone();
            locked.tabs[0].url = state.home_url.clone();
            locked.tabs[0].title = tab_title_from_url(&state.home_url);
            locked.active_tab = 0;
            ClosePlan {
                removed_label: None,
                next_label: label,
                next_url: state.home_url.clone(),
                reset_to_home: true,
                switch_now: true,
            }
        } else {
            let active_before = locked.active_tab.min(locked.tabs.len() - 1);
            let remove_idx = if index < 0 {
                active_before
            } else {
                (index as usize).min(locked.tabs.len() - 1)
            };
            let removed = locked.tabs.remove(remove_idx);
            let len = locked.tabs.len();
            let next_idx = if remove_idx < active_before {
                active_before - 1
            } else if remove_idx == active_before {
                remove_idx.min(len - 1)
            } else {
                active_before
            };
            locked.active_tab = next_idx;
            ClosePlan {
                removed_label: Some(removed.label),
                next_label: locked.tabs[next_idx].label.clone(),
                next_url: locked.tabs[next_idx].url.clone(),
                reset_to_home: false,
                switch_now: remove_idx == active_before,
            }
        }
    };

    // Capture the outgoing window's on-screen geometry before it closes so the
    // neighbouring tab takes over the exact same rectangle.
    let inherited_geometry = plan
        .removed_label
        .as_deref()
        .and_then(|label| app.get_webview_window(label))
        .and_then(|window| {
            let maximized = window.is_maximized().unwrap_or(false);
            window
                .outer_position()
                .ok()
                .zip(window.inner_size().ok())
                .map(|(position, size)| (position, size, maximized))
        });

    if let Some(removed_label) = plan.removed_label.as_deref() {
        if let Some(window) = app.get_webview_window(removed_label) {
            if let Ok(mut closing) = state.closing_windows.lock() {
                closing.insert(removed_label.to_string());
            }
            let _ = window.close();
        }
    }

    if plan.switch_now {
        let active_label = {
            let locked = state
                .data
                .lock()
                .map_err(|_| "State lock poisoned".to_string())?;
            locked
                .tabs
                .get(locked.active_tab)
                .map(|tab| tab.label.clone())
                .unwrap_or_else(|| plan.next_label.clone())
        };
        let window = ensure_browser_window(&app, &active_label)?;
        if plan.reset_to_home {
            navigate_browser_to(&window, &plan.next_url)?;
        }
        apply_saved_window_state(&app, &window)?;
        let _ = window.unminimize();
        window
            .show()
            .map_err(|err| format!("Show window failed: {err}"))?;
        let _ = window.set_focus();
        sync_shell_visibility(&app, &window);
        if let Some((position, size, maximized)) = inherited_geometry {
            let _ = window.set_position(Position::Physical(position));
            if maximized {
                let _ = window.maximize();
            } else {
                let _ = window.set_size(Size::Physical(size));
            }
        }
        for label in browser_labels(&app) {
            if label == active_label {
                continue;
            }
            if let Some(other) = app.get_webview_window(&label) {
                let _ = other.hide();
            }
        }
    }

    let next_url = plan.next_url;
    update_persist(&state, |persist| {
        persist.last_url = next_url.clone();
        persist.window_visible = true;
    })?;

    push_log(&app, "ui", "close_tab", "ok");
    Ok(true)
}

#[tauri::command]
async fn minimize_browser(app: AppHandle) -> AppResult<()> {
    let browser = browser_window(&app)?;
    browser
        .minimize()
        .map_err(|err| format!("Minimize failed: {err}"))
}

#[tauri::command]
async fn maximize_restore_browser(app: AppHandle) -> AppResult<bool> {
    maximize_restore_impl(&app)
}

#[tauri::command]
async fn video_action(app: AppHandle, action: String) -> AppResult<()> {
    execute_video_action(&app, &action)
}

#[tauri::command]
async fn go_back(app: AppHandle) -> AppResult<String> {
    let browser = browser_window(&app)?;
    browser
        .eval("window.history.back();")
        .map_err(|err| format!("Evaluate JS failed: {err}"))?;
    Ok("ok".to_string())
}

#[tauri::command]
async fn go_forward(app: AppHandle) -> AppResult<String> {
    let browser = browser_window(&app)?;
    browser
        .eval("window.history.forward();")
        .map_err(|err| format!("Evaluate JS failed: {err}"))?;
    Ok("ok".to_string())
}

#[tauri::command]
async fn refresh_page(app: AppHandle) -> AppResult<String> {
    let browser = browser_window(&app)?;
    browser
        .eval("window.location.reload();")
        .map_err(|err| format!("Evaluate JS failed: {err}"))?;
    Ok("ok".to_string())
}

#[tauri::command]
async fn toggle_sidebar(app: AppHandle) -> AppResult<bool> {
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
    let script = shared_shell_visibility_script(next);
    for label in labels {
        if let Ok(browser) = browser_window_by_label(&app, &label) {
            let _ = browser.eval(script.clone());
        }
    }
    Ok(next)
}

#[tauri::command]
async fn open_control_panel(app: AppHandle) -> AppResult<()> {
    create_or_show_control_window(&app)
}

#[tauri::command]
async fn save_hotkeys(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    config: HotkeyConfig,
) -> AppResult<()> {
    let sanitized = config.sanitize();
    {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.hotkeys = sanitized.clone();
    }
    save_hotkeys_file(&state)?;
    let enabled = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.hotkeys_enabled
    };
    register_hotkeys(&app, &sanitized, enabled);
    Ok(())
}

#[tauri::command]
async fn reset_hotkeys(app: AppHandle, state: tauri::State<'_, AppState>) -> AppResult<HotkeyConfig> {
    let defaults = HotkeyConfig::default();
    {
        let mut locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.hotkeys = defaults.clone();
    }
    save_hotkeys_file(&state)?;
    let enabled = {
        let locked = state
            .data
            .lock()
            .map_err(|_| "State lock poisoned".to_string())?;
        locked.persist.hotkeys_enabled
    };
    register_hotkeys(&app, &defaults, enabled);
    Ok(defaults)
}

#[tauri::command]
async fn close_app(app: AppHandle) -> AppResult<()> {
    close_app_impl(&app);
    Ok(())
}

#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|err| format!("Open external url failed: {err}"))
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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| -> Result<(), Box<dyn std::error::Error>> {
            let data_dir = resolve_data_dir(&app.handle().clone());
            fs::create_dir_all(&data_dir)?;

            let history_path = data_dir.join("history.json");
            let hotkeys_path = data_dir.join("hotkeys.json");
            let runtime_log_path = data_dir.join("runtime.log");
            initialize_runtime_log(&runtime_log_path)?;
            eprintln!(
                "[diviewer-log] runtime log file: {}",
                runtime_log_path.display()
            );

            let panic_log_path = runtime_log_path.clone();
            std::panic::set_hook(Box::new(move |info| {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
                    (*s).to_string()
                } else if let Some(s) = info.payload().downcast_ref::<String>() {
                    s.clone()
                } else {
                    "panic payload unavailable".to_string()
                };
                let location = info
                    .location()
                    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                    .unwrap_or_else(|| "unknown".to_string());
                let line = format!(
                    "[diviewer-panic] {} location={} message={}",
                    ts, location, message
                );
                eprintln!("{}", line);
                if let Ok(mut file) = fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&panic_log_path)
                {
                    let _ = writeln!(file, "{}", line);
                }
            }));

            let home_url = resolve_home_url(&app.handle().clone());
            let mut persist = read_json_or_default::<PersistedState>(
                &history_path,
                &runtime_log_path,
                "history_read",
                append_runtime_log,
            );
            persist.last_url = normalize_url_with_home(&persist.last_url, &home_url);
            persist.tab_urls = sanitize_tab_urls(persist.tab_urls, &home_url);
            if persist.tab_urls.is_empty() {
                persist.tab_urls.push(persist.last_url.clone());
            }
            persist.active_tab_index = persist.active_tab_index.min(persist.tab_urls.len() - 1);
            persist.last_url = persist.tab_urls[persist.active_tab_index].clone();
            persist.window_inside = false;
            persist.window_maximized = false;
            persist.window_opacity = persist.window_opacity.clamp(0.2, 1.0);
            persist.window_visible = true;
            persist.bookmarks = sanitize_bookmarks(persist.bookmarks, &home_url);
            let ui_lang_zh = match normalize_ui_lang(&persist.ui_language) {
                Some("zh") => true,
                Some("en") => false,
                _ => detect_ui_lang_zh(),
            };
            persist.ui_language = if ui_lang_zh {
                "zh".to_string()
            } else {
                "en".to_string()
            };
            persist.dock_color = normalize_dock_color(&persist.dock_color).to_string();
            let (initial_tabs, initial_active_tab) =
                build_tabs_from_persist(&mut persist, &home_url);
            let initial_tab_count = initial_tabs.len() as u64;

            let hotkeys = read_json_or_default::<HotkeyConfig>(
                &hotkeys_path,
                &runtime_log_path,
                "hotkeys_read",
                append_runtime_log,
            )
            // Bare-key bindings from older builds were real global shortcuts:
            // being promoted to Ctrl+Alt+<key> is what stops them from eating
            // ordinary typing. The second step then restores the scoped model
            // (modifier-less = in-app only) for configs nobody customised.
            .migrate_typing_safe()
            .migrate_scoped()
            .sanitize();

            app.manage(AppState {
                history_path,
                hotkeys_path,
                runtime_log_path,
                home_url,
                ui_lang_zh: AtomicBool::new(ui_lang_zh),
                data: Mutex::new(RuntimeState {
                    tabs: initial_tabs,
                    active_tab: initial_active_tab,
                    persist,
                    hotkeys,
                }),
                closing_windows: Mutex::new(HashSet::new()),
                snapping: AtomicBool::new(false),
                move_seq: AtomicU64::new(0),
                resize_seq: AtomicU64::new(0),
                sidebar_visible: AtomicBool::new(true),
                next_tab_seq: AtomicU64::new(initial_tab_count),
                hotkey_conflicts: Mutex::new(Vec::new()),
                log_store: Mutex::new(Vec::new()),
            });

            create_browser_window(&app.handle().clone()).map_err(std::io::Error::other)?;
            // When the app starts on the start page, fit the window to the
            // page size and center it on the monitor; otherwise respect the
            // persisted geometry and only fall back to the screen-50% default
            // when the saved size is missing/corrupt (below min_inner_size).
            {
                let state = app.state::<AppState>();
                let (on_home, geometry_ok) = {
                    let locked = state
                        .data
                        .lock()
                        .map_err(|_| std::io::Error::other("State lock poisoned"))?;
                    let persist = &locked.persist;
                    (
                        is_start_page_url(&persist.last_url),
                        persist.window_width >= 600.0 && persist.window_height >= 320.0,
                    )
                };
                if on_home {
                    let _ = fit_window_to_start_page(&app.handle().clone());
                } else if !geometry_ok {
                    let _ = resize_to_ratio_impl(&app.handle().clone(), 0.5);
                }
            }
            // A saved rect can point outside every monitor (unplugged display,
            // resolution change, geometry captured while minimized). Pull the
            // window back instead of leaving it unreachable.
            if let Ok(browser) = browser_window(&app.handle().clone()) {
                let _ = ensure_window_on_screen(&browser);
            }
            setup_tray(&app.handle().clone()).map_err(std::io::Error::other)?;

            {
                let state = app.state::<AppState>();
                let (config, enabled) = {
                    let locked = state
                        .data
                        .lock()
                        .map_err(|_| std::io::Error::other("State lock poisoned"))?;
                    (locked.hotkeys.clone(), locked.persist.hotkeys_enabled)
                };
                register_hotkeys(&app.handle().clone(), &config, enabled);
                save_history(&state).map_err(std::io::Error::other)?;
                save_hotkeys_file(&state).map_err(std::io::Error::other)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_hotkeys,
            get_ui_language,
            set_ui_language,
            get_dock_color,
            set_dock_color,
            navigate,
            go_home,
            go_back,
            go_forward,
            refresh_page,
            toggle_show_hide,
            toggle_inside_mode,
            set_inside_mode,
            toggle_on_top,
            set_opacity,
            set_shell_opacity,
            increase_opacity,
            decrease_opacity,
            toggle_lock_position,
            resize_to_ratio,
            get_bookmarks,
            add_bookmark,
            remove_bookmark,
            list_tabs,
            get_logs,
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
            set_hotkeys_enabled,
            rescue_window,
            close_app,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_maps_legacy_and_plain_hosts() {
        let home = "file:///tmp/lucid-start-page/index.html";

        assert_eq!(normalize_url_with_home("", home), home);
        assert_eq!(normalize_url_with_home("https://limestart.cn/", home), home);
        assert_eq!(
            normalize_url_with_home("example.com/path", home),
            "https://example.com/path"
        );
    }
}
