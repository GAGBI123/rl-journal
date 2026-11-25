// Keyboard shortcuts: turn a key press into an Electron accelerator ("Control+Alt+P") and back
// into something readable ("Ctrl + Alt + P"). Uses the physical key (e.code), so it works the
// same with any keyboard layout (e.g. Hebrew).

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  Pause: 'Pause',
  ScrollLock: 'Scrolllock',
  PrintScreen: 'PrintScreen',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  MediaPlayPause: 'MediaPlayPause',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
  MediaStop: 'MediaStop',
};

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

/** The main key of a press as an accelerator key, or null for keys a shortcut can't use. */
export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  return CODE_KEYS[code] ?? null;
}

export type RecordResult =
  | { kind: 'modifier' } // only Ctrl / Alt / Shift held so far: keep waiting
  | { kind: 'cancel' }
  | { kind: 'unsupported'; key: string }
  | { kind: 'ok'; accelerator: string };

/** Turn a keydown into a shortcut. Escape on its own cancels. */
export function recordKey(e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): RecordResult {
  if (MODIFIER_CODES.has(e.code) || ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return { kind: 'modifier' };
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[];
  if (e.code === 'Escape' && !mods.length) return { kind: 'cancel' };
  const key = e.code === 'Escape' ? 'Escape' : keyFromCode(e.code);
  if (!key) return { kind: 'unsupported', key: e.key || e.code };
  return { kind: 'ok', accelerator: [...mods, key].join('+') };
}

const LABELS: Record<string, string> = {
  Control: 'Ctrl',
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Super: 'Win',
  Meta: 'Win',
  numadd: 'Num +',
  numsub: 'Num -',
  nummult: 'Num *',
  numdiv: 'Num /',
  numdec: 'Num .',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Escape: 'Esc',
};

/** "Control+Alt+P" → "Ctrl + Alt + P" */
export function shortcutLabel(accel: string): string {
  if (!accel) return 'Off';
  return accel
    .split('+')
    .map((k) => LABELS[k] ?? (/^num[0-9]$/.test(k) ? `Num ${k.slice(3)}` : k))
    .join(' + ');
}

/** True for a shortcut without Ctrl / Alt / Win: the key then can't be used for anything else while a timer runs. */
export function isPlainKey(accel: string) {
  const parts = accel.split('+');
  return !parts.some((p) => ['Control', 'Alt', 'Super', 'CommandOrControl', 'CmdOrCtrl', 'Meta'].includes(p)) && !/^F([1-9]|1[0-9]|2[0-4])$/.test(parts[parts.length - 1]);
}
