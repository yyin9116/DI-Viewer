use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{AppResult, LEGACY_HOME_URL};

pub(crate) const PERSISTENCE_SCHEMA_VERSION: u32 = 3;

pub(crate) fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn default_schema_version() -> u32 {
    PERSISTENCE_SCHEMA_VERSION
}

fn default_true() -> bool {
    true
}

/// Hotkey files written before the typing-safety migration carry either
/// `schemaVersion: 1` or no version at all. Treat both as "needs migration".
fn legacy_hotkey_schema_version() -> u32 {
    0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HotkeyConfig {
    #[serde(default = "legacy_hotkey_schema_version")]
    pub(crate) schema_version: u32,
    pub(crate) toggle_play_pause: String,
    pub(crate) toggle_recording: String,
    pub(crate) toggle_show_hide: String,
    pub(crate) inside_mode: String,
    pub(crate) video_backward: String,
    pub(crate) video_forward: String,
    pub(crate) decrease_opacity: String,
    pub(crate) increase_opacity: String,
    pub(crate) request_full_screen: String,
    pub(crate) close_window: String,
    /// One key that flips the whole "just watch the thing" set of states at
    /// once. Missing from every file written before it existed, so it carries
    /// its own default instead of failing the whole deserialisation and
    /// resetting the user's other bindings.
    #[serde(default = "default_immersive_binding")]
    pub(crate) immersive_mode: String,
}

pub(crate) fn default_immersive_binding() -> String {
    "Ctrl+Alt+I".to_string()
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        // Two classes of binding, told apart by the presence of a modifier:
        //  - with a modifier  -> system-wide (RegisterHotKey). Needed for the
        //    actions you must reach while another app is focused or the window
        //    is hidden: show/hide, click-through, quit.
        //  - without a modifier -> in-app only. The shell matches them on
        //    keydown and skips IME composition and editable targets, so `R` or
        //    `5` behave like a media key inside the viewer and are never
        //    swallowed in other applications.
        Self {
            schema_version: PERSISTENCE_SCHEMA_VERSION,
            toggle_play_pause: "Backquote".to_string(),
            toggle_recording: "R".to_string(),
            toggle_show_hide: "Ctrl+Alt+H".to_string(),
            inside_mode: "Ctrl+Alt+P".to_string(),
            video_backward: "5".to_string(),
            video_forward: "6".to_string(),
            decrease_opacity: "7".to_string(),
            increase_opacity: "8".to_string(),
            request_full_screen: "O".to_string(),
            close_window: "Ctrl+Q".to_string(),
            immersive_mode: default_immersive_binding(),
        }
    }
}

/// The defaults shipped by 1.1.21 (every binding forced to Ctrl+Alt+*).
/// Used to recognise "the user never touched this" when migrating to the
/// scoped model, so an untouched config gets the better defaults back while a
/// deliberately chosen binding is preserved.
fn v2_defaults() -> HotkeyConfig {
    HotkeyConfig {
        schema_version: 2,
        toggle_play_pause: "Ctrl+Alt+Space".to_string(),
        toggle_recording: "Ctrl+Alt+R".to_string(),
        toggle_show_hide: "Ctrl+Alt+H".to_string(),
        inside_mode: "Ctrl+Alt+P".to_string(),
        video_backward: "Ctrl+Alt+J".to_string(),
        video_forward: "Ctrl+Alt+L".to_string(),
        decrease_opacity: "Ctrl+Alt+9".to_string(),
        increase_opacity: "Ctrl+Alt+0".to_string(),
        request_full_screen: "Ctrl+Alt+F".to_string(),
        close_window: "Ctrl+Q".to_string(),
        // Did not exist in 1.1.21, so there is no "old value" to recognise;
        // whatever the file holds is what the migration leaves alone.
        immersive_mode: default_immersive_binding(),
    }
}

