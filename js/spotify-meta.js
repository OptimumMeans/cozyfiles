// spotify-meta.js — oEmbed metadata + artist from Spotify page OG tags.

export const RELEASE_STACK_URLS = [
  'https://open.spotify.com/album/40nFPtvaEvArMdzAPKiSMi',
  'https://open.spotify.com/album/7DtXmhJtxZZpGaxi25Xj8u',
  'https://open.spotify.com/track/7Md4z51zUCOzFLqqWTxnux',
  'https://open.spotify.com/track/1waSPgXEMxy2jzBuMREsgJ',
];

export function normalizeSpotifyUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

export function formatStackLabel(text) {
  const t = (text || '').trim().toLowerCase();
  if (!t) return '…';
  return t.endsWith('.') ? t : `${t}.`;
}

/** Title + embed from oEmbed; artist loaded separately (oEmbed has no artist field). */
export async function fetchSpotifyStackMeta(spotifyUrl) {
  const url = normalizeSpotifyUrl(spotifyUrl);
  const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;

  const res = await fetch(oembedUrl);
  if (!res.ok) throw new Error(`oEmbed ${res.status}`);
  const oembed = await res.json();

  return {
    title: oembed.title || '',
    thumbnailUrl: oembed.thumbnail_url || '',
    embedSrc: buildEmbedSrc(oembed.iframe_url),
    height: oembed.height || 152,
    loadArtist: () => fetchSpotifyArtist(url),
  };
}

function buildEmbedSrc(iframeUrl) {
  if (!iframeUrl) return '';
  const base = iframeUrl.split('?')[0];
  return `${base}?theme=0`;
}

const ARTIST_FETCH_TIMEOUT_MS = 8000;

async function fetchSpotifyArtist(url) {
  return Promise.race([
    fetchSpotifyArtistInner(url),
    new Promise((resolve) => { setTimeout(() => resolve(''), ARTIST_FETCH_TIMEOUT_MS); }),
  ]);
}

async function fetchSpotifyArtistInner(url) {
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = await res.json();
      const author = data?.data?.author;
      if (author) return author;
    }
  } catch { /* fall through */ }

  try {
    const html = await fetch(url).then((r) => (r.ok ? r.text() : ''));
    return parseArtistFromHtml(html);
  } catch {
    return '';
  }
}

function parseArtistFromHtml(html) {
  if (!html) return '';

  const ogDesc = html.match(/property="og:description"\s+content="([^"]*)"/)?.[1];
  if (ogDesc) {
    const artist = ogDesc.split('·').map((s) => s.trim())[0];
    if (artist && !/^album$/i.test(artist)) return artist;
  }

  const ogTitle = html.match(/property="og:title"\s+content="([^"]*)"/)?.[1];
  if (ogTitle) {
    const albumMatch = ogTitle.match(/Album by (.+?) \|/i);
    if (albumMatch) return albumMatch[1].trim();
  }

  return '';
}
