// Module hooks for the tests: main.js imports "herdr", "gpui-kit" and "gpui-base" (provided by the app); here they are the stubs.
const stubs = { herdr: "./stubs/herdr.mjs", "gpui-kit": "./stubs/gpui-kit.mjs", "gpui-base": "./stubs/gpui-base.mjs" };
export async function resolve(specifier, context, next) {
  if (stubs[specifier]) return { url: new URL(stubs[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.endsWith("/main.js")) return next(url, { ...context, format: "module" });   // a .js without package.json
  return next(url, context);
}
