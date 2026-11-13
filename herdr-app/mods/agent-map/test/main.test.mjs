// Tests for main.js without the app: `cd <mod folder> && node --test test/main.test.mjs` (no install).
// The "herdr", "gpui-kit" and "gpui-base" imports are replaced by test/stubs/* through the module hooks in test/loader.mjs.
import { register } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

register("./loader.mjs", import.meta.url);
const herdr = await import("./stubs/herdr.mjs");
const M = await import("../main.js");
const { apply, settle, freshState, ingestText, colorSlots, collectFiles, linkCards, boardAgents, boardCards, openAsks, askText, STATIONS, DEMO, legPoints, place, routeOf, W, H } = M;
const AgentMap = M.default;

const T0 = 1_700_000_000_000;
const line = (o) => JSON.stringify({ sid: "s1", ...o });
const text = (...os) => os.map(line).join("\n") + "\n";
const st = () => freshState();
const feed = (s, t) => ingestText(s, t);
const stationOf = (s, id) => s.entries.filter((e) => e.station === id);

test("default export is still the View class, named exports exist", () => {
  assert.equal(typeof AgentMap, "function");
  assert.equal(typeof AgentMap.prototype.render, "function");
});

test("half-written line waits, then completes", () => {
  const s = st();
  const a = line({ ts: T0, ev: "pre", id: "a", tool: "Read", station: "files", label: "x" });
  const b = line({ ts: T0 + 10, ev: "post", id: "a", tool: "Read", station: "files", label: "x" });
  assert.equal(feed(s, a + "\n" + b.slice(0, 20)), true);
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].status, "run");
  assert.equal(feed(s, a + "\n" + b + "\n"), true);
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].status, "ok");
  assert.equal(s.cnt.s1.files, 1);
});

test("a last line without newline counts once it parses", () => {
  const s = st();
  feed(s, line({ ts: T0, ev: "pre", id: "a", tool: "Read", station: "files", label: "x" }));
  assert.equal(s.entries.length, 1);
  feed(s, line({ ts: T0, ev: "pre", id: "a", tool: "Read", station: "files", label: "x" }) + "\n");
  assert.equal(s.entries.length, 1);
});

test("fail counts per station until the next prompt", () => {
  const s = st();
  feed(s, text(
    { ts: T0, ev: "pre", id: "a", tool: "WebFetch", station: "network", label: "x" },
    { ts: T0 + 1, ev: "fail", id: "a", tool: "WebFetch", station: "network", label: "x" },
    { ts: T0 + 2, ev: "pre", id: "b", tool: "Bash", station: "build", label: "npm test" },
    { ts: T0 + 3, ev: "fail", id: "b", tool: "Bash", station: "build", label: "npm test" },
    { ts: T0 + 4, ev: "post", id: "c", tool: "Bash", station: "git", label: "git status" }));
  assert.deepEqual(s.flt.s1, { network: 1, build: 1 });
  assert.equal(s.entries[0].status, "err");
  feed(s, text({ ts: T0, ev: "pre", id: "a", tool: "WebFetch", station: "network", label: "x" }, { ts: T0 + 1, ev: "fail", id: "a" }, { ts: T0 + 2, ev: "pre", id: "b", tool: "Bash", station: "build", label: "npm test" },
    { ts: T0 + 3, ev: "fail", id: "b", tool: "Bash", station: "build", label: "npm test" }, { ts: T0 + 4, ev: "post", id: "c", tool: "Bash", station: "git", label: "git status" }, { ts: T0 + 5, ev: "prompt" }));
  assert.deepEqual(s.flt.s1, {});
});

test("background call stays lit until stop + 10 min; foreground ones close at stop", () => {
  const s = st();
  feed(s, text(
    { ts: T0, ev: "pre", id: "bg", tool: "Bash", station: "shell", label: "dev server", bg: true },
    { ts: T0 + 1, ev: "pre", id: "fg", tool: "Bash", station: "shell", label: "sleep" },
    { ts: T0 + 5000, ev: "stop" }));
  const [bg, fg] = stationOf(s, "shell");
  assert.equal(fg.status, "ok");
  assert.equal(bg.status, "run");
  settle(s, T0 + 5000 + 5 * 60000);
  assert.equal(bg.status, "run");
  settle(s, T0 + 5000 + 11 * 60000);
  assert.equal(bg.status, "ok");
});

