// Todo: a kanban board that covers everything right of the left sidebar (layout stack `work-stack`).
//
// Data: <appHome>/data/todo/board.json  { version, columns: [{ id, name, cards: [{ id, text, desc?, images? }] }] }  (desc = optional multi-line description;
// images = optional file names inside data/todo/images/<cardId>/, added by Ctrl+V, dropping files on a card/column or the "Add photo" picker in edit mode)
// Global board (not per space). Loaded on start, saved after every change, re-read every 5 s when the
// file changed on disk (and nothing is unsaved). gpui-kit has no in-app drag payloads (on_drop only takes
// external files), so cards are dragged by hand from mouse events (press, move > 5 px, release; see "drag & drop"),
// or moved with the ‹ › ↑ ↓ buttons that appear on hover and Ctrl+arrows.
//
// Commands (`herdr-app do todo.<cmd>`; delivered to a SHOWN copy only): toggle, add:<text>, demo (in-memory demo board,
// never saved), reload (back to the file). Look: theme() colors only, translucent so the wallpaper shows.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar } from "gpui-base";
import { appHome, exec, notify, run, theme, layout, nextCommand, readTextFile, writeTextFile, agents, shared, setShared, watchFolder } from "herdr";
import * as fs from "fs/promises";

const SEP = appHome().includes("\\") ? "\\" : "/";
const DIR = [appHome(), "data", "todo"].join(SEP);
const FILE = [DIR, "board.json"].join(SEP);
const STATUS_DIR = [DIR, "status"].join(SEP);   // <cardId>.json written by the dispatcher (my-spaces) and bin/todo-status.ps1
const BRIEF_DIR = [DIR, "briefs"].join(SEP);    // <cardId>.md, the agent's task
const IMG_DIR = [DIR, "images"].join(SEP);      // <cardId>/<timestamp>-<rand>.<ext>, the card's photos
const BIN = [appHome(), "mods", "todo", "bin"].join(SEP);
const STACK = "work-stack";
const DRAG_TTL = 20000;                         // a cross-mod drag (shared "todo.drag") dies after this many ms
const ID_OK = /^[\w-]{1,64}$/;
const STATES = ["in_progress", "done", "blocked"];

const MAX_TEXT = 2000, MAX_DESC = 10000, MAX_NAME = 60;
const cleanDesc = (d) => String(d ?? "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_DESC);
const stop = (_e, cx) => cx.stop_propagation();
// Theme hex (#rrggbb or #rrggbbaa) with another alpha; anything else is returned untouched.
const alpha = (c, a) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c) ? c.slice(0, 7) + a : c);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const MAX_IMAGES = 20, THUMB = 56, SHOWN = 4;
const IMG_NAME = /^[\w.-]{1,80}$/, IMG_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;
const imgOk = (n) => typeof n === "string" && IMG_NAME.test(n) && IMG_EXT.test(n);   // also keeps a name like ".." or "x.exe" out of paths and explorer
const newImgName = (ext) => `${Date.now()}-${Math.random().toString(36).slice(2, 7).padEnd(5, "0")}${ext}`;
const safeId = (s) => String(s ?? "").replace(/[^\w-]/g, "_").slice(0, 40);

const defaultBoard = () => ({
  version: 1,
  columns: [
    { id: "todo", name: "Todo", cards: [] },
    { id: "doing", name: "In progress", cards: [] },
    { id: "done", name: "Done", cards: [] },
  ],
});

// The agent a card was handed to: { terminal, space, space_name, tab, state, summary, started, finished, applied }.
// `applied` = the state the board last reacted to (moved the card for); a user's later drag is not undone.
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
function cleanAgent(a) {
  if (!a || typeof a !== "object" || !STATES.includes(a.state)) return null;
  return {
    terminal: str(a.terminal, 40), space: str(a.space, 80), space_name: str(a.space_name, 120), tab: str(a.tab, 80),
    state: a.state, summary: str(a.summary, 2000), started: str(a.started, 40), finished: str(a.finished, 40),
    applied: STATES.includes(a.applied) ? a.applied : "",
  };
}

// Accepts only the expected shape; ids are made unique so element ids never clash.
function sanitize(raw) {
  if (!raw || !Array.isArray(raw.columns)) return null;
  const seen = new Set();
  const unique = (id) => { let x = safeId(id) || uid(); while (seen.has(x)) x = uid(); seen.add(x); return x; };
  const columns = raw.columns.filter((c) => c && typeof c === "object").slice(0, 12).map((c) => ({
    id: unique(c.id),
    name: String(c.name ?? "").slice(0, MAX_NAME) || "Column",
    cards: (Array.isArray(c.cards) ? c.cards : []).filter((k) => k && typeof k === "object").slice(0, 500)
      .map((k) => {
        const desc = cleanDesc(k.desc), agent = cleanAgent(k.agent), images = Array.isArray(k.images) ? [...new Set(k.images.filter(imgOk))].slice(0, MAX_IMAGES) : [];
        return { id: unique(k.id), text: String(k.text ?? "").slice(0, MAX_TEXT), ...(desc ? { desc } : {}), ...(images.length ? { images } : {}), ...(agent ? { agent } : {}) };
      }),
  }));
  return columns.length ? { version: 1, columns } : null;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}

const DEMO = [
  ["Todo", ["Review the ship queue before the next bundle", "Fix the flaky login test on CI", "Write release notes for 2.4", "Answer customer mail about invoices"]],
  ["In progress", ["Kanban board in herdr: columns, cards, persistence", "Migrate the nightly job to the new queue"]],
  ["Done", ["Wallpapers for all themes", "Space dedupe mod", "Agents sidebar sorting"]],
];

