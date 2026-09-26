"""Slice the source sprite sheets into game-ready atlases.

Input:  game/art/source/*.webp|jpg  (the original artwork)
Output: public/game/assets/<name>.webp + public/game/assets/sprites.json

For every sheet we
  1. remove the background (JPGs: flood-fill the light backdrop from the
     edges only, so light pixels inside a sprite, like silver hair, survive),
  2. find each frame inside a hand-measured row band (connected components,
     fragments merged, labels and dividers excluded by the band),
  3. anchor every frame at its feet (bottom row, centre of the lower body),
  4. scale and shelf-pack the frames into one PNG atlas per sheet.

Usage: python3 game/art/extract.py [--debug]   (debug writes box previews)
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "game" / "art" / "source"
OUT = ROOT / "public" / "game" / "assets"
DEBUG_DIR = ROOT / "game" / "art" / "debug"

# Row bands are (x0, y0, x1, y1) in source pixels. `expect` is the number of
# frames the band should contain; the script fails loudly if it differs.
SHEETS = {
    "heroine": {
        "file": "heroine.webp",
        "scale": 1.0,
        "rows": {
            "idle": ((0, 34, 436, 124), 8),
            "walk": ((0, 150, 436, 240), 9),
            "run": ((0, 266, 436, 352), 8),
            "jump": ((0, 383, 436, 474), 4),
            "fall": ((0, 502, 436, 586), 6),
            "attack1": ((446, 34, 905, 124), 8),
            "attack2": ((446, 160, 905, 250), 8),
            "heavy": ((446, 286, 905, 380), 9, [499, 533, 573, 633, 678, 723, 765, 836]),
            "hurt": ((446, 414, 720, 494), 4),
            "death": ((446, 522, 832, 604), 7, [495, 544, 592, 648, 713, 782]),
        },
    },
    "knight": {
        "file": "dark-knight.jpg",
        "scale": 0.58,
        # No white anywhere in this design: clear every enclosed backdrop pocket.
        "hole_min": 12,
        "rows": {
            "row1": ((0, 60, 1024, 350), 5),
            "row2": ((0, 375, 1024, 655), 5),
            "row3": ((0, 670, 1024, 960), 5),
        },
    },
    "rogue": {
        "file": "frost-rogue.jpg",
        "scale": 0.52,
        "facing": -1,  # drawn facing left
        "rows": {
            "row1": ((0, 60, 1024, 320), 7),
            "row2": ((0, 355, 1024, 640), 7),
            "row3": ((0, 685, 1024, 965), 7),
        },
    },
    # The Main Boss. Each band starts just above the frame-number labels;
    # `label_h` drops small detached pieces (the digits) in that strip.
    "warlord": {
        "file": "warlord.jpg",
        "scale": 0.9,
        "label_h": 38,
        "hole_min": 12,  # no white in the design: clear enclosed backdrop pockets
        "erase": [(0, 390, 416, 416)],
        "anchor": "body",  # the "ROW 3: HEAVY ATTACK" title touches the band
        "rows": {
            "idle": ((0, 26, 1408, 192), 6),
            "walk": ((0, 219, 1408, 385), 8),
            "heavy": ((0, 402, 1408, 582), 10),
            # Titled "12 frames" but only 10 are drawn (labels skip 4 and 10).
            "death": ((0, 604, 1408, 764), 10),
        },
    },
    "fx": {
        "file": "heroine.webp",
        "scale": 1.0,
        "rows": {"crescent": ((70, 622, 172, 720), 2, [128])},
    },
    "trap": {
        "file": "spike-trap.webp",
        "scale": 0.46,
        "rows": {
            "idle": ((0, 60, 1536, 215), 4),
            "charge": ((0, 260, 1536, 440), 4),
            "rise": ((0, 460, 1536, 675), 6),
            "full": ((0, 695, 1536, 860), 2),
            "retract": ((0, 862, 1536, 1020), 7),
        },
    },
}

# Named animations built from (row, frame index) references.
ANIMATIONS = {
    "heroine": {name: [(name, i) for i in range(spec[1])] for name, spec in SHEETS["heroine"]["rows"].items()},
    "knight": {
        "idle": [("row1", 0), ("row1", 1), ("row2", 0), ("row2", 1), ("row3", 0), ("row3", 1)],
        "slash": [("row1", 2), ("row1", 3), ("row1", 4)],
        "overhead": [("row2", 2), ("row2", 3), ("row2", 4)],
        "lunge": [("row3", 2), ("row3", 3), ("row3", 4)],
    },
    "rogue": {
        "walk": [("row1", i) for i in range(7)],
        "idle": [("row3", 0), ("row3", 1), ("row3", 3), ("row3", 5)],
        "throw": [("row2", i) for i in range(5)],
        "recover": [("row2", 5), ("row2", 6)],
        "run": [("row3", i) for i in range(7)],
    },
    "trap": {name: [(name, i) for i in range(spec[1])] for name, spec in SHEETS["trap"]["rows"].items()},
    "warlord": {name: [(name, i) for i in range(spec[1])] for name, spec in SHEETS["warlord"]["rows"].items()},
    "fx": {"crescent": [("crescent", 0), ("crescent", 1)]},
}


def load_rgba(path, hole_min=600):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.int16).copy()
    if path.suffix.lower() != ".jpg":
        return a
    # Backdrop colour = median of the border pixels.
    border = np.concatenate([a[0, :, :3], a[-1, :, :3], a[:, 0, :3], a[:, -1, :3]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a[:, :, :3] - bg) ** 2).sum(axis=2))
    near = dist < 22
    labels, count = ndimage.label(near)
    touching = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    sizes = ndimage.sum(near, labels, index=np.arange(1, count + 1))
    background = np.zeros_like(near)
    for idx in range(1, count + 1):
        if idx in touching or sizes[idx - 1] > hole_min:
            background |= labels == idx
    alpha = np.where(background, 0, 255).astype(np.int16)
    # Soften the 1px fringe of light JPEG halo around every sprite.
    fringe = ndimage.binary_dilation(background) & ~background & (dist < 60)
    alpha[fringe] = np.clip((dist[fringe] - 22) / 38 * 255, 0, 255)
    a[:, :, 3] = alpha
    return a


def find_frames(rgba, band, expect, name, cuts=None, label_h=0):
    """Split a row band into `expect` frames.

    Cut columns are the emptiest columns near evenly spaced positions (or
    hand-picked `cuts`). Each connected piece (body, slash arc, hair strand)
    then goes wholly to the frame holding most of its pixels, so effects that
    cross a cut stay with their owner.
    """
    x0, y0, x1, y1 = band
    region = rgba[y0:y1, x0:x1]
    solid = region[:, :, 3] > 40
    profile = np.convolve(solid.sum(axis=0), np.ones(3) / 3, mode="same")
    cols = np.where(profile > 0.5)[0]
    left, right = int(cols.min()), int(cols.max()) + 1
    if cuts is None:
        spacing = (right - left) / expect
        cuts = []
        for k in range(1, expect):
            ideal = left + k * spacing
            lo, hi = int(ideal - 0.42 * spacing), int(ideal + 0.42 * spacing)
            cuts.append(min(range(lo, hi), key=lambda x: (round(profile[x]), abs(x - ideal))))
    else:
        cuts = [c - x0 for c in cuts]

    labels, count = ndimage.label(solid, structure=np.ones((3, 3)))
    owner = np.full(solid.shape, -1, dtype=np.int16)
    for idx, sl in enumerate(ndimage.find_objects(labels), start=1):
        if sl is None:
            continue
        piece = labels[sl] == idx
        ys, xs = np.nonzero(piece)
        if len(xs) < 8:
            continue
        if label_h and sl[0].stop <= label_h and len(xs) < 600:
            continue  # a frame-number label, not part of the sprite
        xs_abs = xs + sl[1].start
        seg = np.searchsorted(cuts, xs_abs, side="right")
        counts = np.bincount(seg, minlength=expect)
        if counts.max() >= 0.8 * len(xs):
            seg = np.full_like(seg, counts.argmax())
        owner[ys + sl[0].start, xs_abs] = seg

    frames = []
    for i in range(expect):
        mask = owner == i
        if mask.sum() < 150:
            raise SystemExit(f"{name}: frame {i} is empty; adjust the band or cuts")
        ys, xs = np.nonzero(mask)
        bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        frames.append(((bx0 + x0, by0 + y0, bx1 + x0, by1 + y0), mask[by0:by1, bx0:bx1]))
    return frames, [c + x0 for c in cuts]


def crop_frame(rgba, box, mask, scale, anchor="feet"):
    x0, y0, x1, y1 = box
    crop = rgba[y0:y1, x0:x1].astype(np.uint8).copy()
    crop[:, :, 3] = np.where(mask, crop[:, :, 3], 0)
    img = Image.fromarray(crop, "RGBA")
    solid = crop[:, :, 3] > 40
    rows = np.where(solid.any(axis=1))[0]
    bottom = rows.max() + 1
    # Horizontal anchor: centre of mass of the lowest 35% of the body.
    lower = solid[int(bottom - 0.35 * (bottom - rows.min())):bottom]
    cols = np.where(lower.any(axis=0))[0]
    weights = lower.sum(axis=0)[cols]
    ax = float((cols * weights).sum() / weights.sum()) if weights.sum() else crop.shape[1] / 2
    if anchor == "body":
        # Big weapons reach down to the feet; the torso is the densest column.
        density = np.convolve(solid.sum(axis=0), np.ones(31) / 31, mode="same")
        ax = float(np.argmax(density))
    if scale != 1:
        w = max(1, round(img.width * scale))
        h = max(1, round(img.height * scale))
        img = img.resize((w, h), Image.LANCZOS)
    return img, ax * scale, bottom * scale


def pack(frames, padding=2, max_width=1024):
    x = y = shelf = 0
    positions = []
    for img in frames:
        if x + img.width + padding > max_width:
            x = 0
            y += shelf + padding
            shelf = 0
        positions.append((x, y))
        x += img.width + padding
        shelf = max(shelf, img.height)
    atlas = Image.new("RGBA", (max_width, y + shelf), (0, 0, 0, 0))
    for img, (px, py) in zip(frames, positions):
        atlas.paste(img, (px, py))
    # Trim unused width.
    bbox = atlas.getbbox()
    if bbox:
        atlas = atlas.crop((0, 0, bbox[2], atlas.height))
    return atlas, positions


def build_ground(debug):
    im = load_rgba(SRC / "ground.jpg")
    strip = im[400:670]
    rows = np.where((strip[:, :, 3] > 40).any(axis=1))[0]
    strip = strip[rows.min() : rows.max() + 1]
    img = Image.fromarray(strip.astype(np.uint8), "RGBA")
    # Make it tile horizontally: cross-fade the right edge into the left.
    arr = np.asarray(img).astype(np.float32)
    blend = 96
    w = arr.shape[1] - blend
    out = arr[:, :w].copy()
    ramp = np.linspace(0, 1, blend, dtype=np.float32)[None, :, None]
    out[:, :blend] = arr[:, w:] * (1 - ramp) + arr[:, :blend] * ramp
    tile = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
    tile = tile.resize((round(tile.width * 0.5), round(tile.height * 0.5)), Image.LANCZOS)
    tile.save(OUT / "ground.webp", quality=90, method=6)
    # Where the walkable stone surface starts (first mostly-opaque row).
    opaque_rows = (np.asarray(tile)[:, :, 3] > 200).mean(axis=1)
    surface = int(np.argmax(opaque_rows > 0.5))
    return {"image": "assets/ground.webp", "width": tile.width, "height": tile.height, "surface": surface}


def main():
    debug = "--debug" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    if debug:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"sheets": {}, "ground": None}

    for sheet_name, spec in SHEETS.items():
        rgba = load_rgba(SRC / spec["file"], spec.get("hole_min", 600))
        for ex0, ey0, ex1, ey1 in spec.get("erase", []):
            rgba[ey0:ey1, ex0:ex1, 3] = 0
        frames_by_row = {}
        preview = Image.fromarray(rgba.astype(np.uint8), "RGBA") if debug else None
        draw = ImageDraw.Draw(preview) if debug else None
        for row, row_spec in spec["rows"].items():
            band, expect = row_spec[0], row_spec[1]
            cuts = row_spec[2] if len(row_spec) > 2 else None
            found, used_cuts = find_frames(rgba, band, expect, f"{sheet_name}.{row}", cuts, spec.get("label_h", 0))
            frames_by_row[row] = [crop_frame(rgba, box, mask, spec["scale"], spec.get("anchor", "feet")) for box, mask in found]
            if debug:
                draw.rectangle(band, outline=(0, 128, 255, 255))
                for c in used_cuts:
                    draw.line([(c, band[1]), (c, band[3])], fill=(255, 220, 0, 255))
                for box, _ in found:
                    draw.rectangle(box, outline=(255, 0, 255, 255))
        if debug:
            bg = Image.new("RGBA", preview.size, (40, 160, 90, 255))
            Image.alpha_composite(bg, preview).save(DEBUG_DIR / f"{sheet_name}-boxes.png")

        ordered = []
        refs = {}
        for anim, parts in ANIMATIONS[sheet_name].items():
            refs[anim] = []
            for row, index in parts:
                key = (row, index)
                if key not in [k for k, _ in ordered]:
                    ordered.append((key, frames_by_row[row][index]))
                refs[anim].append([k for k, _ in ordered].index(key))
        atlas, positions = pack([f[0] for _, f in ordered])
        atlas.save(OUT / f"{sheet_name}.webp", quality=92, method=6)
        frame_meta = [
            {"x": px, "y": py, "w": img.width, "h": img.height, "ax": round(ax, 1), "ay": round(ay, 1)}
            for ((_, (img, ax, ay)), (px, py)) in zip(ordered, positions)
        ]
        manifest["sheets"][sheet_name] = {
            "image": f"assets/{sheet_name}.webp",
            "facing": spec.get("facing", 1),
            "frames": frame_meta,
            "animations": refs,
        }
        print(f"{sheet_name}: {len(frame_meta)} frames, atlas {atlas.width}x{atlas.height}")

    manifest["ground"] = build_ground(debug)
    (OUT / "sprites.json").write_text(json.dumps(manifest, separators=(",", ":")))
    print("ground:", manifest["ground"])


if __name__ == "__main__":
    main()