test("subagents: sub_start label, implicit subs, subid label from the Agent post, label from sub_stop", () => {
  const s = st();
  feed(s, text(
    { ts: T0, ev: "sub_start", sub: "a1", label: "explore auth" },
    { ts: T0 + 1, ev: "pre", id: "x1", sub: "a1", tool: "Read", station: "files", label: "f" },
    // a2 and a3 never had a sub_start
    { ts: T0 + 2, ev: "pre", id: "x2", sub: "a2", tool: "Read", station: "files", label: "g" },
    { ts: T0 + 3, ev: "pre", id: "x3", sub: "a3", tool: "Read", station: "files", label: "h" }));
  assert.equal(s.subs.get("a1").label, "explore auth");
  assert.equal(s.subs.get("a2").label, "");
  assert.equal(s.subs.size, 3);
  feed(s, text(
    { ts: T0, ev: "sub_start", sub: "a1", label: "explore auth" },
    { ts: T0 + 1, ev: "pre", id: "x1", sub: "a1", tool: "Read", station: "files", label: "f" },
    { ts: T0 + 2, ev: "pre", id: "x2", sub: "a2", tool: "Read", station: "files", label: "g" },
    { ts: T0 + 3, ev: "pre", id: "x3", sub: "a3", tool: "Read", station: "files", label: "h" },
    { ts: T0 + 4, ev: "post", id: "ag", tool: "Agent", station: "agents", label: "review the diff", subid: "a2" },
    { ts: T0 + 5, ev: "sub_stop", sub: "a3", label: "Explore" }));
  assert.equal(s.subs.get("a2").label, "review the diff");
  assert.equal(s.subNames.get("a3"), "Explore");
  assert.equal(s.subs.has("a3"), false, "stopped sub is gone");
  // the post line before the sub's first call: the label is there when the sub shows up
  const s2 = st();
  apply(s2, { ts: T0, sid: "s1", ev: "post", id: "ag", tool: "Task", station: "agents", label: "write docs", subid: "z9" });
  apply(s2, { ts: T0 + 1, sid: "s1", ev: "pre", id: "q", sub: "z9", tool: "Read", station: "files", label: "f" });
  assert.equal(s2.subs.get("z9").label, "write docs");
  // a subid on a non-Agent tool is ignored
  const s3 = st();
  apply(s3, { ts: T0, sid: "s1", ev: "post", id: "ag", tool: "Read", station: "files", label: "nope", subid: "z9" });
  assert.equal(s3.subNames.size, 0);
});

test("garbage and unknown stations are ignored", () => {
  const s = st();
  const ok = feed(s, "not json\n{\"ts\":\"x\"}\n[]\n" + text(
    { ts: T0, ev: "pre", id: "a", tool: "Weird", station: "warp", label: "x" },
    { ts: T0 + 1, ev: "post", id: "a", tool: "Weird", station: "warp", label: "x" },
    { ts: T0 + 2, ev: "pre", id: "b", tool: "Read", station: "files", label: "x" }));
  assert.equal(ok, true);
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].station, "files");
});

test("new stations git and build are known; ten stations lay out", () => {
  const ids = STATIONS.map((x) => x.id);
  assert.ok(ids.includes("git") && ids.includes("build"));
  assert.equal(STATIONS.find((x) => x.id === "git").name, "Git");
  assert.equal(ids.length, 10);
  const s = st();
  feed(s, text({ ts: T0, ev: "pre", id: "a", tool: "Bash", station: "git", label: "git status" }, { ts: T0 + 1, ev: "post", id: "b", tool: "Bash", station: "build", label: "npm test" }));
  assert.equal(s.cnt.s1.git, 1);
  assert.equal(s.cnt.s1.build, 1);
  // every pair of stations gives a finite leg inside the map
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) if (i !== j) {
    for (const p of legPoints(i, j).pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0 && p.x < W && p.y > 0 && p.y < H, `leg ${ids[i]}->${ids[j]}`);
  }
  // neighbours on the ring do not touch (node radius 22)
  for (let i = 0; i < ids.length; i++) {
    const a = place(i), b = place((i + 1) % ids.length);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2 * 22 + 20, `spacing ${ids[i]}`);
  }
  assert.equal(routeOf(s.entries).length, 2);
});

