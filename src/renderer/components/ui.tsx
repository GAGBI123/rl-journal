import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { create } from 'zustand';

export function Modal(props: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-head">
          <div>
            <h3>{props.title}</h3>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`segmented ${props.full ? 'full' : ''}`} role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { title: ReactNode; desc?: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="toggle"
      role="switch"
      aria-checked={props.on}
      tabIndex={0}
      onClick={() => props.onChange(!props.on)}
      onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), props.onChange(!props.on))}
    >
      <div>
        <div className="t-title">{props.title}</div>
        {props.desc && <div className="t-desc">{props.desc}</div>}
      </div>
      <div className={`switch ${props.on ? 'on' : ''}`} />
    </div>
  );
}

export function Field(props: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.help && <div className="help">{props.help}</div>}
    </div>
  );
}

/** Number input that keeps the raw text so "1." or "" can be typed. */
export function NumberInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  big?: boolean;
  autoFocus?: boolean;
  min?: number;
  step?: number;
  onEnter?: () => void;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.autoFocus) ref.current?.focus();
  }, [props.autoFocus]);
  return (
    <input
      ref={ref}
      className={`input ${props.big ? 'big' : ''} ${props.invalid ? 'invalid' : ''}`}
      inputMode="decimal"
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => {
        const v = e.target.value.replace(',', '.');
        if (v === '' || /^\d*\.?\d*$/.test(v)) props.onChange(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && props.onEnter?.()}
    />
  );
}

// ------------------------------------------------------------ confirm dialog

interface ConfirmReq {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ req: ConfirmReq | null }>(() => ({ req: null }));

export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ req: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  if (!req) return null;
  const done = (ok: boolean) => {
    req.resolve(ok);
    useConfirm.setState({ req: null });
  };
  return (
    <Modal
      title={req.title}
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn ghost" onClick={() => done(false)}>
            Cancel
          </button>
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} onClick={() => done(true)} autoFocus>
            {req.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      {req.body && <div className="text-2">{req.body}</div>}
    </Modal>
  );
}

export function EmptyState(props: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '36px 24px' }}>
      {props.icon && <div style={{ color: 'var(--muted)', marginBottom: 10 }}>{props.icon}</div>}
      <div style={{ fontWeight: 600, fontSize: 15 }}>{props.title}</div>
      {props.body && <div className="muted small" style={{ marginTop: 4 }}>{props.body}</div>}
      {props.action && <div style={{ marginTop: 16 }}>{props.action}</div>}
    </div>
  );
}
