// A stand-in for the app's "herdr" module. Tests set `state` and read `calls`.
// shared through globalThis: the app code and the test may see this file as two module instances
export const state = (globalThis.__herdrStub ??= { agents: [], spaces: [], terminals: [], layout: { id: "root", children: [{ id: "work-stack", active: "agent-map" }] }, settings: { zoom: 1 }, files: {} });
export const calls = (globalThis.__herdrCalls ??= []);
export const appHome = () => "C:/fake-home";
export const run = (name, args) => { calls.push([name, args]); return null; };
export const theme = () => ({});
export const layout = () => state.layout;
export const agents = () => state.agents;
export const spaces = () => state.spaces;
export const terminals = () => state.terminals;
export const settings = () => state.settings;
export const nextCommand = () => new Promise(() => { });
export const readTextFile = async (p) => { if (p in state.files) return state.files[p]; throw new Error("ENOENT"); };
export const watchFolder = () => new Promise(() => { });