fn has_modifier(value: &str) -> bool {
    value.split('+').any(|token| {
        matches!(
            token.trim().to_lowercase().as_str(),
            "ctrl" | "control" | "alt" | "shift" | "meta" | "cmd" | "command" | "super"
        )
    })
}

/// A binding is registered system-wide only when it carries a modifier.
/// Modifier-less bindings are handled inside the shell instead.
pub(crate) fn binding_is_global(value: &str) -> bool {
    has_modifier(value)
}

/// Function keys and dedicated media keys do not produce text, so they are the
/// only bindings that are harmless without a modifier.
fn is_text_free_key(value: &str) -> bool {
    let key = value.trim().to_uppercase();
    if let Some(rest) = key.strip_prefix('F') {
        if let Ok(number) = rest.parse::<u8>() {
            return (1..=24).contains(&number);
        }
    }
    matches!(
        key.as_str(),
        "PRINTSCREEN" | "SCROLLLOCK" | "PAUSE" | "MEDIAPLAYPAUSE" | "MEDIASTOP" | "CAPSLOCK"
    )
}

impl HotkeyConfig {
    /// v1 -> v2: builds that shipped bare-key defaults registered them as
    /// global shortcuts and stole those keystrokes from every text field.
    /// Promote any modifier-less, text-producing binding to `Ctrl+Alt+<key>`
    /// once, gated on the stored schema version so a deliberate later choice
    /// is never rewritten.
    pub(crate) fn migrate_typing_safe(mut self) -> Self {
        if self.schema_version >= 2 {
            return self;
        }
        let promote = |value: String| -> String {
            let trimmed = value.trim();
            if trimmed.is_empty() || has_modifier(trimmed) || is_text_free_key(trimmed) {
                return trimmed.to_string();
            }
            format!("Ctrl+Alt+{trimmed}")
        };
        self.toggle_play_pause = promote(self.toggle_play_pause);
        self.toggle_recording = promote(self.toggle_recording);
        self.toggle_show_hide = promote(self.toggle_show_hide);
        self.inside_mode = promote(self.inside_mode);
        self.video_backward = promote(self.video_backward);
        self.video_forward = promote(self.video_forward);
        self.decrease_opacity = promote(self.decrease_opacity);
        self.increase_opacity = promote(self.increase_opacity);
        self.request_full_screen = promote(self.request_full_screen);
        self.close_window = promote(self.close_window);
        self.immersive_mode = promote(self.immersive_mode);
        self.schema_version = 2;
        self
    }

    /// v2 -> v3: 1.1.21 bluntly forced every binding to `Ctrl+Alt+*`. Restore
    /// the scoped defaults (bare keys are in-app only from now on) but only for
    /// bindings that still equal a value no user could have typed on purpose —
    /// the v2 defaults, or the v1 defaults after their v1 -> v2 promotion.
    /// A deliberately customised binding keeps its value.
    pub(crate) fn migrate_scoped(mut self) -> Self {
        if self.schema_version >= PERSISTENCE_SCHEMA_VERSION {
            return self;
        }
        let old_v2 = v2_defaults();
        let old_v1 = v1_promoted_defaults();
        let new = Self::default();
        let restore = |current: &mut String, was: [&str; 2], now: &str| {
            let trimmed = current.trim();
            if was
                .iter()
                .any(|candidate| trimmed.eq_ignore_ascii_case(candidate))
            {
                *current = now.to_string();
            }
        };
        restore(
            &mut self.toggle_play_pause,
            [&old_v2.toggle_play_pause, &old_v1.toggle_play_pause],
            &new.toggle_play_pause,
        );
        restore(
            &mut self.toggle_recording,
            [&old_v2.toggle_recording, &old_v1.toggle_recording],
            &new.toggle_recording,
        );
        restore(
            &mut self.toggle_show_hide,
            [&old_v2.toggle_show_hide, &old_v1.toggle_show_hide],
            &new.toggle_show_hide,
        );
        restore(
            &mut self.inside_mode,
            [&old_v2.inside_mode, &old_v1.inside_mode],
            &new.inside_mode,
        );
        restore(
            &mut self.video_backward,
            [&old_v2.video_backward, &old_v1.video_backward],
            &new.video_backward,
        );
        restore(
            &mut self.video_forward,
            [&old_v2.video_forward, &old_v1.video_forward],
            &new.video_forward,
        );
        restore(
            &mut self.decrease_opacity,
            [&old_v2.decrease_opacity, &old_v1.decrease_opacity],
            &new.decrease_opacity,
        );
        restore(
            &mut self.increase_opacity,
            [&old_v2.increase_opacity, &old_v1.increase_opacity],
            &new.increase_opacity,
        );
        restore(
            &mut self.request_full_screen,
            [&old_v2.request_full_screen, &old_v1.request_full_screen],
            &new.request_full_screen,
        );
        restore(
            &mut self.close_window,
            [&old_v2.close_window, &old_v1.close_window],
            &new.close_window,
        );
        restore(
            &mut self.immersive_mode,
            [&old_v2.immersive_mode, &old_v1.immersive_mode],
            &new.immersive_mode,
        );
        self.schema_version = PERSISTENCE_SCHEMA_VERSION;
        self
    }
}

