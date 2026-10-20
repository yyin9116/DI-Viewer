import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Moon,
  Sun,
  Layout,
  Keyboard,
  Info,
  LogOut,
  ChevronRight,
  Save,
  RotateCcw,
  Globe,
  MousePointer2,
  Lock,
  LifeBuoy,
  Pin,
  ShieldAlert,
  Check
} from 'lucide-react';
import type { HotkeyConfig } from '../types';
import { bindingHasModifier, bindingIsTypingSafe } from '../lib/inAppHotkeys';
import { useViewport } from '../lib/useViewport';

type UILang = 'zh' | 'en';
type MenuView = 'appearance' | 'window' | 'shortcuts' | 'recovery';

interface MainMenuProps {
  onClose: () => void;
  opacity: number;
  setOpacity: (val: number) => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  onToggleSidebar: () => void;
  onQuit: () => void;
  hotkeys: HotkeyConfig;
  /** `name=combo: reason` for bindings the OS refused (already owned by an app). */
  hotkeyConflicts: string[];
  onSaveHotkeys: (config: HotkeyConfig) => void;
  onResetHotkeys: () => void;
  lang: UILang;
  onLangChange: (lang: UILang) => void;
  onResizeRatio: (ratio: number, commit: boolean) => void;
  onToggleInsideMode: () => void;
  isInsideMode: boolean;
  onTogglePositionLock: () => void;
  isPositionLocked: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
  isSidebarVisible: boolean;
  hotkeysEnabled: boolean;
  onToggleHotkeysEnabled: (enabled: boolean) => void;
  onRescueWindow: () => void;
  onAbout: () => void;
}

/// Fixed by the backend: registered even when the global hotkey master switch
/// is off, and it also clears click-through, so it is the guaranteed way out of
/// a window that no longer accepts clicks.
const RESCUE_HOTKEY = 'Ctrl+Alt+Shift+R';

