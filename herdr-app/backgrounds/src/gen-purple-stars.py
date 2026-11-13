import sys, numpy as np
from PIL import Image, ImageFilter
W, H = 2560, 1440
out, src = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(7)
img = np.zeros((H, W, 3), np.float32)

# base: deep purple + soft clouds from the (tinted) source image, heavily blurred so no low-res detail survives
base = np.array([11, 5, 19], np.float32) / 255
img += base
neb = Image.open(src).convert("RGB").resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(40))
neb = np.asarray(neb, np.float32) / 255
img += np.clip(neb - base, 0, None) * 1.6
# low-frequency noise for extra cloud structure
def noise(scale, amp):
    n = rng.random((H // scale + 2, W // scale + 2)).astype(np.float32)
    n = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((W + 2 * scale, H + 2 * scale), Image.BICUBIC), np.float32)[scale:scale + H, scale:scale + W] / 255
    return n * amp
clouds = noise(320, 1.0) * 0.6 + noise(120, 1.0) * 0.3 + noise(50, 1.0) * 0.1
clouds = np.clip(clouds - 0.45, 0, None) ** 1.5
img += clouds[..., None] * np.array([0.10, 0.03, 0.16], np.float32)

palette = np.array([[0.86, 0.72, 1.00], [0.75, 0.60, 1.00], [1.00, 0.78, 0.95], [0.80, 0.82, 1.00], [0.95, 0.90, 1.00]], np.float32)

def splat(x, y, sigma, amp, col, rad=None):
    rad = rad or max(2, int(sigma * 3.5))
    x0, x1 = int(x) - rad, int(x) + rad + 1
    y0, y1 = int(y) - rad, int(y) + rad + 1
    if x1 <= 0 or y1 <= 0 or x0 >= W or y0 >= H: return
    xs = np.arange(max(x0, 0), min(x1, W)); ys = np.arange(max(y0, 0), min(y1, H))
    g = np.exp(-(((xs[None, :] - x) ** 2 + (ys[:, None] - y) ** 2) / (2 * sigma * sigma)))
    img[ys[0]:ys[-1] + 1, xs[0]:xs[-1] + 1] += (g * amp)[..., None] * col

def spikes(x, y, length, amp, col):
    for dx, dy in ((1, 0), (0, 1)):
        t = np.arange(-length, length + 1)
        a = amp * np.exp(-np.abs(t) / (length * 0.28))
        for ti, ai in zip(t, a):
            px, py = int(x + dx * ti), int(y + dy * ti)
            if 0 <= px < W and 0 <= py < H: img[py, px] += ai * col

def star(x, y, mag):
    col = palette[rng.integers(len(palette))]
    if mag < 0.55:   splat(x, y, 0.55, 0.25 + mag * 0.9, col, 2)
    elif mag < 0.85: splat(x, y, 0.75, 0.6 + mag, col, 3)
    else:
        splat(x, y, 1.1, 2.0, col, 5)
        splat(x, y, 6 + 10 * (mag - 0.85), 0.10, col * np.array([0.9, 0.6, 1.0], np.float32))

# field stars, density follows the source's cloud brightness a little
dens = neb.mean(axis=2); dens = dens / dens.max()
n = 26000
xs, ys = rng.random(n) * W, rng.random(n) * H
keep = rng.random(n) < 0.55 + 0.45 * dens[ys.astype(int), xs.astype(int)]
for x, y in zip(xs[keep], ys[keep]):
    star(x, y, rng.random() ** 3.2)
# a few clusters
for _ in range(4):
    cx, cy, r = rng.random() * W, rng.random() * H, 40 + rng.random() * 50
    for _ in range(int(120 + rng.random() * 100)):
        a, d = rng.random() * 6.283, abs(rng.normal(0, r / 2))
        star(cx + np.cos(a) * d, cy + np.sin(a) * d, 0.4 + rng.random() * 0.5)
# bright stars with glow, a few with spikes
for i in range(14):
    x, y = rng.random() * W, rng.random() * H
    col = palette[rng.integers(len(palette))]
    splat(x, y, 1.4, 2.5, col, 6)
    splat(x, y, 14 + rng.random() * 14, 0.22, col * np.array([0.85, 0.5, 1.0], np.float32))
    if i < 6: spikes(x, y, int(30 + rng.random() * 40), 0.9, col)

Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out, quality=93)