/// The v1 defaults (bare keys) after their v1 -> v2 promotion, so the v2 -> v3
/// migration can recognise a config that was itself auto-generated by v1.
fn v1_promoted_defaults() -> HotkeyConfig {
    HotkeyConfig {
        schema_version: 2,
        toggle_play_pause: "Ctrl+Alt+Backquote".to_string(),
        toggle_recording: "Ctrl+Alt+R".to_string(),
        toggle_show_hide: "Ctrl+Alt+0".to_string(),
        inside_mode: "Ctrl+Alt+P".to_string(),
        video_backward: "Ctrl+Alt+5".to_string(),
        video_forward: "Ctrl+Alt+6".to_string(),
        decrease_opacity: "Ctrl+Alt+7".to_string(),
        increase_opacity: "Ctrl+Alt+8".to_string(),
        request_full_screen: "Ctrl+Alt+O".to_string(),
        close_window: "Ctrl+Q".to_string(),
        immersive_mode: default_immersive_binding(),
    }
}

impl HotkeyConfig {
    pub(crate) fn sanitize(self) -> Self {
        let default = Self::default();
        Self {
            schema_version: PERSISTENCE_SCHEMA_VERSION,
            toggle_play_pause: normalize_hotkey(self.toggle_play_pause, &default.toggle_play_pause),
            toggle_recording: normalize_hotkey(self.toggle_recording, &default.toggle_recording),
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
            immersive_mode: normalize_hotkey(self.immersive_mode, &default.immersive_mode),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BookmarkItem {
    pub(crate) title: String,
    pub(crate) url: String,
}

/// The five states "immersive mode" overrides, captured on the way in so that
/// leaving it puts the window back exactly as it was rather than at some
/// guessed default.
///
/// Persisted, not just held in memory: the mode writes its own values into the
/// same persisted fields any other switch writes (`inside`, `on_top`, locked,
/// sidebar, borderless). If the app were killed while immersive, the next
/// launch would come up borderless, click-through and position-locked — an
/// unreachable window with no grip to grab. `immersive_restore` being `Some` at
/// startup is the signal to unwind it before the window is ever shown.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImmersiveSnapshot {
    pub(crate) borderless: bool,
    pub(crate) sidebar_visible: bool,
    pub(crate) inside: bool,
    pub(crate) on_top: bool,
    pub(crate) position_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PersistedState {
    #[serde(default = "default_schema_version")]
    pub(crate) schema_version: u32,
    pub(crate) last_url: String,
    pub(crate) window_start_x: f64,
    pub(crate) window_start_y: f64,
    pub(crate) window_width: f64,
    pub(crate) window_height: f64,
    pub(crate) window_opacity: f64,
    pub(crate) window_on_top: bool,
    pub(crate) window_inside: bool,
    pub(crate) window_visible: bool,
    pub(crate) window_maximized: bool,
    #[serde(default)]
    pub(crate) window_position_locked: bool,
    /// Sticking a released window to the nearest work-area edge. Defaults to
    /// on: that is what every build before this field did unconditionally, so
    /// an existing history file keeps its behaviour.
    #[serde(default = "default_true")]
    pub(crate) window_snap_enabled: bool,
    /// Frameless window: no system title bar, no resize border. Off by
    /// default, because a frameless window also has no title bar to drag by —
    /// the shell has to provide one, and that is a deliberate choice rather
    /// than a surprise on first launch.
    #[serde(default)]
    pub(crate) window_borderless: bool,
    /// `Some` while immersive mode is on. See `ImmersiveSnapshot`.
    #[serde(default)]
    pub(crate) immersive_restore: Option<ImmersiveSnapshot>,
    /// Master switch for the user-configurable global shortcuts. The fixed
    /// rescue shortcut stays registered either way.
    #[serde(default = "default_true")]
    pub(crate) hotkeys_enabled: bool,
    #[serde(default)]
    pub(crate) bookmarks: Vec<BookmarkItem>,
    #[serde(default)]
    pub(crate) tab_urls: Vec<String>,
    #[serde(default)]
    pub(crate) active_tab_index: usize,
    #[serde(default)]
    pub(crate) ui_language: String,
    #[serde(default = "default_dock_color")]
    pub(crate) dock_color: String,
    /// Address a new tab (and `go_home`) opens on. Empty means the built-in
    /// start page served from the app bundle; anything else is used verbatim.
    ///
    /// Stored rather than derived from `last_url` because those are two
    /// different things: `last_url` is wherever the user last was, and setting a
    /// custom home (say limestart.cn) must not be undone by the next navigation.
    #[serde(default)]
    pub(crate) start_page_url: String,
    /// `light` | `dark` | `system`. Missing in files written before the theme
    /// existed, which is exactly the `system` case: those users never chose.
    ///
    /// The shell used to *infer* its theme from the open page's `.dark` class,
    /// so every new tab started light and a dark start page leaked its theme
    /// into the chrome. The choice belongs to the app, not to whatever page
    /// happens to be in front.
    #[serde(default = "default_theme_mode")]
    pub(crate) theme_mode: String,
}

impl Default for PersistedState {
    fn default() -> Self {
        Self {
            schema_version: PERSISTENCE_SCHEMA_VERSION,
            last_url: LEGACY_HOME_URL.to_string(),
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
            window_snap_enabled: true,
            window_borderless: false,
            immersive_restore: None,
            hotkeys_enabled: true,
            bookmarks: Vec::new(),
            tab_urls: vec![LEGACY_HOME_URL.to_string()],
            active_tab_index: 0,
            ui_language: String::new(),
            dock_color: default_dock_color(),
            start_page_url: String::new(),
            theme_mode: default_theme_mode(),
        }
    }
}

pub(crate) fn default_theme_mode() -> String {
    "system".to_string()
}

pub(crate) fn default_dock_color() -> String {
    "white".to_string()
}

fn normalize_hotkey(value: String, fallback: &str) -> String {
    fn normalize_token(token: &str) -> String {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        let lower = trimmed.to_lowercase();
        match lower.as_str() {
            "ctrl" | "control" => "Ctrl".to_string(),
            "alt" => "Alt".to_string(),
            "shift" => "Shift".to_string(),
            "cmd" | "command" | "meta" | "super" => "Meta".to_string(),
            "cmdorctrl" | "commandorcontrol" | "controlorcommand" => "CmdOrControl".to_string(),
            "`" | "backquote" | "grave" | "graveaccent" => "Backquote".to_string(),
            "esc" => "Escape".to_string(),
            "spacebar" => "Space".to_string(),
            "return" => "Enter".to_string(),
            "left" => "ArrowLeft".to_string(),
            "right" => "ArrowRight".to_string(),
            "up" => "ArrowUp".to_string(),
            "down" => "ArrowDown".to_string(),
            _ => {
                if trimmed.len() == 1 {
                    let ch = trimmed.chars().next().unwrap_or_default();
                    if ch.is_ascii_alphabetic() {
                        return ch.to_ascii_uppercase().to_string();
                    }
                }
                trimmed.to_string()
            }
        }
    }

    fn normalize_shortcut(value: &str) -> Option<String> {
        let mut modifiers = Vec::<String>::new();
        let mut key = String::new();
        for raw in value.split('+') {
            let token = normalize_token(raw);
            if token.is_empty() {
                continue;
            }
            match token.as_str() {
                "Ctrl" | "Alt" | "Shift" | "Meta" | "CmdOrControl" => {
                    if !modifiers.contains(&token) {
                        modifiers.push(token);
                    }
                }
                _ => key = token,
            }
        }
        if key.is_empty() {
            return None;
        }
        modifiers.push(key);
        Some(modifiers.join("+"))
    }

    normalize_shortcut(&value)
        .or_else(|| normalize_shortcut(fallback))
        .unwrap_or_else(|| fallback.to_string())
}

pub(crate) fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed creating {}: {err}", parent.display()))?;
    }

    let tmp_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("json")
    ));
    {
        let mut file = fs::File::create(&tmp_path)
            .map_err(|err| format!("Failed creating {}: {err}", tmp_path.display()))?;
        file.write_all(text.as_bytes())
            .map_err(|err| format!("Failed writing {}: {err}", tmp_path.display()))?;
        file.sync_all()
            .map_err(|err| format!("Failed syncing {}: {err}", tmp_path.display()))?;
    }
    fs::rename(&tmp_path, path).map_err(|err| {
        let _ = fs::remove_file(&tmp_path);
        format!(
            "Failed replacing {} with {}: {err}",
            path.display(),
            tmp_path.display()
        )
    })
}