test("trim: state is kept and reading resumes after the last applied line (no counter drop)", () => {
  const s = st();
  const all = [];
  for (let i = 0; i < 30; i++) {
    all.push({ ts: T0 + i * 10, ev: "pre", id: `p${i}`, tool: "Read", station: "files", label: `f${i}`, file: `c:/f${i}` });
    all.push({ ts: T0 + i * 10 + 5, ev: i % 7 === 0 ? "fail" : "post", id: `p${i}`, tool: "Read", station: "files", label: `f${i}` });
  }
  feed(s, text(...all));
  const before = { files: s.cnt.s1.files, fl: s.flt.s1.files, n: s.entries.length };
  assert.equal(before.files, 30);
  assert.ok(before.fl >= 4);
  // the hook trims to the last 20 lines and writes two new ones
  const more = [{ ts: T0 + 1000, ev: "pre", id: "n1", tool: "Bash", station: "git", label: "git log" }, { ts: T0 + 1001, ev: "post", id: "n1", tool: "Bash", station: "git", label: "git log" }];
  const trimmed = text(...all.slice(-20), ...more);
  assert.equal(feed(s, trimmed), true);
  assert.equal(s.cnt.s1.files, 30, "station counts kept");
  assert.equal(s.flt.s1.files, before.fl, "fault badges kept");
  assert.equal(s.cnt.s1.git, 1);
  assert.equal(s.entries.length, before.n + 1);
  // the same text again: nothing more
  assert.equal(feed(s, trimmed), false);
  // trim without the last applied line in the new text: only newer ts are applied
  const s2 = st();
  feed(s2, text(...all));
  const cut = all.slice(-20).map((o, i) => (i === 19 ? { ...o, label: "rewritten" } : o));
  feed(s2, text(...cut, ...more));
  assert.equal(s2.cnt.s1.files, 30);
  assert.equal(s2.cnt.s1.git, 1);
});

test("trim resume also works when the file grows past the old size", () => {
  const s = st();
  const all = Array.from({ length: 12 }, (_, i) => ({ ts: T0 + i, ev: "pre", id: `p${i}`, tool: "Read", station: "files", label: `f${i}` }));
  feed(s, text(...all));
  const extra = Array.from({ length: 20 }, (_, i) => ({ ts: T0 + 100 + i, ev: "pre", id: `q${i}`, tool: "Read", station: "files", label: `g${i}` }));
  feed(s, text(...all.slice(6), ...extra));   // start changed, longer than before
  assert.equal(s.cnt.s1.files, 32);
});

test("a real new file (last line older than the last applied) starts over", () => {
  const s = st();
  feed(s, text({ ts: T0 + 500, ev: "pre", id: "a", tool: "Read", station: "files", label: "old" }, { ts: T0 + 600, ev: "post", id: "a", tool: "Read", station: "files", label: "old" }, { ts: T0 + 700, ev: "pre", id: "b", tool: "Bash", station: "shell", label: "old2" }));
  assert.equal(s.cnt.s1.files, 1);
  feed(s, text({ ts: T0 + 10, ev: "pre", id: "z", tool: "Grep", station: "files", label: "new" }));
  assert.equal(s.cnt.s1.files, 1);
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].label, "new");
  assert.equal(s.cnt.s1.shell, undefined);
});

test("cutoff drops older events and survives a reset", () => {
  const s = Object.assign(st(), { cutoff: T0 + 100 });
  feed(s, text({ ts: T0 + 50, ev: "pre", id: "a", tool: "Read", station: "files", label: "old" }, { ts: T0 + 150, ev: "pre", id: "b", tool: "Read", station: "files", label: "new" }));
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].label, "new");
  feed(s, text({ ts: T0 + 20, ev: "pre", id: "c", tool: "Read", station: "files", label: "other file" }));
  assert.equal(s.cutoff, T0 + 100);
  assert.equal(s.entries.length, 0);
});

