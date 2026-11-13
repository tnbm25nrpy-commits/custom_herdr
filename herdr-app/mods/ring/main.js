// Ring: the accent outline follows the mouse. While the pointer is over a sidebar/panel section
// (those mods set shared "ring.<name>"), the focused terminal pane's accent border is switched to
// the plain border color in the layout; when the pointer is elsewhere it goes back to accent.
// Renders nothing. Hosted by a 0px block in the layout.
import { View, div } from "gpui-kit";
import { shared, setShared, appHome, readTextFile, run, layout } from "herdr";

const SEP = appHome().includes("\\") ? "\\" : "/";
const LAYOUT = [appHome(), "layouts", "main-dynamic-tabs.json"].join(SEP);
const KEYS = ["brand", "spaces", "agents", "footer", "files", "changes", "show", "ci"];
const ON = "border", OFF = "accent";

function findNode(n, id) {
  if (n.id === id) return n;
  for (const c of n.children ?? []) { const r = findNode(c, id); if (r) return r; }
  return null;
}

// The file holds the saved layout (panel hidden, first tab active, default size); layout.set replaces
// the live one, so carry over the live open/closed, active-tab and size state or hovering resets them.
function carryLive(node, live) {
  const l = findNode(live, node.id);
  if (l) {
    if ("hidden" in l) node.hidden = l.hidden; else delete node.hidden;
    if (l.active !== undefined) node.active = l.active;
    if (l.size !== undefined) node.size = l.size;
  }
  for (const c of node.children ?? []) carryLive(c, live);
}

export default class Ring extends View {
  init(_p, cx) {
    this.applied = null; this.pending = null; this.stable = 0; this.busy = false;
    for (const k of KEYS) if (shared("ring." + k)) setShared("ring." + k, false);
    cx.timer.every(25, (cx) => this.tick(cx));
    // On app start the Show panel opens as wide as the left sidebar (a dragged width doesn't carry over).
    cx.timer.after(300, () => {
      const live = layout();
      const sb = live && findNode(live, "sidebar")?.size?.px;
      // The sidebar cards sit inside 8px padding on each side, so the panel is 16px narrower to match them visually.
      const w = (sb >= 160 ? sb : (shared("sidebar.width") ?? 300)) - 16;
      if (live && findNode(live, "panel")?.size?.px !== w) run("layout.resize", { id: "panel", px: w });
    });
  }

  tick(cx) {
    const want = KEYS.some((k) => shared("ring." + k) === true);
    if (want !== this.pending) { this.pending = want; this.stable = 0; }
    else this.stable++;
    // Entering a section applies at once; leaving waits ~50 ms so crossing the gap between two sections doesn't flicker.
    if (this.busy || want === this.applied || (!want && this.stable < 2)) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        const txt = await readTextFile(LAYOUT);
        if (txt == null) return;
        const root = JSON.parse(txt);
        const main = findNode(root, "main");
        const f = main?.content?.pane?.focus;
        if (!f) return;
        const color = want ? ON : OFF;
        if (f.color !== color) {
          f.color = color;
          const live = layout();
          if (live) carryLive(root, live);
          run("layout.set", { layout: root });   // applies in ~20 ms (a file write takes 250 ms+ to be noticed)
        }
        this.applied = want;
      } catch (e) { console.log("ring:", String(e)); }
      finally { this.busy = false; }
    });
  }

  render() { return div(); }
}
