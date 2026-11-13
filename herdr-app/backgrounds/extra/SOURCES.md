# Theme picker: sources (added 2026-11-12)

## Official wallpapers (converted to JPG, max 2560 px wide)

| Theme | Files | Source | License |
|---|---|---|---|
| dracula | 1-spooky-house, 2-waves, 3-mountains, 4-leaves | github.com/dracula/wallpaper (`second-collection/`: spooky-minimal, waves, illustrations/trees-and-mountains, leaves) | MIT (Dracula Theme) |
| rose-pine-moon | 1-leafy-moon (by fvrests), 2-block-wave, 3-contour-line (by Chunghha) | github.com/rose-pine/wallpapers (`illustration/`, `generative/`) | CC0 1.0 |

## Wallpapers from D3Ext/aesthetic-wallpapers (replaced the generated ones, 2026-11-12)

github.com/D3Ext/aesthetic-wallpapers, MIT license. Converted to JPG (max 2560 px wide, quality 90) + 320 px thumbs, picked by palette fit
(`C:\Users\me\theme-tools\score_d3.py` as a hint, then by eye). The old generated wallpapers (starfield, aurora, mountains, dunes, topo) are in
`C:\Users\me\herdr-removed-generated-wallpapers\<theme>\`. Machine-readable copy of this table: `d3ext-map.json`.

| Theme | File (`backgrounds/extra/<theme>/`) | Original repo path |
|---|---|---|
| atom-one-dark | 1-towashi.jpg | `images/towashi.jpg` |
| atom-one-dark | 2-landscape2.jpg | `images/landscape2.jpg` |
| atom-one-dark | 3-california.jpg | `images/california.jpg` |
| ayu-mirage | 1-shape-abstract.jpg | `images/shape-abstract.jpg` |
| ayu-mirage | 2-minimal-landscape.jpg | `images/minimal_landscape.jpg` |
| ayu-mirage | 3-saturn-rings.jpg | `images/saturn-rings.jpg` |
| ember | 1-sunset-city.jpg | `images/sunset_city.png` |
| ember | 2-red-forest.jpg | `images/red-forest.jpg` |
| ember | 3-steampunk-portal.jpg | `images/steampunk_portal.png` |
| github-dark | 1-japan.jpg | `images/japan.png` |
| github-dark | 2-nord-dark-city.jpg | `images/nord_dark_city.png` |
| github-dark | 3-dark-forest.jpg | `images/dark_forest.png` |
| monokai | 1-fantasy-woods.jpg | `images/fantasy-woods.jpg` |
| monokai | 2-town.jpg | `images/town.jpg` |
| monokai | 3-room.jpg | `images/room.jpg` |
| moonfly | 1-shiny-purple.jpg | `images/shiny_purple.png` |
| moonfly | 2-colors.jpg | `images/colors.jpg` |
| moonfly | 3-lana-silhouette.jpg | `images/lana_silhouette.png` |
| night-owl | 1-planet-with-sunrise.jpg | `images/planet_with_sunrise.png` |
| night-owl | 2-light-ring.jpg | `images/light-ring.jpg` |
| night-owl | 3-em-rofi.jpg | `images/em-rofi.webp` |
| oxocarbon | 1-nord-street.jpg | `images/nord-street.png` |
| oxocarbon | 2-neosamurai.jpg | `images/neosamurai.webp` |
| oxocarbon | 3-glass-sphere.jpg | `images/glass-sphere.jpg` |
| poimandres | 1-wallhaven-x67oxo.jpg | `images/wallhaven-x67oxo.png` |
| poimandres | 2-fishing-stars.jpg | `images/fishing_stars.jpg` |
| poimandres | 3-abstract.jpg | `images/abstract.jpg` |
| solarized-dark | 1-gas-station.jpg | `images/gas-station.jpg` |
| solarized-dark | 2-ink-wave.jpg | `images/ink_wave.png` |
| solarized-dark | 3-river.jpg | `images/river.png` |
| synthwave-84 | 1-cyberpunk-car.jpg | `images/cyberpunk_car.png` |
| synthwave-84 | 2-neon-circle.jpg | `images/neon-circle.jpg` |
| synthwave-84 | 3-lets-go-home.jpg | `images/lets_go_home.png` |
| everforest | 1-shougan-castle.jpg | `images/shougan_castle.png` |
| kanagawa | 1-japan3.jpg | `images/japan3.jpg` |
| nebula | 1-wallhaven-9mjw78.jpg | `images/wallhaven-9mjw78.png` |

## Theme palettes (themes/*.json)

All MIT unless noted. Colors were read from the project repos, not guessed.

| Theme | Source |
|---|---|
| dracula | dracula/dracula-theme (spec palette), terminal ANSI from dracula/windows-terminal + dracula/alacritty |
| rose-pine-moon | rose-pine/alacritty `dist/rose-pine-moon.toml` (cursor set to text `#e0def4`: the official cursor `#56526e` is nearly invisible on the base) |
| synthwave-84 | robb0wen/synthwave-vscode `themes/synthwave-color-theme.json` (it defines no black/white/bright black/bright white: taken from its own palette `#34294f`, `#b6b1b1`, `#848bbd`, `#ffffff`) |
| oxocarbon | nyoom-engineering/oxocarbon.nvim `lua/oxocarbon/init.lua`, dark (blends computed like `blend_hex`) |
| night-owl | sdras/night-owl-vscode-theme `Night Owl-color-theme.json` |
| ayu-mirage | ayu-theme/ayu-vim `colors/ayu.vim` mirage terminal palette (ayu-colors only defines terminal colors by color-math transforms). Deviations: ansi 7 = fg `#d9d7ce`, bright white = `#ffffff` (the vim file maps it to the comment grey) |
| monokai | microsoft/vscode `extensions/theme-monokai` (editor + terminal ANSI colors) |
| solarized-dark | Ethan Schoonover's palette (altercation/solarized README) with his official ANSI mapping |
| poimandres | drcmda/poimandres-theme `themes/poimandres-color-theme.json` |
| github-dark | primer/github-vscode-theme (dark default) with `@primer/primitives` 7.10.0 `colors/dark.json` ANSI values; selection = accent.muted blended on the canvas |
| moonfly | bluz71/vim-moonfly-colors `extras/moonfly-windows-terminal.json`, selection = `MoonflyVisual` (`#323437`) |

Derived by `C:\Users\me\theme-tools\make_themes.py`: `colors.canvas` (bg 45% toward black), `colors.chrome` (25% toward black), `colors.border` (bg 18% toward fg).
- solarized-dark: ansi 8 changed from #002b36 (= background, invisible) to #586e75 (base01), common terminal-port deviation.
