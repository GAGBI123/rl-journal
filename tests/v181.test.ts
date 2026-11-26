// 1.8.1: on a Wayland desktop RL Journal restarts itself under XWayland so the timer overlay can stay above the game.
import { describe, expect, it } from 'vitest';
import { onWayland, xwaylandRelaunchPlan } from '../src/main/linux';

const none = () => false;
const exe = '/tmp/.mount_rlj/rl-journal';
const wayland = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' };

describe('XWayland restart', () => {
  it('detects a Wayland session the way Electron does', () => {
    expect(onWayland({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
    expect(onWayland({ WAYLAND_DISPLAY: 'wayland-1' })).toBe(true);
    expect(onWayland({ WAYLAND_SOCKET: '5' })).toBe(true);
    expect(onWayland({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })).toBe(false);
  });

  it('restarts the AppImage with --ozone-platform=x11, keeping its arguments', () => {
    const plan = xwaylandRelaunchPlan({ ...wayland, APPIMAGE: '/home/me/RL-Journal.AppImage' }, [exe, '--hidden'], none, exe);
    expect(plan?.file).toBe('/home/me/RL-Journal.AppImage');
    expect(plan?.args).toEqual(['--hidden', '--ozone-platform=x11']);
    expect(plan?.env.RLJ_XWAYLAND_RELAUNCH).toBe('1');
    // Not from an AppImage: the executable itself.
    expect(xwaylandRelaunchPlan(wayland, [exe], none, exe)?.file).toBe(exe);
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
    const next = xwaylandRelaunchPlan(env, [exe], none, exe)!.env;
    expect(next.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(next.LD_LIBRARY_PATH).toBeUndefined();
    expect(next.XDG_DATA_DIRS).toBe('/usr/local/share:/usr/share');
    expect(next.APPDIR).toBeUndefined();
    expect(next.GDK_BACKEND).toBeUndefined();
    expect(next.DISPLAY).toBe(':0');
  });

  it('stays as it is on X11, without XWayland, when asked to, or once restarted', () => {
    expect(xwaylandRelaunchPlan({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, [exe], none, exe)).toBeNull();
    expect(xwaylandRelaunchPlan({ ...wayland, DISPLAY: undefined }, [exe], none, exe)).toBeNull();
    expect(xwaylandRelaunchPlan({ ...wayland, RLJ_WAYLAND: '1' }, [exe], none, exe)).toBeNull();
    expect(xwaylandRelaunchPlan({ ...wayland, RLJ_XWAYLAND_RELAUNCH: '1' }, [exe], none, exe)).toBeNull();
    expect(xwaylandRelaunchPlan(wayland, [exe, '--ozone-platform=x11'], (s) => s === 'ozone-platform', exe)).toBeNull();
    expect(xwaylandRelaunchPlan(wayland, [exe], (s) => s === 'ozone-platform-hint', exe)).toBeNull();
  });
});
