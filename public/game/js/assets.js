// Loads the sprite atlases cut from the artwork (game/art/extract.py) and
// prepares tinted copies used for hit flashes, telegraphs and the boss aura.

export async function loadAssets(root = './') {
  const res = await fetch(`${root}assets/sprites.json`);
  if (!res.ok) throw new Error(`Could not load sprites (${res.status})`);
  const manifest = await res.json();

  const sheets = {};
  await Promise.all(
    Object.entries(manifest.sheets).map(async ([name, sheet]) => {
      const img = await loadImage(`${root}${sheet.image}`);
      sheets[name] = {
        ...sheet,
        img,
        white: tint(img, '#ffffff'),
        red: tint(img, '#ff2a3a'),
        cyan: tint(img, '#7fe8ff')
      };
    })
  );
  const ground = await loadImage(`${root}${manifest.ground.image}`);
  return { sheets, ground: { ...manifest.ground, img: ground } };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** A same-size copy of `img` where every opaque pixel is `color`. */
function tint(img, color) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
