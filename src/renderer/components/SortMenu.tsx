import { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react';

/** A small "Sort: …" button with a menu of orders (label + one-line hint each). */
export function SortMenu<T extends string>(props: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const cur = props.options.find((o) => o.value === props.value) ?? props.options[0];
  return (
    <div className={`sort-menu ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button"
        className="btn ghost small sort-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={props.title ?? 'Sort'}
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowUpDown size={13} /> {cur?.label} <ChevronDown size={13} className="sort-chev" />
      </button>
      {open && (
        <div className="sort-pop" role="listbox" aria-label={props.title ?? 'Sort'}>
          {props.options.map((o) => (
            <button
              type="button"
              key={o.value}
              role="option"
              aria-selected={o.value === props.value}
              className={o.value === props.value ? 'on' : ''}
              onClick={() => {
                props.onChange(o.value);
                setOpen(false);
              }}
            >
              <span className="sort-check">{o.value === props.value && <Check size={14} />}</span>
              <span className="sort-text">
                <b>{o.label}</b>
                {o.hint && <small>{o.hint}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
