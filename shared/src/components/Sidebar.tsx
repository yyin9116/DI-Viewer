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
  /**
   * Whether the page in the active tab is already in the bookmark list. The
   * button is the only feedback the action has - saving writes to the host and
   * the start page is a different webview - so without this the click looked
   * like it did nothing at all.
   */
  isBookmarked: boolean;
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
  /**
   * Rail width in px, chosen from the viewport width by the caller. The rail
   * used to be a hard `w-20`: narrowing the window left an 80px column and
   * 56px buttons on a 600px-wide window, and the icons never shrank. Every
   * child is sized off this one number now (buttons, logo, icons), so the
   * whole rail scales as a unit. `--diviewer-inset-left` must be kept equal to
   * it, or the page underneath is padded for a rail that is no longer there.
   */
  railWidth: number;
}

const TEXT = {
  zh: {
    expand: '\u5c55\u5f00\u4fa7\u8fb9\u680f',
    collapse: '\u6536\u8d77\u4fa7\u8fb9\u680f',
    bookmarks: '\u6536\u85cf',
    bookmarked: '\u53d6\u6d88\u6536\u85cf',
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
    bookmarks: 'Bookmark',
    bookmarked: 'Remove bookmark',
    prev: 'Back 5s',
    play: 'Play/Pause',
    next: 'Forward 5s',
    fullscreen: 'Fullscreen',
    pin: 'Pin',
    unpin: 'Unpin',
    settings: 'Settings'
  }
} as const;

