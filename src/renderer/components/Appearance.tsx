// Settings → Appearance: the look (Aurora / Classic), the user's own colors and the app icon.
import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Palette, RotateCcw, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { Modal, Segmented, Toggle } from './ui';
import { COLOR_FIELDS, effectiveColors, PALETTES, THEMES, validHex } from '../lib/theme';
import type { ColorKey, CustomColors, ThemeId } from '../../shared/model';
import logo from '../../../build/icon.svg';

function ThemePreview({ id, colors }: { id: ThemeId; colors: Record<ColorKey, string> }) {
  return (
    <div
      className={`theme-preview ${id}`}
      style={{ ['--pv-accent' as any]: colors.accent, ['--pv-accent2' as any]: colors.accent2, ['--pv-bg' as any]: colors.background, ['--pv-surface' as any]: colors.surface }}
      aria-hidden
    >
      <div className="pv-side">
        <i className="on" />
        <i />
        <i />
        <i />
      </div>
      <div className="pv-main">
        <div className="pv-title" />
        <div className="pv-row">
          <div className="pv-card">
            <b />
          </div>
          <div className="pv-card">
            <b />
          </div>
          <div className="pv-card">
            <b />
          </div>
        </div>
        <div className="pv-row" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="pv-card">
            <b />
          </div>
          <div className="pv-card" />
        </div>
      </div>
    </div>
  );
}

const sameColors = (a: CustomColors, b: CustomColors) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a as any)[k]?.toLowerCase() === (b as any)[k]?.toLowerCase());
};

