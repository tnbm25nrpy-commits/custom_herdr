"""Palette-driven wallpaper generator for the herdr-app theme picker.

usage: python -I gen_backgrounds.py <herdr-app-home> [theme[:style] ...]
Writes backgrounds/extra/<theme>/<n>-<style>.jpg (2560x1440) + thumbs/ (320px wide).
Styles: starfield, aurora, mountains, dunes, topo.  Everything is derived from themes/<theme>.json.
Dark, low contrast in the middle (terminal text stays readable), grain-dithered to avoid banding.
"""
import sys, os, json, colorsys
import numpy as np
from PIL import Image

W, H = 2560, 1440

# (theme, [(index, style, seed, options)])
PLAN = {
    "synthwave-84":  [(1, "starfield", 11, {}), (2, "aurora", 12, {}), (3, "mountains", 13, {"sun": True})],
    "oxocarbon":     [(1, "starfield", 21, {}), (2, "aurora", 22, {}), (3, "topo", 23, {})],
    "night-owl":     [(1, "starfield", 31, {}), (2, "aurora", 32, {}), (3, "mountains", 33, {"moon": True})],
    "ayu-mirage":    [(1, "starfield", 41, {}), (2, "aurora", 42, {}), (3, "dunes", 43, {})],
    "monokai":       [(1, "starfield", 51, {}), (2, "aurora", 52, {}), (3, "topo", 53, {})],
    "solarized-dark": [(1, "starfield", 61, {}), (2, "aurora", 62, {}), (3, "dunes", 63, {})],
    "poimandres":    [(1, "starfield", 71, {}), (2, "aurora", 72, {}), (3, "mountains", 73, {"moon": True})],
    "github-dark":   [(1, "starfield", 81, {}), (2, "aurora", 82, {}), (3, "topo", 83, {})],
    "moonfly":       [(1, "starfield", 91, {}), (2, "aurora", 92, {}), (3, "mountains", 93, {"moon": True})],
    "ember":         [(1, "starfield", 101, {}), (2, "aurora", 102, {}), (3, "dunes", 103, {"sun": True})],
    "atom-one-dark": [(1, "starfield", 111, {}), (2, "aurora", 112, {}), (3, "topo", 113, {})],
    # extras for themes that already have 2
    "everforest":    [(1, "mountains", 121, {"moon": True})],
    "kanagawa":      [(1, "aurora", 131, {})],
    "nebula":        [(1, "aurora", 141, {})],
}
# hue picks where the heuristic would choose badly (ansi indexes / hex)
HUES = {
    "kanagawa": ["#7e9cd8", "#957fb8", "#7aa89f"], "everforest": ["#a7c080", "#7fbbb3", "#dbbc7f"],
    "synthwave-84": ["#ff7edb", "#fede5d", "#03edf9"], "oxocarbon": ["#78a9ff", "#be95ff", "#3ddbd9"],
    "night-owl": ["#82aaff", "#c792ea", "#21c7a8"], "ayu-mirage": ["#ffcc66", "#5ccfe6", "#d4bfff"],
    "monokai": ["#f92672", "#ae81ff", "#66d9ef"], "solarized-dark": ["#268bd2", "#2aa198", "#6c71c4"],
    "poimandres": ["#5de4c7", "#89ddff", "#f087bd"], "github-dark": ["#58a6ff", "#bc8cff", "#39c5cf"],
    "moonfly": ["#80a0ff", "#cf87e8", "#79dac8"], "ember": ["#e5484d", "#e8b86b", "#d0789a"],
    "atom-one-dark": ["#61afef", "#c678dd", "#56b6c2"], "nebula": ["#b57bff", "#8aa6ff", "#ff6b8e"],
}


