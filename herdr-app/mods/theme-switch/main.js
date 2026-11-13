// Theme switch: pick a theme (+ its wallpaper) for the main-dynamic-tabs layout.
// Theme -> app.theme + first background. Thumbnail -> background only.
// Layout edits go through writeTextFile with `expected` (compare-and-swap write).
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, settings, readTextFile, writeTextFile, appHome, closeOverlay, props, nextCommand } from "herdr";

const LAYOUT = "layouts/main-dynamic-tabs.json";
const STATE = "layouts/.state/main-dynamic-tabs.json";
const SEP = appHome().includes("\\") ? "\\" : "/";
const abs = (rel) => [appHome(), ...rel.split("/")].join(SEP);
const thumbOf = (p) => p.replace(/\/([^/]+)$/, "/thumbs/$1");

const NEBULA = { chrome: "#1a0f2499", surface: "#1c102899", sidebar: "#1a1024b3" };

async function readJson(rel) {
  const txt = await readTextFile(abs(rel));
  return txt == null ? null : JSON.parse(txt);
}

function findNode(n, id) {
  if (n.id === id) return n;
  for (const c of n.children ?? []) { const r = findNode(c, id); if (r) return r; }
  return null;
}

// img = image path, or null for an opaque theme-colored background.
async function writeLayout(entry, img) {
  const path = abs(LAYOUT);
  const txt = await readTextFile(path);
  const root = JSON.parse(txt);
  const nl = txt.endsWith("\n") ? "\n" : "";
  const nebula = entry.name === "nebula";
  const hex = entry.bg;
  root.background = img ? { image: img, fit: "cover" } : hex;
  root.colors = { ...(root.colors ?? {}),
    chrome: nebula ? NEBULA.chrome : hex + "99",
    surface: nebula ? NEBULA.surface : hex + "99",
    canvas: "#00000000" };
  const sb = findNode(root, "sidebar");
  if (sb) delete sb.background;   // no extra tint: the sidebar shows the wallpaper like the panes
  let out = JSON.stringify(root, null, 2) + nl;
  if (txt.includes("\r\n")) out = out.replace(/\n/g, "\r\n");   // keep the file's line endings
  await writeTextFile(path, out, txt);
}

// Also store the theme name: ring's layout.set wipes layouts/.state/<layout>.json (where app.theme
// keeps the pick), and the app then falls back to settings.json "theme".
async function writeAppearance(mode, name) {
  const path = abs("settings.json");
  const txt = await readTextFile(path);
  if (txt == null) return;
  const s = JSON.parse(txt);
  if (s.appearance === mode && s.theme === name) return;
  s.appearance = mode;
  s.theme = name;
  let out = JSON.stringify(s, null, 2) + (txt.endsWith("\n") ? "\n" : "");
  if (txt.includes("\r\n")) out = out.replace(/\n/g, "\r\n");
  await writeTextFile(path, out, txt);
}

