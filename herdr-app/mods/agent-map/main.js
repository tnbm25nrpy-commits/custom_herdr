// Agent map: a live map of every Claude agent, one map per agent, covering everything right of the sidebar
// (layout stack `work-stack`, child `agent-map`; the tab bar's "Map" button opens it).
//
// The look and the idea (stations around an agent, pulses flying along spokes, worn spokes, a route through the last
// stations, xN badges, clock hands, a feed of the last calls) come from lot-map by alexeyw (MIT, see LICENSE-lot-map.txt,
// https://github.com/alexeyw/lot-map). The geometry, timings and folding rules below are ported from its hooks/draw.ts,
// hooks/feed.ts and hooks/palette.ts. lot-map draws one SVG; this mod draws with gpui-kit (PathBuilder paths, absolutely
// positioned divs and svg icons) and takes every colour from theme().
//
// Data: <appHome>/data/agent-map/<terminal>.jsonl, written by a Claude Code hook (one JSON object per line; fields:
// ts, sid, sub, ev = session|prompt|pre|post|fail|ask|sub_start|sub_stop|stop|compact, id, tool, station, label, file (lowercase
// key), path (same path, original case; shown as `path ?? file`), write, bg, subid (Agent/Task post lines), model + cwd (session);
// ctx + ctxMax = context tokens and auto-compact window on main-thread prompt/post/stop lines; schema v1 and v2 lines both work).
// Files are read incrementally (offset per file; when the file shrank or its start changed - the hook trims 600 -> 400 lines -
// the state is kept and reading resumes after the last line already applied; only a file whose last line is older than that
// one starts over; a half-written last line is skipped until it is complete). A file belongs to a live agent when its name equals the agent's terminal address with
// every char outside [A-Za-z0-9_-] replaced by "_". Files older than 24 h or of terminals that are gone are not shown.
//
// Animation: nothing here ticks while the board shows activity. Pulses, ripples, beams, glows, the route and the answer ring are
// native tweens (`transition` on opacity/left/top/width/height): the first draw of such an element shows its start, the second
// draw (one 16 ms one-shot later) sets the end value and the app glides there without running this script (see `tweenPlan`,
// `tween`). The beat ring, the core's breathing and the sub-agent dots are native `loop`/`spin`. The script renders when state
// changes (new lines, a status change) and at one-shot wakes at known boundaries (an animation's end, a route leg's hold end).
// Only two things are still timer-driven: the clock hands of a running call (1 s) and the click-to-enlarge zoom (16 ms, 0.34 s).
//
// Commands (`herdr-app do agent-map.<cmd>`, delivered to a SHOWN copy only; open the board with tabs-dynamic.map-toggle):
//   demo  - replays a made-up session with 2 agents (a subagent, a failure, a background call, a file conflict), in memory only
//   clear - forgets the in-memory state (and ignores everything written so far); stops the demo
//   zoom  - a click on the first map (opens its sub-agents, or enlarges it); escape - what the Esc key does: unzoom, else close the board
import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, run, theme, layout, agents, spaces, terminals, settings, nextCommand, readTextFile, watchFolder } from "herdr";
import * as fs from "fs/promises";

const SEP = appHome().includes("\\") ? "\\" : "/";
const DIR = [appHome(), "data", "agent-map"].join(SEP);
const STACK = "work-stack", BOARD = "agent-map";
const ID_OK = /^[\w-]{1,64}$/;
const DAY = 24 * 3600 * 1000;
const POLL_MS = 2000;

// ---- geometry and timings (lot-map draw.ts) ----------------------------------------------------------------------
export const W = 460, H = 430, CX = 230, CY = 212, RX = 176, RY = 164, NODE = 22, CORE = 40, HUB = CORE + 8;
const PULSE_MS = 800, RIPPLE_MS = 450, GLOW_MS = 3200, ALARM_MS = 6000, DONE_MS = 1100;
const BEAT_MS = 8000;         // the beat ring around a running station stops after this
const TRAIL_STOPS = 7, TRAIL_HOLD_MS = 40000, TRAIL_FADE_MS = 20000;
const BEND = [0.5, 0.5, 0.4, 0.45, 0.5, 0.55];   // index = stations between the two (10 stations: up to 5)
const KEEP = 120, RECENT = 40, FEED_ROWS = 16, FILE_WINDOW = 10 * 60000, BG_AFTER_STOP = 10 * 60000, SUB_IDLE = 15 * 60000, RUN_MAX = 3600000;
const CARD_HEAD = 28, GAP = 8, MIN_FIT_W = 250;   // below this map width the board scrolls instead of shrinking the maps
const ZOOM_MS = 340;               // click-to-enlarge animation
const FRAME_MS = 16;               // a fresh native tween is drawn at its start, then set to its end one frame later
const CLOCK_MS = 1000;             // pace of the clock hands of a running call
const ROW_IN_MS = 240;             // a new feed or files row grows in from nothing
const NOTE_H = 24;                 // the notice line (demo / read error), shown only then

export const STATIONS = [
  { id: "you", name: "You", icon: "mods/agent-map/st-you.svg" },
  { id: "files", name: "Files", icon: "mods/agent-map/st-files.svg" },
  { id: "shell", name: "Shell", icon: "mods/agent-map/st-shell.svg" },
  { id: "git", name: "Git", icon: "mods/agent-map/st-git.svg" },
  { id: "build", name: "Build", icon: "mods/agent-map/st-build.svg" },
  { id: "network", name: "Network", icon: "mods/agent-map/st-network.svg" },
  { id: "browser", name: "Browser", icon: "mods/agent-map/st-browser.svg" },
  { id: "agents", name: "Agents", icon: "mods/agent-map/st-agents.svg" },
  { id: "skills", name: "Skills", icon: "mods/agent-map/st-skills.svg" },
  { id: "memory", name: "Memory", icon: "mods/agent-map/st-memory.svg" },
];
const ST_IDS = new Set(STATIONS.map((s) => s.id));
const IDX = Object.fromEntries(STATIONS.map((s, i) => [s.id, i]));
const STATUS_WORD = { working: "working", blocked: "needs you", done: "done", idle: "idle" };

// ---- colours ------------------------------------------------------------------------------------------------------
const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c);
const ah = (c, f) => (isHex(c) ? c.slice(0, 7) + Math.round(Math.max(0, Math.min(1, f)) * 255).toString(16).padStart(2, "0") : c);
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, f) => (isHex(a) && isHex(b) ? "#" + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * f).toString(16).padStart(2, "0")).join("") : a);

function palette(t) {
  const mem = t.ansi6 ?? t.accent;
  return {
    raised: t.raised, line: t.border, bone: t.foreground, ash: t.muted, dim: t.dim, accent: t.accent,
    hot: mix(t.accent, t.foreground, 0.35), red: t.ansi1 ?? t.blocked, mem, memHot: mix(mem, t.foreground, 0.4), trail: t.foreground,
  };
}
const statusColor = (t, s) => (s === "working" ? t.working : s === "blocked" ? t.blocked : s === "done" ? t.done : t.idle);
const agentColors = (t) => [t.accent, t.ansi4, t.ansi2, t.ansi5, t.ansi6, t.ansi3, t.ansi9, t.ansi12].map((c, i) => c ?? t.accent);
const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// A colour slot per agent from a hash of its terminal address, not from its place in the list, so colours do not move when
// agents come or go. `sticky` (key -> slot, kept by the caller) holds the slots of agents already seen: a new agent takes its
// hashed slot, or the next free one; slots are shared only when there are more agents than slots.
export function colorSlots(keys, n, sticky = new Map()) {
  const live = new Set(keys);
  for (const k of [...sticky.keys()]) if (!live.has(k)) sticky.delete(k);
  const load = new Array(n).fill(0);
  for (const s of sticky.values()) load[s]++;
  const fresh = [...live].filter((k) => !sticky.has(k)).sort((a, b) => hash32(a) - hash32(b) || (a < b ? -1 : 1));
  for (const k of fresh) {
    const h = hash32(k) % n;
    let best = h;
    for (let d = 0; d < n; d++) { const s = (h + d) % n; if (load[s] < load[best]) best = s; if (load[s] === 0) { best = s; break; } }
    sticky.set(k, best); load[best]++;
  }
  return sticky;
}

// ---- native tweens ------------------------------------------------------------------------------------------------
// props: { name: { from, to, s, e } } with s/e absolute ms (the tween runs from `from` at s to `to` at e, linear). Returns the
// value to show on the first draw (`v0`: where the tween is at `now`) and the transition policy per property, planned for the
// second draw `lead` ms later: the delay until s and the time left until e. The policy is kept as long as the tween lives, so
// later renders (a new line arriving) pass the same target and policy and the native transition is not restarted.
export function tweenPlan(props, now, lead = FRAME_MS) {
  const T = now + lead, v0 = {}, pol = {};
  for (const [p, a] of Object.entries(props)) {
    const span = a.e - a.s, f = span <= 0 ? (now >= a.e ? 1 : 0) : Math.max(0, Math.min(1, (now - a.s) / span));
    v0[p] = a.from + (a.to - a.from) * f;
    pol[p] = { duration: Math.max(16, Math.round(a.e - Math.max(a.s, T))), delay: Math.max(0, Math.round(a.s - T)), easing: "linear" };
  }
  return { v0, pol };
}
const MOT = { opacity: "opacity", left: "left", top: "top", width: "w", height: "h" };

// ---- small helpers ------------------------------------------------------------------------------------------------
const clean = (s, n = 120) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n) : "");
const sanitizeId = (s) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
const stop = (_e, cx) => cx.stop_propagation();
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) { const f = find(child, id); if (f) return f; }
  return null;
}
const fmtMs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s` : `${Math.floor(ms / 60000)}m ${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}s`);
const fmtAgo = (ms) => (ms < 5000 ? "now" : ms < 60000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms / 60000)}m`);
const base = (p) => String(p).split("/").pop();
const dirOf = (p) => { const a = String(p).split("/"); return a.slice(Math.max(0, a.length - 3), -1).join("/"); };
export const lastParts = (p, n = 2) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean).slice(-n).join("/");
const fmtK = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const ctxPct = (st) => Math.max(0, Math.min(100, Math.round((100 * st.ctx) / (st.ctxMax || 200000))));
export const ctxTip = (st) => `context ${fmtK(st.ctx)} / ${fmtK(st.ctxMax || 200000)} (${ctxPct(st)}%)`;

