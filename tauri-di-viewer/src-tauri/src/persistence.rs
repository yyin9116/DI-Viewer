use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{AppResult, LEGACY_HOME_URL};

pub(crate) const PERSISTENCE_SCHEMA_VERSION: u32 = 1;

pub(crate) fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn default_schema_version() -> u32 {
    PERSISTENCE_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HotkeyConfig {
    #[serde(default = "default_schema_version")]
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
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            schema_version: PERSISTENCE_SCHEMA_VERSION,
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
        }
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
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BookmarkItem {
    pub(crate) title: String,
    pub(crate) url: String,
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
            bookmarks: Vec::new(),
            tab_urls: vec![LEGACY_HOME_URL.to_string()],
            active_tab_index: 0,
            ui_language: String::new(),
            dock_color: default_dock_color(),
        }
    }
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
        }
        .sanitize();

        assert_eq!(config.schema_version, PERSISTENCE_SCHEMA_VERSION);
        assert_eq!(config.toggle_play_pause, "Backquote");
        assert_eq!(config.toggle_recording, "R");
        assert_eq!(config.toggle_show_hide, "Ctrl+0");
        assert_eq!(config.inside_mode, HotkeyConfig::default().inside_mode);
        assert_eq!(config.video_backward, "ArrowLeft");
        assert_eq!(config.video_forward, "ArrowRight");
        assert_eq!(config.close_window, "Ctrl+Q");
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
