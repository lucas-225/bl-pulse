import type { MediaTitle } from './media.js';
import { DEFAULT_MINIMUM_BL_TAG_RANK } from './media.js';
import type { Series } from './types.js';

export interface SeoMetadata {
  title: string;
  description: string;
  keywords: string[];
  canonicalPath: string;
  image?: string;
  noindex?: boolean;
}

export interface SeoRoute {
  status: number;
  metadata: SeoMetadata;
}

const homeKeywords = ['BL series', 'boys love', 'BL dramas', 'BL comic', 'BL anime', 'where to watch'];
const discoverKeywords = ['BL series', 'boys love series', 'BL drama discovery', 'streaming guide', 'series search'];
const notFoundKeywords = ['BL Pulse', 'BL series', 'boys love'];

function excerpt(value: string, maximum: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maximum) return text;
  const boundary = text.lastIndexOf(' ', maximum - 1);
  return `${text.slice(0, boundary > 30 ? boundary : maximum - 1).trimEnd()}…`;
}

function missing(path: string, title = 'BL Pulse Page Not Found | BL Pulse'): SeoRoute {
  return {
    status: 404,
    metadata: {
      title,
      description: 'This BL Pulse page could not be found. Browse the catalog to discover available BL stories.',
      keywords: notFoundKeywords,
      canonicalPath: path,
      noindex: true,
    },
  };
}

export function metadataForPath(pathname: string, series?: Series, media?: MediaTitle): SeoRoute {
  const canonicalPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';

  if (canonicalPath === '/') {
    return {
      status: 200,
      metadata: {
        title: 'BL Pulse — Discover BL Series, Anime & Comics',
        description: 'Explore BL live-action series, anime, and comics (manga, manhwa & webtoons), then follow verified links to official platforms.',
        keywords: homeKeywords,
        canonicalPath,
      },
    };
  }

  if (canonicalPath === '/discover') {
    return {
      status: 200,
      metadata: {
        title: 'BL Series Discovery | BL Pulse',
        description: 'Search and explore boys’ love live-action series with current details, episodes, and links to official viewing destinations.',
        keywords: discoverKeywords,
        canonicalPath,
      },
    };
  }

  if (canonicalPath === '/anime' || canonicalPath === '/manga' || canonicalPath === '/comic') {
    const anime = canonicalPath === '/anime';
    return {
      status: 200,
      metadata: {
        title: anime ? 'BL Anime Discovery Guide | BL Pulse' : 'BL Comic (Manga, Manhwa & Webtoon) Guide | BL Pulse',
        description: anime
          ? 'Browse strictly Boys’ Love anime by title, platform, and release date with verified episode redirects.'
          : 'Browse strictly Boys’ Love comics—including Japanese manga, Korean manhwa, Chinese manhua, and webtoons—with chapter redirects.',
        keywords: anime
          ? ['BL anime', 'boys love anime', 'anime search', 'AniList', 'BL series']
          : ['BL comic', 'BL manga', 'BL manhwa', 'BL webtoon', 'boys love comics'],
        canonicalPath,
      },
    };
  }

  const seriesMatch = canonicalPath.match(/^\/series\/([^/]+)$/);
  if (seriesMatch && series) {
    const baseTitle = `${excerpt(series.title, 46)} | BL Pulse`;
    const title = baseTitle.length < 30 ? `BL Series: ${series.title} | BL Pulse` : baseTitle;
    const description = series.synopsis
      ? excerpt(`${series.title} — ${series.synopsis}`, 155)
      : excerpt(`Explore ${series.title}, a ${series.country} BL series. Review its available details and follow verified links to official viewing destinations.`, 155);
    return {
      status: 200,
      metadata: {
        title: excerpt(title, 60),
        description,
        keywords: [series.title, 'BL series', 'boys love', series.country, 'where to watch'].filter(Boolean).slice(0, 5),
        canonicalPath,
        image: series.coverUrl,
      },
    };
  }
  if (seriesMatch) return missing(canonicalPath, 'BL Series Not Found | BL Pulse');

  const mediaMatch = canonicalPath.match(/^\/(anime|manga|comic)\/(\d+)$/);
  if (mediaMatch && media && media.type === (mediaMatch[1] === 'anime' ? 'ANIME' : 'MANGA')) {
    const anime = media.type === 'ANIME';
    const title = excerpt(media.displayTitle, 32);
    const titleSuffix = ` | BL ${anime ? 'Anime' : 'Comic'} Guide | BL Pulse`;
    const description = media.description
      ? excerpt(`${media.displayTitle} — ${media.description}`, 155)
      : `Discover ${media.displayTitle}, tagged Boys’ Love by AniList. View the source tags and available ${anime ? 'episode' : 'chapter'} destinations.`;
    return {
      status: 200,
      metadata: {
        title: `${title}${titleSuffix}`,
        description,
        keywords: [media.displayTitle, `BL ${anime ? 'anime' : 'comic'}`, 'boys love', 'AniList', 'streaming guide'],
        canonicalPath,
        image: media.coverImage ?? undefined,
        noindex: media.isAdult || (media.boysLoveRank !== null && media.boysLoveRank < DEFAULT_MINIMUM_BL_TAG_RANK) || undefined,
      },
    };
  }
  if (mediaMatch) return missing(canonicalPath, `BL ${mediaMatch[1] === 'anime' ? 'Anime' : 'Comic'} Title Not Found | BL Pulse`);

  return missing(canonicalPath);
}
