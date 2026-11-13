// space-dedupe: there is only ever one space per name + folder (on the same machine).
//
// herdr names an unnamed space after where its first terminal is (repo, else folder), so opening a
// second space in a folder that already has one gives two identical "Webapps" spaces. herdr can't
// move a tab between spaces, so this mod catches the new duplicate while it is still a plain shell:
// it opens a tab in the existing space in that folder, then closes the duplicate.
// A duplicate that already runs an agent is left alone (closing it would end the agent).
// Spaces that existed when the mod started are never touched. "~" (home) spaces don't count.
// Undo: delete this mod's layout block ("space-dedupe") in layouts/main-dynamic-tabs.json.
import { View, div } from "gpui-kit";
import { spaces, panes, run } from "herdr";

const norm = (p) => (p ?? "").replace(/[\/]+$/, "").replace(/\//g, "\\").toLowerCase();

export default class SpaceDedupe extends View {
  init(_props, cx) {
    this.old = null;          // space ids present at start
    this.handled = new Set(); // duplicates already dealt with
    cx.timer.every(1000, () => this.tick());
  }

  tick() {
    const sp = spaces();
    if (!sp.length) return;
    if (!this.old) { this.old = new Set(sp.map((s) => s.id)); return; }
    const ps = panes();
    const first = (s) => ps.find((p) => p.terminal && p.tab === s.tabs[0]?.id);
    const key = (s) => {
      const cwd = first(s)?.cwd;
      if (!cwd || s.name === "~") return null;
      return `${s.machine ?? ""}\u0000${s.name.trim().toLowerCase()}\u0000${norm(cwd)}`;
    };
    const keeper = new Map();
    for (const s of sp) {
      const k = key(s);
      if (!k) continue;
      const held = keeper.get(k);
      // The space that was there first keeps the name: one from before start, else the earlier one.
      if (!held || (!this.old.has(held.id) && this.old.has(s.id))) keeper.set(k, s);
    }
    for (const s of sp) {
      if (this.old.has(s.id) || this.handled.has(s.id)) continue;
      const k = key(s);
      const keep = k && keeper.get(k);
      if (!keep || keep.id === s.id) continue;
      this.handled.add(s.id);
      const mine = ps.filter((p) => s.tabs.some((t) => t.id === p.tab));
      const busy = s.tabs.length > 1 || mine.some((p) => !p.terminal || p.status || p.program?.agent || !p.program?.shell);
      if (busy) { console.log(`space-dedupe: ${s.name} (${s.id}) duplicates ${keep.id} but runs something; left alone`); continue; }
      console.log(`space-dedupe: ${s.name} (${s.id}) -> new tab in ${keep.id}`);
      run("tab.new", { space: keep.id, folder: first(s).cwd });
      run("space.close", { id: s.id, confirmed: true });
      run("space.select", { id: keep.id });
    }
  }

  render() { return div(); }
}
