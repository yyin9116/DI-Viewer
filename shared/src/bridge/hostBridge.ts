import type { DockColor, FrontendState, HostSnapshot, HotkeyConfig, TabSessionSnapshot } from '../types';

type BridgeFn = (...args: any[]) => unknown;
type BridgeSource = 'tauri' | 'pywebview' | 'qwebchannel' | 'mock' | 'external';

declare global {
  interface Window {
    bridge?: Record<string, BridgeFn>;
    QWebChannel?: new (
      transport: unknown,
      callback: (channel: { objects?: { bridge?: Record<string, BridgeFn> } }) => void
    ) => unknown;
    qt?: { webChannelTransport?: unknown };
    pywebview?: { api?: { call?: (name: string, args?: unknown) => Promise<unknown> } };
    __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    __diviewer_bridge_ready__?: Promise<Record<string, BridgeFn>>;
    __diviewer_bridge?: Record<string, BridgeFn>;
    __DIVIEWER_ALLOW_MOCK_BRIDGE__?: boolean;
    __diviewer_bridge_source__?: BridgeSource;
  }
}

const defaultHotkeys: HotkeyConfig = {
  togglePlayPause: 'Backquote',
  toggleRecording: 'R',
  toggleShowHide: '0',
  insideMode: 'P',
  videoBackward: '5',
  videoForward: '6',
  decreaseOpacity: '7',
  increaseOpacity: '8',
  requestFullScreen: 'O',
  closeWindow: 'Ctrl+Q'
};

const defaultState: FrontendState = {
  lastUrl: '',
  opacity: 1,
  onTop: false,
  inside: false,
  visible: true,
  maximized: false,
  positionLocked: false,
  sidebarVisible: true,
  uiLang: 'zh',
  bookmarks: [],
  hotkeys: defaultHotkeys
};

const defaultTabs: TabSessionSnapshot = {
  tabs: [],
  activeIndex: 0
};

const defaultDockColor: DockColor = 'white';

function sanitizeDockColor(value: unknown): DockColor {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'ivory' || raw === 'amber' || raw === 'blue' || raw === 'green' || raw === 'rose' || raw === 'slate') {
    return raw;
  }
  return 'white';
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw) return value;
  try {
    return JSON.parse(raw);
  } catch {
    return value;
  }
}

function normalizeState(raw: unknown): FrontendState {
  const source = parseMaybeJson(raw);
  if (!source || typeof source !== 'object') return defaultState;
  const state = source as Record<string, unknown>;
  return {
    lastUrl: String(state.lastUrl ?? state.last_url ?? ''),
    opacity: Number(state.opacity ?? 1),
    onTop: Boolean(state.onTop ?? state.on_top ?? false),
    inside: Boolean(state.inside ?? false),
    visible: Boolean(state.visible ?? true),
    maximized: Boolean(state.maximized ?? false),
    positionLocked: Boolean(state.positionLocked ?? state.position_locked ?? false),
    sidebarVisible: Boolean(state.sidebarVisible ?? state.sidebar_visible ?? true),
    uiLang: String(state.uiLang ?? state.ui_lang ?? 'zh'),
    bookmarks: Array.isArray(state.bookmarks)
      ? state.bookmarks.map((item) => ({
          title: String((item as Record<string, unknown>).title ?? ''),
          url: String((item as Record<string, unknown>).url ?? '')
        }))
      : [],
    hotkeys: {
      ...defaultHotkeys,
      ...(typeof state.hotkeys === 'object' && state.hotkeys ? (state.hotkeys as Partial<HotkeyConfig>) : {})
    }
  };
}

function normalizeTabs(raw: unknown): TabSessionSnapshot {
  const source = parseMaybeJson(raw);
  if (!source || typeof source !== 'object') return defaultTabs;
  const snapshot = source as Record<string, unknown>;
  const tabs = Array.isArray(snapshot.tabs)
    ? snapshot.tabs.map((item, index) => {
        const tab = item as Record<string, unknown>;
        return {
          index: Number(tab.index ?? index),
          title: String(tab.title ?? ''),
          url: String(tab.url ?? ''),
          active: Boolean(tab.active ?? false)
        };
      })
    : [];
  const activeIndex = Number(snapshot.activeIndex ?? snapshot.active_index ?? 0);
  return { tabs, activeIndex };
}

