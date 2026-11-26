#!/usr/bin/env bash
# CI (run inside xvfb-run, with RLJ_SMOKE_TEST, RLJ_SMOKE_OVERLAY, RLJ_USER_DATA and XDG_SESSION_TYPE=wayland set,
# and a stand-in "RocketLeague.exe" process running): start the AppImage as if on a Wayland desktop whose XWayland
# is the Xvfb display. It must restart itself under X11, and with a timer running its overlay must be an
# override-redirect window: one the window manager leaves alone, so it's drawn above the game, fullscreen too.
set -u
appimage="$1"
log="$RLJ_USER_DATA/logs/main.log"

"$appimage" --no-sandbox --hidden > first-instance.log 2>&1
echo "first instance exited with $?"

id=""
for _ in $(seq 1 60); do
  id=$(xwininfo -root -tree 2>/dev/null | grep '"RL Journal timer"' | awk '{print $1}' | head -n 1)
  if [ -n "$id" ] && xwininfo -id "$id" | grep -q 'Map State: IsViewable'; then break; fi
  id=""
  sleep 1
done

echo "---- main.log"
cat "$log" 2>/dev/null || echo "(no main.log)"
echo "----"
[ -n "$id" ] || { echo "FAIL: the overlay window never showed"; exit 1; }
xwininfo -id "$id" | tee overlay-window.txt
grep -q '"restarting":true' "$log" || { echo "FAIL: did not restart under XWayland"; exit 1; }
grep -q '"ozone":"x11"' "$log" || { echo "FAIL: the restarted app isn't on X11"; exit 1; }
grep -q 'overlay shown' "$log" || { echo "FAIL: no 'overlay shown' in main.log"; exit 1; }
grep -q 'Override Redirect State: yes' overlay-window.txt || { echo "FAIL: the overlay is managed by the window manager"; exit 1; }
echo OVERLAY_CHECK_OK
