// CI watch: the LOCAL CI at a glance. No GitHub.
//
//   Ship queue  <Webapps>/.ship-queue: lock/holder (name, since, heartbeat, state) + queue/<epoch-ns>-<name>
//   ci-local    docker compose projects "cil-<sha7>-<job>" (running jobs) + ci-local-logs/<sha7>/<job>.result
//   Labels      git worktree list --porcelain: HEAD sha7 -> branch (refreshed at most every 30 s)
//
// Poll: every 3 s while anything is held/queued/running, else every 10 s. One poll at a time.
// Click the header = refresh now. Commands: `herdr-app do ci-watch.demo` (fake data), `ci-watch.live`.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { exec, theme, nextCommand, setShared, readTextFile } from "herdr";
import * as fs from "fs/promises";

const WEBAPPS = "C:/Users/me/Desktop/Webapps";
const QDIR = `${WEBAPPS}/.ship-queue`;
const LOGS = `${WEBAPPS}/ci-local-logs`;
const REPO = `${WEBAPPS}/my-webapps`;
const FAST_MS = 3000, IDLE_MS = 10000, BRANCH_MS = 30000;
const STALE_S = 60 * 60, TICKET_DEAD_S = 30 * 60, NOHOLDER_S = 120;
const OPTS = { timeout: 8000 };
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GREEN = "#3fb950", RED = "#f85149", YELLOW = "#d29922";
const PS_FORMAT = '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.CreatedAt}}';

