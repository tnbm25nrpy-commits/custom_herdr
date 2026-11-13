"""usage: install_d3.py <picks.json> <images dir> <app home> <removed dir>
Converts picks to backgrounds/extra/<theme>/<n>-<name>.jpg (max 2560 wide, q90) + thumbs/ (320 wide),
moves the old extra jpgs + thumbs to <removed dir>/<theme>/, rewrites the extras of backgrounds/omarchy/index.json (CRLF kept),
writes <home>/backgrounds/extra/d3ext-map.json (theme -> [[new file, original repo path]])."""
import sys, os, json, re, shutil, glob
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
pj, src, home, removed = sys.argv[1:5]
picks = json.load(open(pj))
extra = os.path.join(home, 'backgrounds/extra')
mapping = {}
for theme, files in picks.items():
    d = os.path.join(extra, theme); td = os.path.join(d, 'thumbs'); rd = os.path.join(removed, theme)
    os.makedirs(os.path.join(rd, 'thumbs'), exist_ok=True)
    first = not glob.glob(os.path.join(rd, '*.jpg'))  # re-run: the old generated files are already moved, just replace ours
    for f in glob.glob(os.path.join(d, '*.jpg')):
        shutil.move(f, os.path.join(rd, os.path.basename(f))) if first else os.remove(f)
    for f in glob.glob(os.path.join(td, '*.jpg')):
        shutil.move(f, os.path.join(rd, 'thumbs', os.path.basename(f))) if first else os.remove(f)
    mapping[theme] = []
    for n, f in enumerate(files, 1):
        short = re.sub(r'[^a-z0-9]+', '-', os.path.splitext(f)[0].lower()).strip('-')
        name = f'{n}-{short}.jpg'
        im = Image.open(os.path.join(src, f)).convert('RGB')
        if im.width > 2560: im = im.resize((2560, round(im.height * 2560 / im.width)), Image.LANCZOS)
        im.save(os.path.join(d, name), quality=90, optimize=True)
        t = im.resize((320, round(im.height * 320 / im.width)), Image.LANCZOS)
        t.save(os.path.join(td, name), quality=85)
        mapping[theme].append([name, 'images/' + f])
        print(theme, name, im.size)
json.dump(mapping, open(os.path.join(extra, 'd3ext-map.json'), 'w'), indent=1)
# index.json
p = os.path.join(home, 'backgrounds/omarchy/index.json')
raw = open(p, 'rb').read().decode('utf-8')
idx = json.loads(raw)
for e in idx:
    t = e['theme']
    if t in mapping:
        e['backgrounds'] = [b for b in e['backgrounds'] if not b.startswith(f'backgrounds/extra/{t}/')] + [f'backgrounds/extra/{t}/{n}' for n, _ in mapping[t]]
s = json.dumps(idx, indent=2).replace('\n', '\r\n')
open(p + '.new', 'w', encoding='utf-8', newline='').write(s)
