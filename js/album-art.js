// album-art.js — sample Spotify artwork for muted row accent tints.

const FALLBACK_TINT = '#454a52';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      default: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** Desaturate and darken an average RGB to fit session lane tints. */
export function muteArtworkRgb(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  const mutedS = Math.min(0.32, s * 0.38 + 0.08);
  const mutedL = Math.min(0.38, Math.max(0.22, l * 0.55 + 0.06));
  const out = hslToRgb(h, mutedS, mutedL);
  return `rgb(${out.r}, ${out.g}, ${out.b})`;
}

/** Sample dominant/average color from artwork URL; returns CSS color string. */
export async function sampleArtworkTint(imageUrl) {
  if (!imageUrl) return FALLBACK_TINT;
  try {
    const img = await loadImage(imageUrl);
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
    if (!n) return FALLBACK_TINT;
    return muteArtworkRgb(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  } catch {
    return FALLBACK_TINT;
  }
}

export { FALLBACK_TINT };
