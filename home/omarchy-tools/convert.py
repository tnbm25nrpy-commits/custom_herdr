import sys, os, json, re, subprocess, pathlib
src = pathlib.Path(sys.argv[1]); home = pathlib.Path(sys.argv[2])
themes_out = home/'themes'; bg_out = home/'backgrounds'/'omarchy'
index = []
def toml(p):
    d = {}
    for line in p.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\s*([a-z_0-9]+)\s*=\s*"([^"]*)"', line)
        if m: d[m.group(1)] = m.group(2)
    return d
def hexok(v): return re.fullmatch(r'#[0-9a-fA-F]{6}', v or '') is not None
for t in sorted(p for p in src.iterdir() if p.is_dir()):
    c = toml(t/'colors.toml'); n = t.name
    g = lambda k, f=None: c.get(k) if hexok(c.get(k)) else (c.get(f) if f else None)
    ansi = [g('lighter_background'), g('red'), g('green'), g('yellow'), g('blue'), g('magenta'), g('cyan'), g('foreground'),
            g('dark_foreground','muted'), g('bright_red'), g('bright_green'), g('bright_yellow'), g('bright_blue'), g('bright_magenta'), g('bright_cyan'), g('bright_foreground')]
    assert all(ansi), n
    th = {"background": g('background'), "foreground": g('foreground'), "selection": g('selection'), "cursor": g('accent'),
          "ansi": ansi,
          "colors": {"accent": g('accent'), "canvas": g('darker_background'), "chrome": g('dark_background'), "border": g('muted')}}
    (themes_out/f'{n}.json').write_text(json.dumps(th, indent=2), encoding='utf-8')
    bgs = []
    od = bg_out/n; (od/'thumbs').mkdir(parents=True, exist_ok=True)
    for b in sorted((t/'backgrounds').iterdir()):
        if not b.is_file() or b.suffix.lower() not in ('.jpg','.jpeg','.png','.webp'): continue
        out = od/(b.stem+'.jpg'); th_ = od/'thumbs'/(b.stem+'.jpg')
        if not out.exists():
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(b),'-vf',"scale='min(2560,iw)':-2",'-q:v','3',str(out)], check=True)
        if not th_.exists():
            subprocess.run(['ffmpeg','-v','error','-y','-i',str(out),'-vf','scale=320:-2','-q:v','5',str(th_)], check=True)
        bgs.append(f'backgrounds/omarchy/{n}/{b.stem}.jpg')
    index.append({"theme": n, "mode": c.get('mode','dark'), "background": g('background'), "accent": g('accent'), "backgrounds": bgs})
    print(n, len(bgs))
(bg_out/'index.json').write_text(json.dumps(index, indent=2), encoding='utf-8')
