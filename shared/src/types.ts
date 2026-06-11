export interface BookmarkItem {
  title: string;
  url: string;
}

export interface HotkeyConfig {
  togglePlayPause: string;
  toggleRecording: string;
  toggleShowHide: string;
  insideMode: string;
  videoBackward: string;
  videoForward: string;
  decreaseOpacity: string;
  increaseOpacity: string;
  requestFullScreen: string;
  closeWindow: string;
}

export interface FrontendState {
  lastUrl: string;
  opacity: number;
  onTop: boolean;
  inside: boolean;
  visible: boolean;
  maximized: boolean;
  positionLocked: boolean;
  sidebarVisible: boolean;
  uiLang: string;
  bookmarks: BookmarkItem[];
  hotkeys: HotkeyConfig;
}

export interface TabSessionItem {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export interface TabSessionSnapshot {
  tabs: TabSessionItem[];
  activeIndex: number;
}

export type DockColor = 'white' | 'ivory' | 'amber' | 'blue' | 'green' | 'rose' | 'slate';

export interface HostSnapshot {
  state: FrontendState;
  tabs: TabSessionSnapshot;
  dockColor: DockColor;
}