export function Sidebar({ activeTabId, dockColor, isDarkMode, onBookmarksClick, isBookmarked, onSettingsClick, isPinned, onTogglePin, isOpen, onToggle, onFullscreenClick, onMediaAction, lang, dense, railWidth }: SidebarProps) {
  const t = TEXT[lang];
  // Icons ride along with the rail: 22px on the 80px rail it was tuned for,
  // and proportionally smaller below that. Rounded so the SVG box stays on a
  // whole pixel and 1x renders stay crisp.
  const iconSize = Math.max(14, Math.round(railWidth * 0.275));

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
        /* Centred by `top-0 bottom-0 my-auto` rather than by an offset: with
           both edges pinned and auto block margins, the box centres itself at
           whatever height it has. The previous `top: 50dvh` + `-translate-y-1/2`
           silently lost the translate (the companion `--tw-translate-x` is not
           defined in the injected shadow root, see index.css), so the grip hung
           *from* the midline and sat 48px low; a hard-coded
           `calc(50dvh - 3rem)` would have fixed that but re-breaks the centring
           every time the handle's length changes. */
        className={`fixed left-2 top-0 bottom-0 my-auto z-[2147483647] flex h-28 w-8 items-center justify-center group ${isOpen ? 'pointer-events-none' : 'pointer-events-auto cursor-pointer'}`}
        data-tone={isDarkMode ? 'dark' : 'light'}
        onClick={onToggle}
        title={t.expand}
      >
        {/* Two layers. The bloom is a real, blurred disc behind the grip rather
            than more box-shadow layers: three large radii stacked on a 6px bar
            read as a hard halo, while a blur disc reads as light. Which blue is
            decided by `data-tone` on the button, so the tone can never drift
            from the `isDarkMode` the rest of the rail is using. */}
        <span
          aria-hidden="true"
          className="rail-handle-bloom pointer-events-none absolute inset-0 m-auto h-20 w-3 rounded-full group-hover:h-24"
        />
        <div className="rail-handle-core relative h-20 w-1.5 rounded-full group-hover:h-24 group-hover:w-[7px]" />
      </motion.button>

      <motion.div
        initial={false}
        animate={{
          width: isOpen ? railWidth : 0,
        }}
        transition={{ type: 'spring', damping: 30, stiffness: 320 }}
        style={{ '--rail-w': `${railWidth}px`, '--rail-icon': `${iconSize}px` } as React.CSSProperties}
        className="pointer-events-auto relative h-full shrink-0 overflow-hidden z-[2147483646] chrome-surface"
      >
        {/* The surface does NOT animate: it is clipped by the box above.
            Animating its own x/opacity meant that while the rail sprang open
            there was nothing painted yet, so the notch showed the page behind
            it — a white strip on a dark theme, which is what "the panel starts
            white" was. Clipped instead, the spring *reveals* opaque chrome. */}
        <div className="absolute inset-y-0 left-0 w-[var(--rail-w)] border-r border-chrome-line bg-chrome transition-colors duration-300" />
        <motion.div
          initial={false}
          animate={{
            x: isOpen ? 0 : -20,
            opacity: isOpen ? 1 : 0
          }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          className={`relative grid h-full w-[var(--rail-w)] grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] justify-items-center overflow-y-auto scrollbar-hide ${dense ? 'gap-1 py-2' : 'py-6'} ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
        >
          <button
            type="button"
            onClick={onToggle}
            title={isOpen ? t.collapse : t.expand}
            className={`group relative row-start-1 flex shrink-0 cursor-pointer items-center justify-center self-start overflow-hidden rounded-2xl border border-slate-200/50 bg-white/60 shadow-sm transition-colors hover:bg-slate-100/70 dark:border-zinc-700/50 dark:bg-zinc-800/60 dark:hover:bg-zinc-700/60 ${dense ? 'w-[max(30px,calc(var(--rail-w)*0.46))]' : 'w-[calc(var(--rail-w)*0.6)]'} aspect-square`}
          >
            <div className="absolute inset-0 bg-slate-100/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:bg-zinc-700/50" />
            <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[68%] w-[68%] -translate-y-0.5 text-slate-700 drop-shadow-sm transition-transform duration-300 group-hover:scale-110 dark:text-slate-200">
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
              <SidebarButton
                icon={<Bookmark size={22} />}
                label={isBookmarked ? t.bookmarked : t.bookmarks}
                onClick={onBookmarksClick}
                active={isBookmarked}
                dense={dense}
              />
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
  // Dense mode trades `w-full` for a narrower fixed square so the whole rail
  // fits a 1/3-height window — but every wrapper above is a plain block with
  // `px-3`, so a fixed-width button sat on the padding edge while the rail's
  // centre is 40. The media card *did* centre, because it is a flex parent
  // with `items-center`, so the cluster read as a column shoved left.
  // `mx-auto` puts the block-level button back on the rail's centreline in
  // both modes, and the width is a fraction of `--rail-w` so it keeps fitting
  // when the rail itself narrows with the window.
  // `max(32px, …)` keeps the smallest case (60px rail, short window) at a
  // 32px hit target instead of the 28px the bare ratio would give.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative group flex items-center justify-center rounded-xl
        transition-[background-color,color,transform,box-shadow] duration-200 pointer-events-auto
        aspect-square ${dense ? 'mx-auto w-[max(32px,calc(var(--rail-w)*0.46))]' : 'w-full'}
        active:scale-[0.94]
        ${active
          ? 'bg-teal-500 text-white shadow-[0_6px_18px_-2px_rgba(20,184,166,0.55),inset_0_1px_0_rgba(255,255,255,0.28)]'
          : 'text-slate-600 hover:bg-black/5 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
        }
        ${size === 'sm' ? 'scale-90' : 'scale-100'}
      `}
      title={label}
    >
      {/* lucide keeps whatever `size` was passed as an SVG attribute; these
          classes win over it, so one `--rail-icon` value drives every icon and
          the whole cluster shrinks together with the rail. */}
      <span className={`flex items-center justify-center transition-transform duration-200 group-hover:scale-[1.06] group-active:scale-[0.96] [&>svg]:h-[var(--rail-icon,22px)] [&>svg]:w-[var(--rail-icon,22px)] ${dense ? 'scale-[0.82]' : ''}`}>
        {icon}
      </span>
      <span className="pointer-events-none absolute left-full z-50 ml-4 -translate-x-1 whitespace-nowrap rounded-md bg-slate-800/95 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg shadow-black/20 backdrop-blur transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}
