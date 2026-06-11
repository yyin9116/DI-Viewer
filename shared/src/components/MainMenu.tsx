import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Moon,
  Sun,
  Droplet,
  Monitor,
  Layout,
  Keyboard,
  Info,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Save,
  RotateCcw,
  Globe,
  MousePointer2,
  Lock
} from 'lucide-react';
import type { HotkeyConfig } from '../types';

type UILang = 'zh' | 'en';
type MenuView = 'main' | 'shortcuts' | 'windowPresets';

interface MainMenuProps {
  onClose: () => void;
  opacity: number;
  setOpacity: (val: number) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onToggleSidebar: () => void;
  onQuit: () => void;
  hotkeys: HotkeyConfig;
  onSaveHotkeys: (config: HotkeyConfig) => void;
  onResetHotkeys: () => void;
  lang: UILang;
  onLangChange: (lang: UILang) => void;
  onResizeRatio: (ratio: number) => void;
  onToggleInsideMode: () => void;
  isInsideMode: boolean;
  onTogglePositionLock: () => void;
  isPositionLocked: boolean;
  onAbout: () => void;
}

const TEXT = {
  zh: {
    settings: '\u8bbe\u7f6e',
    shortcuts: '\u5feb\u6377\u952e',
    windowOpacity: '\u7a97\u53e3\u900f\u660e\u5ea6',
    darkMode: '\u591c\u95f4\u6a21\u5f0f',
    language: '\u8bed\u8a00',
    windowPreset: '\u7a97\u53e3\u9884\u8bbe',
    windowPresetOptions: '\u7a97\u53e3\u9884\u8bbe\u9009\u9879',
    presetHalf: '1/2 \u5c4f\u5e55',
    presetThird: '1/3 \u5c4f\u5e55',
    presetTwoThirds: '2/3 \u5c4f\u5e55',
    presetThreeQuarters: '3/4 \u5c4f\u5e55',
    sidebarMode: '\u4fa7\u8fb9\u680f\u6298\u53e0/\u5c55\u5f00',
    insideMode: '\u7a7f\u900f\u6a21\u5f0f',
    positionLock: '\u9501\u5b9a\u7a97\u53e3\u4f4d\u7f6e',
    about: '\u5173\u4e8e DI-Viewer',
    quit: '\u9000\u51fa DI-Viewer',
    back: '\u8fd4\u56de',
    reset: '\u91cd\u7f6e',
    save: '\u4fdd\u5b58',
    recording: '\u5f55\u5236\u4e2d...',
    startRecord: '\u5f55\u5236',
    recordingHint: '\u70b9\u51fb\u5f55\u5236\u540e\u6309\u7ec4\u5408\u952e\uff0cEsc \u53d6\u6d88',
    keyPlaceholder: '\u6309\u952e',
    zh: '\u4e2d\u6587',
    en: 'English',
    hotkey: {
      togglePlayPause: '\u64ad\u653e/\u6682\u505c',
      toggleRecording: '\u5f00\u59cb/\u505c\u6b62\u5f55\u5236',
      toggleShowHide: '\u663e\u793a/\u9690\u85cf',
      insideMode: '\u7a7f\u900f\u6a21\u5f0f',
      videoBackward: '\u540e\u9000\u89c6\u9891',
      videoForward: '\u524d\u8fdb\u89c6\u9891',
      decreaseOpacity: '\u964d\u4f4e\u900f\u660e\u5ea6',
      increaseOpacity: '\u63d0\u9ad8\u900f\u660e\u5ea6',
      requestFullScreen: '\u8bf7\u6c42\u5168\u5c4f',
      closeWindow: '\u5173\u95ed\u7a97\u53e3'
    }
  },
  en: {
    settings: 'Settings',
    shortcuts: 'Shortcuts',
    windowOpacity: 'Window Opacity',
    darkMode: 'Dark Mode',
    language: 'Language',
    windowPreset: 'Window Presets',
    windowPresetOptions: 'Window Preset Options',
    presetHalf: '1/2 Screen',
    presetThird: '1/3 Screen',
    presetTwoThirds: '2/3 Screen',
    presetThreeQuarters: '3/4 Screen',
    sidebarMode: 'Sidebar Collapse/Expand',
    insideMode: 'Click-through Mode',
    positionLock: 'Lock Window Position',
    about: 'About DI-Viewer',
    quit: 'Quit DI-Viewer',
    back: 'Back',
    reset: 'Reset',
    save: 'Save',
    recording: 'Recording...',
    startRecord: 'Record',
    recordingHint: 'Click record then press keys, Esc to cancel',
    keyPlaceholder: 'Shortcut',
    zh: 'Chinese',
    en: 'English',
    hotkey: {
      togglePlayPause: 'Play/Pause',
      toggleRecording: 'Start/Stop Recording',
      toggleShowHide: 'Show/Hide',
      insideMode: 'Click-through',
      videoBackward: 'Video Backward',
      videoForward: 'Video Forward',
      decreaseOpacity: 'Decrease Opacity',
      increaseOpacity: 'Increase Opacity',
      requestFullScreen: 'Request Fullscreen',
      closeWindow: 'Close App'
    }
  }
} as const;

