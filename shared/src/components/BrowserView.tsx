import React, { useState } from 'react';
import { Tab } from '../App';
import { ChevronLeft, ChevronRight, RotateCw, Plus, X, Lock, ChevronDown, Loader2, Globe } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import type { ChromeMetrics } from '../lib/chromeMetrics';
import { chromeCssVars } from '../lib/chromeMetrics';

type UILang = 'zh' | 'en';

interface BrowserViewProps {
  tab: Tab;
  tabs: Tab[];
  onNavigate: (url: string) => void;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabAdd: () => void;
  isSidebarOpen: boolean;
  onTabsReorder: (tabs: Tab[]) => void;
  onNavigateHistory: (index: number) => void;
  onRefresh: () => void;
  lang: UILang;
  compact: boolean;
  /**
   * Toolbar + strip sizing for the current window width. Every dimension in
   * the bar is read off this (see `chromeMetrics.ts`) so the chrome scales as
   * one unit; the page's top inset uses the same `height`.
   */
  chrome: ChromeMetrics;
  /** Effective home address (built-in page or a user-chosen one). */
  startPageUrl: string;
  /**
   * Frameless window. Decorated, Windows drags the window by its title bar;
   * frameless there is no title bar, so the chrome bar itself has to hand
   * presses to the OS or the window cannot be moved at all.
   */
  borderless: boolean;
  onStartDrag: () => void;
}

const TEXT = {
  zh: {
    goBack: '\u540e\u9000',
    showHistory: '\u663e\u793a\u5386\u53f2',
    goForward: '\u524d\u8fdb',
    refresh: '\u5237\u65b0',
    placeholder: '\u8f93\u5165\u7f51\u5740\u540e\u6309\u56de\u8f66\u8bbf\u95ee',
    startTab: '\u8d77\u59cb\u9875'
  },
  en: {
    goBack: 'Go Back',
    showHistory: 'Show History',
    goForward: 'Go Forward',
    refresh: 'Refresh',
    placeholder: 'Type a URL and press Enter',
    startTab: 'Start Page'
  }
} as const;

/**
 * The start page is configurable now (built-in, or any address the user set),
 * so "is this the home tab" can no longer be a hard-coded substring. The host
 * hands the effective home URL in; the address bar goes blank and the tab gets
 * the start-page glyph on exactly that page.
 */
