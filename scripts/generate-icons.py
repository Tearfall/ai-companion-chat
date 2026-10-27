"""One-off icon generator for the Companion Chat PWA.

Run manually once (not part of npm install/start):
    python scripts/generate-icons.py

Draws a solid-color square (so OS icon masks can crop it to any shape) with a
simple white heart glyph centered in the maskable "safe zone" (the inner 80%
of the canvas), and saves 192x192 / 512x512 PNGs into public/icons/.
"""

import os
from PIL import Image, ImageDraw

PRIMARY = (219, 39, 119)  # matches --primary in style.css
WHITE = (255, 255, 255)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")


def draw_heart(draw, cx, cy, half_width):
    lobe_r = half_width / 2

    left_box = (cx - half_width, cy - lobe_r, cx, cy + lobe_r)
    right_box = (cx, cy - lobe_r, cx + half_width, cy + lobe_r)
    draw.ellipse(left_box, fill=WHITE)
    draw.ellipse(right_box, fill=WHITE)

    triangle = [
        (cx - half_width, cy),
        (cx + half_width, cy),
        (cx, cy + half_width * 2.1),
    ]
    draw.polygon(triangle, fill=WHITE)


def make_icon(size, out_path):
    img = Image.new("RGB", (size, size), PRIMARY)
    draw = ImageDraw.Draw(img)

    cx, cy = size / 2, size / 2 * 0.92  # nudge up slightly for the heart's visual weight
    half_width = size * 0.34 / 2  # heart spans ~34% of canvas width, well inside the 80% safe zone

    draw_heart(draw, cx, cy, half_width)
    img.save(out_path, "PNG")
    print(f"wrote {out_path}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    make_icon(192, os.path.join(OUT_DIR, "icon-192.png"))
    make_icon(512, os.path.join(OUT_DIR, "icon-512.png"))


if __name__ == "__main__":
    main()
