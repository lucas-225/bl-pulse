const redirectCache = new Map<string, string>();

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*\((?:TH|JP|KR|TW|CN|PH|US|UK|FR|NO|SE|Season[^)]*|Uncut[^)]*)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function searchWebForUrls(query: string, domainRegex: RegExp): Promise<string[]> {
  try {
    const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const matches: string[] = [];
    const seen = new Set<string>();

    for (const m of html.matchAll(/RU=([^/&"]+)/g)) {
      try {
        const decoded = decodeURIComponent(m[1]);
        if (
          decoded.startsWith('https://') &&
          !decoded.includes('yahoo.com') &&
          !decoded.includes('themoviedb.org') &&
          !decoded.includes('justwatch.com') &&
          domainRegex.test(decoded) &&
          !seen.has(decoded)
        ) {
          seen.add(decoded);
          matches.push(decoded);
        }
      } catch {
        // Ignore malformed URI
      }
    }
    return matches;
  } catch {
    return [];
  }
}

function parseYouTubeCandidates(html: string): Array<{ id: string; videoTitle: string }> {
  const chunks = html.split('"videoRenderer":{"videoId":"').slice(1);
  const candidates: Array<{ id: string; videoTitle: string }> = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const id = chunk.slice(0, 11);
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id) || seen.has(id)) continue;
    seen.add(id);

    const windowText = chunk.slice(0, 1600);
    const runsMatch = windowText.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/);
    const simpleMatch = windowText.match(/"title":\{[^{}]*"simpleText":"((?:\\.|[^"\\])*)"/);
    const rawTitle = runsMatch?.[1] ?? simpleMatch?.[1] ?? '';
    const videoTitle = rawTitle.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
    candidates.push({ id, videoTitle });
    if (candidates.length >= 16) break;
  }
  return candidates;
}

async function resolveYouTubeEpisodeUrl(title: string, season: number, episode: number, kind: string): Promise<string> {
  const seasonPart = season > 1 ? ` Season ${season}` : '';
  // For live-action series (GMMTV, Mandee, Wabi Sabi, IdolFactory, etc.), query EP.X [1/4] Eng Sub first so 4-part uploads resolve directly to Part [1/4]
  const primaryQuery =
    kind === 'series'
      ? `${title}${seasonPart} EP.${episode} [1/4] Eng Sub`
      : kind === 'manga'
        ? `${title}${seasonPart} Chapter ${episode}`
        : `${title}${seasonPart} Episode ${episode} Eng Sub`;

  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(primaryQuery)}`;

  try {
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const html = await res.text();
      const candidates = parseYouTubeCandidates(html);

      if (candidates.length > 0) {
        const titleWords = title
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 3);

        const epExactRegex = new RegExp(`(?:ep(?:isode)?\\.?\\s*0*${episode}\\b|#0*${episode}\\b|\\b0*${episode}\\b)`, 'i');
        const part1Regex = /\[\s*1\s*\/\s*4\s*\]|\bpart\s*1\b|\b1\/4\b/i;
        const otherPartRegex = /\[\s*[234]\s*\/\s*4\s*\]|\b[234]\/4\b/i;

        let best = candidates[0];
        let bestScore = -999;

        for (let idx = 0; idx < candidates.length; idx++) {
          const c = candidates[idx];
          const vt = c.videoTitle.toLowerCase();
          let score = 20 - idx; // Prefer higher-ranked YouTube results

          const matchedWords = titleWords.filter((w) => vt.includes(w)).length;
          if (titleWords.length > 0 && matchedWords > 0) {
            score += matchedWords * 15;
          } else if (titleWords.length > 0) {
            score -= 20;
          }

          if (epExactRegex.test(vt)) {
            score += 35;
          }
          if (part1Regex.test(vt)) {
            score += 25;
          }
          if (otherPartRegex.test(vt)) {
            score -= 40; // Never pick [2/4], [3/4], or [4/4] over [1/4]
          }
          if (/\b(?:trailer|teaser|reaction|ost|mv|shorts)\b/i.test(vt)) {
            score -= 25;
          }

          if (score > bestScore) {
            bestScore = score;
            best = c;
          }
        }

        return `https://www.youtube.com/watch?v=${best.id}`;
      }
    }
  } catch {
    // Ignore and try Yahoo fallback for YouTube watch link
  }

  // Fallback: resolve direct YouTube watch?v= link via web index so we still open a playing video instead of the search bar
  const webYt = await searchWebForUrls(
    `site:youtube.com/watch "${title}" "EP.${episode}"`,
    /youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/i,
  );
  if (webYt[0]) return webYt[0];

  return searchUrl;
}