fn backup_corrupt_file(path: &Path) -> AppResult<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let timestamp = current_timestamp_ms();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    let backup_path = path.with_file_name(format!("{file_name}.corrupt-{timestamp}"));
    fs::rename(path, &backup_path).map_err(|err| {
        format!(
            "Failed backing up corrupt {} to {}: {err}",
            path.display(),
            backup_path.display()
        )
    })?;
    Ok(Some(backup_path))
}

pub(crate) fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> AppResult<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|err| format!("Failed reading {}: {err}", path.display()))?;
    match serde_json::from_str::<T>(&text) {
        Ok(value) => Ok(Some(value)),
        Err(err) => {
            let backup = backup_corrupt_file(path)?;
            Err(match backup {
                Some(backup_path) => format!(
                    "Invalid JSON in {}; backed up to {}: {err}",
                    path.display(),
                    backup_path.display()
                ),
                None => format!("Invalid JSON in {}: {err}", path.display()),
            })
        }
    }
}

pub(crate) fn read_json_or_default<T>(
    path: &Path,
    runtime_log_path: &Path,
    label: &str,
    mut record_error: impl FnMut(&Path, &str, &str, String),
) -> T
where
    T: for<'de> Deserialize<'de> + Default,
{
    match read_json::<T>(path) {
        Ok(Some(value)) => value,
        Ok(None) => T::default(),
        Err(err) => {
            record_error(runtime_log_path, "storage", label, err);
            T::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_hotkeys_preserves_schema_and_normalizes_aliases() {
        let config = HotkeyConfig {
            schema_version: 0,
            toggle_play_pause: "`".to_string(),
            toggle_recording: "r".to_string(),
            toggle_show_hide: "ctrl + 0".to_string(),
            inside_mode: " ".to_string(),
            video_backward: "left".to_string(),
            video_forward: "right".to_string(),
            decrease_opacity: "7".to_string(),
            increase_opacity: "8".to_string(),
            request_full_screen: "o".to_string(),
            close_window: "ctrl+q".to_string(),
            immersive_mode: "i".to_string(),
        }
        .sanitize();

        assert_eq!(config.schema_version, PERSISTENCE_SCHEMA_VERSION);
        assert_eq!(config.toggle_play_pause, "Backquote");
        assert_eq!(config.immersive_mode, "I");
        assert_eq!(config.toggle_recording, "R");
        assert_eq!(config.toggle_show_hide, "Ctrl+0");
        assert_eq!(config.inside_mode, HotkeyConfig::default().inside_mode);
        assert_eq!(config.video_backward, "ArrowLeft");
        assert_eq!(config.video_forward, "ArrowRight");
        assert_eq!(config.close_window, "Ctrl+Q");
    }

    #[test]
    fn hotkey_file_without_immersive_mode_keeps_other_bindings() {
        // A hotkeys.json written by 1.1.22 has no `immersiveMode` key. The new
        // field must fill itself in rather than fail deserialisation: a failure
        // takes the `read_json_or_default` path, which silently discards every
        // binding the user had customised.
        let legacy = r#"{
            "schemaVersion": 3,
            "togglePlayPause": "F8",
            "toggleRecording": "Ctrl+Shift+M",
            "toggleShowHide": "Ctrl+Alt+H",
            "insideMode": "Ctrl+Alt+P",
            "videoBackward": "5",
            "videoForward": "6",
            "decreaseOpacity": "7",
            "increaseOpacity": "8",
            "requestFullScreen": "O",
            "closeWindow": "Ctrl+Q"
        }"#;
        let config: HotkeyConfig =
            serde_json::from_str(legacy).expect("a file without immersiveMode must still load");

        assert_eq!(config.toggle_play_pause, "F8");
        assert_eq!(config.toggle_recording, "Ctrl+Shift+M");
        assert_eq!(config.immersive_mode, default_immersive_binding());
        assert!(binding_is_global(&config.immersive_mode));
    }

    #[test]
    fn legacy_bare_keys_are_promoted_to_ctrl_alt_once() {
        // v1 config as shipped by 1.1.20: bare letters/digits registered as
        // global shortcuts, which stole ordinary typing system-wide.
        let legacy = HotkeyConfig {
            schema_version: 1,
            toggle_play_pause: "Backquote".to_string(),
            toggle_recording: "R".to_string(),
            toggle_show_hide: "0".to_string(),
            inside_mode: "P".to_string(),
            video_backward: "5".to_string(),
            video_forward: "6".to_string(),
            decrease_opacity: "7".to_string(),
            increase_opacity: "8".to_string(),
            request_full_screen: "O".to_string(),
            close_window: "Ctrl+Q".to_string(),
            immersive_mode: "I".to_string(),
        }
        .migrate_typing_safe()
        .sanitize();

        assert_eq!(legacy.toggle_recording, "Ctrl+Alt+R");
        assert_eq!(legacy.toggle_show_hide, "Ctrl+Alt+0");
        assert_eq!(legacy.toggle_play_pause, "Ctrl+Alt+Backquote");
        // Modifier-carrying bindings and function keys are left alone.
        assert_eq!(legacy.close_window, "Ctrl+Q");
        // `sanitize` stamps the current schema version on whatever it returns.
        assert_eq!(legacy.schema_version, PERSISTENCE_SCHEMA_VERSION);

        // Already-migrated configs must not be rewritten again.
        let again = legacy.clone().migrate_typing_safe();
        assert_eq!(again.toggle_recording, "Ctrl+Alt+R");
    }

    #[test]
    fn v1_config_ends_up_scoped_after_full_migration() {
        // Same v1 file as shipped by 1.1.20, migrated all the way to v3.
        let scoped = HotkeyConfig {
            schema_version: 1,
            toggle_play_pause: "Backquote".to_string(),
            toggle_recording: "R".to_string(),
            toggle_show_hide: "0".to_string(),
            inside_mode: "P".to_string(),
            video_backward: "5".to_string(),
            video_forward: "6".to_string(),
            decrease_opacity: "7".to_string(),
            increase_opacity: "8".to_string(),
            request_full_screen: "O".to_string(),
            close_window: "Ctrl+Q".to_string(),
            immersive_mode: "I".to_string(),
        }
        .migrate_typing_safe()
        .migrate_scoped()
        .sanitize();

        assert_eq!(scoped.schema_version, PERSISTENCE_SCHEMA_VERSION);
        // Bare media/navigation keys are back, but they are in-app only now.
        assert_eq!(scoped.toggle_recording, "R");
        assert_eq!(scoped.video_backward, "5");
        assert_eq!(scoped.request_full_screen, "O");
        assert!(!binding_is_global(&scoped.toggle_recording));
        // The actions you must reach while the window is hidden stay global.
        assert_eq!(scoped.toggle_show_hide, "Ctrl+Alt+H");
        assert!(binding_is_global(&scoped.toggle_show_hide));
        assert_eq!(scoped.inside_mode, "Ctrl+Alt+P");
        assert!(binding_is_global(&scoped.inside_mode));
        assert_eq!(scoped.close_window, "Ctrl+Q");
        assert!(binding_is_global(&scoped.close_window));
    }

    #[test]
    fn v2_defaults_are_restored_but_custom_bindings_survive() {
        let config = HotkeyConfig {
            schema_version: 2,
            // Untouched 1.1.21 default -> restored to the scoped default.
            toggle_play_pause: "Ctrl+Alt+Space".to_string(),
            // Deliberate custom binding -> preserved verbatim.
            toggle_recording: "Ctrl+Shift+M".to_string(),
            ..v2_defaults()
        }
        .migrate_scoped();

        assert_eq!(config.toggle_play_pause, "Backquote");
        assert_eq!(config.toggle_recording, "Ctrl+Shift+M");
        assert_eq!(config.video_forward, "6");
    }

    #[test]
    fn function_keys_survive_migration_without_modifiers() {
        let config = HotkeyConfig {
            schema_version: 0,
            toggle_play_pause: "F8".to_string(),
            ..HotkeyConfig::default()
        }
        .migrate_typing_safe();
        assert_eq!(config.toggle_play_pause, "F8");
    }

    #[test]
    fn json_roundtrip_uses_atomic_writer() {
        let dir = std::env::temp_dir().join(format!("di-viewer-test-{}", current_timestamp_ms()));
        fs::create_dir_all(&dir).expect("create temp test dir");
        let path = dir.join("history.json");

        let state = PersistedState::default();
        write_json(&path, &state).expect("write state");
        let loaded = read_json::<PersistedState>(&path)
            .expect("read state")
            .expect("state exists");

        assert_eq!(loaded.schema_version, PERSISTENCE_SCHEMA_VERSION);
        assert_eq!(loaded.last_url, state.last_url);
        assert!(!path.with_extension("json.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_json_is_backed_up_and_reported() {
        let dir =
            std::env::temp_dir().join(format!("di-viewer-corrupt-test-{}", current_timestamp_ms()));
        fs::create_dir_all(&dir).expect("create temp test dir");
        let path = dir.join("history.json");
        fs::write(&path, "{not valid json").expect("write corrupt state");

        let err = read_json::<PersistedState>(&path).expect_err("corrupt json should fail");

        assert!(err.contains("Invalid JSON"));
        assert!(!path.exists());
        let backups = fs::read_dir(&dir)
            .expect("read temp dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
            .count();
        assert_eq!(backups, 1);

        let _ = fs::remove_dir_all(&dir);
    }
}