const hotkeyKeys: Array<keyof HotkeyConfig> = [
  'togglePlayPause',
  'toggleRecording',
  'toggleShowHide',
  'insideMode',
  'videoBackward',
  'videoForward',
  'decreaseOpacity',
  'increaseOpacity',
  'requestFullScreen',
  'closeWindow'
];


const MODIFIER_NAMES = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function normalizeRecordedKey(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (event.code === 'Backquote') return 'Backquote';
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);

  const key = String(event.key || '').trim();
  if (!key) return null;
  if (MODIFIER_NAMES.has(key)) return null;
  if (key === '`') return 'Backquote';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  if (key === 'Esc') return 'Escape';
  return key;
}

function composeHotkey(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  const main = normalizeRecordedKey(event);
  if (!main) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(main);
  return parts.join('+');
}

const WINDOW_PRESETS: Array<{ ratio: number; key: 'presetHalf' | 'presetThird' | 'presetTwoThirds' | 'presetThreeQuarters' }> = [
  { ratio: 0.5, key: 'presetHalf' },
  { ratio: 1 / 3, key: 'presetThird' },
  { ratio: 2 / 3, key: 'presetTwoThirds' },
  { ratio: 0.75, key: 'presetThreeQuarters' }
];

export function MainMenu({
  onClose,
  opacity,
  setOpacity,
  isDarkMode,
  onToggleDarkMode,
  onToggleSidebar,
  onQuit,
  hotkeys,
  onSaveHotkeys,
  onResetHotkeys,
  lang,
  onLangChange,
  onResizeRatio,
  onToggleInsideMode,
  isInsideMode,
  onTogglePositionLock,
  isPositionLocked,
  onAbout
}: MainMenuProps) {
  const [view, setView] = useState<MenuView>('main');
  const [editingHotkeys, setEditingHotkeys] = useState<HotkeyConfig>(hotkeys);
  const [recordingKey, setRecordingKey] = useState<keyof HotkeyConfig | null>(null);
  const inputRefs = useRef<Partial<Record<keyof HotkeyConfig, HTMLInputElement | null>>>({});
  const t = TEXT[lang];

  useEffect(() => {
    setEditingHotkeys(hotkeys);
    setRecordingKey(null);
  }, [hotkeys]);

  const hasChanges = useMemo(() => JSON.stringify(editingHotkeys) !== JSON.stringify(hotkeys), [editingHotkeys, hotkeys]);

  const startRecording = (key: keyof HotkeyConfig) => {
    setRecordingKey(key);
    window.setTimeout(() => inputRefs.current[key]?.focus(), 0);
  };

  const handleRecordKeyDown = (key: keyof HotkeyConfig, event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecordingKey(null);
      return;
    }

    const next = composeHotkey(event);
    if (!next) return;

    setEditingHotkeys((prev) => ({ ...prev, [key]: next }));
    setRecordingKey(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="absolute bottom-6 left-24 z-[2147483647] flex w-80 flex-col overflow-hidden rounded-[32px] border border-white/40 bg-white/80 shadow-2xl shadow-black/20 backdrop-blur-3xl pointer-events-auto dark:border-white/10 dark:bg-zinc-900/80"
    >
      <AnimatePresence mode="wait">
        {view === 'main' ? (
          <motion.div
            key="main"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex max-h-[60vh] flex-col"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-6 py-5 dark:border-white/5">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t.settings}</h2>
              <button
                onClick={onClose}
                className="rounded-full bg-black/5 p-2 transition-colors hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
                type="button"
              >
                <X size={18} className="text-slate-600 dark:text-slate-300" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-4 scrollbar-hide">
              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-zinc-700/50 dark:bg-zinc-800/50">
                <div className="mb-3 flex items-center gap-3 font-medium text-slate-700 dark:text-slate-200">
                  <Droplet size={18} className="text-teal-500" />
                  <span>{t.windowOpacity}</span>
                  <span className="ml-auto text-sm text-slate-400">{opacity}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={opacity}
                  onChange={(e) => setOpacity(parseInt(e.target.value, 10))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-teal-500 dark:bg-zinc-700"
                />
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-zinc-700/50 dark:bg-zinc-800/50">
                <MenuItem
                  icon={isDarkMode ? <Moon size={18} /> : <Sun size={18} />}
                  label={t.darkMode}
                  toggle
                  isToggled={isDarkMode}
                  onClick={onToggleDarkMode}
                />
                <MenuItem icon={<Monitor size={18} />} label={t.windowPreset} onClick={() => setView('windowPresets')} />
                <MenuItem icon={<Layout size={18} />} label={t.sidebarMode} onClick={onToggleSidebar} />
                <MenuItem icon={<MousePointer2 size={18} />} label={t.insideMode} toggle isToggled={isInsideMode} onClick={onToggleInsideMode} />
                <MenuItem icon={<Lock size={18} />} label={t.positionLock} toggle isToggled={isPositionLocked} onClick={onTogglePositionLock} />
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-zinc-700/50 dark:bg-zinc-800/50">
                <MenuItem icon={<Globe size={18} />} label={`${t.language}: ${lang === 'zh' ? t.zh : t.en}`} onClick={() => onLangChange(lang === 'zh' ? 'en' : 'zh')} />
                <MenuItem icon={<Keyboard size={18} />} label={t.shortcuts} onClick={() => setView('shortcuts')} />
                <MenuItem icon={<Info size={18} />} label={t.about} onClick={onAbout} />
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-zinc-700/50 dark:bg-zinc-800/50">
                <button className="w-full px-4 py-3.5 text-left font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10" type="button" onClick={onQuit}>
                  <span className="flex items-center gap-3">
                    <LogOut size={18} />
                    <span>{t.quit}</span>
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        ) : view === 'shortcuts' ? (
          <motion.div
            key="shortcuts"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="flex max-h-[60vh] flex-col"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-black/5 px-4 py-5 dark:border-white/5">
              <button
                onClick={() => setView('main')}
                className="-ml-2 rounded-full bg-transparent p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                type="button"
                title={t.back}
              >
                <ChevronLeft size={20} className="text-slate-600 dark:text-slate-300" />
              </button>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t.shortcuts}</h2>
            </div>

            <div className="space-y-3 overflow-y-auto p-4 scrollbar-hide">
              {hotkeyKeys.map((key) => {
                const isRecording = recordingKey === key;
                return (
                  <div key={key} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 dark:border-zinc-700/50 dark:bg-zinc-800/50">
                    <span className="w-32 shrink-0 text-xs text-slate-500 dark:text-slate-400">{t.hotkey[key]}</span>
                    <input
                      ref={(node) => {
                        inputRefs.current[key] = node;
                      }}
                      value={editingHotkeys[key]}
                      readOnly
                      onFocus={() => setRecordingKey(key)}
                      onBlur={() => setRecordingKey((current) => (current === key ? null : current))}
                      onKeyDown={(event) => handleRecordKeyDown(key, event)}
                      className={`flex-1 rounded-lg border px-2.5 py-1.5 font-mono text-sm outline-none transition-colors ${isRecording
                        ? 'border-teal-400 bg-teal-50/70 text-teal-700 ring-2 ring-teal-500/30 dark:border-teal-500/70 dark:bg-teal-500/10 dark:text-teal-200'
                        : 'border-slate-200 bg-slate-50 text-slate-600 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/30 dark:border-zinc-600 dark:bg-zinc-800 dark:text-slate-300'
                      }`}
                      placeholder={t.keyPlaceholder}
                    />
                    <button
                      type="button"
                      onClick={() => startRecording(key)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${isRecording
                        ? 'bg-teal-500 text-white'
                        : 'border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-zinc-600 dark:text-slate-300 dark:hover:bg-zinc-700/60'
                      }`}
                    >
                      {isRecording ? t.recording : t.startRecord}
                    </button>
                  </div>
                );
              })}
              <div className="px-1 text-xs text-slate-400 dark:text-slate-500">{t.recordingHint}</div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/5 px-4 py-3 dark:border-white/5">
              <button
                type="button"
                onClick={onResetHotkeys}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 dark:border-zinc-600 dark:text-slate-300 dark:hover:bg-zinc-700/50"
              >
                <RotateCcw size={14} /> {t.reset}
              </button>
              <button
                type="button"
                disabled={!hasChanges}
                onClick={() => onSaveHotkeys(editingHotkeys)}
                className="inline-flex items-center gap-1 rounded-lg bg-teal-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-teal-300"
              >
                <Save size={14} /> {t.save}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="window-presets"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            className="flex max-h-[60vh] flex-col"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-black/5 px-4 py-5 dark:border-white/5">
              <button
                onClick={() => setView('main')}
                className="-ml-2 rounded-full bg-transparent p-2 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                type="button"
                title={t.back}
              >
                <ChevronLeft size={20} className="text-slate-600 dark:text-slate-300" />
              </button>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t.windowPresetOptions}</h2>
            </div>

            <div className="space-y-4 overflow-y-auto p-4 scrollbar-hide">
              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm dark:border-zinc-700/50 dark:bg-zinc-800/50">
                {WINDOW_PRESETS.map((preset) => (
                  <MenuItem
                    key={preset.key}
                    icon={<Monitor size={18} />}
                    label={t[preset.key]}
                    onClick={() => onResizeRatio(preset.ratio)}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  toggle?: boolean;
  isToggled?: boolean;
  onClick?: () => void;
}

function MenuItem({ icon, label, toggle, isToggled, onClick }: MenuItemProps) {
  return (
    <button onClick={onClick} className="group last:border-0 flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left text-slate-700 transition-colors hover:bg-slate-50 dark:border-zinc-700/50 dark:text-slate-200 dark:hover:bg-zinc-700/50" type="button">
      <span className="text-slate-400 transition-colors group-hover:text-teal-500">
        {icon}
      </span>
      <span className="flex-1 font-medium">{label}</span>

      {toggle ? (
        <div className={`relative h-6 w-11 rounded-full shadow-inner transition-colors ${isToggled ? 'bg-teal-500' : 'bg-slate-200 dark:bg-zinc-600'}`}>
          <div className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isToggled ? 'translate-x-5' : 'translate-x-0'}`} />
        </div>
      ) : (
        <ChevronRight size={16} className="text-slate-300 transition-transform group-hover:translate-x-0.5 dark:text-slate-500" />
      )}
    </button>
  );
}
