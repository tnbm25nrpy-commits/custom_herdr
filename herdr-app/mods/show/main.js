// Show: images agents send land here, next to the session. Mark them up, save a copy,
// send them back into the agent's prompt.
//
//   panel  (layout block in the right "panel" stack): the inbox, newest first
//   editor (same mod as a dialog, props {editor: id}): markup canvas + Save copy / Send back
//
// Data: <appHome>/show/inbox/<id>__<name> + <id>.json sidecar, written by bin/show-add.ps1
// (Claude calls it via ~/.claude/scripts/show-image.ps1). Annotations are burned in by
// bin/show-flatten.ps1 (System.Drawing).
import { View, div, image, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import {
  appHome, exec, run, theme, focused, panes, terminals, agents, openOverlay, closeOverlay, notify,
  watchFolder, writeTextFile, nextCommand, props, settings, setShared, spaces,
} from "herdr";
import * as fs from "fs/promises";

const SEP = appHome().includes("\\") ? "\\" : "/";
const J = (...p) => p.join(SEP);
const INBOX = J(appHome(), "show", "inbox");
const TMP = J(appHome(), "show", "tmp");
const BIN = J(appHome(), "mods", "show", "bin");
const PS = (script, args) => exec("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", J(BIN, script), ...args], { timeout: 60000 });

const COLORS = ["#ff3b30", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#ffffff"];
const STROKE = 4, TEXT = 18, BADGE = 26;   // screen px; stored in image px

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const stop = (_e, cx) => cx.stop_propagation();

async function readItems() {
  let names = [];
  try { names = await fs.readdir(INBOX); } catch { return []; }
  const items = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try { items.push(JSON.parse(await fs.readFile(J(INBOX, n), "utf8"))); } catch { /* half-written: next pass */ }
  }
  return items.sort((a, b) => b.time - a.time);
}

// ---- sections: one shared grouping for the panel and the editor's ←/→ order ----------------------
// Key: the item's group (trimmed), else its tab, else "other". Labels fall back to the tab's name.
const sectionKey = (item) => {
  const g = (item.group ?? "").toString().trim();
  return g ? `g:${g}` : item.tab ? `tab:${item.tab}` : "other";
};
// Stable, unique element id for a section key (sanitized + short hash, so "a b" and "a_b" differ).
const sectionId = (key) => {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `sec-${key.replace(/[^\w-]/g, "_").slice(0, 40)}-${h.toString(36)}`;
};

// Sections newest first (by their newest item); items inside newest first.
// `showSpace`: prefix tab labels with the space's name when several spaces exist.
function groupItems(items, showSpace = false) {
  let sp = [], ag = [];
  try { sp = spaces(); } catch { }
  try { ag = agents(); } catch { }
  const map = new Map();
  for (const item of items) {
    const key = sectionKey(item);
    if (!map.has(key)) map.set(key, { key, items: [] });
    map.get(key).items.push(item);
  }
  const sections = [...map.values()];
  for (const s of sections) {
    s.items.sort((a, b) => b.time - a.time);
    s.newest = s.items[0].time;
    s.label = sectionLabel(s.key, s.items[0], sp, ag, showSpace);
  }
  return sections.sort((a, b) => b.newest - a.newest);
}

function sectionLabel(key, item, sp, ag, showSpace) {
  if (key.startsWith("g:")) return key.slice(2);
  if (key === "other") return "Other";
  const space = sp.find((s) => s.tabs?.some((t) => t.id === item.tab)) ?? sp.find((s) => s.id === item.space);
  const tab = space?.tabs?.find((t) => t.id === item.tab);
  const title = ag.find((a) => a.address === item.terminal)?.title?.trim();
  let label = tab ? (tab.named ? tab.name : (title || `Tab ${tab.index}`)) : (title || "Closed tab");
  if (showSpace && sp.length > 1 && space?.name) label = `${space.name} / ${label}`;
  return label;
}

