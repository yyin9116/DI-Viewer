import type { HotkeyConfig } from '../types';

export type InAppAction =
  | 'toggle_play_pause'
  | 'toggle_recording'
  | 'video_backward'
  | 'video_forward'
  | 'request_full_screen'
  | 'increase_opacity'
  | 'decrease_opacity';

/**
 * Bindings that make sense without a modifier: they act on the page you are
 * already watching. Show/hide, click-through and quit are deliberately absent —
 * those must keep working while another app is focused, so they stay global
 * and therefore modifier-bound.
 */
const ACTION_BY_FIELD: Partial<Record<keyof HotkeyConfig, InAppAction>> = {
  togglePlayPause: 'toggle_play_pause',
  toggleRecording: 'toggle_recording',
  videoBackward: 'video_backward',
  videoForward: 'video_forward',
  requestFullScreen: 'request_full_screen',
  increaseOpacity: 'increase_opacity',
  decreaseOpacity: 'decrease_opacity'
};

const MODIFIER_TOKENS = new Set(['CTRL', 'CONTROL', 'ALT', 'SHIFT', 'META', 'CMD', 'COMMAND', 'SUPER']);
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'email',
  'password',
  'number',
  'tel',
  'date',
  'datetime-local',
  'month',
  'time',
  'week'
]);

function tokenize(value: string): string[] {
  return value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function bindingHasModifier(binding: string): boolean {
  return tokenize(binding).some((part) => MODIFIER_TOKENS.has(part.toUpperCase()));
}

export function bindingIsTypingSafe(binding: string): boolean {
  if (bindingHasModifier(binding)) return true;
  const last = tokenize(binding).pop() ?? '';
  return /^F([1-9]|1\d|2[0-4])$/i.test(last);
}

/**
 * Normalises an in-app binding to `[Shift+]KEY`. Returns `null` for bindings
 * that belong to the global (RegisterHotKey) layer, so this matcher can never
 * double-fire something the OS already handled.
 */
export function inAppBindingKey(binding: string): string | null {
  const parts = tokenize(binding);
  if (!parts.length) return null;
  if (bindingHasModifier(binding)) return null;
  return parts[parts.length - 1].toUpperCase();
}

/** Same normalisation for the live event, derived from `code` so IME and
 *  layout differences do not change the identity of the physical key. */
export function eventKey(event: KeyboardEvent): string | null {
  if (event.code === 'Backquote') return 'BACKQUOTE';
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^F\d{1,2}$/.test(event.code)) return event.code.toUpperCase();
  const key = String(event.key || '').trim();
  if (!key) return null;
  if (key === '`') return 'BACKQUOTE';
  if (key === ' ') return 'SPACE';
  if (key.length === 1) return key.toUpperCase();
  return key.toUpperCase();
}

export function isEditableElement(node: EventTarget | Element | null): boolean {
  if (!node || !(node as Element).tagName) return false;
  const element = node as HTMLElement;
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (element as HTMLInputElement).type?.toLowerCase() ?? 'text';
    return TEXT_INPUT_TYPES.has(type);
  }
  if (element.isContentEditable) return true;
  if (element.closest) {
    return Boolean(element.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]'));
  }
  return false;
}

export interface InAppMatchContext {
  /** IME is composing (keydown fires before compositionend on some IMEs). */
  composing: boolean;
  /** Fallback for browsers that do not set isComposing. */
  keyCode?: number;
}

/**
 * Returns the action for a keydown, or `null` when the event must be left
 * alone. The guards are the feature: an IME composition, a focused text field,
 * a modifier the user actually pressed, or a repeated key never triggers a
 * hotkey.
 */
export function matchInAppHotkey(
  hotkeys: HotkeyConfig,
  event: KeyboardEvent,
  context: InAppMatchContext
): InAppAction | null {
  if (context.composing || event.isComposing || context.keyCode === 229 || event.keyCode === 229) {
    return null;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (isEditableElement(event.target as Element | null)) return null;
  if (typeof document !== 'undefined' && isEditableElement(document.activeElement)) return null;

  const pressed = eventKey(event);
  if (!pressed) return null;

  for (const field of Object.keys(ACTION_BY_FIELD) as Array<keyof HotkeyConfig>) {
    const action = ACTION_BY_FIELD[field];
    if (!action) continue;
    const binding = hotkeys[field];
    const expected = inAppBindingKey(binding);
    if (!expected) continue;
    const needsShift = tokenize(binding).some((part) => part.toUpperCase() === 'SHIFT');
    if (needsShift !== event.shiftKey) continue;
    if (expected === pressed) return action;
  }
  return null;
}
