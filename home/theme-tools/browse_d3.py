"""usage: browse_d3.py <images dir> <outdir> : makes cached 400px thumbs + overview sheets (4x4) of candidates"""
import sys, os
from PIL import Image, ImageDraw
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1:3]
os.makedirs(out + '/th', exist_ok=True)
names = []
for f in sorted(os.listdir(src)):
    if not f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')): continue
    try:
        im = Image.open(os.path.join(src, f)); w, h = im.size
        if w < 1920 or w / h < 1.3 or w * h > 90e6: continue
        t = out + '/th/' + f + '.jpg'
        if not os.path.exists(t):
            im.convert('RGB').resize((400, 225), Image.BILINEAR).save(t, quality=80)
        names.append(f)
    except Exception as e: print('skip', f, e)
open(out + '/names.txt', 'w').write('\n'.join(names))
per = 20; cols = 5
for s in range(0, len(names), per):
    chunk = names[s:s + per]; rows = (len(chunk) + cols - 1) // cols
    S = Image.new('RGB', (cols * 400, rows * 241), '#333'); d = ImageDraw.Draw(S)
    for i, f in enumerate(chunk):
        x, y = (i % cols) * 400, (i // cols) * 241
        S.paste(Image.open(out + '/th/' + f + '.jpg'), (x, y + 16)); d.text((x + 3, y + 2), f'{s+i} {f[:44]}', fill='white')
    S.save(f'{out}/ov{s//per:02d}.jpg', quality=85)
print(len(names))