// The agent an image goes back to: whoever sent it, else an agent in the current tab.
function targetTerminal(item) {
  const live = new Set(terminals().filter((t) => t.state === "live").map((t) => t.address));
  if (item?.terminal && live.has(item.terminal)) return item.terminal;
  const f = focused();
  const inTab = panes().filter((p) => p.tab === f?.tab && p.terminal && live.has(p.terminal));
  return (inTab.find((p) => p.status !== null) ?? inTab[0])?.terminal ?? f?.terminal ?? null;
}

// Put the file on the clipboard as a file and paste it into the agent: Claude Code turns it into [Image #n].
// `beforePaste` runs right before the focus+paste, after the last await: the editor closes its
// dialog there. Closing tears down the editor's script, so nothing after it may await.
async function sendBack(item, absPath, beforePaste) {
  const term = targetTerminal(item);
  // Only paste where we can focus: otherwise the paste would land in whatever pane has focus.
  if (!term || !panes().some((p) => p.terminal === term)) {
    notify({ title: "Show", body: "The agent that sent this isn't visible: open its tab, or drop the file in yourself", level: "warning" });
    return false;
  }
  const r = await exec("powershell.exe", ["-NoProfile", "-Command", `Set-Clipboard -Path '${absPath.replace(/'/g, "''")}'`]);
  if (r.code !== 0) { notify({ title: "Show", body: `Clipboard failed: ${r.stderr}`, level: "error" }); return false; }
  beforePaste?.();
  run("pane.focus", { terminal: term });
  run("terminal.paste");
  return true;
}

const openExternal = (abs) => exec("explorer.exe", [abs]);

// Single click on a card: jump to the session that sent the image (switches tab if needed).
function goToSession(item) {
  const term = item?.terminal;
  const live = term && terminals().some((t) => t.address === term && t.state === "live");
  if (!live) { notify({ title: "Show", body: "The session that sent this is gone", level: "warning" }); return; }
  let isAgent = false;
  try { isAgent = agents().some((a) => a.address === term); } catch { }
  if (isAgent) run("agent.focus", { terminal: term });
  else { if (item.tab) run("tab.select", { id: item.tab }); run("pane.focus", { terminal: term }); }
}

function openEditor(item) {
  openOverlay({ mod: "show", props: { editor: item.id }, kind: "dialog", width: 0.92, height: 0.9 });
}

// ---------------------------------------------------------------------------------------------