test("ask: open until the same id starts/ends, or prompt/stop; shown in the feed", () => {
  const s = st();
  feed(s, text({ ts: T0, ev: "ask", id: "k1", tool: "Bash", station: "network", label: "git push", path: "C:/x" }));
  assert.equal(openAsks(s).length, 1);
  assert.equal(askText(openAsks(s)[0]), "needs you · Bash: git push");
  assert.equal(openAsks(s)[0].station, "network");
  const row = s.entries.find((e) => e.mark === "ask");
  assert.ok(row, "feed row");
  assert.equal(row.label, "needs you · Bash: git push");
  assert.equal(s.cnt.s1?.network, undefined, "an ask is not a call");
  assert.equal(routeOf(s.entries).length, 0, "and no route stop");
  // another id does not clear it
  feed(s, text({ ts: T0, ev: "ask", id: "k1", tool: "Bash", station: "network", label: "git push", path: "C:/x" }, { ts: T0 + 1, ev: "pre", id: "other", tool: "Read", station: "files", label: "f" }));
  assert.equal(openAsks(s).length, 1);
  feed(s, text({ ts: T0, ev: "ask", id: "k1", tool: "Bash", station: "network", label: "git push", path: "C:/x" }, { ts: T0 + 1, ev: "pre", id: "other", tool: "Read", station: "files", label: "f" }, { ts: T0 + 2, ev: "pre", id: "k1", tool: "Bash", station: "network", label: "git push" }));
  assert.equal(openAsks(s).length, 0);
  for (const end of ["stop", "prompt"]) {
    const s2 = st();
    apply(s2, { ts: T0, sid: "s1", ev: "ask", id: "", tool: "Edit", station: "files", label: "f.ts" });
    assert.equal(openAsks(s2).length, 1);
    apply(s2, { ts: T0 + 1, sid: "s1", ev: end });
    assert.equal(openAsks(s2).length, 0, end);
  }
  for (const end of ["post", "fail"]) {
    const s3 = st();
    apply(s3, { ts: T0, sid: "s1", ev: "ask", id: "q", tool: "Bash", station: "shell", label: "rm" });
    apply(s3, { ts: T0 + 1, sid: "s1", ev: end, id: "q", tool: "Bash", station: "shell", label: "rm" });
    assert.equal(openAsks(s3).length, 0, end);
  }
  // an ask without id: repeated ones don't pile up; the next post of the same tool in the same thread answers it
  const s5 = st();
  apply(s5, { ts: T0, sid: "s1", ev: "pre", id: "b1", tool: "Bash", station: "shell", label: "rm" });
  apply(s5, { ts: T0 + 1, sid: "s1", ev: "ask", id: "", tool: "Bash", station: "shell", label: "rm" });
  apply(s5, { ts: T0 + 2, sid: "s1", ev: "ask", id: "", tool: "Bash", station: "shell", label: "rm" });
  assert.equal(openAsks(s5).length, 1, "no pile-up of id-less asks");
  apply(s5, { ts: T0 + 3, sid: "s1", ev: "post", id: "r1", tool: "Read", station: "files", label: "f" });
  assert.equal(openAsks(s5).length, 1, "another tool does not answer it");
  apply(s5, { ts: T0 + 4, sid: "s1", ev: "post", id: "b1", tool: "Bash", station: "shell", label: "rm" });
  assert.equal(openAsks(s5).length, 0, "post of the same tool answers it");
  // an ask for an unknown station keeps its text but highlights nothing
  const s4 = st();
  apply(s4, { ts: T0, sid: "s1", ev: "ask", id: "u", tool: "Mystery", station: "warp", label: "" });
  assert.equal(openAsks(s4)[0].station, "");
  assert.equal(askText(openAsks(s4)[0]), "needs you · Mystery");
});

