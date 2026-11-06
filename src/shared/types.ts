export type SeriesStatus = 'airing' | 'upcoming' | 'completed';

export interface PlatformLink {
  name: string;
  url: string;
  source?: 'official' | 'justwatch' | 'search';
}

export interface SeriesSeason {
  seasonNumber: number;
  title: string;
  episodes: number;
  year?: number | null;
}

export interface SeriesEpisodeLink {
  number: number;
  title: string;
  url: string;
  platform: string;
}

export interface Series {
  id: string;
  title: string;
  country: string;
  status: SeriesStatus;
  platforms: PlatformLink[];
  genres: string[];
  year?: number;
  releaseDate?: string;
  episodes?: number;
  seasons?: SeriesSeason[];
  episodeLinks?: SeriesEpisodeLink[];
  synopsis?: string;
  coverUrl?: string;
  sourceUrl: string;
  updatedAt?: string;
  detailFetchedAt?: string;
}

export interface EditorialPost {
  title: string;
  body: string;
  generatedAt: string;
  updatedAt?: string;
  source: 'BL Pulse' | 'AI-assisted' | 'Catalog fallback';
}

export interface AffiliateConfig {
  gagaoolalaRef: string;
  vikiAffiliateId: string;
  iqiyiAffiliateId: string;
  wetvAffiliateId: string;
  crunchyrollAffiliateId: string;
  tapasRef: string;
  lezhinRef: string;
  tappytoonRef: string;
  mantaRef: string;
  bookwalkerRef: string;
}

export interface SponsoredBannerConfig {
  enabled: boolean;
  badge: string;
  eyebrow: string;
  title: string;
  synopsis: string;
  studio: string;
  country: string;
  ctaLabel: string;
  ctaUrl: string;
  coverUrl: string;
}

export interface MonetizationConfig {
  enableAds: boolean;
  adsenseClientId: string;
  headerAdSlot: string;
  inFeedAdSlot: string;
  detailAdSlot: string;
  affiliates: AffiliateConfig;
  sponsoredBanner: SponsoredBannerConfig;
}

export interface RedirectClickEvent {
  title: string;
  platform: string;
  kind: 'series' | 'anime' | 'manga';
  episode: number;
  season: number;
  targetUrl: string;
  affiliateApplied: boolean;
  timestamp: string;
}

export interface RedirectAnalyticsSummary {
  totalRedirects: number;
  affiliateClicks: number;
  byCategory: {
    series: number;
    anime: number;
    manga: number;
  };
  byPlatform: Record<string, number>;
  topTitles: Array<{
    title: string;
    kind: 'series' | 'anime' | 'manga';
    count: number;
    lastClickedAt: string;
  }>;
  recentClicks: RedirectClickEvent[];
}

export interface MarketSyncResult {
  added: Series[];
  updated: Series[];
  totalSeries: number;
  syncedAt: string;
  summary: string;
  sourceUsed: string;
}

export interface CatalogResponse {
  series: Series[];
  lastRefreshed: string | null;
  lastChecked: string | null;
  sourceOnline: boolean;
  refreshing: boolean;
  editorial: EditorialPost | null;
  monetization?: MonetizationConfig;
}