const pad = (n) => String(n).padStart(2, "0");
const clock = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function dur(fromMs, now) {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}`;
}
const firstLine = (s) => String(s ?? "").trim().split("\n")[0].slice(0, 100);

// "2026-11-09 15:07:47 +0100 CET" -> ms
function parseCreated(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})/.exec(s.trim());
  if (!m) return NaN;
  return Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
}

function parseKV(text) {
  const o = {};
  for (const line of String(text ?? "").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return o;
}

// {path -> mtime ms} for existing files, via Git's stat.exe (usr/bin is NOT on herdr-app's PATH, so try the absolute path first).
// Missing stat => empty map (callers fall back).
const STATS = ["C:/Users/me/AppData/Local/Programs/Git/usr/bin/stat.exe", "C:/Program Files/Git/usr/bin/stat.exe", "stat"];
let statBin = null;
async function mtimes(paths) {
  const map = new Map();
  if (!paths.length) return map;
  try {
    let r = null;
    for (const bin of statBin ? [statBin] : STATS) {
      try { r = await exec(bin, ["-c", "%Y|%n", ...paths], OPTS); } catch { r = null; continue; }
      if (r && (r.stdout ?? "").includes("|")) { statBin = bin; break; }
    }
    if (!r) return map;
    for (const line of (r.stdout ?? "").split("\n")) {
      const i = line.indexOf("|");
      if (i > 0) map.set(line.slice(i + 1).trim().replace(/\\/g, "/"), Number(line.slice(0, i)) * 1000);
    }
  } catch { /* unknown mtimes: callers fall back */ }
  return map;
}

// Free / total RAM in bytes from Git's /proc/meminfo (msys; same number as Windows' free physical memory, ~40 ms).
const CATS = ["C:/Users/me/AppData/Local/Programs/Git/usr/bin/cat.exe", "C:/Program Files/Git/usr/bin/cat.exe", "cat"];
let catBin = null;
async function readRam() {
  for (const bin of catBin ? [catBin] : CATS) {
    let r; try { r = await exec(bin, ["/proc/meminfo"], OPTS); } catch { continue; }
    const kb = (k) => Number(new RegExp("^" + k + ":\\s+(\\d+)", "m").exec(r.stdout ?? "")?.[1]) * 1024;
    const total = kb("MemTotal"), free = kb("MemFree");
    if (total > 0 && free >= 0) { catBin = bin; return { total, free }; }
  }
  return null;
}

// ---- sources ---------------------------------------------------------------------------------

async function readQueue(nowMs) {
  let holder = null;
  let lockExists = true;
  try { await fs.readdir(`${QDIR}/lock`); } catch { lockExists = false; }
  if (lockExists) {
    const txt = await readTextFile(`${QDIR}/lock/holder`).catch(() => null);
    if (txt == null) holder = { name: "?", state: "", since: null, heartbeat: null };
    else {
      const kv = parseKV(txt);
      holder = {
        name: kv.name || "?", state: kv.state || "",
        since: Number(kv.since) * 1000 || null, heartbeat: Number(kv.heartbeat) * 1000 || null,
      };
    }
  }
  let names = [];
  try { names = await fs.readdir(`${QDIR}/queue`); } catch { /* none */ }
  names = names.filter((n) => /^\d+-./.test(n)).sort();
  const mt = await mtimes(names.map((n) => `${QDIR}/queue/${n}`));
  const tickets = names
    .filter((n) => { const m = mt.get(`${QDIR}/queue/${n}`); return m == null || nowMs - m <= TICKET_DEAD_S * 1000; })
    .map((n) => n.replace(/^\d+-/, ""));
  // Ship-ready branches (ship-ready.sh add): ready/wt__<name> with branch=/title=/sql= lines.
  let readyNames = [];
  try { readyNames = (await fs.readdir(`${QDIR}/ready`)).filter((n) => !n.startsWith(".")).sort(); } catch { /* none */ }
  const ready = await Promise.all(readyNames.map(async (n) => {
    const kv = parseKV(await readTextFile(`${QDIR}/ready/${n}`).catch(() => ""));
    return { branch: kv.branch || n.replace(/__/, "/"), title: kv.title || "", sql: kv.sql === "yes" };
  }));
  return { holder, tickets, ready };
}

// Running jobs per sha: {sha -> {start, running: Set(job)}}
// ci-local docker networks: one per job (compose project cil-<sha7>-<job>). Docker has ~30 default address pools;
// running out fails jobs with "all predefined address pools have been fully subnetted" (ci-local README.md:49).
async function readNetworks() {
  const r = await exec("docker", ["network", "ls", "--filter", "label=com.docker.compose.project", "--format", '{{.Label "com.docker.compose.project"}}'], OPTS);
  if (r.code !== 0) return null;
  const shas = [];
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = /^cil-([0-9a-f]{7})-/.exec(line.trim());
    if (m) shas.push(m[1]);
  }
  return shas;
}

async function readDocker() {
  const r = await exec("docker", ["ps", "--filter", "label=com.docker.compose.project", "--format", PS_FORMAT], OPTS);
  if (r.code !== 0) throw new Error(`docker: ${firstLine(r.stderr || r.stdout) || `exit ${r.code}`}`);
  const runs = new Map();
  for (const line of (r.stdout ?? "").split("\n")) {
    const [project, service, created] = line.trim().split("|");
    const m = /^cil-([0-9a-f]{7})-(.+)$/.exec(project ?? "");
    if (!m) continue;
    const run = runs.get(m[1]) ?? { sha: m[1], start: Infinity, running: new Set() };
    runs.set(m[1], run);
    const at = parseCreated(created ?? "");
    if (Number.isFinite(at) && at < run.start) run.start = at;
    if (service !== "db") run.running.add(m[2]);
  }
  return [...runs.values()].filter((r) => r.running.size > 0);
}

// Finished jobs of one run: results newer than the run start (older ones belong to a previous run).
async function readResults(run) {
  const dir = `${LOGS}/${run.sha}`;
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith(".result")); } catch { return { done: 0, failed: 0 }; }
  files = files.filter((f) => !run.running.has(f.slice(0, -7)));
  const mt = await mtimes(files.map((f) => `${dir}/${f}`));
  const known = mt.size > 0 && Number.isFinite(run.start);
  const fresh = files.filter((f) => !known || (mt.get(`${dir}/${f}`) ?? 0) >= run.start - 2000);
  let failed = 0;
  await Promise.all(fresh.map(async (f) => {
    const txt = await readTextFile(`${dir}/${f}`).catch(() => null);
    if (txt && /\sFAIL\s/.test(" " + txt.trim().split("\n")[0] + " ")) failed++;
  }));
  return { done: fresh.length, failed };
}

async function readBranches() {
  const r = await exec("git", ["-C", REPO, "worktree", "list", "--porcelain"], OPTS);
  if (r.code !== 0) throw new Error(firstLine(r.stderr));
  const map = {};
  for (const block of (r.stdout ?? "").split(/\n\s*\n/)) {
    const head = /^HEAD ([0-9a-f]{7})/m.exec(block)?.[1];
    const br = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    if (head && br) map[head] = br.trim();
  }
  return map;
}


const DEMO = () => {
  const now = Date.now();
  return {
    holder: { name: "ship-feature-a", state: "gate e29648d", since: now - 16 * 60000, heartbeat: now - 20000 },
    tickets: ["fix-logo", "ci-slim", "ship-feature-b", "ship-feature-c"],
    ready: [{ branch: "wt/ci-slim", title: "CI schlanker", sql: false }, { branch: "wt/fix-logo", title: "Logo + Datum", sql: true }],
    runs: [
      { sha: "caf3c63", label: "wt/ci-slim", start: now - 214000, running: ["php84-merged", "mariadb", "e2e-merged-1of3", "e2e-merged-2of3", "e2e-merged-3of3", "php84-legacy"], done: 8, failed: 1, ship: false },
      { sha: "e29648d", label: "main", start: now - 16 * 60000, running: ["e2e-legacy", "php85-merged"], done: 12, failed: 0, ship: true },
    ],
    err: null,
    ram: { total: 32 * 2 ** 30, free: 6.2 * 2 ** 30 },
    nets: { total: 30, orphans: 0 },
  };
};

export default class CiWatch extends View {
  init(_props, cx) {
    this.holder = null; this.tickets = []; this.ready = []; this.runs = []; this.err = null; this.ram = null; this.nets = null;
    this.branches = {}; this.branchesAt = 0; this.starts = new Map();
    this.busy = false; this.demo = false; this.hot = false;
    this.checkedAt = 0; this.nextAt = 0;
    this.poll(cx);
    cx.timer.every(1000, (cx) => { if (!this.demo && !this.busy && Date.now() >= this.nextAt) this.poll(cx); });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^ci-watch\./, "");
        if (c === "demo") { this.demo = true; Object.assign(this, DEMO()); this.checkedAt = Date.now(); }
        else if (c === "live") { this.demo = false; this.nextAt = 0; this.poll(cx); }
        else if (c === "refresh") { this.nextAt = 0; this.poll(cx); }
        cx.notify();
      }
    });
  }

  // `cx` must be live (a handler's own cx or an AsyncContext); it only starts the task.
  poll(cx) {
    if (this.busy || this.demo) return;
    this.busy = true;
    try {
      cx.spawn(async (cx) => {
        try { await this.fetchAll(); }
        catch (e) { this.err = firstLine(e?.message ?? e) || "error"; }
        finally {
          this.busy = false;
          this.checkedAt = Date.now();
          const active = this.holder || this.tickets.length || this.runs.length;
          this.nextAt = this.checkedAt + (active ? FAST_MS : IDLE_MS);
          cx.notify();
        }
      });
    } catch (e) { this.busy = false; throw e; }
  }

  async fetchAll() {
    const now = Date.now();
    const errs = [];
    // Queue and docker are independent: one failing must not hide the other.
    const netsP = readNetworks().catch(() => null);
    const [q, d] = await Promise.all([
      readQueue(now).catch((e) => { errs.push(`queue: ${firstLine(e?.message ?? e)}`); return null; }),
      readDocker().catch((e) => { errs.push(firstLine(e?.message ?? e)); return null; }),
    ]);
    this.ram = await readRam().catch(() => null) ?? this.ram;
    if (this.demo) return;   // demo was switched on while this poll ran: keep the fake data
    if (q) { this.holder = q.holder; this.tickets = q.tickets; this.ready = q.ready; }
    let raw = d ?? [];
    // Remember the earliest start per sha: containers of finished jobs disappear, which would move the start later.
    for (const r of raw) {
      const prev = this.starts.get(r.sha);
      if (prev != null && prev < r.start) r.start = prev;
      if (Number.isFinite(r.start)) this.starts.set(r.sha, r.start);
    }
    if (d) for (const k of [...this.starts.keys()]) if (!raw.some((r) => r.sha === k)) this.starts.delete(k);
    if (d && now - this.branchesAt >= BRANCH_MS) {
      this.branchesAt = now;   // set first: a failing git must not be retried every poll
      try { this.branches = await readBranches(); } catch { /* labels fall back to the sha */ }
    }
    const holderSha = /\b([0-9a-f]{7})\b/.exec(this.holder?.state ?? "")?.[1];
    const runs = await Promise.all(raw.map(async (r) => {
      const res = await readResults(r).catch(() => ({ done: 0, failed: 0 }));
      return {
        sha: r.sha, label: this.branches[r.sha] ?? r.sha, start: Number.isFinite(r.start) ? r.start : now,
        running: [...r.running].sort(), done: res.done, failed: res.failed, ship: r.sha === holderSha,
      };
    }));
    runs.sort((a, b) => a.start - b.start);
    if (this.demo) return;
    const nets = await netsP;
    this.nets = nets ? { total: nets.length, orphans: nets.filter((sha) => !runs.some((r) => r.sha === sha)).length } : null;
    this.runs = runs;   // docker failed => no runs (stale rows would keep pulsing forever)
    this.err = errs[0] ?? null;
  }

  // Three numbers only, styled like the sidebar cards (t.chrome card, 11.5px dim labels).
  render(cx) {
    const t = theme();
    const { holder, tickets, runs, ram } = this;
    // "Running" = ci-local runs in docker; a held ship lock without a run (merging, deploying) counts as one.
    const running = Math.max(runs.length, holder ? 1 : 0);
    const ready = this.ready ?? [];
    const nReady = ready.length;
    const pct = ram ? Math.round((ram.free / ram.total) * 100) : null;
    const ramColor = pct == null ? t.dim : pct < 15 ? RED : pct < 25 ? YELLOW : t.foreground;

    const runTip = [holder ? `ship: ${holder.name} · ${holder.state}` : "ship queue free",
      ...runs.map((r) => `${r.label}: ${r.running.length} jobs`)].join("\n");
    const short = (s) => (s.length > 70 ? s.slice(0, 69) + "…" : s);
    const readyTip = [nReady ? ready.map((r) => `${r.branch}${r.sql ? " [SQL]" : ""}${r.title ? ` — ${short(r.title)}` : ""}`).join("\n") : "nothing ready to ship",
      ...(tickets.length ? [`waiting for ship lock: ${tickets.join(", ")}`] : [])].join("\n");
    const ramTip = (ram ? `${(ram.free / 2 ** 30).toFixed(1)} GB free of ${Math.round(ram.total / 2 ** 30)} GB` : "RAM unknown")
      + (this.err ? `\n${this.err}` : "");

    const stat = (id, value, label, color, tip) => v_flex().id(id).flex_1().min_w(0).items_center().justify_center().gap(1).tooltip(tip)
      .child(div().text_size(16).font_medium().text_color(color).child(String(value)))
      .child(div().text_size(11.5).text_color(t.dim).child(label));
    const sep = () => div().w(1).h(24).flex_none().bg(t.border);

    return h_flex().id("ci").size_full().min_h(0).items_center().px(8).rounded(10).overflow_hidden().bg(t.chrome)
      .border_1().border_color(this.hot ? t.accent : t.border)
      .on_hover((h, cx) => { this.hot = h; setShared("ring.ci", h); cx.notify(); })
      .cursor_pointer().on_click((_e, cx) => { this.nextAt = 0; this.poll(cx); cx.notify(); })
      .child(stat("ci-run", running, "running", running ? t.foreground : t.dim, runTip))
      .child(sep())
      .child(stat("ci-ready", nReady, "ready to ship", nReady ? t.foreground : t.dim, readyTip))
      .child(sep())
      .child(stat("ci-ram", pct == null ? "–" : `${pct}%`, "RAM free", ramColor, ramTip));
  }
}