// ---- geometry -----------------------------------------------------------------------------------------------------
const turn = (i) => (i * 2 * Math.PI) / STATIONS.length;
const at = (a, f = 1) => ({ x: CX + RX * f * Math.sin(a), y: CY - RY * f * Math.cos(a) });
export const place = (i) => at(turn(i));
function edge(from, to, r) {
  const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) * r) / d, y: from.y + ((to.y - from.y) * r) / d };
}
function aside(a, b, off) {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = (-(b.y - a.y) * off) / d, dy = ((b.x - a.x) * off) / d;
  return [{ x: a.x + dx, y: a.y + dy }, { x: b.x + dx, y: b.y + dy }];
}
// A leg between two stations: a quadratic curve through the room between the core and the ring (as polyline points, `frac` of it).
export function legPoints(i, j, frac = 1) {
  const n = STATIONS.length;
  let steps = (((j - i) % n) + n) % n;
  if (steps > n / 2) steps -= n;
  const bend = at(turn(i + steps / 2), BEND[Math.abs(steps)] ?? 0.5);
  const a = edge(place(i), bend, NODE + 4), b = edge(place(j), bend, NODE + 4);
  const N = 16, pts = [];
  const last = Math.max(1, Math.ceil(N * frac));
  for (let s = 0; s <= last; s++) {
    const u = Math.min(frac, s / N), v = 1 - u;
    pts.push({ x: v * v * a.x + 2 * v * u * bend.x + u * u * b.x, y: v * v * a.y + 2 * v * u * bend.y + u * u * b.y });
  }
  return { pts, end: b };
}
export function routeOf(entries, max = TRAIL_STOPS) {
  const stops = [];
  for (const e of entries) {
    if (e.from === "agents" || e.mark === "ask") continue;
    const last = stops[stops.length - 1];
    if (last && last.station === e.station) last.at = e.ts;
    else stops.push({ station: e.station, at: e.ts });
  }
  return stops.slice(-max);
}

// ---- per-terminal state and events --------------------------------------------------------------------------------
export const freshState = () => ({
  off: 0, head: "", entries: [], byId: new Map(), cnt: {}, flt: {}, subs: new Map(), cur: null,
  stopAt: {}, askedAt: {}, lastTs: 0, cwd: null, model: null, cutoff: 0, demoStatus: null,
  asks: [], subNames: new Map(), lastRaw: null, lastEvTs: 0,
});

function bump(obj, key) { obj[key] = (obj[key] ?? 0) + 1; }

export function apply(st, ev) {
  if (!ev || typeof ev !== "object" || typeof ev.ts !== "number" || !Number.isFinite(ev.ts) || ev.ts <= st.cutoff) return;
  const ts = ev.ts, sid = clean(ev.sid, 80) || "?", sub = typeof ev.sub === "string" && ev.sub ? clean(ev.sub, 80) : null;
  if (!(sid in st.cnt)) {
    st.cnt[sid] = {}; st.flt[sid] = {};
    const sids = Object.keys(st.cnt);
    if (sids.length > 4) { delete st.cnt[sids[0]]; delete st.flt[sids[0]]; delete st.stopAt[sids[0]]; delete st.askedAt[sids[0]]; }
  }
  const cnt = st.cnt[sid], flt = st.flt[sid];
  st.lastTs = Math.max(st.lastTs, ts); st.cur = sid;
  const toolEntry = () => ({
    id: clean(ev.id, 80) || null, station: ev.station, label: clean(ev.label), tool: clean(ev.tool, 60),
    file: typeof ev.file === "string" && ev.file ? ev.file.slice(0, 400) : null, path: typeof ev.path === "string" && ev.path ? ev.path.slice(0, 400) : null,
    write: ev.write === true, bg: ev.bg === true, sub, sid, ts, status: "run", from: sub ? "agents" : "core",
  });
  // context window of the main thread: tokens on prompt/post/stop lines; a compaction empties it until the next figure
  if (!sub && typeof ev.ctx === "number" && Number.isFinite(ev.ctx) && ev.ctx >= 0 && ts >= (st.ctxAt ?? 0)) {
    st.ctx = ev.ctx; st.ctxMax = typeof ev.ctxMax === "number" && ev.ctxMax > 0 ? ev.ctxMax : 200000; st.ctxAt = ts;
  }
  if (ev.ev === "compact" && ts >= (st.ctxAt ?? 0)) { st.ctx = 0; st.ctxAt = ts; }
  const seeSub = () => { if (sub) { const s = st.subs.get(sub); if (s) s.seen = ts; else if (ev.ev !== "sub_stop") st.subs.set(sub, { label: st.subNames.get(sub) ?? "", seen: ts }); } };
  // the name of a subagent that had no sub_start: from the Agent/Task post line (subid) or the sub_stop line (agent type)
  const nameSub = (id, label) => {
    id = clean(id, 80); label = clean(label, 80);
    if (!id || !label) return;
    if (!st.subNames.has(id) && st.subNames.size >= 60) st.subNames.delete(st.subNames.keys().next().value);
    if (!st.subNames.get(id)) st.subNames.set(id, label);
    const s = st.subs.get(id); if (s && !s.label) s.label = label;
  };
  // An ask without id (PermissionRequest sent none) is answered by the next call line of the same tool in the same thread.
  const answered = (id, tool) => {
    if (id) st.asks = st.asks.filter((a) => a.id !== id);
    const i = st.asks.findIndex((a) => !a.id && a.sid === sid && a.sub === sub && a.tool === tool);
    if (i >= 0) st.asks.splice(i, 1);
  };
  switch (ev.ev) {
    case "session":
      st.cwd = typeof ev.cwd === "string" ? ev.cwd.slice(0, 300) : st.cwd;
      st.model = typeof ev.model === "string" && ev.model ? clean(ev.model, 60) : st.model;
      break;
    case "ask": {
      // this tool waits for the user's permission: open until a pre/post/fail with the same id, or a prompt/stop
      const a = { id: clean(ev.id, 80), ts, sid, sub, tool: clean(ev.tool, 60), station: ST_IDS.has(ev.station) ? ev.station : "", label: clean(ev.label), file: typeof ev.file === "string" ? ev.file.slice(0, 400) : null, path: typeof ev.path === "string" ? ev.path.slice(0, 400) : null };
      st.asks = st.asks.filter((x) => !(a.id ? x.id === a.id : !x.id && x.sid === sid && x.sub === sub && x.tool === a.tool));
      st.asks.push(a); if (st.asks.length > 8) st.asks.shift();
      st.entries.push({ id: null, station: "you", label: askText(a), tool: a.tool, file: null, path: null, write: false, bg: false, sub: null, sid, ts, end: ts, status: "ok", from: "inbound", mark: "ask", ask: a });
      break;
    }
    case "prompt":
      // a new turn: foreground calls of this session that never got their end (Esc-interrupted) are over. Background calls
      // and subagent calls keep running (a task-notification re-prompt arrives while they are still going).
      for (const e of st.entries) if (e.status === "run" && e.sid === sid && !e.sub && !e.bg) { e.status = "ok"; e.end = ts; if (e.id) st.byId.delete(e.id); }
      delete st.flt[sid]; st.flt[sid] = {};
      st.asks = st.asks.filter((a) => a.sid !== sid);
      st.askedAt[sid] = ts; bump(cnt, "you");
      st.entries.push({ id: null, station: "you", label: "message", tool: "", file: null, write: false, bg: false, sub: null, sid, ts, end: ts, status: "ok", from: "inbound", mark: "prompt" });
      break;
    case "pre": {
      answered(clean(ev.id, 80), clean(ev.tool, 60));
      if (!ST_IDS.has(ev.station)) break;
      const e = toolEntry();
      st.entries.push(e); bump(cnt, e.station); seeSub();
      if (e.id) st.byId.set(e.id, e);
      break;
    }
    case "post": case "fail": {
      answered(clean(ev.id, 80), clean(ev.tool, 60));
      if (ev.ev === "post" && ev.subid && (ev.tool === "Agent" || ev.tool === "Task")) nameSub(ev.subid, ev.label);
      if (!ST_IDS.has(ev.station)) break;
      const bad = ev.ev === "fail";
      let e = ev.id ? st.byId.get(clean(ev.id, 80)) : null;
      if (!e) { e = toolEntry(); st.entries.push(e); bump(cnt, e.station); }
      else if (typeof ev.file === "string" && ev.file && !e.file) { const w = toolEntry(); e.file = w.file; e.path = w.path; e.write = e.write || w.write; }
      e.status = bad ? "err" : "ok"; e.end = ts; seeSub();
      if (e.id) st.byId.delete(e.id);
      if (bad && e.station !== "you") bump(flt, e.station);
      break;
    }
    case "sub_start": if (sub) { st.subs.set(sub, { label: clean(ev.label, 80), seen: ts }); nameSub(sub, ev.label); } break;
    case "sub_stop":
      if (sub) {
        nameSub(sub, ev.label);
        st.subs.delete(sub);
        for (const e of st.entries) if (e.status === "run" && e.sub === sub && !e.bg) { e.status = "ok"; e.end = ts; if (e.id) st.byId.delete(e.id); }
      }
      break;
    case "stop": {
      st.asks = st.asks.filter((a) => a.sid !== sid);
      for (const e of st.entries) if (e.status === "run" && e.sid === sid && !e.sub && !e.bg) { e.status = "ok"; e.end = ts; if (e.id) st.byId.delete(e.id); }
      st.stopAt[sid] = ts; bump(cnt, "you");
      const asked = st.askedAt[sid];
      st.entries.push({ id: null, station: "you", label: "answer ready", tool: "", file: null, write: false, bg: false, sub: null, sid, ts, end: ts, status: "ok", from: "core", mark: "done", took: asked ? ts - asked : 0 });
      break;
    }
    default: break;
  }
}

// Closes calls whose end never arrived: after a stop + 10 min for background calls, after an hour for the rest.
export function settle(st, now) {
  for (const e of st.entries) {
    if (e.status !== "run") continue;
    const stopped = st.stopAt[e.sid];
    if ((e.bg && stopped && stopped > e.ts && now - stopped > BG_AFTER_STOP) || now - e.ts > RUN_MAX) {
      e.status = "ok"; e.end = Math.max(e.ts, Math.min(now, (stopped ?? now))); if (e.id) st.byId.delete(e.id);
    }
  }
  for (const [k, s] of st.subs) if (now - s.seen > SUB_IDLE) st.subs.delete(k);
  if (st.asks.length) st.asks = st.asks.filter((a) => now - a.ts <= RUN_MAX);
}

// ---- needs you ----------------------------------------------------------------------------------------------------
export function askText(a) {
  const what = a.label && a.label !== a.tool ? `${a.tool}: ${a.label}` : a.tool || a.label || "permission";
  return `needs you · ${what}`;
}
// The permission asks of an agent that are still open (see apply: ask).
export const openAsks = (st) => st.asks ?? [];

export function trim(st) {
  if (st.entries.length <= KEEP + 20) return;
  const n = st.entries.length;
  st.entries = st.entries.filter((e, i) => i >= n - KEEP || e.status === "run");
  const ids = new Set(st.entries.map((e) => e.id).filter(Boolean));
  for (const k of st.byId.keys()) if (!ids.has(k)) st.byId.delete(k);
}

// ---- reading ------------------------------------------------------------------------------------------------------
const tsOfLine = (line) => { try { const v = JSON.parse(line); return v && typeof v.ts === "number" ? v.ts : null; } catch { return null; } };

