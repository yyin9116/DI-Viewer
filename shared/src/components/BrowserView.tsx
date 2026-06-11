import React, { useState } from 'react';
import { Tab } from '../App';
import { ChevronLeft, ChevronRight, RotateCw, Plus, X, Lock, ChevronDown, Loader2, Globe } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';

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

function isStartPageUrl(url: string): boolean {
  const raw = String(url || '').toLowerCase();
  return raw.includes('/lucid-start-page/index.html') || raw.includes('limestart.cn');
}

function StartPageGlyph() {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 rounded-sm text-slate-600 dark:text-slate-300">
      <rect x="10" y="10" width="80" height="80" rx="18" fill="currentColor" fillOpacity="0.2" />
      <rect x="22" y="22" width="56" height="56" rx="12" fill="currentColor" fillOpacity="0.5" />
      <path d="M35 38h30M35 50h30M35 62h18" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

function getFaviconUrl(url: string): string | null {
  if (isStartPageUrl(url)) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return null;
  }
}

export function BrowserView({ tab, tabs, onNavigate, onTabSelect, onTabClose, onTabAdd, isSidebarOpen, onTabsReorder, onNavigateHistory, onRefresh, lang }: BrowserViewProps) {
  const [inputUrl, setInputUrl] = useState('');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingTabId, setLoadingTabId] = useState<string | null>(null);
  const t = TEXT[lang];

  React.useEffect(() => {
    const next = isStartPageUrl(tab.url) ? '' : tab.url;
    setInputUrl(next);
    setIsRefreshing(false);
    setLoadingTabId(null);
  }, [tab.url, tab.id]);

  const pulseRefreshing = () => {
    setIsRefreshing(true);
    window.setTimeout(() => setIsRefreshing(false), 900);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const typed = inputUrl.trim();
    if (!typed) return;

    let finalUrl = typed;
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://') && !finalUrl.startsWith('file://')) {
      finalUrl = `https://${finalUrl}`;
    }
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

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-transparent pointer-events-none">
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="pointer-events-none relative z-[2147483647] flex shrink-0 flex-col overflow-hidden"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[98px] bg-white dark:bg-black" />
            <div className="pointer-events-auto relative z-20 flex h-14 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 dark:border-zinc-800 dark:bg-black">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <div className="relative flex items-center group">
                  <button
                    type="button"
                    className={`rounded-full p-1.5 transition-colors ${tab.historyIndex > 0 ? 'text-slate-700 hover:bg-black/5 dark:text-slate-200 dark:hover:bg-white/10' : 'cursor-not-allowed text-slate-500 opacity-50'}`}
                    onClick={() => tab.historyIndex > 0 && onNavigateHistory(tab.historyIndex - 1)}
                    title={t.goBack}
                  >
                    <ChevronLeft size={20} />
                  </button>

                  {tab.history?.length > 1 && (
                    <button
                      type="button"
                      className="-ml-1 rounded-full p-0.5 text-slate-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                      title={t.showHistory}
                    >
                      <ChevronDown size={12} />
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
                                className={`w-full truncate px-4 py-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${i === tab.historyIndex ? 'font-semibold text-teal-500' : 'text-slate-700 dark:text-slate-300'}`}
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
                  <ChevronRight size={20} />
                </button>
                <button
                  type="button"
                  className="rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={handleRefresh}
                  title={t.refresh}
                >
                  <RotateCw size={18} className={isRefreshing ? 'animate-spin text-teal-500' : ''} />
                </button>
              </div>

              <div className="mx-auto flex h-9 max-w-2xl flex-1 items-center rounded-xl border border-slate-200/60 bg-slate-100/92 px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_1px_2px_rgba(15,23,42,0.10)] transition-all focus-within:ring-2 focus-within:ring-teal-500/50 dark:border-zinc-700/60 dark:bg-zinc-900/70 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.45)]">
                <Lock size={14} className="mr-2 shrink-0 text-slate-400" />
                <input
                  type="text"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 border-none bg-transparent font-mono text-sm text-slate-500 outline-none placeholder-slate-400 dark:text-slate-300"
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
                  <Plus size={20} />
                </button>
              </div>
            </div>

            <Reorder.Group
              axis="x"
              values={tabs}
              onReorder={onTabsReorder}
              className="pointer-events-auto relative z-20 flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-1.5 shadow-[0_1px_0_rgba(226,232,240,0.95)] scrollbar-hide dark:border-zinc-800 dark:bg-black dark:shadow-[0_1px_0_rgba(39,39,42,0.95)]"
            >
              {tabs.map((tTab) => {
                const favicon = getFaviconUrl(tTab.url);
                const isLoading = loadingTabId === tTab.id || (isRefreshing && tTab.id === tab.id);
                const isStart = isStartPageUrl(tTab.url);
                const displayTitle = isStart ? t.startTab : tTab.title;
                return (
                  <Reorder.Item
                    key={tTab.id}
                    value={tTab}
                    onClick={() => {
                      setLoadingTabId(tTab.id);
                      onTabSelect(tTab.id);
                      window.setTimeout(() => setLoadingTabId(null), 1200);
                    }}
                    className={`group flex min-w-[140px] max-w-[220px] cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                      tTab.id === tab.id
                        ? 'border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white'
                        : 'text-slate-500 hover:bg-slate-200/50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 size={14} className="shrink-0 animate-spin text-teal-500" />
                    ) : isStart ? (
                      <StartPageGlyph />
                    ) : favicon ? (
                      <img src={favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                    ) : (
                      <Globe size={14} className="shrink-0 text-slate-400" />
                    )}

                    <span className="pointer-events-none flex-1 truncate">{displayTitle}</span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTabClose(tTab.id);
                      }}
                      className="rounded-full p-0.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10"
                    >
                      <X size={12} />
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
