// Click, then press any key combination to set a shortcut.
import { useEffect, useRef, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import { isPlainKey, recordKey, shortcutLabel } from '../lib/shortcut';

export function ShortcutInput(props: {
  value: string;
  onChange: (accel: string) => void;
  defaultValue: string;
  /** Other shortcut in use, so the same keys aren't picked twice. */
  other?: { value: string; name: string };
}) {
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'warn' | 'ok'; text: string } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const stop = () => {
    setRecording(false);
    void window.rlj.hotkeySuspend(false);
  };

  useEffect(() => {
    if (!recording) return;
    // The current shortcut would swallow the keys while a timer runs: pause it while recording.
    void window.rlj.hotkeySuspend(true);
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = recordKey(e);
      if (r.kind === 'modifier') return;
      if (r.kind === 'cancel') return stop();
      if (r.kind === 'unsupported') {
        setMsg({ kind: 'error', text: `“${r.key}” can't be used in a shortcut. Try another key.` });
        return;
      }
      const accel = r.accelerator;
      if (props.other?.value && accel === props.other.value) {
        setMsg({ kind: 'error', text: `${shortcutLabel(accel)} is already the ${props.other.name} shortcut.` });
        return;
      }
      stop();
      const check = await window.rlj.hotkeyCheck(accel);
      if (check === 'taken') {
        setMsg({ kind: 'error', text: `Another app already uses ${shortcutLabel(accel)}. Pick other keys.` });
        return;
      }
      if (check === 'invalid') {
        setMsg({ kind: 'error', text: `${shortcutLabel(accel)} can't be used as a shortcut. Pick other keys.` });
        return;
      }
      props.onChange(accel);
      setMsg(
        isPlainKey(accel)
          ? { kind: 'warn', text: `Saved. While a timer runs, ${shortcutLabel(accel)} only does this, in every app. A combo with Ctrl or Alt avoids that.` }
          : { kind: 'ok', text: `Saved: ${shortcutLabel(accel)}.` },
      );
    };
    const onBlur = () => stop();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      void window.rlj.hotkeySuspend(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  return (
    <div className="shortcut-input">
      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
        <button
          ref={ref}
          className={`btn shortcut-key ${recording ? 'recording' : ''}`}
          onClick={() => {
            setMsg(null);
            if (recording) stop();
            else setRecording(true);
          }}
          title={recording ? 'Press the keys now (Esc cancels)' : 'Click, then press the keys you want'}
        >
          <Keyboard size={14} />
          {recording ? 'Press keys…' : shortcutLabel(props.value)}
        </button>
        {props.value && !recording && (
          <button
            className="icon-btn"
            title="Turn this shortcut off"
            aria-label="Turn this shortcut off"
            onClick={() => {
              props.onChange('');
              setMsg(null);
            }}
          >
            <X size={15} />
          </button>
        )}
        {props.value !== props.defaultValue && !recording && (
          <button
            className="icon-btn"
            title={`Back to ${shortcutLabel(props.defaultValue)}`}
            aria-label="Reset to the default shortcut"
            onClick={() => {
              props.onChange(props.defaultValue);
              setMsg(null);
            }}
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
      {recording && <div className="tiny muted" style={{ marginTop: 6, textAlign: 'right' }}>Press any key or combination. Esc cancels.</div>}
      {msg && !recording && (
        <div className={`tiny ${msg.kind === 'error' ? 'down' : msg.kind === 'warn' ? 'warn-text' : 'up'}`} style={{ marginTop: 6, textAlign: 'right', maxWidth: 300 }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
