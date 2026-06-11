import React from 'react';
import { motion } from 'motion/react';
import {
  Settings,
  Pin,
  PinOff,
  Bookmark,
  Play,
  SkipBack,
  SkipForward,
  Maximize
} from 'lucide-react';

type UILang = 'zh' | 'en';

interface SidebarProps {
  activeTabId: string;
  dockColor: 'white' | 'ivory' | 'amber' | 'blue' | 'green' | 'rose' | 'slate';
  isDarkMode: boolean;
  onBookmarksClick: () => void;
  onSettingsClick: () => void;
  isPinned: boolean;
  onTogglePin: () => void;
  isOpen: boolean;
  onToggle: () => void;
  onFullscreenClick: () => void;
  onMediaAction: (action: 'video_backward' | 'toggle_play_pause' | 'video_forward') => void;
  lang: UILang;
}

const TEXT = {
  zh: {
    expand: '\u5c55\u5f00\u4fa7\u8fb9\u680f',
    collapse: '\u6536\u8d77\u4fa7\u8fb9\u680f',
    bookmarks: '\u6536\u85cf',
    prev: '\u540e\u9000 5 \u79d2',
    play: '\u64ad\u653e/\u6682\u505c',
    next: '\u524d\u8fdb 5 \u79d2',
    fullscreen: '\u5168\u5c4f',
    pin: '\u7f6e\u9876',
    unpin: '\u53d6\u6d88\u7f6e\u9876',
    settings: '\u8bbe\u7f6e'
  },
  en: {
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
    bookmarks: 'Bookmarks',
    prev: 'Back 5s',
    play: 'Play/Pause',
    next: 'Forward 5s',
    fullscreen: 'Fullscreen',
    pin: 'Pin',
    unpin: 'Unpin',
    settings: 'Settings'
  }
} as const;

export function Sidebar({ activeTabId, dockColor, isDarkMode, onBookmarksClick, onSettingsClick, isPinned, onTogglePin, isOpen, onToggle, onFullscreenClick, onMediaAction, lang }: SidebarProps) {
  const t = TEXT[lang];

  return (
    <>
      <motion.button
        type="button"
        initial={false}
        animate={{
          opacity: isOpen ? 0 : 1,
          x: isOpen ? -20 : 0,
          scale: 1
        }}
        transition={{ duration: 0.2 }}
        className={`fixed left-2 top-[50dvh] -translate-y-1/2 z-[2147483647] flex h-24 w-8 items-center justify-center group ${isOpen ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'}`}
        onClick={onToggle}
        title={t.expand}
      >
        <div className={`h-14 w-1.5 rounded-full ring-1 backdrop-blur-sm transition-all duration-300 group-hover:h-16 group-hover:w-[7px] ${isDarkMode ? 'bg-white/95 ring-white/45 shadow-[0_10px_24px_rgba(0,0,0,0.45)]' : 'bg-black/90 ring-black/30 shadow-[0_8px_20px_rgba(15,23,42,0.28)]'}`} />
      </motion.button>

      <motion.div
        initial={false}
        animate={{
          width: isOpen ? 80 : 0,
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="pointer-events-auto relative h-full shrink-0 overflow-hidden border-r border-slate-200 bg-white dark:border-zinc-800 dark:bg-black z-[2147483646]"
      >
        <motion.div
          animate={{
            x: isOpen ? 0 : -80,
            opacity: isOpen ? 1 : 0
          }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="flex h-full min-w-[80px] w-20 flex-col items-center py-6 pointer-events-auto"
        >
          <button
            type="button"
            onClick={onToggle}
            title={isOpen ? t.collapse : t.expand}
            className="group relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-slate-200/50 bg-white/60 shadow-sm transition-colors hover:bg-slate-100/70 dark:border-zinc-700/50 dark:bg-zinc-800/60 dark:hover:bg-zinc-700/60"
          >
            <div className="absolute inset-0 bg-slate-100/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:bg-zinc-700/50" />
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-9 w-9 -translate-y-0.5 text-slate-700 drop-shadow-sm transition-transform duration-300 group-hover:scale-110 dark:text-slate-200">
              <path d="M30 20H55C71.5685 20 85 33.4315 85 50C85 66.5685 71.5685 80 55 80H30V20Z" fill="currentColor" fillOpacity="0.4" />
              <rect x="15" y="20" width="20" height="60" rx="10" fill="currentColor" />
              <circle cx="55" cy="50" r="10" fill="currentColor" />
            </svg>
          </button>

          <div className="flex w-full flex-1 flex-col items-center justify-center gap-4">
            <div className="w-full px-3">
              <SidebarButton icon={<Bookmark size={22} />} label={t.bookmarks} onClick={onBookmarksClick} />
            </div>

            <div className="mx-2 flex w-full flex-col items-center justify-center gap-3 rounded-2xl bg-black/5 px-3 py-4 dark:bg-white/5 pointer-events-auto">
              <SidebarButton icon={<SkipBack size={18} />} label={t.prev} size="sm" onClick={() => onMediaAction('video_backward')} />
              <SidebarButton icon={<Play size={22} />} label={t.play} onClick={() => onMediaAction('toggle_play_pause')} />
              <SidebarButton icon={<SkipForward size={18} />} label={t.next} size="sm" onClick={() => onMediaAction('video_forward')} />
            </div>

            <div className="w-full px-3">
              <div className="flex flex-col gap-4">
              <SidebarButton icon={<Maximize size={22} />} label={t.fullscreen} onClick={onFullscreenClick} />
              <SidebarButton
                icon={isPinned ? <Pin size={22} /> : <PinOff size={22} />}
                label={isPinned ? t.unpin : t.pin}
                onClick={onTogglePin}
                active={isPinned}
              />
              </div>
            </div>
          </div>

          <div className="w-full px-3">
            <div className="mx-auto my-1 h-px w-8 bg-black/10 dark:bg-white/10" />
            <SidebarButton icon={<Settings size={22} />} label={t.settings} onClick={onSettingsClick} />
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}

interface SidebarButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  size?: 'sm' | 'md';
}

function SidebarButton({ icon, label, onClick, active, size = 'md' }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative group flex aspect-square w-full items-center justify-center rounded-xl transition-all duration-200 pointer-events-auto
        ${active
          ? 'bg-teal-500 text-white shadow-md shadow-teal-500/20'
          : 'text-slate-600 hover:bg-black/5 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
        }
        ${size === 'sm' ? 'scale-90' : 'scale-100'}
      `}
      title={label}
    >
      {icon}
      <span className="pointer-events-none absolute left-full z-50 ml-4 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}
