import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, run, openOverlay, theme, window, shared, layout, settings, nextCommand, agents, terminals, appHome, readTextFile, watchFolder } from "herdr";
import * as fs from "fs/promises";

// Tab width bounds (px). Few tabs grow up to TAB_MAX; many shrink. Inactive tabs go down to
// TAB_MIN (icon only), the active tab is sized to its name (never shrunk, never below the equal share), so it always stays visible and named.
const TAB_MIN = 38;
const TAB_MAX = 300;
const ACTIVE_MAX = 360; // active tab hugs its name, up to this width

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The agent's terminal title, minus spinner/status glyphs; null when it's only the program's name.
function sessionName(pane) {
  const title = pane?.title?.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!title || title === pane.program?.name || /^claude( code)?$/i.test(title)) return null;
  return title;
}

// ---- Map button badge: failures and file conflicts, read straight from the agent-map data (the map mod only runs once the board was opened) ----
const SEP = appHome().includes("\\") ? "\\" : "/";
const MAP_DIR = [appHome(), "data", "agent-map"].join(SEP);
const MAP_POLL_MS = 3000;
const CONFLICT_MS = 10 * 60 * 1000;
const sanitizeId = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
const ID_OK = /^[\w-]{1,64}$/;
const baseName = (p) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? String(p ?? "");
const freshMapState = () => ({ off: 0, head: "", fails: [], writes: new Map() });

