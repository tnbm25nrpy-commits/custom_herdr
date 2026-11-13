import json, os, re, sys
home = sys.argv[1]
hexre = re.compile(r'^#[0-9a-fA-F]{6}$')
idx = json.load(open(os.path.join(home, 'backgrounds/omarchy/index.json'), encoding='utf-8'))
bad = []
names = [e['theme'] for e in idx]
if names != sorted(names): bad.append('index not sorted')
def thumb(p): d, f = p.rsplit('/', 1); return d + '/thumbs/' + f
for e in idx:
    t = e['theme']
    if len(e['backgrounds']) < 3: bad.append(f'{t}: only {len(e["backgrounds"])} backgrounds')
    for p in e['backgrounds']:
        for q in (p, thumb(p)):
            if not os.path.isfile(os.path.join(home, q)): bad.append(f'{t}: missing {q}')
    if not hexre.match(e['background']) or not hexre.match(e['accent']): bad.append(f'{t}: bad index colors')
    f = os.path.join(home, 'themes', t + '.json')
    if not os.path.isfile(f): bad.append(f'{t}: no theme json'); continue
    j = json.load(open(f))
    for k in ('background', 'foreground', 'selection', 'cursor'):
        if not hexre.match(j.get(k, '')): bad.append(f'{t}: {k} invalid')
    if len(j.get('ansi', [])) != 16 or not all(hexre.match(c) for c in j['ansi']): bad.append(f'{t}: ansi invalid')
    c = j.get('colors')
    if c is None: bad.append(f'{t}: no colors block (pre-existing)' )
    else:
        for k in ('accent', 'canvas', 'chrome', 'border'):
            if not hexre.match(c.get(k, '')): bad.append(f'{t}: colors.{k} invalid')
# nebula (own list in main.js)
for p in ['backgrounds/purple-stars-hd.jpg','backgrounds/purple-space.png','backgrounds/extra/nebula/1-wallhaven-9mjw78.jpg','backgrounds/thumbs/purple-stars-hd.jpg','backgrounds/thumbs/purple-space.jpg','backgrounds/extra/nebula/thumbs/1-wallhaven-9mjw78.jpg']:
    if not os.path.isfile(os.path.join(home, p)): bad.append('nebula missing ' + p)
for t in ['catppuccin-latte','flexoki-light','lupine','rose-pine','white']:
    if os.path.exists(os.path.join(home,'themes',t+'.json')) or t in names: bad.append('light theme still present '+t)
print('entries', len(idx), 'min backgrounds', min(len(e['backgrounds']) for e in idx))
print('PROBLEMS:' if bad else 'OK', *bad, sep='\n')
