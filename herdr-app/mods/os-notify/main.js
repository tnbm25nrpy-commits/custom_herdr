// OS notify: native Windows toast when an agent becomes blocked/done while the window is inactive.
// Renders nothing. Hosted by a hidden block in the layout.
import { View, div } from "gpui-kit";
import { agents, window, appHome, exec } from "herdr";

const SEP = appHome().includes("\\") ? "\\" : "/";
const J = (...p) => p.join(SEP);
const TOAST = J(appHome(), "mods", "os-notify", "bin", "toast.ps1");

// "done" must hold this long before it toasts. Claude Code reports idle the moment a turn ends, even when a
// background subagent/shell is still running; ~/.claude/hooks/herdr-wait-state.ps1 flips it back to "working"
// 1.8-2.4 s later (measured), and a subagent hand-back wakes the session again within seconds.
const DONE_GRACE = 6000;

export default class OsNotify extends View {
  init(_props, cx) {
    this.prev = null;
    this.last = {};
    this.pending = {}; // address -> ms when working -> done was seen
    cx.timer.every(1000, () => this.tick());
    this.tick();
  }

  tick() {
    let list;
    try { list = agents(); } catch (e) { console.log("os-notify agents():", String(e)); return; }
    const cur = {};
    for (const a of list) cur[a.address] = a.status;
    const prev = this.prev;
    this.prev = cur;
    if (!prev) return;
    let active = true;
    try { active = window().active; } catch {}
    if (active) { this.pending = {}; return; }
    const now = Date.now();
    for (const k of Object.keys(this.last)) if (!(k in cur)) delete this.last[k];
    for (const k of Object.keys(this.pending)) if (cur[k] !== "done") delete this.pending[k];
    for (const a of list) {
      const was = prev[a.address];
      let kind = null;
      if (a.status === "blocked" && was !== "blocked") kind = "blocked";
      else if (a.status === "done" && was === "working") { if (!(a.address in this.pending)) this.pending[a.address] = now; continue; }
      else if (a.status === "done" && a.address in this.pending && now - this.pending[a.address] >= DONE_GRACE) {
        delete this.pending[a.address];
        kind = "done";
      }
      if (!kind) continue;
      if (now - (this.last[a.address] ?? 0) < 5000) continue;
      this.last[a.address] = now;
      const name = a.tab_name || a.title || a.address;
      const t = kind === "blocked" ? `${name} needs you` : `${name} finished`;
      const b = [a.space_name, a.title].filter(Boolean).join(" / ");
      exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", TOAST,
        "-Title:" + t, "-Body:" + b, "-Terminal", a.address, "-Kind", kind], { timeout: 20000 })
        .then((r) => { if (r && r.code) console.log("os-notify toast exit", r.code, r.stderr); })
        .catch((e) => console.log("os-notify toast failed:", String(e)));
    }
  }

  render() { return div(); }
}