export default class Tabs extends View {
  init(_props, cx) {
    // `herdr-app do tabs-dynamic.todo-toggle` / `tabs-dynamic.map-toggle` (or a key bound to it) opens/closes the Todo board / the agent map.
    // mods/todo only gets its own `todo.toggle` while it is shown, so this one can also open it.
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "todo-toggle") run("layout.select", { stack: "work-stack", child: find(layout(), "work-stack")?.active === "todo" ? "work-body" : "todo" });
        if (c === "map-toggle") run("layout.select", { stack: "work-stack", child: find(layout(), "work-stack")?.active === "agent-map" ? "work-body" : "agent-map" });
      }
    });
    this.initMapBadge(cx);
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // ---- Map badge ------------------------------------------------------------------------------------------------------
  // Per live agent file: char offset (+ first 160 chars to notice a rewritten file), failure timestamps newer than the
  // moment the map was last open, and the latest write per (sub, file) from the last 10 minutes. Nothing else is kept.
  initMapBadge(cx) {
    this.mapFiles = new Map();
    this.seenAt = Date.now();      // the map counts as seen up to here; only newer failures/writes badge
    this.badge = { fails: 0, conflicts: [], sig: "" };
    this.mapPolling = false; this.mapDirtyAll = false; this.mapDirty = new Set();
    this.mapPoll(cx);
    // 3 s timer: expiry of the 10-minute window and the seen time. Files are only re-read when watchFolder reports a
    // change; if the watch is not available the timer reads every tick, else every 10th tick as a safety net.
    this.watching = false; this.tick = 0;
    cx.timer.every(MAP_POLL_MS, (cx) => {
      if (!this.watching || ++this.tick % 10 === 0) this.mapPoll(cx);
      else if (this.mapRecompute()) cx.notify();
    });
    cx.spawn(async (cx) => {
      try {
        try { await fs.mkdir(MAP_DIR, { recursive: true }); } catch { }
        for (;;) {
          const paths = await watchFolder(MAP_DIR);
          this.watching = true;
          const ids = new Set();
          let all = !Array.isArray(paths) || !paths.length;
          for (const p of Array.isArray(paths) ? paths : []) {
            const name = String(p).split(/[\\/]/).pop();
            if (name.endsWith(".jsonl")) ids.add(name.slice(0, -6)); else all = true;
          }
          this.mapPoll(cx, all ? null : ids);
        }
      } catch { this.watching = false; /* no watch: the timer covers it */ }
    });
  }

  mapPoll(cx, only = null) {
    if (only) for (const id of only) this.mapDirty.add(id); else this.mapDirtyAll = true;
    if (this.mapPolling) return;
    this.mapPolling = true;
    cx.spawn(async (cx) => {
      try {
        while (this.mapDirtyAll || this.mapDirty.size) {
          const all = this.mapDirtyAll, ids = [...this.mapDirty];
          this.mapDirtyAll = false; this.mapDirty.clear();
          await this.mapScan(all ? null : ids);
        }
      } catch { }
      this.mapPolling = false;
      if (this.mapRecompute()) cx.notify();
    });
  }

  async mapScan(ids) {
    let live = [];
    try {
      // agents() lacks pane-less sub-agents (hc run workers, any depth): add the live descendants from terminals()
      const addrs = agents().map((a) => a.address), have = new Set(addrs);
      let terms = []; try { terms = terminals().filter((x) => x && x.state === "live" && typeof x.address === "string"); } catch { }
      for (let i = 0; i < addrs.length; i++) for (const k of terms) if (k.parent === addrs[i] && !have.has(k.address)) { have.add(k.address); addrs.push(k.address); }
      live = addrs.map(sanitizeId).filter((id) => ID_OK.test(id));
    } catch { }
    const todo = ids ? live.filter((id) => ids.includes(id)) : live;
    for (const id of todo) {
      const path = [MAP_DIR, `${id}.jsonl`].join(SEP);
      let text = null;
      try { text = await readTextFile(path); } catch { }
      if (typeof text !== "string") continue;
      let st = this.mapFiles.get(id);
      if (!st) { st = freshMapState(); this.mapFiles.set(id, st); }
      // unchanged length and head: nothing new, no parsing
      if (text.length === st.off && st.off > 0 && text.startsWith(st.head)) continue;
      this.mapIngest(st, text);
    }
    if (!ids) for (const id of [...this.mapFiles.keys()]) if (!live.includes(id)) this.mapFiles.delete(id);
  }

  mapIngest(st, text) {
    if (text.length < st.off || (st.head && text.slice(0, st.head.length) !== st.head)) Object.assign(st, freshMapState());
    if (st.off === 0) st.head = text.slice(0, 160);
    const rest = text.slice(st.off), cut = rest.lastIndexOf("\n") + 1;
    let chunk = rest.slice(0, cut), used = cut;
    const tail = rest.slice(cut);
    if (tail.trim()) { try { JSON.parse(tail); chunk += tail; used += tail.length; } catch { /* half-written: wait for the rest */ } }
    st.off += used;
    const oldest = Date.now() - CONFLICT_MS;
    for (const line of chunk.split("\n")) {
      // cheap pre-filter before JSON.parse
      if (!line.includes('"fail"') && !line.includes('"write":true')) continue;
      let e = null;
      try { e = JSON.parse(line); } catch { continue; }
      if (!e || typeof e.ts !== "number") continue;
      if (e.ev === "fail") { if (e.ts > this.seenAt && st.fails.length < 200) st.fails.push(e.ts); }
      else if (e.write === true && e.file && e.ts > oldest) {
        const key = `${e.sub ?? ""}|${e.file}`;
        const prev = st.writes.get(key);
        if (!prev || e.ts >= prev.ts) st.writes.set(key, { ts: e.ts, file: String(e.file), path: String(e.path ?? e.file), sub: e.sub ?? "" });
      }
    }
  }

  // Prunes and derives the badge. True when what is shown changed.
  mapRecompute() {
    const now = Date.now(), oldest = now - CONFLICT_MS;
    let fails = 0;
    const byFile = new Map();      // file -> { path, actors: Map(actorKey -> id), newest }
    for (const [id, st] of this.mapFiles) {
      st.fails = st.fails.filter((ts) => ts > this.seenAt);
      fails += st.fails.length;
      for (const [k, w] of st.writes) {
        if (w.ts < oldest) { st.writes.delete(k); continue; }
        let f = byFile.get(w.file);
        if (!f) { f = { file: w.file, path: w.path, actors: new Map(), newest: 0 }; byFile.set(w.file, f); }
        f.actors.set(`${id}|${w.sub}`, id);
        if (w.ts > f.newest) { f.newest = w.ts; f.path = w.path; }
      }
    }
    const conflicts = [];
    for (const f of byFile.values()) if (f.actors.size > 1 && f.newest > this.seenAt) conflicts.push({ name: baseName(f.path), ids: [...new Set(f.actors.values())] });
    const sig = `${fails}|${conflicts.map((c) => `${c.name}:${c.ids.join(",")}`).join(";")}`;
    const changed = sig !== this.badge.sig;
    this.badge = { fails, conflicts, sig };
    return changed;
  }

  // Opening the map marks everything so far as seen.
  mapSeen() {
    this.seenAt = Date.now();
    for (const st of this.mapFiles.values()) st.fails = [];
    this.mapRecompute();
  }

  mapTip() {
    const b = this.badge, parts = [];
    if (b.fails) parts.push(`${b.fails} failure${b.fails > 1 ? "s" : ""}`);
    if (b.conflicts.length) {
      let live = [], sp = [];
      try { live = agents(); sp = spaces(); } catch { }
      const label = (id) => {
        const a = live.find((x) => sanitizeId(x.address) === id);
        if (!a) return id;
        const tab = sp.flatMap((s) => s.tabs ?? []).find((x) => x.id === a.tab);
        const title = String(a.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
        return tab?.named ? tab.name : (title && !/^claude( code)?$/i.test(title) && title !== a.program?.name ? title : (tab?.name || a.address));
      };
      const c = b.conflicts[0];
      const who = c.ids.length > 1 ? c.ids.map(label) : [label(c.ids[0]), "subagent"];
      parts.push(`conflict: ${c.name} (${who.join(", ")})${b.conflicts.length > 1 ? ` +${b.conflicts.length - 1} more` : ""}`);
    }
    return parts.join(" · ");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) || stored === "show" ? stored : null;
        // Only ever restore an open panel; never auto-close one. A space with no remembered
        // choice (null) used to hide the panel on every space switch / mod reload (Show "crash").
        if (want && want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    // Display only: the active tab is drawn first (far left) only when, in its real place, the tabs
    // before it (each at least TAB_MIN) would push it past the strip's edge. Otherwise real order.
    const all = space?.tabs ?? [];
    const at = all.findIndex(c => c.active);
    const activeW = this.activeW ?? 200;
    const overflows = this.stripW !== undefined && at > 0 && at * (TAB_MIN + 3) + activeW > this.stripW;
    const shown = overflows ? [all[at], ...all.filter((_c, j) => j !== at)] : all;
    // Equal share of the strip per tab (what an inactive tab gets); the active tab is never narrower than this.
    const share = this.stripW === undefined || !all.length ? 0
      : Math.max(TAB_MIN, Math.min(TAB_MAX, (this.stripW - 3 * (all.length - 1)) / all.length));
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const inTab = panes().filter(p => p.tab === c.id);
      const agentPane = inTab.find(p => p.focused && p.program?.agent) ?? inTab.find(p => p.program?.agent);
      const program = agentPane?.program ?? inTab[0]?.program;
      // Unnamed tabs take the agent's session name (its terminal title); a manual rename wins.
      const name = c.named ? c.name : sessionName(agentPane) ?? c.name;
      // Dynamic width: tabs share the strip equally, capped at TAB_MAX; the active one fits its text.
      const narrow = !c.active && shown.length > 6;
      return h_flex().id(`tab-${c.id}`).when(c.active, el => el.on_size_change((size, cx) => { if (Math.abs(size.width - (this.activeW ?? 0)) > 1) { this.activeW = size.width; cx.notify(); } })).h(38).px(narrow ? 6 : 12).gap(narrow ? 5 : 7).rounded(10).items_center().when(c.active, el => el.flex_none().min_w(share).max_w(Math.max(ACTIVE_MAX, share))).when(!c.active, el => el.flex_grow(1).flex_shrink(1).flex_basis(0).min_w(TAB_MIN).max_w(TAB_MAX)).text_size(12.8)
        .tooltip(name)
        // Active tab: accent outline + selected fill + semibold so it stands out from the strip.
        .border(1).border_color(c.active ? (t.accent.length === 7 ? t.accent + "8c" : t.accent) : t.chrome).bg(c.active ? t.selected : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .when(c.active, el => el.font_weight(500))
        .hover(s => s.bg(c.active ? t.selected : t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else { run("tab.select", { id: c.id }); if ((find(layout(), "work-stack")?.active ?? "work-body") !== "work-body") run("layout.select", { stack: "work-stack", child: "work-body" }); }
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(c.active ? t.accent : t.muted) : image(program.icon).size(14)))
        .child(div().when(c.active, el => el.flex_grow(1).flex_shrink(1)).when(!c.active, el => el.flex_1()).min_w(0).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(div().size(12).flex_none().overflow_hidden().flex().items_center().justify_center().child(svg("mods/my-chrome/spinner.svg").size(14).flex_none().text_color(t.working).spin(900))))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    // Any tab switch (click, scroll wheel, key, space switch) closes the Todo board.
    const activeTab = all[at]?.id ?? null;
    if (this.lastTab !== undefined && activeTab !== this.lastTab && (find(root, "work-stack")?.active ?? "work-body") !== "work-body")
      run("layout.select", { stack: "work-stack", child: "work-body" });
    this.lastTab = activeTab;
    // So does focusing another pane (e.g. clicking an agent in the sidebar).
    const focusedPane = focused()?.pane ?? null;
    if (this.lastPane !== undefined && focusedPane !== this.lastPane && (find(root, "work-stack")?.active ?? "work-body") !== "work-body")
      run("layout.select", { stack: "work-stack", child: "work-body" });
    this.lastPane = focusedPane;
    const panelButton = (id, label, icon) => {
      // While the Todo board is open the panel sits behind it: a click closes the board and shows the panel.
      const boardOpen = (find(root, "work-stack")?.active ?? "work-body") !== "work-body";
      const on = panel && !panel.hidden && body?.active === id && !boardOpen;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (boardOpen) run("layout.select", { stack: "work-stack", child: "work-body" });
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    // Todo board: covers everything right of the sidebar while the work-stack's active child is "todo".
    const todoOn = find(root, "work-stack")?.active === "todo";
    const todoButton = h_flex().id("todo-btn").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(todoOn ? t.selected : t.chrome).text_color(todoOn ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => run("layout.select", { stack: "work-stack", child: todoOn ? "work-body" : "todo" }))
      .child(svg("mods/todo/todo.svg").size(14)).child("Todo");
    // Agent map: the same stack, third child; Todo and Map switch between each other.
    const mapOn = find(root, "work-stack")?.active === "agent-map";
    if (mapOn) this.mapSeen();
    const badge = this.badge, tip = mapOn ? "" : this.mapTip();
    const mapButton = h_flex().id("map-btn").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(mapOn ? t.selected : t.chrome).text_color(mapOn ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => run("layout.select", { stack: "work-stack", child: mapOn ? "work-body" : "agent-map" }))
      .when(Boolean(tip), el => el.tooltip(tip))
      .child(svg("mods/agent-map/map.svg").size(14)).child("Map")
      .when(!mapOn && badge.fails > 0, el => el.child(badge.fails > 1
        ? div().min_w(14).h(14).px(3).rounded(7).flex_none().flex().items_center().justify_center().bg("#e5484d").text_color("#ffffff").text_size(10).font_weight(600).child(badge.fails > 99 ? "99+" : String(badge.fails))
        : div().size(7).rounded(4).flex_none().bg("#e5484d")))
      .when(!mapOn && badge.conflicts.length > 0, el => el.child(div().flex_none().text_size(12).font_weight(700).text_color("#f5a623").child("!")));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).pt(8).gap(3).items_center()
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_hidden()
        .on_size_change((size, cx) => { if (Math.abs(size.width - (this.stripW ?? 0)) > 1) { this.stripW = size.width; cx.notify(); } }).children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(todoButton)
      .child(mapButton)
      .child(panelButton("show", "Show", "mods/show/show.svg"))
      .child(h_flex().id("theme-switch-btn").h(26).px(8).flex_none().items_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "theme-switch" })).child(svg("mods/theme-switch/palette.svg").size(14)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-dynamic/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-dynamic/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-dynamic/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
