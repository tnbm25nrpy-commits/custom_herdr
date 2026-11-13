"""usage: picks_sheet.py <picks.json> <images dir> <out.jpg> [thumbdir]: contact sheet, one row per theme"""
import sys, json, os
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
pj, src, out = sys.argv[1:4]
picks = json.load(open(pj))
tw, th = 560, 315
mx = max(len(v) for v in picks.values())
S = Image.new('RGB', (mx * tw, len(picks) * (th + 20)), '#222'); d = ImageDraw.Draw(S)
for r, (t, fs) in enumerate(picks.items()):
    for c, f in enumerate(fs):
        p = os.path.join(src, f)
        im = Image.open(p).convert('RGB'); im = im.resize((tw, th), Image.LANCZOS) if abs(im.width/im.height-16/9) < 0.4 else im.resize((tw, th))
        S.paste(im, (c * tw, r * (th + 20) + 20))
        d.text((c * tw + 4, r * (th + 20) + 4), f'{t} / {c+1}  {os.path.basename(f)}', fill='white')
S.save(out, quality=88)
