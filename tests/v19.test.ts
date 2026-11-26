// 1.9: Linux restarts under XWayland (overlay above the game), times in hours only, text export days by number with x.
import { describe, expect, it } from 'vitest';
import { onWayland, xwaylandRelaunchPlan } from '../src/main/linux';
import { fmtMinutes, setTimeFormat } from '../src/renderer/lib/format';
import { createDefaultData, createSeason, normalizeData } from '../src/renderer/lib/journal';
import { recapText, seasonText } from '../src/renderer/lib/textExport';

const exe = '/tmp/.mount_rlj/rl-journal';
const wayland = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' };

describe('XWayland restart', () => {
  it('detects a Wayland session the way Electron does', () => {
    expect(onWayland({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
    expect(onWayland({ WAYLAND_DISPLAY: 'wayland-1' })).toBe(true);
    expect(onWayland({ WAYLAND_SOCKET: '5' })).toBe(true);
    expect(onWayland({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })).toBe(false);
  });

  it('restarts when Electron picked Wayland by itself (it writes --ozone-platform=wayland into its own command line)', () => {
    expect(xwaylandRelaunchPlan(wayland, [exe], 'wayland', exe)?.args).toEqual(['--ozone-platform=x11']);
  });

  it('restarts the AppImage with --ozone-platform=x11, keeping its arguments', () => {
    const plan = xwaylandRelaunchPlan({ ...wayland, APPIMAGE: '/home/me/RL-Journal.AppImage' }, [exe, '--hidden'], '', exe);
    expect(plan?.file).toBe('/home/me/RL-Journal.AppImage');
    expect(plan?.args).toEqual(['--hidden', '--ozone-platform=x11']);
    expect(plan?.env.RLJ_XWAYLAND_RELAUNCH).toBe('1');
    // Not from an AppImage: the executable itself.
    expect(xwaylandRelaunchPlan(wayland, [exe], '', exe)?.file).toBe(exe);
  });

  it("drops this AppImage mount's folders and GDK_BACKEND from the new instance's environment", () => {
    const env = {
      ...wayland,
      APPIMAGE: '/home/me/RL-Journal.AppImage',
      APPDIR: '/tmp/.mount_rlj',
      PATH: '/tmp/.mount_rlj:/tmp/.mount_rlj/usr/sbin:/usr/local/bin:/usr/bin',
      LD_LIBRARY_PATH: '/tmp/.mount_rlj/usr/lib',
      XDG_DATA_DIRS: '/tmp/.mount_rlj/usr/share/:/usr/local/share:/usr/share',
      GDK_BACKEND: 'wayland',
    };
    const next = xwaylandRelaunchPlan(env, [exe], '', exe)!.env;
    expect(next.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(next.LD_LIBRARY_PATH).toBeUndefined();
    expect(next.XDG_DATA_DIRS).toBe('/usr/local/share:/usr/share');
    expect(next.APPDIR).toBeUndefined();
    expect(next.GDK_BACKEND).toBeUndefined();
    expect(next.DISPLAY).toBe(':0');
  });

  it('stays as it is on X11, without XWayland, when asked to, or once restarted', () => {
    expect(xwaylandRelaunchPlan({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, [exe], '', exe)).toBeNull();
    expect(xwaylandRelaunchPlan({ ...wayland, DISPLAY: undefined }, [exe], '', exe)).toBeNull();
    expect(xwaylandRelaunchPlan({ ...wayland, RLJ_WAYLAND: '1' }, [exe], '', exe)).toBeNull();
    expect(xwaylandRelaunchPlan({ ...wayland, RLJ_XWAYLAND_RELAUNCH: '1' }, [exe], '', exe)).toBeNull();
    expect(xwaylandRelaunchPlan(wayland, [exe, '--ozone-platform=wayland'], 'wayland', exe)).toBeNull();
    expect(xwaylandRelaunchPlan(wayland, [exe, '--ozone-platform-hint=auto'], 'wayland', exe)).toBeNull();
    // Electron already chose X11 (e.g. no Wayland socket).
    expect(xwaylandRelaunchPlan(wayland, [exe], 'x11', exe)).toBeNull();
  });
});

describe('time format setting', () => {
  it('shows days by default and only hours and minutes when asked', () => {
    expect(fmtMinutes(1700)).toBe('1d 4h 20m');
    expect(fmtMinutes(1700, false)).toBe('28h 20m');
    expect(fmtMinutes(2880, false)).toBe('48h');
    expect(fmtMinutes(45, false)).toBe('45m');
    setTimeFormat('hours');
    try {
      expect(fmtMinutes(1700)).toBe('28h 20m');
      expect(fmtMinutes(-1500)).toBe('-25h');
    } finally {
      setTimeFormat('days');
    }
    expect(fmtMinutes(1700)).toBe('1d 4h 20m');
  });

  it('is days in new and older journals, and keeps hours once chosen', () => {
    expect(createDefaultData().settings.timeFormat).toBe('days');
    const old = createDefaultData() as any;
    delete old.settings.timeFormat;
    expect(normalizeData(old).settings.timeFormat).toBe('days');
    old.settings.timeFormat = 'weeks';
    expect(normalizeData(old).settings.timeFormat).toBe('days');
    old.settings.timeFormat = 'hours';
    expect(normalizeData(old).settings.timeFormat).toBe('hours');
  });

  it('applies to the exported text files too', () => {
    const data = createDefaultData();
    const season = createSeason(data, 30, '2026-01-01', 3);
    season.days[0].entries.push({ id: 'e1', activityId: 'act-freeplay', measure: 'time', minutes: 1700, createdAt: '2026-01-01T10:00:00Z' });
    expect(seasonText(data, season, '2026-01-03')).toContain('total training time : 1,700 min (1d 4h 20m)');
    setTimeFormat('hours');
    try {
      expect(seasonText(data, season, '2026-01-03')).toContain('total training time : 1,700 min (28h 20m)');
      expect(recapText(data, season, '2026-01-03')).toContain('Total training time: 28h 20m (1,700 min)');
    } finally {
      setTimeFormat('days');
    }
  });
});