export default class ThemeSwitch extends View {
  init(_p, cx) {
    this.overlay = props()?.overlay;
    this.entries = []; this.sel = 0; this.curTheme = null; this.curBg = null; this.status = "";
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      await this.load();
      this.handle.focus(); cx.notify();
      for (;;) {   // test commands: theme-switch.apply:<theme>, theme-switch.bg:<n> (-1 = none)
        const c = String(await nextCommand());
        const k = c.split(":")[0], v = c.slice(c.indexOf(":") + 1);
        if (k === "apply") { const i = this.entries.findIndex((e) => e.name === v); if (i >= 0) { this.sel = i; await this.applyTheme(this.entries[i]); } }
        if (k === "bg") { const e = this.entries[this.sel]; const n = Number(v); await this.applyBg(e, n < 0 ? null : e.images[n]); }
        await this.refreshCurrent(); cx.notify();
      }
    });
  }

  async load() {
    const entries = [];
    const own = [
      { name: "nebula", images: ["backgrounds/purple-stars-hd.jpg", "backgrounds/purple-space.png", "backgrounds/extra/nebula/1-wallhaven-9mjw78.jpg"], thumbs: ["backgrounds/thumbs/purple-stars-hd.jpg", "backgrounds/thumbs/purple-space.jpg", "backgrounds/extra/nebula/thumbs/1-wallhaven-9mjw78.jpg"] },
    ];
    for (const o of own) {
      const j = await readJson(`themes/${o.name}.json`);
      entries.push({ ...o, mode: "dark", bg: j?.background ?? "#000000", accent: j?.colors?.accent ?? j?.ansi?.[4] ?? "#888888" });
    }
    const idx = (await readJson("backgrounds/omarchy/index.json")) ?? [];
    for (const i of idx) {
      entries.push({ name: i.theme, mode: i.mode, bg: i.background, accent: i.accent, images: i.backgrounds, thumbs: i.backgrounds.map(thumbOf) });
    }
    this.entries = entries;
    await this.refreshCurrent();
    const i = entries.findIndex((e) => e.name === this.curTheme);
    this.sel = i >= 0 ? i : 0;
  }

  async refreshCurrent() {
    try {
      const st = await readJson(STATE);
      const light = settings().dark === false;
      this.curTheme = st?.theme ? (light ? st.theme.light : st.theme.dark) : (await readJson("settings.json"))?.theme ?? null;
      const lay = await readJson(LAYOUT);
      this.curBg = lay?.background?.image ?? null;
    } catch (e) { this.status = `${e}`; }
  }

  async applyBg(entry, img) {
    try { await writeLayout(entry, img); this.status = ""; }
    catch (e) { this.status = `Failed: ${e}`; }
  }

  async applyTheme(entry) {
    try {
      await writeAppearance(entry.mode === "light" ? "light" : "dark", entry.name);
      run("app.theme", { name: entry.name });
      if (entry.images.length) await writeLayout(entry, entry.images[0]);
      this.status = "";
    } catch (e) { this.status = `Failed: ${e}`; }
  }

  // One apply at a time; rapid picks (held arrow key) collapse to the latest wanted one.
  enqueue(job, cx) {
    this.want = job;
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        while (this.want) { const j = this.want; this.want = null; await j(); }
        const shown = this.curTheme;
        await this.refreshCurrent();
        // .state / settings().dark update asynchronously; keep the theme we just applied.
        if (this.applied) { this.curTheme = this.applied; this.applied = null; } else if (!this.curTheme) this.curTheme = shown;
      } finally { this.busy = false; }
      cx.notify();
    });
  }

  pickTheme(i, cx) {
    this.sel = i;
    const e = this.entries[i];
    this.enqueue(async () => { await this.applyTheme(e); this.applied = e.name; }, cx);
    cx.notify();
  }

  pickBg(img, cx) {
    const e = this.entries[this.sel];
    this.enqueue(() => this.applyBg(e, img), cx);
  }

  render(cx) {
    const t = theme();
    const e = this.entries[this.sel];
    const row = (en, i) => {
      const on = i === this.sel, cur = en.name === this.curTheme;
      return h_flex().id(`th-${en.name}`).h(34).flex_none().px(10).gap(9).items_center().rounded(7).cursor_pointer()
        .bg(on ? t.selected : t.surface).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.pickTheme(i, cx))
        .child(h_flex().w(26).h(16).flex_none().rounded(4).overflow_hidden().border_1().border_color(t.border)
          .child(div().flex_1().h_full().bg(en.bg)).child(div().w(9).h_full().bg(en.accent)))
        .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(en.name))
        .when(cur, (el) => el.child(div().size(6).rounded(3).bg(t.accent)))
        .child(div().px(5).h(16).flex().items_center().rounded(4).text_size(10).border_1().border_color(t.border)
          .text_color(t.dim).child(en.mode));
    };
    const tile = (id, on, child, fn) => div().id(id).w(176).h(110).flex_none().rounded(8).overflow_hidden().relative().cursor_pointer()
      .border_2().border_color(on ? t.accent : t.border).hover((s) => s.border_color(on ? t.accent : t.input))
      .on_click((_e, cx) => fn(cx)).child(child);
    const none = e ? tile("bg-none", this.curBg == null, div().size_full().bg(e.bg).flex().items_center().justify_center()
      .text_size(12).text_color(t.muted).child("No image"), (cx) => this.pickBg(null, cx)) : div();

    return v_flex().id("theme-switch").size_full().min_h(0).bg(t.surface).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((ev, cx) => {
        if (ev.key === "escape") { closeOverlay(this.overlay); cx.stop_propagation(); }
        else if (ev.key === "down" || ev.key === "up") {
          const n = this.entries.length; if (!n) return;
          this.pickTheme((this.sel + (ev.key === "down" ? 1 : n - 1)) % n, cx); cx.stop_propagation();
        }
      })
      .child(h_flex().h(42).flex_none().px(14).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Themes"))
        .child(div().flex_1().px(12).truncate().text_size(11).text_color(t.dim).child(this.status || "Click a theme to apply it with its wallpaper · click a thumbnail for the wallpaper only"))
        .child(div().id("ts-close").h(26).px(8).flex().items_center().rounded(6).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click(() => closeOverlay(this.overlay)).child("✕")))
      .child(h_flex().flex_1().min_h(0)
        .child(v_flex().id("ts-list").w(270).flex_none().h_full().overflow_y_scroll().p(8).gap(2).border_r(1).border_color(t.border)
          .children(this.entries.map(row)))
        .child(v_flex().flex_1().min_w(0).h_full().p(14).gap(10)
          .child(div().text_color(t.muted).child(e ? `${e.name} backgrounds` : ""))
          .child(div().id("ts-grid").flex_1().min_h(0).overflow_y_scroll()
            .child(h_flex().flex_wrap().gap(10)
              .children((e?.images ?? []).map((img, i) => tile(`bg-${i}`, this.curBg === img,
                image(e.thumbs[i]).w(172).h(106), (cx) => this.pickBg(img, cx))))
              .child(none)))));
  }
}
