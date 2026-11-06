import { load } from 'cheerio';
import {
  ALL_ANI_LIST_TAG_RANKS,
  DEFAULT_MINIMUM_BL_TAG_RANK,
  type AniListMediaType,
  type AniListSort,
  type AniListTagRankFilter,
  type MediaPageResponse,
  type MediaSeason,
  type MediaTitle,
  type StreamingEpisode,
  type StreamingLink,
} from '../shared/media.js';

const API_URL = 'https://graphql.anilist.co';
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_LIMIT = 180;
const allowedTagRanks = new Set<AniListTagRankFilter>([ALL_ANI_LIST_TAG_RANKS, DEFAULT_MINIMUM_BL_TAG_RANK]);
const allowedTypes = new Set<AniListMediaType>(['ANIME', 'MANGA']);
const allowedSorts = new Set<AniListSort>(['POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'START_DATE']);
const UPSTREAM_WINDOW_MS = 60_000;
const UPSTREAM_REQUEST_LIMIT = 20;
const upstreamRequests: number[] = [];
let upstreamBackoffUntil = 0;

export class AniListRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`AniList requests are temporarily limited. Retry in ${retryAfterSeconds} seconds.`);
    this.name = 'AniListRateLimitError';
  }
}

function reserveUpstreamSlot(): void {
  const now = Date.now();
  while (upstreamRequests.length > 0 && upstreamRequests[0] <= now - UPSTREAM_WINDOW_MS) upstreamRequests.shift();
  if (upstreamBackoffUntil > now) throw new AniListRateLimitError(Math.ceil((upstreamBackoffUntil - now) / 1000));
  if (upstreamRequests.length >= UPSTREAM_REQUEST_LIMIT) {
    throw new AniListRateLimitError(Math.max(1, Math.ceil((upstreamRequests[0] + UPSTREAM_WINDOW_MS - now) / 1000)));
  }
  upstreamRequests.push(now);
}

type AniListRelationNode = {
  id: number;
  type?: AniListMediaType | null;
  format?: string | null;
  status?: string | null;
  isAdult?: boolean | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  episodes?: number | null;
  chapters?: number | null;
  startDate?: { year?: number | null } | null;
};

type AniListRecord = {
  id: number;
  idMal?: number | null;
  type: AniListMediaType;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  format?: string | null;
  status?: string | null;
  countryOfOrigin?: string | null;
  genres?: Array<string | null> | null;
  description?: string | null;
  startDate?: { year?: number | null } | null;
  episodes?: number | null;
  chapters?: number | null;
  coverImage?: { large?: string | null; extraLarge?: string | null } | null;
  bannerImage?: string | null;
  averageScore?: number | null;
  isAdult?: boolean | null;
  tags?: Array<{ name: string; rank?: number | null }> | null;
  streamingEpisodes?: Array<{ title?: string | null; url?: string | null; site?: string | null; thumbnail?: string | null }> | null;
  externalLinks?: Array<{ url?: string | null; site?: string | null; type?: string | null }> | null;
  relations?: {
    edges?: Array<{
      relationType?: string | null;
      node?: AniListRelationNode | null;
    } | null> | null;
  } | null;
};

type Cached<T> = { expiresAt: number; value: T };
const responseCache = new Map<string, Cached<MediaPageResponse | MediaTitle | null>>();
const inFlight = new Map<string, Promise<MediaPageResponse | MediaTitle | null>>();

const COMMON_FIELDS = `
  id
  idMal
  type
  title { romaji english native }
  format
  status
  countryOfOrigin
  genres
  description(asHtml: true)
  startDate { year }
  episodes
  chapters
  coverImage { large extraLarge }
  bannerImage
  averageScore
  isAdult
  tags { name rank }
  streamingEpisodes { title url site thumbnail }
  externalLinks { url site type }
`;