export default class Show extends View {
  init(initial, cx) {
    const p = { ...(initial ?? {}), ...(props() ?? {}) };
    this.items = []; this.width = 360;
    if (p?.editor) return this.initEditor(p, cx);
    try { const s = JSON.parse(localStorage.getItem("sections") ?? "{}"); this.sections = s && typeof s === "object" && !Array.isArray(s) ? s : {}; } catch { this.sections = {}; }
    this.reload(cx);
    cx.spawn(async (cx) => {
      for (;;) {
        try { await watchFolder(INBOX); } catch { return; }
        this.reload(cx);
      }
    });
    cx.timer.every(20000, (cx) => this.reload(cx));   // fallback if the watch drops
    // Commands (keys.json or `herdr-app do show.<cmd>`): edit-latest, send-latest, collapse-all, expand-all, delete-all
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const latest = this.visible()[0];
        if (c === "edit-latest" && latest) openEditor(latest);
        if (c === "send-latest" && latest) await sendBack(latest, latest.abs);
        if (c === "collapse-all" || c === "expand-all") this.setAllSections(c === "expand-all");
        if (c === "delete-all") this.deleteAll(cx);   // twice = delete
        if (c === "delete-top-group") { const s = this.sectionsOf(this.visible())[0]; if (s) this.deleteSection(s, cx); }   // twice = delete
        cx.notify();
      }
    });
  }

  visible() { return this.items; }

  // Sections of the visible items. Open: the stored choice, else only the newest section.
  sectionsOf(shown) {
    return groupItems(shown, true).map((s, i) => ({ ...s, open: this.sections[s.key] ?? i === 0 }));
  }

  saveSections() { localStorage.setItem("sections", JSON.stringify(this.sections)); }

  setAllSections(open) {
    for (const s of this.sectionsOf(this.visible())) this.sections[s.key] = open;
    this.saveSections();
  }

  // `cx` must be live (a handler's own cx, or an AsyncContext): a handler cx kept across an
  // `await` is stale, and cx.spawn throws. The try keeps `loading` from sticking at true
  // if it does, which would freeze the panel for good.
  reload(cx) {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    try {
      cx.spawn(async (cx) => {
        try {
          const items = await readItems();
          if (items[0] && items[0].id !== this.items[0]?.id && this.items.length && items[0].time > this.items[0].time) {
            this.fresh = items[0].id;
            this.sections[sectionKey(items[0])] = true;   // a new image opens its section
            this.saveSections();
          }
          this.items = items;
        } finally {
          this.loading = false; cx.notify();
          if (this.again) { this.again = false; this.reload(cx); }
        }
      });
    } catch (e) { this.loading = false; throw e; }
  }

  // Drop the card at once, then delete the files in a task (a click's cx dies at the first await).
  remove(item, cx) { this.removeMany([item], cx); }

  removeMany(list, cx) {
    const ids = new Set(list.map((i) => i.id));
    this.items = this.items.filter((i) => !ids.has(i.id));
    cx.notify();
    cx.spawn(async (cx) => {
      for (const item of list)
        for (const f of [item.abs, J(INBOX, `${item.id}.json`)]) { try { await fs.unlink(f); } catch { } }
      this.reload(cx);
    });
  }

  // Section ✕: the first click arms it ("Delete N?", 3 s), the second deletes the whole group.
  // A group with a single image is deleted on the first click.
  deleteSection(sec, cx) {
    if (sec.items.length > 1 && this.armed !== sec.key) {
      this.armed = sec.key;
      const key = sec.key;
      cx.timer.after(3000, (cx) => { if (this.armed === key) { this.armed = null; cx.notify(); } });
      cx.notify();
      return;
    }
    this.armed = null;
    delete this.sections[sec.key]; this.saveSections();
    this.removeMany(sec.items, cx);
  }

  // Header "Delete all": same arm-then-confirm as the section ✕ (3 s window).
  deleteAll(cx) {
    if (this.armed !== "*all") {
      this.armed = "*all";
      cx.timer.after(3000, (cx) => { if (this.armed === "*all") { this.armed = null; cx.notify(); } });
      cx.notify();
      return;
    }
    this.armed = null;
    this.sections = {}; this.saveSections();
    this.removeMany(this.visible(), cx);
  }

  addDropped(paths, cx) {
    const term = targetTerminal(null) ?? "";
    cx.spawn(async (cx) => {
      for (const p of paths) await PS("show-add.ps1", ["-Path", p, "-Terminal", term, "-NoReveal"]);
      this.reload(cx);
    });
  }

  render(cx) {
    return this.editor ? this.renderEditor(cx) : this.renderPanel(cx);
  }

  // ---- panel ---------------------------------------------------------------------------------

  renderPanel(cx) {
    const t = theme(), shown = this.visible();
    const cardW = Math.max(120, (this.listW ?? this.width) / (settings()?.zoom || 1) - 22);
    const secs = this.sectionsOf(shown), anyOpen = secs.some((s) => s.open);
    let budget = 80;   // cards rendered overall (open sections only)
    const sectionEl = (sec) => {
      const cards = sec.open ? sec.items.slice(0, Math.max(0, budget)) : [];
      budget -= cards.length;
      return v_flex().id(`${sectionId(sec.key)}-wrap`).flex_none().gap(8)
        .child(h_flex().id(sectionId(sec.key)).h(26).flex_none().px(6).gap(6).items_center().rounded(6).text_size(11)
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.sections[sec.key] = !sec.open; this.saveSections(); cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().text_color(t.foreground).child(sec.label))
          .child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(sec.items.length)))
          .child(div().flex_none().text_color(t.dim).child(clock(sec.newest)))
          .child(this.armed === sec.key
            ? div().id(`${sectionId(sec.key)}-del`).flex_none().h(20).px(6).flex().items_center().rounded(5).text_size(11)
              .bg("#ff3b30").text_color("#ffffff").font_semibold().cursor_pointer()
              .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.deleteSection(sec, cx); })
              .child(`Delete ${sec.items.length}?`)
            : div().id(`${sectionId(sec.key)}-del`).flex_none().h(20).px(5).flex().items_center().rounded(5).text_size(12)
              .text_color(t.dim).cursor_pointer().hover((s) => s.bg("#ff3b3033").text_color("#ff3b30"))
              .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.deleteSection(sec, cx); })
              .child("✕")))
        .when(cards.length > 0, (e) => e.child(v_flex().flex_none().gap(12).children(cards.map((item) => this.card(item, cardW, t)))));
    };
    const toggleAll = div().id("sections-toggle").px(5).h(22).flex().items_center().rounded(6).text_size(11).text_color(t.muted)
      .bg(t.background).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(anyOpen ? "Collapse all" : "Expand all")
      .on_click((_e, cx) => { this.setAllSections(!anyOpen); cx.notify(); }).child(svg("mods/show/menu.svg").size(14));
    const allArmed = this.armed === "*all";
    const deleteAll = div().id("delete-all").px(allArmed ? 8 : 5).h(22).flex().items_center().rounded(6).text_size(11).cursor_pointer()
      .when(allArmed, (e) => e.bg("#ff3b30").text_color("#ffffff").font_semibold())
      .when(!allArmed, (e) => e.bg(t.background).text_color(t.muted).hover((s) => s.bg("#ff3b3033").text_color("#ff3b30")))
      .tooltip("Delete all")
      .on_click((_e, cx) => this.deleteAll(cx)).child(allArmed ? `Delete ${shown.length}?` : svg("mods/show/trash.svg").size(14));

    return v_flex().id("show").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.chrome).border_1().border_color(this.hot ? t.accent : t.border).on_hover((h, cx) => { this.hot = h; setShared("ring.show", h); cx.notify(); })
      .text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .on_drop((e, cx) => this.addDropped(e.paths ?? [], cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Show"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(shown.length)))
        .child(div().flex_1())
        .when(secs.length > 0, (e) => e.child(deleteAll).child(toggleAll)))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("show-list").absolute().inset_0().overflow_y_scroll().p(10).gap(8)
          .on_size_change((size, cx) => { if (Math.abs(size.width - (this.listW ?? 0)) > 1) { this.listW = size.width; cx.notify(); } })
          .children(secs.map(sectionEl))
          .when(!shown.length, (e) => e.child(v_flex().p(12).gap(6).text_color(t.dim).text_size(12)
            .child(div().child("Nothing here yet."))
            .child(div().child("Images Claude sends land here automatically. You can also drop image files on this panel.")))))
        .child(Scrollbar.vertical("show-list").absolute().inset_0()));
  }

  card(item, w, t) {
    const h = item.w && item.h ? Math.min(Math.round(w * item.h / item.w), 900) : Math.round(w * 0.6);
    const fresh = this.fresh === item.id;
    const btn = (id, label, tip, fn) => div().id(`${id}-${item.id}`).h(22).px(6).flex().items_center().rounded(5).text_size(12)
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); fn(cx); }).child(label);
    return v_flex().id(`card-${item.id}`).flex_none().gap(6)
      .child(h_flex().gap(6).items_center().text_size(12)
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(item.title || item.name))
        .when(Boolean(item.marked_from), (e) => e.child(div().px(4).rounded(4).text_size(10).bg(t.accent + "33").text_color(t.accent).child("marked")))
        .child(div().text_size(11).text_color(t.dim).child(clock(item.time)))
        .child(btn("del", "✕", "Remove", (cx) => this.remove(item, cx)))
        .child(btn("send", "➜", "Send back", () => sendBack(item, item.abs))))
      .child(div().id(`img-${item.id}`).w(w).h(h).rounded(8).overflow_hidden().border_1()
        .border_color(t.border).cursor_pointer()
        .on_click((e) => ((e?.click_count ?? 1) >= 2 ? openEditor(item) : goToSession(item)))
        .child(image(item.file).w(w).h(h)));
  }

  // ---- editor --------------------------------------------------------------------------------

  initEditor(p, cx) {
    this.editor = p.editor; this.overlay = p.overlay;
    this.shapes = []; this.draft = null; this.tool = "pen"; this.color = COLORS[0];
    this.area = { width: 800, height: 600 }; this.status = ""; this.savedFor = -1; this.saved = null;
    this.list = []; this.marks = {};
    this.handle = cx.focus_handle();
    this.note = InputState.new({ placeholder: "Note, Enter to place" });
    this.note.on("submit", (_e, cx) => {
      const text = this.note.value().trim();
      if (text && this.textAt) this.push({ type: "text", color: this.color, size: TEXT / this.scale, at: this.textAt, text });
      this.textAt = null; this.note.set_value(""); this.handle.focus(); cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "demo" && this.item) {
          const W = this.item.w, H = this.item.h, w = STROKE / this.scale;
          this.shapes = [
            { type: "ellipse", color: COLORS[0], width: w, from: [W * 0.08, H * 0.1], to: [W * 0.4, H * 0.45] },
            { type: "arrow", color: COLORS[2], width: w, from: [W * 0.7, H * 0.8], to: [W * 0.45, H * 0.5] },
            { type: "rect", color: COLORS[3], width: w, from: [W * 0.55, H * 0.1], to: [W * 0.9, H * 0.35] },
            { type: "pen", color: COLORS[4], width: w, points: [[W * 0.1, H * 0.8], [W * 0.15, H * 0.75], [W * 0.2, H * 0.82], [W * 0.25, H * 0.74]] },
            { type: "text", color: COLORS[0], size: TEXT / this.scale, at: [W * 0.42, H * 0.08], text: "align with card edge" },
            { type: "badge", color: COLORS[0], size: BADGE / this.scale, at: [W * 0.92, H * 0.38], n: 1 },
          ];
        }
        if (c === "probe" && this.item) {
          const W = this.item.w, H = this.item.h, w = STROKE / this.scale;
          this.shapes = [
            { type: "rect", color: COLORS[0], width: w, from: [W * 0.02, H * 0.02], to: [W * 0.98, H * 0.98] },
            { type: "pen", color: COLORS[2], width: w, points: [[W * 0.5, 0], [W * 0.5, H]] },
            { type: "badge", color: COLORS[3], size: BADGE / this.scale, at: [W * 0.98, H * 0.5], n: 9 },
            { type: "badge", color: COLORS[3], size: BADGE / this.scale, at: [W * 0.5, H * 0.5], n: 5 },
          ];
        }
        if (c === "next") this.step(1, cx);
        if (c === "prev") this.step(-1, cx);
        if (c === "save") this.act("save", cx);
        if (c === "send") { this.act("send", cx); return; }
        cx.notify();
      }
    });
    cx.spawn(async (cx) => {
      try { this.item = JSON.parse(await fs.readFile(J(INBOX, `${this.editor}.json`), "utf8")); }
      catch (e) { this.status = `Cannot open: ${e}`; }
      try {
        // Same order as the panel (sections in order), so ←/→ walk the cards the user sees.
        this.list = groupItems(await readItems(), true).flatMap((s) => s.items);
      } catch { }
      this.handle.focus(); cx.notify();
    });
  }

  // ←/→: previous/next image. Marks stay with their image while the editor is open.
  step(d, cx) {
    if (this.busy || !this.item || this.list.length < 2) return;
    const i = this.list.findIndex((x) => x.id === this.item.id);
    const j = i < 0 ? 0 : Math.max(0, Math.min(this.list.length - 1, i + d));
    if (j === i) return;
    this.marks[this.item.id] = { shapes: this.shapes, saved: this.saved, savedFor: this.savedFor };
    const next = this.list[j], m = this.marks[next.id] ?? { shapes: [], saved: null, savedFor: -1 };
    this.item = next; this.editor = next.id;
    this.shapes = m.shapes; this.saved = m.saved; this.savedFor = m.savedFor;
    this.draft = null; this.textAt = null; this.note.set_value(""); this.status = "";
    cx.notify();
  }

  push(shape) { this.shapes = [...this.shapes, shape]; this.status = ""; }

  get scale() {
    const it = this.item; if (!it?.w) return 1;
    // on_size_change reports window px; layout sizes are window px / zoom (else the canvas is ~10% too big and gets cropped)
    const z = settings()?.zoom || 1;
    return Math.min((this.area.width / z - 32) / it.w, (this.area.height / z - 32) / it.h, 2);
  }

  // Mouse -> image px. Event coords are window px, which differ from layout px by herdr's UI zoom
  // (canvas laid out 1280 wide reported 1408), so normalize by the box GPUI reports, not by this.scale.
  pos(e) {
    const it = this.item, b = e.bounds, wp = e.position, lp = e.local_position;
    let x, y;
    if (it?.w && b?.width > 0 && b?.height > 0 && wp) { x = (wp.x - b.x) / b.width * it.w; y = (wp.y - b.y) / b.height * it.h; }
    else { const p = lp ?? { x: 0, y: 0 }; x = p.x / this.scale; y = p.y / this.scale; }
    return [Math.max(0, Math.min(it?.w ?? x, x)), Math.max(0, Math.min(it?.h ?? y, y))];
  }

  down(e, cx) {
    const at = this.pos(e), w = STROKE / this.scale;
    if (this.textAt) { this.textAt = null; this.note.set_value(""); }
    if (this.tool === "pen") this.draft = { type: "pen", color: this.color, width: w, points: [at] };
    else if (this.tool === "badge") this.push({ type: "badge", color: this.color, size: BADGE / this.scale, at, n: this.shapes.filter((s) => s.type === "badge").length + 1 });
    else if (this.tool === "text") { this.textAt = at; this.note.focus(); }
    else this.draft = { type: this.tool, color: this.color, width: w, from: at, to: at };
    cx.notify();
  }

  move(e, cx) {
    if (!this.draft) return;
    const at = this.pos(e);
    if (this.draft.type === "pen") {
      const last = this.draft.points[this.draft.points.length - 1];
      if (Math.hypot(at[0] - last[0], at[1] - last[1]) * this.scale < 2) return;
      this.draft.points.push(at);
    } else this.draft.to = at;
    cx.notify();
  }

  up(cx) {
    const d = this.draft; this.draft = null;
    if (!d) return;
    const big = d.type === "pen" ? d.points.length > 1 : Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) * this.scale > 4;
    if (big) this.push(d);
    cx.notify();
  }

  undo(cx) { this.shapes = this.shapes.slice(0, -1); this.status = ""; cx.notify(); }

  // Burns the shapes into <name>.marked.png and adds it to the inbox (once per set of shapes).
  async flatten() {
    if (!this.shapes.length) return this.item.abs;
    if (this.savedFor === this.shapes.length && this.saved) return this.saved.abs;
    const stamp = Date.now(), stem = this.item.name.replace(/\.[^.]+$/, "");
    const shapesFile = J(TMP, `${this.item.id}-${stamp}.json`);
    await writeTextFile(shapesFile, JSON.stringify(this.shapes), null);
    const out = J(TMP, `${this.item.id}-${stamp}`, `${stem}.marked.png`);
    const f = await PS("show-flatten.ps1", ["-In", this.item.abs, "-Shapes", shapesFile, "-Out", out]);
    if (f.code !== 0) throw new Error(f.stderr || f.stdout);
    const a = await PS("show-add.ps1", ["-Path", out, "-Title", `${this.item.title || this.item.name} (marked)`,
      "-Terminal", this.item.terminal ?? "", "-Group", this.item.group ?? "", "-MarkedFrom", this.item.id, "-NoReveal"]);
    if (a.code !== 0) throw new Error(a.stderr || a.stdout);
    this.saved = JSON.parse(a.stdout.trim().split("\n").pop()); this.savedFor = this.shapes.length;
    try { await fs.unlink(shapesFile); } catch { }
    return this.saved.abs;
  }

  act(kind, cx) {
    if (this.busy || !this.item) return;
    this.busy = kind; this.status = kind === "save" ? "Saving…" : "Sending…"; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const path = await this.flatten();
        if (kind === "save") this.status = this.shapes.length ? `Saved ${this.saved.name}` : "Nothing marked yet";
        else if (!await sendBack(this.item, path, () => { this.closed = true; closeOverlay(this.overlay); })) this.status = "Not sent";
      } catch (e) { this.status = `Failed: ${e}`; }
      finally { this.busy = null; if (!this.closed) cx.notify(); }
    });
  }

  shapeEl(s, k) {
    const sc = this.scale, P = (pt) => [pt[0] * sc, pt[1] * sc], w = Math.max(1, s.width * sc);
    const layer = (path) => div().absolute().inset_0().child(globalThis.window.paint_path(path, s.color));
    if (s.type === "pen") {
      let b = PathBuilder.stroke(w).move_to(...P(s.points[0]));
      for (const pt of s.points.slice(1)) b = b.line_to(...P(pt));
      return layer(b.build());
    }
    if (s.type === "arrow") {
      const [x1, y1] = P(s.from), [x2, y2] = P(s.to), a = Math.atan2(y2 - y1, x2 - x1), len = Math.max(12, w * 4);
      let b = PathBuilder.stroke(w).move_to(x1, y1).line_to(x2, y2);
      for (const d of [0.5, -0.5]) b = b.move_to(x2, y2).line_to(x2 - len * Math.cos(a + d), y2 - len * Math.sin(a + d));
      return layer(b.build());
    }
    if (s.type === "rect" || s.type === "ellipse") {
      const [x1, y1] = P(s.from), [x2, y2] = P(s.to);
      const pts = s.type === "rect"
        ? [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
        : Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * Math.PI * 2; return [(x1 + x2) / 2 + Math.cos(a) * Math.abs(x2 - x1) / 2, (y1 + y2) / 2 + Math.sin(a) * Math.abs(y2 - y1) / 2]; });
      return layer(PathBuilder.stroke(w).add_polygon(pts, true).build());
    }
    if (s.type === "text") {
      const [x, y] = P(s.at);
      return div().absolute().left(x).top(y).text_size(s.size * sc).font_semibold().text_color(s.color).whitespace_nowrap().child(s.text);
    }
    if (s.type === "badge") {
      const [x, y] = P(s.at), d = s.size * sc;
      return div().absolute().left(x - d / 2).top(y - d / 2).w(d).h(d).rounded(d / 2).bg(s.color)
        .flex().items_center().justify_center().text_size(d * 0.55).font_semibold().text_color("#ffffff").child(String(s.n));
    }
    return div();
  }

  renderEditor(cx) {
    const t = theme(), it = this.item, sc = this.scale;
    const tb = (id, label, on, fn) => div().id(id).h(28).px(9).flex().items_center().rounded(6).text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { fn(cx); cx.notify(); }).child(label);
    const solid = (id, label, fn) => div().id(id).h(28).px(12).flex().items_center().rounded(6).text_size(12)
      .bg(this.busy ? t.raised : t.solid).text_color(this.busy ? t.dim : t.solid_foreground).cursor_pointer()
      .on_click((_e, cx) => fn(cx)).child(label);
    const toolbar = h_flex().h(46).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .when(this.list.length > 1, (e) => {
        const i = this.list.findIndex((x) => x.id === it?.id);
        return e.child(tb("prev", "‹", false, (cx) => this.step(-1, cx)))
          .child(div().text_size(11).text_color(t.dim).child(`${i + 1}/${this.list.length}`))
          .child(tb("next", "›", false, (cx) => this.step(1, cx)));
      })
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(it ? (it.title || it.name) : "…"))
      .child(div().w(10).flex_none())
      .children(COLORS.map((c) => div().id(`color-${c}`).size(18).rounded(9).bg(c).cursor_pointer()
        .border_2().border_color(this.color === c ? t.foreground : t.border)
        .on_click((_e, cx) => { this.color = c; cx.notify(); })))
      .child(div().w(8))
      .child(tb("undo", "Undo", false, (cx) => this.undo(cx)))
      .child(tb("clear", "Clear", false, () => { this.shapes = []; }))
      .child(div().max_w(240).min_w(0).whitespace_nowrap().truncate().text_size(11).text_color(t.dim).text_right().child(this.status.split(String.fromCharCode(10))[0]))
      .child(tb("open", "Open", false, () => it && openExternal(it.abs)))
      .child(tb("save", "Save copy", false, (cx) => this.act("save", cx)))
      .child(solid("send", "Send back ➜", (cx) => this.act("send", cx)))
      .child(tb("close", "✕", false, () => closeOverlay(this.overlay)));

    const dw = it?.w ? Math.round(it.w * sc) : 0, dh = it?.h ? Math.round(it.h * sc) : 0;
    const shapes = this.draft ? [...this.shapes, this.draft] : this.shapes;
    const canvas = !it ? div().text_color(t.dim).child(this.status || "Loading…")
      : div().id("canvas").relative().w(dw).h(dh).flex_none().cursor_crosshair()
        .on_mouse_down("left", (e, cx) => this.down(e, cx))
        .on_mouse_move((e, cx) => this.move(e, cx))
        .on_mouse_up("left", (_e, cx) => this.up(cx))
        .on_hover((h, cx) => { if (!h) this.up(cx); })
        .child(image(it.file).w(dw).h(dh))
        .children(shapes.map((s, i) => this.shapeEl(s, i)))
        .when(Boolean(this.textAt), (e) => e.child(div().absolute().left(this.textAt[0] * sc).top(this.textAt[1] * sc)
          .w(240).h(30).px(8).flex().items_center().rounded(6).bg(t.popover).border_1().border_color(t.accent)
          .on_mouse_down("left", stop)
          .child(Input.new(this.note).h_full().text_size(12).text_color(t.foreground))));

    return v_flex().id("show-editor").size_full().min_h(0).bg(t.surface).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const mod = e.modifiers?.control || e.modifiers?.platform;
        if (mod && e.key === "z") { this.undo(cx); cx.stop_propagation(); }
        if (!this.textAt && (e.key === "left" || e.key === "right")) { this.step(e.key === "left" ? -1 : 1, cx); cx.stop_propagation(); }
        if (e.key === "escape" && this.textAt) { this.textAt = null; this.note.set_value(""); cx.stop_propagation(); cx.notify(); }
      })
      .child(toolbar)
      .child(h_flex().id("area").flex_1().min_h(0).items_center().justify_center().bg(t.canvas).overflow_hidden()
        .on_size_change((size, cx) => {
          if (Math.abs(size.width - this.area.width) > 1 || Math.abs(size.height - this.area.height) > 1) { this.area = size; cx.notify(); }
        })
        .child(canvas));
  }
}
