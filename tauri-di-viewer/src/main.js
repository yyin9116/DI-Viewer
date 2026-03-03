import { invoke } from "@tauri-apps/api/core";
import "./style.css";

const HOME_URL = "https://limestart.cn/";

const i18n = {
  zh: {
    "app.title": "DI-Viewer",
    "app.language": "语言",
    "app.diagnostics": "运行诊断",
    "panel.window": "窗口",
    "panel.media": "媒体",
    "panel.shortcuts": "快捷键",
    "panel.diagnostics": "诊断",
    "window.address": "地址",
    "window.go": "前往",
    "window.home": "主页",
    "window.minimize": "最小化",
    "window.maxRestore": "最大化/还原",
    "window.exit": "退出",
    "window.opacity": "透明度",
    "media.playPause": "播放/暂停",
    "media.backward": "后退 5 秒",
    "media.forward": "前进 5 秒",
    "media.fullscreen": "全屏",
    "shortcuts.hint": "格式示例：Alt+Space、Ctrl+Q、Backquote。",
    "shortcuts.save": "保存快捷键",
    "shortcuts.reset": "重置",
    "diagnostics.hint": "检查按钮调用、透明度变化和热键注册状态。",
    "hotkey.playPause": "播放/暂停",
    "hotkey.showHide": "显示/隐藏",
    "hotkey.insideMode": "穿透模式",
    "hotkey.backward": "后退 5 秒",
    "hotkey.forward": "前进 5 秒",
    "hotkey.opacityDown": "透明度 -",
    "hotkey.opacityUp": "透明度 +",
    "hotkey.fullscreen": "全屏",
    "hotkey.close": "关闭应用",
    "button.show": "显示浏览器",
    "button.hide": "隐藏浏览器",
    "button.insideOn": "穿透：开",
    "button.insideOff": "穿透：关",
    "button.onTopOn": "置顶：开",
    "button.onTopOff": "置顶：关",
    "button.sidebarOn": "侧边栏：开",
    "button.sidebarOff": "侧边栏：关",
    "status.ready": "就绪",
    "status.navigating": "正在导航...",
    "status.home": "正在打开主页...",
    "status.toggleBrowser": "正在切换浏览器显示...",
    "status.toggleInside": "正在切换穿透模式...",
    "status.toggleTop": "正在切换置顶...",
    "status.toggleSidebar": "正在切换侧边栏...",
    "status.minimize": "正在最小化...",
    "status.maximize": "正在最大化/还原...",
    "status.exit": "正在退出...",
    "status.opacity": "正在设置透明度...",
    "status.video": "正在发送媒体指令...",
    "status.saveHotkeys": "正在保存快捷键...",
    "status.resetHotkeys": "正在重置快捷键...",
    "status.diagnostics": "正在执行诊断...",
    "diag.ok": "通过",
    "diag.fail": "失败",
    "diag.summaryPass": "诊断完成：全部通过",
    "diag.summaryFail": "诊断完成：存在失败项",
    "diag.getState": "读取状态",
    "diag.getHotkeys": "读取热键配置",
    "diag.listTabs": "读取标签会话",
    "diag.getBookmarks": "读取书签",
    "diag.opacity": "透明度设置与恢复",
    "diag.sidebar": "侧边栏切换与恢复",
    "diag.hotkeys": "热键注册（保存当前配置）"
  },
  en: {
    "app.title": "DI-Viewer",
    "app.language": "Language",
    "app.diagnostics": "Run Diagnostics",
    "panel.window": "Window",
    "panel.media": "Media",
    "panel.shortcuts": "Shortcuts",
    "panel.diagnostics": "Diagnostics",
    "window.address": "Address",
    "window.go": "Go",
    "window.home": "Home",
    "window.minimize": "Minimize",
    "window.maxRestore": "Max/Restore",
    "window.exit": "Exit",
    "window.opacity": "Opacity",
    "media.playPause": "Play/Pause",
    "media.backward": "Backward 5s",
    "media.forward": "Forward 5s",
    "media.fullscreen": "Fullscreen",
    "shortcuts.hint": "Format examples: Alt+Space, Ctrl+Q, Backquote.",
    "shortcuts.save": "Save Hotkeys",
    "shortcuts.reset": "Reset",
    "diagnostics.hint": "Checks button actions, opacity, and hotkey registration.",
    "hotkey.playPause": "Play/Pause",
    "hotkey.showHide": "Show/Hide",
    "hotkey.insideMode": "Inside Mode",
    "hotkey.backward": "Backward 5s",
    "hotkey.forward": "Forward 5s",
    "hotkey.opacityDown": "Opacity -",
    "hotkey.opacityUp": "Opacity +",
    "hotkey.fullscreen": "Fullscreen",
    "hotkey.close": "Close App",
    "button.show": "Show Browser",
    "button.hide": "Hide Browser",
    "button.insideOn": "Inside: On",
    "button.insideOff": "Inside: Off",
    "button.onTopOn": "OnTop: On",
    "button.onTopOff": "OnTop: Off",
    "button.sidebarOn": "Sidebar: On",
    "button.sidebarOff": "Sidebar: Off",
    "status.ready": "Ready",
    "status.navigating": "Navigating...",
    "status.home": "Opening home...",
    "status.toggleBrowser": "Toggling browser...",
    "status.toggleInside": "Switching inside mode...",
    "status.toggleTop": "Switching top mode...",
    "status.toggleSidebar": "Toggling sidebar...",
    "status.minimize": "Minimizing browser...",
    "status.maximize": "Maximize/Restore...",
    "status.exit": "Exiting...",
    "status.opacity": "Applying opacity...",
    "status.video": "Sending video command...",
    "status.saveHotkeys": "Saving hotkeys...",
    "status.resetHotkeys": "Reset hotkeys...",
    "status.diagnostics": "Running diagnostics...",
    "diag.ok": "Pass",
    "diag.fail": "Fail",
    "diag.summaryPass": "Diagnostics completed: all passed",
    "diag.summaryFail": "Diagnostics completed: failures found",
    "diag.getState": "Read state",
    "diag.getHotkeys": "Read hotkey config",
    "diag.listTabs": "Read tab session",
    "diag.getBookmarks": "Read bookmarks",
    "diag.opacity": "Opacity set and restore",
    "diag.sidebar": "Sidebar toggle and restore",
    "diag.hotkeys": "Hotkey registration (save current config)"
  }
};

