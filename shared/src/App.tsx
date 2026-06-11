import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from './components/Sidebar';
import { BrowserView } from './components/BrowserView';
import { MainMenu } from './components/MainMenu';
import { hostBridge } from './bridge/hostBridge';
import type { FrontendState, HostSnapshot, HotkeyConfig } from './types';
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
  sidebarVisible: true,
  uiLang: 'zh',
  bookmarks: [],
  hotkeys: {
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
  }
};
const GITHUB_REPO_URL = 'https://github.com/yyin9116/DI-Viewer';

const I18N = {
  zh: {
    newTab: '\u65b0\u6807\u7b7e\u9875',
    insideModeHint: '\u5df2\u8fdb\u5165\u70b9\u51fb\u7a7f\u900f\uff0c\u6309 {key} \u9000\u51fa\u7a7f\u900f'
  },
  en: {
    newTab: 'New Tab',
    insideModeHint: 'Click-through enabled, press {key} to disable'
  }
} as const;
export default function App() {
  const [snapshot, setSnapshot] = useState<HostSnapshot>({
    state: defaultState,
    tabs: { tabs: [], activeIndex: 0 },
    dockColor: 'white'
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [tabHistoryState, setTabHistoryState] = useState<Record<string, TabHistoryState>>({});
  const [uiLang, setUiLang] = useState<UILang>('zh');
  const [diagMessage, setDiagMessage] = useState<string | null>(null);
  const [isBridgeLogVisible, setIsBridgeLogVisible] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const diagOnceRef = useRef<Set<string>>(new Set());
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
    const next = await hostBridge.getSnapshot().catch(() => null);
    if (!next) return;
    setSnapshot(next);
    const inferred = String(next.state.uiLang || '').toLowerCase();
    setUiLang(inferred.startsWith('en') ? 'en' : 'zh');
  };
  const showDiagOnce = (key: string, message: string) => {
    if (diagOnceRef.current.has(key)) return;
    diagOnceRef.current.add(key);
    setDiagMessage(message);
    window.setTimeout(() => setDiagMessage(null), 1400);
  };
  const pushLog = (message: string) => {
    const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLogLines((current) => {
      const next = [...current, `${stamp} fe:${message}`];
      return next.slice(-30);
    });
  };
  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      try {
        const next = await hostBridge.getSnapshot();
        if (!mounted) return;
        setSnapshot(next);
        const inferred = String(next.state.uiLang || '').toLowerCase();
        setUiLang(inferred.startsWith('en') ? 'en' : 'zh');
      } catch {
        // ignore bridge failures in preview mode
      }
    };
    const triggerSync = () => {
      void sync();
    };
    void sync();
    const timer = window.setInterval(sync, 1200);
    const logTimer = window.setInterval(async () => {
      try {
        const logs = await hostBridge.getLogs();
        if (!mounted || !Array.isArray(logs)) return;
        const lines = logs.slice(-30).map((entry: any) => {
          const ts = typeof entry?.ts === 'number'
            ? new Date(entry.ts).toLocaleTimeString('en-GB', { hour12: false })
            : '';
          const source = entry?.source ? String(entry.source) : 'ui';
          const action = entry?.action ? String(entry.action) : 'action';
          const detail = entry?.detail ? String(entry.detail) : '';
          return `${ts} ${source}:${action}${detail ? `:${detail}` : ''}`.trim();
        });
        setLogLines(lines);
      } catch {
        // ignore
      }
    }, 700);
    window.addEventListener('diviewer:sync', triggerSync);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.clearInterval(logTimer);
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
    const host = document.getElementById('__diviewer_shared_root__');
    if (!host) return;
    const theme = isDarkMode ? 'dark' : 'light';
    host.setAttribute('data-theme', theme);
    const shellRoot = host.shadowRoot?.querySelector('.diviewer-host-root');
    if (shellRoot) {
      shellRoot.setAttribute('data-theme', theme);
    }
    window.dispatchEvent(new CustomEvent('diviewer:theme-change', { detail: { theme } }));
  }, [isDarkMode]);
  useEffect(() => {
    const syncFromPage = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    const handlePageThemeChange = (event: Event) => {
      const theme = (event as CustomEvent<{ theme?: string }>).detail?.theme;
      if (theme === 'dark') {
        setIsDarkMode(true);
      } else if (theme === 'light') {
        setIsDarkMode(false);
      } else {
        syncFromPage();
      }
    };
    syncFromPage();
    window.addEventListener('diviewer:page-theme-change', handlePageThemeChange);
    const observer = new MutationObserver(syncFromPage);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.removeEventListener('diviewer:page-theme-change', handlePageThemeChange);
      observer.disconnect();
    };
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
  const run = async (action: () => Promise<unknown>, label?: string, timeoutMs = 1800) => {
    let timedOut = false;
    if (label) {
      showDiagOnce(`${label}-start`, `${label}:start`);
      pushLog(`${label}:start`);
    }
    try {
      await Promise.race([
        action(),
        new Promise((_, reject) => window.setTimeout(() => {
          timedOut = true;
          reject(new Error('bridge timeout'));
        }, timeoutMs))
      ]);
      if (label) {
        showDiagOnce(`${label}-ok`, `${label}:ok`);
        pushLog(`${label}:ok`);
      }
    } catch {
      if (label) {
        const suffix = timedOut ? 'timeout' : 'error';
        showDiagOnce(`${label}-${suffix}`, `${label}:${suffix}`);
        pushLog(`${label}:${suffix}`);
      }
      // keep UI responsive even if one host call stalls
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
    void run(() => hostBridge.saveHotkeys(next), 'save_hotkeys', 3000);
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
  const handleBookmarkCurrent = () => {
    const url = activeTab.url?.trim();
    if (!url) return;
    if (url.toLowerCase().includes('/lucid-start-page/index.html')) return;
    const title = (activeTab.title || activeTab.url || 'New Bookmark').trim();
    window.dispatchEvent(new CustomEvent('diviewer:bookmark-added', { detail: { url, title } }));
    void run(() => hostBridge.saveBookmark(url, title), 'save_bookmark', 2500);
  };
  const shellOpen = snapshot.state.sidebarVisible;
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
            onSettingsClick={() => setIsMenuOpen((open) => !open)}
            isPinned={snapshot.state.onTop}
            onTogglePin={() => void run(() => hostBridge.toggleOnTop(), 'toggle_on_top', 2500)}
            isOpen={shellOpen}
            onToggle={() => void run(() => hostBridge.toggleSidebar(), 'toggle_sidebar', 2500)}
            onFullscreenClick={() => void run(() => hostBridge.maximizeRestore(), 'maximize_restore', 3000)}
            onMediaAction={(action) => void run(() => hostBridge.videoAction(action), `video:${action}`, 2500)}
            lang={uiLang}
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
            />
          </div>
          {diagMessage && (
            <div className="pointer-events-none fixed bottom-3 right-3 z-[2147483647] rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-xs font-mono text-slate-700 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-slate-200">
              {diagMessage}
            </div>
          )}
          {isBridgeLogVisible && logLines.length > 0 && (
            <div className="fixed left-3 top-3 z-[2147483647] pointer-events-auto w-[320px] rounded-2xl border border-gray-100 bg-white/90 p-2 text-[11px] font-mono text-gray-600 shadow-sm backdrop-blur dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
                <span>Bridge Log</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(logLines.join(String.fromCharCode(10)))}
                  className="rounded-md border border-gray-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/80 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setIsBridgeLogVisible(false)}
                  className="rounded-md border border-gray-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-gray-500 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/80 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Hide
                </button>
              </div>
              <div className="max-h-56 space-y-0.5 overflow-auto scrollbar-hide">
                {logLines.slice().reverse().map((line, idx) => (
                  <div key={idx} className="truncate">{line}</div>
                ))}
              </div>
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
                setOpacity={(next) => {
                  const value = Math.max(20, Math.min(100, next));
                  const alpha = value / 100;
                  setSnapshot((current) => ({
                    ...current,
                    state: { ...current.state, opacity: alpha }
                  }));
                  void run(async () => {
                    await hostBridge.setOpacity(alpha);
                    await hostBridge.setShellOpacity(alpha);
                    return null;
                  }, 'set_opacity', 3000);
                }}
                isDarkMode={isDarkMode}
                onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
                onToggleSidebar={() => void runAndCloseMenu(() => hostBridge.toggleSidebar(), 2500)}
                onQuit={() => void runAndCloseMenu(() => hostBridge.closeApp(), 2500)}
                hotkeys={snapshot.state.hotkeys}
                onSaveHotkeys={handleSaveHotkeys}
                onResetHotkeys={handleResetHotkeys}
                lang={uiLang}
                onLangChange={(lang) => {
                  setUiLang(lang);
                  void run(() => hostBridge.setUiLanguage(lang), 'set_lang', 2500);
                }}
                onResizeRatio={(ratio) => void runAndCloseMenu(() => hostBridge.resizeToRatio(ratio), 3000)}
                onToggleInsideMode={() => {
                  const nextInside = !snapshot.state.inside;
                  void run(() => hostBridge.setInsideMode(nextInside), 'set_inside_mode', 2500);
                  if (nextInside) {
                    const hint = I18N[uiLang].insideModeHint.replace('{key}', snapshot.state.hotkeys.insideMode || 'P');
                    setDiagMessage(hint);
                    window.setTimeout(() => setDiagMessage(null), 2800);
                  }
                }}
                isInsideMode={snapshot.state.inside}
                onTogglePositionLock={() => void run(() => hostBridge.toggleLockPosition(), 'toggle_position_lock', 2500)}
                isPositionLocked={snapshot.state.positionLocked}
                onAbout={() => void run(() => hostBridge.openExternal(GITHUB_REPO_URL), 'open_about', 3000)}
              />
              </>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
