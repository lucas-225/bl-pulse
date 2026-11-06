export type AniListMediaType = 'ANIME' | 'MANGA';
export type AniListSort = 'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC' | 'START_DATE';
export const DEFAULT_MINIMUM_BL_TAG_RANK = 75 as const;
export const ALL_ANI_LIST_TAG_RANKS = 60 as const;
export type AniListTagRankFilter = typeof ALL_ANI_LIST_TAG_RANKS | typeof DEFAULT_MINIMUM_BL_TAG_RANK;

export interface MediaSeason {
  seasonNumber: number;
  id: number;
  title: string;
  format: string | null;
  episodes: number | null;
  chapters: number | null;
  startYear: number | null;
}

export interface MediaTitle {
  id: number;
  type: AniListMediaType;
  title: {
    romaji: string | null;
    english: string | null;
    native: string | null;
  };
  displayTitle: string;
  format: string | null;
  status: string | null;
  countryOfOrigin: string | null;
  genres: string[];
  description: string | null;
  startYear: number | null;
  episodes: number | null;
  chapters: number | null;
  seasons?: MediaSeason[];
  coverImage: string | null;
  bannerImage: string | null;
  averageScore: number | null;
  isAdult: boolean;
  boysLoveRank: number | null;
  streamingEpisodes: StreamingEpisode[];
  streamingLinks: StreamingLink[];
  sourceUrl: string;
}

export interface StreamingEpisode {
  title: string;
  url: string;
  site: string | null;
  thumbnail: string | null;
}

export interface StreamingLink {
  url: string;
  site: string;
}

export interface MediaPageResponse {
  type: AniListMediaType;
  page: number;
  hasNextPage: boolean;
  total: number;
  items: MediaTitle[];
  source: 'AniList';
}
