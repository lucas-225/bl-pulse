export type SeriesStatus = 'airing' | 'upcoming' | 'completed';

export interface PlatformLink {
  name: string;
  url: string;
  source: 'TMDB' | 'JustWatch' | 'official';
}

export interface SeriesEpisodeLink {
  number: number;
  title: string;
  url: string;
  platform: string;
}

export interface SeriesSeason {
  seasonNumber: number;
  title: string;
  episodes: number;
  year?: number;
  seriesId?: string;
}

export interface Series {
  id: string;
  title: string;
  country: string;
  status: SeriesStatus;
  sourceUrl: string;
  coverUrl?: string;
  synopsis?: string;
  year?: number;
  releaseDate?: string;
  episodes?: number;
  seasons?: SeriesSeason[];
  episodeLinks?: SeriesEpisodeLink[];
  genres: string[];
  platforms: PlatformLink[];
  updatedAt: string;
  detailFetchedAt?: string;
}

export interface EditorialPost {
  title: string;
  body: string;
  generatedAt: string;
  source: 'AI-assisted' | 'BL Pulse';
}

export interface CatalogResponse {
  series: Series[];
  lastRefreshed: string | null;
  lastChecked: string | null;
  sourceOnline: boolean;
  refreshing: boolean;
  error?: string;
  editorial: EditorialPost | null;
}