test("colour slots come from the address and stay put when agents come and go", () => {
  const n = 8;
  const addrs = ["t1", "t2", "t3", "t4", "t5"];
  const alone = addrs.map((a) => colorSlots([a], n).get(a));
  // deterministic: the same address alone always gets the same slot
  assert.deepEqual(alone, addrs.map((a) => colorSlots([a], n).get(a)));
  // no two live agents share a slot while there are enough slots
  const sticky = colorSlots(addrs, n);
  assert.equal(new Set(addrs.map((a) => sticky.get(a))).size, addrs.length);
  const keep = Object.fromEntries(addrs.map((a) => [a, sticky.get(a)]));
  // one leaves, a new one arrives: the others keep their colour
  const next = colorSlots(["t1", "t3", "t4", "t5", "t9"], n, sticky);
  for (const a of ["t1", "t3", "t4", "t5"]) assert.equal(next.get(a), keep[a], a);
  // the order of the list does not matter
  const rev = colorSlots([...addrs].reverse(), n);
  for (const a of addrs) assert.equal(rev.get(a), colorSlots([...addrs], n).get(a));
  // more agents than slots: every slot is used before any is shared
  const many = Array.from({ length: 11 }, (_, i) => `term-${i}`);
  const m = colorSlots(many, n);
  assert.equal(new Set(many.map((a) => m.get(a))).size, n);
  assert.ok(many.every((a) => m.get(a) >= 0 && m.get(a) < n));
  // exactly as many agents as slots: all different
  const full = colorSlots(many.slice(0, n), n);
  assert.equal(new Set(many.slice(0, n).map((a) => full.get(a))).size, n);
});

test("files: grouped by the lowercase key, shown as path ?? file", () => {
  const s = st();
  feed(s, text(
    { ts: T0, ev: "pre", id: "a", tool: "Read", station: "files", label: "Routes.ts", file: "c:/proj/src/routes.ts", path: "C:/Proj/src/Routes.ts" },
    { ts: T0 + 1, ev: "post", id: "a", tool: "Read", station: "files", label: "Routes.ts", file: "c:/proj/src/routes.ts", path: "C:/Proj/src/Routes.ts" },
    { ts: T0 + 2, ev: "pre", id: "b", tool: "Read", station: "files", label: "old.ts", file: "c:/proj/old.ts" }));   // a v1 line: no path
  const list = collectFiles([{ key: "k", name: "A", st: s }], T0 + 5);
  assert.equal(list.length, 2);
  const f = list.find((x) => x.path === "c:/proj/src/routes.ts");
  assert.equal(f.show, "C:/Proj/src/Routes.ts");
  assert.equal(list.find((x) => x.path === "c:/proj/old.ts").show, "c:/proj/old.ts");
  // another agent reads the same file in a different case spelling: one row
  const s2 = st();
  feed(s2, text({ ts: T0 + 3, ev: "pre", id: "c", tool: "Read", station: "files", label: "x", file: "c:/proj/src/routes.ts", path: "C:/proj/src/ROUTES.ts" }));
  const both = collectFiles([{ key: "k", name: "A", st: s }, { key: "k2", name: "B", st: s2 }], T0 + 5);
  assert.equal(both.length, 2);
  assert.equal(both.find((x) => x.path === "c:/proj/src/routes.ts").ags.size, 2);
  assert.equal(both.find((x) => x.path === "c:/proj/src/routes.ts").show, "C:/proj/src/ROUTES.ts");
});

test("conflict: a shell call that writes a file counts (any station)", () => {
  const a = st(), b = st();
  feed(a, text({ ts: T0, ev: "pre", id: "a", tool: "Bash", station: "shell", label: "python gen.py > out.txt", file: "c:/p/out.txt", path: "C:/p/out.txt", write: true }));
  feed(b, text({ ts: T0 + 5, ev: "pre", id: "b", tool: "Edit", station: "files", label: "out.txt", file: "c:/p/out.txt", path: "C:/p/out.txt", write: true }));
  const list = collectFiles([{ key: "A", name: "A", st: a }, { key: "B", name: "B", st: b }], T0 + 10);
  assert.equal(list.length, 1);
  assert.equal(list[0].writers.size, 2);
  // a build call writing the same file as a git call
  const c = st(), d = st();
  feed(c, text({ ts: T0, ev: "pre", id: "c", tool: "Bash", station: "build", label: "tsc", file: "c:/p/dist.js", write: true }));
  feed(d, text({ ts: T0, ev: "pre", id: "d", tool: "Bash", station: "git", label: "git checkout", file: "c:/p/dist.js", write: true }));
  assert.equal(collectFiles([{ key: "C", st: c }, { key: "D", st: d }], T0 + 1)[0].writers.size, 2);
  // a post line that carries the file when the pre line did not
  const e = st();
  feed(e, text({ ts: T0, ev: "pre", id: "e", tool: "Bash", station: "shell", label: "x" }, { ts: T0 + 1, ev: "post", id: "e", tool: "Bash", station: "shell", label: "x", file: "c:/p/q.txt", write: true }));
  assert.equal(collectFiles([{ key: "E", st: e }], T0 + 2)[0].wrote, true);
});