function buildPyWebviewBridge(call: (name: string, args?: unknown) => Promise<unknown>) {
  return {
    get_state: () => call('get_state'),
    navigate: (url: string) => call('navigate', [url]),
    go_home: () => call('go_home'),
    go_back: () => call('go_back'),
    go_forward: () => call('go_forward'),
    refresh_page: () => call('refresh_page'),
    toggle_show_hide: () => call('toggle_show_hide'),
    toggle_on_top: () => call('toggle_on_top'),
    toggle_inside_mode: () => call('toggle_inside_mode'),
    set_inside_mode: (inside: boolean) => call('set_inside_mode', [inside]),
    toggle_lock_position: () => call('toggle_lock_position'),
    toggle_sidebar: () => call('toggle_sidebar'),
    set_opacity: (opacity: number) => call('set_opacity', [opacity]),
    set_shell_opacity: (opacity: number) => call('set_shell_opacity', [opacity]),
    increase_opacity: () => call('increase_opacity'),
    decrease_opacity: () => call('decrease_opacity'),
    minimize: () => call('minimize'),
    maximize_restore: () => call('maximize_restore'),
    close_window: () => call('close_window'),
    get_tabs: () => call('get_tabs'),
    get_logs: () => call('get_logs'),
    new_tab: (url: string) => call('new_tab', [url]),
    close_tab: (index: number) => call('close_tab', [index]),
    switch_tab: (index: number) => call('switch_tab', [index]),
    get_bookmarks: () => call('get_bookmarks'),
    add_bookmark: (url: string, title: string) => call('add_bookmark', [url, title]),
    remove_bookmark: (url: string) => call('remove_bookmark', [url]),
    save_config: (configJson: string) => call('save_config', [configJson]),
    get_config: () => call('get_config'),
    reset_config: () => call('reset_config'),
    video_action: (action: string) => call('video_action', [action]),
    get_ui_language: () => call('get_ui_language'),
    set_ui_language: (lang: string) => call('set_ui_language', [lang]),
    get_dock_color: () => call('get_dock_color'),
    set_dock_color: (color: DockColor) => call('set_dock_color', [color]),
    open_control_panel: () => call('open_control_panel'),
    open_external: (url: string) => call('open_external', [url]),
    resize_to_ratio: (ratio: number) => call('resize_to_ratio', [ratio]),
    close_app: () => call('close_app')
  };
}

function buildTauriBridge(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  return {
    get_state: () => invoke('get_state'),
    navigate: (url: string) => invoke('navigate', { url }),
    go_home: () => invoke('go_home'),
    go_back: () => invoke('go_back'),
    go_forward: () => invoke('go_forward'),
    refresh_page: () => invoke('refresh_page'),
    toggle_show_hide: () => invoke('toggle_show_hide'),
    toggle_on_top: () => invoke('toggle_on_top'),
    toggle_inside_mode: () => invoke('toggle_inside_mode'),
    set_inside_mode: (inside: boolean) => invoke('set_inside_mode', { inside }),
    toggle_lock_position: () => invoke('toggle_lock_position'),
    toggle_sidebar: () => invoke('toggle_sidebar'),
    set_opacity: (opacity: number) => invoke('set_opacity', { opacity }),
    set_shell_opacity: (opacity: number) => invoke('set_shell_opacity', { opacity }),
    increase_opacity: () => invoke('increase_opacity'),
    decrease_opacity: () => invoke('decrease_opacity'),
    minimize: () => invoke('minimize_browser'),
    maximize_restore: () => invoke('maximize_restore_browser'),
    close_window: () => invoke('close_app'),
    get_tabs: () => invoke('list_tabs'),
    get_logs: () => invoke('get_logs'),
    new_tab: (url: string) => invoke('new_tab', { url }),
    close_tab: (index: number) => invoke('close_tab', { index }),
    switch_tab: (index: number) => invoke('switch_tab', { index }),
    get_bookmarks: () => invoke('get_bookmarks'),
    add_bookmark: (url: string, title: string) => invoke('add_bookmark', { url, title }),
    remove_bookmark: (url: string) => invoke('remove_bookmark', { url }),
    save_config: (configJson: string) => invoke('save_hotkeys', { config: JSON.parse(configJson) }),
    get_config: () => invoke('get_hotkeys'),
    reset_config: () => invoke('reset_hotkeys'),
    video_action: (action: string) => invoke('video_action', { action }),
    get_ui_language: () => invoke('get_ui_language'),
    set_ui_language: (lang: string) => invoke('set_ui_language', { lang }),
    get_dock_color: () => invoke('get_dock_color'),
    set_dock_color: (color: DockColor) => invoke('set_dock_color', { color }),
    open_control_panel: () => invoke('open_control_panel'),
    open_external: (url: string) => invoke('open_external', { url }),
    resize_to_ratio: (ratio: number) => invoke('resize_to_ratio', { ratio }),
    close_app: () => invoke('close_app')
  };
}

