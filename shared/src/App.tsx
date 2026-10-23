import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from './components/Sidebar';
import { BrowserView } from './components/BrowserView';
import { MainMenu } from './components/MainMenu';
import { hostBridge } from './bridge/hostBridge';
import { matchInAppHotkey } from './lib/inAppHotkeys';
import { useViewport } from './lib/useViewport';
import { chromeMetricsFor } from './lib/chromeMetrics';
import type { FrontendState, HostSnapshot, HotkeyConfig, ThemeMode } from './types';
export interface Tab {
  id: string;
  title: string;
  url: string;
  history: string[];
  historyIndex: number;
}
type UILang = 'zh' | 'en';
interface TabHistoryState {
  history: string[];
  historyIndex: number;
}
const defaultState: FrontendState = {
  lastUrl: '',
  opacity: 1,
  onTop: false,
  inside: false,
  visible: true,
  maximized: false,
  positionLocked: false,
  snapEnabled: true,
  borderless: false,
  immersive: false,
  hotkeysEnabled: true,
  sidebarVisible: true,
  uiLang: 'zh',
  bookmarks: [],
  hotkeys: {
    togglePlayPause: 'Backquote',
    toggleRecording: 'R',
    toggleShowHide: 'Ctrl+Alt+H',
    insideMode: 'Ctrl+Alt+P',
    immersiveMode: 'Ctrl+Alt+I',
    videoBackward: '5',
    videoForward: '6',
    decreaseOpacity: '7',
    increaseOpacity: '8',
    requestFullScreen: 'O',
    closeWindow: 'Ctrl+Q'
  },
  hotkeyConflicts: [],
  startPageUrl: '',
  startPageBuiltin: true,
  themeMode: 'system'
};
const GITHUB_REPO_URL = 'https://github.com/yyin9116/DI-Viewer';

/**
 * Compare two page URLs for "same page as the bookmark" purposes.
 *
 * The host normalises what it stores (`https://example.org/`), while the tab
 * URL comes straight from the webview and can be the bare form without the
 * trailing slash. A plain `===` misses that pair and the bookmark button stays
 * unlit on a page that is in fact saved.
 */
function samePage(left: string, right: string): boolean {
  const clean = (value: string) => {
    const trimmed = (value || '').trim().toLowerCase();
    if (!trimmed) return '';
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  };
  return clean(left) !== '' && clean(left) === clean(right);
}

