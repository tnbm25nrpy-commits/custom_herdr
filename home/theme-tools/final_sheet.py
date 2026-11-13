"""usage: final_sheet.py <app home> <out.jpg>: contact sheet of the d3ext picks (cover-cropped 16:9 like the app), one row per theme"""
import sys, os, json
from PIL import Image, ImageDraw, ImageOps
home, out = sys.argv[1:3]
m = json.load(open(os.path.join(home, 'backgrounds/extra/d3ext-map.json')))
tw, th = 560, 315
rows = []
for t, fs in m.items():
    for i in range(0, len(fs), 3): rows.append((t, fs[i:i + 3]))
S = Image.new('RGB', (3 * tw, len(rows) * (th + 20)), '#222'); d = ImageDraw.Draw(S)
for r, (t, fs) in enumerate(rows):
    for c, (n, orig) in enumerate(fs):
        im = ImageOps.fit(Image.open(os.path.join(home, 'backgrounds/extra', t, n)).convert('RGB'), (tw, th), Image.LANCZOS)
        S.paste(im, (c * tw, r * (th + 20) + 20))
        d.text((c * tw + 4, r * (th + 20) + 4), f'{t}  {n}  <- {orig}', fill='white')
S.save(out, quality=88)
print(len(rows), S.size)