const SEARCH_QUERY = `
  query BrowseBlMedia(
    $page: Int!,
    $perPage: Int!,
    $type: MediaType!,
    $sort: [MediaSort!]!,
    $search: String,
    $isAdult: Boolean,
    $minimumRank: Int!,
    $status: MediaStatus,
    $format: MediaFormat,
    $countryOfOrigin: CountryCode
  ) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage total }
      media(
        type: $type
        tag_in: ["Boys' Love"]
        tag_not_in: ["Heterosexual", "Girls' Love", "Female Harem"]
        minimumTagRank: $minimumRank
        isAdult: $isAdult
        sort: $sort
        search: $search
        status: $status
        format: $format
        countryOfOrigin: $countryOfOrigin
      ) { ${COMMON_FIELDS} }
    }
  }
`;

const DETAIL_QUERY = `
  query BlMediaDetail($id: Int!) {
    Media(id: $id) {
      ${COMMON_FIELDS}
      relations {
        edges {
          relationType
          node {
            id
            type
            format
            status
            isAdult
            title { romaji english native }
            episodes
            chapters
            startDate { year }
          }
        }
      }
    }
  }
`;

function safeDirectMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
    }
    if (url.protocol !== 'https:') return null;
    // Reject generic root homepages or bare language homepages (e.g. /, /en, /en-us/)
    if ((url.pathname === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(url.pathname)) && !url.search) return null;
    // Reject generic search result pages
    if (/\/search\b/i.test(url.pathname)) return null;
    // Reject generic YouTube channel/user/handle pages (only allow specific video /watch or /playlist links)
    if (/(?:^|\.)youtube\.com$/i.test(url.hostname)) {
      if (/^\/(?:channel|user|c|@)/i.test(url.pathname)) return null;
      if (url.pathname !== '/watch' && url.pathname !== '/playlist') return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanDescription(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = load(value).text().replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > 900 ? `${text.slice(0, 897).trimEnd()}…` : text;
}

function displayTitle(record: { id: number; title?: { romaji?: string | null; english?: string | null; native?: string | null } | null }): string {
  return record.title?.english?.trim() || record.title?.romaji?.trim() || record.title?.native?.trim() || `Untitled media ${record.id}`;
}

function isStrictlyBoysLove(record: AniListRecord, minimumRank: number): boolean {
  const tags = record.tags ?? [];
  const blTag = tags.find((t) => t.name === "Boys' Love");
  if (!blTag || (blTag.rank ?? 0) < minimumRank) return false;
  const heteroTag = tags.find((t) => t.name === 'Heterosexual');
  if (heteroTag && (heteroTag.rank ?? 0) >= 40) return false;
  const glTag = tags.find((t) => t.name === "Girls' Love");
  if (glTag && (glTag.rank ?? 0) > (blTag.rank ?? 0)) return false;
  return true;
}

function extractEpisodeNumber(title: string): number {
  const match = title.match(/(?:episode|ep\.?|ch\.?|chapter)\s*(\d+(?:\.\d+)?)/i) ?? title.match(/^(\d+(?:\.\d+)?)\b/);
  return match ? Number.parseFloat(match[1]) : Number.POSITIVE_INFINITY;
}

function extractSeasons(record: AniListRecord): MediaSeason[] | undefined {
  const edges = record.relations?.edges ?? [];
  if (!edges.length) return undefined;

  const type = record.type === 'MANGA' ? 'MANGA' : 'ANIME';
  const allowedRelations = new Set(['PREQUEL', 'SEQUEL']);

  type Candidate = {
    id: number;
    title: string;
    format: string | null;
    episodes: number | null;
    chapters: number | null;
    startYear: number | null;
    orderWeight: number;
  };

  const byId = new Map<number, Candidate>();
  byId.set(record.id, {
    id: record.id,
    title: displayTitle(record),
    format: record.format ?? null,
    episodes: record.episodes ?? null,
    chapters: record.chapters ?? null,
    startYear: record.startDate?.year ?? null,
    orderWeight: 0,
  });

  for (const edge of edges) {
    const rel = edge?.relationType ?? '';
    const node = edge?.node;
    if (!node || !allowedRelations.has(rel)) continue;
    if (node.type !== type) continue;
    // If browsing MANGA, don't mix light novels into manga chapter seasons unless the main entry is also a novel
    if (type === 'MANGA' && record.format !== 'NOVEL' && node.format === 'NOVEL') continue;
    if (byId.has(node.id)) continue;

    byId.set(node.id, {
      id: node.id,
      title: displayTitle(node),
      format: node.format ?? null,
      episodes: node.episodes ?? null,
      chapters: node.chapters ?? null,
      startYear: node.startDate?.year ?? null,
      orderWeight: rel === 'PREQUEL' ? -1 : 1,
    });
  }

  if (byId.size < 2) return undefined;

  const sorted = [...byId.values()].sort((a, b) => {
    const yearA = a.startYear ?? 9999;
    const yearB = b.startYear ?? 9999;
    if (yearA !== yearB) return yearA - yearB;
    if (a.orderWeight !== b.orderWeight) return a.orderWeight - b.orderWeight;
    return a.id - b.id;
  });

  return sorted.map((entry, idx) => ({
    seasonNumber: idx + 1,
    id: entry.id,
    title: entry.title,
    format: entry.format,
    episodes: entry.episodes,
    chapters: entry.chapters,
    startYear: entry.startYear,
  }));
}

function normalize(record: AniListRecord): MediaTitle {
  const blRank = record.tags?.find((tag) => tag.name === "Boys' Love")?.rank ?? null;
  const type = record.type === 'MANGA' ? 'MANGA' : 'ANIME';
  const sourceUrl = `https://anilist.co/${type === 'ANIME' ? 'anime' : 'manga'}/${record.id}`;

  const episodeLinks: StreamingEpisode[] = (record.streamingEpisodes ?? [])
    .flatMap((episode) => {
      const url = safeDirectMediaUrl(episode.url);
      return url
        ? [{
            title: episode.title?.trim() || 'Episode',
            url,
            site: episode.site?.trim() || null,
            thumbnail: safeImageUrl(episode.thumbnail),
          }]
        : [];
    })
    .sort((a, b) => {
      const numA = extractEpisodeNumber(a.title);
      const numB = extractEpisodeNumber(b.title);
      if (numA !== numB) return numA - numB;
      return a.title.localeCompare(b.title);
    });

  // Sort STREAMING links ahead of INFO/READING publisher links, and exclude social media/encyclopedias
  const rawExternal = [...(record.externalLinks ?? [])].sort((a, b) => {
    const aScore = a.type === 'STREAMING' ? 0 : 1;
    const bScore = b.type === 'STREAMING' ? 0 : 1;
    return aScore - bScore;
  });

  const streamingOnlyLinks: StreamingLink[] = rawExternal
    .filter((link) => link.type === 'STREAMING')
    .filter((link) => !/twitter|x\.com|tiktok|instagram|facebook|weibo/i.test(`${link.site ?? ''} ${link.url ?? ''}`))
    .flatMap((link) => {
      const url = safeDirectMediaUrl(link.url);
      const site = link.site?.trim();
      return url && site ? [{ url, site }] : [];
    });

  const infoPublisherLinks: StreamingLink[] = rawExternal
    .filter((link) => link.type !== 'STREAMING')
    .filter((link) => !/twitter|x\.com|tiktok|instagram|facebook|weibo|wikipedia|animenewsnetwork|myanimelist|anilist|syoboi/i.test(`${link.site ?? ''} ${link.url ?? ''}`))
    .flatMap((link) => {
      const url = safeDirectMediaUrl(link.url);
      const site = link.site?.trim();
      if (!url || !site) return [];
      // For Anime, exclude generic Japanese corporate official sites if real streaming links exist
      if (type === 'ANIME' && /official site/i.test(site) && (streamingOnlyLinks.length > 0 || episodeLinks.length > 0)) return [];
      return [{ url, site }];
    });

  const directLinks: StreamingLink[] = [];
  const seenSites = new Set<string>();
  const titleText = displayTitle(record);

  // Only include platforms that are genuinely verified for this title
  for (const link of [...streamingOnlyLinks, ...infoPublisherLinks]) {
    const key = link.site.toLowerCase();
    if (!seenSites.has(key)) {
      seenSites.add(key);
      directLinks.push(link);
    }
  }

  for (const ep of episodeLinks) {
    if (ep.site && !seenSites.has(ep.site.toLowerCase())) {
      seenSites.add(ep.site.toLowerCase());
      directLinks.push({ site: ep.site, url: ep.url });
    }
  }

  // For Anime, YouTube always hosts episodes, PVs, or licensed streams (Ani-One / Muse / Crunchyroll Collection)
  if (type === 'ANIME' && !seenSites.has('youtube')) {
    seenSites.add('youtube');
    directLinks.unshift({
      site: 'YouTube',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${titleText} Episode 1 English Sub`)}`,
    });
  }

  const seasons = extractSeasons(record);

  return {
    id: record.id,
    type,
    title: {
      romaji: record.title?.romaji ?? null,
      english: record.title?.english ?? null,
      native: record.title?.native ?? null,
    },
    displayTitle: titleText,
    format: record.format ?? null,
    status: record.status ?? null,
    countryOfOrigin: record.countryOfOrigin ?? null,
    genres: (record.genres ?? []).filter((g): g is string => typeof g === 'string' && Boolean(g)),
    description: cleanDescription(record.description),
    startYear: record.startDate?.year ?? null,
    episodes: record.episodes ?? (episodeLinks.length > 0 ? episodeLinks.length : null),
    chapters: record.chapters ?? null,
    ...(seasons && seasons.length >= 2 ? { seasons } : {}),
    coverImage: safeImageUrl(record.coverImage?.extraLarge ?? record.coverImage?.large),
    bannerImage: safeImageUrl(record.bannerImage),
    averageScore: record.averageScore ?? null,
    isAdult: Boolean(record.isAdult),
    boysLoveRank: blRank,
    streamingEpisodes: episodeLinks,
    streamingLinks: directLinks,
    sourceUrl,
  };
}

async function enrichDirectLinksFromMangaDex(record: AniListRecord, normalized: MediaTitle): Promise<MediaTitle> {
  if (normalized.type !== 'MANGA') return normalized;
  try {
    const searchTitle = record.title?.english?.trim() || record.title?.romaji?.trim() || normalized.displayTitle;
    const searchUrl = `https://api.mangadex.org/manga?title=${encodeURIComponent(searchTitle)}&limit=8`;
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return normalized;
    const payload = (await res.json()) as {
      data?: Array<{
        id: string;
        attributes?: {
          title?: Record<string, string>;
          altTitles?: Array<Record<string, string>>;
          links?: Record<string, string>;
          lastChapter?: string | null;
        };
      }>;
    };
    const candidates = payload.data ?? [];
    const targetEn = (record.title?.english ?? '').toLowerCase().trim();
    const targetRo = (record.title?.romaji ?? '').toLowerCase().trim();
    const targetNa = (record.title?.native ?? '').toLowerCase().trim();

    const matched = candidates.find((item) => String(item.attributes?.links?.al ?? '') === String(record.id))
      ?? candidates.find((item) => {
        const mainTitles = Object.values(item.attributes?.title ?? {}).map((t) => t.toLowerCase().trim());
        const altTitles = (item.attributes?.altTitles ?? []).flatMap((obj) => Object.values(obj).map((t) => t.toLowerCase().trim()));
        const allTitles = [...mainTitles, ...altTitles];
        return (
          (targetEn && allTitles.includes(targetEn)) ||
          (targetRo && allTitles.includes(targetRo)) ||
          (targetNa && allTitles.includes(targetNa))
        );
      });

    if (!matched) return normalized;

    const mdUrl = `https://mangadex.org/title/${matched.id}`;
    const hasMdLink = normalized.streamingLinks.some((l) => l.site.toLowerCase() === 'mangadex');
    const updatedLinks = hasMdLink
      ? normalized.streamingLinks.map((l) => (l.site.toLowerCase() === 'mangadex' ? { site: 'MangaDex', url: mdUrl } : l))
      : [{ site: 'MangaDex', url: mdUrl }, ...normalized.streamingLinks];

    // Fetch direct chapter links from MangaDex feed
    let chapterEpisodes = normalized.streamingEpisodes;
    if (chapterEpisodes.length === 0) {
      const feedRes = await fetch(
        `https://api.mangadex.org/manga/${matched.id}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=100`,
        { signal: AbortSignal.timeout(4500) },
      );
      if (feedRes.ok) {
        const feedData = (await feedRes.json()) as {
          data?: Array<{
            id: string;
            attributes?: { chapter?: string | null; title?: string | null };
          }>;
        };
        const seenChapters = new Set<string>();
        const feedChapters: StreamingEpisode[] = [];
        for (const ch of feedData.data ?? []) {
          const chNum = ch.attributes?.chapter?.trim();
          if (!chNum || seenChapters.has(chNum)) continue;
          seenChapters.add(chNum);
          const chTitle = ch.attributes?.title?.trim();
          feedChapters.push({
            title: `Chapter ${chNum}${chTitle ? ` — ${chTitle}` : ''}`,
            url: `https://mangadex.org/chapter/${ch.id}`,
            site: 'MangaDex',
            thumbnail: null,
          });
        }
        if (feedChapters.length > 0) {
          chapterEpisodes = feedChapters;
        }
      }
    }

    const parsedLastCh = matched.attributes?.lastChapter ? Number.parseInt(matched.attributes.lastChapter, 10) : null;
    const discoveredChapters = normalized.chapters
      ?? (Number.isFinite(parsedLastCh) && (parsedLastCh ?? 0) > 0 ? parsedLastCh : null)
      ?? (chapterEpisodes.length > 0 ? chapterEpisodes.length : null);

    return {
      ...normalized,
      chapters: discoveredChapters,
      streamingLinks: updatedLinks,
      streamingEpisodes: chapterEpisodes,
    };
  } catch {
    return normalized;
  }
}

async function enrichDirectLinksFromJikan(record: AniListRecord, normalized: MediaTitle): Promise<MediaTitle> {
  let current = normalized;
  if (record.idMal) {
    try {
      const endpoint = current.type === 'ANIME'
        ? `https://api.jikan.moe/v4/anime/${record.idMal}/streaming`
        : `https://api.jikan.moe/v4/manga/${record.idMal}/external`;
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(4500) });
      if (res.ok) {
        const payload = (await res.json()) as { data?: Array<{ name?: string; url?: string }> };
        const jikanLinks = (payload.data ?? []).flatMap((entry) => {
          const url = safeDirectMediaUrl(entry.url);
          const site = entry.name?.trim();
          return url && site && !/wikipedia|ann|animenewsnetwork|syoboi|myanimelist|anilist/i.test(site) ? [{ site, url }] : [];
        });
        if (jikanLinks.length > 0) {
          const bySite = new Map(current.streamingLinks.map((l) => [l.site.toLowerCase(), l]));
          for (const jl of jikanLinks) {
            const key = jl.site.toLowerCase();
            if (!bySite.has(key)) {
              bySite.set(key, jl);
            }
          }
          current = {
            ...current,
            streamingLinks: Array.from(bySite.values()),
          };
        }
      }
    } catch {
      // Ignore Jikan network errors
    }
  }
  if (current.type === 'MANGA') {
    current = await enrichDirectLinksFromMangaDex(record, current);
    // If a manga has no verified reading platform on AniList, Jikan, or MangaDex, provide its official AniList / MyAnimeList source page so we never show broken "No results" platform links
    if (current.streamingLinks.length === 0) {
      current = {
        ...current,
        streamingLinks: [
          { site: 'AniList Official Source', url: current.sourceUrl },
          ...(record.idMal ? [{ site: 'MyAnimeList', url: `https://myanimelist.net/manga/${record.idMal}` }] : []),
        ],
      };
    }
  }
  return current;
}