test("session line gives cwd and model; context figure", () => {
  const s = st();
  feed(s, text({ ts: T0, ev: "session", cwd: "C:/Users/me/proj/api", model: "claude-opus-4" }, { ts: T0 + 1, ev: "prompt", ctx: 148000, ctxMax: 400000 }));
  assert.equal(s.cwd, "C:/Users/me/proj/api");
  assert.equal(s.model, "claude-opus-4");
  assert.equal(M.lastParts(s.cwd), "proj/api");
  assert.equal(M.lastParts("C:\\Users\\me\\x\\"), "me/x");
  assert.equal(M.ctxTip(s), "context 148k / 400k (37%)");
  assert.deepEqual(M.infoLine(s, true), ["proj/api", "opus-4"]);
});

test("agent links: children follow their parent, nothing changes without a parent", () => {
  const mk = (key, address) => ({ key, address, name: key, st: st() });
  const cards = [mk("a", "t1"), mk("b", "t2"), mk("c", "t3"), mk("d", "t4")];
  const none = linkCards(cards.map((c) => ({ ...c })), () => undefined);
  assert.deepEqual(none.map((c) => c.key), ["a", "b", "c", "d"]);
  assert.ok(none.every((c) => !c.parent && c.kids === 0));
  const parents = { t3: "t1", t4: "t1" };
  const out = linkCards(cards, (a) => parents[a]);
  assert.deepEqual(out.map((c) => c.key), ["a", "c", "d", "b"]);
  assert.equal(out[0].kids, 2);
  assert.equal(out[1].parent, "a");
  // a parent that is not on the board is no link; a loop does not drop cards
  const o2 = linkCards([mk("a", "t1"), mk("b", "t2")], (a) => (a === "t1" ? "t9" : undefined));
  assert.deepEqual(o2.map((c) => c.key), ["a", "b"]);
  assert.equal(o2[0].parent, null);
  const loop = linkCards([mk("a", "t1"), mk("b", "t2")], (a) => (a === "t1" ? "t2" : "t1"));
  assert.equal(loop.length, 2);
});

test("pane-less sub-agents from terminals() join the board at any depth", () => {
  const live = [{ address: "t1", status: "working", space_name: "Webapps", space: "s1", tab: "tab1", title: "main" }];
  const terms = [
    { address: "t1", state: "live", status: "working" },
    { address: "t2", state: "live", status: "working", parent: "t1", name: "orch-x" },
    { address: "t3", state: "live", status: "done", parent: "t2", name: "impl-x" },
    { address: "t4", state: "finished", status: "idle", parent: "t2", name: "gone" },
    { address: "t5", state: "live", status: "error", parent: "t9", name: "stranger" },
  ];
  const out = boardAgents(live, terms);
  assert.deepEqual(out.map((a) => a.address), ["t1", "t2", "t3"]);
  assert.equal(out[1].title, "orch-x");
  assert.equal(out[2].status, "idle");
  assert.equal(out[2].space_name, "Webapps");
  const linked = linkCards(out.map((a) => ({ key: a.address, address: a.address, st: st() })), (a) => terms.find((x) => x.address === a)?.parent);
  assert.deepEqual(linked.map((c) => [c.key, c.parent]), [["t1", null], ["t2", "t1"], ["t3", "t2"]]);
  // a kept sub-agent (has a pane) is already in agents(): not doubled
  assert.equal(boardAgents([...live, { address: "t2", status: "working" }], terms).filter((a) => a.address === "t2").length, 1);
});