const TEXT = {
  zh: {
    settings: '设置',
    tabs: {
      appearance: '外观',
      window: '窗口',
      shortcuts: '快捷键',
      recovery: '恢复'
    },
    appearance: '外观',
    theme: '主题',
    light: '浅色',
    dark: '深色',
    language: '语言',
    zh: '中文',
    en: 'English',
    opacity: '界面透明度',
    opacityHint: `最低 20%。调低到看不清时，按 ${RESCUE_HOTKEY} 立刻找回窗口。`,
    windowSection: '窗口行为',
    pinned: '窗口置顶',
    pinnedHint: '其他窗口之上显示',
    insideMode: '点击穿透',
    // The hint names the way out, but the *key* is only knowable at runtime
    // (it is rebindable and the master switch can be off), so the combo is
    // rendered separately by `shortcut` rather than baked into this string.
    insideHint: '鼠标事件交给下层页面',
    exitWith: '退出',
    positionLock: '锁定位置',
    positionLockHint: '禁止拖动窗口',
    sidebar: '显示侧边栏',
    sidebarHint: '收起后左侧仅保留展开把手',
    presets: '窗口宽度',
    presetHalf: '1/2',
    presetThird: '1/3',
    presetTwoThirds: '2/3',
    presetThreeQuarters: '3/4',
    shortcuts: '快捷键',
    shortcutMaster: '启用全局快捷键',
    shortcutMasterHint: '关闭后只保留固定的找回快捷键，避免与输入法、游戏冲突',
    shortcutTable: '按键绑定',
    recording: '按下组合键…',
    record: '设置',
    cancel: 'Esc 取消',
    modifierRequired: '这个动作在窗口隐藏或穿透时也要能用，必须带修饰键',
    duplicate: '与上方绑定重复',
    scopeGlobal: '全局',
    scopeInApp: '应用内',
    scopeConflict: '被占用',
    scopeRequired: '需全局',
    conflictNote: '标「被占用」的组合已被别的程序抢走，系统会拒绝注册；换一个组合即可，不影响其他快捷键与启动。',
    scopeNote: '「应用内」= 只有本窗口激活时才生效；焦点在输入框、输入法正在拼写、或按着 Ctrl/Alt 时自动跳过，不会被系统抢走。',
    shortcutHint: '裸键（字母、数字、`）只在本应用内生效，不再注册成系统热键，因此不会打断任何程序的打字；需要「窗口隐藏/穿透时也能按」的动作保留 Ctrl+Alt 组合。',
    shortcutSaved: '已保存并重新注册',
    reset: '恢复默认',
    save: '保存',
    recovery: '恢复与退出',
    rescue: '找回窗口',
    rescuePrimary: '立即找回窗口',
    rescueHint: '把透明度恢复到 100%、关闭点击穿透、取消最小化，并在窗口离开所有显示器时重新居中。',
    rescueSteps: '三种进入方式',
    rescueHotkey: '固定快捷键',
    rescueHotkeyValue: RESCUE_HOTKEY,
    rescueAlways: '即使关闭了全局快捷键也生效',
    rescueTray: '托盘菜单 / 找回窗口',
    rescueRelaunch: '重新启动程序',
    rescueRelaunchHint: '启动时自动复位透明度、穿透与越界位置',
    footerVersion: '版本',
    about: '关于项目',
    quit: '退出 DI-Viewer',
    pin: '置顶'
  },
  en: {
    settings: 'Settings',
    tabs: {
      appearance: 'Look',
      window: 'Window',
      shortcuts: 'Keys',
      recovery: 'Recovery'
    },
    appearance: 'Appearance',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    language: 'Language',
    zh: '中文',
    en: 'English',
    opacity: 'Shell opacity',
    opacityHint: `Floor is 20%. If it gets too faint, press ${RESCUE_HOTKEY} to bring the window back.`,
    windowSection: 'Window behaviour',
    pinned: 'Always on top',
    pinnedHint: 'Float above other windows',
    insideMode: 'Click-through',
    insideHint: 'Mouse events go to the page below',
    exitWith: 'exit',
    positionLock: 'Lock position',
    positionLockHint: 'Dragging is disabled',
    sidebar: 'Show sidebar',
    sidebarHint: 'Collapsed leaves only the handle',
    presets: 'Window width',
    presetHalf: '1/2',
    presetThird: '1/3',
    presetTwoThirds: '2/3',
    presetThreeQuarters: '3/4',
    shortcuts: 'Shortcuts',
    shortcutMaster: 'Enable global shortcuts',
    shortcutMasterHint: 'Off keeps only the fixed rescue shortcut, so nothing fights your IME or games',
    shortcutTable: 'Bindings',
    recording: 'Press a combo…',
    record: 'Set',
    cancel: 'Esc to cancel',
    modifierRequired: 'This action must work while the window is hidden or click-through, so it needs a modifier',
    duplicate: 'Duplicate of a binding above',
    scopeGlobal: 'Global',
    scopeInApp: 'In-app',
    scopeConflict: 'In use',
    scopeRequired: 'Needs mod',
    conflictNote: 'A combo marked "In use" is already owned by another application, so Windows refuses to register it. Pick another combo — the remaining shortcuts and startup are unaffected.',
    scopeNote: 'In-app = only while this window is active. It is skipped while a text field has focus, while an IME composition is open, or while Ctrl/Alt is held — so nothing is stolen from other apps.',
    shortcutHint: 'Bare keys (letters, digits, `) stay inside the viewer and are never registered system-wide, so they cannot break typing elsewhere. Actions that must work while the window is hidden keep a Ctrl+Alt combo.',
    shortcutSaved: 'Saved and re-registered',
    reset: 'Reset',
    save: 'Save',
    recovery: 'Recovery & exit',
    rescue: 'Find the window',
    rescuePrimary: 'Bring the window back',
    rescueHint: 'Restores 100% opacity, turns click-through off, un-minimizes, and re-centers when the window is off every monitor.',
    rescueSteps: 'Three ways in',
    rescueHotkey: 'Fixed shortcut',
    rescueHotkeyValue: RESCUE_HOTKEY,
    rescueAlways: 'Works even with global shortcuts disabled',
    rescueTray: 'Tray menu / Restore Window',
    rescueRelaunch: 'Relaunch the app',
    rescueRelaunchHint: 'Startup resets opacity, click-through and off-screen geometry',
    footerVersion: 'Version',
    about: 'Project',
    quit: 'Quit DI-Viewer',
    pin: 'Pin'
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

const HOTKEY_LABELS: Record<UILang, Record<keyof HotkeyConfig, string>> = {
  zh: {
    togglePlayPause: '播放 / 暂停',
    toggleRecording: '开始 / 停止录制',
    toggleShowHide: '显示 / 隐藏窗口',
    insideMode: '点击穿透',
    videoBackward: '后退 5 秒',
    videoForward: '前进 5 秒',
    decreaseOpacity: '降低透明度',
    increaseOpacity: '提高透明度',
    requestFullScreen: '请求全屏',
    closeWindow: '退出程序'
  },
  en: {
    togglePlayPause: 'Play / pause',
    toggleRecording: 'Start / stop recording',
    toggleShowHide: 'Show / hide window',
    insideMode: 'Click-through',
    videoBackward: 'Back 5 seconds',
    videoForward: 'Forward 5 seconds',
    decreaseOpacity: 'Decrease opacity',
    increaseOpacity: 'Increase opacity',
    requestFullScreen: 'Request fullscreen',
    closeWindow: 'Quit app'
  }
};

const MODIFIER_NAMES = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function normalizeRecordedKey(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (event.code === 'Backquote') return 'Backquote';
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^F\d{1,2}$/.test(event.code)) return event.code;

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

/** Bindings that must keep working while another app is focused (or while the
 *  window is hidden / click-through), so they cannot be modifier-less. */
const GLOBAL_REQUIRED: Array<keyof HotkeyConfig> = ['toggleShowHide', 'insideMode', 'closeWindow'];

/** Render `Ctrl+Alt+R` as three discrete keycaps. */
function ComboKeys({ combo }: { combo: string }) {
  const parts = combo.split('+').filter(Boolean);
  if (!parts.length) {
    return <span className="text-[12px] text-[#5B6470] dark:text-zinc-400">—</span>;
  }
  return (
    <span className="flex items-center gap-1">
      {parts.map((part, index) => (
        <kbd
          key={`${part}-${index}`}
          className="rounded-md border border-[#D6DEEA] bg-white px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.06)] dark:border-zinc-700 dark:bg-zinc-900 dark:text-slate-200 dark:shadow-none"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

const RATIO_TICKS: Array<{ ratio: number; label: 'presetThird' | 'presetHalf' | 'presetTwoThirds' | 'presetThreeQuarters' }> = [
  { ratio: 1 / 3, label: 'presetThird' },
  { ratio: 0.5, label: 'presetHalf' },
  { ratio: 2 / 3, label: 'presetTwoThirds' },
  { ratio: 0.75, label: 'presetThreeQuarters' }
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
  hotkeyConflicts,
  onSaveHotkeys,
  onResetHotkeys,
  lang,
  onLangChange,
  onResizeRatio,
  onToggleInsideMode,
  isInsideMode,
  onTogglePositionLock,
  isPositionLocked,
  isPinned,
  onTogglePin,
  isSidebarVisible,
  hotkeysEnabled,
  onToggleHotkeysEnabled,
  onRescueWindow,
  onAbout
}: MainMenuProps) {
  const [view, setView] = useState<MenuView>('appearance');
  const [editingHotkeys, setEditingHotkeys] = useState<HotkeyConfig>(hotkeys);
  const [recordingKey, setRecordingKey] = useState<keyof HotkeyConfig | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const inputRefs = useRef<Partial<Record<keyof HotkeyConfig, HTMLInputElement | null>>>({});
  const t = TEXT[lang];
  const labels = HOTKEY_LABELS[lang];
  const viewport = useViewport();

  /*
   * Density follows window *height*, not width. The panel is a fixed 368px
   * column, so the 1/3 preset (853x480) has all the width it needs but less
   * than half the vertical room: the 窗口 tab overflowed its scroll body by
   * ~40px, and with the scrollbar hidden the half-cut last row read as a
   * rendering bug instead of "scroll for more". Tightening the vertical rhythm
   * is what lets the whole card fit untouched.
   */
  const dense = viewport.height < 560;

  useEffect(() => {
    setEditingHotkeys(hotkeys);
    setRecordingKey(null);
    setRecordError(null);
  }, [hotkeys]);

  /** Bindings the OS refused because another application already owns them.
   *  Shown per-row so a dead shortcut is never silently dead. */
  const conflictKeys = useMemo(() => {
    const set = new Set<string>();
    hotkeyConflicts.forEach((entry) => {
      const name = entry.split('=')[0]?.trim();
      if (name) set.add(name);
    });
    return set;
  }, [hotkeyConflicts]);

  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>();
    hotkeyKeys.forEach((key) => {
      const value = editingHotkeys[key]?.trim().toUpperCase();
      if (!value) return;
      seen.set(value, (seen.get(value) ?? 0) + 1);
    });
    return new Set(
      hotkeyKeys
        .map((key) => editingHotkeys[key]?.trim().toUpperCase())
        .filter((value) => Boolean(value) && (seen.get(value as string) ?? 0) > 1)
    );
  }, [editingHotkeys]);

  const hasChanges = useMemo(
    () => JSON.stringify(editingHotkeys) !== JSON.stringify(hotkeys),
    [editingHotkeys, hotkeys]
  );

  const startRecording = (key: keyof HotkeyConfig) => {
    setRecordError(null);
    setRecordingKey(key);
    window.setTimeout(() => inputRefs.current[key]?.focus(), 0);
  };

  const handleRecordKeyDown = (key: keyof HotkeyConfig, event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      setRecordingKey(null);
      setRecordError(null);
      return;
    }

    const next = composeHotkey(event);
    if (!next) return;
    if (!bindingIsTypingSafe(next) && GLOBAL_REQUIRED.includes(key)) {
      setRecordError(t.modifierRequired);
      return;
    }

    setEditingHotkeys((prev) => ({ ...prev, [key]: next }));
    setRecordingKey(null);
    setRecordError(null);
  };

  const tabs: Array<{ id: MenuView; label: string; icon: React.ReactNode }> = [
    { id: 'appearance', label: t.tabs.appearance, icon: <Sun size={13} /> },
    { id: 'window', label: t.tabs.window, icon: <Layout size={13} /> },
    { id: 'shortcuts', label: t.tabs.shortcuts, icon: <Keyboard size={13} /> },
    { id: 'recovery', label: t.tabs.recovery, icon: <LifeBuoy size={13} /> }
  ];

  // `calc(100vh-40px)` is not valid CSS: without spaces around the minus the
  // whole declaration is dropped, so the panel had no max height at all and ran
  // straight off the bottom of a 480px-tall window. Underscores are Tailwind's
  // way of writing those spaces. The dense variant also trims the bottom gap so
  // the panel can claim 24px more height.
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 12 }}
      transition={{ type: 'spring', damping: 30, stiffness: 340 }}
      style={
        {
          '--mm-row-h': dense ? '40px' : '44px',
          '--mm-row-y': dense ? '8px' : '10px'
        } as React.CSSProperties
      }
      className={`pointer-events-auto absolute left-24 z-[2147483647] flex w-[368px] flex-col overflow-hidden rounded-[26px] border border-[#D6DEEA] bg-[#F3F6FB] shadow-[0_24px_64px_-16px_rgba(15,23,42,0.28)] backdrop-blur-2xl dark:border-[#272727] dark:bg-[#0B0B0D] ${
        dense ? 'bottom-3 max-h-[calc(100vh_-_24px)]' : 'bottom-6 max-h-[calc(100vh_-_40px)]'
      }`}
    >
      {/* Header */}
      <div className={`flex shrink-0 items-start justify-between px-4 ${dense ? 'pt-3' : 'pt-4'}`}>
        <div>
          <h2
            className={`font-semibold text-[#1F2937] dark:text-white ${
              dense ? 'text-[18px] leading-[24px]' : 'text-[21px] leading-[28px]'
            }`}
          >
            {t.settings}
          </h2>
          <p className="mt-0.5 text-[11px] leading-4 text-[#5B6470] dark:text-zinc-400">
            {t.footerVersion} {__APP_VERSION__}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/[0.06] text-slate-600 transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20"
          type="button"
        >
          <X size={14} />
        </button>
      </div>

      {/* Segmented navigation */}
      <div
        className={`mx-4 flex shrink-0 gap-[2px] rounded-[10px] bg-black/[0.05] p-[3px] dark:bg-white/[0.06] ${
          dense ? 'mt-2' : 'mt-3'
        }`}
      >
        {tabs.map((tab) => {
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={`flex h-7 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg text-[12px] leading-none transition-colors ${
                active
                  ? 'bg-white font-semibold text-slate-900 dark:bg-zinc-800 dark:text-white'
                  : 'font-normal text-[#5B6470] hover:text-[#1F2937] dark:text-zinc-400 dark:hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className={`min-h-0 flex-1 overflow-y-auto scrollbar-hide ${dense ? 'px-3.5 py-3' : 'px-4 py-4'}`}>
        <AnimatePresence mode="wait" initial={false}>
          {view === 'appearance' && (
            <motion.div
              key="appearance"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className={dense ? 'space-y-2.5' : 'space-y-3.5'}
            >
              <Card>
                <Row label={t.theme}>
                  <Segmented
                    value={isDarkMode ? 'dark' : 'light'}
                    options={[
                      { id: 'light', label: t.light, icon: <Sun size={12} /> },
                      { id: 'dark', label: t.dark, icon: <Moon size={12} /> }
                    ]}
                    onChange={(next) => {
                      if ((next === 'dark') !== isDarkMode) onToggleDarkMode();
                    }}
                  />
                </Row>
                <Row label={t.language} last>
                  <Segmented
                    value={lang}
                    options={[
                      { id: 'zh', label: t.zh },
                      { id: 'en', label: t.en }
                    ]}
                    onChange={(next) => {
                      if (next !== lang) onLangChange(next as UILang);
                    }}
                  />
                </Row>
              </Card>

              <Card>
                <div className="px-3.5 pb-3.5 pt-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] text-[#1F2937] dark:text-zinc-100">
                      {t.opacity}
                    </span>
                    <span className="ml-auto font-mono text-[12px] tabular-nums text-[#5B6470] dark:text-zinc-400">
                      {opacity}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="100"
                    value={opacity}
                    onChange={(e) => setOpacity(parseInt(e.target.value, 10))}
                    className="mt-2.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-brand-700 dark:accent-brand-400 dark:bg-zinc-700"
                  />
                  <p className="mt-2 text-[12px] leading-[1.5] text-[#5B6470] dark:text-zinc-400">
                    {t.opacityHint}
                  </p>
                </div>
              </Card>
            </motion.div>
          )}

          {view === 'window' && (
            <motion.div
              key="window"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className={dense ? 'space-y-2.5' : 'space-y-3.5'}
            >
              <Card>
                <div className="px-3.5 pb-3 pt-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] text-[#1F2937] dark:text-zinc-100">
                      {t.presets}
                    </span>
                    <span className="ml-auto font-mono text-[12px] tabular-nums text-[#5B6470] dark:text-zinc-400">
                      {Math.round(viewport.width)} × {Math.round(viewport.height)}
                    </span>
                  </div>
                  <RatioBar lang={lang} viewportWidth={viewport.width} onResize={onResizeRatio} />
                </div>
              </Card>

              <Card>
                <SwitchRow
                  icon={<Pin size={15} />}
                  label={t.pinned}
                  hint={t.pinnedHint}
                  checked={isPinned}
                  onChange={onTogglePin}
                />
                <SwitchRow
                  icon={<MousePointer2 size={15} />}
                  label={t.insideMode}
                  hint={t.insideHint}
                  // Once this is on the panel can no longer be clicked, so the
                  // only way back has to be on screen. With the master switch
                  // off the configurable binding is not registered - the rescue
                  // key is, and it clears click-through too.
                  shortcutLabel={t.exitWith}
                  shortcut={hotkeysEnabled ? hotkeys.insideMode : RESCUE_HOTKEY}
                  checked={isInsideMode}
                  onChange={onToggleInsideMode}
                />
                <SwitchRow
                  icon={<Lock size={15} />}
                  label={t.positionLock}
                  hint={t.positionLockHint}
                  checked={isPositionLocked}
                  onChange={onTogglePositionLock}
                />
                <SwitchRow
                  icon={<Layout size={15} />}
                  label={t.sidebar}
                  hint={t.sidebarHint}
                  checked={isSidebarVisible}
                  onChange={onToggleSidebar}
                  last
                />
              </Card>
            </motion.div>
          )}

          {view === 'shortcuts' && (
            <motion.div
              key="shortcuts"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className={dense ? 'space-y-2.5' : 'space-y-3.5'}
            >
              <Card>
                <SwitchRow
                  icon={<Keyboard size={15} />}
                  label={t.shortcutMaster}
                  hint={t.shortcutMasterHint}
                  checked={hotkeysEnabled}
                  onChange={(next) => onToggleHotkeysEnabled(next)}
                  last
                />
              </Card>

              <Card>
                <div className="flex items-center justify-between border-b border-[#D6DEEA] px-3.5 py-2 dark:border-zinc-800">
                  <span className="text-[13px] font-semibold text-[#5B6470] dark:text-zinc-400">
                    {t.shortcutTable}
                  </span>
                  {recordError ? (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <ShieldAlert size={11} />
                      {recordError}
                    </span>
                  ) : (
                    <span className="text-[12px] text-[#5B6470] dark:text-zinc-400">{t.cancel}</span>
                  )}
                </div>
                <div className={hotkeysEnabled ? '' : 'pointer-events-none opacity-45'}>
                  {hotkeyKeys.map((key, index) => {
                    const isRecording = recordingKey === key;
                    const isDuplicate = duplicateKeys.has(editingHotkeys[key]?.trim().toUpperCase());
                    const isConflict = conflictKeys.has(key);
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-2 px-3 py-[7px] ${
                          index === hotkeyKeys.length - 1 ? '' : 'border-b border-slate-100 dark:border-zinc-800/80'
                        }`}
                      >
                        <span className="w-[92px] shrink-0">
                          <span className="block truncate text-[13px] leading-4 text-[#1F2937] dark:text-zinc-100">
                            {labels[key]}
                          </span>
                          <span
                            className={`mt-px block text-[12px] leading-4 ${
                              isConflict
                                ? 'text-rose-600 dark:text-rose-400'
                                : bindingHasModifier(editingHotkeys[key])
                                  ? 'text-[#5B6470] dark:text-zinc-400'
                                  : 'text-brand-700 dark:text-brand-300'
                            }`}
                          >
                            {isConflict
                              ? t.scopeConflict
                              : bindingHasModifier(editingHotkeys[key])
                                ? t.scopeGlobal
                                : t.scopeInApp}
                          </span>
                        </span>
                        <input
                          ref={(node) => {
                            inputRefs.current[key] = node;
                          }}
                          value={isRecording ? '' : editingHotkeys[key]}
                          readOnly
                          onFocus={() => setRecordingKey(key)}
                          onBlur={() => setRecordingKey((current) => (current === key ? null : current))}
                          onKeyDown={(event) => handleRecordKeyDown(key, event)}
                          placeholder={isRecording ? t.recording : ''}
                          className={`min-w-0 flex-1 rounded-md border px-1.5 py-1 font-mono text-[12px] tabular-nums outline-none transition-colors ${
                            isRecording
                              ? 'border-brand-400 bg-brand-500/10 text-brand-700 ring-2 ring-brand-500/20 dark:border-brand-500 dark:text-brand-300'
                              : isConflict
                                ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-600/60 dark:bg-rose-500/10 dark:text-rose-300'
                                : isDuplicate
                                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600/60 dark:bg-amber-500/10 dark:text-amber-300'
                                  : 'border-transparent bg-black/[0.04] text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => startRecording(key)}
                          className="shrink-0 rounded-md px-1.5 py-1 text-[12px] font-medium text-[#5B6470] transition-colors hover:bg-black/[0.04] hover:text-brand-700 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-brand-300"
                        >
                          {t.record}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <p className="px-1 text-[12px] leading-[1.6] text-[#5B6470] dark:text-zinc-400">{t.shortcutHint}</p>
              <p className="px-1 text-[12px] leading-[1.6] text-[#5B6470] dark:text-zinc-400">{t.scopeNote}</p>
              {hotkeyConflicts.length > 0 && (
                <p className="px-1 text-[12px] leading-[1.6] text-rose-600 dark:text-rose-400">
                  {t.conflictNote}
                </p>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onResetHotkeys();
                    setRecordError(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#D6DEEA] px-2.5 py-1.5 text-[12px] font-medium text-[#1F2937] transition-colors hover:bg-slate-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <RotateCcw size={12} /> {t.reset}
                </button>
                <button
                  type="button"
                  disabled={!hasChanges || duplicateKeys.size > 0}
                  onClick={() => {
                    onSaveHotkeys(editingHotkeys);
                    setSavedFlash(true);
                    window.setTimeout(() => setSavedFlash(false), 1600);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-500/40"
                >
                  {savedFlash ? <Check size={12} /> : <Save size={12} />}
                  {savedFlash ? t.shortcutSaved : t.save}
                </button>
              </div>
            </motion.div>
          )}

          {view === 'recovery' && (
            <motion.div
              key="recovery"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className={dense ? 'space-y-2.5' : 'space-y-3.5'}
            >
              <div className="rounded-[14px] border border-brand-500/25 bg-brand-500/[0.07] p-3.5 dark:border-brand-500/30 dark:bg-brand-500/10">
                <button
                  type="button"
                  onClick={onRescueWindow}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-2 text-[12px] font-semibold text-white shadow-sm shadow-brand-500/25 transition-colors hover:bg-brand-700"
                >
                  <LifeBuoy size={15} />
                  {t.rescuePrimary}
                </button>
                <p className="mt-2 text-[12px] leading-[1.5] text-[#5B6470] dark:text-zinc-400">
                  {t.rescueHint}
                </p>
              </div>

              <Card>
                <div className="px-3.5 pb-0.5 pt-3 text-[13px] font-semibold text-[#5B6470] dark:text-zinc-400">
                  {t.rescueSteps}
                </div>
                <RecoveryRow label={t.rescueHotkey} hint={t.rescueAlways}>
                  <ComboKeys combo={t.rescueHotkeyValue} />
                </RecoveryRow>
                <RecoveryRow label={t.rescueTray} hint="">
                  <ChevronRight size={14} className="text-slate-300 dark:text-zinc-600" />
                </RecoveryRow>
                <RecoveryRow label={t.rescueRelaunch} hint={t.rescueRelaunchHint} last>
                  <RotateCcw size={14} className="text-slate-300 dark:text-zinc-600" />
                </RecoveryRow>
              </Card>

              <Card>
                <button
                  type="button"
                  onClick={onAbout}
                  className="flex w-full items-center gap-2.5 border-b border-[#D6DEEA] px-3.5 py-3 text-left text-[13px] text-[#1F2937] transition-colors hover:bg-black/[0.03] dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-white/[0.04]"
                >
                  <Info size={15} className="text-[#5B6470] dark:text-zinc-400" />
                  <span className="flex-1">{t.about}</span>
                  <ChevronRight size={14} className="text-slate-300 dark:text-zinc-600" />
                </button>
                <button
                  type="button"
                  onClick={onQuit}
                  className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-[13px] text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                >
                  <LogOut size={15} />
                  <span className="flex-1">{t.quit}</span>
                </button>
              </Card>

              <div className="flex items-center justify-center gap-1.5 pb-1 text-[11px] text-slate-300 dark:text-zinc-600">
                <Globe size={11} />
                <span>DI-Viewer · {__APP_VERSION__}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/**
 * A continuous width bar instead of four preset buttons: the track is the
 * monitor width, so dragging it reads as "how wide is this window" and the
 * ticks are still exact stops. Live-resizes with a short debounce.
 */
function RatioBar({
  lang,
  viewportWidth,
  onResize
}: {
  lang: UILang;
  viewportWidth: number;
  /** `commit: false` is a live preview while dragging; `true` lands on disk. */
  onResize: (ratio: number, commit: boolean) => void;
}) {
  const t = TEXT[lang];
  const monitors = typeof window !== 'undefined' && window.screen?.availWidth ? window.screen.availWidth : 1920;
  const actual = Math.max(20, Math.min(100, Math.round((viewportWidth / monitors) * 100)));
  const [value, setValue] = useState(actual);
  const live = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const pending = useRef<number | null>(null);
  const lastCommit = useRef<number | null>(null);
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;

  useEffect(() => {
    if (!live.current) setValue(actual);
  }, [actual]);

  useEffect(() => () => {
    if (frame.current) window.cancelAnimationFrame(frame.current);
    detachDrag();
    // The panel can be dismissed mid-drag; land the last preview instead of
    // leaving the backend in "dragging" mode (it suppresses snapping and
    // geometry persistence until a commit arrives).
    if (live.current && pending.current != null) {
      resizeRef.current(pending.current / 100, true);
    }
  }, []);

  const clamp = (next: number) => Math.max(20, Math.min(100, Math.round(next)));

  /*
   * One resize per animation frame while the thumb is moving. The backend
   * treats these as previews — no history write, no edge snapping — so the
   * window tracks the thumb continuously instead of stepping every 160ms.
   */
  const preview = (next: number) => {
    const clamped = clamp(next);
    live.current = true;
    setValue(clamped);
    pending.current = clamped;
    if (frame.current == null) {
      frame.current = window.requestAnimationFrame(() => {
        frame.current = undefined;
        const queued = pending.current;
        pending.current = null;
        if (queued != null) onResize(queued / 100, false);
      });
    }
  };

  const commit = (next: number) => {
    const clamped = clamp(next);
    const wasLive = live.current;
    live.current = false;
    setValue(clamped);
    if (frame.current != null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
    pending.current = null;
    if (!wasLive && lastCommit.current === clamped) return;
    lastCommit.current = clamped;
    onResize(clamped / 100, true);
  };

  const readValue = (target: EventTarget | null) =>
    parseInt((target as HTMLInputElement | null)?.value ?? String(value), 10);
  const dragging = useRef<{ startX: number; startValue: number; width: number } | null>(null);
  const attached = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cancel: () => void } | null>(
    null
  );
  const latest = useRef(value);
  latest.current = value;

  const detachDrag = () => {
    const bound = attached.current;
    if (!bound) return;
    attached.current = null;
    window.removeEventListener('pointermove', bound.move, true);
    window.removeEventListener('pointerup', bound.up, true);
    window.removeEventListener('pointercancel', bound.cancel, true);
  };

  /*
   * The drag is driven from `pointermove` on the window rather than from the
   * input's own tracking. Resizing the window makes WebView2 drop the pointer
   * capture (WM_CAPTURECHANGED) and Chromium fires `pointercancel`, which ended
   * the native range drag after the very first step - the bar could only be
   * clicked through its presets. Listening on the window keeps the gesture alive
   * across resizes.
   *
   * Coordinates are screen-space: a window resize also makes Windows report the
   * *stationary* hardware cursor to the page, and those hover events would
   * otherwise read as huge drag deltas. `buttons` filters them out, `screenX`
   * keeps the maths independent of the page's own scrolling.
   */
  const stopDrag = (screenX?: number, commitIt = true) => {
    const drag = dragging.current;
    if (!drag) return;
    dragging.current = null;
    detachDrag();
    if (!commitIt) return;
    const next =
      screenX == null
        ? latest.current
        : clamp(drag.startValue + ((screenX - drag.startX) / drag.width) * 80);
    commit(next);
  };

  const onDragUp = (e: PointerEvent) => stopDrag(e.screenX, true);
  const onDragCancel = () => stopDrag(undefined, true);

  const onDragMove = (e: PointerEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    if ((e.buttons & 1) === 0) return;
    preview(drag.startValue + ((e.screenX - drag.startX) / drag.width) * 80);
  };

  return (
    <>
      <input
        type="range"
        min="20"
        max="100"
        step="1"
        value={value}
        onChange={(e) => {
          // While our own gesture is running the native slider is not the
          // source of truth; it re-syncs on every window resize and reports a
          // clamped value (100) that would fling the window to full screen.
          if (dragging.current) return;
          preview(parseInt(e.target.value, 10));
        }}
        onPointerDown={(e) => {
          // Own the gesture. Letting the native range drag run as well means
          // two things fight over the same value once the window starts
          // resizing.
          e.preventDefault();
          e.currentTarget.focus();
          const rect = e.currentTarget.getBoundingClientRect();
          // Clicking anywhere on the track jumps there first, like a native
          // range, and the drag then continues from that value.
          const clicked = clamp(20 + ((e.clientX - rect.left) / rect.width) * 80);
          preview(clicked);
          dragging.current = { startX: e.screenX, startValue: clicked, width: rect.width };
          attached.current = { move: onDragMove, up: onDragUp, cancel: onDragCancel };
          window.addEventListener('pointermove', onDragMove, true);
          window.addEventListener('pointerup', onDragUp, true);
          window.addEventListener('pointercancel', onDragCancel, true);
        }}
        onKeyUp={(e) => commit(readValue(e.target))}
        onBlur={(e) => commit(readValue(e.target))}
        className="diviewer-ratio mt-2 h-4 w-full cursor-pointer appearance-none bg-transparent"
        aria-label={t.presets}
      />
      <div className="mt-2 flex items-center justify-between">
        {RATIO_TICKS.map((tick) => {
          const percent = Math.round(tick.ratio * 100);
          const active = Math.abs(value - percent) <= 1;
          return (
            <button
              key={tick.label}
              type="button"
              onClick={() => commit(percent)}
              className={`rounded px-1 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                active
                  ? 'font-semibold text-brand-700 dark:text-brand-300'
                  : 'text-[#5B6470] hover:text-brand-700 dark:text-zinc-400 dark:hover:text-brand-300'
              }`}
            >
              {t[tick.label]}
            </button>
          );
        })}
      </div>
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[#D6DEEA] bg-white dark:border-[#272727] dark:bg-[#17171B]">
      {children}
    </div>
  );
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div
      className={`flex h-[var(--mm-row-h,44px)] items-center gap-3 px-3.5 ${
        last ? '' : 'border-b border-[#D6DEEA] dark:border-zinc-800'
      }`}
    >
      <span className="flex-1 text-[13px] text-[#1F2937] dark:text-zinc-100">{label}</span>
      {children}
    </div>
  );
}

function SwitchRow({
  icon,
  label,
  hint,
  shortcutLabel,
  shortcut,
  checked,
  onChange,
  last
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** Word that labels the combo ("退出" / "exit"). */
  shortcutLabel?: string;
  /** The live key combo, rendered as a chip so it reads as a key, not prose. */
  shortcut?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center gap-2.5 px-3.5 py-[var(--mm-row-y,10px)] text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ${
        last ? '' : 'border-b border-[#D6DEEA] dark:border-zinc-800'
      }`}
    >
      <span className="text-[#5B6470] dark:text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-4 text-[#1F2937] dark:text-zinc-100">{label}</span>
        {hint || shortcut ? (
          <span className="mt-0.5 flex items-baseline gap-1.5">
            {hint ? (
              <span className="min-w-0 flex-1 truncate text-[12px] leading-[1.5] text-[#5B6470] dark:text-zinc-400">
                {hint}
              </span>
            ) : null}
            {shortcut ? (
              <>
                <span className="shrink-0 text-[11px] leading-4 text-[#5B6470] dark:text-zinc-400">{shortcutLabel}</span>
                <span className="shrink-0 rounded bg-black/[0.06] px-1 font-mono text-[11px] leading-4 tabular-nums text-[#1F2937] dark:bg-white/[0.09] dark:text-zinc-200">
                  {shortcut}
                </span>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-700 dark:bg-brand-400' : 'bg-[#D6DEEA] dark:bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function RecoveryRow({
  label,
  hint,
  children,
  last
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-[var(--mm-row-y,10px)] ${
        last ? '' : 'border-b border-[#D6DEEA] dark:border-zinc-800'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-4 text-[#1F2937] dark:text-zinc-100">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#5B6470] dark:text-zinc-400">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: Array<{ id: T; label: string; icon?: React.ReactNode }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-lg bg-black/[0.05] p-0.5 dark:bg-white/[0.07]">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium leading-4 transition-colors ${
              active
                ? 'bg-white text-slate-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                : 'text-[#5B6470] hover:text-[#1F2937] dark:text-zinc-400 dark:hover:text-white'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