async function queryAniList<T>(key: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const previous = inFlight.get(key);
  if (previous) return previous as Promise<T>;
  reserveUpstreamSlot();

  const request = (async () => {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'BL-Pulse/1.0' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(12_000),
    });

    if (response.status === 429) {
      const headerSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
      const retryAfterSeconds = Math.max(1, Math.min(300, Number.isFinite(headerSeconds) ? headerSeconds : 60));
      upstreamBackoffUntil = Math.max(upstreamBackoffUntil, Date.now() + retryAfterSeconds * 1000);
      throw new AniListRateLimitError(retryAfterSeconds);
    }

    if (!response.ok) throw new Error(`AniList returned HTTP ${response.status}.`);
    const payload = (await response.json()) as { data?: Record<string, unknown>; errors?: Array<{ message?: string }> };
    if (payload.errors?.length) throw new Error(payload.errors[0]?.message || 'AniList query failed.');
    const result = (payload.data ?? {}) as T;
    responseCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: result as MediaPageResponse | MediaTitle | null });
    if (responseCache.size > CACHE_LIMIT) {
      const oldestKey = responseCache.keys().next().value;
      if (oldestKey) responseCache.delete(oldestKey);
    }
    return result;
  })();

  inFlight.set(key, request as Promise<MediaPageResponse | MediaTitle | null>);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