def h2f(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255


def mix(a, b, t):
    return a * (1 - t) + b * t


def palette(theme, home):
    j = json.load(open(os.path.join(home, "themes", theme + ".json")))
    bg = h2f(j["background"])
    if theme in HUES:
        hues = [h2f(c) for c in HUES[theme]]
    else:
        cand = [j.get("colors", {}).get("accent", j["ansi"][4])] + j["ansi"][1:7] + j["ansi"][9:15]
        hs = []
        for c in cand:
            r, g, b = h2f(c)
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            if s > 0.28 and v > 0.4:
                hs.append((h, c))
        chosen = [hs[0]]
        while len(chosen) < 3 and len(chosen) < len(hs):
            best = max((x for x in hs if x not in chosen),
                       key=lambda x: min(min(abs(x[0] - y[0]), 1 - abs(x[0] - y[0])) for y in chosen))
            chosen.append(best)
        while len(chosen) < 3:
            chosen.append(chosen[-1])
        hues = [h2f(c) for _, c in chosen]
    return bg, hues, h2f(j["foreground"])


def fbm(rng, scale, octaves=5, aspect=(1, 1), gain=0.5):
    """smooth value noise in 0..1, features ~scale px (aspect stretches x/y)."""
    out = np.zeros((H, W), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        sx, sy = max(2, scale * aspect[0] / 2 ** o), max(2, scale * aspect[1] / 2 ** o)
        gw, gh = int(W / sx) + 4, int(H / sy) + 4
        g = rng.random((gh, gw)).astype(np.float32)
        im = Image.fromarray(g, "F").resize((int(gw * sx), int(gh * sy)), Image.BICUBIC)
        a = np.asarray(im)[int(2 * sy):int(2 * sy) + H, int(2 * sx):int(2 * sx) + W]
        out += a * amp
        tot += amp
        amp *= gain
    out /= tot
    lo, hi = np.percentile(out, 1), np.percentile(out, 99)
    return np.clip((out - lo) / (hi - lo), 0, 1)


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
U, V = XX / W, YY / H


def base_gradient(bg, hues, rng):
    """deep base: darker than theme bg, faint colored glow from a corner."""
    dark = bg * 0.55
    img = np.empty((H, W, 3), np.float32)
    img[:] = dark
    cx, cy = rng.uniform(0.2, 0.8), rng.uniform(0.2, 0.9)
    d = np.sqrt(((U - cx) * 1.6) ** 2 + (V - cy) ** 2)
    img += (np.exp(-(d / 0.55) ** 2) * 0.10)[..., None] * (hues[0] * 0.8 + bg * 0.2)
    d2 = np.sqrt(((U - (1 - cx)) * 1.6) ** 2 + (V - (1 - cy)) ** 2)
    img += (np.exp(-(d2 / 0.5) ** 2) * 0.07)[..., None] * hues[1]
    return img


# ---------- styles ----------

def starfield(bg, hues, fg, rng):
    img = base_gradient(bg, hues, rng)
    # nebula clouds, one fbm per hue
    for i, col in enumerate(hues):
        n = fbm(rng, 760 - i * 120, 4, gain=0.45)
        n2 = fbm(rng, 1300, 2)
        cloud = smooth(n * 0.75 + n2 * 0.35, 0.50, 1.0) ** 1.25
        img += (cloud * (0.24 - i * 0.04))[..., None] * col
    # dust lanes (darken)
    lane = smooth(fbm(rng, 520, 4), 0.58, 0.9)
    img *= (1 - 0.30 * lane)[..., None]

    tints = [fg, *hues, (fg + hues[0]) / 2]
    star = np.zeros((H, W, 3), np.float32)

    def put(xs, ys, amps, cols):
        x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
        fx, fy = (xs - x0)[:, None], (ys - y0)[:, None]
        for dx, dy, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            xi, yi = x0 + dx, y0 + dy
            ok = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
            np.add.at(star, (yi[ok], xi[ok]), (w * amps[:, None] * cols)[ok])

    n = 24000
    xs, ys = rng.random(n) * W, rng.random(n) * H
    dens = fbm(rng, 500, 3)
    keep = rng.random(n) < (0.35 + 0.65 * dens[ys.astype(int), xs.astype(int)])
    # fewer stars in the calm middle
    mid = np.exp(-(((xs / W - .5) / .3) ** 2 + ((ys / H - .5) / .3) ** 2))
    keep &= rng.random(n) > 0.5 * mid
    xs, ys = xs[keep], ys[keep]
    mag = rng.random(len(xs)) ** 3.5
    cols = np.array([tints[i] for i in rng.integers(len(tints), size=len(xs))], np.float32)
    put(xs, ys, 0.16 + mag * 0.9, mix(cols, np.ones(3, np.float32), 0.35))

    def splat(x, y, sigma, amp, col):
        rad = int(sigma * 3.6) + 2
        x0, x1, y0, y1 = max(int(x) - rad, 0), min(int(x) + rad + 1, W), max(int(y) - rad, 0), min(int(y) + rad + 1, H)
        if x1 <= x0 or y1 <= y0:
            return
        g = np.exp(-(((XX[y0:y1, x0:x1] - x) ** 2 + (YY[y0:y1, x0:x1] - y) ** 2) / (2 * sigma * sigma)))
        star[y0:y1, x0:x1] += (g * amp)[..., None] * col

    for _ in range(1100):
        x, y = rng.random() * W, rng.random() * H
        c = mix(tints[rng.integers(len(tints))], np.ones(3, np.float32), 0.4)
        splat(x, y, 0.95, 0.6 + rng.random() * 0.5, c)
    for i in range(22):
        x, y = rng.random() * W, rng.random() * H
        c = mix(tints[rng.integers(len(tints))], np.ones(3, np.float32), 0.5)
        splat(x, y, 1.3, 1.1, c)
        splat(x, y, 16 + rng.random() * 12, 0.10, c)
        if i < 5:  # diffraction spikes
            L = int(28 + rng.random() * 40)
            for dx, dy in ((1, 0), (0, 1)):
                for t in range(-L, L + 1):
                    px, py = int(x + dx * t), int(y + dy * t)
                    if 0 <= px < W and 0 <= py < H:
                        star[py, px] += 0.55 * np.exp(-abs(t) / (L * 0.3)) * c
    return img + star


def aurora(bg, hues, fg, rng):
    """soft curtains / mesh gradient waves, computed at half res and upscaled (smooth by nature)."""
    h, w = H // 2, W // 2
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xx / w, yy / h
    img = np.empty((h, w, 3), np.float32)
    img[:] = bg * 0.5
    # soft mesh blobs
    for col in hues:
        cx, cy = rng.uniform(0, 1), rng.uniform(0.1, 1)
        d = np.sqrt(((u - cx) * 1.5) ** 2 + (v - cy) ** 2)
        img += (np.exp(-(d / 0.45) ** 2) * 0.10)[..., None] * col

    def small_noise(scale, ax=1.0, ay=1.0):
        # fbm at half res: build via the full res generator then downsample
        return np.asarray(Image.fromarray(fbm(rng, scale, 4, (ax, ay)), "F").resize((w, h), Image.BILINEAR))

    nb = 4
    for k in range(nb):
        col = hues[k % len(hues)]
        y0 = 0.28 + 0.42 * (k / (nb - 1)) + rng.uniform(-0.04, 0.04)
        f1, f2 = rng.uniform(0.7, 1.4), rng.uniform(1.6, 2.8)
        p1, p2 = rng.uniform(0, 6.28), rng.uniform(0, 6.28)
        warp = (small_noise(700) - 0.5) * 0.22
        yc = y0 + 0.09 * np.sin(2 * np.pi * f1 * u + p1) + 0.04 * np.sin(2 * np.pi * f2 * u + p2) + warp
        width = rng.uniform(0.07, 0.12)
        dv = v - yc
        # crisp-ish lower hem, long soft glow upward (the curtain hangs down from above)
        band = np.where(dv > 0, np.exp(-(dv / (width * 0.45)) ** 2), np.exp(-(-dv / (width * 2.0)) ** 2))
        rays = 0.30 + 0.95 * small_noise(520, 0.03, 1.0) ** 1.3
        rays2 = 0.7 + 0.5 * small_noise(260, 0.012, 0.8)
        amp = 0.21 * (0.65 + 0.35 * small_noise(900))
        img += (band * rays * rays2 * amp)[..., None] * mix(col, hues[(k + 1) % len(hues)], 0.25 + 0.5 * u[..., None])
    out = np.stack([np.asarray(Image.fromarray(img[..., c], "F").resize((W, H), Image.BICUBIC)) for c in range(3)], -1)
    return out


def ridge_profile(rng, base, amp, octs=6, rough=0.55, freq=1.2):
    x = np.arange(W, dtype=np.float32) / W
    y = np.zeros(W, np.float32)
    a = 1.0
    f = freq
    tot = 0
    for _ in range(octs):
        y += a * np.cos(2 * np.pi * (f * x + rng.random()) + rng.random() * 6.28)
        tot += a
        a *= rough
        f *= 2.05
    # 1/f-ish ridge: use abs for sharper peaks on the large octaves
    y = y / tot
    return base + amp * y


def mountains(bg, hues, fg, rng, sun=False, moon=False):
    img = np.empty((H, W, 3), np.float32)
    top = bg * 0.40
    glow = mix(hues[0], hues[1], 0.45) * 0.50 + bg * 0.22
    hz = 0.62
    t = smooth(V, 0.0, hz)[..., None]
    mid = mix(bg * 0.6, hues[2] * 0.22 + bg * 0.3, 0.8)
    img[:] = np.where(t < 0.5, mix(top, mid, np.clip(t * 2, 0, 1) ** 1.2), mix(mid, glow, np.clip((t - 0.5) * 2, 0, 1) ** 1.5))
    img = np.where(V[..., None] > hz, glow, img)
    # sky stars (faint)
    sky_stars = rng.random((H, W)) > 0.9994
    img += (sky_stars * smooth(hz - V, 0.05, 0.4) * 0.5)[..., None] * fg
    # sun / moon disc with halo
    if sun or moon:
        cx, cy = rng.uniform(0.25, 0.75), hz - rng.uniform(0.03, 0.12)
        r = 0.075 if sun else 0.035
        d = np.sqrt(((U - cx) * W / H) ** 2 + (V - cy) ** 2)
        halo = np.exp(-(d / (r * 3.2)) ** 2) * (0.30 if sun else 0.16)
        col = hues[1] if sun else mix(fg, hues[0], 0.3)
        img += halo[..., None] * col
        disc = smooth(r - d, -0.002, 0.003)
        img = mix(img, (col * (0.8 if sun else 0.75))[None, None, :], (disc * (0.9 if sun else 0.85))[..., None])
        if sun:  # synthwave style slats cutting the lower half of the sun
            slat = (np.sin((V - cy) * 260) > -0.2 + (V - cy) * 9)
            cut = disc * ((V > cy) & slat)
            img = mix(img, glow[None, None, :] * 0.9, cut[..., None] * 0.9)
    layers = 6
    fog = glow * 0.9
    for i in range(layers):
        k = i / (layers - 1)
        base = hz - 0.13 + k * 0.30
        amp = 0.075 * (1 - 0.3 * k)
        prof = ridge_profile(rng, base, amp, 7, 0.52 - 0.04 * k, 1.0 + 0.7 * k)
        # sharpen ridges a bit
        prof = base + (prof - base) * 1.0
        edge = prof * H
        mask = smooth(YY, edge[None, :] - 1.2, edge[None, :] + 1.2)
        tint = mix(hues[i % len(hues)], hues[(i + 1) % len(hues)], 0.5)
        col_far = mix(fog, tint * 0.50 + bg * 0.2, 0.40)
        col_near = bg * 0.30 + tint * 0.04
        lc = mix(col_far, col_near, k ** 0.85)
        # vertical gradient inside the layer: lighter at the ridge, melting into fog below
        grad = smooth(YY - edge[None, :], 0, 0.22 * H)[..., None]
        layer = mix(lc * 1.05, mix(lc, fog, 0.35 * (1 - k)), grad)
        img = mix(img, layer, mask[..., None])
    return img


def dunes(bg, hues, fg, rng, sun=False):
    img = np.empty((H, W, 3), np.float32)
    hz = 0.44
    top = bg * 0.45
    glow = mix(hues[0], hues[2], 0.5) * 0.34 + bg * 0.30
    img[:] = mix(top, glow, (smooth(V, 0, hz) ** 1.8)[..., None])
    if sun:
        cx = rng.uniform(0.3, 0.7)
        d = np.sqrt(((U - cx) * W / H) ** 2 + (V - hz + 0.02) ** 2)
        img += (np.exp(-(d / 0.20) ** 2) * 0.32)[..., None] * hues[0]
        disc = smooth(0.05 - d, -0.003, 0.004)
        img = mix(img, (hues[0] * 0.85)[None, None, :], (disc * 0.8)[..., None])
    n = 7
    for i in range(n):
        k = i / (n - 1)
        base = hz + 0.03 + k * 0.40
        x = U[0]
        y = np.zeros(W, np.float32)
        for f, a in ((0.55, 1.0), (1.3, 0.55), (2.9, 0.25)):
            y += a * np.cos(2 * np.pi * (f * x + rng.random()) + rng.random() * 6.28)
        y = base + (0.05 + 0.07 * k) * y / 1.8
        edge = y * H
        mask = smooth(YY, edge[None, :] - 1.5, edge[None, :] + 1.5)
        tint = mix(hues[i % 3], hues[(i + 1) % 3], 0.5)
        lc = mix(glow * 1.0, bg * 0.34 + tint * 0.07, k ** 0.6)
        # lit crest fading into a shaded lee side
        shade = smooth(YY - edge[None, :], 0, 0.13 * H)[..., None]
        layer = mix(lc * 1.22, lc * 0.62, shade)
        img = mix(img, layer, mask[..., None])
    return img


def topo(bg, hues, fg, rng):
    img = base_gradient(bg, hues, rng)
    field = fbm(rng, 760, 6, gain=0.5)
    field = (field - 0.5) * 2.2
    gy, gx = np.gradient(field)
    gm = np.sqrt(gx * gx + gy * gy) + 1e-6
    N = 17
    t = field * N
    fr = np.abs(t - np.round(t))                  # distance (in line units) to the nearest contour
    pxw = 1.35                                      # line half-width in px
    dist = fr / (gm * N)                            # approx distance in px
    line = smooth(pxw + 0.7 - dist, 0, 1.4)
    major = (np.round(t).astype(int) % 5 == 0)
    amp = np.where(major, 0.50, 0.24)
    col = mix(hues[0], hues[1], U[..., None]) * (1 - V[..., None]) + hues[2] * V[..., None] * 0.9
    img += (line * amp)[..., None] * col
    # faint fill between levels for depth
    img += (smooth(field, -0.2, 1.0) * 0.08)[..., None] * hues[1]
    return img


STYLES = {"starfield": starfield, "aurora": aurora, "mountains": mountains, "dunes": dunes, "topo": topo}


def finalize(img, bg, rng):
    img = np.maximum(img, 0)
    # keep the middle calm: pull brightness down toward the centre, soft vignette at the edges
    w = np.exp(-(((U - .5) / .36) ** 2 + ((V - .5) / .40) ** 2))
    img = img * (1 - 0.32 * w)[..., None]
    vig = 1 - 0.22 * smooth(np.sqrt(((U - .5) * 1.1) ** 2 + (V - .5) ** 2), 0.45, 0.95)
    img = img * vig[..., None]
    # soft shoulder instead of hard clipping
    img = np.where(img > 0.75, 0.75 + 0.25 * (1 - np.exp(-(img - 0.75) / 0.25)), img)
    # grain / dither (kills banding in the dark gradients, survives jpeg)
    g = rng.normal(0, 1.0, (H, W, 1)).astype(np.float32) * 1.5 / 255 + rng.normal(0, 1.0, (H, W, 3)).astype(np.float32) * 0.6 / 255
    img = img + g
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


def main():
    home = sys.argv[1]
    want = sys.argv[2:]
    for theme, items in PLAN.items():
        for idx, style, seed, opt in items:
            tag = f"{theme}:{style}"
            if want and not any(w == theme or w == tag or w == f"{theme}:{idx}" for w in want):
                continue
            bg, hues, fg = palette(theme, home)
            rng = np.random.default_rng(seed)
            img = STYLES[style](bg, hues, fg, rng, **opt) if style in ("mountains", "dunes") else STYLES[style](bg, hues, fg, rng)
            out = finalize(img, bg, rng)
            d = os.path.join(home, "backgrounds", "extra", theme)
            os.makedirs(os.path.join(d, "thumbs"), exist_ok=True)
            name = f"{idx}-{style}.jpg"
            im = Image.fromarray(out)
            im.save(os.path.join(d, name), quality=93, subsampling=0, optimize=True)
            im.resize((320, 180), Image.LANCZOS).save(os.path.join(d, "thumbs", name), quality=88)
            print("wrote", theme, name, flush=True)


if __name__ == "__main__":
    main()