const I18N = {
  zh: {
    newTab: '\u65b0\u6807\u7b7e\u9875',
    insideModeHint: '\u5df2\u8fdb\u5165\u70b9\u51fb\u7a7f\u900f\uff0c\u6309 {key} \u9000\u51fa\u7a7f\u900f',
    bookmarkSaved: '\u5df2\u6536\u85cf\u5f53\u524d\u9875\u9762',
    bookmarkExists: '\u5f53\u524d\u9875\u9762\u5df2\u5728\u6536\u85cf\u4e2d',
    bookmarkRemoved: '\u5df2\u53d6\u6d88\u6536\u85cf',
    startPageSaved: '\u8d77\u59cb\u9875\u5df2\u66f4\u65b0',
    startPageInvalid: '\u5730\u5740\u65e0\u6548\uff0c\u672a\u4fdd\u5b58',
    bridgeErrorTitle: '\u63a7\u5236\u6865\u63a5\u4e0d\u53ef\u7528',
    bridgeErrorBody: '\u5de6\u4fa7\u63a7\u5236\u53ef\u80fd\u65e0\u6cd5\u540c\u6b65\u7a97\u53e3\u72b6\u6001\u3002\u8bf7\u91cd\u542f DI-Viewer\uff0c\u6216\u6253\u5f00\u8fd0\u884c\u8bca\u65ad\u67e5\u770b\u8be6\u60c5\u3002'
  },
  en: {
    newTab: 'New Tab',
    insideModeHint: 'Click-through enabled, press {key} to disable',
    bookmarkSaved: 'Page saved to bookmarks',
    bookmarkExists: 'This page is already bookmarked',
    bookmarkRemoved: 'Bookmark removed',
    startPageSaved: 'Start page updated',
    startPageInvalid: 'Invalid address — not saved',
    bridgeErrorTitle: 'Control bridge unavailable',
    bridgeErrorBody: 'The sidebar may not sync with the window state. Restart DI-Viewer or open diagnostics for details.'
  }
} as const;
export default function App() {
  const [snapshot, setSnapshot] = useState<HostSnapshot>({
    state: defaultState,
    tabs: { tabs: [], activeIndex: 0 },
    dockColor: 'white'
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  /**
   * Theme: the *choice* lives here and on the host (`theme_mode`), the *resolved*
   * value is derived. It used to be a single `isDarkMode` boolean inferred from
   * whatever page was open (`document.documentElement.classList`), which is why
   * every new tab started light and why a dark site could repaint the chrome.
   */
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  const isDarkMode = themeMode === 'dark' || (themeMode === 'system' && systemDark);
  const [tabHistoryState, setTabHistoryState] = useState<Record<string, TabHistoryState>>({});
  const [uiLang, setUiLang] = useState<UILang>('zh');
  /// Transient, user-facing notice (entering click-through). Named for what it
  /// is: the old `diagMessage` also carried `label:start` / `label:ok` traces
  /// from every bridge call, which surfaced as a grey debug box in the corner.
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  /**
   * Adopt a theme and tell the host, which persists it and re-broadcasts to the
   * other tabs (each tab is its own document with its own shell).
   *
   * Deliberately not routed through `run()`: that helper resyncs the whole
   * snapshot after every call, which would stamp the old value back over the
   * optimistic update below while the write is in flight.
   */
  const applyThemeChoice = (mode: ThemeMode) => {
    setThemeMode(mode);
    setSnapshot((current) => ({ ...current, state: { ...current.state, themeMode: mode } }));
    void hostBridge.setTheme(mode).catch(() => undefined);
  };
  /**
   * The host is only consulted once, on the first snapshot. Afterwards the
   * broadcaster owns the value: polling `get_state` every 1200ms would otherwise
   * stamp the previous mode back over a choice that is still being written,
   * which showed up as the chrome blinking back to the old theme.
   */
  const themeSeeded = useRef(false);
  const adoptHostTheme = (mode: ThemeMode) => {
    if (themeSeeded.current) return;
    themeSeeded.current = true;
    setThemeMode(mode);
  };
  useEffect(() => {
    let query: MediaQueryList | null = null;
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', handleChange);
    return () => query?.removeEventListener('change', handleChange);
  }, []);
  useEffect(() => {
    setTabHistoryState((current) => {
      const next: Record<string, TabHistoryState> = {};
      snapshot.tabs.tabs.forEach((tab, idx) => {
        const id = String(tab.index ?? idx);
        const url = String(tab.url ?? '');
        const existing = current[id];
        if (!existing) {
          next[id] = { history: [url], historyIndex: 0 };
          return;
        }
        const history = existing.history.length ? [...existing.history] : [url];
        let historyIndex = existing.historyIndex;
        const matchedIndex = history.lastIndexOf(url);
        if (matchedIndex >= 0) {
          historyIndex = matchedIndex;
        } else {
          history.splice(historyIndex + 1);
          history.push(url);
          historyIndex = history.length - 1;
        }
        next[id] = { history, historyIndex };
      });
      return next;
    });
  }, [snapshot.tabs.tabs]);
  const tabs = useMemo<Tab[]>(() => {
    const t = I18N[uiLang];
    return snapshot.tabs.tabs.map((tab, idx) => {
      const id = String(tab.index ?? idx);
      const historyState = tabHistoryState[id];
      return {
        id,
        title: tab.title || tab.url || `${t.newTab} ${idx + 1}`,
        url: tab.url || '',
        history: historyState?.history ?? [tab.url || ''],
        historyIndex: historyState?.historyIndex ?? 0
      };
    });
  }, [snapshot.tabs.tabs, tabHistoryState, uiLang]);
  const activeTabId = useMemo(() => {
    if (!tabs.length) return '';
    return String(snapshot.tabs.activeIndex);
  }, [tabs, snapshot.tabs.activeIndex]);
  const activeTab = useMemo(() => {
    const t = I18N[uiLang];
    return tabs.find((tab) => tab.id === activeTabId) || tabs[0] || {
      id: '0',
      title: t.newTab,
      url: snapshot.state.lastUrl,
      history: [snapshot.state.lastUrl],
      historyIndex: 0
    };
  }, [tabs, activeTabId, snapshot.state.lastUrl, uiLang]);
  const syncSnapshot = async () => {
    try {
      const next = await hostBridge.getSnapshot();
      setBridgeError(null);
      setSnapshot(next);
      const inferred = String(next.state.uiLang || '').toLowerCase();
      setUiLang(inferred.startsWith('en') ? 'en' : 'zh');
      adoptHostTheme(next.state.themeMode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBridgeError(message);
    }
  };
  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      try {
        const next = await hostBridge.getSnapshot();
        if (!mounted) return;
        setBridgeError(null);
        setSnapshot(next);
        const inferred = String(next.state.uiLang || '').toLowerCase();
        setUiLang(inferred.startsWith('en') ? 'en' : 'zh');
        adoptHostTheme(next.state.themeMode);
      } catch (error) {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : String(error);
        setBridgeError(message);
      }
    };
    const triggerSync = () => {
      void sync();
    };
    void sync();
    const timer = window.setInterval(sync, 1200);
    window.addEventListener('diviewer:sync', triggerSync);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('diviewer:sync', triggerSync);
    };
  }, []);
  useEffect(() => {
    const host = document.getElementById('__diviewer_shared_root__');
    if (!host) return;
    const visible = snapshot.state.sidebarVisible ? 'true' : 'false';
    host.setAttribute('data-sidebar-visible', visible);
    const shellRoot = host.shadowRoot?.querySelector('.diviewer-host-root');
    if (shellRoot) {
      shellRoot.setAttribute('data-sidebar-visible', visible);
    }
    window.dispatchEvent(new CustomEvent('diviewer:sync'));
  }, [snapshot.state.sidebarVisible]);
  useEffect(() => {
    // The pre-React placeholder chrome (rail + toolbar painted by the native
    // bootstrap) is retired the moment React owns the same surface. Leaving it
    // alive underneath caused the collapsed rail to keep a 1px border and made
    // the dark rail appear at full size before its spring animation ran.
    const host = document.getElementById('__diviewer_shared_root__');
    if (host) host.setAttribute('data-shell-ready', 'true');
  }, []);
  useEffect(() => {
    const host = document.getElementById('__diviewer_shared_root__');
    if (!host) return;
    const theme = isDarkMode ? 'dark' : 'light';
    host.setAttribute('data-theme', theme);
    const shellRoot = host.shadowRoot?.querySelector('.diviewer-host-root');
    if (shellRoot) {
      shellRoot.setAttribute('data-theme', theme);
    }
    // The pre-React strip painted by the native bootstrap lives outside the
    // React tree; give it the same theme so it does not flash light.
    const frame = host.shadowRoot?.getElementById('__diviewer_chrome_frame__');
    if (frame) frame.classList.toggle('dark', isDarkMode);
    window.dispatchEvent(new CustomEvent('diviewer:theme-change', { detail: { theme } }));
  }, [isDarkMode]);
  /**
   * Two ways the theme can change from outside this component: the host
   * broadcasts its stored choice (another tab changed it, or the window was
   * restored), or a page asks for one through its own theme button.
   *
   * The page is never allowed to *be* the source of truth any more — it can only
   * request a choice, and the host decides.
   */
  useEffect(() => {
    const handleBroadcast = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: string }>).detail?.mode;
      if (mode === 'light' || mode === 'dark' || mode === 'system') {
        setThemeMode(mode);
        setSnapshot((current) => ({ ...current, state: { ...current.state, themeMode: mode } }));
      }
    };
    const handlePageRequest = (event: Event) => {
      const theme = (event as CustomEvent<{ theme?: string }>).detail?.theme;
      if (theme === 'dark' || theme === 'light') {
        applyThemeChoice(theme);
      }
    };
    window.addEventListener('diviewer:theme-mode', handleBroadcast);
    window.addEventListener('diviewer:page-theme-change', handlePageRequest);
    return () => {
      window.removeEventListener('diviewer:theme-mode', handleBroadcast);
      window.removeEventListener('diviewer:page-theme-change', handlePageRequest);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const host = document.getElementById('__diviewer_shared_root__');
    if (!host) return;
    host.setAttribute('data-lang', uiLang);
    const shellRoot = host.shadowRoot?.querySelector('.diviewer-host-root');
    if (shellRoot) {
      shellRoot.setAttribute('data-lang', uiLang);
    }
    window.dispatchEvent(new CustomEvent('diviewer:language-change', { detail: { lang: uiLang } }));
  }, [uiLang]);
  /*
   * Wraps a bridge call so a hung one cannot wedge the UI. It used to emit a
   * `label:start` / `label:ok` toast on every single call, which put a grey
   * monospace box in the corner of a shipping build — indistinguishable from
   * debug chrome, because it was. Failures still reach the bridge-error card;
   * the happy path is silent now.
   */
  const run = async (action: () => Promise<unknown>, label?: string, timeoutMs = 1800) => {
    let timedOut = false;
    try {
      await Promise.race([
        action(),
        new Promise((_, reject) => window.setTimeout(() => {
          timedOut = true;
          reject(new Error('bridge timeout'));
        }, timeoutMs))
      ]);
    } catch {
      if (label) {
        setBridgeError(timedOut ? 'bridge timeout' : `${label} failed`);
      }
    }
    void syncSnapshot();
  };
  const runAndCloseMenu = async (action: () => Promise<unknown>, timeoutMs?: number) => {
    setIsMenuOpen(false);
    await run(action, undefined, timeoutMs);
  };
  const handleNavigate = (url: string) => {
    void run(() => hostBridge.navigate(url), 'navigate', 3000);
  };
  const handleTabAdd = () => {
    void run(() => hostBridge.newTab(''), 'new_tab', 12000);
  };
  const handleNavigateHistory = (index: number) => {
    const delta = index - activeTab.historyIndex;
    if (delta === 0) return;
    void run(async () => {
      const steps = Math.abs(delta);
      for (let i = 0; i < steps; i += 1) {
        if (delta < 0) {
          await hostBridge.goBack();
        } else {
          await hostBridge.goForward();
        }
      }
      return null;
    }, 'history', 6000);
  };
  const handleSaveHotkeys = (next: HotkeyConfig) => {
    setSnapshot((current) => ({
      ...current,
      state: {
        ...current.state,
        hotkeys: next
      }
    }));
    void run(async () => {
      await hostBridge.saveHotkeys(next);
      // Re-registering can fail for a combo another app already owns; pull the
      // fresh conflict list so the panel can mark the row instead of pretending
      // the shortcut works.
      await syncSnapshot();
      return next;
    }, 'save_hotkeys', 3000);
  };
  const handleResetHotkeys = () => {
    void run(async () => {
      const next = await hostBridge.resetHotkeys();
      setSnapshot((current) => ({
        ...current,
        state: {
          ...current.state,
          hotkeys: next
        }
      }));
      return next;
    }, 'reset_hotkeys', 3000);
  };
  const handleToggleHotkeysEnabled = (enabled: boolean) => {
    setSnapshot((current) => ({
      ...current,
      state: { ...current.state, hotkeysEnabled: enabled }
    }));
    void run(() => hostBridge.setHotkeysEnabled(enabled), 'set_hotkeys_enabled', 3000);
  };
  const handleRescueWindow = () => {
    setIsMenuOpen(false);
    void run(async () => {
      // Restore the shell's own DOM opacity too, otherwise a translucent
      // shell keeps looking broken even after the native layer is reset.
      await hostBridge.setShellOpacity(1);
      return hostBridge.rescueWindow();
    }, 'rescue_window', 3000);
  };
  const applyOpacityPercent = (value: number) => {
    const clamped = Math.max(20, Math.min(100, Math.round(value)));
    const alpha = clamped / 100;
    setSnapshot((current) => ({
      ...current,
      state: { ...current.state, opacity: alpha }
    }));
    void run(async () => {
      await hostBridge.setOpacity(alpha);
      await hostBridge.setShellOpacity(alpha);
      return null;
    }, 'set_opacity', 3000);
  };
  /**
   * In-app layer of the shortcut system. Bare bindings (R / 5 / 6 / 7 / 8 / O …)
   * never reach RegisterHotKey: they are matched here, which lets us skip IME
   * composition and focused text fields instead of swallowing the keystroke
   * system-wide.
   */
  useEffect(() => {
    if (!snapshot.state.hotkeysEnabled) return;
    const hotkeys = snapshot.state.hotkeys;
    const currentOpacity = snapshot.state.opacity;
    let composing = false;
    const handleCompositionStart = () => {
      composing = true;
    };
    const handleCompositionEnd = () => {
      composing = false;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = matchInAppHotkey(hotkeys, event, { composing });
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === 'increase_opacity' || action === 'decrease_opacity') {
        const step = action === 'increase_opacity' ? 10 : -10;
        applyOpacityPercent(currentOpacity * 100 + step);
        return;
      }
      void run(() => hostBridge.videoAction(action), `inapp:${action}`, 2500);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('compositionstart', handleCompositionStart, true);
    document.addEventListener('compositionend', handleCompositionEnd, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('compositionstart', handleCompositionStart, true);
      document.removeEventListener('compositionend', handleCompositionEnd, true);
    };
    // `run` is recreated per render; the effect only needs to re-arm when the
    // binding table, the master switch or the opacity baseline changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.state.hotkeysEnabled, snapshot.state.hotkeys, snapshot.state.opacity]);
  /**
   * Saving a bookmark goes to the host and shows up on the start page, which is
   * a different webview - so the rail would otherwise give no sign at all that
   * the click registered. Light the button, and say so in a toast, for the page
   * that is already saved.
   */
  const isBookmarked = useMemo(
    () => snapshot.state.bookmarks.some((item) => samePage(item.url, activeTab?.url || '')),
    [snapshot.state.bookmarks, activeTab?.url]
  );
  /**
   * The rail button is a *toggle*: a page that is already saved is removed by
   * clicking again. It used to answer with "already bookmarked" and do nothing,
   * so the only way to undo a mistaken save was the start page's edit mode —
   * which is exactly where the user was not.
   */
  const handleBookmarkCurrent = () => {
    const url = activeTab.url?.trim();
    if (!url) return;
    if (url.toLowerCase().includes('/lucid-start-page/index.html')) return;
    if (isBookmarked) {
      // Unlight it right away. The write also comes back through the host
      // broadcast, but that round trip is visible as a flicker in the button.
      setSnapshot((current) => ({
        ...current,
        state: {
          ...current.state,
          bookmarks: current.state.bookmarks.filter((item) => !samePage(item.url, url))
        }
      }));
      setToastMessage(I18N[uiLang].bookmarkRemoved);
      void run(() => hostBridge.removeBookmark(url), 'remove_bookmark', 2500);
    } else {
      const title = (activeTab.title || activeTab.url || 'New Bookmark').trim();
      window.dispatchEvent(new CustomEvent('diviewer:bookmark-added', { detail: { url, title } }));
      void run(() => hostBridge.saveBookmark(url, title), 'save_bookmark', 2500);
      setToastMessage(I18N[uiLang].bookmarkSaved);
    }
    window.setTimeout(() => setToastMessage(null), 2000);
  };
  /**
   * Saving a home address can be rejected (not an http(s) URL). That is a
   * user-visible mistake, not a bridge failure, so it goes to the toast instead
   * of the "control bridge unavailable" card that `run` raises.
   */
  const handleSaveStartPage = (next: string) => {
    void (async () => {
      try {
        const config = await hostBridge.setStartPage(next);
        setSnapshot((current) => ({
          ...current,
          state: { ...current.state, startPageUrl: config.url, startPageBuiltin: config.builtin }
        }));
        setToastMessage(I18N[uiLang].startPageSaved);
        void syncSnapshot();
      } catch {
        setToastMessage(I18N[uiLang].startPageInvalid);
      }
      window.setTimeout(() => setToastMessage(null), 2400);
    })();
  };
  const shellOpen = snapshot.state.sidebarVisible;
  const viewport = useViewport();
  const compact = viewport.width < 760;
  // The rail and the toolbar are one tier table now (`chromeMetrics.ts`):
  // three steps keep their share of the window roughly constant without
  // animating on every pixel of a drag. `railWidth` must stay equal to
  // `--diviewer-inset-left` below — that is the page's padding, and a mismatch
  // either hides content under the rail or leaves a strip of dead space.
  const chrome = useMemo(() => chromeMetricsFor(viewport.width), [viewport.width]);
  const railWidth = chrome.rail;
  useEffect(() => {
    // The native bootstrap insets the page before the first paint with the same
    // tier table; keep it in sync when the shell collapses into its handle (the
    // page then owns the full window again) and when the tier itself changes.
    const style = document.documentElement.style;
    style.setProperty('--diviewer-inset-top', `${shellOpen ? chrome.height : 0}px`);
    style.setProperty('--diviewer-inset-left', `${shellOpen ? railWidth : 0}px`);
  }, [shellOpen, railWidth, chrome.height]);
  return (
    <div className={`diviewer-host-root ${isDarkMode ? 'dark' : ''}`}>
      <div className="relative h-full w-full overflow-hidden pointer-events-none">
        <motion.div
          className="relative flex h-full w-full overflow-hidden pointer-events-none"
          initial={false}
          animate={{
            borderRadius: 0,
            borderWidth: 0,
            borderColor: 'transparent',
            boxShadow: '0 0 0 rgba(0,0,0,0)'
          }}
          style={{ background: 'transparent' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300, mass: 0.9 }}
        >
          <Sidebar
            activeTabId={activeTabId}
            dockColor={snapshot.dockColor}
            isDarkMode={isDarkMode}
            onBookmarksClick={handleBookmarkCurrent}
            isBookmarked={isBookmarked}
            onSettingsClick={() => setIsMenuOpen((open) => !open)}
            isPinned={snapshot.state.onTop}
            onTogglePin={() => void run(() => hostBridge.toggleOnTop(), 'toggle_on_top', 2500)}
            isOpen={shellOpen}
            onToggle={() => void run(() => hostBridge.toggleSidebar(), 'toggle_sidebar', 2500)}
            onFullscreenClick={() => void run(() => hostBridge.maximizeRestore(), 'maximize_restore', 3000)}
            onMediaAction={(action) => void run(() => hostBridge.videoAction(action), `video:${action}`, 2500)}
            lang={uiLang}
            dense={viewport.height < 560}
            railWidth={railWidth}
          />
          <div className="relative z-0 flex h-full min-w-0 flex-1 flex-col overflow-hidden pointer-events-none">
            <BrowserView
              tab={activeTab}
              tabs={tabs}
              onNavigate={handleNavigate}
              onTabSelect={(id) => void run(() => hostBridge.switchTab(Number(id)), `switch_tab:${id}`, 8000)}
              onTabClose={(id) => void run(() => hostBridge.closeTab(Number(id)), `close_tab:${id}`, 5000)}
              onTabAdd={handleTabAdd}
              isSidebarOpen={shellOpen}
              onTabsReorder={() => undefined}
              onNavigateHistory={handleNavigateHistory}
              onRefresh={() => void run(() => hostBridge.refreshPage(), 'refresh', 3000)}
              lang={uiLang}
              compact={compact}
              chrome={chrome}
              startPageUrl={snapshot.state.startPageUrl}
              borderless={snapshot.state.borderless}
              onStartDrag={() => void run(() => hostBridge.startDragging(), 'start_dragging', 3000)}
            />
          </div>
          <AnimatePresence>
            {toastMessage && (
              <motion.div
                key={toastMessage}
                initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: 6, filter: 'blur(6px)' }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-none fixed bottom-3 right-3 z-[2147483647] overflow-hidden rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-xs font-medium text-slate-700 shadow-[0_8px_30px_rgba(15,23,42,0.12)] backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/70 dark:text-slate-100 dark:shadow-[0_8px_30px_rgba(0,0,0,0.55)]"
              >
                {/* A hairline of light along the top edge: enough to read as a
                    raised surface without a second border colour. */}
                <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/25" />
                {toastMessage}
              </motion.div>
            )}
          </AnimatePresence>
          {bridgeError && (
            <div className="pointer-events-auto fixed right-3 top-3 z-[2147483647] max-w-[360px] rounded-2xl border border-rose-200/80 bg-white/95 p-3 text-sm text-slate-700 shadow-lg shadow-rose-950/10 backdrop-blur dark:border-rose-900/70 dark:bg-zinc-950/95 dark:text-slate-200">
              <div className="font-semibold text-rose-700 dark:text-rose-300">{I18N[uiLang].bridgeErrorTitle}</div>
              <div className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{I18N[uiLang].bridgeErrorBody}</div>
              <div className="mt-2 rounded-lg bg-rose-50 px-2 py-1 font-mono text-[11px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{bridgeError}</div>
            </div>
          )}
          <AnimatePresence>
            {isMenuOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-[2147483646] pointer-events-auto bg-transparent"
                  onClick={() => setIsMenuOpen(false)}
                />
                <MainMenu
                onClose={() => setIsMenuOpen(false)}
                opacity={Math.round(snapshot.state.opacity * 100)}
                setOpacity={applyOpacityPercent}
                themeMode={themeMode}
                onThemeModeChange={applyThemeChoice}
                onToggleSidebar={() => void runAndCloseMenu(() => hostBridge.toggleSidebar(), 2500)}
                onQuit={() => void runAndCloseMenu(() => hostBridge.closeApp(), 2500)}
                hotkeys={snapshot.state.hotkeys}
                hotkeyConflicts={snapshot.state.hotkeyConflicts}
                onSaveHotkeys={handleSaveHotkeys}
                onResetHotkeys={handleResetHotkeys}
                lang={uiLang}
                onLangChange={(lang) => {
                  setUiLang(lang);
                  void run(() => hostBridge.setUiLanguage(lang), 'set_lang', 2500);
                }}
                // Deliberately outside `run`: the bar calls this every frame
                // while dragging, and `run` resyncs the whole shell after each
                // call, which would re-render mid-gesture.
                onResizeRatio={(ratio, commit) => {
                  void hostBridge.resizeToRatio(ratio, commit).catch(() => undefined);
                }}
                onToggleInsideMode={() => {
                  const nextInside = !snapshot.state.inside;
                  void run(() => hostBridge.setInsideMode(nextInside), 'set_inside_mode', 2500);
                  if (nextInside) {
                    const hint = I18N[uiLang].insideModeHint.replace('{key}', snapshot.state.hotkeys.insideMode || 'P');
                    setToastMessage(hint);
                    window.setTimeout(() => setToastMessage(null), 2800);
                  }
                }}
                isInsideMode={snapshot.state.inside}
                onTogglePositionLock={() => void run(() => hostBridge.toggleLockPosition(), 'toggle_position_lock', 2500)}
                isPositionLocked={snapshot.state.positionLocked}
                snapEnabled={snapshot.state.snapEnabled}
                onToggleSnap={() => void run(() => hostBridge.setSnapEnabled(!snapshot.state.snapEnabled), 'set_snap_enabled', 2500)}
                borderless={snapshot.state.borderless}
                onToggleBorderless={(enabled) => void run(() => hostBridge.setBorderless(enabled), 'set_borderless', 2500)}
                onAbout={() => void run(() => hostBridge.openExternal(GITHUB_REPO_URL), 'open_about', 3000)}
                isPinned={snapshot.state.onTop}
                onTogglePin={() => void run(() => hostBridge.toggleOnTop(), 'toggle_on_top', 2500)}
                isSidebarVisible={snapshot.state.sidebarVisible}
                hotkeysEnabled={snapshot.state.hotkeysEnabled}
                onToggleHotkeysEnabled={handleToggleHotkeysEnabled}
                onRescueWindow={handleRescueWindow}
                startPageUrl={snapshot.state.startPageUrl}
                isStartPageBuiltin={snapshot.state.startPageBuiltin}
                onSaveStartPage={handleSaveStartPage}
              />
              </>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