export async function browseAniList(input: {
  type: AniListMediaType;
  page: number;
  sort: AniListSort;
  search?: string;
  includeAdult?: boolean;
  minimumRank?: AniListTagRankFilter;
  status?: string;
  format?: string;
  countryOfOrigin?: string;
}): Promise<MediaPageResponse> {
  if (!allowedTypes.has(input.type)) throw new Error('Choose Anime or Manga.');
  if (!allowedSorts.has(input.sort)) throw new Error('Choose a supported sort order.');
  const minimumRank = input.minimumRank ?? DEFAULT_MINIMUM_BL_TAG_RANK;
  if (!allowedTagRanks.has(minimumRank)) throw new Error('Choose a supported AniList tag-rank filter.');
  const page = Math.max(1, Math.min(300, Math.floor(input.page) || 1));
  const search = input.search?.replace(/\s+/g, ' ').trim().slice(0, 80) || null;
  const status = input.status && ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED'].includes(input.status) ? input.status : null;
  const format = input.format && ['TV', 'MOVIE', 'OVA', 'ONA', 'MANGA', 'NOVEL', 'ONE_SHOT'].includes(input.format) ? input.format : null;
  const countryOfOrigin = input.countryOfOrigin && ['JP', 'KR', 'CN', 'TW'].includes(input.countryOfOrigin) ? input.countryOfOrigin : null;

  const key = `page:${input.type}:${page}:${input.sort}:rank${minimumRank}:${input.includeAdult ? 'adult' : 'general'}:${status ?? ''}:${format ?? ''}:${countryOfOrigin ?? ''}:${search ?? ''}`;
  const result = await queryAniList<{ Page?: { pageInfo?: { hasNextPage?: boolean; total?: number }; media?: AniListRecord[] } }>(key, SEARCH_QUERY, {
    page,
    perPage: 28,
    type: input.type,
    sort: [input.sort],
    search,
    isAdult: input.includeAdult ? null : false,
    minimumRank,
    ...(status ? { status } : {}),
    ...(format ? { format } : {}),
    ...(countryOfOrigin ? { countryOfOrigin } : {}),
  });

  const pageResult = result.Page;
  const items = (pageResult?.media ?? [])
    .filter((record) => (input.includeAdult || !record.isAdult) && isStrictlyBoysLove(record, minimumRank))
    .map(normalize);

  return {
    type: input.type,
    page,
    hasNextPage: page < 300 && Boolean(pageResult?.pageInfo?.hasNextPage),
    total: pageResult?.pageInfo?.total ?? items.length,
    items,
    source: 'AniList',
  };
}

export async function getAniListMedia(
  type: AniListMediaType,
  id: number,
  includeAdult = false,
  minimumRank: AniListTagRankFilter = DEFAULT_MINIMUM_BL_TAG_RANK,
): Promise<MediaTitle | null> {
  if (!allowedTypes.has(type) || !Number.isSafeInteger(id) || id <= 0) return null;
  if (!allowedTagRanks.has(minimumRank)) return null;
  const key = `detail:${type}:${id}`;
  const result = await queryAniList<{ Media?: AniListRecord | null }>(key, DETAIL_QUERY, { id });
  const record = result.Media;
  if (!record || record.type !== type || (!includeAdult && record.isAdult) || !isStrictlyBoysLove(record, minimumRank)) {
    return null;
  }
  const normalized = normalize(record);
  return enrichDirectLinksFromJikan(record, normalized);
}