function isBridgeUsable(bridge: unknown): bridge is Record<string, BridgeFn> {
  if (!bridge || typeof bridge !== 'object') return false;
  const value = bridge as Record<string, unknown>;
  return typeof value.get_state === 'function' && (typeof value.get_tabs === 'function' || typeof value.list_tabs === 'function');
}

function normalizeBridge(bridge: Record<string, BridgeFn>) {
  if (typeof bridge.get_tabs !== 'function' && typeof bridge.list_tabs === 'function') {
    bridge.get_tabs = (...args: unknown[]) => bridge.list_tabs(...args);
  }
  return bridge;
}

function shouldUseMockBridge(): boolean {
  if (window.__DIVIEWER_ALLOW_MOCK_BRIDGE__ === true) return true;
  const hostname = window.location.hostname;
  return Boolean(import.meta.env.DEV && (hostname === 'localhost' || hostname === '127.0.0.1'));
}

function installBridge(source: BridgeSource, bridge: Record<string, BridgeFn>) {
  window.bridge = bridge;
  window.__diviewer_bridge = bridge;
  window.__diviewer_bridge_source__ = source;
  return bridge;
}

async function resolveBridge(): Promise<Record<string, BridgeFn>> {
  if (isBridgeUsable(window.__diviewer_bridge)) {
    window.__diviewer_bridge_source__ ??= 'external';
    return normalizeBridge(window.__diviewer_bridge);
  }

  if (isBridgeUsable(window.bridge)) {
    window.__diviewer_bridge_source__ ??= 'external';
    return normalizeBridge(window.bridge);
  }

  const tauriInvoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
  if (typeof tauriInvoke === 'function') {
    const bridge = buildTauriBridge((cmd, args) => tauriInvoke(cmd, args));
    return installBridge('tauri', bridge);
  }

  if (window.__diviewer_bridge_ready__) return window.__diviewer_bridge_ready__;

  window.__diviewer_bridge_ready__ = new Promise((resolve) => {
    const pyCall = window.pywebview?.api?.call;
    if (typeof pyCall === 'function') {
      const bridge = buildPyWebviewBridge((name, args) => pyCall(name, args));
      resolve(installBridge('pywebview', bridge));
      return;
    }

    if (typeof window.QWebChannel === 'function' && window.qt?.webChannelTransport) {
      new window.QWebChannel(window.qt.webChannelTransport, (channel) => {
        const bridge = normalizeBridge((channel.objects?.bridge ?? {}) as Record<string, BridgeFn>);
        resolve(installBridge('qwebchannel', bridge));
      });
      return;
    }

    if (!shouldUseMockBridge()) {
      throw new Error('DI-Viewer host bridge is unavailable');
    }

    const fallback = {
      get_state: async () => defaultState,
      get_tabs: async () => defaultTabs,
      get_dock_color: async () => defaultDockColor,
      get_ui_language: async () => 'zh'
    };
    resolve(installBridge('mock', fallback));
  });

  return window.__diviewer_bridge_ready__;
}

