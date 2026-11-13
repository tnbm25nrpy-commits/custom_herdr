// Merges claude-settings.herdr.json into ~/.claude/settings.json without removing anything.
// usage: node merge-claude-settings.mjs <fragment.json> <settings.json> <home dir>
import fs from "node:fs";

const [fragPath, settingsPath, home] = process.argv.slice(2);
if (!fragPath || !settingsPath || !home) {
  console.error("usage: node merge-claude-settings.mjs <fragment.json> <settings.json> <home>");
  process.exit(2);
}
const homeWin = home.replace(/\//g, "\\");
const homeFwd = home.replace(/\\/g, "/");
const fill = (v) =>
  typeof v === "string" ? v.replaceAll("{HOME_WIN}", homeWin).replaceAll("{HOME}", homeFwd)
  : Array.isArray(v) ? v.map(fill)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
  : v;

const frag = fill(JSON.parse(fs.readFileSync(fragPath, "utf8")));
delete frag._comment;

let settings = {};
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, "utf8").replace(/^﻿/, "");
  settings = raw.trim() ? JSON.parse(raw) : {};
}

const added = [];
settings.env ??= {};
for (const [k, v] of Object.entries(frag.env ?? {})) {
  if (!(k in settings.env)) { settings.env[k] = v; added.push(`env.${k}`); }
}

const sig = (h) => JSON.stringify([h.command, h.args ?? []]).toLowerCase().replace(/\\\\/g, "/");
settings.hooks ??= {};
for (const [event, groups] of Object.entries(frag.hooks ?? {})) {
  settings.hooks[event] ??= [];
  const have = new Set(settings.hooks[event].flatMap((g) => (g.hooks ?? []).map(sig)));
  for (const g of groups) {
    const fresh = g.hooks.filter((h) => !have.has(sig(h)));
    if (fresh.length) {
      settings.hooks[event].push({ ...g, hooks: fresh });
      fresh.forEach((h) => added.push(`hooks.${event}: ${h.command} ${(h.args ?? []).join(" ")}`));
    }
  }
}

if (added.length) {
  if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, `${settingsPath}.bak-herdr-install`);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("claude settings: added\n  " + added.join("\n  "));
} else {
  console.log("claude settings: already up to date");
}