test("board: only main sessions with their sub-agent count; a family = a session + its direct sub-agents", () => {
  const mk = (key, parent) => ({ key, parent: parent ?? null });
  const cards = [mk("a"), mk("b", "a"), mk("c", "b"), mk("d"), mk("e", "a")];
  const top = boardCards(cards, null);
  assert.deepEqual(top.map((c) => [c.key, c.subs]), [["a", 3], ["d", 0]]);
  // one level at a time: a's direct sub-agents only; b keeps c one level deeper (b.subs = 1)
  assert.deepEqual(boardCards(cards, "a").map((c) => [c.key, c.subs]), [["a", 0], ["b", 1], ["e", 0]]);
  assert.deepEqual(boardCards(cards, "b").map((c) => c.key), ["b", "c"]);
  assert.deepEqual(boardCards(cards, "zz"), []);
});

test("left click goes in, right click (back) goes one level out, nothing at the top", () => {
  const inst = Object.create(AgentMap.prototype);
  inst.zoom = null; inst.family = null; inst.path = []; inst.handle = { focus() { } };
  const main = { key: "a", subs: 2 }, orch = { key: "o", subs: 1 }, kid = { key: "b", subs: 0 };
  inst.clickCard(main, { click_count: 1 });
  assert.equal(inst.family, "a"); assert.equal(inst.zoom, null);
  inst.clickCard(orch, { click_count: 1 });           // a nested orchestrator: one level deeper
  assert.equal(inst.family, "o"); assert.deepEqual(inst.path, ["a"]);
  inst.clickCard({ key: "o", subs: 0 }, { click_count: 1 });   // the head of the level: enlarge it
  assert.equal(inst.zoom.key, "o");
  assert.equal(inst.back(), true); inst.zoom = null;
  assert.equal(inst.back(), true); assert.equal(inst.family, "a"); assert.deepEqual(inst.path, []);
  inst.clickCard(kid, { click_count: 1 });
  assert.equal(inst.zoom.key, "b");
  inst.clickCard(kid, { click_count: 1 });            // left click on the enlarged map stays
  assert.equal(inst.zoom.out, false);
  assert.equal(inst.back(), true); assert.equal(inst.zoom.out, true);
  assert.equal(inst.back(), true); assert.equal(inst.family, null);
  assert.equal(inst.back(), false);
});

test("Esc: unzooms an enlarged map, else closes the board", () => {
  herdr.calls.length = 0;
  const inst = Object.create(AgentMap.prototype);
  const cx = { stop_propagation() { cx.stopped = true; }, notify() { cx.notified = true; } };
  inst.zoom = { key: "k", at: 0, out: false };
  assert.equal(inst.onKey({ key: "escape" }, cx), true);
  assert.equal(inst.zoom.out, true);
  assert.equal(herdr.calls.length, 0, "zoomed: only unzoom");
  inst.zoom = null;
  assert.equal(inst.onKey({ key: "escape" }, cx), true);
  assert.deepEqual(herdr.calls, [["layout.select", { stack: "work-stack", child: "work-body" }]]);
  herdr.calls.length = 0;
  assert.equal(inst.onKey({ key: "a" }, cx), false);
  assert.equal(herdr.calls.length, 0);
});

test("poll state: scan reads a live agent's file by its sanitized address", async () => {
  const inst = Object.create(AgentMap.prototype);
  inst.files = new Map(); inst.cutoff = 0;
  herdr.state.agents = [{ address: "m/t7" }];
  herdr.state.files["C:/fake-home/data/agent-map/m_t7.jsonl"] = text({ ts: T0, ev: "pre", id: "a", tool: "Read", station: "files", label: "x" });
  assert.equal(await inst.scan(["m_t7"]), true);
  assert.equal(inst.files.get("m_t7").entries.length, 1);
});

test("the demo replays: git, build, ask, subagent names, conflict", () => {
  const sts = [st(), st()];
  const t0 = T0;
  let askSeen = false;
  for (const [t, ag, o] of DEMO.events) {
    if (o.ev === "_status") continue;
    apply(sts[ag], { ...o, ts: t0 + t, sid: `demo-${ag}` });
    if (openAsks(sts[ag]).length) askSeen = true;
  }
  assert.ok(sts[0].cnt["demo-0"].git >= 2 && sts[0].cnt["demo-0"].build >= 1);
  assert.ok(sts[1].cnt["demo-1"].git >= 1);
  assert.ok(askSeen);
  assert.equal(openAsks(sts[1]).length, 0, "the ask is answered by its pre line");
  const files = collectFiles(sts.map((s, i) => ({ key: `d${i}`, name: `d${i}`, st: s })), t0 + 30000);
  assert.ok(files.some((f) => f.writers.size >= 2));
});

