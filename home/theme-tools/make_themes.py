"""Write themes/<name>.json for the new dark themes. Palettes: see backgrounds/extra/SOURCES.md."""
import json, sys, os
home = sys.argv[1]
def h2r(h): h=h.lstrip('#'); return [int(h[i:i+2],16) for i in (0,2,4)]
def r2h(r): return '#%02x%02x%02x' % tuple(max(0,min(255,round(v))) for v in r)
def mix(a,b,t): return r2h([x*(1-t)+y*t for x,y in zip(h2r(a),h2r(b))])
def blend_hex(a,b,t): return mix(a,b,t)

T = {}
def add(name, bg, fg, sel, cur, ansi, accent):
    assert len(ansi)==16
    canvas = mix(bg,'#000000',0.45); chrome = mix(bg,'#000000',0.25)
    border = mix(bg,fg,0.18)
    T[name] = dict(background=bg, foreground=fg, selection=sel, cursor=cur, ansi=ansi,
                   colors=dict(accent=accent, canvas=canvas, chrome=chrome, border=border))

add('dracula','#282a36','#f8f8f2','#44475a','#f8f8f2',
 ['#21222c','#ff5555','#50fa7b','#f1fa8c','#bd93f9','#ff79c6','#8be9fd','#f8f8f2',
  '#6272a4','#ff6e6e','#69ff94','#ffffa5','#d6acff','#ff92df','#a4ffff','#ffffff'],'#bd93f9')

add('rose-pine-moon','#232136','#e0def4','#44415a','#e0def4',
 ['#393552','#eb6f92','#3e8fb0','#f6c177','#9ccfd8','#c4a7e7','#ea9a97','#e0def4',
  '#6e6a86','#eb6f92','#3e8fb0','#f6c177','#9ccfd8','#c4a7e7','#ea9a97','#e0def4'],'#c4a7e7')

# synthwave-color-theme.json defines no black/white/brightBlack/brightWhite: taken from its own palette
add('synthwave-84','#262335','#ffffff','#34294f','#f97e72',
 ['#34294f','#fe4450','#72f1b8','#f3e70f','#03edf9','#ff7edb','#03edf9','#b6b1b1',
  '#848bbd','#fe4450','#72f1b8','#fede5d','#03edf9','#ff7edb','#03edf9','#ffffff'],'#ff7edb')

b00='#161616'; b06='#ffffff'
ox = {k: blend_hex(b00,b06,v) for k,v in dict(base01=.085,base02=.18,base03=.3,base04=.82,base05=.95).items()}
add('oxocarbon',b00,ox['base04'],ox['base02'],ox['base04'],
 [ox['base01'],'#33b1ff','#be95ff','#42be65','#78a9ff','#82cfff','#3ddbd9',ox['base05'],
  ox['base03'],'#33b1ff','#be95ff','#42be65','#78a9ff','#82cfff','#08bdba',b06],'#78a9ff')

add('night-owl','#011627','#d6deeb','#1d3b53','#80a4c2',
 ['#011627','#ef5350','#22da6e','#c5e478','#82aaff','#c792ea','#21c7a8','#ffffff',
  '#575656','#ef5350','#22da6e','#ffeb95','#82aaff','#c792ea','#7fdbca','#ffffff'],'#82aaff')

# ayu-vim mirage terminal palette (ayu-theme org); bright white = #fff instead of its comment grey
add('ayu-mirage','#212733','#d9d7ce','#343f4c','#ffcc66',
 ['#212733','#f07178','#bbe67e','#ffcc66','#5ccfe6','#d4bfff','#95e6cb','#d9d7ce',
  '#607080','#ff3333','#bbe67e','#ffcc66','#5ccfe6','#d4bfff','#95e6cb','#ffffff'],'#ffcc66')

# VS Code Monokai (microsoft/vscode theme-monokai) terminal colors
add('monokai','#272822','#f8f8f2','#49483e','#f8f8f0',
 ['#333333','#c4265e','#86b42b','#b3b42b','#6a7ec8','#8c6bc8','#56adbc','#e3e3dd',
  '#666666','#f92672','#a6e22e','#e2e22e','#819aff','#ae81ff','#66d9ef','#f8f8f2'],'#a6e22e')

# Ethan Schoonover's palette with his official ANSI mapping
add('solarized-dark','#002b36','#839496','#073642','#93a1a1',
 ['#073642','#dc322f','#859900','#b58900','#268bd2','#d33682','#2aa198','#eee8d5',
  '#002b36','#cb4b16','#586e75','#657b83','#839496','#6c71c4','#93a1a1','#fdf6e3'],'#268bd2')

add('poimandres','#1b1e28','#a6accd','#303340','#a6accd',
 ['#1b1e28','#d0679d','#5de4c7','#fffac2','#89ddff','#f087bd','#89ddff','#ffffff',
  '#a6accd','#d0679d','#5de4c7','#fffac2','#add7ff','#f087bd','#add7ff','#ffffff'],'#5de4c7')

add('github-dark','#0d1117','#c9d1d9','#1e4273','#58a6ff',
 ['#484f58','#ff7b72','#3fb950','#d29922','#58a6ff','#bc8cff','#39c5cf','#b1bac4',
  '#6e7681','#ffa198','#56d364','#e3b341','#79c0ff','#d2a8ff','#56d4dd','#ffffff'],'#58a6ff')

add('moonfly','#080808','#bdbdbd','#323437','#9e9e9e',
 ['#323437','#ff5d5d','#8cc85f','#e3c78a','#80a0ff','#cf87e8','#79dac8','#c6c6c6',
  '#949494','#ff5189','#36c692','#c6c684','#74b2ff','#ae81ff','#85dc85','#e4e4e4'],'#80a0ff')

for n,t in T.items():
    with open(os.path.join(home,'themes',n+'.json'),'w',newline='\n') as f:
        json.dump(t,f,indent=2); f.write('\n')
print(len(T),'themes')