async function callBridge<T>(method: string, ...args: unknown[]): Promise<T> {
  const bridge = await resolveBridge();
  const fn = bridge[method];
  if (typeof fn !== 'function') {
    throw new Error(`Bridge method not found: ${method}`);
  }
  return Promise.resolve(fn(...args) as T);
}

export const hostBridge = {
  async getState(): Promise<FrontendState> {
    return normalizeState(await callBridge<unknown>('get_state'));
  },
  async getTabs(): Promise<TabSessionSnapshot> {
    return normalizeTabs(await callBridge<unknown>('get_tabs'));
  },
  async getLogs(): Promise<any[]> {
    return (await callBridge<unknown>('get_logs')) as any[];
  },
  async getDockColor(): Promise<DockColor> {
    return sanitizeDockColor(await callBridge<unknown>('get_dock_color'));
  },
  async getSnapshot(): Promise<HostSnapshot> {
    const [state, tabs, dockColor] = await Promise.all([
      this.getState(),
      this.getTabs(),
      this.getDockColor()
    ]);
    return { state, tabs, dockColor };
  },
  getBridgeSource(): BridgeSource | undefined {
    return window.__diviewer_bridge_source__;
  },
  async getUiLanguage(): Promise<'zh' | 'en'> {
    const lang = String(await callBridge<unknown>('get_ui_language')).toLowerCase();
    return lang.startsWith('en') ? 'en' : 'zh';
  },
  setUiLanguage(lang: 'zh' | 'en') {
    return callBridge('set_ui_language', lang);
  },
  navigate(url: string) {
    return callBridge('navigate', url);
  },
  goHome() {
    return callBridge('go_home');
  },
  goBack() {
    return callBridge('go_back');
  },
  goForward() {
    return callBridge('go_forward');
  },
  refreshPage() {
    return callBridge('refresh_page');
  },
  setOpacity(opacity: number) {
    return callBridge('set_opacity', opacity);
  },
  setShellOpacity(opacity: number) {
    return callBridge('set_shell_opacity', opacity);
  },
  toggleShowHide() {
    return callBridge('toggle_show_hide');
  },
  toggleOnTop() {
    return callBridge('toggle_on_top');
  },
  toggleInsideMode() {
    return callBridge('toggle_inside_mode');
  },
  setInsideMode(inside: boolean) {
    return callBridge('set_inside_mode', inside);
  },
  toggleLockPosition() {
    return callBridge('toggle_lock_position');
  },
  minimize() {
    return callBridge('minimize');
  },
  maximizeRestore() {
    return callBridge('maximize_restore');
  },
  closeWindow() {
    return callBridge('close_window');
  },
  newTab(url: string) {
    return callBridge('new_tab', url);
  },
  closeTab(index: number) {
    return callBridge('close_tab', index);
  },
  switchTab(index: number) {
    return callBridge('switch_tab', index);
  },
  saveHotkeys(config: HotkeyConfig) {
    return callBridge('save_config', JSON.stringify(config));
  },
  resetHotkeys() {
    return callBridge<HotkeyConfig>('reset_config');
  },
  saveBookmark(url: string, title: string) {
    return callBridge('add_bookmark', url, title);
  },
  videoAction(action: string) {
    return callBridge('video_action', action);
  },
  setDockColor(color: DockColor) {
    return callBridge('set_dock_color', color);
  },
  toggleSidebar() {
    return callBridge('toggle_sidebar');
  },
  resizeToRatio(ratio: number) {
    return callBridge('resize_to_ratio', ratio);
  },
  openControlPanel() {
    return callBridge('open_control_panel');
  },
  openExternal(url: string) {
    return callBridge('open_external', url);
  },
  closeApp() {
    return callBridge('close_app');
  }
};
