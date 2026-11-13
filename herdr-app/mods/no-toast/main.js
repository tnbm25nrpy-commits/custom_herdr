// no-toast: turns off herdr-app's in-app notifications (toasts). The user sees agent state in the sidebar.
//
// Toasts are drawn by the shipped mod `toast`, which herdr restores on every app start (an edited copy is
// moved to `toast-edited[-n]`). So this mod (0 px layout block) re-patches mods/toast/main.js after each
// start with a version that closes itself at once, and removes the `toast-edited*` folders that hold
// our own patch. OS notifications (mods/os-notify) and sounds are not affected.
// Undo: delete this mod's layout block, then restore mods/toast/main.js from toast.original.js (or
// simply delete mods/toast/main.js and restart: herdr restores its version).
// Test: `herdr-app do no-toast.test` posts a notification (should never be visible).
import { View, div } from "gpui-kit";
import { readTextFile, writeTextFile, notify, nextCommand, appHome } from "herdr";
import * as fs from "fs/promises";

const MODS = appHome().replace(/[\/]+$/, "") + "/mods";
const MARK = "// PATCHED by mods/no-toast";
const NOOP = `${MARK}: in-app notifications are off (see mods/no-toast/main.js).
import { View, div } from "gpui-kit";
import { props, closeOverlay } from "herdr";

export default class Toast extends View {
  init() { this.closed = false; }
  render() {
    if (!this.closed) {
      this.closed = true;
      const p = props() ?? {};
      if (p.overlay) closeOverlay(p.overlay);
    }
    return div().id("toast").size_0();
  }
}
`;

async function patch() {
  const cur = await readTextFile(`${MODS}/toast/main.js`).catch(() => null);
  if (cur != null && !cur.startsWith(MARK)) await writeTextFile(`${MODS}/toast/main.js`, NOOP, cur);
  // Leftover copies of our patch from previous starts.
  const names = await fs.readdir(MODS).catch(() => []);
  for (const n of names) {
    if (!/^toast-edited(-\d+)?$/.test(n)) continue;
    const dir = `${MODS}/${n}`;
    const js = await readTextFile(`${dir}/main.js`).catch(() => null);
    if (js == null || !js.startsWith(MARK)) continue;   // someone else's edit: keep it
    for (const f of await fs.readdir(dir).catch(() => [])) await fs.unlink(`${dir}/${f}`).catch(() => {});
    await fs.rmdir(dir).catch(() => {});
  }
}

export default class NoToast extends View {
  init(_p, cx) {
    cx.spawn(async () => { try { await patch(); } catch (e) { console.log("no-toast:", String(e)); } });
    // herdr may restore shipped mods slightly after this mod starts: check again a few times.
    let n = 0;
    cx.timer.every(5000, (cx) => {
      if (++n > 6) return;
      cx.spawn(async () => { try { await patch(); } catch (e) { console.log("no-toast:", String(e)); } });
    });
    cx.spawn(async () => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^no-toast\./, "");
        if (c === "test") notify({ title: "no-toast test", body: "you should not see this", level: "info" });
      }
    });
  }
  render() { return div().size_0(); }
}