const hotkeyDefs = [
  { key: "togglePlayPause", labelKey: "hotkey.playPause", placeholder: "Backquote" },
  { key: "toggleShowHide", labelKey: "hotkey.showHide", placeholder: "0" },
  { key: "insideMode", labelKey: "hotkey.insideMode", placeholder: "P" },
  { key: "videoBackward", labelKey: "hotkey.backward", placeholder: "5" },
  { key: "videoForward", labelKey: "hotkey.forward", placeholder: "6" },
  { key: "decreaseOpacity", labelKey: "hotkey.opacityDown", placeholder: "7" },
  { key: "increaseOpacity", labelKey: "hotkey.opacityUp", placeholder: "8" },
  { key: "requestFullScreen", labelKey: "hotkey.fullscreen", placeholder: "O" },
  { key: "closeWindow", labelKey: "hotkey.close", placeholder: "Ctrl+Q" }
];

const statusEl = document.getElementById("status");
const urlInput = document.getElementById("urlInput");
const goBtn = document.getElementById("goBtn");
const homeBtn = document.getElementById("homeBtn");
const showHideBtn = document.getElementById("showHideBtn");
const insideBtn = document.getElementById("insideBtn");
const onTopBtn = document.getElementById("onTopBtn");
const sidebarBtn = document.getElementById("sidebarBtn");
const minBtn = document.getElementById("minBtn");
const maxBtn = document.getElementById("maxBtn");
const closeBtn = document.getElementById("closeBtn");
const opacityRange = document.getElementById("opacityRange");
const opacityLabel = document.getElementById("opacityLabel");
const hotkeyForm = document.getElementById("hotkeyForm");
const saveHotkeysBtn = document.getElementById("saveHotkeysBtn");
const resetHotkeysBtn = document.getElementById("resetHotkeysBtn");
const videoButtons = Array.from(document.querySelectorAll("[data-action]"));
const langSelect = document.getElementById("langSelect");
const runDiagnosticsBtn = document.getElementById("runDiagnosticsBtn");
const diagnosticsList = document.getElementById("diagnosticsList");