export default class Todo extends View {
  init(_props, cx) {
    this.board = defaultBoard();
    this.disk = null;              // text last read from / written to the file (compare-and-swap token)
    this.loaded = false; this.demo = false; this.saving = false; this.dirty = false;
    this.edit = null;              // { card, col } while a card's text is edited
    this.renaming = null;          // column id while its name is edited
    this.armed = null;             // column id armed for deletion (2nd click deletes)
    this.hoverCard = null; this.hotCol = null;
    this.sel = null;               // card id selected by a click; ctrl + arrows move it
    this.press = null;             // { card, col, x, y, fresh } left button held on a card (drag candidate)
    this.drag = null;              // { card, fromCol, toCol, index } once the pointer moved > DRAG_PX; index null = end of column
    this.hit = null;               // { col, index } set by the card/column/filler under the pointer, read by the root's mouse move
    this.noClickUntil = 0;         // swallows the click a finished drag would otherwise produce
    this.left = false;             // the pointer left the board during a drag (the cross-mod drag lives on, shared "todo.drag")
    this.dragTs = 0;               // ts of the todo.drag value this copy published
    this.loading = false; this.again = false;
    this.busyImg = false;          // a paste / file picker run is in flight (one at a time)
    this.dropAt = 0;              // ms of the last drop a card handled (the column under it must not handle it again)
    this.handle = cx.focus_handle();
    this.adds = {};                // column id -> InputState of its "add card" field

    this.editInput = InputState.new({ placeholder: "Card text, Enter to save" });
    this.editInput.on("submit", (_e, cx) => { if (this.commitEdit()) this.save(cx); cx.notify(); });
    this.descInput = TextareaState.new({ placeholder: "Description (optional), Ctrl+Enter to save" });
    // A focused Input/Textarea takes Ctrl+V itself (the root key handler never sees it); `paste_other` = the paste found no text (an image or copied files).
    this.editInput.on("paste_other", (_e, cx) => { if (this.edit) this.paste(this.edit.card, cx); });
    this.descInput.on("paste_other", (_e, cx) => { if (this.edit) this.paste(this.edit.card, cx); });
    this.descInput.set_auto_grow(3, 12);
    this.descInput.on("submit", (e, cx) => { if (e?.secondary) { if (this.commitEdit()) this.save(cx); cx.notify(); } });   // Enter = newline, Ctrl+Enter = save
    this.nameInput = InputState.new({ placeholder: "Column name, Enter to save" });
    this.nameInput.on("submit", (_e, cx) => { if (this.commitRename()) this.save(cx); cx.notify(); });

    this.ensureInputs();
    this.load(cx);
    cx.timer.every(5000, (cx) => { if (!this.demo && !this.dirty && !this.saving && !this.edit && !this.renaming) this.load(cx); });
    // The dispatcher / todo-status.ps1 write data/todo/status/<card>.json: react at once, the timer above is the fallback.
    cx.spawn(async (cx) => {
      try { await fs.mkdir(STATUS_DIR, { recursive: true }); await fs.mkdir(BRIEF_DIR, { recursive: true }); } catch { }
      try { for (;;) { await watchFolder(STATUS_DIR); if (!this.demo) this.load(cx); } } catch { /* no watch: the 5 s timer covers it */ }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "toggle") this.toggle();
        if (c === "demo") this.setDemo();
        if (typeof c === "string" && c.startsWith("del:")) { const k = this.board.columns.find((k) => k.cards.some((x) => x.id === c.slice(4))); if (k) this.deleteCard(k.id, c.slice(4), cx); }   // todo.del:<cardId> (scripting; also removes its status and brief)
        if (c === "dragdemo") setShared("todo.drag", { card: this.board.columns.flatMap((k) => k.cards)[0]?.id ?? "demo", text: "Demo card", ts: Date.now(), demo: true });   // screenshots: highlights a space row without a mouse
        if (typeof c === "string" && c.startsWith("add:") && this.board.columns[0]) { this.addCard(this.board.columns[0].id, c.slice(4), cx); }   // todo.add:<text> (scripting)
        if (c === "paste") this.paste(null, cx);   // todo.paste: the same as Ctrl+V (scripting)
        if (typeof c === "string" && c.startsWith("paste:")) this.paste(c.slice(6), cx);   // todo.paste:<cardId>
        if (typeof c === "string" && c.startsWith("attach:")) { const i = c.indexOf(":", 7); if (i > 7) this.attachFiles(c.slice(7, i), [c.slice(i + 1)], null, cx); }   // todo.attach:<cardId>:<absolute path> (scripting)
        if (typeof c === "string" && c.startsWith("edit:")) { const h = this.findCard(c.slice(5)); if (h) this.startEdit(h.col.id, h.card); }   // todo.edit:<cardId> (scripting: opens the edit form)
        if (c === "reload") { this.demo = false; this.disk = null; this.load(cx); }
        cx.notify();
      }
    });
  }

  toggle() {
    const open = find(layout(), STACK)?.active === "todo";
    run("layout.select", { stack: STACK, child: open ? "work-body" : "todo" });
  }

  ensureInputs() {
    for (const col of this.board.columns) {
      if (this.adds[col.id]) continue;
      const st = InputState.new({ placeholder: "+ Add card" });
      const id = col.id;
      st.on("submit", (_e, cx) => { this.addCard(id, st.value(), cx); st.set_value(""); cx.notify(); });
      st.on("paste_other", (_e, cx) => this.paste(null, cx, id));   // image pasted into "+ Add card": a new card in this column
      this.adds[id] = st;
    }
  }

  setDemo() {
    this.demo = true; this.edit = null; this.renaming = null;
    this.board = { version: 1, columns: DEMO.map(([name, cards], i) => ({ id: `demo${i}`, name, cards: cards.map((text, j) => ({ id: `demo${i}-${j}`, text })) })) };
    this.ensureInputs();
  }

  // ---- persistence ---------------------------------------------------------------------------

  // Reads the file; creates it with the default columns if missing. Skips an unchanged file.
  load(cx) {
    if (this.loading) { this.again = true; return; }   // one at a time: a second look would race the board it is about to change
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(FILE);
        if (text === null) {
          try { await fs.mkdir(DIR, { recursive: true }); } catch { }
          const fresh = JSON.stringify(defaultBoard(), null, 2) + "\n";
          await writeTextFile(FILE, fresh, null);
          this.disk = fresh; this.board = defaultBoard();
        } else if (text !== this.disk && !this.dirty && !this.saving && !this.demo) {
          let b = null;
          try { b = sanitize(JSON.parse(text)); } catch { }
          this.disk = text;
          if (b) { this.board = b; this.badFile = false; }     // invalid file: keep what is shown, do not overwrite the file
          else this.badFile = true;
        }
      } catch (e) { this.error = String(e); }
      this.loaded = true; this.ensureInputs();
      try { await this.syncStatus(cx); } catch (e) { this.error = String(e); }
      this.loading = false; cx.notify();
      if (this.again) { this.again = false; this.load(cx); }
    });
  }

  // ---- agent tracking --------------------------------------------------------------------------
  // data/todo/status/<card>.json ({ card, state, space, space_name, tab, terminal, summary, started, finished }) is written
  // by the dispatcher (my-spaces) and the agent's last step (bin/todo-status.ps1). Here it becomes `card.agent`; a changed
  // state moves the card once (in_progress -> the "In progress" column, done -> "Done"), later drags by the user stay.
  // Runs inside load(), so it never races a board read. Everything is rebuilt from the files: opening the board catches up.
  async syncStatus(cx) {
    if (this.demo) return;
    let names = [];
    try { names = (await fs.readdir(STATUS_DIR)).filter((n) => n.endsWith(".json") && ID_OK.test(n.slice(0, -5))); } catch { return; }
    const sts = new Map();
    for (const n of names) {
      try {
        const s = JSON.parse(await readTextFile([STATUS_DIR, n].join(SEP)));
        if (s && typeof s === "object" && STATES.includes(s.state)) sts.set(n.slice(0, -5), s);
      } catch { /* half-written or invalid: the next pass sees it */ }
    }
    if (!sts.size || this.demo || this.badFile || this.dirty || this.saving || this.edit || this.renaming || this.press || this.drag) return;   // timer retries
    const cols = this.board.columns;
    const colFor = (re, fallback) => cols.find((c) => re.test(c.name)) ?? fallback;
    let changed = false;
    for (const col of [...cols]) {
      for (const card of [...col.cards]) {
        const s = sts.get(card.id); if (!s) continue;
        const next = cleanAgent({
          terminal: s.terminal, space: s.space, space_name: s.space_name, tab: s.tab, state: s.state, summary: s.summary,
          started: s.started, finished: s.finished, applied: card.agent?.applied,
        });
        if (!next) continue;
        if (next.state !== (card.agent?.applied ?? "")) {   // a new state: move once
          next.applied = next.state;
          const dest = next.state === "in_progress" ? colFor(/in progress|doing|wip/i, cols[1] ?? cols[0])
            : next.state === "done" ? colFor(/done/i, cols[cols.length - 1]) : col;   // blocked stays where it is
          if (dest !== col) { col.cards = col.cards.filter((k) => k !== card); dest.cards.unshift(card); }
        }
        if (JSON.stringify(next) !== JSON.stringify(card.agent)) { card.agent = next; changed = true; }
      }
    }
    if (changed) this.save(cx);
  }

  // Removes a card's brief, status and photos (card deleted).
  dropFiles(cardId) {
    if (!ID_OK.test(cardId)) return;
    for (const f of [[STATUS_DIR, `${cardId}.json`], [BRIEF_DIR, `${cardId}.md`]]) fs.unlink(f.join(SEP)).catch(() => { });
    this.dropImages(cardId);
  }

  // The runtime's fs has no rm: the card's dir is flat, so unlink each file, then rmdir.
  dropImages(cardId) {
    if (!ID_OK.test(cardId)) return;
    const dir = this.imgDir(cardId);
    (async () => { for (const n of await fs.readdir(dir)) if (imgOk(n)) await fs.unlink([dir, n].join(SEP)); await fs.rmdir(dir); })().catch(() => { });
  }

  // Marks the board changed and writes it, one write at a time (the latest state wins).
  save(cx) {
    if (this.demo || this.badFile) return;   // never write demo data or over a hand-edited invalid file
    this.dirty = true;
    if (this.saving) return;
    this.saving = true;
    cx.spawn(async (cx) => {
      let tries = 0;
      try {
        while (this.dirty && tries < 4 && !this.demo) {
          this.dirty = false;
          const text = JSON.stringify(this.board, null, 2) + "\n";
          try { await writeTextFile(FILE, text, this.disk); this.disk = text; this.error = null; this.badFile = false; }
          catch (e) {
            tries++; this.error = String(e);
            try { this.disk = await readTextFile(FILE); } catch { }   // stale snapshot: re-read the token, retry
            this.dirty = true;
          }
        }
      } finally { this.saving = false; cx.notify(); }
    });
  }

  // ---- board operations ----------------------------------------------------------------------

  col(id) { return this.board.columns.find((c) => c.id === id); }

  addCard(colId, raw, cx) {
    const text = String(raw ?? "").trim().slice(0, MAX_TEXT), col = this.col(colId);
    if (!text || !col) return;
    col.cards.push({ id: uid(), text });
    this.save(cx);
  }

  deleteCard(colId, cardId, cx) {
    const col = this.col(colId); if (!col) return;
    col.cards = col.cards.filter((k) => k.id !== cardId);
    if (this.edit?.card === cardId) this.edit = null;
    if (!this.demo) this.dropFiles(cardId);
    this.save(cx);
  }

  // ---- photos ----------------------------------------------------------------------------------
  // Files live in <appHome>/data/todo/images/<cardId>/ (never under mods/: saving there would hot reload the mod); card.images holds
  // the bare names. Sources: Ctrl+V (bin/todo-paste.ps1: clipboard bitmap or copied files), files dropped on a card/column, the
  // "Add photo" picker (bin/todo-pick.ps1). Nothing is added in demo mode or while board.json is invalid.

  imgDir(cardId) { return [IMG_DIR, cardId].join(SEP); }
  imgPath(cardId, name) { return [IMG_DIR, cardId, name].join(SEP); }
  imgRel(cardId, name) { return `data/todo/images/${cardId}/${name}`; }   // what image() wants: relative to appHome
  findCard(id) { for (const col of this.board.columns) { const card = col.cards.find((k) => k.id === id); if (card) return { col, card }; } return null; }
  canAttach() { return !this.demo && !this.badFile; }
  warn(body) { try { notify({ title: "Todo", body, level: "warning" }); } catch { } }

  // Files already sit in the card's image dir. Adds them to the card (made first when `create` {col, text} is given and the card does not exist).
  attachNames(cardId, names, create, cx) {
    const dead = (list) => { for (const n of list) fs.unlink(this.imgPath(cardId, n)).catch(() => { }); };
    names = names.filter(imgOk);
    if (!ID_OK.test(cardId) || !this.canAttach()) { dead(names); return false; }
    let hit = this.findCard(cardId);
    if (!hit && create) {
      const col = this.col(create.col) ?? this.board.columns[0];
      if (col) { const card = { id: cardId, text: String(create.text || "Photo").slice(0, MAX_TEXT) }; col.cards.push(card); hit = { col, card }; }
    }
    if (!hit) { dead(names); this.dropImages(cardId); return false; }   // the card was deleted meanwhile
    const have = hit.card.images ?? [], add = names.filter((n) => !have.includes(n)).slice(0, Math.max(0, MAX_IMAGES - have.length));
    dead(names.filter((n) => !add.includes(n)));
    if (!add.length) return false;
    hit.card.images = [...have, ...add];
    this.save(cx);
    return true;
  }

  // Copies image files (absolute paths, any drive) into the card's dir with bin/todo-copy.ps1 (this runtime's fs has no copyFile and
  // reads only below the home folder), then attaches them.
  async attachFiles(cardId, paths, create, cx) {
    if (!ID_OK.test(cardId) || !this.canAttach()) return false;
    const room = MAX_IMAGES - (this.findCard(cardId)?.card.images?.length ?? 0);
    const files = paths.map(String).filter((p) => IMG_EXT.test(p)).slice(0, Math.max(0, room));
    if (!files.length) { if (room <= 0) this.warn(`A card holds at most ${MAX_IMAGES} photos`); return false; }
    let ok = false;
    try {
      const names = await this.runImageHelper("todo-copy.ps1", this.imgDir(cardId), 60000, files);
      ok = names.length ? this.attachNames(cardId, names, create, cx) : false;
    } catch (e) { this.warn(`Could not copy the photos: ${e?.message ?? e}`); }
    cx.notify();
    return ok;
  }

  // Runs a PowerShell helper that writes new files into `dir` and prints their names.
  async runImageHelper(script, dir, timeout, files = []) {
    const r = await exec("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", [BIN, script].join(SEP), "-Dir", dir, ...files], { timeout });
    if (r.code !== 0) throw new Error((r.stderr || `exit ${r.code}`).trim().slice(0, 200));
    return String(r.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(imgOk);
  }

  // Ctrl+V: the clipboard's image(s) go to `cardId`, else the card being edited / selected / hovered, else a new card in the first column.
  // Text on the clipboard: the helper finds nothing and nothing changes (the key itself is never intercepted).
  paste(cardId, cx, colId) { this.fromHelper("todo-paste.ps1", cardId, 30000, cx, colId); }
  pick(cardId, cx) { this.fromHelper("todo-pick.ps1", cardId, 600000, cx); }

  fromHelper(script, cardId, timeout, cx, colId) {   // colId: no card target, create the new card in this column
    if (this.busyImg || !this.canAttach() || !this.board.columns.length) return;
    const col = (colId && this.col(colId)) || this.board.columns[0];
    const first = (colId && !cardId ? [] : [cardId, this.edit?.card, this.sel, this.hoverCard]).filter((id) => id && this.findCard(id))[0];
    if (cardId && !first) return;   // an explicit card that does not exist
    const hit = first ? this.findCard(first) : null, id = first ?? uid();
    if (hit && (hit.card.images?.length ?? 0) >= MAX_IMAGES) { this.warn(`A card holds at most ${MAX_IMAGES} photos`); return; }
    const create = hit ? null : { col: col.id, text: "Pasted image" };
    this.busyImg = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const names = await this.runImageHelper(script, this.imgDir(id), timeout);
        if (names.length) this.attachNames(id, names, create, cx);
      } catch (e) { this.warn(`${script.includes("pick") ? "Photo picker" : "Paste"} failed: ${e?.message ?? e}`); }
      finally { this.busyImg = false; cx.notify(); }
    });
  }

  removeImage(cardId, name, cx) {
    const card = this.findCard(cardId)?.card; if (!card || !imgOk(name) || !card.images?.includes(name)) return;
    card.images = card.images.filter((n) => n !== name);
    if (!card.images.length) delete card.images;
    if (!this.demo) fs.unlink(this.imgPath(cardId, name)).catch(() => { });
    this.save(cx);
  }

  // Files dropped on a card (attached) or a column (a new card titled after the first image file).
  dropOnCard(cardId, paths, cx) {
    cx.stop_propagation(); this.dropAt = Date.now();
    if (paths.some((p) => IMG_EXT.test(String(p)))) cx.spawn(async (cx) => { await this.attachFiles(cardId, paths, null, cx); });
  }

  dropOnColumn(colId, paths, cx) {
    if (Date.now() - this.dropAt < 300) return;
    const first = paths.find((p) => IMG_EXT.test(String(p)));
    if (!first || !this.col(colId)) return;
    const title = String(first).split(/[\\/]/).pop().replace(/\.[^.]+$/, "").slice(0, 120) || "Photo";
    cx.spawn(async (cx) => { await this.attachFiles(uid(), paths, { col: colId, text: title }, cx); });
  }

  moveCard(colId, cardId, dir, cx) {   // dir: -1 / +1 = previous / next column
    const cols = this.board.columns, i = cols.findIndex((c) => c.id === colId), j = i + dir;
    if (i < 0 || j < 0 || j >= cols.length) return;
    const card = cols[i].cards.find((k) => k.id === cardId); if (!card) return;
    cols[i].cards = cols[i].cards.filter((k) => k.id !== cardId);
    cols[j].cards.push(card);
    this.save(cx);
  }

  shiftCard(colId, cardId, dir, cx) {  // dir: -1 up / +1 down inside the column
    const cards = this.col(colId)?.cards; if (!cards) return;
    const i = cards.findIndex((k) => k.id === cardId), j = i + dir;
    if (i < 0 || j < 0 || j >= cards.length) return;
    [cards[i], cards[j]] = [cards[j], cards[i]];
    this.save(cx);
  }

  // ---- drag & drop (built from mouse events; gpui-kit has no in-app drag payloads) ------------------
  // Stale state is made impossible: the drag is cancelled by mouse up anywhere on the board, by the pointer
  // leaving the board, by Escape and by the next mouse down; moves only count while a press is recorded.

  // Also withdraws the cross-mod drag (shared "todo.drag", read by my-spaces) this copy published.
  cancelDrag() {
    this.press = null; this.drag = null; this.hit = null; this.lastMove = null; this.left = false;
    if (this.dragTs) { this.dragTs = 0; setShared("todo.drag", null); }
  }

  // Where the dragged card would land: { col, from, to } (to = index in the column after removing the card), or null.
  dropTarget() {
    const d = this.drag; if (!d?.toCol) return null;
    const src = this.col(d.fromCol), dst = this.col(d.toCol); if (!src || !dst) return null;
    const from = src.cards.findIndex((k) => k.id === d.card); if (from < 0) return null;
    let at = Math.max(0, Math.min(d.index ?? dst.cards.length, dst.cards.length));
    if (src === dst) { if (at === from || at === from + 1) return null; if (from < at) at--; }   // dropped where it came from
    return { src, dst, from, to: at, rawAt: Math.max(0, Math.min(d.index ?? dst.cards.length, dst.cards.length)) };
  }

  dragMove(e, cx) {
    const hit = this.hit; this.hit = null;
    const p = this.press;
    if (!p) { if (this.drag) { this.cancelDrag(); cx.notify(); } return; }
    // Released outside the window: the mouse-up never reaches the board and MouseMoveEvent has no button
    // state. So cancel when the pointer reaches the board's edge (it is about to leave), and when it comes
    // back after a pause that started near the edge (it left and returned with the button already up).
    const now = Date.now(), lp = e.local_position, bd = e.bounds;
    // Spaces (the cross-mod drop target) is at the top-left and a diagonal drag crosses the tab bar/top: leaving over the
    // TOP or LEFT edge keeps the drag alive for it (this.left, shared "todo.drag"). Only the right/bottom edges cancel;
    // the 20 s expiry and on_mouse_down_out are the safety net for the rest.
    const edge = lp && bd ? Math.min(bd.width - lp.x, bd.height - lp.y) : Infinity;
    const last = this.lastMove; this.lastMove = { t: now, edge };
    if (this.drag && (edge <= 4 || (last && now - last.t > 400 && last.edge <= 40))) { this.cancelDrag(); cx.notify(); return; }
    if (this.drag && lp) this.left = lp.x <= 4;
    if (this.edit || this.renaming) { this.cancelDrag(); cx.notify(); return; }
    let started = false;
    if (!this.drag) {
      if (Math.hypot(e.position.x - p.x, e.position.y - p.y) <= 5) return;   // a click, not a drag
      this.drag = { card: p.card, fromCol: p.col, toCol: null, index: null };
      this.handle.focus();   // so Escape reaches the root
      started = true;
      // Publish the drag so another mod (my-spaces) can take the drop. It dies on mouse up / Escape / the next press
      // outside the board, or after DRAG_TTL.
      const ts = Date.now(), card = this.board.columns.flatMap((k) => k.cards).find((k) => k.id === p.card);
      this.dragTs = ts;
      setShared("todo.drag", { card: p.card, text: String(card?.text ?? "").slice(0, 200), ts });
      cx.timer.after(DRAG_TTL, (cx) => { if (this.dragTs === ts) { this.cancelDrag(); cx.notify(); } });
    }
    const d = this.drag;
    let toCol = null, index = null;
    if (hit) { toCol = hit.col; index = hit.end ? null : hit.index ?? (d.toCol === hit.col ? d.index : null); }
    if (started || toCol !== d.toCol || index !== d.index) { d.toCol = toCol; d.index = index; cx.notify(); }
  }

  dragEnd(cx) {
    if (this.drag) {
      this.noClickUntil = Date.now() + 250;
      const t = this.dropTarget();
      if (t) { const [card] = t.src.cards.splice(t.from, 1); t.dst.cards.splice(t.to, 0, card); this.save(cx); }
    }
    if (this.press || this.drag) { this.cancelDrag(); cx.notify(); }
  }

  startEdit(colId, card) {
    this.renaming = null;
    this.edit = { col: colId, card: card.id };
    this.editInput.set_value(card.text);
    this.descInput.set_value(card.desc ?? "");
    this.editInput.focus();
  }

  // Both commit functions return true when the board changed (the caller saves with its own cx).
  commitEdit() {
    const e = this.edit; if (!e) return false;
    this.edit = null;
    const card = this.col(e.col)?.cards.find((k) => k.id === e.card);
    const desc = cleanDesc(this.descInput.value());
    if (!card) return false;
    const text = this.editInput.value().trim().slice(0, MAX_TEXT) || card.text;   // empty title keeps the old one
    if (text === card.text && desc === (card.desc ?? "")) return false;
    card.text = text;
    if (desc) card.desc = desc; else delete card.desc;
    return true;
  }

  addColumn(cx) {
    const col = { id: uid(), name: "New column", cards: [] };
    this.board.columns.push(col);
    this.ensureInputs();
    this.edit = null; this.renaming = col.id;
    this.nameInput.set_value(col.name); this.nameInput.focus();
    this.save(cx);
  }

  startRename(col) {
    this.edit = null; this.renaming = col.id;
    this.nameInput.set_value(col.name); this.nameInput.focus();
  }

  commitRename() {
    const id = this.renaming; if (!id) return false;
    this.renaming = null;
    const col = this.col(id), name = this.nameInput.value().trim().slice(0, MAX_NAME);
    if (!col || !name || name === col.name) return false;
    col.name = name;
    return true;
  }

  // 1st click arms (3 s), 2nd click deletes the column with its cards.
  deleteColumn(col, cx) {
    if (this.board.columns.length <= 1) return;   // keep at least one column (an empty list is an invalid file)
    if (this.armed !== col.id) {
      const id = col.id;
      this.armed = id;
      cx.timer.after(3000, (cx) => { if (this.armed === id) { this.armed = null; cx.notify(); } });
      cx.notify();
      return;
    }
    this.armed = null;
    this.board.columns = this.board.columns.filter((c) => c.id !== col.id);
    if (!this.demo) for (const k of col.cards) this.dropImages(k.id);
    delete this.adds[col.id];
    if (this.renaming === col.id) this.renaming = null;
    if (this.edit?.col === col.id) this.edit = null;
    this.save(cx);
  }

  // ---- UI ------------------------------------------------------------------------------------

  render(cx) {
    const t = theme();
    // The drop happened in another mod (it cleared shared "todo.drag"): forget our side without touching shared.
    if (this.drag && this.left && !shared("todo.drag")) { this.press = null; this.drag = null; this.hit = null; this.lastMove = null; this.left = false; this.dragTs = 0; }
    const btn = (id, label, tip, fn, on) => div().id(id).h(22).min_w(22).px(5).flex().items_center().justify_center().rounded(5)
      .text_size(13).text_color(on ?? t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); }).child(label);

    // no top bar (the user wanted the room); a slim notice only when something is wrong
    const notice = this.demo || this.error || this.badFile;
    const header = h_flex().id("todo-note").h(24).flex_none().px(10).gap(10).items_center().text_size(11)
      .when(this.demo, (e) => e.child(div().text_color(t.dim).child("demo, not saved")))
      .when(Boolean(this.error), (e) => e.child(div().min_w(0).truncate().text_color(t.blocked).child(`save failed: ${this.error}`)))
      .when(this.badFile, (e) => e.child(div().text_color(t.blocked).child("board.json is invalid, showing the last good board")));

    // The agent a card was handed to: live state from agents() (by terminal address), the space name; a click goes to the agent.
    const live = agents();
    const agentRow = (card) => {
      const ag = card.agent, a = live.find((x) => x.address === ag.terminal);
      let mark, label, color;
      if (ag.state === "done") { mark = "✓"; label = "done"; color = t.done ?? t.ansi2; }
      else if (!a) { mark = "○"; label = "agent closed"; color = t.dim; }
      else if (ag.state === "blocked" || a.status === "blocked") { mark = "●"; label = ag.state === "blocked" ? "blocked" : "needs you"; color = t.blocked; }
      else if (a.status === "working") { mark = null; label = "working"; color = t.accent; }
      else { mark = "·"; label = a.status === "done" ? "finished, not marked done" : "idle"; color = t.muted; }
      const name = a?.space_name || ag.space_name;
      return h_flex().id(`agent-${card.id}`).mt(6).gap(6).items_center().min_w(0).px(6).py(2).rounded(6).border_1().border_color(t.border)
        .text_size(12).text_color(color).cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip(a ? "Go to the agent" : "The agent's terminal is gone")
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (!a) return;
          run("agent.focus", { terminal: ag.terminal });
          run("layout.select", { stack: STACK, child: "work-body" });
        })
        .child(mark === null ? div().w(12).flex_none().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90) : div().w(12).flex_none().child(mark))
        .child(div().flex_none().child(label))
        .when(Boolean(name), (r) => r.child(div().min_w(0).truncate().text_color(t.dim).child(`· ${name}`)));
    };

    // A photo thumbnail: a click opens the file in the default viewer (not while a drag just ended); in edit mode a ✕ removes it.
    const thumb = (card, f, i, removable) => div().id(`img-${card.id}-${i}`).relative().flex_none().w(THUMB).h(THUMB).rounded(6).border_1().border_color(t.border)
      .overflow_hidden().cursor_pointer().tooltip("Open photo")
      .on_click((_e, cx) => { cx.stop_propagation(); if (this.drag || Date.now() < this.noClickUntil) return; exec("explorer.exe", [this.imgPath(card.id, f)]).catch(() => { }); })
      .child(image(this.imgRel(card.id, f)).size_full())
      .when(removable, (e) => e.child(div().id(`imgx-${card.id}-${i}`).absolute().top(2).right(2).w(18).h(18).rounded(9).flex().items_center().justify_center()
        .bg(alpha(t.raised, "f2")).text_size(11).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Remove photo")
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.removeImage(card.id, f, cx); cx.notify(); }).child("✕")));

    const target = this.dropTarget();   // null unless a drag would change something
    const cardEl = (col, card, ci, n) => {
      const editing = this.edit?.card === card.id, hover = this.hoverCard === card.id, sel = this.sel === card.id;
      const dragged = this.drag?.card === card.id, insAt = target && target.dst.id === col.id ? target.rawAt : -1;
      const imgs = card.images ?? [];
      const line = (pos) => div().absolute().left(0).right(0).h(3).rounded(2).bg(t.accent).when(pos === "top", (l) => l.top(-6)).when(pos === "bottom", (l) => l.bottom(-6));
      return v_flex().id(`card-${card.id}`).relative().flex_none().min_w(0).px(10).py(8).rounded(8).border_1()
        .border_color(hover || editing || sel ? t.accent : t.border).when(sel && !editing, (e) => e.bg(alpha(t.selected, "f2"))).bg(alpha(t.background, "e6")).text_color(t.foreground).text_size(14)
        .when(dragged, (e) => e.opacity(0.4))
        .on_hover((h, cx) => { if (h) this.hoverCard = card.id; else if (this.hoverCard === card.id) this.hoverCard = null; cx.notify(); })
        .on_mouse_down("left", (e, cx) => {   // drag candidate; buttons stop their own press, so they never get here
          if (editing || this.edit || this.renaming) return;
          this.press = { card: card.id, col: col.id, x: e.position.x, y: e.position.y, fresh: true }; this.drag = null;
        })
        .on_mouse_move((e) => {
          if (!this.press) return;
          const lower = e.local_position && e.bounds ? e.local_position.y >= e.bounds.height / 2 : false;
          this.hit = { col: col.id, index: lower ? ci + 1 : ci };   // upper half: before this card, lower half: after
        })
        .on_click((e, cx) => { if (this.drag || Date.now() < this.noClickUntil) return; if (!editing) { this.sel = card.id; this.handle.focus(); cx.notify(); } if (!editing && (e?.click_count ?? 1) >= 2) { this.startEdit(col.id, card); cx.notify(); } })
        .on_drop((e, cx) => this.dropOnCard(card.id, e.paths ?? [], cx))
        .child(editing
          ? div().h(30).flex().items_center().text_size(14).child(Input.new(this.editInput).h_full().text_size(14).text_color(t.foreground))
          : div().min_w(0).text_size(14).whitespace_normal().child(card.text))
        .when(editing, (e) => e
          .child(div().mt(6).min_w(0).px(6).py(4).rounded(6).border_1().border_color(t.border).bg(alpha(t.background, "99")).text_size(12)
            .child(Textarea.new(this.descInput).text_size(12).text_color(t.foreground)))
          .when(imgs.length > 0, (r) => r.child(h_flex().mt(6).gap(6).flex_wrap().children(imgs.map((f, i) => thumb(card, f, i, true)))))
          .child(h_flex().mt(6).gap(6).justify_end()
            .child(btn(`photo-${card.id}`, this.busyImg ? "Adding…" : "Add photo", "Add photos from a file (Ctrl+V pastes the clipboard image)", (cx) => this.pick(card.id, cx)))
            .child(btn(`cancel-${card.id}`, "Cancel", "Cancel (Esc)", () => { this.edit = null; }))
            .child(div().id(`save-${card.id}`).h(22).px(8).flex().items_center().rounded(5).text_size(12).bg(t.selected).text_color(t.foreground)
              .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Save (Enter in the title, Ctrl+Enter in the description)")
              .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); if (this.commitEdit()) this.save(cx); cx.notify(); }).child("Save"))))
        .when(!editing && Boolean(card.desc), (e) => e.child(div().id(`desc-${card.id}`).mt(4).min_w(0).text_size(12).line_height(1.4).text_color(t.muted).whitespace_normal()
          .when(!sel, (d) => d.max_h(51).overflow_hidden()).child(card.desc)))
        .when(!editing && imgs.length > 0, (e) => e.child(h_flex().mt(6).gap(6).items_center().flex_wrap().min_w(0)
          .children(imgs.slice(0, SHOWN).map((f, i) => thumb(card, f, i, false)))
          .when(imgs.length > SHOWN, (r) => r.child(div().flex_none().h(THUMB).px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
            .text_size(12).text_color(t.muted).tooltip(`${imgs.length - SHOWN} more, open the card to see all`).child(`+${imgs.length - SHOWN}`)))))
        .when(!editing && Boolean(card.agent), (e) => e.child(agentRow(card)))
        .when(!editing && Boolean(card.agent?.summary) && card.agent?.state === "done", (e) => e.child(div().id(`sum-${card.id}`).mt(4).min_w(0).text_size(12).line_height(1.4).text_color(t.muted).whitespace_normal()
          .when(!sel, (d) => d.max_h(51).overflow_hidden()).child(card.agent.summary)))
        .when(insAt === ci, (e) => e.child(line("top")))
        .when(insAt === ci + 1 && ci === n - 1, (e) => e.child(line("bottom")))
        .when(hover && !editing && !this.drag, (e) => e.child(h_flex().absolute().top(3).right(3).gap(1).p(2).rounded(6).items_center()
          .bg(alpha(t.raised, "f2")).border_1().border_color(t.border)
          .child(btn(`prev-${card.id}`, "‹", "Move to previous column", (cx) => this.moveCard(col.id, card.id, -1, cx)))
          .child(btn(`up-${card.id}`, "↑", "Move up", (cx) => this.shiftCard(col.id, card.id, -1, cx)))
          .child(btn(`down-${card.id}`, "↓", "Move down", (cx) => this.shiftCard(col.id, card.id, 1, cx)))
          .child(btn(`next-${card.id}`, "›", "Move to next column", (cx) => this.moveCard(col.id, card.id, 1, cx)))
          .child(btn(`edit-${card.id}`, "✎", "Edit", (cx) => this.startEdit(col.id, card)))
          .child(btn(`del-${card.id}`, "✕", "Delete card", (cx) => this.deleteCard(col.id, card.id, cx)))));
    };

    const colEl = (col) => {
      const hot = this.drag ? this.drag.toCol === col.id : this.hotCol === col.id, armed = this.armed === col.id, renaming = this.renaming === col.id;
      const listId = `todo-list-${col.id}`;
      return v_flex().id(`col-${col.id}`).flex_1().min_w(0).h_full().min_h(0).rounded(10).border_1().border_color(hot ? t.accent : t.border)
        .bg(t.surface).overflow_hidden()
        .on_drop((e, cx) => this.dropOnColumn(col.id, e.paths ?? [], cx))   // image files dropped on the column (not on a card): a new card
        .on_mouse_move(() => { if (this.press && !this.hit) this.hit = { col: col.id, index: null }; })   // anywhere on the column: this column, order kept / end
        .on_hover((h, cx) => { if (h) this.hotCol = col.id; else if (this.hotCol === col.id) this.hotCol = null; cx.notify(); })
        .child(h_flex().h(40).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
          .child(renaming
            ? div().flex_1().min_w(0).h(28).flex().items_center().text_size(14).child(Input.new(this.nameInput).h_full().text_size(14).text_color(t.foreground))
            : div().id(`name-${col.id}`).flex_1().min_w(0).truncate().text_size(14).font_semibold().text_color(t.foreground).cursor_pointer()
              .tooltip("Click to rename").on_click((_e, cx) => { this.startRename(col); cx.notify(); }).child(col.name))
          .child(div().flex_none().px(6).py(1).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.muted).child(String(col.cards.length)))
          .child(armed
            ? div().id(`delcol-${col.id}`).flex_none().h(22).px(8).flex().items_center().rounded(5).text_size(12).font_semibold()
              .bg(t.blocked).text_color(t.background).cursor_pointer().on_mouse_down("left", stop)
              .on_click((_e, cx) => { cx.stop_propagation(); this.deleteColumn(col, cx); }).child(`Delete ${col.cards.length ? col.cards.length + " cards" : "column"}?`)
            : btn(`delcol-${col.id}`, "✕", "Delete column", (cx) => this.deleteColumn(col, cx), t.dim)))
        .child(div().flex_1().min_h(0).relative()
          .child(v_flex().id(listId).absolute().inset_0().overflow_y_scroll().p(8).gap(8)
            .children(col.cards.map((card, i) => cardEl(col, card, i, col.cards.length)))
            .when(!col.cards.length, (e) => e.child(div().relative().px(4).py(6).text_size(13).text_color(t.dim).child("No cards")
              .when(target?.dst.id === col.id, (d) => d.child(div().absolute().top(-2).left(0).right(0).h(3).rounded(2).bg(t.accent)))))
            .when(Boolean(this.drag), (e) => e.child(div().id(`fill-${col.id}`).flex_1().min_h(28)   // empty space below the cards = end of the column
              .on_mouse_move(() => { if (this.press) this.hit = { col: col.id, index: null, end: true }; }))))
          .child(Scrollbar.vertical(listId).absolute().inset_0()))
        .child(div().flex_none().p(8).border_t(1).border_color(t.border)
          .child(div().h(34).px(8).flex().items_center().rounded(8).border_1().border_color(t.border).bg(alpha(t.background, "99")).text_size(14)
            .child(Input.new(this.adds[col.id]).h_full().text_size(14).text_color(t.foreground))));
    };

    return v_flex().id("todo").track_focus(this.handle).size_full().min_h(0).gap(8).text_color(t.foreground).text_size(14)
      .when(Boolean(this.drag), (e) => e.cursor_grabbing())
      .on_mouse_move((e, cx) => this.dragMove(e, cx))
      .on_mouse_up("left", (_e, cx) => this.dragEnd(cx))
      .on_mouse_down("left", (_e, cx) => {   // card presses run first (bubbling) and mark theirs fresh; any other press cancels stale state
        if (this.press?.fresh) this.press.fresh = false;
        else if (this.press || this.drag) { this.cancelDrag(); cx.notify(); }
      })
      .on_hover((h, cx) => {   // pointer left the board: no drop target here any more, but a started drag lives on for the Spaces rows
        if (h) { if (this.left && (this.press || this.drag)) { this.cancelDrag(); cx.notify(); } return; }   // back with the button state unknown: cancel
        if (this.drag) { this.left = true; this.drag.toCol = null; this.drag.index = null; this.hit = null; cx.notify(); }
        else if (this.press) { this.cancelDrag(); cx.notify(); }
      })
      .on_mouse_down_out((_e, cx) => { if (this.press || this.drag) { this.cancelDrag(); cx.notify(); } })   // the next press anywhere else ends a stale drag
      .on_key_down((e, cx) => {
        // Ctrl+V with the board itself focused (a card clicked/selected): look for an image on the clipboard.
        if (e.key === "v" && e.modifiers?.control && !e.modifiers?.shift && !e.modifiers?.alt) { if (this.handle.is_focused()) this.paste(null, cx); return; }   // inputs: see paste_other
        if (e.key === "escape" && (this.press || this.drag)) { this.cancelDrag(); cx.stop_propagation(); cx.notify(); return; }
        if (e.key === "enter" && e.modifiers?.control && this.edit) { if (this.commitEdit()) this.save(cx); cx.stop_propagation(); cx.notify(); return; }
        if (e.key === "escape" && (this.edit || this.renaming)) { this.edit = null; this.renaming = null; cx.stop_propagation(); cx.notify(); return; }
        // ctrl + arrows move the selected card (or the hovered one): left/right = column, up/down = order
        const dirs = { left: ["col", -1], right: ["col", 1], up: ["row", -1], down: ["row", 1] }, d = dirs[e.key];
        if (!d || !e.modifiers?.control || e.modifiers?.shift || e.modifiers?.alt || this.edit || this.renaming || !this.handle.is_focused()) return;
        const id = this.sel ?? this.hoverCard, col = id && this.board.columns.find((c) => c.cards.some((k) => k.id === id));
        if (!col) return;
        this.sel = id;
        if (d[0] === "col") this.moveCard(col.id, id, d[1], cx); else this.shiftCard(col.id, id, d[1], cx);
        cx.stop_propagation(); cx.notify();
      })
      .when(Boolean(notice), (e) => e.child(header))
      .child(h_flex().id("todo-cols").flex_1().min_h(0).gap(8).children(this.board.columns.map(colEl)));
  }
}
