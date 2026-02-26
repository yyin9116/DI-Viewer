import { invoke } from "@tauri-apps/api/core";
import "./style.css";

const HOME_URL = "https://limestart.cn/";

const hotkeyDefs = [
  { key: "togglePlayPause", label: "Play/Pause", placeholder: "Backquote" },
  { key: "toggleShowHide", label: "Show/Hide", placeholder: "0" },
  { key: "insideMode", label: "Inside Mode", placeholder: "P" },
  { key: "videoBackward", label: "Backward 5s", placeholder: "5" },
  { key: "videoForward", label: "Forward 5s", placeholder: "6" },
  { key: "decreaseOpacity", label: "Opacity -", placeholder: "7" },
  { key: "increaseOpacity", label: "Opacity +", placeholder: "8" },
  { key: "requestFullScreen", label: "Fullscreen", placeholder: "O" },
  { key: "closeWindow", label: "Close App", placeholder: "Ctrl+Q" }
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

let currentState = null;

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
    label.textContent = item.label;

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

function applyState(state) {
  currentState = state;
  urlInput.value = state.lastUrl || HOME_URL;
  opacityRange.value = Number(state.opacity ?? 1).toFixed(2);
  opacityLabel.textContent = Number(state.opacity ?? 1).toFixed(2);
  renderHotkeyForm(state.hotkeys);

  showHideBtn.textContent = state.visible ? "Hide Browser" : "Show Browser";
  insideBtn.textContent = state.inside ? "Inside: On" : "Inside: Off";
  onTopBtn.textContent = state.onTop ? "OnTop: On" : "OnTop: Off";
  sidebarBtn.textContent = state.sidebarVisible ? "Sidebar: On" : "Sidebar: Off";

  setButtonState(showHideBtn, state.visible);
  setButtonState(insideBtn, state.inside);
  setButtonState(onTopBtn, state.onTop);
  setButtonState(sidebarBtn, state.sidebarVisible);
}

async function refreshState() {
  const state = await invoke("get_state");
  applyState(state);
}

async function withBusyStatus(message, task) {
  try {
    setStatus(message, false);
    await task();
    setStatus("Ready", false);
  } catch (error) {
    const msg = String(error);
    setStatus(msg, true);
    throw error;
  }
}

goBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  await withBusyStatus("Navigating...", async () => {
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
  await withBusyStatus("Opening home...", async () => {
    await invoke("go_home");
    await refreshState();
  });
});

showHideBtn.addEventListener("click", async () => {
  await withBusyStatus("Toggling browser...", async () => {
    const visible = await invoke("toggle_show_hide");
    if (currentState) {
      currentState.visible = visible;
      applyState(currentState);
    }
  });
});

insideBtn.addEventListener("click", async () => {
  await withBusyStatus("Switching inside mode...", async () => {
    const inside = await invoke("toggle_inside_mode");
    if (currentState) {
      currentState.inside = inside;
      applyState(currentState);
    }
  });
});

onTopBtn.addEventListener("click", async () => {
  await withBusyStatus("Switching top mode...", async () => {
    const onTop = await invoke("toggle_on_top");
    if (currentState) {
      currentState.onTop = onTop;
      applyState(currentState);
    }
  });
});

sidebarBtn.addEventListener("click", async () => {
  await withBusyStatus("Toggling sidebar...", async () => {
    const sidebarVisible = await invoke("toggle_sidebar");
    if (currentState) {
      currentState.sidebarVisible = sidebarVisible;
      applyState(currentState);
    }
  });
});

minBtn.addEventListener("click", async () => {
  await withBusyStatus("Minimizing browser...", async () => {
    await invoke("minimize_browser");
  });
});

maxBtn.addEventListener("click", async () => {
  await withBusyStatus("Maximize/Restore...", async () => {
    await invoke("maximize_restore_browser");
    await refreshState();
  });
});

closeBtn.addEventListener("click", async () => {
  await withBusyStatus("Exiting...", async () => {
    await invoke("close_app");
  });
});

opacityRange.addEventListener("input", () => {
  opacityLabel.textContent = Number(opacityRange.value).toFixed(2);
});

opacityRange.addEventListener("change", async () => {
  const opacity = Number(opacityRange.value);
  await withBusyStatus("Applying opacity...", async () => {
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
    await withBusyStatus("Sending video command...", async () => {
      await invoke("video_action", { action });
    });
  });
});

saveHotkeysBtn.addEventListener("click", async () => {
  const config = collectHotkeys();
  await withBusyStatus("Saving hotkeys...", async () => {
    await invoke("save_hotkeys", { config });
    await refreshState();
  });
});

resetHotkeysBtn.addEventListener("click", async () => {
  await withBusyStatus("Reset hotkeys...", async () => {
    await invoke("reset_hotkeys");
    await refreshState();
  });
});

refreshState()
  .then(() => setStatus("Ready"))
  .catch((error) => setStatus(String(error), true));