async function resolveMangaDexChapterUrl(
  title: string,
  chapter: number,
  baseUrl?: string,
): Promise<string> {
  try {
    let mangaId: string | null = null;
    const titleMatch = baseUrl?.match(/mangadex\.org\/title\/([0-9a-f-]{36})/i);
    if (titleMatch) {
      mangaId = titleMatch[1];
    } else {
      const searchRes = await fetch(
        `https://api.mangadex.org/manga?title=${encodeURIComponent(title)}&limit=5`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (searchRes.ok) {
        const data = (await searchRes.json()) as { data?: Array<{ id: string }> };
        mangaId = data.data?.[0]?.id ?? null;
      }
    }

    if (mangaId) {
      // 1. Try exact chapter number in English
      const enFeedRes = await fetch(
        `https://api.mangadex.org/manga/${mangaId}/feed?chapter=${encodeURIComponent(String(chapter))}&translatedLanguage[]=en&order[volume]=asc&limit=5`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (enFeedRes.ok) {
        const enData = (await enFeedRes.json()) as { data?: Array<{ id: string }> };
        if (enData.data?.[0]?.id) {
          return `https://mangadex.org/chapter/${enData.data[0].id}`;
        }
      }

      // 2. Try exact chapter number in any translated language
      const anyFeedRes = await fetch(
        `https://api.mangadex.org/manga/${mangaId}/feed?chapter=${encodeURIComponent(String(chapter))}&order[volume]=asc&limit=5`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (anyFeedRes.ok) {
        const anyData = (await anyFeedRes.json()) as { data?: Array<{ id: string }> };
        if (anyData.data?.[0]?.id) {
          return `https://mangadex.org/chapter/${anyData.data[0].id}`;
        }
      }

      // 3. Try Nth chapter in ascending order
      const offset = Math.max(0, chapter - 1);
      const nthRes = await fetch(
        `https://api.mangadex.org/manga/${mangaId}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=1&offset=${offset}`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (nthRes.ok) {
        const nthData = (await nthRes.json()) as { data?: Array<{ id: string }> };
        if (nthData.data?.[0]?.id) {
          return `https://mangadex.org/chapter/${nthData.data[0].id}`;
        }
      }

      return `https://mangadex.org/title/${mangaId}`;
    }
  } catch {
    // Ignore errors
  }
  return `https://mangadex.org/titles?q=${encodeURIComponent(title)}`;
}

export async function resolvePlatformRedirect(params: {
  platform: string;
  title: string;
  episode: number;
  season?: number;
  seasonTitle?: string;
  kind?: 'series' | 'anime' | 'manga';
  baseUrl?: string;
  directUrl?: string;
}): Promise<string> {
  const platformLower = params.platform.trim().toLowerCase();
  const season = params.season && params.season > 0 ? params.season : 1;
  const episode = params.episode && params.episode > 0 ? params.episode : 1;
  const kind = params.kind ?? 'series';
  const effectiveTitle = cleanTitle(params.seasonTitle || params.title);
  const titleSlug = slugify(effectiveTitle);

  const cacheKey = `${platformLower}|${effectiveTitle}|S${season}|E${episode}|${kind}`;
  const cached = redirectCache.get(cacheKey);
  if (cached) return cached;

  // Never allow TMDB or JustWatch URLs as direct or base URLs
  const cleanDirectUrl =
    params.directUrl && !/themoviedb\.org|justwatch\.com/i.test(params.directUrl)
      ? params.directUrl
      : undefined;
  const cleanBaseUrl =
    params.baseUrl && !/themoviedb\.org|justwatch\.com|\/categories\//i.test(params.baseUrl)
      ? params.baseUrl
      : undefined;

  if (cleanDirectUrl) {
    redirectCache.set(cacheKey, cleanDirectUrl);
    return cleanDirectUrl;
  }

  let resolvedUrl = '';

  // 1. YouTube
  if (platformLower.includes('youtube')) {
    resolvedUrl = await resolveYouTubeEpisodeUrl(effectiveTitle, season, episode, kind);
  }
  // 2. MangaDex
  else if (platformLower.includes('mangadex')) {
    resolvedUrl = await resolveMangaDexChapterUrl(effectiveTitle, episode, cleanBaseUrl);
  }
  // 3. Viki
  else if (platformLower.includes('viki')) {
    const epUrls = await searchWebForUrls(
      `site:viki.com/videos "${effectiveTitle}" "Episode ${episode}"`,
      /viki\.com\/videos\//i,
    );
    const exactEp =
      epUrls.find((u) => new RegExp(`episode-${episode}\\b`, 'i').test(u) && u.toLowerCase().includes(titleSlug.split('-')[0] ?? '')) ??
      epUrls.find((u) => new RegExp(`episode-${episode}\\b`, 'i').test(u));

    if (exactEp) {
      resolvedUrl = exactEp.split('?')[0];
    } else {
      const tvUrls = await searchWebForUrls(`site:viki.com/tv "${effectiveTitle}"`, /viki\.com\/tv\/\d+c/i);
      const matchingTv = tvUrls.find((u) => u.toLowerCase().includes(titleSlug.split('-')[0] ?? '')) ?? tvUrls[0];
      resolvedUrl = matchingTv ? `${matchingTv.split('?')[0]}#episodes` : `https://www.viki.com/search?q=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 4. iQIYI
  else if (platformLower.includes('iqiyi') || platformLower === 'iq.com') {
    const playUrls = await searchWebForUrls(
      `site:iq.com/play "${effectiveTitle}" "Episode ${episode}"`,
      /iq\.com\/play\//i,
    );
    const matchingPlay =
      playUrls.find((u) => new RegExp(`(?:episode|ep|tap)-0*${episode}\\b`, 'i').test(u) && /lang=en_us/i.test(u)) ??
      playUrls.find((u) => new RegExp(`(?:episode|ep|tap)-0*${episode}\\b`, 'i').test(u)) ??
      playUrls[0];

    if (matchingPlay) {
      const urlObj = new URL(matchingPlay);
      urlObj.searchParams.set('lang', 'en_us');
      resolvedUrl = urlObj.toString();
    } else {
      const albumUrls = await searchWebForUrls(`site:iq.com/album "${effectiveTitle}"`, /iq\.com\/album\//i);
      resolvedUrl = albumUrls[0] ?? `https://www.iq.com/search?query=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 5. GagaOOLala
  else if (platformLower.includes('gagaoolala')) {
    const gagaUrls = await searchWebForUrls(
      `site:gagaoolala.com/en/videos "${effectiveTitle}"`,
      /gagaoolala\.com\/en\/videos\/\d+\/[a-z0-9-]+/i,
    );
    const match = gagaUrls.find((u) => u.toLowerCase().includes(titleSlug.split('-')[0] ?? '')) ?? gagaUrls[0];
    if (match) {
      const baseVideoUrl = match.split('?')[0].replace(/-e\d+$/i, '');
      resolvedUrl = `${baseVideoUrl}-e${String(episode).padStart(2, '0')}`;
    } else {
      resolvedUrl = `https://www.gagaoolala.com/en/search?q=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 6. WeTV
  else if (platformLower.includes('wetv')) {
    const wetvUrls = await searchWebForUrls(
      `site:wetv.vip/en/play "${effectiveTitle}" "EP${episode}"`,
      /wetv\.vip\/en\/play\//i,
    );
    const match =
      wetvUrls.find((u) => new RegExp(`EP0*${episode}\\b`, 'i').test(u) && !/teaser|trailer|clip/i.test(u)) ??
      wetvUrls[0];
    resolvedUrl = match ?? `https://wetv.vip/en/search/${encodeURIComponent(effectiveTitle)}`;
  }
  // 7. Crunchyroll
  else if (platformLower.includes('crunchyroll')) {
    const watchUrls = await searchWebForUrls(
      `site:crunchyroll.com/watch "${effectiveTitle}" "Episode ${episode}"`,
      /crunchyroll\.com\/watch\/[A-Z0-9]+/i,
    );
    if (watchUrls[0]) {
      resolvedUrl = watchUrls[0];
    } else if (cleanBaseUrl && /crunchyroll\.com\/series\//i.test(cleanBaseUrl)) {
      resolvedUrl = cleanBaseUrl;
    } else {
      const seriesUrls = await searchWebForUrls(`site:crunchyroll.com/series "${effectiveTitle}"`, /crunchyroll\.com\/series\//i);
      resolvedUrl = seriesUrls[0] ?? `https://www.crunchyroll.com/search?q=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 8. Netflix
  else if (platformLower.includes('netflix')) {
    if (cleanBaseUrl && /netflix\.com\/title\/\d+/i.test(cleanBaseUrl)) {
      resolvedUrl = cleanBaseUrl;
    } else {
      const nfUrls = await searchWebForUrls(`site:netflix.com/title "${effectiveTitle}"`, /netflix\.com\/(?:[a-z-]+\/)?title\/\d+/i);
      resolvedUrl = nfUrls[0] ?? `https://www.netflix.com/search?q=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 9. Bilibili
  else if (platformLower.includes('bilibili')) {
    const biliUrls = await searchWebForUrls(
      `site:bilibili.tv/en/play "${effectiveTitle}"`,
      /bilibili\.tv\/en\/play\/\d+/i,
    );
    resolvedUrl = biliUrls[0] ?? `https://www.bilibili.tv/en/search-result?q=${encodeURIComponent(`${effectiveTitle} Episode ${episode}`)}`;
  }
  // 10. Lezhin
  else if (platformLower.includes('lezhin')) {
    const comicMatch = cleanBaseUrl?.match(/lezhinus\.com\/en\/comic\/([a-z0-9_-]+)/i);
    if (comicMatch) {
      resolvedUrl = `https://www.lezhinus.com/en/comic/${comicMatch[1]}/${episode}`;
    } else {
      const lzUrls = await searchWebForUrls(`site:lezhinus.com/en/comic "${effectiveTitle}"`, /lezhinus\.com\/en\/comic\/[a-z0-9_-]+/i);
      const slugMatch = lzUrls[0]?.match(/lezhinus\.com\/en\/comic\/([a-z0-9_-]+)/i);
      resolvedUrl = slugMatch
        ? `https://www.lezhinus.com/en/comic/${slugMatch[1]}/${episode}`
        : `https://www.lezhinus.com/en/search?q=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 11. Tapas
  else if (platformLower.includes('tapas')) {
    if (cleanBaseUrl && /tapas\.io\/series\//i.test(cleanBaseUrl)) {
      resolvedUrl = `${cleanBaseUrl.replace(/\/$/, '')}/info`;
    } else {
      const tpUrls = await searchWebForUrls(`site:tapas.io/series "${effectiveTitle}"`, /tapas\.io\/series\/[a-z0-9_-]+/i);
      resolvedUrl = tpUrls[0] ?? `https://tapas.io/search?q=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 12. Tappytoon
  else if (platformLower.includes('tappytoon')) {
    if (cleanBaseUrl && /tappytoon\.com\/en\/book\//i.test(cleanBaseUrl)) {
      resolvedUrl = cleanBaseUrl;
    } else {
      const ttUrls = await searchWebForUrls(`site:tappytoon.com/en/book "${effectiveTitle}"`, /tappytoon\.com\/en\/book\/[a-z0-9_-]+/i);
      resolvedUrl = ttUrls[0] ?? `https://www.tappytoon.com/en/search?q=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 13. Manta
  else if (platformLower.includes('manta')) {
    if (cleanBaseUrl && /manta\.net\/en\/series\//i.test(cleanBaseUrl)) {
      resolvedUrl = cleanBaseUrl;
    } else {
      const mantaUrls = await searchWebForUrls(`site:manta.net/en/series "${effectiveTitle}"`, /manta\.net\/en\/series\/[a-z0-9_-]+/i);
      resolvedUrl = mantaUrls[0] ?? `https://manta.net/en/search?query=${encodeURIComponent(effectiveTitle)}`;
    }
  }
  // 14. Webtoon
  else if (platformLower.includes('webtoon')) {
    const titleNoMatch = cleanBaseUrl?.match(/title_no=(\d+)/i);
    if (titleNoMatch && cleanBaseUrl) {
      resolvedUrl = cleanBaseUrl.replace(/\/list\?/i, '/viewer?') + `&episode_no=${episode}`;
    } else {
      const wtUrls = await searchWebForUrls(`site:webtoons.com/en "${effectiveTitle}"`, /webtoons\.com\/en\/[^?]+\/list\?title_no=\d+/i);
      if (wtUrls[0]) {
        resolvedUrl = episode > 1 ? wtUrls[0].replace(/\/list\?/i, '/viewer?') + `&episode_no=${episode}` : wtUrls[0];
      } else {
        resolvedUrl = `https://www.webtoons.com/en/search?keyword=${encodeURIComponent(effectiveTitle)}`;
      }
    }
  }
  // 15. Any other official platform (Watcha, Heavenly, SuBLime, Seven Seas, etc.)
  else if (cleanBaseUrl) {
    resolvedUrl = cleanBaseUrl;
  } else {
    resolvedUrl = await resolveYouTubeEpisodeUrl(effectiveTitle, season, episode, kind);
  }

  redirectCache.set(cacheKey, resolvedUrl);
  return resolvedUrl;
}
