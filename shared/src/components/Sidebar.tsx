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
  /** Short window (e.g. the 1/3 preset): tighten the rail so nothing clips. */
  dense: boolean;
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

export function Sidebar({ activeTabId, dockColor, isDarkMode, onBookmarksClick, onSettingsClick, isPinned, onTogglePin, isOpen, onToggle, onFullscreenClick, onMediaAction, lang, dense }: SidebarProps) {
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
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        className="pointer-events-auto relative h-full shrink-0 overflow-hidden z-[2147483646]"
      >
        {/* The surface is painted on the inner panel, never on the box that
            animates 80px -> 0px: a background/border on the shrinking box
            survives the spring as a 1-2px white sliver for a few frames. */}
        <motion.div
          initial={false}
          animate={{ x: isOpen ? 0 : -48, opacity: isOpen ? 1 : 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          className="absolute inset-y-0 left-0 w-20 border-r border-chrome-line bg-chrome"
        />
        <motion.div
          initial={false}
          animate={{
            x: isOpen ? 0 : -20,
            opacity: isOpen ? 1 : 0
          }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          className={`relative grid h-full w-20 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] justify-items-center overflow-y-auto scrollbar-hide ${dense ? 'gap-1 py-2' : 'py-6'} ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          <button
            type="button"
            onClick={onToggle}
            title={isOpen ? t.collapse : t.expand}
            className={`group relative row-start-1 flex shrink-0 cursor-pointer items-center justify-center self-start overflow-hidden rounded-2xl border border-slate-200/50 bg-white/60 shadow-sm transition-colors hover:bg-slate-100/70 dark:border-zinc-700/50 dark:bg-zinc-800/60 dark:hover:bg-zinc-700/60 ${dense ? 'h-9 w-9' : 'h-12 w-12'}`}
          >
            <div className="absolute inset-0 bg-slate-100/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:bg-zinc-700/50" />
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={`${dense ? 'h-7 w-7' : 'h-9 w-9'} -translate-y-0.5 text-slate-700 drop-shadow-sm transition-transform duration-300 group-hover:scale-110 dark:text-slate-200`}>
              <path d="M30 20H55C71.5685 20 85 33.4315 85 50C85 66.5685 71.5685 80 55 80H30V20Z" fill="currentColor" fillOpacity="0.4" />
              <rect x="15" y="20" width="20" height="60" rx="10" fill="currentColor" />
              <circle cx="55" cy="50" r="10" fill="currentColor" />
            </svg>
          </button>

          {/* `1fr auto 1fr` (see the rail above): the two flexible rows always
              end up the same height, so this cluster sits on the rail's true
              vertical centre at every window height. `my-auto` could only
              centre it between the logo and the gear, which drifted off-centre
              as soon as the window got shorter. */}
          <div className={`row-start-2 flex w-full flex-col items-center ${dense ? 'gap-2' : 'gap-4'}`}>
            <div className="w-full px-3">
              <SidebarButton icon={<Bookmark size={22} />} label={t.bookmarks} onClick={onBookmarksClick} dense={dense} />
            </div>

            {/*
              * `w-full` plus `mx-2` is 80 + 16 = 96 in an 80px rail: with
              * `items-center` and negative free space the browser pins the card
              * to the rail's left edge, so it ends up a fixed 80px block flush
              * against both edges while every other icon is a 56px button inset
              * by 12. Subtracting the margin keeps the card 64 wide (8..72),
              * centred, and only 4px of padding per side leaves the media
              * buttons the same 56px column as the rest of the rail.
              */}
            <div className={`mx-2 flex w-[calc(100%_-_1rem)] flex-col items-center justify-center rounded-2xl bg-black/5 px-1 dark:bg-white/5 pointer-events-auto ${dense ? 'gap-1.5 py-2' : 'gap-3 py-4'}`}>
              <SidebarButton icon={<SkipBack size={18} />} label={t.prev} size="sm" onClick={() => onMediaAction('video_backward')} dense={dense} />
              <SidebarButton icon={<Play size={22} />} label={t.play} onClick={() => onMediaAction('toggle_play_pause')} dense={dense} />
              <SidebarButton icon={<SkipForward size={18} />} label={t.next} size="sm" onClick={() => onMediaAction('video_forward')} dense={dense} />
            </div>

            <div className="w-full px-3">
              <div className={`flex flex-col ${dense ? 'gap-2' : 'gap-4'}`}>
              <SidebarButton icon={<Maximize size={22} />} label={t.fullscreen} onClick={onFullscreenClick} dense={dense} />
              <SidebarButton
                icon={isPinned ? <Pin size={22} /> : <PinOff size={22} />}
                label={isPinned ? t.unpin : t.pin}
                onClick={onTogglePin}
                active={isPinned}
                dense={dense}
              />
              </div>
            </div>
          </div>

          <div className="row-start-3 w-full self-end px-3">
            <div className="mx-auto my-1 h-px w-8 bg-black/10 dark:bg-white/10" />
            <SidebarButton icon={<Settings size={22} />} label={t.settings} onClick={onSettingsClick} dense={dense} />
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
  dense?: boolean;
}

function SidebarButton({ icon, label, onClick, active, size = 'md', dense = false }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative group flex items-center justify-center rounded-xl transition-all duration-200 pointer-events-auto
        ${dense ? 'h-9 w-9' : 'aspect-square w-full'}
        ${active
          ? 'bg-teal-500 text-white shadow-md shadow-teal-500/20'
          : 'text-slate-600 hover:bg-black/5 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
        }
        ${size === 'sm' ? 'scale-90' : 'scale-100'}
      `}
      title={label}
    >
      <span className={dense ? 'flex scale-[0.82] items-center justify-center' : 'flex items-center justify-center'}>
        {icon}
      </span>
      <span className="pointer-events-none absolute left-full z-50 ml-4 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}
