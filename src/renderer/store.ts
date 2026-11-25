import { create } from 'zustand';
import type { AppData, LiveStatus, LocalPlayer, UpdateStatus } from '../shared/model';
import type { TimerState } from '../shared/timer';
import { createDefaultData, normalizeData } from './lib/journal';
import { uid } from './lib/format';

export type View =
  | { name: 'home' }
  | { name: 'season'; seasonId: string }
  | { name: 'day'; seasonId: string; dayId: string }
  | { name: 'stats'; seasonId?: string }
  | { name: 'accounts' }
  | { name: 'settings' };

export interface Toast {
  id: string;
  title: string;
  body?: string;
  kind: 'success' | 'info' | 'error';
  view?: View;
}

interface State {
  loaded: boolean;
  data: AppData;
  view: View;
  history: View[];
  liveStatus: LiveStatus;
  livePlayers: LocalPlayer[];
  update: UpdateStatus;
  timer: TimerState | null;
  toasts: Toast[];
  navigate: (v: View, opts?: { replace?: boolean }) => void;
  back: () => void;
  mutate: (fn: (draft: AppData) => void) => void;
  replaceData: (data: AppData) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(data: AppData) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    window.rlj?.saveData(data);
  }, 250);
}

export function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    window.rlj?.saveData(useStore.getState().data);
  }
}

export const useStore = create<State>((set, get) => ({
  loaded: false,
  data: createDefaultData(),
  view: { name: 'home' },
  history: [],
  liveStatus: { state: 'disabled' },
  livePlayers: [],
  update: { state: 'idle' },
  timer: null,
  toasts: [],
  navigate: (v, opts) =>
    set((s) => ({
      view: v,
      history: opts?.replace ? s.history : [...s.history.slice(-30), s.view],
    })),
  back: () =>
    set((s) => {
      const prev = s.history[s.history.length - 1];
      return prev ? { view: prev, history: s.history.slice(0, -1) } : { view: { name: 'home' } };
    }),
  mutate: (fn) => {
    const draft = structuredClone(get().data);
    fn(draft);
    set({ data: draft });
    scheduleSave(draft);
  },
  replaceData: (data) => {
    set({ data, view: { name: 'home' }, history: [] });
    scheduleSave(data);
  },
  toast: (t) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 9000 : 6000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export async function loadInitialData() {
  const raw = await window.rlj.loadData();
  const data = raw ? normalizeData(raw) : createDefaultData();
  useStore.setState({ data, loaded: true });
}

window.addEventListener('beforeunload', flushSave);