function normalizePageUrl(url: string): string {
  const trimmed = String(url || '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function isStartPageUrl(url: string, startPageUrl?: string): boolean {
  const normalized = normalizePageUrl(url);
  if (!normalized) return false;
  if (startPageUrl && normalized === normalizePageUrl(startPageUrl)) return true;
  // Legacy homes: the built-in page (whatever it was recorded as) and the
  // limestart.cn home earlier builds shipped. The host normalises both onto the
  // current home URL, so this only ever matches a tab that really is home.
  return normalized.includes('/lucid-start-page/index.html') || normalized.includes('limestart.cn');
}

function StartPageGlyph() {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[var(--chrome-favicon)] w-[var(--chrome-favicon)] shrink-0 rounded-sm text-slate-600 dark:text-slate-300">
      <rect x="10" y="10" width="80" height="80" rx="18" fill="currentColor" fillOpacity="0.2" />
      <rect x="22" y="22" width="56" height="56" rx="12" fill="currentColor" fillOpacity="0.5" />
      <path d="M35 38h30M35 50h30M35 62h18" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function getFaviconUrl(url: string, startPageUrl?: string): string | null {
  if (isStartPageUrl(url, startPageUrl)) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return null;
  }
}

export function BrowserView({ tab, tabs, onNavigate, onTabSelect, onTabClose, onTabAdd, isSidebarOpen, onTabsReorder, onNavigateHistory, onRefresh, lang, compact, chrome, startPageUrl, borderless, onStartDrag }: BrowserViewProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingTabId, setLoadingTabId] = useState<string | null>(null);
  const t = TEXT[lang];
  // The bar's own numbers live in `chromeMetrics.ts`; here they are published
  // as custom properties so every arbitrary-value utility in this tree reads a
  // single source instead of repeating the px.
  const chromeStyle = chromeCssVars(chrome) as React.CSSProperties;
  const addressIcon = Math.max(11, Math.round(chrome.address * 0.39));

  React.useEffect(() => {
    const next = isStartPageUrl(tab.url, startPageUrl) ? '' : tab.url;
    setInputUrl(next);
    setIsRefreshing(false);
    setLoadingTabId(null);
  }, [tab.url, tab.id, startPageUrl]);

  const pulseRefreshing = () => {
    setIsRefreshing(true);
    window.setTimeout(() => setIsRefreshing(false), 900);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // Typing a word used to become `https://天气` - a host name that parses
    // nowhere, so the tab ended up on the error page and the address bar looked
    // dead. Anything that is not host-shaped is a search; the host applies the
    // same rule, this copy keeps the two backends behaving identically.
    const typed = inputUrl.trim();
    if (!typed) return;

    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed);
    const looksLikeSearch =
      /\s/.test(typed) ||
      /[^\x00-\x7F]/.test(typed) ||
      (!typed.includes('.') && !typed.includes(':') && !typed.includes('/'));

    const finalUrl = hasScheme
      ? typed
      : looksLikeSearch
        ? `https://www.bing.com/search?q=${encodeURIComponent(typed)}`
        : `https://${typed}`;

    setLoadingTabId(tab.id);
    pulseRefreshing();
    onNavigate(finalUrl);
  };

  const handleRefresh = () => {
    setLoadingTabId(tab.id);
    pulseRefreshing();
    window.setTimeout(() => setLoadingTabId(null), 1200);
    onRefresh();
  };

  /**
   * Frameless window: the chrome bar stands in for the title bar.
   *
   * Only presses on the bar's own surface are forwarded — a press that starts
   * on a button, the address input or a tab belongs to that control, and a tab
   * drag has to stay a tab reorder. Everything else starts a native window
   * drag, which is the only way to move a window that has no title bar.
   */
  const handleBarMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (!borderless || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a, textarea, select, [data-no-drag]')) return;
    event.preventDefault();
    onStartDrag();
  };

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-transparent pointer-events-none" style={chromeStyle}>
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.14, ease: 'easeOut' } }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="pointer-events-none relative z-[2147483647] flex shrink-0 flex-col overflow-hidden"
          >
            {/* No opaque backdrop: the bar's own children carry the surface, so
                collapsing (or expanding) can never leave a white strip behind. */}
            <div
              onMouseDown={handleBarMouseDown}
              className={`chrome-surface pointer-events-auto relative z-20 flex h-[var(--chrome-toolbar)] shrink-0 items-center border-b border-chrome-line bg-chrome shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors duration-300 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${compact ? 'gap-2 px-2.5' : 'gap-4 px-4'}`}
            >
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <div className="relative flex items-center group">
                  <button
                    type="button"
                    className={`rounded-full p-1.5 transition-colors ${tab.historyIndex > 0 ? 'text-slate-700 hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10' : 'cursor-not-allowed text-slate-500 opacity-50'}`}
                    onClick={() => tab.historyIndex > 0 && onNavigateHistory(tab.historyIndex - 1)}
                    title={t.goBack}
                  >
                    <ChevronLeft size={chrome.icon} />
                  </button>

                  {tab.history?.length > 1 && (
                    <button
                      type="button"
                      className="-ml-1 rounded-full p-0.5 text-slate-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                      title={t.showHistory}
                    >
                      <ChevronDown size={chrome.close} />
                    </button>
                  )}

                  <AnimatePresence>
                    {isHistoryOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsHistoryOpen(false)} />
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200/50 bg-white/90 py-1 shadow-xl backdrop-blur-xl dark:border-zinc-700/50 dark:bg-zinc-900/90"
                        >
                          <div className="max-h-64 overflow-y-auto scrollbar-hide">
                            {[...(tab.history ?? [])].map((hUrl, i) => (
                              <button
                                key={`${hUrl}-${i}`}
                                type="button"
                                onClick={() => {
                                  setLoadingTabId(tab.id);
                                  onNavigateHistory(i);
                                  setIsHistoryOpen(false);
                                }}
                                className={`w-full truncate px-4 py-2 text-left text-[13px] transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${i === tab.historyIndex ? 'font-semibold text-teal-500' : 'text-slate-700 dark:text-slate-300'}`}
                              >
                                {hUrl}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  type="button"
                  className={`rounded-full p-1.5 transition-colors ${tab.historyIndex < (tab.history?.length || 0) - 1 ? 'text-slate-700 hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10' : 'cursor-not-allowed text-slate-500 opacity-50'}`}
                  onClick={() => {
                    if (tab.historyIndex < (tab.history?.length || 0) - 1) {
                      setLoadingTabId(tab.id);
                      onNavigateHistory(tab.historyIndex + 1);
                    }
                  }}
                  title={t.goForward}
                >
                  <ChevronRight size={chrome.icon} />
                </button>
                <button
                  type="button"
                  className="rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={handleRefresh}
                  title={t.refresh}
                >
                  <RotateCw size={chrome.iconSm} className={isRefreshing ? 'animate-spin text-teal-500' : ''} />
                </button>
              </div>

              <div className="mx-auto flex h-[var(--chrome-address)] max-w-2xl flex-1 items-center rounded-xl border border-slate-200/60 bg-slate-100/92 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(15,23,42,0.10)] transition-all focus-within:ring-2 focus-within:ring-teal-500/50 dark:border-zinc-700/60 dark:bg-zinc-900/70 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.45)]">
                <Lock size={addressIcon} className="mr-2 shrink-0 text-slate-400" />
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 border-none bg-transparent text-[length:var(--chrome-label)] text-slate-500 outline-none placeholder-slate-400 dark:text-slate-300"
                  placeholder={t.placeholder}
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLoadingTabId(tab.id);
                    onTabAdd();
                    window.setTimeout(() => setLoadingTabId(null), 1200);
                  }}
                  className="rounded-full p-1.5 text-slate-500 transition-colors hover:bg-black/5 dark:text-slate-400 dark:hover:bg-white/10"
                >
                  <Plus size={chrome.icon} />
                </button>
              </div>
            </div>

            <Reorder.Group
              axis="x"
              values={tabs}
              onReorder={onTabsReorder}
              onMouseDown={handleBarMouseDown}
              className="pointer-events-auto relative z-20 flex h-[var(--chrome-strip)] shrink-0 items-center gap-[3px] overflow-x-auto border-b border-chrome-line bg-chrome-strip px-1.5 transition-colors duration-300 scrollbar-hide"
            >
              {tabs.map((tTab) => {
                const favicon = getFaviconUrl(tTab.url, startPageUrl);
                const isLoading = loadingTabId === tTab.id || (isRefreshing && tTab.id === tab.id);
                const isStart = isStartPageUrl(tTab.url, startPageUrl);
                const displayTitle = isStart ? t.startTab : tTab.title;
                return (
                  <Reorder.Item
                    key={tTab.id}
                    value={tTab}
                    data-no-drag
                    onClick={() => {
                      // Switching is a show/hide of a live webview now, not a
                      // navigation: no spinner, no reload, state is preserved.
                      onTabSelect(tTab.id);
                    }}
                    className={`group flex h-[var(--chrome-tab-h)] cursor-pointer select-none items-center gap-1.5 rounded-[7px] border text-[length:var(--chrome-label)] transition-colors ${
                      compact
                        ? 'min-w-[calc(var(--chrome-tab-min)_-_8px)] max-w-[calc(var(--chrome-tab-max)_-_24px)] px-1.5'
                        : 'min-w-[var(--chrome-tab-min)] max-w-[var(--chrome-tab-max)] px-2'
                    } ${
                      // Flat, like the strip's own rules: one hairline in the
                      // same colour as every other chrome border, no ring, no
                      // drop shadow. The pill used to carry a 1px ring plus a
                      // 1px shadow, which read as a raised keycap against a
                      // flat toolbar. Every tab carries a transparent border
                      // so colouring it on activation cannot shift the content
                      // by a pixel.
                      tTab.id === tab.id
                        ? 'border-chrome-line bg-tab-active font-medium text-slate-900 dark:text-white'
                        : 'border-transparent font-normal text-tab-idle hover:bg-black/[0.045] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 size={chrome.favicon} className="shrink-0 animate-spin text-teal-500" />
                    ) : isStart ? (
                      <StartPageGlyph />
                    ) : favicon ? (
                      <img src={favicon} alt="" className="h-[var(--chrome-favicon)] w-[var(--chrome-favicon)] shrink-0 rounded-sm" />
                    ) : (
                      <Globe size={chrome.favicon} className="shrink-0 text-slate-400" />
                    )}

                    <span className="pointer-events-none flex-1 truncate">{displayTitle}</span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTabClose(tTab.id);
                      }}
                      className={`rounded-[5px] p-0.5 transition-opacity hover:bg-black/[0.08] dark:hover:bg-white/10 ${
                        tTab.id === tab.id ? 'opacity-50 hover:opacity-90' : 'opacity-0 group-hover:opacity-60'
                      }`}
                    >
                      <X size={chrome.close} />
                    </button>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none flex-1 bg-transparent" />
    </div>
  );
}
