import type { CatalogResponse, Series } from '../shared/types';
import {
  ALL_ANI_LIST_TAG_RANKS,
  DEFAULT_MINIMUM_BL_TAG_RANK,
  type AniListMediaType,
  type AniListSort,
  type AniListTagRankFilter,
  type MediaPageResponse,
  type MediaTitle,
} from '../shared/media';

export async function fetchCatalog(): Promise<CatalogResponse> {
  const response = await fetch('/api/catalog', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Catalog request failed (${response.status}).`);
  return response.json() as Promise<CatalogResponse>;
}

export async function refreshCatalog(): Promise<CatalogResponse> {
  const response = await fetch('/api/catalog/refresh', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const data = (await response.json()) as CatalogResponse & { message?: string };
  if (!response.ok) throw new Error(data.message ?? data.error ?? 'The catalog could not be refreshed.');
  return data;
}

export async function fetchSeries(id: string): Promise<Series> {
  const response = await fetch(`/api/series/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Series request failed (${response.status}).`);
  return response.json() as Promise<Series>;
}

export async function fetchMediaPage(
  type: AniListMediaType,
  page: number,
  sort: AniListSort,
  search: string,
  signal?: AbortSignal,
  includeAdult = false,
  minimumRank: AniListTagRankFilter = DEFAULT_MINIMUM_BL_TAG_RANK,
  filters?: {
    status?: string;
    format?: string;
    countryOfOrigin?: string;
  },
): Promise<MediaPageResponse> {
  const response = await fetch('/api/media/search', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      page,
      sort,
      search,
      includeAdult,
      minimumRank,
      status: filters?.status,
      format: filters?.format,
      countryOfOrigin: filters?.countryOfOrigin,
    }),
    signal,
  });
  const data = (await response.json()) as MediaPageResponse & { message?: string };
  if (!response.ok) throw new Error(data.message ?? `Media search failed (${response.status}).`);
  return data;
}

export async function fetchMediaTitle(
  type: AniListMediaType,
  id: number,
  includeAdult = false,
  minimumRank: AniListTagRankFilter = DEFAULT_MINIMUM_BL_TAG_RANK,
  signal?: AbortSignal,
): Promise<MediaTitle> {
  const params = new URLSearchParams();
  if (includeAdult) params.set('mature', '1');
  if (minimumRank === ALL_ANI_LIST_TAG_RANKS) params.set('tagRank', 'all');
  const query = params.toString();
  const response = await fetch(`/api/media/${type.toLowerCase()}/${id}${query ? `?${query}` : ''}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  const data = (await response.json()) as MediaTitle & { message?: string };
  if (!response.ok) throw new Error(data.message ?? `Media request failed (${response.status}).`);
  return data;
}
