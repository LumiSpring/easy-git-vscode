"""Easy Git icon: circular glass badge, transparent outside, 128x128 RGBA."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "resources" / "icon.png"
SIZE = 1024
FINAL = 128
CX = CY = SIZE / 2
RADIUS = SIZE / 2 - 108


def lerp(a: tuple[float, ...], b: tuple[float, ...], t: float) -> tuple[float, ...]:
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def sphere() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    px = img.load()
    lx, ly, lz = -0.52, -0.62, 0.58
    llen = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / llen, ly / llen, lz / llen
    deep = (12.0, 74.0, 148.0)
    mid = (42.0, 158.0, 224.0)
    hi = (186.0, 232.0, 255.0)
    rim = (210.0, 240.0, 255.0)
    spec = (255.0, 255.0, 255.0)
    aa = 2.2

    for y in range(SIZE):
        dy = y + 0.5 - CY
        for x in range(SIZE):
            dx = x + 0.5 - CX
            dist = math.hypot(dx, dy)
            if dist > RADIUS + aa:
                continue
            cover = 1.0 if dist <= RADIUS else max(0.0, 1.0 - (dist - RADIUS) / aa)
            if cover <= 0:
                continue
            inner = min(dist, RADIUS)
            z = math.sqrt(max(0.0, RADIUS * RADIUS - inner * inner))
            nx, ny, nz = dx / RADIUS, dy / RADIUS, z / RADIUS
            ndotl = max(0.0, nx * lx + ny * ly + nz * lz)
            hx, hy, hz = lx, ly, lz + 1.0
            hl = math.sqrt(hx * hx + hy * hy + hz * hz)
            spec_t = max(0.0, (nx * hx + ny * hy + nz * hz) / hl) ** 56
            spec2 = max(0.0, (nx * hx + ny * hy + nz * hz) / hl) ** 12
            fresnel = (1.0 - max(0.0, nz)) ** 2.0

            col = lerp(deep, mid, ndotl * 0.9 + 0.1)
            col = lerp(col, hi, ndotl ** 2 * 0.55)
            col = lerp(col, spec, min(1.0, spec2 * 0.28 + spec_t * 1.35))
            col = lerp(col, rim, fresnel * 0.5)
            px[x, y] = (int(col[0]), int(col[1]), int(col[2]), int(255 * cover))
    return img


def capsule(draw: ImageDraw.ImageDraw, a: tuple[float, float], b: tuple[float, float], width: float, fill) -> None:
    draw.line((a, b), fill=fill, width=int(width))
    r = width / 2
    for x, y in (a, b):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def disc(draw: ImageDraw.ImageDraw, c: tuple[float, float], r: float, fill) -> None:
    x, y = c
    draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def mark() -> Image.Image:
    """Three-node merge: two histories join into HEAD. Original, not GitLens' side-branch."""
    g = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    white = (255, 255, 255, 255)
    w = 60
    nr = 48
    left, right, head = (400, 356), (624, 356), (512, 700)
    join = (512, 536)
    capsule(d, left, join, w, white)
    capsule(d, right, join, w, white)
    capsule(d, join, head, w, white)
    disc(d, left, nr, white)
    disc(d, right, nr, white)
    disc(d, head, nr + 4, white)
    disc(d, (head[0] - 12, head[1] - 14), 14, (255, 255, 255, 80))
    return g


def glass_streak(base: Image.Image) -> Image.Image:
    streak = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(streak)
    d.ellipse((40, -80, 680, 400), fill=180)
    streak = streak.filter(ImageFilter.GaussianBlur(48))
    overlay = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    overlay.putalpha(streak.point(lambda p: int(p * 0.72)))
    # Keep streak inside the orb.
    overlay.putalpha(ImageChops.multiply(overlay.split()[-1], base.split()[-1]))
    return Image.alpha_composite(base, overlay)


def lift(glyph: Image.Image) -> Image.Image:
    alpha = glyph.split()[-1].point(lambda p: int(p * 0.34))
    sh = Image.new("RGBA", glyph.size, (8, 48, 96, 0))
    sh.putalpha(alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(18))
    out = Image.new("RGBA", glyph.size, (0, 0, 0, 0))
    out.paste(sh, (0, 16), sh)
    return Image.alpha_composite(out, glyph)


def clip_to_orb(layer: Image.Image, orb: Image.Image) -> Image.Image:
    out = layer.copy()
    out.putalpha(ImageChops.multiply(layer.split()[-1], orb.split()[-1]))
    return out


def main() -> None:
    orb = glass_streak(sphere())
    glyph = clip_to_orb(lift(mark()), orb)
    composed = Image.alpha_composite(orb, glyph)
    out = composed.resize((FINAL, FINAL), Image.Resampling.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT, "PNG")
    print(f"wrote {OUT} ({out.size[0]}x{out.size[1]} {out.mode})")


if __name__ == "__main__":
    main()
