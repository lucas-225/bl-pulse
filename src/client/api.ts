import {
  DEFAULT_MINIMUM_BL_TAG_RANK,
  type AniListMediaType,
  type AniListSort,
  type AniListTagRankFilter,
  type MediaPageResponse,
  type MediaTitle,
} from '../shared/media';
import type {
  CatalogResponse,
  MarketSyncResult,
  MonetizationConfig,
  RedirectAnalyticsSummary,
  Series,
} from '../shared/types';

async function parseJsonOrThrow<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text) as { message?: string };
      throw new Error(parsed.message || fallbackMessage);
    } catch (err) {
      if (err instanceof Error && err.message !== fallbackMessage && !err.message.includes('Unexpected token')) {
        throw err;
      }
      throw new Error(fallbackMessage);
    }
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

export async function fetchCatalog(): Promise<CatalogResponse> {
  const response = await fetch('/api/catalog', { headers: { Accept: 'application/json' } });
  return parseJsonOrThrow<CatalogResponse>(response, 'Unable to load the catalog right now.');
}

export async function refreshCatalog(): Promise<CatalogResponse> {
  const response = await fetch('/api/refresh', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  return parseJsonOrThrow<CatalogResponse>(response, 'Unable to refresh the catalog right now.');
}

export async function fetchSeries(id: string): Promise<Series> {
  const response = await fetch(`/api/series/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  return parseJsonOrThrow<Series>(response, 'Unable to load this series.');
}

export interface MediaFilterOptions {
  status?: string;
  format?: string;
  countryOfOrigin?: string;
}

export async function fetchMediaPage(
  type: AniListMediaType,
  page = 1,
  sort: AniListSort = 'POPULARITY_DESC',
  search = '',
  signal?: AbortSignal,
  includeAdult = false,
  minimumRank: AniListTagRankFilter = DEFAULT_MINIMUM_BL_TAG_RANK,
  filters?: MediaFilterOptions,
): Promise<MediaPageResponse> {
  const params = new URLSearchParams({
    type: type.toLowerCase(),
    page: String(page),
    sort,
  });
  if (search.trim()) params.set('search', search.trim());
  if (includeAdult) params.set('includeAdult', '1');
  if (minimumRank !== DEFAULT_MINIMUM_BL_TAG_RANK) params.set('minRank', String(minimumRank));
  if (filters?.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters?.format && filters.format !== 'all') params.set('format', filters.format);
  if (filters?.countryOfOrigin && filters.countryOfOrigin !== 'all') params.set('country', filters.countryOfOrigin);

  const url = `/api/media?${params.toString()}`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html') && !signal?.aborted) {
    // Dev server may be mid-restart; wait 600ms and retry once
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    const retryRes = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    return parseJsonOrThrow<MediaPageResponse>(retryRes, 'Unable to load titles from AniList. Please click Retry.');
  }
  return parseJsonOrThrow<MediaPageResponse>(response, 'Unable to load titles from AniList.');
}

export async function fetchMediaTitle(
  type: AniListMediaType,
  id: number,
  includeAdult = false,
  minimumRank: AniListTagRankFilter = DEFAULT_MINIMUM_BL_TAG_RANK,
  signal?: AbortSignal,
): Promise<MediaTitle> {
  const params = new URLSearchParams();
  if (includeAdult) params.set('includeAdult', '1');
  if (minimumRank !== DEFAULT_MINIMUM_BL_TAG_RANK) params.set('minRank', String(minimumRank));
  const query = params.toString();
  const url = `/api/media/${type.toLowerCase()}/${id}${query ? `?${query}` : ''}`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  return parseJsonOrThrow<MediaTitle>(response, 'Unable to load title details from AniList.');
}

// ============================================================================
// ADMIN & MONETIZATION API CLIENT
// ============================================================================

export interface AdminVerifyResponse {
  ok: boolean;
  databaseReady: boolean;
  seriesCount: number;
  lastRefreshed: string | null;
  monetization: MonetizationConfig;
  analytics: RedirectAnalyticsSummary;
}

export async function verifyAdminPassword(password: string): Promise<AdminVerifyResponse> {
  const response = await fetch('/api/admin/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
    },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Invalid admin password.');
  }
  return response.json() as Promise<AdminVerifyResponse>;
}

export async function fetchAdminAnalytics(password: string): Promise<{
  databaseReady: boolean;
  analytics: RedirectAnalyticsSummary;
  monetization: MonetizationConfig;
}> {
  const response = await fetch('/api/admin/analytics', {
    headers: { 'x-admin-password': password },
  });
  if (!response.ok) {
    throw new Error('Unable to load admin analytics.');
  }
  return response.json();
}

export async function triggerMarketAutoSync(
  password: string,
): Promise<MarketSyncResult & { catalog: CatalogResponse }> {
  const response = await fetch('/api/admin/sync-market', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Market Auto-Sync failed.');
  }
  return response.json() as Promise<MarketSyncResult & { catalog: CatalogResponse }>;
}

export async function autoFillSeries(
  password: string,
  title: string,
): Promise<{ metadata: Partial<Series> }> {
  const response = await fetch('/api/admin/autofill', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
    },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Auto-Fill lookup failed.');
  }
  return response.json() as Promise<{ metadata: Partial<Series> }>;
}

export async function saveAdminSeries(
  password: string,
  series: Partial<Series> & { title: string },
): Promise<{ series: Series; catalog: CatalogResponse }> {
  const response = await fetch('/api/admin/series', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
    },
    body: JSON.stringify(series),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Failed to save series.');
  }
  return response.json() as Promise<{ series: Series; catalog: CatalogResponse }>;
}

export async function deleteAdminSeries(
  password: string,
  id: string,
): Promise<{ deletedId: string; catalog: CatalogResponse }> {
  const response = await fetch(`/api/admin/series/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': password },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Failed to delete series.');
  }
  return response.json() as Promise<{ deletedId: string; catalog: CatalogResponse }>;
}

export async function saveMonetizationConfig(
  password: string,
  config: Partial<MonetizationConfig>,
): Promise<{ monetization: MonetizationConfig; catalog: CatalogResponse }> {
  const response = await fetch('/api/admin/monetization', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Failed to save monetization settings.');
  }
  return response.json() as Promise<{ monetization: MonetizationConfig; catalog: CatalogResponse }>;
}