let currentState = null;
let currentLang = "en";

function t(key) {
  const table = i18n[currentLang] || i18n.en;
  return table[key] ?? i18n.en[key] ?? key;
}

function applyLanguage(lang) {
  currentLang = lang === "zh" ? "zh" : "en";
  document.documentElement.setAttribute("lang", currentLang);
  if (langSelect) langSelect.value = currentLang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });

  if (currentState) {
    updateStateButtons(currentState);
    renderHotkeyForm(currentState.hotkeys);
  }
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function hotkeyInputId(key) {
  return `hotkey-${key}`;
}

function renderHotkeyForm(config) {
  hotkeyForm.innerHTML = "";
  hotkeyDefs.forEach((item) => {
    const label = document.createElement("label");
    label.setAttribute("for", hotkeyInputId(item.key));
    label.textContent = t(item.labelKey);

    const input = document.createElement("input");
    input.type = "text";
    input.id = hotkeyInputId(item.key);
    input.placeholder = item.placeholder;
    input.value = config?.[item.key] ?? "";
    input.autocomplete = "off";
    label.appendChild(input);
    hotkeyForm.appendChild(label);
  });
}

function collectHotkeys() {
  const config = {};
  hotkeyDefs.forEach((item) => {
    const value = document.getElementById(hotkeyInputId(item.key))?.value?.trim() ?? "";
    config[item.key] = value;
  });
  return config;
}

function setButtonState(btn, active) {
  btn.classList.toggle("active", Boolean(active));
}

function updateStateButtons(state) {
  showHideBtn.textContent = state.visible ? t("button.hide") : t("button.show");
  insideBtn.textContent = state.inside ? t("button.insideOn") : t("button.insideOff");
  onTopBtn.textContent = state.onTop ? t("button.onTopOn") : t("button.onTopOff");
  sidebarBtn.textContent = state.sidebarVisible ? t("button.sidebarOn") : t("button.sidebarOff");

  setButtonState(showHideBtn, state.visible);
  setButtonState(insideBtn, state.inside);
  setButtonState(onTopBtn, state.onTop);
  setButtonState(sidebarBtn, state.sidebarVisible);
}

function applyState(state) {
  currentState = state;
  urlInput.value = state.lastUrl || HOME_URL;
  opacityRange.value = Number(state.opacity ?? 1).toFixed(2);
  opacityLabel.textContent = Number(state.opacity ?? 1).toFixed(2);

  if (state.uiLang) {
    applyLanguage(state.uiLang);
  }

  renderHotkeyForm(state.hotkeys);
  updateStateButtons(state);
}

async function refreshState() {
  const state = await invoke("get_state");
  applyState(state);
}

async function withBusyStatus(statusKey, task) {
  try {
    setStatus(t(statusKey), false);
    await task();
    setStatus(t("status.ready"), false);
  } catch (error) {
    const msg = String(error);
    setStatus(msg, true);
    throw error;
  }
}

function renderDiagnostics(items) {
  diagnosticsList.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = item.ok ? "pass" : "fail";
    li.textContent = `${item.ok ? t("diag.ok") : t("diag.fail")} - ${item.name}${item.detail ? `: ${item.detail}` : ""}`;
    diagnosticsList.appendChild(li);
  });
}

async function runDiagnostics() {
  const checks = [];
  const check = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, ok: true, detail: "" });
    } catch (error) {
      checks.push({ name, ok: false, detail: String(error) });
    }
  };

  await withBusyStatus("status.diagnostics", async () => {
    const state = await invoke("get_state");

    await check(t("diag.getState"), async () => {
      await invoke("get_state");
    });

    await check(t("diag.getHotkeys"), async () => {
      await invoke("get_hotkeys");
    });

    await check(t("diag.listTabs"), async () => {
      await invoke("list_tabs");
    });

    await check(t("diag.getBookmarks"), async () => {
      await invoke("get_bookmarks");
    });

    await check(t("diag.opacity"), async () => {
      const origin = Number(state.opacity ?? 1);
      const probe = Math.max(0.2, Math.min(1, origin - 0.1));
      await invoke("set_opacity", { opacity: probe });
      await invoke("set_opacity", { opacity: origin });
    });

    await check(t("diag.sidebar"), async () => {
      const initial = Boolean(state.sidebarVisible);
      await invoke("toggle_sidebar");
      await invoke("toggle_sidebar");
      const after = await invoke("get_state");
      if (Boolean(after.sidebarVisible) !== initial) {
        throw new Error("sidebar state not restored");
      }
    });

    await check(t("diag.hotkeys"), async () => {
      await invoke("save_hotkeys", { config: state.hotkeys });
    });

    renderDiagnostics(checks);

    const hasFail = checks.some((item) => !item.ok);
    setStatus(t(hasFail ? "diag.summaryFail" : "diag.summaryPass"), hasFail);
    await refreshState();
  });
}

goBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  await withBusyStatus("status.navigating", async () => {
    const current = await invoke("navigate", { url });
    if (currentState) {
      currentState.lastUrl = current;
      applyState(currentState);
    }
  });
});

urlInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    goBtn.click();
  }
});

homeBtn.addEventListener("click", async () => {
  await withBusyStatus("status.home", async () => {
    await invoke("go_home");
    await refreshState();
  });
});

showHideBtn.addEventListener("click", async () => {
  await withBusyStatus("status.toggleBrowser", async () => {
    const visible = await invoke("toggle_show_hide");
    if (currentState) {
      currentState.visible = visible;
      applyState(currentState);
    }
  });
});

insideBtn.addEventListener("click", async () => {
  await withBusyStatus("status.toggleInside", async () => {
    const inside = await invoke("toggle_inside_mode");
    if (currentState) {
      currentState.inside = inside;
      applyState(currentState);
    }
  });
});

onTopBtn.addEventListener("click", async () => {
  await withBusyStatus("status.toggleTop", async () => {
    const onTop = await invoke("toggle_on_top");
    if (currentState) {
      currentState.onTop = onTop;
      applyState(currentState);
    }
  });
});

sidebarBtn.addEventListener("click", async () => {
  await withBusyStatus("status.toggleSidebar", async () => {
    const sidebarVisible = await invoke("toggle_sidebar");
    if (currentState) {
      currentState.sidebarVisible = sidebarVisible;
      applyState(currentState);
    }
  });
});

minBtn.addEventListener("click", async () => {
  await withBusyStatus("status.minimize", async () => {
    await invoke("minimize_browser");
  });
});

maxBtn.addEventListener("click", async () => {
  await withBusyStatus("status.maximize", async () => {
    await invoke("maximize_restore_browser");
    await refreshState();
  });
});

closeBtn.addEventListener("click", async () => {
  await withBusyStatus("status.exit", async () => {
    await invoke("close_app");
  });
});

opacityRange.addEventListener("input", () => {
  opacityLabel.textContent = Number(opacityRange.value).toFixed(2);
});

opacityRange.addEventListener("change", async () => {
  const opacity = Number(opacityRange.value);
  await withBusyStatus("status.opacity", async () => {
    const next = await invoke("set_opacity", { opacity });
    if (currentState) {
      currentState.opacity = next;
      applyState(currentState);
    }
  });
});

videoButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const action = btn.getAttribute("data-action");
    await withBusyStatus("status.video", async () => {
      await invoke("video_action", { action });
    });
  });
});

saveHotkeysBtn.addEventListener("click", async () => {
  const config = collectHotkeys();
  await withBusyStatus("status.saveHotkeys", async () => {
    await invoke("save_hotkeys", { config });
    await refreshState();
  });
});

resetHotkeysBtn.addEventListener("click", async () => {
  await withBusyStatus("status.resetHotkeys", async () => {
    await invoke("reset_hotkeys");
    await refreshState();
  });
});

if (langSelect) {
  langSelect.addEventListener("change", async () => {
    const target = langSelect.value === "zh" ? "zh" : "en";
    try {
      const applied = await invoke("set_ui_language", { lang: target });
      applyLanguage(applied === "zh" ? "zh" : "en");
      await refreshState();
    } catch {
      applyLanguage(target);
    }
  });
}

if (runDiagnosticsBtn) {
  runDiagnosticsBtn.addEventListener("click", runDiagnostics);
}

refreshState()
  .then(() => setStatus(t("status.ready")))
  .catch((error) => setStatus(String(error), true));
