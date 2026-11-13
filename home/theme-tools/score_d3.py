"""usage: score_d3.py <images dir> <app home> <outdir>  -> writes <outdir>/feat.npz + top10.json per theme"""
import sys, os, json, numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, home, out = sys.argv[1:4]
THEMES = 'atom-one-dark ayu-mirage ember github-dark monokai moonfly night-owl oxocarbon poimandres solarized-dark synthwave-84 everforest kanagawa nebula'.split()
def rgb2lab(a):
    a = a / 255.0
    a = np.where(a > 0.04045, ((a + 0.055) / 1.055) ** 2.4, a / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = a @ M.T / np.array([0.95047, 1, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
def hexrgb(h): return [int(h[i:i + 2], 16) for i in (1, 3, 5)]
feats = {}
for f in sorted(os.listdir(src)):
    if not f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')): continue
    try:
        im = Image.open(os.path.join(src, f)); w, h = im.size
        if w < 1920 or w / h < 1.3 or w * h > 90e6: continue
        im = im.convert('RGB').resize((64, 36), Image.BILINEAR)
        feats[f] = (w, h, np.asarray(im, float))
    except Exception as e: print('skip', f, e)
print(len(feats), 'candidates')
names = list(feats)
labs = np.stack([rgb2lab(feats[n][2]) for n in names])  # N,36,64,3
L = labs[..., 0].mean((1, 2)); sd = labs[..., 0].std((1, 2))
res = {}
for t in THEMES:
    tf = os.path.join(home, 'themes', t + '.json')
    if not os.path.isfile(tf):
        continue
    j = json.load(open(tf)); acc = j.get('colors', {}).get('accent') or j['ansi'][4]
    pal = [j['background'], acc] + j['ansi'][1:7]
    P = rgb2lab(np.array([hexrgb(c) for c in pal], float))
    wts = np.array([1.0, 1.0] + [1.0] * 6)
    d = np.linalg.norm(labs[:, :, :, None, :] - P[None, None, None], axis=-1)  # N,36,64,P
    dmin = d.min(-1).mean((1, 2))
    # bg closeness: share of pixels near bg
    near = (d[..., 0] < 25).mean((1, 2))
    score = dmin + 0.6 * np.maximum(L - 40, 0) + 0.4 * np.maximum(10 - sd, 0) - 15 * near
    order = np.argsort(score)
    res[t] = [dict(file=names[i], score=float(score[i]), L=float(L[i]), size=feats[names[i]][:2]) for i in order[:14]]
os.makedirs(out, exist_ok=True)
json.dump(res, open(os.path.join(out, 'top.json'), 'w'), indent=1)
for t, r in res.items(): print(t, [x['file'] for x in r[:6]])
