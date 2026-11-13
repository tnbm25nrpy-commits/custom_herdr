"""Add the extra themes to backgrounds/omarchy/index.json (sorted), append extras to everforest/kanagawa."""
import json, os, glob, sys
home = sys.argv[1]
p = os.path.join(home, 'backgrounds/omarchy/index.json')
idx = json.load(open(p, encoding='utf-8'))
by = {e['theme']: e for e in idx}
def extras(t):
    return sorted(os.path.relpath(f, home).replace(os.sep, '/') for f in glob.glob(os.path.join(home, 'backgrounds/extra', t, '*.jpg')))
def entry(t):
    j = json.load(open(os.path.join(home, 'themes', t + '.json')))
    return dict(theme=t, mode='dark', background=j['background'], accent=j.get('colors', {}).get('accent', j['ansi'][4]), backgrounds=extras(t))
for t in ['dracula','rose-pine-moon','synthwave-84','oxocarbon','night-owl','ayu-mirage','monokai','solarized-dark','poimandres','github-dark','moonfly','ember','atom-one-dark']:
    by[t] = entry(t)
for t in ['everforest', 'kanagawa']:
    for f in extras(t):
        if f not in by[t]['backgrounds']: by[t]['backgrounds'].append(f)
out = sorted(by.values(), key=lambda e: e['theme'])
s = json.dumps(out, indent=2).replace(chr(10), chr(13) + chr(10))
open(p, 'w', encoding='utf-8', newline='').write(s)
print(len(out), [e['theme'] for e in out])