// Feeds the new complete lines of `text` (the whole file) into the state. True when anything was applied.
// A file that got shorter or whose start changed was trimmed by the hook (tmp + rename): the state is kept and reading
// resumes after the last line already applied (found by its exact text, else by ts). Only a file whose last line is older
// than the last one applied is a new file: that starts over.
export function ingestText(st, text) {
  let resume = null;
  if (text.length < st.off || (st.head && text.slice(0, st.head.length) !== st.head)) {
    const lines = text.split("\n").filter((l) => l.trim());
    let lastTs = null;
    for (let i = lines.length - 1; i >= 0 && lastTs === null; i--) lastTs = tsOfLine(lines[i]);
    if (st.lastRaw === null || lastTs === null || lastTs < st.lastEvTs) Object.assign(st, freshState(), { cutoff: st.cutoff });
    else { resume = { raw: st.lastRaw, ts: st.lastEvTs }; st.off = 0; st.head = ""; }
  }
  if (st.off === 0) st.head = text.slice(0, 160);
  const rest = text.slice(st.off), cut = rest.lastIndexOf("\n") + 1;
  let chunk = rest.slice(0, cut), used = cut;
  const tail = rest.slice(cut);
  if (tail.trim()) { try { JSON.parse(tail); chunk += tail; used += tail.length; } catch { /* half-written: wait for the rest */ } }
  st.off += used;
  let lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
  if (resume) {
    const k = lines.lastIndexOf(resume.raw);
    lines = k >= 0 ? lines.slice(k + 1) : lines.filter((l) => { const t = tsOfLine(l); return t !== null && t > resume.ts; });
  }
  let any = false;
  for (const line of lines) {
    let ev = null;
    try { ev = JSON.parse(line); } catch { continue; }
    apply(st, ev); any = true;
    if (ev && typeof ev.ts === "number") { st.lastRaw = line; st.lastEvTs = ev.ts; }
  }
  if (any) trim(st);
  return any;
}

// ---- demo ---------------------------------------------------------------------------------------------------------
const DEMO_NAMES = ["api-refactor", "docs-site"];
export const DEMO = (() => {
  const L = []; let n = 0;
  const ev = (t, ag, o) => L.push([t, ag, o]);
  const call = (t, ag, dur, station, tool, label, o = {}) => {
    const id = `d${++n}`, base = { id, tool, station, label, ...o };
    ev(t, ag, { ev: "pre", ...base });
    if (dur > 0) ev(t + dur, ag, { ev: o.failed ? "fail" : "post", ...base });
    return base;
  };
  const R = "c:/proj/api/src/api/routes.ts", S = "c:/proj/api/src/shared.ts";
  ev(0, 0, { ev: "session", cwd: "c:/proj/api", model: "claude-opus-4" }); ev(0, 0, { ev: "_status", v: "working" });
  ev(400, 0, { ev: "prompt", ctx: 62000, ctxMax: 400000 });
  call(1000, 0, 450, "files", "Read", "api/routes.ts", { file: R });
  call(1700, 0, 300, "files", "Grep", "Grep");
  call(2000, 0, 350, "git", "Bash", "git status");
  call(2600, 0, 2800, "build", "Bash", "npm test");
  call(5400, 0, 450, "files", "Edit", "api/routes.ts", { file: R, path: "C:/proj/api/src/api/Routes.ts", write: true });
  call(5900, 0, 400, "git", "Bash", "git diff");
  call(6200, 0, 1500, "network", "WebFetch", "docs.example.com", { failed: true });
  const dev = call(8000, 0, 0, "shell", "Bash", "start dev server", { bg: true });
  ev(8600, 0, { ev: "sub_start", sub: "s1", label: "explore auth" });
  const agent = call(8800, 0, 0, "agents", "Agent", "explore auth");
  ev(8900, 0, { ev: "sub_start", sub: "s2", label: "check types" });
  call(9400, 0, 6000, "build", "Bash", "tsc", { sub: "s2" });
  ev(15600, 0, { ev: "sub_stop", sub: "s2" });
  call(9100, 0, 500, "files", "Read", "auth/session.ts", { sub: "s1", file: "c:/proj/api/src/auth/session.ts" });
  call(9900, 0, 350, "files", "Grep", "Grep", { sub: "s1" });
  call(10500, 0, 1400, "browser", "mcp__playwright__navigate", "localhost", { sub: "s1" });
  call(12300, 0, 700, "git", "Bash", "git log", { sub: "s1" });
  call(11500, 0, 900, "skills", "Skill", "simplify");
  call(13000, 0, 500, "memory", "mcp__memory__read", "project notes");
  call(14800, 0, 450, "files", "Edit", "shared.ts", { file: S, write: true });
  ev(16800, 0, { ev: "sub_stop", sub: "s1" });
  ev(17000, 0, { ev: "post", ...agent });
  ev(18500, 0, { ev: "stop", ctx: 148000, ctxMax: 400000 }); ev(18500, 0, { ev: "_status", v: "done" });
  ev(34000, 0, { ev: "post", ...dev });
  ev(3000, 1, { ev: "session", cwd: "c:/proj/docs", model: "claude-sonnet-4" }); ev(3500, 1, { ev: "prompt", ctx: 290000, ctxMax: 400000 }); ev(3500, 1, { ev: "_status", v: "working" });
  call(4000, 1, 400, "files", "Read", "docs/index.md", { file: "c:/proj/docs/index.md" });
  call(5200, 1, 450, "files", "Write", "docs/guide.md", { file: "c:/proj/docs/guide.md", write: true });
  call(7000, 1, 4000, "build", "Bash", "build docs");
  call(9500, 1, 450, "files", "Edit", "api/routes.ts", { file: R, write: true });
  call(10200, 1, 600, "shell", "Bash", "python gen.py > out.txt", { file: "c:/proj/api/src/shared.ts", write: true });
  ev(12000, 1, { ev: "_status", v: "blocked" }); ev(14000, 1, { ev: "_status", v: "working" });
  ev(12000, 1, { ev: "ask", id: "dk1", tool: "Bash", station: "network", label: "git push" });
  ev(14000, 1, { ev: "pre", id: "dk1", tool: "Bash", station: "network", label: "git push" }); ev(14700, 1, { ev: "post", id: "dk1", tool: "Bash", station: "network", label: "git push" });
  call(12500, 1, 1500, "build", "Bash", "lint", { failed: true });
  call(15400, 1, 300, "git", "Bash", "git add");
  call(15000, 1, 450, "files", "Edit", "shared.ts", { file: S, write: true });
  call(16000, 1, 6000, "browser", "mcp__playwright__navigate", "preview");
  ev(24000, 1, { ev: "stop", ctx: 372000, ctxMax: 400000 }); ev(24000, 1, { ev: "_status", v: "idle" });
  L.sort((a, b) => a[0] - b[0]);
  return { events: L, length: 42000 };
})();

// Files touched in the last 10 minutes over the given cards, newest first. Grouped by the lowercase key `file`, shown as
// `path ?? file` (original case). Any call with file + write counts as a write, whatever its station; 2+ writers = conflict.
export function collectFiles(cards, now) {
  const fmap = new Map();
  for (const c of cards) for (const e of c.st.entries) {
    if (!e.file || now - e.ts > FILE_WINDOW) continue;
    let f = fmap.get(e.file);
    if (!f) fmap.set(e.file, f = { path: e.file, show: e.path ?? e.file, ts: 0, wrote: false, ags: new Map(), writers: new Set() });
    if (e.ts >= f.ts) f.show = e.path ?? f.show;
    f.ts = Math.max(f.ts, e.ts); f.ags.set(c.key, c);
    if (e.write) { f.wrote = true; f.writers.add(c.key); }
  }
  return [...fmap.values()].sort((a, b) => b.ts - a.ts).slice(0, 60);
}

// cwd (last 2 folders) and model of an agent, as lines of a tooltip
export const infoLine = (st, split) => {
  const cwd = st.cwd ? lastParts(st.cwd) : "", model = st.model ? st.model.replace(/^claude-/, "") : "";
  if (!cwd && !model) return [];
  return split ? [cwd, model].filter(Boolean) : [[cwd, model].filter(Boolean).join(" · ")];
};

// ---- agent links --------------------------------------------------------------------------------------------------
// agents() lists only terminals with a pane; a sub-agent started with `hc run` (herdr-worker.ps1 without -Pane) lives only
// in terminals(), with `parent` = its starter. Returns agents() plus every live descendant terminal that reports a status
// (any depth: orchestrator -> orchestrator -> implementer), shaped like AgentInfo, space/tab taken from the root agent.
export function boardAgents(live, terms) {
  const out = [...(live ?? [])], have = new Set(out.map((a) => a.address));
  const all = (terms ?? []).filter((x) => x && typeof x.address === "string" && x.state === "live");
  const walk = (root, addr, depth) => {
    if (depth > 8) return;
    for (const k of all) {
      if (k.parent !== addr || have.has(k.address)) continue;
      have.add(k.address);
      const st = k.status === "error" ? "blocked" : k.status === "done" ? "idle" : (k.status || "idle");
      out.push({ address: k.address, status: st, title: k.name || "", tab_name: k.name || "", space_name: root.space_name,
        space: root.space, tab: null, program: k.program, sub: true });
      walk(root, k.address, depth + 1);
    }
  };
  for (const a of live ?? []) walk(a, a.address, 0);
  return out;
}

// Orders cards so children follow their parent (a terminal started by another agent, `parent` in terminals()). Sets c.parent
// (the parent card's key) and c.kids (number of child cards); a card whose parent is not on the board stays where it is.
export function linkCards(cards, parentOf) {
  const byAddr = new Map();
  for (const c of cards) if (c.address) byAddr.set(c.address, c);
  for (const c of cards) { c.parent = null; c.kids = 0; }
  for (const c of cards) {
    const pa = c.address ? parentOf(c.address) : c.parentHint;
    const p = typeof pa === "string" ? (byAddr.get(pa) ?? cards.find((x) => x.key === pa)) : null;
    if (p && p !== c) c.parent = p.key;
  }
  // a parent loop (A -> B -> A) would hide both: cut it at the card met first
  for (const c of cards) {
    const seen = new Set([c.key]); let p = cards.find((x) => x.key === c.parent);
    while (p) { if (seen.has(p.key)) { c.parent = null; break; } seen.add(p.key); p = cards.find((x) => x.key === p.parent); }
  }
  for (const c of cards) { const p = cards.find((x) => x.key === c.parent); if (p) p.kids++; }
  const out = [], done = new Set();
  const add = (c) => { if (done.has(c.key)) return; done.add(c.key); out.push(c); for (const k of cards) if (k.parent === c.key) add(k); };
  for (const c of cards) if (!c.parent) add(c);
  for (const c of cards) add(c);
  return out;
}

// The cards on the board, one nesting level at a time: without `family` the main sessions (no parent on the board);
// with `family` = any session's key, that session followed by its DIRECT sub-agents only (theirs stay one level deeper).
// Every listed card except the family head gets c.subs = its number of sub-agents at any depth (0: nothing below it).
export function boardCards(cards, family) {
  const under = (key, seen = new Set()) => cards.filter((k) => k.parent === key && !seen.has(k.key))
    .flatMap((k) => { seen.add(k.key); return [k, ...under(k.key, seen)]; });
  for (const c of cards) c.subs = 0;
  let list;
  if (family) {
    const head = cards.find((c) => c.key === family);
    if (!head) return [];
    list = [head, ...cards.filter((k) => k.parent === family && k !== head)];
  } else list = cards.filter((c) => !c.parent);
  for (const c of list) if (c.key !== family) c.subs = under(c.key).length;
  return list;
}