// ---- native motion helpers -------------------------------------------------------------------------------------------
const bare = () => Object.assign(Object.create(AgentMap.prototype), { fx: new Map(), fxMemo: new Map(), fxSeen: new Set(), wakeMin: Infinity, clockSeen: false, zoom: null, needFrame: false });

test("tweenPlan: start value at now, delay until s, time left until e (planned one frame ahead)", () => {
  const { v0, pol } = M.tweenPlan({ left: { from: 0, to: 100, s: 1000, e: 1800 }, opacity: { from: 1, to: 0, s: 1656, e: 1800 } }, 1200);
  assert.equal(v0.left, 25);                       // 200 ms of 800 in
  assert.equal(v0.opacity, 1);                     // the fade has not started
  assert.deepEqual(pol.left, { duration: 584, delay: 0, easing: "linear" });   // 1800 - (1200 + 16)
  assert.deepEqual(pol.opacity, { duration: 144, delay: 440, easing: "linear" });
  const steady = M.tweenPlan({ opacity: { from: 0.16, to: 0.16, s: 0, e: 0 } }, 5000);
  assert.equal(steady.v0.opacity, 0.16);
  assert.equal(steady.pol.opacity.duration, 16);
});

test("tween: first draw shows the start and asks for a frame, later draws show the end with the same policy", () => {
  const m = bare(), props = { left: { from: 0, to: 80, s: 1000, e: 1800 } };
  const a = m.tween("p1", "x", props, 1000);
  assert.equal(a.v.left, 0); assert.equal(m.needFrame, true);
  m.needFrame = false;
  const b = m.tween("p1", "x", props, 1020);
  assert.equal(b.v.left, 80); assert.equal(m.needFrame, false);
  assert.equal(b.pol, a.pol, "the policy is kept, so the native transition is not restarted");
  const c = m.tween("p1", "x", props, 1400);
  assert.equal(c.pol, a.pol); assert.equal(c.pol.left.duration, 784);
  const d = m.tween("p1", "y", { left: { from: 80, to: 0, s: 1500, e: 1700 } }, 1500);   // a new target re-plans at once, no extra frame
  assert.equal(d.v.left, 0); assert.notEqual(d.pol, a.pol); assert.equal(m.needFrame, false);
});

test("memo keeps a value for the life of its element; soon keeps the earliest future boundary", () => {
  const m = bare();
  assert.equal(m.memo("ln-a", () => 5), 5);
  assert.equal(m.memo("ln-a", () => 9), 5);
  m.soon(900, 1000); assert.equal(m.wakeMin, Infinity);      // past: ignored
  m.soon(3000, 1000); m.soon(2000, 1000); m.soon(2500, 1000);
  assert.equal(m.wakeMin, 2000);
});

test("motion: script timers only for a running zoom and for clock hands; the rest is native", () => {
  const m = bare();
  assert.deepEqual(m.motion(1000), { mode: "none", wake: null });
  m.wakeMin = 5000; assert.deepEqual(m.motion(1000), { mode: "none", wake: 5000 });
  m.clockSeen = true; assert.equal(m.motion(1000).mode, "clock");
  m.zoom = { key: "a", at: 1000, out: false };
  assert.equal(m.motion(1100).mode, "zoom");
  assert.equal(m.motion(1000 + 340 + 60).mode, "clock");
});

test("orbit-N.svg: N dots on a circle of radius 28 in a 68 box, filled with currentColor", async () => {
  const fs = await import("node:fs");
  for (let n = 1; n <= 6; n++) {
    const svg = fs.readFileSync(new URL(`../orbit-${n}.svg`, import.meta.url), "utf8");
    const dots = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3"\/>/g)];
    assert.equal(dots.length, n);
    assert.ok(svg.includes('viewBox="0 0 68 68"') && svg.includes('fill="currentColor"'));
    for (const [, x, y] of dots) assert.ok(Math.abs(Math.hypot(x - 34, y - 34) - 28) < 0.05);
  }
});
