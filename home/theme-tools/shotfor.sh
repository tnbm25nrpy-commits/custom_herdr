#!/bin/bash
# usage: shotfor.sh theme bgindex outname   (run from the app home)
T=/c/Users/me/theme-src
open_picker(){ herdr-app status | grep -q '"theme-switch"' || { herdr-app do mod.open:theme-switch >/dev/null; sleep 2; }; }
open_picker
herdr-app do theme-switch.apply:$1 >/dev/null; sleep 1.5
[ -n "$2" ] && { herdr-app do theme-switch.bg:$2 >/dev/null; sleep 1.5; }
herdr-app shot $T/$3 >/dev/null
herdr-app do overlay.close >/dev/null; sleep 2
herdr-app shot $T/${3%.png}-closed.png >/dev/null
herdr-app status | grep -A1 '"errors"' | tail -1
