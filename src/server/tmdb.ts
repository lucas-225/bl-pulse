import type { PlatformLink, Series, SeriesStatus } from '../shared/types.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const BL_KEYWORD_IDS = ['207084', '258245', '296811']; // boys' love, BL, yaoi

const COUNTRY_NAMES: Record<string, string> = {
  TH: 'Thailand',
  KR: 'South Korea',
  JP: 'Japan',
  TW: 'Taiwan',
  CN: 'China',
  PH: 'Philippines',
  VN: 'Vietnam',
  GB: 'United Kingdom',
  US: 'United States',
};

export function isTmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_READ_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim());
}

function getAuthHeaders(): Record<string, string> {
  const token = process.env.TMDB_READ_TOKEN?.trim();
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }
  return { 'Content-Type': 'application/json' };
}

function getQueryAuthParam(): string {
  const apiKey = process.env.TMDB_API_KEY?.trim();
  return apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '';
}

interface TmdbTvSummary {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  origin_country?: string[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  vote_average?: number;
}

interface TmdbProvider {
  provider_id: number;
  provider_name: string;
  logo_path?: string;
}

interface TmdbWatchProvidersResponse {
  results?: Record<string, {
    link?: string;
    flatrate?: TmdbProvider[];
    free?: TmdbProvider[];
    buy?: TmdbProvider[];
  }>;
}

const GENRE_MAP: Record<number, string> = {
  18: 'Drama',
  35: 'Comedy',
  10751: 'Family',
  10759: 'Action & Adventure',
  10765: 'Sci-Fi & Fantasy',
  9648: 'Mystery',
  80: 'Crime',
};

function mapTmdbStatus(firstAirDate?: string): SeriesStatus {
  if (!firstAirDate) return 'upcoming';
  const airTime = new Date(firstAirDate).getTime();
  const now = Date.now();
  if (Number.isNaN(airTime)) return 'completed';
  if (airTime > now) return 'upcoming';
  if (now - airTime < 75 * 24 * 60 * 60 * 1000) return 'airing';
  return 'completed';
}

function normalizeProviderNameAndUrl(rawName: string, seriesTitle: string): { name: string; url: string } {
  const lower = rawName.toLowerCase();
  if (lower.includes('viki')) {
    return { name: 'Viki', url: `https://www.viki.com/search?q=${encodeURIComponent(seriesTitle)}` };
  }
  if (lower.includes('iqiyi')) {
    return { name: 'iQIYI', url: `https://www.iq.com/search?query=${encodeURIComponent(seriesTitle)}` };
  }
  if (lower.includes('gagaoolala')) {
    return { name: 'GagaOOLala', url: `https://www.gagaoolala.com/en/search?q=${encodeURIComponent(seriesTitle)}` };
  }
  if (lower.includes('wetv') || lower.includes('tencent')) {
    return { name: 'WeTV', url: `https://wetv.vip/en/search/${encodeURIComponent(seriesTitle)}` };
  }
  if (lower.includes('netflix')) {
    return { name: 'Netflix', url: `https://www.netflix.com/search?q=${encodeURIComponent(seriesTitle)}` };
  }
  if (lower.includes('crunchyroll')) {
    return { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${encodeURIComponent(seriesTitle)}` };
  }
  if (lower.includes('bilibili')) {
    return { name: 'Bilibili', url: `https://www.bilibili.tv/en/search-result?q=${encodeURIComponent(seriesTitle)}` };
  }
  if (lower.includes('youtube')) {
    return { name: 'YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${seriesTitle} Episode 1 Eng Sub`)}` };
  }
  return {
    name: rawName,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${seriesTitle} ${rawName} Episode 1`)}`,
  };
}

export async function fetchTmdbWatchProviders(tvId: number, seriesTitle = ''): Promise<PlatformLink[]> {
  if (!isTmdbConfigured()) return [];
  const url = `${TMDB_BASE_URL}/tv/${tvId}/watch/providers?${getQueryAuthParam()}`;
  try {
    const res = await fetch(url, { headers: getAuthHeaders(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as TmdbWatchProvidersResponse;
    const results = data.results ?? {};
    const platforms: PlatformLink[] = [];
    const seen = new Set<string>();

    const preferredRegions = ['US', 'TH', 'JP', 'KR', 'TW', 'GB', ...Object.keys(results)];
    for (const region of preferredRegions) {
      const regData = results[region];
      if (!regData) continue;
      const providers = [...(regData.flatrate ?? []), ...(regData.free ?? []), ...(regData.buy ?? [])];
      for (const prov of providers) {
        const mapped = normalizeProviderNameAndUrl(prov.provider_name, seriesTitle);
        const key = mapped.name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          platforms.push({
            name: mapped.name,
            url: mapped.url,
            source: 'official',
          });
        }
      }
    }

    return platforms;
  } catch {
    return [];
  }
}

export async function fetchTmdbCatalog(): Promise<Series[]> {
  if (!isTmdbConfigured()) return [];
  const keywordQuery = BL_KEYWORD_IDS.join('|');
  const urls = [
    `${TMDB_BASE_URL}/discover/tv?with_keywords=${keywordQuery}&sort_by=popularity.desc&page=1${getQueryAuthParam()}`,
    `${TMDB_BASE_URL}/discover/tv?with_keywords=${keywordQuery}&sort_by=first_air_date.desc&page=1${getQueryAuthParam()}`,
  ];

  try {
    const responses = await Promise.all(
      urls.map((url) => fetch(url, { headers: getAuthHeaders(), signal: AbortSignal.timeout(12000) }).catch(() => null)),
    );
    const combinedItems: TmdbTvSummary[] = [];
    const seenIds = new Set<number>();

    for (const res of responses) {
      if (!res || !res.ok) continue;
      const data = (await res.json()) as { results?: TmdbTvSummary[] };
      for (const tv of data.results ?? []) {
        if (!seenIds.has(tv.id)) {
          seenIds.add(tv.id);
          combinedItems.push(tv);
        }
      }
    }

    const seriesList: Series[] = [];
    for (const tv of combinedItems.slice(0, 40)) {
      const countryCode = tv.origin_country?.[0] ?? 'TH';
      const country = COUNTRY_NAMES[countryCode] ?? countryCode;
      const year = tv.first_air_date ? new Date(tv.first_air_date).getFullYear() : undefined;
      const status = mapTmdbStatus(tv.first_air_date);
      const genres = (tv.genre_ids ?? []).map((id) => GENRE_MAP[id] ?? 'Romance').filter(Boolean);
      if (!genres.includes('Romance')) genres.unshift('Romance');
      genres.unshift('BL');

      seriesList.push({
        id: `tmdb-${tv.id}`,
        title: tv.name,
        country,
        status,
        sourceUrl: `https://www.themoviedb.org/tv/${tv.id}`,
        coverUrl: tv.poster_path ? `https://image.tmdb.org/t/p/w780${tv.poster_path}` : undefined,
        synopsis: tv.overview?.trim() || `${tv.name} is a ${country} boys' love series released in ${year ?? 'recent years'}.`,
        year: Number.isFinite(year) ? year : undefined,
        releaseDate: tv.first_air_date,
        genres,
        platforms: [
          {
            name: 'YouTube',
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${tv.name} Episode 1 BL Eng Sub`)}`,
            source: 'official',
          },
        ],
        updatedAt: new Date().toISOString(),
      });
    }

    return seriesList;
  } catch (error) {
    console.error('Error fetching TMDB catalog:', error);
    return [];
  }
}