function ColorField({ k, label, help, value, custom, onChange, onReset }: {
  k: ColorKey;
  label: string;
  help: string;
  value: string;
  custom: boolean;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="color-field">
      <label className="color-swatch" style={{ background: value }} title={`Pick a color for ${label.toLowerCase()}`}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} color`} />
      </label>
      <div className="cf-text">
        <div className="cf-label">
          {label}
          {custom && (
            <button className="icon-btn" style={{ width: 22, height: 22 }} title="Back to the look's own color" aria-label={`Reset ${label}`} onClick={onReset}>
              <RotateCcw size={12} />
            </button>
          )}
        </div>
        <div className="cf-help">{help}</div>
      </div>
      <input
        className="input color-hex"
        value={text}
        spellCheck={false}
        maxLength={7}
        aria-label={`${label} hex`}
        data-key={k}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          const full = v.startsWith('#') ? v : `#${v}`;
          if (validHex(full)) onChange(full.toLowerCase());
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

const ICON_PX = 512;

function drawIcon(canvas: HTMLCanvasElement, img: HTMLImageElement, fit: 'fill' | 'fit', round: boolean) {
  const ctx = canvas.getContext('2d')!;
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  ctx.clearRect(0, 0, ICON_PX, ICON_PX);
  ctx.save();
  if (round) {
    ctx.beginPath();
    ctx.roundRect(0, 0, ICON_PX, ICON_PX, ICON_PX * 0.22);
    ctx.clip();
  }
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = fit === 'fill' ? Math.max(ICON_PX / w, ICON_PX / h) : Math.min(ICON_PX / w, ICON_PX / h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (ICON_PX - dw) / 2, (ICON_PX - dh) / 2, dw, dh);
  ctx.restore();
}

function IconPickerModal({ image, onClose }: { image: HTMLImageElement; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<'fill' | 'fit'>(image.naturalWidth === image.naturalHeight ? 'fit' : 'fill');
  const [round, setRound] = useState(true);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!canvas.current) return;
    drawIcon(canvas.current, image, fit, round);
    try {
      setPreview(canvas.current.toDataURL('image/png'));
    } catch {
      setPreview('');
    }
  }, [image, fit, round]);
  const apply = async () => {
    if (!preview) {
      toast({ kind: 'error', title: "That picture can't be used", body: 'Try a PNG or JPG file.' });
      return;
    }
    setBusy(true);
    try {
      const url = await window.rlj.iconSet(preview);
      if (!url) throw new Error('not saved');
      useStore.setState({ appIcon: url });
      toast({ kind: 'success', title: 'App icon changed', body: 'Used for the window, the taskbar, the tray and your RL Journal shortcuts.' });
      onClose();
    } catch {
      toast({ kind: 'error', title: "Couldn't change the icon", body: 'Try another picture.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New app icon"
      subtitle="Pick how the picture fills the square. It's saved in your data folder, so the original file can be moved or deleted."
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !preview} onClick={apply}>
            <Check size={15} /> Use this icon
          </button>
        </>
      }
    >
      <div className="icon-crop">
        <canvas ref={canvas} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="label" style={{ marginBottom: 6 }}>
            Picture
          </div>
          <Segmented
            value={fit}
            onChange={setFit}
            options={[
              { value: 'fill', label: 'Fill the square' },
              { value: 'fit', label: 'Show all of it' },
            ]}
          />
          <div style={{ marginTop: 6 }}>
            <Toggle title="Rounded corners" on={round} onChange={setRound} />
          </div>
          {preview && (
            <div className="small-previews" title="How it looks small (taskbar, tray)">
              <img src={preview} width={48} height={48} alt="" />
              <img src={preview} width={32} height={32} alt="" />
              <img src={preview} width={16} height={16} alt="" />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function AppIconCard() {
  const appIcon = useStore((s) => s.appIcon);
  const toast = useStore((s) => s.toast);
  const file = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<HTMLImageElement | null>(null);
  const isWin = window.rlj.platform === 'win32';
  const choose = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 25_000_000) {
      toast({ kind: 'error', title: 'That picture is too big', body: 'Pick one under 25 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setPicked(img);
      img.onerror = () => toast({ kind: 'error', title: "That file isn't a picture the app can read", body: 'Try PNG, JPG, WebP, GIF or SVG.' });
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };
  const reset = async () => {
    await window.rlj.iconReset();
    useStore.setState({ appIcon: null });
    toast({ kind: 'success', title: 'Back to the RL Journal icon' });
  };
  return (
    <div className="card">
      <div className="icon-row">
        <img className="icon-preview" src={appIcon ?? logo} alt="Current app icon" draggable={false} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 600 }}>App icon</div>
          <div className="muted small" style={{ marginTop: 2 }}>
            Use any picture as RL Journal's icon: the window, {isWin ? 'the taskbar, the tray and your RL Journal shortcuts' : 'the tray and the app menu entry'}.
            {isWin ? ' Windows can take a moment to show it on shortcuts.' : ''}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => file.current?.click()}>
            <ImagePlus size={15} /> Choose picture…
          </button>
          {appIcon && (
            <button className="btn ghost" onClick={reset}>
              <RotateCcw size={15} /> Default icon
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,image/x-icon"
          style={{ display: 'none' }}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {picked && <IconPickerModal image={picked} onClose={() => setPicked(null)} />}
    </div>
  );
}

export function AppearanceSettings() {
  const settings = useStore((s) => s.data.settings);
  const mutate = useStore((s) => s.mutate);
  const custom = settings.customColors ?? {};
  const colors = effectiveColors(settings);
  const setTheme = (id: ThemeId) => mutate((d) => void (d.settings.theme = id));
  const setColors = (next: CustomColors) =>
    mutate((d) => {
      if (Object.keys(next).length) d.settings.customColors = next;
      else delete d.settings.customColors;
    });
  return (
    <>
      <div className="section-title">
        <h2>
          <Sparkles size={15} /> Appearance
        </h2>
      </div>
      <div className="theme-picks">
        {THEMES.map((t) => {
          const on = settings.theme === t.id;
          return (
            <button key={t.id} className={`theme-pick ${on ? 'on' : ''}`} onClick={() => setTheme(t.id)} aria-pressed={on}>
              <ThemePreview id={t.id} colors={effectiveColors({ theme: t.id, customColors: custom })} />
              <div className="tp-name">
                {t.name}
                {t.id === 'aurora' && <span className="badge blue">New</span>}
                {on && <Check size={15} style={{ marginLeft: 'auto', color: 'var(--blue)' }} />}
              </div>
              <div className="tp-desc">{t.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 600 }} className="row">
              <Palette size={15} /> Colors
            </div>
            <div className="muted small" style={{ marginTop: 2 }}>
              Start from a set, or pick each color yourself. Works with both looks.
            </div>
          </div>
          {Object.keys(custom).length > 0 && (
            <button className="btn small ghost" onClick={() => setColors({})}>
              <RotateCcw size={14} /> Reset colors
            </button>
          )}
        </div>
        <div className="palette-row">
          {PALETTES.map((p) => {
            const c = effectiveColors({ theme: settings.theme, customColors: p.colors });
            return (
              <button key={p.name} className={`palette-btn ${sameColors(custom, p.colors) ? 'on' : ''}`} onClick={() => setColors({ ...p.colors })}>
                <span className="palette-dots">
                  <span style={{ background: c.accent }} />
                  <span style={{ background: c.accent2 }} />
                  <span style={{ background: c.surface }} />
                </span>
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="color-fields">
          {COLOR_FIELDS.map((f) => (
            <ColorField
              key={f.key}
              k={f.key}
              label={f.label}
              help={f.help}
              value={colors[f.key]}
              custom={validHex(custom[f.key])}
              onChange={(v) => setColors({ ...custom, [f.key]: v })}
              onReset={() => {
                const next = { ...custom };
                delete next[f.key];
                setColors(next);
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <AppIconCard />
      </div>
    </>
  );
}