// A main session with sub-agents: its card with one or two sheets peeking out behind it (lower right), like a pile of paper.
const SHEET = 5;
function paperStack(el, w, h, n, t) {
  const sheet = (i) => div().absolute().left(SHEET * i).top(SHEET * i).w(w).h(h).rounded(12).border_1().border_color(t.border).bg(t.surface)
    .opacity(i === 1 ? 0.75 : 0.5);
  const kids = [];
  for (let i = n; i >= 1; i--) kids.push(sheet(i));
  kids.push(div().absolute().left(0).top(0).child(el));
  return div().relative().flex_none().w(w + SHEET * n).h(h + SHEET * n).children(kids);
}

// ---- the board ----------------------------------------------------------------------------------------------------
export default class AgentMap extends View {
  init(_props, cx) {
    this.files = new Map();        // terminal file id -> state (see freshState)
    this.demo = null;              // { t0, i, states: [state, state] } while the demo plays
    this.demoTask = null;
    this.frame = null;             // { task, ms } the script timer: zoom (16 ms) or clock hands (1 s), only while one of them runs
    this.polling = false; this.dirtyAll = false; this.dirty = new Set();   // what the next poll has to read
    this.wake = null;              // { at, task } one-shot render at the next known boundary (animation end, route leg hold end)
    this.wakeMin = Infinity;       // the earliest boundary seen while rendering (see soon)
    this.fx = new Map();           // native tween id -> { sig, born, fresh, pol, v0 } (see tween)
    this.fxMemo = new Map();       // values frozen for the life of a tween (a pulse's lane)
    this.fxSeen = new Set();       // ids used by the render in progress; the others are forgotten after it
    this.uids = new WeakMap(); this.uidN = 0;   // a stable number per entry object, for element ids
    this.paths = new Map();        // built static paths (contours, spokes) by map width
    this.clockSeen = false;        // the last render drew clock hands
    this.tick = false;             // the next render is a zoom frame: reuse the cards of the last render
    this.lastEvery = null;
    this.cutoff = 0;
    this.size = { width: 1200, height: 800 };
    this.zoom = null;              // { key, at, out } one map enlarged (click); out: animating back to the grid
    this.family = null;            // key of the session whose direct sub-agents are shown (null: only the main sessions)
    this.path = [];                // the families above the current one (right click / Esc pops one)
    this.error = null;
    this.handle = cx.focus_handle();   // the board takes the keyboard when it opens: Esc unzooms / closes it
    this.focusedOnce = false;
    this.poll(cx);
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    cx.spawn(async (cx) => {
      try { await fs.mkdir(DIR, { recursive: true }); } catch { }
      try {
        for (;;) {
          const paths = await watchFolder(DIR);
          // read only the .jsonl files reported; anything else (the folder itself, a batch with the root) means everything
          const ids = new Set();
          let all = !Array.isArray(paths) || !paths.length;
          for (const p of Array.isArray(paths) ? paths : []) {
            const name = String(p).split(/[\\/]/).pop();
            if (name.endsWith(".jsonl")) ids.add(name.slice(0, -6)); else all = true;
          }
          this.poll(cx, all ? null : ids);
        }
      } catch { /* no watch: the timer covers it */ }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "demo") this.startDemo(cx);
        if (c === "clear") this.clear();
        if (c === "zoom") { const first = boardCards(this.cards(Date.now()), this.family)[0]; if (first) this.clickCard(first, null); }
        if (c === "escape") this.escape();
        cx.notify();
      }
    });
  }

  shown() { return find(layout(), STACK)?.active === BOARD; }

  clear() {
    this.demo = null; this.demoTask?.cancel(); this.demoTask = null;
    this.cutoff = Date.now();
    for (const st of this.files.values()) Object.assign(st, freshState(), { cutoff: this.cutoff });
  }

  // ---- reading the files ----------------------------------------------------------------------------------------
  // `only`: a Set of file ids (from watchFolder) to read; null reads every live agent's file (the 2 s timer, a root change).
  poll(cx, only = null) {
    // hidden: GPUI drops the native transition state, so forget ours too (else a reshow draws faded/arrived targets at once)
    if (!this.shown()) { this.focusedOnce = false; this.fx?.clear(); this.fxMemo?.clear(); }
    if (this.demo) return;
    if (only) for (const id of only) this.dirty.add(id); else this.dirtyAll = true;
    if (this.polling) return;     // the running poll loops again for what was queued meanwhile
    this.polling = true;
    cx.spawn(async (cx) => {
      let changed = false;
      try {
        while (this.dirtyAll || this.dirty.size) {
          const all = this.dirtyAll, ids = [...this.dirty];
          this.dirtyAll = false; this.dirty.clear();
          if (await this.scan(all ? null : ids)) changed = true;
        }
        this.error = null;
      } catch (e) { this.error = String(e); }
      this.polling = false;
      if (changed && this.shown()) { cx.notify(); }
    });
  }

  // Reads the files of `ids` (null: all live agents; then also forgets the states of agents that are gone). True when state changed.
  async scan(ids) {
    let changed = false, live = [];
    try { live = boardAgents(agents(), terminals()).map((a) => sanitizeId(a.address)).filter((id) => ID_OK.test(id)); } catch { }
    let todo = live;
    if (ids) todo = live.filter((id) => ids.includes(id));
    else {
      let names = [];
      try { names = await fs.readdir(DIR); } catch { }
      const have = new Set(names.filter((n) => n.endsWith(".jsonl")).map((n) => n.slice(0, -6)));
      todo = live.filter((id) => have.has(id));
    }
    for (const id of todo) {
      let text = null;
      try { text = await readTextFile([DIR, `${id}.jsonl`].join(SEP)); } catch { }
      if (typeof text !== "string") continue;
      let st = this.files.get(id);
      if (!st) { st = Object.assign(freshState(), { cutoff: this.cutoff }); this.files.set(id, st); }
      if (this.ingest(st, text)) changed = true;
    }
    if (!ids) for (const id of [...this.files.keys()]) if (!live.includes(id)) { this.files.delete(id); changed = true; }
    return changed;
  }

  // Feeds the new complete lines of `text` into the state. True when anything was applied.
  ingest(st, text) { return ingestText(st, text); }

  // ---- demo -----------------------------------------------------------------------------------------------------
  startDemo(cx) {
    this.demoTask?.cancel();
    this.demo = { t0: Date.now(), i: 0, states: [freshState(), freshState()] };
    this.demoTask = cx.timer.every(100, (cx) => {
      const d = this.demo; if (!d) return;
      let t = Date.now() - d.t0;
      if (t > DEMO.length) { this.demo = { t0: Date.now(), i: 0, states: [freshState(), freshState()] }; cx.notify(); return; }
      let any = false;
      while (d.i < DEMO.events.length && DEMO.events[d.i][0] <= t) {
        const [, ag, o] = DEMO.events[d.i++], st = d.states[ag];
        if (o.ev === "_status") st.demoStatus = o.v;
        else apply(st, { ...o, ts: d.t0 + DEMO.events[d.i - 1][0], sid: `demo-${ag}` });
        any = true;
      }
      if (any) cx.notify();
    });
  }

  // ---- the agents on the board ----------------------------------------------------------------------------------
  cards(now) {
    const out = [];
    if (this.demo) {
      this.demo.states.forEach((st, i) => out.push({ key: `demo${i}`, name: DEMO_NAMES[i], space: "demo", status: st.demoStatus ?? "idle", address: null, st, parentHint: i === 1 ? "demo0" : null }));
    } else {
      let live = [], sp = [], terms = [];
      try { live = agents(); sp = spaces(); } catch { }
      try { terms = terminals(); } catch { }
      live = boardAgents(live, terms);
      this.parents = new Map(terms.filter((x) => x && typeof x.parent === "string" && x.parent).map((x) => [x.address, x.parent]));
      for (const a of live) {
        const st = this.files.get(sanitizeId(a.address));
        if (!st || !st.entries.length || now - st.lastTs > DAY) continue;
        const tab = sp.flatMap((s) => s.tabs ?? []).find((x) => x.id === a.tab);
        const title = String(a.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
        const name = a.sub && a.title ? a.title : tab?.named ? tab.name : (title && !/^claude( code)?$/i.test(title) && title !== a.program?.name ? title : (tab?.name || a.tab_name || a.space_name || a.address));
        out.push({ key: sanitizeId(a.address), name, space: a.space_name, status: a.status, address: a.address, sub: Boolean(a.sub), st });
      }
    }
    for (const c of out) {
      settle(c.st, now);
      // an open permission ask is shown only while herdr also says the agent is blocked (a denied call never gets an end line)
      c.asks = c.status === "blocked" ? openAsks(c.st) : [];
    }
    return linkCards(out, (a) => this.parents?.get(a));
  }

  // Left click goes one level in (main session -> it and its sub-agents -> one map enlarged), right click (or Esc) one level
  // back (see back()); a double-click opens the session.
  clickCard(c, e) {
    const now = Date.now();
    if ((e?.click_count ?? 1) >= 2) { this.zoom = null; this.focusAgent(c); return; }
    try { this.handle.focus(); } catch { }
    if (c.subs > 0 && c.key !== this.family) { this.zoom = null; if (this.family) this.path.push(this.family); this.family = c.key; return; }
    const z = this.zoom;
    if (z && z.key === c.key && !z.out) return;   // already the deepest level: left click only goes in
    this.zoom = { key: c.key, at: now, out: false };
  }

  unzoom() {
    if (this.zoom && !this.zoom.out) this.zoom = { key: this.zoom.key, at: Date.now(), out: true };
  }

  // One level back: an enlarged map -> the grid it came from; a session with its sub-agents -> the main sessions.
  // False when already at the top (right click then does nothing).
  back() {
    if (this.zoom && !this.zoom.out) { this.unzoom(); return true; }
    if (this.family) { this.family = this.path.pop() ?? null; return true; }
    return false;
  }

  // Esc: one level back; at the top, close the board (like the tab bar's Map button).
  escape() {
    if (!this.back()) run("layout.select", { stack: STACK, child: "work-body" });
  }

  onKey(e, cx) {
    if (e?.key !== "escape") return false;
    cx.stop_propagation();
    this.escape();
    cx.notify();
    return true;
  }

  focusAgent(c) {
    if (!c.address) return;
    run("layout.select", { stack: STACK, child: "work-body" });
    // a pane-less sub-agent has nothing to focus: peek at it like the agents list does
    if (c.sub) run("terminal.peek", { terminal: c.address });
    else run("agent.focus", { terminal: c.address });
  }

  // ---- animation ------------------------------------------------------------------------------------------------
  // Almost everything moves natively (see the top of the file): the script only renders on state changes and at one-shot wakes.
  // Two script timers remain, picked by `motion()`: mode "zoom" (16 ms, only while a click-to-enlarge runs: the growing map is
  // laid out in px by the script) and mode "clock" (1 s, only while a call runs and its clock hands are drawn). `wake` is the
  // earliest boundary (absolute ms) the last render found: an animation's end, a route leg's hold end, a glow's end.
  motion(now) {
    if (this.zoom && now - this.zoom.at < ZOOM_MS + 60) return { mode: "zoom", wake: null };
    return { mode: this.clockSeen ? "clock" : "none", wake: Number.isFinite(this.wakeMin) ? this.wakeMin : null };
  }

  // Notes a boundary (absolute ms) in the future: one render is scheduled for the earliest.
  soon(at, now) { if (at > now && at < this.wakeMin) this.wakeMin = at; }

  // One-shot render at `at` (absolute ms) or none; kept when the target is unchanged so renders do not reschedule it.
  keepWake(at, cx) {
    if ((this.wake?.at ?? null) === at) return;
    this.wake?.task.cancel(); this.wake = null;
    if (at === null) return;
    const task = cx.timer.after(Math.max(0, at - Date.now()) + 30, (cx) => { this.wake = null; if (this.shown()) cx.notify(); });
    this.wake = { at, task };
  }

  keepFrames(now, cx) {
    const { mode, wake } = this.motion(now);
    this.keepWake(wake, cx);
    const want = mode === "zoom" ? 16 : mode === "clock" ? CLOCK_MS : 0;
    if (this.frame && this.frame.ms === want) return;
    this.frame?.task.cancel(); this.frame = null;
    if (!want) return;
    const task = cx.timer.every(want, (cx) => {
      if (!this.shown()) { this.frame?.task.cancel(); this.frame = null; return; }
      this.tick = want === 16;      // a zoom frame: the render reuses the last cards instead of reading everything again
      cx.notify();                  // render() restarts the timer at the right pace (or leaves it off at rest)
    });
    this.frame = { task, ms: want };
  }

  // A native tween with a stable id. The first draw shows `v0` (the start), `needFrame` asks for one more render a frame later,
  // which shows the end values; the policy was fixed when the tween was created and does not change on later renders. A changed
  // `sig` (new target) re-plans it at once: the element already exists, so the app moves it from where it is.
  tween(id, sig, props, now) {
    let r = this.fx.get(id);
    if (!r) this.fx.set(id, r = { sig, born: now, fresh: true, pol: null, v0: null });
    else if (r.sig !== sig) { r.sig = sig; r.fresh = false; r.pol = null; r.born = now; }
    this.fxSeen.add(id);
    if (!r.pol) { const p = tweenPlan(props, now); r.pol = p.pol; r.v0 = p.v0; }
    const first = r.fresh && now - r.born < 12;
    if (first) this.needFrame = true; else r.fresh = false;
    const v = {};
    for (const p of Object.keys(props)) v[p] = first ? r.v0[p] : props[p].to;
    return { v, pol: r.pol };
  }

  // A value fixed when it is first asked for and kept as long as the element lives.
  memo(id, make) {
    this.fxSeen.add(id);
    if (!this.fxMemo.has(id)) this.fxMemo.set(id, make());
    return this.fxMemo.get(id);
  }

  uid(e) { let u = this.uids.get(e); if (!u) this.uids.set(e, u = ++this.uidN); return u; }

  // ---- drawing one map ------------------------------------------------------------------------------------------
  // Everything that moves is a native element: `fxd` (a tween with a stable id, see `tween`), `loop` or `spin`. What is left
  // to the script is static per render: paths, colours and the clock hands (1 s). Boundaries where something ends are noted
  // with `soon` so one render removes the finished element.
  mapEl(c, wM, now, t, C) {
    const k = wM / W, hM = H * k, st = c.st;
    const n = st.entries.length;
    const recent = st.entries.filter((e, i) => i >= n - RECENT || e.status === "run");
    const counts = st.cnt[st.cur] ?? {}, faults = st.flt[st.cur] ?? {};
    const els = [];
    const px = (v) => v * k;
    const soon = (at) => this.soon(at, now);
    const layer = (path, color) => div().absolute().inset_0().child(globalThis.window.paint_path(path, color));
    // `ck` names a static path: it is built once per map width and reused by later renders
    const poly = (pts, w, color, dash, ck) => {
      const key = ck ? `${ck}|${wM}|${w}` : null;
      let path = key ? this.paths.get(key) : null;
      if (!path) {
        let b = PathBuilder.stroke(Math.max(0.6, w * k));
        if (dash) b = b.dash_array(dash.map((d) => d * k));
        b = b.move_to(px(pts[0].x), px(pts[0].y));
        for (let i = 1; i < pts.length; i++) b = b.line_to(px(pts[i].x), px(pts[i].y));
        path = b.build();
        if (key) { if (this.paths.size > 400) this.paths.clear(); this.paths.set(key, path); }
      }
      return layer(path, color);
    };
    const disc = (x, y, r, bg) => div().absolute().left(px(x - r)).top(px(y - r)).w(px(2 * r)).h(px(2 * r)).rounded_full().bg(bg);
    const ring = (x, y, r, col, sw) => div().absolute().left(px(x - r)).top(px(y - r)).w(px(2 * r)).h(px(2 * r)).rounded_full().border(Math.max(1, sw * k)).border_color(col);
    const text = (x, y, w, h, size, color, s, bold) => div().absolute().left(px(x - w / 2)).top(px(y - h / 2)).w(px(w)).h(px(h)).flex().items_center().justify_center()
      .text_size(size).text_color(color).whitespace_nowrap().when(bold, (e) => e.font_semibold()).child(s);
    // a true circular arc clockwise from 12 o'clock (arc_to, split in halves so no piece passes 180°)
    const arc = (cx0, cy0, r, frac, w, color) => {
      const f = Math.max(0.001, Math.min(0.9999, frac)), R = px(r), X = px(cx0), Y = px(cy0);
      const at = (q) => { const a = -Math.PI / 2 + 2 * Math.PI * q; return [X + R * Math.cos(a), Y + R * Math.sin(a)]; };
      let b = PathBuilder.stroke(Math.max(0.6, w * k)).move_to(...at(0));
      if (f > 0.5) b = b.arc_to(R, R, 0, false, true, ...at(0.5));
      b = b.arc_to(R, R, 0, false, true, ...at(f));
      return layer(b.build(), color);
    };
    // a native tween on `el`: props {opacity|left|top|width|height: {from, to, s, e}} (see `tween`)
    const fxd = (el, id, sig, props) => {
      const w = this.tween(id, `${sig}|${wM}`, props, now);
      let e = el.id(id);
      for (const p of Object.keys(w.v)) e = e[MOT[p]](w.v[p]).transition(p, w.pol[p]);
      return e;
    };
    // a ring that grows from radius r0 to r1 around `p` while it fades from o0 to 0 between s and en (centred by flex, so
    // the width and height transitions need no left/top in step)
    const grow = (id, p, r0, r1, color, sw, s, en, o0) => {
      soon(en);
      const inner = div().rounded_full().border(Math.max(1, sw * k)).border_color(color);
      return div().absolute().left(px(p.x - r1)).top(px(p.y - r1)).w(px(2 * r1)).h(px(2 * r1)).flex().items_center().justify_center()
        .child(fxd(inner, id, "g", { width: { from: px(2 * r0), to: px(2 * r1), s, e: en }, height: { from: px(2 * r0), to: px(2 * r1), s, e: en }, opacity: { from: o0, to: 0, s, e: en } }));
    };

    // contours
    [[66, 62], [104, 97], [142, 132]].forEach(([rx, ry], ci) => {
      const pts = Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return { x: CX + rx * Math.cos(a), y: CY + ry * Math.sin(a) }; });
      els.push(poly(pts, 0.7, ah(C.line, 0.35), [2, 5], `ct${ci}`));
    });
    const core = { x: CX, y: CY }, agentsAt = place(IDX.agents);
    // spokes, worn with use
    STATIONS.forEach((s, i) => {
      const p = place(i), a = edge(core, p, HUB), b = edge(p, core, NODE);
      const worn = Math.min(1, Math.log2(1 + (counts[s.id] ?? 0)) / 7), w = 1 + 2.6 * worn;
      els.push(poly([a, b], w, ah(C.line, 0.55), null, `sp${i}`));
      if (worn > 0) els.push(poly([a, b], w, ah(s.id === "memory" ? C.mem : C.accent, worn * 0.55), null, `sp${i}`));
    });

    // per station state
    const info = STATIONS.map((s, i) => {
      const own = recent.filter((e) => e.station === s.id && e.mark !== "ask"), running = own.filter((e) => e.status === "run"), latest = own[own.length - 1];
      const latestAt = latest ? (latest.end ?? latest.ts) : 0, since = latest ? now - latestAt : Infinity;
      const alarm = [...own].reverse().find((e) => e.status === "err");
      const alarmAt = alarm ? (alarm.end ?? alarm.ts) : 0, alarmAge = alarm ? now - alarmAt : Infinity;
      const asking = (c.asks ?? []).filter((a) => a.station === s.id);
      const isAlarm = alarmAge < ALARM_MS, isLit = running.length > 0 || since < GLOW_MS;
      // when the glow / the lit ring fades out (absolute ms), for the tween and for the wake that removes it
      const fadeFrom = isAlarm ? alarmAt : latestAt, span = isAlarm ? ALARM_MS : GLOW_MS;
      return { s, i, p: place(i), own, running, since, alarmAge, asking, isAlarm, isLit, fadeFrom, span, fadeAt: fadeFrom + span };
    });
    const tone = (e) => (e.station === "memory" ? [C.mem, C.memHot] : [C.accent, C.hot]);
    let clock = false;

    // under: glow, beat, clock hands
    for (const q of info) {
      const { s, p, running, isAlarm, isLit, fadeAt, fadeFrom } = q;
      const [main, hot] = tone({ station: s.id });
      const color = isAlarm ? C.red : main;
      if (isLit || isAlarm) {
        // lit by a running call: steady; after it (or an alarm) the glow fades out natively over GLOW_MS / ALARM_MS
        const steady = running.length > 0 && !isAlarm;
        const glow = steady ? { opacity: { from: 0.16, to: 0.16, s: 0, e: 0 } } : { opacity: { from: 0.3, to: 0, s: fadeFrom, e: fadeAt } };
        els.push(fxd(disc(p.x, p.y, NODE + 10, color), `gl-${c.key}-${s.id}`, `${steady ? "s" : "f"}${color}${fadeFrom}`, glow));
        if (!steady) soon(fadeAt);
      }
      if (q.asking.length) { els.push(disc(p.x, p.y, NODE + 12, ah(t.blocked, 0.28))); els.push(ring(p.x, p.y, NODE + 7, ah(t.blocked, 0.9), 1.6)); }
      if (running.length) {
        const t0 = Math.min(...running.map((e) => e.ts)), elapsed = now - t0;
        if (elapsed < BEAT_MS) {
          // a breathing ring (native loop: there and back), for the first BEAT_MS of the call
          const R1 = NODE + 15;
          els.push(div().absolute().left(px(p.x - R1)).top(px(p.y - R1)).w(px(2 * R1)).h(px(2 * R1)).flex().items_center().justify_center()
            .child(div().id(`beat-${c.key}-${s.id}-${Math.round(wM)}`).w(px(2 * NODE)).h(px(2 * NODE)).rounded_full().border(Math.max(1, 1.3 * k)).border_color(color)
              // period 1000 = the clock re-render pace: should a re-specified loop restart, it restarts at a cycle end
              .loop("width", { from: px(2 * NODE), to: px(2 * R1), period: 1000 }).loop("height", { from: px(2 * NODE), to: px(2 * R1), period: 1000 })
              .loop("opacity", { from: 0.9, to: 0, period: 1000 })));
          soon(t0 + BEAT_MS);
        }
        els.push(arc(p.x, p.y, NODE + 4, Math.max(0.01, (elapsed % 60000) / 60000), 2.2, hot));
        els.push(arc(p.x, p.y, NODE + 8, Math.max(0.01, Math.min(elapsed, 600000) / 600000), 1.2, hot));
        clock = true;
      }
    }
    if (clock) this.clockSeen = true;

    // route through the last stations: a new leg fades in; after the hold the one-shot wake sets it to fade out natively
    const stops = routeOf(recent);
    for (let j = 1; j < stops.length; j++) {
      const from = stops[j - 1], to = stops[j];
      const holdEnd = to.at + TRAIL_HOLD_MS, fadeEnd = holdEnd + TRAIL_FADE_MS;
      if (now >= fadeEnd) continue;
      const isHead = j === stops.length - 1, holding = now < holdEnd;
      const base = 0.12 + (0.5 * j) / (stops.length - 1);
      const { pts, end } = legPoints(IDX[from.station], IDX[to.station], 1);
      const grp = div().absolute().inset_0().child(poly(pts, isHead ? 1.5 : 1.1, ah(C.trail, base)));
      if (isHead) grp.child(disc(end.x, end.y, 2.4, ah(C.trail, 0.85)));
      const props = holding ? { opacity: { from: 0, to: 1, s: to.at, e: to.at + 500 } } : { opacity: { from: 1, to: 0, s: holdEnd, e: fadeEnd } };
      els.push(fxd(grp, `leg-${c.key}-${to.at}-${from.station}-${to.station}`, holding ? "in" : "out", props));
      soon(holding ? holdEnd : fadeEnd);
    }

    // beams, pulses, ripples
    const ends = (e) => {
      const p = place(IDX[e.station]), fromAgents = e.from === "agents" && e.station !== "agents";
      const start = fromAgents ? agentsAt : core;
      return [edge(start, p, fromAgents ? NODE : HUB), edge(p, start, NODE)];
    };
    const flights = recent.filter((e) => now - e.ts < PULSE_MS + RIPPLE_MS).slice(-14);
    const returns = recent.filter((e) => e.end !== undefined && e.from !== "inbound" && e.mark === undefined && now - e.end < PULSE_MS + RIPPLE_MS).slice(-14);
    const beams = recent.filter((e) => now - e.ts < GLOW_MS / 2).slice(-10);
    // the side lane of a pulse is fixed when it starts (the list of its peers shrinks while it flies)
    const lane = (id, list, e) => this.memo(`ln-${id}`, () => { const peers = list.filter((x) => x.station === e.station && x.from === e.from); return (peers.indexOf(e) - (peers.length - 1) / 2) * 5; });
    // a dot (or hollow ring) flies a -> b in PULSE_MS from t0 with a tail of two weaker, smaller dots 45 ms apart; each fades over its last 18%
    const pulse = (id, a, b, color, t0, radius, hollow) => {
      for (let kk = hollow ? 0 : 2; kk >= 0; kk--) {
        const s = t0 + kk * 45, en = s + PULSE_MS;
        if (now >= en) continue;
        const peak = 1 - 0.36 * kk, r = radius * (1 - 0.27 * kk);
        const dot = hollow ? ring(a.x, a.y, r, color, 1.4) : disc(a.x, a.y, r, color);
        els.push(fxd(dot, `${id}-${kk}`, "p", {
          left: { from: px(a.x - r), to: px(b.x - r), s, e: en }, top: { from: px(a.y - r), to: px(b.y - r), s, e: en },
          opacity: { from: peak, to: 0, s: s + 0.82 * PULSE_MS, e: en },
        }));
        soon(en);
      }
    };
    const ripple = (id, p, r, color, ts) => {
      const s = ts + PULSE_MS, en = s + RIPPLE_MS;
      if (now < s) { soon(s); return; }
      if (now < en) els.push(grow(id, p, r, r + 11, color, 1.2, s, en, 0.7));
    };
    for (const e of beams) {
      const [a, b] = ends(e), en = e.ts + GLOW_MS / 2, line = poly([a, b], 1.4, e.status === "err" ? C.red : tone(e)[0], e.from === "inbound" ? [3, 4] : null);
      els.push(fxd(div().absolute().inset_0().child(line), `bm-${c.key}-${this.uid(e)}`, "b", { opacity: { from: 0.75, to: 0, s: e.ts, e: en } }));
      soon(en);
    }
    for (const e of flights) {
      const id = `${c.key}-${this.uid(e)}`, [a, b] = aside(...ends(e), lane(id, flights, e)), color = e.status === "err" ? C.red : tone(e)[1];
      if (e.from === "inbound") { pulse(`pu-${id}`, b, a, color, e.ts, 3.8, true); ripple(`rp-${id}`, core, HUB - 2, color, e.ts); }
      else { pulse(`pu-${id}`, a, b, color, e.ts, 3.8); ripple(`rp-${id}`, place(IDX[e.station]), NODE, color, e.ts); }
    }
    for (const e of returns) {
      const id = `${c.key}-${this.uid(e)}`, [a, b] = aside(...ends(e), lane(`r${id}`, returns, e));
      pulse(`pr-${id}`, b, a, e.status === "ok" ? C.ash : C.red, e.end, 2.6);
    }

    // sub-agents circling the agents station: one svg of dots that turns natively (see orbit-N.svg); the list is in the tooltip
    const crew = [...st.subs.entries()].slice(0, 6);
    if (crew.length) {
      els.push(div().absolute().left(px(agentsAt.x - 34)).top(px(agentsAt.y - 34)).w(px(68)).h(px(68))
        .child(svg(`mods/agent-map/orbit-${crew.length}.svg`).id(`orbit-${c.key}-${crew.length}`).size(px(68)).text_color(C.hot).spin(7000)));
    }
    const crewTip = crew.map(([subKey, sub]) => {
      const busy = st.entries.filter((e) => e.sub === subKey && e.status === "run");
      return `↳ ${sub.label || st.subNames.get(subKey) || "subagent"} · ${busy.length ? `working: ${busy[busy.length - 1].label || busy[busy.length - 1].tool}` : "idle"}`;
    });

    // nodes
    const fs1 = Math.max(9, 11.5 * k), fs2 = Math.max(8, 9.5 * k);
    for (const q of info) {
      const { s, p, own, running, asking, isAlarm, isLit, fadeAt, fadeFrom } = q;
      const [main, hot] = tone({ station: s.id });
      const color = isAlarm ? C.red : main;
      const count = counts[s.id] ?? 0, bw = Math.max(1, 1.2 * k);
      const glyph = isAlarm ? C.red : isLit ? hot : s.id === "memory" && count > 0 ? main : C.ash;
      const subTag = (e) => (e.sub && st.subNames.get(e.sub) ? ` (↳ ${st.subNames.get(e.sub)})` : "");
      const tip = [`${s.name}${count ? ` · ${count}` : ""}`, ...(s.id === "agents" ? crewTip : []), ...asking.map((a) => askText(a)),
        ...own.slice(-4).reverse().map((e) => `${e.status === "run" ? "● " : e.status === "err" ? "✕ " : "· "}${e.label || e.tool}${subTag(e)}`)].join("\n");
      // the node's own ring is the idle one; the lit ring (running: steady, after a call: fading out natively) lies over it
      const lit = !asking.length && (running.length > 0 || isLit || isAlarm);
      const ringProps = running.length ? { opacity: { from: 1, to: 1, s: 0, e: 0 } } : { opacity: { from: 1, to: 0, s: fadeFrom, e: fadeAt } };
      els.push(div().id(`n-${c.key}-${s.id}`).absolute().left(px(p.x - NODE)).top(px(p.y - NODE)).w(px(2 * NODE)).h(px(2 * NODE)).rounded_full()
        .bg(C.raised).border(bw).border_color(asking.length ? t.blocked : C.line).flex().items_center().justify_center().tooltip(tip)
        .child(svg(s.icon).size(px(20)).text_color(glyph))
        .when(lit, (e) => e.child(fxd(div().absolute().left(-bw).top(-bw).w(px(2 * NODE)).h(px(2 * NODE)).rounded_full().border(bw).border_color(color),
          `rg-${c.key}-${s.id}`, `${running.length ? "s" : "f"}${color}${fadeFrom}`, ringProps))));
      els.push(text(p.x, p.y + NODE + 15, 110, 16, fs1, isLit || isAlarm ? C.bone : C.ash, s.name));
      if (count > 0 && k >= 0.55) els.push(text(p.x, p.y + NODE + 28, 90, 14, fs2, C.dim, String(count)));
      const corner = NODE * 0.74;
      if (running.length > 1) {
        els.push(disc(p.x + corner, p.y - corner, 8, color));
        els.push(disc(p.x + corner, p.y - corner, 7, C.raised));
        els.push(text(p.x + corner, p.y - corner, 20, 14, Math.max(7.5, 8.5 * k), hot, `×${running.length}`));
      }
      const fl = faults[s.id] ?? 0;
      if (fl > 0) {
        els.push(disc(p.x - corner, p.y - corner, 7.5, C.red));
        els.push(text(p.x - corner, p.y - corner, 16, 14, Math.max(7.5, 9 * k), t.background ?? C.raised, fl > 99 ? "99+" : String(fl), true));
      }
    }

    // the core: the agent, in its herdr status colour; a native loop breathes the halo (faster while a call runs)
    const anyRunning = recent.some((e) => e.status === "run");
    const sc = statusColor(t, c.status), HALO = CORE + 13;
    els.push(div().absolute().left(px(CX - HALO)).top(px(CY - HALO)).w(px(2 * HALO)).h(px(2 * HALO)).flex().items_center().justify_center()
      .child(div().id(`breath-${c.key}-${anyRunning ? 1 : 0}-${Math.round(wM)}`).w(px(2 * (CORE + 3))).h(px(2 * (CORE + 3))).rounded_full().bg(sc)
        .loop("width", { from: px(2 * (CORE + 3)), to: px(2 * HALO), period: anyRunning ? 1000 : 4800 })
        .loop("height", { from: px(2 * (CORE + 3)), to: px(2 * HALO), period: anyRunning ? 1000 : 4800 })
        .loop("opacity", { from: 0.05, to: anyRunning ? 0.24 : 0.12, period: anyRunning ? 1000 : 4800 })));
    const maxC = k < 0.75 ? 17 : 22, label = c.name.length > maxC ? c.name.slice(0, maxC - 1) + "…" : c.name;
    els.push(div().id(`core-${c.key}`).absolute().left(px(CX - CORE)).top(px(CY - CORE)).w(px(2 * CORE)).h(px(2 * CORE)).rounded_full()
      .bg(C.raised).border(Math.max(1.5, 2 * k)).border_color(sc).flex().items_center().justify_center().overflow_hidden()
      .tooltip([c.name, ...(c.asks ?? []).map(askText), ...(c.parent ? [`↳ ${c.parentName}`] : []), ...infoLine(st, true), c.address ? "click: enlarge · right-click: back · double-click: open session" : ""].filter(Boolean).join("\n"))
      .child(div().w(px(2 * CORE * 0.82)).max_h(px(2 * CORE * 0.72)).overflow_hidden().text_center().text_size(Math.max(8, 11 * k)).line_height(1.15).text_color(C.bone).child(label)));
    // the context window as a ring around the core: fills as the session goes, empties at a compaction
    if (typeof st.ctx === "number") {
      const pct = ctxPct(st);
      const rr = CORE + 5, col = pct >= 90 ? C.red : pct >= 70 ? C.accent : C.ash;
      els.push(ring(CX, CY, rr + 1.1, ah(C.line, 0.7), 2.2));   // track: a bordered circle (the border sits inside, hence +half width)
      if (pct > 0) els.push(arc(CX, CY, rr, pct / 100, 2.2, col));
      // the percentage in the gap between the spokes at 12 and 1 o'clock (a station spoke sits every 36 degrees)
      const gx = CX + 62 * Math.sin(Math.PI / 10), gy = CY - 62 * Math.cos(Math.PI / 10);
      els.push(div().id(`ctx-${c.key}`).absolute().left(px(gx - 17)).top(px(gy - 7)).w(px(34)).h(px(14)).rounded(px(5)).bg(ah(C.raised, 0.92)).flex().items_center().justify_center()
        .text_size(Math.max(7.5, 9 * k)).text_color(col).whitespace_nowrap().tooltip(ctxTip(st)).child(`${pct}%`));
    }
    // the answer leaves the core as one wide ring
    const done = [...recent].reverse().find((e) => e.mark === "done");
    if (done && now - done.ts < DONE_MS) els.push(grow(`dn-${c.key}-${this.uid(done)}`, core, CORE, CORE + 38, C.bone, 1.6, done.ts, done.ts + DONE_MS, 0.6));

    return div().relative().w(wM).h(hM).flex_none().children(els);
  }

  // ---- the board ------------------------------------------------------------------------------------------------
  render(cx) {
    const t = theme(), now = Date.now(), C = palette(t);
    // the cards are read once per render; a zoom frame (16 ms) reuses the last ones, the data cannot change within 0.34 s that matters
    const everyCard = this.tick && this.lastEvery ? this.lastEvery : this.cards(now);
    this.tick = false; this.lastEvery = everyCard;
    this.wakeMin = Infinity; this.clockSeen = false; this.fxSeen = new Set();
    const colors = agentColors(t);
    // a colour per terminal address (sticky hash slots), not per place in the list
    this.slots = colorSlots(everyCard.map((c) => c.address ?? c.key), colors.length, this.slots ?? new Map());
    everyCard.forEach((c) => { c.color = colors[this.slots.get(c.address ?? c.key)]; c.parentName = everyCard.find((x) => x.key === c.parent)?.name ?? ""; });
    let cards = boardCards(everyCard, this.family);
    while (this.family && cards.length < 2) { this.family = this.path.pop() ?? null; cards = boardCards(everyCard, this.family); }
    if (!this.family) this.path = [];
    if (!this.focusedOnce) {      // the board just opened: take the keyboard (Esc unzooms / closes); after layout, hence the timer
      this.focusedOnce = true;
      cx.timer.after(60, () => { try { this.handle.focus(); } catch { } });
    }
    // zoom state: progress eased; drop it when the agent is gone or the way back has finished
    if (this.zoom && (!cards.some((c) => c.key === this.zoom.key) || (this.zoom.out && now - this.zoom.at >= ZOOM_MS))) this.zoom = null;
    const zoomOn = Boolean(this.zoom) && cards.length > 1;
    const zp = zoomOn ? Math.min(1, (now - this.zoom.at) / ZOOM_MS) : 0, ze = 1 - Math.pow(1 - zp, 3);
    const zoomZ = zoomOn ? (this.zoom.out ? 1 - ze : ze) : 0;
    const zoomCard = zoomOn && !this.zoom.out ? cards.find((c) => c.key === this.zoom.key) : null;
    const listed = zoomCard ? [zoomCard] : cards;   // feed and files follow the enlarged map
    // on_size_change reports window px (layout px x the UI zoom); every size below is in layout px.
    const zoom = settings()?.zoom || 1, sz = { width: this.size.width / zoom, height: this.size.height / zoom }, wide = sz.width >= 860;
    // no top bar; a slim notice line only for the demo or a read error
    const notice = Boolean(this.demo) || Boolean(this.error);
    const bodyH = Math.max(200, sz.height - (notice ? NOTE_H + GAP : 0));
    const feedH = Math.max(110, Math.min(FEED_ROWS * 20 + 36, Math.round(bodyH * 0.3)));
    // Feed and Files share the bottom row (side by side, same size) so the maps get the full width; narrow: stacked.
    const areaW = Math.max(300, sz.width);
    const bottomW = wide ? Math.floor((areaW - GAP) / 2) : areaW;
    const areaH = Math.max(120, bodyH - feedH - GAP - (wide ? 0 : feedH + GAP));
    // One map enlarged: Feed on its left, Files on its right, both full height, so the map gets the whole height.
    // The three panels get the target layout; native transitions (see `place` below) glide them there.
    const sideOn = wide && Boolean(zoomCard);
    const sideW = Math.floor(Math.max(260, Math.min(420, areaW * 0.24)));
    const bigMapsW = Math.max(300, areaW - 2 * (sideW + GAP));
    const A = wide
      ? { maps: [0, 0, areaW, areaH], feed: [0, areaH + GAP, bottomW, feedH], files: [bottomW + GAP, areaH + GAP, bottomW, feedH] }
      : { maps: [0, 0, areaW, areaH], feed: [0, areaH + GAP, areaW, feedH], files: [0, areaH + 2 * GAP + feedH, areaW, feedH] };
    const B = { maps: [sideW + GAP, 0, bigMapsW, bodyH], feed: [0, 0, sideW, bodyH], files: [areaW - sideW, 0, sideW, bodyH] };
    const [, , mapsW, mapsH] = wide ? B.maps : A.maps;   // the enlarged map's target room
    // The grid: try every column count in two layouts, Feed+Files below the maps (A) or stacked in a column on the
    // right (C), and keep the one with the biggest maps. Room the maps don't need goes to the panels, not to margins.
    const nC = cards.length;
    const cardHOf = (w) => CARD_HEAD + 2 + (H * w) / W;
    const gridIn = (aw, ah, scrolling) => {
      let best = null;
      for (const cols of scrolling ? [Math.min(3, Math.max(1, Math.floor((aw + GAP) / (MIN_FIT_W + GAP))))] : Array.from({ length: Math.min(Math.max(nC, 1), 6) }, (_, i) => i + 1)) {
        const rows = Math.ceil(Math.max(nC, 1) / cols), cellW = (aw - GAP * (cols - 1)) / cols, cellH = (ah - GAP * (rows - 1)) / rows;
        const w = Math.floor(Math.max(180, Math.min(cellW, scrolling ? cellW : (cellH - CARD_HEAD - 2) * (W / H), 820)));
        if (!best || w > best.w) best = { cols, rows, w };
      }
      best.usedW = best.cols * best.w + GAP * (best.cols - 1);
      best.usedH = best.rows * cardHOf(best.w) + GAP * (best.rows - 1);
      return best;
    };
    // Fit everything on screen while the maps stay readable (>= MIN_FIT_W wide); with too many agents the same grid
    // keeps its map size and the maps area scrolls instead of shrinking the maps further.
    const fitA = gridIn(areaW, areaH, false), fitS = wide ? gridIn(areaW - sideW - GAP, bodyH, false) : null;
    const scroll = nC > 1 && Math.max(fitA.w, fitS ? fitS.w : 0) < MIN_FIT_W;
    let grid = scroll ? gridIn(areaW, areaH, true) : fitA, L = A;
    if (nC && !scroll) {
      const sideFor = fitS;
      if (sideFor && sideFor.w > grid.w * 1.04) {
        grid = sideFor;
        const mW = Math.max(grid.usedW, areaW - Math.max(sideW, 560) - GAP), colW = areaW - mW - GAP, fH = Math.floor((bodyH - GAP) / 2);
        L = { maps: [0, 0, mW, bodyH], feed: [mW + GAP, 0, colW, fH], files: [mW + GAP, fH + GAP, colW, bodyH - fH - GAP] };
      } else {
        const mH = Math.min(areaH, Math.ceil(grid.usedH) + 2), more = areaH - mH;   // leftover height grows Feed and Files
        L = wide
          ? { maps: [0, 0, areaW, mH], feed: [0, mH + GAP, bottomW, feedH + more], files: [bottomW + GAP, mH + GAP, bottomW, feedH + more] }
          : { maps: [0, 0, areaW, mH], feed: [0, mH + GAP, areaW, feedH + Math.floor(more / 2)], files: [0, mH + 2 * GAP + feedH + Math.floor(more / 2), areaW, feedH + Math.ceil(more / 2)] };
      }
    }
    const R = (sideOn ? B : L);
    const feedMax = Math.max(FEED_ROWS, Math.floor((R.feed[3] - 36) / 20));
    const MOVE = { duration: ZOOM_MS, easing: "ease-out" }, ROW = { duration: ROW_IN_MS, easing: "ease-out" };
    // Rows keep an id per row (not per slot) and sit at top = slot * 20, so herdr slides them when one is added or moves;
    // a row seen for the first time (after the first render) starts transparent and fades in on the next frame.
    const seen = (this.rowSeen ??= new Map()), firstPaint = !this.painted, drawn = new Set();
    const rowFresh = (key) => {
      drawn.add(key);
      if (!seen.has(key)) seen.set(key, firstPaint ? 0 : now);
      return seen.get(key) === now;
    };
    const rowBox = (key, i, el) => {
      const fresh = rowFresh(key);
      if (fresh) this.needFrame = true;
      return div().id(key).absolute().left(0).w_full().top(3 + i * 20).h(20).opacity(fresh ? 0 : 1)
        .transition("top", ROW).transition("opacity", ROW).child(el);
    };

    // header
    const header = h_flex().id("am-note").h(NOTE_H).flex_none().px(10).gap(10).items_center().text_size(11)
      .when(Boolean(this.demo), (e) => e.child(div().text_color(t.dim).child("demo, in memory only")))
      .when(Boolean(this.error), (e) => e.child(div().min_w(0).truncate().text_color(t.blocked).child(`read failed: ${this.error}`)));

    // the maps
    let mapsArea;
    if (!cards.length) {
      mapsArea = v_flex().size_full().items_center().justify_center().gap(6).rounded(10).border_1().border_color(t.border).bg(t.surface)
        .child(div().text_size(15).text_color(t.foreground).child("No Claude activity yet"))
        .child(div().text_size(12).text_color(t.muted).child("The hook in ~/.claude/settings.json writes the events of each Claude agent to data/agent-map/, this board draws them."));
    } else {
      // columns and map size come from `grid` above; too many agents (maps would drop under MIN_FIT_W): up to 3 per row at MIN_FIT_W+, scrolling
      const { cols, w: wGrid } = grid;
      // zoom: z 0 = grid, 1 = the chosen map alone at full size; the others shrink and fade out meanwhile
      const bigW = Math.floor(Math.max(180, Math.min(mapsW - 4, (mapsH - CARD_HEAD - 4) * (W / H))));
      const z = zoomOn ? zoomZ : 0;
      const card = (c) => {
        const sc = statusColor(t, c.status), sel = zoomOn && c.key === this.zoom.key;
        const wM = sel ? Math.round(wGrid + (bigW - wGrid) * z) : (z === 0 && c.subs > 0 ? wGrid - SHEET * Math.min(2, c.subs) : wGrid);
        const el = v_flex().id(`card-${c.key}`).w(wM).flex_none().rounded(12).border_1().border_color(sel && z > 0.5 ? ah(c.color, 0.6) : c.key === this.family ? t.accent : t.border).bg(t.surface).overflow_hidden()
          .cursor_pointer().on_mouse_down("left", stop)
          .on_click((e, cx) => { cx.stop_propagation(); this.clickCard(c, e); cx.notify(); })
          .child(h_flex().id(`head-${c.key}`).h(CARD_HEAD).flex_none().px(10).gap(7).items_center().text_size(12)
            .hover((s) => s.bg(t.hover)).tooltip([c.name, ...(c.asks ?? []).map(askText), ...(c.parent ? [`↳ ${c.parentName}`] : []), ...infoLine(c.st, false),
              c.address ? (sel ? "right-click: back · double-click: open session" : c.subs > 0 ? `click: show with its ${c.subs} sub-agent${c.subs > 1 ? "s" : ""} · double-click: open session` : "click: enlarge · double-click: open session") : "",
              this.family && !sel ? `right-click or Esc: back to ${this.path.length ? "the level above" : "the main sessions"}` : ""].filter(Boolean).join("\n"))
            .child(c.status === "working" ? div().w(12).flex_none().text_color(sc).frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90) : div().size(7).flex_none().rounded_full().bg(sc))
            .child(div().size(6).flex_none().rounded_full().bg(c.color))
            .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(c.name))
            .when(Boolean(c.parent), (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(`↳ ${c.parentName}`)))
            .when(c.subs > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`+${c.subs} sub-agent${c.subs > 1 ? "s" : ""}`)))
            .child(div().flex_1())
            .when(wM >= 380 && infoLine(c.st, false).length > 0, (e) => e.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(infoLine(c.st, false)[0])))
            .when(Boolean(c.space), (e) => e.child(div().min_w(0).truncate().text_color(t.dim).child(c.space)))
            .child(c.asks?.length
              ? div().min_w(0).max_w(wM * 0.5).truncate().text_color(sc).child(askText(c.asks[c.asks.length - 1]))
              : div().flex_none().text_color(sc).child(STATUS_WORD[c.status] ?? String(c.status))))
          .child(this.mapEl(c, wM, now, t, C));
        if (z === 0 && c.subs > 0) return paperStack(el, wM, cardHOf(wM), Math.min(2, c.subs), t);
        if (sel || z === 0) return el;
        // a map making way: shrinks to nothing and fades
        const cardH = CARD_HEAD + 2 + (H * wGrid) / W;
        return div().w(wGrid * (1 - z)).h(cardH * (1 - z)).flex_none().overflow_hidden().opacity(1 - z).child(el);
      };
      let shown = cards;
      if (zoomOn && z >= 1) shown = cards.filter((c) => c.key === this.zoom.key);
      const g = GAP * (1 - z), perRow = shown.length === cards.length ? cols : 1;
      const lines = [];
      for (let r = 0; r < Math.ceil(shown.length / perRow); r++) lines.push(h_flex().gap(g).justify_center().flex_none().children(shown.slice(r * perRow, (r + 1) * perRow).map(card)));
      mapsArea = v_flex().id("am-maps").size_full().gap(g).items_center().justify_center()
        
        .when(scroll && !(zoomOn && z >= 1), (e) => e.justify_start().overflow_y_scroll()).when(!scroll || (zoomOn && z >= 1), (e) => e.overflow_hidden()).children(lines);
    }

    // the feed: the last rows over all agents, finished calls in a row at one station folded into one
    const all = listed.flatMap((c) => c.st.entries.map((e) => ({ e, c }))).sort((a, b) => a.e.ts - b.e.ts);
    const plain = (x) => x.e.status === "ok" && x.e.mark === undefined;
    const rows = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const x = all[i], took = x.e.end === undefined ? 0 : Math.max(0, x.e.end - x.e.ts), last = rows[rows.length - 1];
      if (last && plain(x) && plain(last.x) && last.x.c === x.c && last.x.e.station === x.e.station && last.x.e.from === x.e.from) { last.times++; last.took += took; last.first = x; continue; }
      if (rows.length >= feedMax) break;
      rows.push({ x, first: x, times: 1, took });
    }
    // a row's id comes from its oldest call, so a call folding into it keeps the row (and its place) the same
    const rowKey = (r) => `fr-${r.first.c.key}-${r.first.e.ts}-${sanitizeId(r.first.e.id ?? r.first.e.station ?? "")}`;
    const mono = "JetBrains Mono";
    const feedRow = (r, i) => {
      const { e, c } = r.x, run = e.status === "run", bad = e.status === "err";
      const asking = e.mark === "ask", waiting = asking && (c.asks ?? []).includes(e.ask);
      const glyph = asking ? "?" : run ? "●" : bad ? "✕" : "·", gc = asking ? (waiting ? t.blocked : t.dim) : run ? t.accent : bad ? C.red : t.dim;
      const ms = e.mark === "done" && e.took ? e.took : r.took;
      const time = asking ? (waiting ? "waiting" : "—") : run ? "running" : ms > 0 ? fmtMs(ms) : "—";
      const dimmed = e.status === "ok" && !waiting;
      const shownPath = e.path ?? e.file ?? e.ask?.path ?? e.ask?.file;
      return rowBox(rowKey(r), i, h_flex().size_full().px(10).gap(8).items_center().text_size(12).font_family(mono).tooltip([e.label || e.tool, shownPath].filter(Boolean).join("\n"))
        .child(div().w(10).flex_none().text_color(gc).child(glyph))
        .child(div().id(`feed-a-${i}`).w(110).flex_none().truncate().text_color(c.color).cursor_pointer().hover((s) => s.underline()).on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.focusAgent(c); cx.notify(); }).child(c.name))
        .child(div().w(66).flex_none().truncate().text_color(dimmed ? t.dim : t.foreground).child(STATIONS[IDX[e.station]]?.name ?? e.station))
        .child(div().flex_1().min_w(0).truncate().text_color(waiting ? t.blocked : dimmed ? t.muted : bad ? C.red : t.foreground).child(`${e.label}${r.times > 1 ? `  +${r.times - 1}` : ""}`))
        .child(div().w(64).flex_none().flex().justify_end().text_color(waiting ? t.blocked : run ? t.accent : bad ? C.red : t.dim).child(time)));
    };
    const feed = v_flex().id("am-feed").size_full().rounded(10).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
      .child(div().h(28).flex_none().px(10).flex().items_center().text_size(12).font_semibold().text_color(t.muted).border_b(1).border_color(t.border).child("Feed"))
      .child(div().id("am-feed-rows").flex_1().min_h(0).overflow_y_scroll()
        .child(rows.length ? div().relative().w_full().h(rows.length * 20 + 6).children(rows.map(feedRow)) : div().px(10).py(7).text_size(12).text_color(t.dim).child("Nothing yet")));

    // files touched in the last 10 minutes, newest first; red when 2+ agents wrote one
    const flist = collectFiles(listed, now);
    const fileRow = (f, i) => {
      const conflict = f.writers.size >= 2;
      const who = [...f.ags.values()].map((c) => c.name).join(", ");
      const first = [...f.ags.values()][0];
      // one id per path: a file touched again slides up to the top instead of popping up there
      return rowBox(`fl-${sanitizeId(f.path.slice(-56))}-${hash(f.path)}`, i, h_flex().size_full().px(10).gap(8).items_center().text_size(12).font_family(mono)
        .tooltip(`${f.show}\n${conflict ? "written by " : f.wrote ? "written by " : "read by "}${conflict ? [...f.writers].map((k) => f.ags.get(k)?.name).join(", ") : who}${conflict ? "  (conflict)" : ""}`)
        .child(div().w(10).flex_none().text_color(conflict ? C.red : f.wrote ? t.accent : t.dim).child(conflict ? "✕" : f.wrote ? "✎" : "·"))
        .child(h_flex().w(110).flex_none().gap(4).items_center().min_w(0)
          .children([...f.ags.values()].slice(0, 4).map((c) => div().size(6).flex_none().rounded_full().bg(c.color)))
          .child(div().min_w(0).truncate().text_color(first?.color ?? t.muted).child(f.ags.size > 1 ? `${f.ags.size} agents` : first?.name ?? "")))
        .child(div().flex_none().max_w(220).truncate().when(f.wrote, (e) => e.font_semibold()).text_color(conflict ? C.red : f.wrote ? t.foreground : t.muted).child(base(f.show)))
        .child(div().flex_1().min_w(0).truncate().text_color(conflict ? ah(C.red, 0.7) : t.dim).text_size(11).child(dirOf(f.show)))
        .child(div().w(64).flex_none().flex().justify_end().text_color(t.dim).child(fmtAgo(now - f.ts))));
    };
    const filesPanel = v_flex().id("am-files").size_full().rounded(10).border_1().border_color(t.border).bg(t.surface).overflow_hidden()
      .child(h_flex().h(28).flex_none().px(10).gap(8).items_center().text_size(12).border_b(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(t.muted).child("Files"))
        .child(div().text_size(11).text_color(t.dim).child(`last 10 min · ${flist.length}`)))
      .child(div().id("am-files-rows").flex_1().min_h(0).overflow_y_scroll()
        .child(flist.length ? div().relative().w_full().h(flist.length * 20 + 6).children(flist.map(fileRow)) : div().px(10).py(7).text_size(12).text_color(t.dim).child("No files touched")));

    // forget rows that are gone; a fresh row needs one more frame to start its fade-in
    for (const k of seen.keys()) if (!drawn.has(k)) seen.delete(k);
    this.painted = true;
    for (const k of this.fx.keys()) if (!this.fxSeen.has(k)) this.fx.delete(k);
    for (const k of this.fxMemo.keys()) if (!this.fxSeen.has(k)) this.fxMemo.delete(k);
    if (this.needFrame) { this.needFrame = false; this.fadeTask?.cancel(); this.fadeTask = cx.timer.after(16, (cx) => { this.fadeTask = null; if (this.shown()) cx.notify(); }); }
    this.keepFrames(now, cx);
    const root = v_flex().id("agent-map").size_full().min_h(0).gap(GAP).text_color(t.foreground).text_size(14)
      .track_focus(this.handle).on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); if (this.back()) cx.notify(); })
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); } })
      .when(notice, (e) => e.child(header));
    // the panels sit at their target rects; herdr's native transitions move them there, without a redraw per frame
    const place = (id, el, [x, y, w, h]) => div().id(id).absolute().left(x).top(y).w(w).h(h).overflow_hidden()
      .transition("left", MOVE).transition("top", MOVE).transition("width", MOVE).transition("height", MOVE).child(el);
    const bodyAllH = Math.max(bodyH, ...Object.values(R).map((r) => r[1] + r[3]));
    return root.child(div().relative().w(areaW).h(bodyAllH).flex_none()
      .child(place("am-p-maps", mapsArea, R.maps)).child(place("am-p-feed", feed, R.feed)).child(place("am-p-files", filesPanel, R.files)));
  }
}
