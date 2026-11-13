import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, agents } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 300) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      // A card like the ci-watch one: Settings | agent count, big value over an 11.5px dim label.
      const list = agents();
      const needs = list.filter(a => a.status === "blocked").length;
      const ready = div().size(6).rounded_full().bg(t.accent);
      const cell = (id, top, label, tip, action) => v_flex().id(id).flex_1().min_w(0).h_full().items_center().justify_center().gap(1)
        .rounded(8).tooltip(tip).when(Boolean(action), el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_click(action))
        .child(top).child(div().text_size(11.5).text_color(t.dim).child(label));
      const gear = h_flex().h(20).gap(5).items_center().text_color(t.foreground).child(svg("mods/my-chrome/settings.svg").size(16))
        .when(Boolean(updates().app.ready), el => el.child(ready));
      // Settings opens over the card, so on_hover never reports the leave: drop the outline (and ring flag) before opening.
      const openSettings = (_e, cx) => { this.hot = false; setShared("ring.footer", false); cx?.notify?.(); run("app.settings"); };
      const settings = cell("settings", gear, "settings", updates().app.ready ? "Settings · update ready" : "Settings", openSettings);
      const num = h_flex().h(20).gap(6).items_center().text_size(16).font_medium()
        .child(div().text_color(list.length ? t.foreground : t.dim).child(String(list.length)))
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs}`)));
      const count = cell("agent-count", num, needs > 0 ? "agents · needs you" : "agents",
        needs > 0 ? `${needs} of ${list.length} agents need you` : `${list.length} agents`);
      const card = h_flex().id("footer").size_full().min_h(0).items_center().p(4).rounded(10).overflow_hidden().bg(t.chrome)
        .border_1().border_color(this.hot ? t.accent : t.border)
        .on_hover((h, cx) => { this.hot = h; setShared("ring.footer", h); cx.notify(); });
      if (collapsed) return card.justify_center().p(0).child(cell("settings", gear, "", "Settings", openSettings));
      return card.child(settings).child(div().w(1).h(24).flex_none().bg(t.border)).child(count);
    }
    // Header as a card like the sidebar cards: inset 8px at top and sides (sidebar-lists' padding adds the 8px gap below).
    const head = h_flex().id("brand").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.chrome)
      .border_1().border_color(this.hot ? t.accent : t.border)
      .on_hover((h, cx) => { this.hot = h; setShared("ring.brand", h); cx.notify(); })
      .pl(collapsed ? 0 : 12).pr(collapsed ? 0 : 6).gap(4).items_center().text_size(13.5)
      .when(collapsed, el => el.justify_center())
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/my-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/my-chrome/sidebar.svg").size(15), toggleSidebar)));
    return div().size_full().pt(8).px(8).child(head);
  }
}
