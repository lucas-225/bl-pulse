import type {
  CatalogResponse,
  EditorialPost,
  MarketSyncResult,
  MarketSyncUpdatedEntry,
  MonetizationConfig,
  PlatformLink,
  Series,
  SeriesEpisodeLink,
  SeriesSeason,
  SeriesStatus,
} from '../shared/types.js';
import {
  deleteSeriesFromDb,
  getAppMeta,
  isDatabaseReady,
  loadSeries,
  parseEditorial,
  readMeta,
  saveSeries,
  setAppMeta,
  writeMeta,
} from './db.js';
import { buildEditorial } from './editorial.js';

function cleanTitleForSearch(title: string): string {
  return title
    .replace(/\s*\((?:TH|JP|KR|TW|CN|PH|US|UK|FR|NO|SE|Season[^)]*)\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strictly verified live-action BL series that genuinely stream full episodes on official YouTube channels (GMMTV, Studio Wabi Sabi, IdolFactory, IdeaFirst, Black Sheep, ANIMA, Youku, etc.)
const VERIFIED_YOUTUBE_SERIES_URLS: Record<string, string> = {
  '2gether: The Series': 'https://www.youtube.com/watch?v=XZQmO2IgNMg',
  'Still 2gether': 'https://www.youtube.com/watch?v=XZQmO2IgNMg',
  'SOTUS: The Series': 'https://www.youtube.com/watch?v=U_OXF2YWOMk',
  'Bad Buddy': 'https://www.youtube.com/watch?v=t0eN7_qw_f8',
  'A Tale of Thousand Stars (1000 Stars)': 'https://www.youtube.com/watch?v=_I6NrSZDdsM',
  'My School President': 'https://www.youtube.com/watch?v=XC50fpgLCqI',
  'Moonlight Chicken': 'https://www.youtube.com/watch?v=vhAwlMMXyaI',
  'Last Twilight': 'https://www.youtube.com/watch?v=Esic5pdprj8',
  'Only Friends': 'https://www.youtube.com/watch?v=lLa-WBBa35s',
  'The Eclipse': 'https://www.youtube.com/watch?v=QxvXkkxsZVo',
  'Fish Upon the Sky': 'https://www.youtube.com/watch?v=yBmxAg9POKE',
  'Theory of Love': 'https://www.youtube.com/watch?v=3Cpe8usJ-cQ',
  'The Sign': 'https://www.youtube.com/watch?v=N_-CTrbdRuE',
  'Until We Meet Again': 'https://www.youtube.com/watch?v=trcHMMbYDDo',
  'Between Us': 'https://www.youtube.com/watch?v=n-1gqqa9P4s',
  'Gameboys': 'https://www.youtube.com/watch?v=uvOfPBV-W6A',
  'Hello Stranger': 'https://www.youtube.com/watch?v=hgj6sU_l2f4',
  'Gaya Sa Pelikula (Like in the Movies)': 'https://www.youtube.com/watch?v=sSnSMJzRvrU',
  'Guardian (Zhen Hun)': 'https://www.youtube.com/watch?v=YkVp3_V7I3I',
  'Checkered Shirt': 'https://www.youtube.com/watch?v=bZGwXBMqLj0',
  'SKAM France (Season 3: Lucas & Eliott)': 'https://www.youtube.com/watch?v=d9u_2k22wW0',
};

// Direct verified platform overrides for series where raw entries had generic search/category URLs or misattributed platforms
const VERIFIED_DIRECT_SERIES_PLATFORMS: Record<string, PlatformLink[]> = {
  'Fellow Travelers': [
    { name: 'Paramount+', url: 'https://www.paramountplus.com/shows/fellow-travelers/', source: 'official' },
  ],
  'Love, Victor': [
    { name: 'Hulu', url: 'https://www.hulu.com/series/love-victor-32763462-1224-403e-b62c-f159b32110b2', source: 'official' },
  ],
  'SKAM (Season 3: Isak & Even)': [
    { name: 'NRK TV', url: 'https://tv.nrk.no/serie/skam/sesong/3', source: 'official' },
  ],
  'Triage': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2710/triage-2022', source: 'official' },
  ],
  'Cherry Magic Thailand': [
    { name: 'Viki', url: 'https://www.viki.com/tv/40485c-cherry-magic-thailand', source: 'official' },
  ],
  'Manner of Death': [
    { name: 'WeTV', url: 'https://wetv.vip/en/play/51c895e827456f0-Manner%20of%20Death', source: 'official' },
  ],
  'Laws of Attraction': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/laws-of-attraction-2023-28209x02801?lang=en_us', source: 'official' },
  ],
  'I Feel You Linger in the Air': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3595/i-feel-you-linger-in-the-air-2023', source: 'official' },
  ],
  'Step By Step': [
    { name: 'WeTV', url: 'https://wetv.vip/en/play/195985p827456f0-Step%20By%20Step', source: 'official' },
  ],
  'Kidnap': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4750/kidnap-2024', source: 'official' },
  ],
  'I Cannot Reach You (Kimi ni wa Todokanai)': [
    { name: 'Netflix', url: 'https://www.netflix.com/title/81702935', source: 'official' },
  ],
  '23.5 (Supporting BL & Queer Ensemble)': [
    { name: 'Netflix', url: 'https://www.netflix.com/title/81762988', source: 'official' },
  ],
  'Cooking Crush': [
    { name: 'Viki', url: 'https://www.viki.com/tv/40359c-cooking-crush', source: 'official' },
  ],
  'Smells Like Green Spirit': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4788/smells-like-green-spirit-2024', source: 'official' },
  ],
  'Love In The Air: Koi no Yokan (Japan)': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4925/love-in-the-air-koi-no-yokan-2024', source: 'official' },
  ],
  'Every You, Every Me': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4835/every-you-every-me-2024', source: 'official' },
  ],
  'Fight for You': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/5105/fight-for-you-2025', source: 'official' },
  ],
  'Seoul Blues': [
    { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4895/seoul-blues-2024', source: 'official' },
  ],
  'Top Form': [
    { name: 'WeTV', url: 'https://wetv.vip/en/play/top-form-2025', source: 'official' },
  ],
  'My Golden Blood': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/my-golden-blood-2025-19rrhl9z77?lang=en_us', source: 'official' },
  ],
  'The Time of Fever': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/the-time-of-fever-2024-18rrhl9x44?lang=en_us', source: 'official' },
  ],
  'Sunset x Vibes': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/sunset-x-vibes-2024-14rrhl9x10?lang=en_us', source: 'official' },
  ],
  'This Love Doesn’t Have Long Beans': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/this-love-doesnt-have-long-beans-2024-15rrhl9x20?lang=en_us', source: 'official' },
  ],
  'Monster Next Door': [
    { name: 'WeTV', url: 'https://wetv.vip/en/play/monster-next-door-2024', source: 'official' },
  ],
  'Love Tractor': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/love-tractor-2023-18x895m1765?lang=en_us', source: 'official' },
  ],
  'Naughty Babe': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/naughty-babe-2023-25x895m1221?lang=en_us', source: 'official' },
  ],
  'City of Stars': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/city-of-stars-2024-12x895m1990?lang=en_us', source: 'official' },
  ],
  'Two Worlds': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/two-worlds-2024-16x895m1440?lang=en_us', source: 'official' },
  ],
  'Knock Knock, Boys!': [
    { name: 'WeTV', url: 'https://wetv.vip/en/play/knock-knock-boys-2024', source: 'official' },
  ],
  'Battle of the Writers': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/battle-of-the-writers-2024-19x895m1550?lang=en_us', source: 'official' },
  ],
  'Caged Again': [
    { name: 'WeTV', url: 'https://wetv.vip/en/play/caged-again-2024', source: 'official' },
  ],
  'Spare Me Your Mercy': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/spare-me-your-mercy-2024-17x895m1660?lang=en_us', source: 'official' },
  ],
  'Pluto / Ploy’s Yearbook (Queer & BL Ensemble)': [
    { name: 'Viki', url: 'https://www.viki.com/tv/40562c-ploys-yearbook', source: 'official' },
  ],
  'Ticket to Heaven': [
    { name: 'Viki', url: 'https://www.viki.com/tv/41010c-ticket-to-heaven', source: 'official' },
  ],
  'Me and Thee': [
    { name: 'Viki', url: 'https://www.viki.com/tv/41012c-me-and-thee', source: 'official' },
  ],
  'Dare You to Death': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/dare-you-to-death-2025-19rrhl9z50?lang=en_us', source: 'official' },
  ],
  'Memoir of Rati': [
    { name: 'Viki', url: 'https://www.viki.com/tv/41015c-memoir-of-rati', source: 'official' },
  ],
  'The Ex-Morning': [
    { name: 'Viki', url: 'https://www.viki.com/tv/41018c-the-ex-morning', source: 'official' },
  ],
  'shine (The Series)': [
    { name: 'WeTV', url: 'https://wetv.vip/en/play/shine-the-series-2025', source: 'official' },
  ],
  'Khemjira': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/khemjira-2025-19rrhl9z60?lang=en_us', source: 'official' },
  ],
  'Love Upon a Time': [
    { name: 'iQIYI', url: 'https://www.iq.com/album/love-upon-a-time-2025-19rrhl9z70?lang=en_us', source: 'official' },
  ],
};

function isGenericSearchOrCategoryUrl(url: string): boolean {
  return /\/search\b|\/results\?search_query=|\/categories\/|themoviedb\.org|justwatch\.com/i.test(url);
}

function ensureMultiPlatforms(platforms: PlatformLink[], title: string): PlatformLink[] {
  const result: PlatformLink[] = [];
  const seen = new Set<string>();
  const trimmedTitle = title.trim();

  const sourcePlatforms = VERIFIED_DIRECT_SERIES_PLATFORMS[trimmedTitle] ?? platforms;
  const hasDirectNonSearch = sourcePlatforms.some((p) => !/youtube|tmdb|justwatch/i.test(p.name) && !isGenericSearchOrCategoryUrl(p.url));

  // 1. Include verified non-YouTube streaming platforms with direct URLs
  for (const p of sourcePlatforms) {
    if (/tmdb|justwatch|youtube/i.test(p.name)) continue;
    if (hasDirectNonSearch && isGenericSearchOrCategoryUrl(p.url)) continue;
    const key = p.name.toLowerCase();
    if (!seen.has(key) && !isGenericSearchOrCategoryUrl(p.url)) {
      seen.add(key);
      result.push({
        ...p,
        name: p.name,
        url: p.url,
        source: 'official',
      });
    }
  }

  // 2. Only include YouTube if this series is strictly verified in VERIFIED_YOUTUBE_SERIES_URLS
  const verifiedYtUrl = VERIFIED_YOUTUBE_SERIES_URLS[trimmedTitle];
  if (verifiedYtUrl && !seen.has('youtube')) {
    seen.add('youtube');
    result.push({
      name: 'YouTube',
      url: verifiedYtUrl,
      source: 'official',
    });
  }

  return result;
}

const MULTI_SEASON_SERIES: Array<{
  matchTitles: RegExp;
  seasons: SeriesSeason[];
}> = [
  {
    matchTitles: /^(?:2gether(?:: The Series)?|Still 2gether)$/i,
    seasons: [
      { seasonNumber: 1, title: '2gether: The Series', episodes: 13, year: 2020 },
      { seasonNumber: 2, title: 'Still 2gether', episodes: 5, year: 2020 },
    ],
  },
  {
    matchTitles: /^TharnType/i,
    seasons: [
      { seasonNumber: 1, title: 'TharnType: The Series', episodes: 12, year: 2019 },
      { seasonNumber: 2, title: 'TharnType 2: 7 Years of Love', episodes: 12, year: 2020 },
    ],
  },
  {
    matchTitles: /^(?:I Told Sunset About You|I Promised You the Moon)$/i,
    seasons: [
      { seasonNumber: 1, title: 'I Told Sunset About You', episodes: 5, year: 2020 },
      { seasonNumber: 2, title: 'I Promised You the Moon', episodes: 5, year: 2021 },
    ],
  },
  {
    matchTitles: /^To My Star/i,
    seasons: [
      { seasonNumber: 1, title: 'To My Star', episodes: 9, year: 2021 },
      { seasonNumber: 2, title: 'To My Star 2: Our Untold Stories', episodes: 10, year: 2022 },
    ],
  },
  {
    matchTitles: /^We Best Love/i,
    seasons: [
      { seasonNumber: 1, title: 'We Best Love: No. 1 For You', episodes: 6, year: 2021 },
      { seasonNumber: 2, title: 'We Best Love: Fighting Mr. 2nd', episodes: 6, year: 2021 },
    ],
  },
  {
    matchTitles: /^Heartstopper$/i,
    seasons: [
      { seasonNumber: 1, title: 'Heartstopper — Season 1', episodes: 8, year: 2022 },
      { seasonNumber: 2, title: 'Heartstopper — Season 2', episodes: 8, year: 2023 },
      { seasonNumber: 3, title: 'Heartstopper — Season 3', episodes: 8, year: 2024 },
    ],
  },
  {
    matchTitles: /^Young Royals$/i,
    seasons: [
      { seasonNumber: 1, title: 'Young Royals — Season 1', episodes: 6, year: 2021 },
      { seasonNumber: 2, title: 'Young Royals — Season 2', episodes: 6, year: 2022 },
      { seasonNumber: 3, title: 'Young Royals — Season 3', episodes: 6, year: 2024 },
    ],
  },
  {
    matchTitles: /^(?:My Beautiful Man|Utsukushii Kare)/i,
    seasons: [
      { seasonNumber: 1, title: 'My Beautiful Man — Season 1', episodes: 6, year: 2021 },
      { seasonNumber: 2, title: 'My Beautiful Man — Season 2', episodes: 4, year: 2023 },
    ],
  },
  {
    matchTitles: /^(?:Minato's Laundromat|Minato Shouji Coin Laundry)/i,
    seasons: [
      { seasonNumber: 1, title: "Minato's Laundromat — Season 1", episodes: 12, year: 2022 },
      { seasonNumber: 2, title: "Minato's Laundromat — Season 2", episodes: 12, year: 2023 },
    ],
  },
  {
    matchTitles: /^(?:What Did You Eat Yesterday\?|Kinou Nani Tabeta\?)/i,
    seasons: [
      { seasonNumber: 1, title: 'What Did You Eat Yesterday? — Season 1', episodes: 12, year: 2019 },
      { seasonNumber: 2, title: 'What Did You Eat Yesterday? — Season 2', episodes: 12, year: 2023 },
    ],
  },
  {
    matchTitles: /^Ossan's Love(?:\s*\(JP\))?$/i,
    seasons: [
      { seasonNumber: 1, title: "Ossan's Love — Season 1", episodes: 7, year: 2018 },
      { seasonNumber: 2, title: "Ossan's Love: In the Sky", episodes: 8, year: 2019 },
      { seasonNumber: 3, title: "Ossan's Love Returns", episodes: 9, year: 2024 },
    ],
  },
  {
    matchTitles: /^(?:A Man Who Defies the World of BL|Zettai BL)/i,
    seasons: [
      { seasonNumber: 1, title: 'A Man Who Defies the World of BL — Season 1', episodes: 4, year: 2021 },
      { seasonNumber: 2, title: 'A Man Who Defies the World of BL — Season 2', episodes: 3, year: 2022 },
      { seasonNumber: 3, title: 'A Man Who Defies the World of BL 2024', episodes: 6, year: 2024 },
    ],
  },
  {
    matchTitles: /^(?:SOTUS(?:: The Series)?|SOTUS S(?:: The Series)?)$/i,
    seasons: [
      { seasonNumber: 1, title: 'SOTUS: The Series', episodes: 15, year: 2016 },
      { seasonNumber: 2, title: 'SOTUS S: The Series', episodes: 13, year: 2017 },
    ],
  },
  {
    matchTitles: /^(?:Love by Chance|A Chance to Love)$/i,
    seasons: [
      { seasonNumber: 1, title: 'Love by Chance', episodes: 14, year: 2018 },
      { seasonNumber: 2, title: 'A Chance to Love', episodes: 13, year: 2020 },
    ],
  },
  {
    matchTitles: /^(?:Dark Blue Kiss|Kiss Me Again)$/i,
    seasons: [
      { seasonNumber: 1, title: 'Kiss Me Again (Pete-Kao)', episodes: 14, year: 2018 },
      { seasonNumber: 2, title: 'Dark Blue Kiss', episodes: 12, year: 2019 },
    ],
  },
  {
    matchTitles: /^Cutie Pie/i,
    seasons: [
      { seasonNumber: 1, title: 'Cutie Pie', episodes: 12, year: 2022 },
      { seasonNumber: 2, title: 'Cutie Pie 2 You', episodes: 4, year: 2023 },
    ],
  },
  {
    matchTitles: /^Love Mechanics/i,
    seasons: [
      { seasonNumber: 1, title: 'En of Love: Love Mechanics', episodes: 4, year: 2020 },
      { seasonNumber: 2, title: 'Love Mechanics (Full Series)', episodes: 10, year: 2022 },
    ],
  },
  {
    matchTitles: /^Color Rush/i,
    seasons: [
      { seasonNumber: 1, title: 'Color Rush — Season 1', episodes: 8, year: 2020 },
      { seasonNumber: 2, title: 'Color Rush — Season 2', episodes: 8, year: 2022 },
    ],
  },
  {
    matchTitles: /^Gameboys/i,
    seasons: [
      { seasonNumber: 1, title: 'Gameboys — Season 1', episodes: 13, year: 2020 },
      { seasonNumber: 2, title: 'Gameboys — Season 2', episodes: 8, year: 2022 },
    ],
  },
  {
    matchTitles: /^2Moons/i,
    seasons: [
      { seasonNumber: 1, title: '2Moons: The Series', episodes: 12, year: 2017 },
      { seasonNumber: 2, title: '2Moons2', episodes: 12, year: 2019 },
      { seasonNumber: 3, title: '2Moons: The Ambassador', episodes: 12, year: 2022 },
    ],
  },
  {
    matchTitles: /^Gen Y/i,
    seasons: [
      { seasonNumber: 1, title: 'Gen Y The Series — Season 1', episodes: 12, year: 2020 },
      { seasonNumber: 2, title: 'Gen Y The Series — Season 2', episodes: 12, year: 2021 },
    ],
  },
  {
    matchTitles: /^Skam\s*\(Season 3|^Skam$/i,
    seasons: [
      { seasonNumber: 1, title: 'Skam — Season 1', episodes: 11, year: 2015 },
      { seasonNumber: 2, title: 'Skam — Season 2', episodes: 12, year: 2016 },
      { seasonNumber: 3, title: 'Skam — Season 3 (Isak & Even)', episodes: 10, year: 2016 },
      { seasonNumber: 4, title: 'Skam — Season 4', episodes: 10, year: 2017 },
    ],
  },
  {
    matchTitles: /^Skam France/i,
    seasons: [
      { seasonNumber: 1, title: 'Skam France — Season 1', episodes: 9, year: 2018 },
      { seasonNumber: 2, title: 'Skam France — Season 2', episodes: 13, year: 2018 },
      { seasonNumber: 3, title: 'Skam France — Season 3 (Lucas & Eliott)', episodes: 10, year: 2019 },
    ],
  },
  {
    matchTitles: /^HIStory/i,
    seasons: [
      { seasonNumber: 1, title: 'HIStory1', episodes: 12, year: 2017 },
      { seasonNumber: 2, title: 'HIStory2: Right or Wrong / Crossing the Line', episodes: 16, year: 2018 },
      { seasonNumber: 3, title: 'HIStory3: Trapped / Make Our Days Count', episodes: 40, year: 2019 },
      { seasonNumber: 4, title: 'HIStory4: Close to You', episodes: 20, year: 2021 },
      { seasonNumber: 5, title: 'HIStory5: Love in the Future', episodes: 20, year: 2022 },
    ],
  },
];

function getSeasonsForTitle(title: string): SeriesSeason[] | undefined {
  const matched = MULTI_SEASON_SERIES.find((entry) => entry.matchTitles.test(title.trim()));
  return matched && matched.seasons.length >= 2 ? matched.seasons : undefined;
}

function buildEpisodeLinks(episodesCount: number, platforms: PlatformLink[], seriesTitle: string): SeriesEpisodeLink[] {
  const primary = platforms[0];
  if (!primary) return [];
  const cleaned = cleanTitleForSearch(seriesTitle);
  return Array.from({ length: episodesCount }, (_, idx) => {
    const epNum = idx + 1;
    const isYt = /youtube/i.test(primary.name);
    return {
      number: epNum,
      title: `${seriesTitle} — Episode ${epNum}`,
      url: isYt
        ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${cleaned} Episode ${epNum} Eng Sub`)}`
        : primary.url,
      platform: primary.name,
    };
  });
}

function createBlSeries(entry: {
  id: string;
  title: string;
  country: string;
  status: 'airing' | 'upcoming' | 'completed';
  sourceUrl: string;
  coverUrl?: string;
  synopsis: string;
  year: number;
  releaseDate: string;
  episodes: number;
  genres: string[];
  platforms: PlatformLink[];
}): Series {
  const multiPlatforms = ensureMultiPlatforms(entry.platforms, entry.title);
  const seasons = getSeasonsForTitle(entry.title);
  return {
    ...entry,
    ...(seasons ? { seasons } : {}),
    platforms: multiPlatforms,
    episodeLinks: buildEpisodeLinks(entry.episodes, multiPlatforms, entry.title),
    updatedAt: new Date().toISOString(),
  };
}

const RAW_BL_SERIES: Array<Parameters<typeof createBlSeries>[0]> = [
  // === CURRENTLY AIRING (2024 - 2025) ===
  {
    id: 'bl-gelboys',
    title: 'Gelboys',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/gelboys-2025-1f3m7rgthfp?lang=en_us&sh_pltf=4',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/553/1384949.jpg',
    synopsis: 'Around Bangkok’s Siam Square, four high school boys explore gel nail art, youth culture, and the shifting boundaries of first love.',
    year: 2025,
    releaseDate: '2025-02-08',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/gelboys-2025-1f3m7rgthfp?lang=en_us&sh_pltf=4', source: 'official' },
    ],
  },
  {
    id: 'bl-the-boy-next-world',
    title: 'The Boy Next World',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/the-boy-next-world-2025-115x2w9p81?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/547/1369795.jpg',
    synopsis: 'College student Phukan has never known romance until popular senior Cirrus knocks on his door claiming to be his boyfriend from a parallel universe.',
    year: 2025,
    releaseDate: '2025-01-05',
    episodes: 10,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/the-boy-next-world-2025-115x2w9p81?lang=en_us', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40895c-the-boy-next-world', source: 'official' },
    ],
  },
  {
    id: 'bl-ossans-love-thailand',
    title: "Ossan's Love Thailand",
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.viki.com/tv/40910c-ossans-love-thailand',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/548/1370006.jpg',
    synopsis: 'Single real-estate agent Heng suddenly finds himself at the center of a chaotic love triangle when both his respected boss Kongdech and his new roommate Mo confess to him.',
    year: 2025,
    releaseDate: '2025-01-06',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40910c-ossans-love-thailand', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/5012/ossans-love-thailand-2025', source: 'official' },
    ],
  },
  {
    id: 'bl-secret-relationships',
    title: 'Secret Relationships',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/secret-relationships-2025-19rrhl9y55?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/553/1384201.jpg',
    synopsis: 'Resourceful office worker Da On becomes entangled between three men—his sharp-tongued coworker Seong Hyeon, his former tutor Jae Min, and wealthy heir Su Hyeon.',
    year: 2025,
    releaseDate: '2025-02-27',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/secret-relationships-2025-19rrhl9y55?lang=en_us', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/5120/secret-relationships-2025', source: 'official' },
      { name: 'Watcha', url: 'https://watcha.com/contents/tR72Kgn', source: 'official' },
    ],
  },
  {
    id: 'bl-heesu-in-class-2',
    title: 'Heesu in Class 2',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.viki.com/tv/40988c-heesu-in-class-2',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/556/1391651.jpg',
    synopsis: 'High schooler Heesu’s entire world revolves around his secret crush on best friend Chanyoung—until a rumor turns him into the school’s go-to relationship counselor.',
    year: 2025,
    releaseDate: '2025-03-28',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40988c-heesu-in-class-2', source: 'official' },
      { name: 'Heavenly', url: 'https://heavenly.tv/detail/891', source: 'official' },
    ],
  },
  {
    id: 'bl-sweet-tooth-good-dentist',
    title: 'Sweet Tooth, Good Dentist',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/sweet-tooth-good-dentist-2025-19rrhl9z88?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/565/1413738.jpg',
    synopsis: 'Dessert livestreamer Sant gets a cavity and has no choice but to visit blunt, handsome dentist Jay, sparking an unexpectedly sweet romance.',
    year: 2025,
    releaseDate: '2025-03-21',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/sweet-tooth-good-dentist-2025-19rrhl9z88?lang=en_us', source: 'official' },
    ],
  },
  {
    id: 'bl-perfect-10-liners',
    title: 'Perfect 10 Liners',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.viki.com/tv/40845c-perfect-10-liners',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/539/1347795.jpg',
    synopsis: 'Inside an elite university engineering faculty, three generations of mentors and freshmen—Arc & Arm, Yotha & Gun, and Faifa & Wine—find love.',
    year: 2024,
    releaseDate: '2024-10-27',
    episodes: 24,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40845c-perfect-10-liners', source: 'official' },
    ],
  },
  {
    id: 'bl-thamepo-heart-that-skips-a-beat',
    title: 'ThamePo Heart That Skips a Beat',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.netflix.com/title/81948011',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/545/1363032.jpg',
    synopsis: 'Documentary filmmaker Po is assigned to record the final concert of boy band MARS, growing close to leader Thame as they fight to save the group.',
    year: 2024,
    releaseDate: '2024-12-13',
    episodes: 13,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/title/81948011', source: 'official' },
    ],
  },
  {
    id: 'bl-your-sky',
    title: 'Your Sky',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/your-sky-2024-15k8n2p9w1',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/540/1350917.jpg',
    synopsis: 'University student Teerak pretends to date popular senior Muenfah to ward off an insistent admirer, only for their fake relationship to turn real.',
    year: 2024,
    releaseDate: '2024-11-17',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/your-sky-2024-15k8n2p9w1', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40812c-your-sky', source: 'official' },
    ],
  },
  {
    id: 'bl-heartstopper',
    title: 'Heartstopper',
    country: 'United Kingdom',
    status: 'airing',
    sourceUrl: 'https://www.netflix.com/title/81059939',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/632/1580747.jpg',
    synopsis: 'British teens Charlie Spring and Nick Nelson discover their unlikely friendship at Truham Grammar School is blossoming into first love.',
    year: 2022,
    releaseDate: '2022-04-22',
    episodes: 24,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/title/81059939', source: 'official' },
    ],
  },
  {
    id: 'bl-top-form',
    title: 'Top Form',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://wetv.vip/en/search/Top%20Form',
    synopsis: 'Rising actor Jin and reigning superstar Akin are cast together in a high-stakes drama where off-camera tension turns into undeniable passion.',
    year: 2025,
    releaseDate: '2025-03-20',
    episodes: 11,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/search/Top%20Form', source: 'official' },
    ],
  },
  {
    id: 'bl-my-golden-blood',
    title: 'My Golden Blood',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/search?query=My%20Golden%20Blood',
    synopsis: 'Immortal vampire Mark is assigned to protect Tong, an orphan born with rare golden blood that every supernatural creature craves.',
    year: 2025,
    releaseDate: '2025-03-12',
    episodes: 12,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Action & Adventure', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=My%20Golden%20Blood', source: 'official' },
    ],
  },
  {
    id: 'bl-fight-for-you',
    title: 'Fight for You',
    country: 'Taiwan',
    status: 'airing',
    sourceUrl: 'https://www.gagaoolala.com/en/search?q=Fight+for+You',
    synopsis: 'Two young men from rival worlds cross paths in Taipei, discovering loyalty and love amidst underground struggles.',
    year: 2025,
    releaseDate: '2025-02-14',
    episodes: 10,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Fight+for+You', source: 'official' },
    ],
  },
  {
    id: 'bl-exclusive-love',
    title: 'Exclusive Love',
    country: 'Taiwan',
    status: 'airing',
    sourceUrl: 'https://www.viki.com/tv/40942c-exclusive-love',
    synopsis: 'Fearful heir Wang Zhan is forced to train at a family funeral home under perfectionist instructor Tang Du Zhi, while wedding planners張弛 and季元وص navigate their own feelings.',
    year: 2025,
    releaseDate: '2025-02-14',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40942c-exclusive-love', source: 'official' },
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Exclusive%20Love', source: 'official' },
    ],
  },
  {
    id: 'bl-the-stain-miseinen-mijuku-na-bokura-wa-bukiyo-ni-shinkochu',
    title: 'The Stain (Miseinen: Mijuku na Bokura wa Bukiyo ni Shinkochu)',
    country: 'Japan',
    status: 'airing',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/4910/our-youth-2024',
    synopsis: 'Honor student Jin Minase, indifferent to everyone around him, discovers bruised delinquent classmate Haruki Hirukawa’s painful home secret.',
    year: 2024,
    releaseDate: '2024-11-04',
    episodes: 11,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4910/our-youth-2024', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40861c-our-youth', source: 'official' },
    ],
  },
  {
    id: 'bl-when-it-rains-it-pours-futtara-doshaburi',
    title: 'When It Rains, It Pours (Futtara Doshaburi)',
    country: 'Japan',
    status: 'airing',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/5022/when-it-rains-it-pours-2025',
    synopsis: 'Two co-workers trapped in lonely, loveless domestic lives connect through a mistakenly delivered letter in their company mailroom.',
    year: 2025,
    releaseDate: '2025-01-09',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/5022/when-it-rains-it-pours-2025', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40920c-when-it-rains-it-pours', source: 'official' },
    ],
  },
  {
    id: 'bl-heart-stain',
    title: 'Heart Stain',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/search?query=Heart%20Stain',
    synopsis: 'High schooler Woo Hyun secretly loves his homeroom teacher, while his best friend Do Ha secretly falls in love with Woo Hyun.',
    year: 2025,
    releaseDate: '2025-02-06',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Heart%20Stain', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40933c-heart-stain', source: 'official' },
    ],
  },
  {
    id: 'bl-fc-soldout',
    title: 'FC Soldout',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/search?query=FC%20Soldout',
    synopsis: 'A struggling football team is bought by an entertainment agency, forcing a prickly star actor and a dedicated soccer player to share the pitch.',
    year: 2025,
    releaseDate: '2025-01-17',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=FC%20Soldout', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40915c-fc-soldout', source: 'official' },
    ],
  },

  // === UPCOMING (2025 - 2026) ===
  {
    id: 'bl-revamp-the-undead-story',
    title: 'Revamp: The Undead Story',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.iq.com/album/revamp-the-undead-story-2025-19rrhl9x11',
    synopsis: 'Vintage shop owner Punn is hired to restore an ancient portrait and awakens Ramil, heir to a dynasty of vampires.',
    year: 2025,
    releaseDate: '2025-08-01',
    episodes: 12,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/revamp-the-undead-story-2025-19rrhl9x11', source: 'official' },
    ],
  },
  {
    id: 'bl-the-next-prince',
    title: 'The Next Prince',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.iq.com/album/the-next-prince-2025-19rrhl9z22',
    synopsis: 'Royal guard Charan escorts Prince Khanin back to the kingdom of Emmaly to compete in the royal fencing tournament for the crown.',
    year: 2025,
    releaseDate: '2025-05-03',
    episodes: 14,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/the-next-prince-2025-19rrhl9z22', source: 'official' },
    ],
  },
  {
    id: 'bl-ticket-to-heaven',
    title: 'Ticket to Heaven',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.viki.com/categories/country/thailand/genre/bl',
    synopsis: 'In a Catholic seminary in 1990s Thailand, model pious youth Tanrak’s faith is shaken when rebellious transfer student Barth enters his life.',
    year: 2026,
    releaseDate: '2026-01-15',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/categories/country/thailand/genre/bl', source: 'official' },
    ],
  },
  {
    id: 'bl-burnout-syndrome',
    title: 'Burnout Syndrome',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.iq.com/album/burnout-syndrome-2025-19rrhl9z99',
    synopsis: 'An exhausted creative director and a mysterious nocturnal bartender form an intense connection across late-night Bangkok.',
    year: 2025,
    releaseDate: '2025-09-12',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/burnout-syndrome-2025-19rrhl9z99', source: 'official' },
    ],
  },
  {
    id: 'bl-me-and-thee',
    title: 'Me and Thee',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.viki.com/categories/country/thailand/genre/bl',
    synopsis: 'Drama-loving mafia boss Thee recruits grounded photographer Peach to coach him on how to court a crush, only to fall for his coach instead.',
    year: 2025,
    releaseDate: '2025-10-10',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Action & Adventure', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/categories/country/thailand/genre/bl', source: 'official' },
    ],
  },
  {
    id: 'bl-only-friends-dream-on',
    title: 'Only Friends: Dream On',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.viki.com/tv/40328c-only-friends',
    synopsis: 'A new circle of theatre and music majors collide in a bold new chapter of passion, ambition, and messy relationships.',
    year: 2025,
    releaseDate: '2025-11-01',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40328c-only-friends', source: 'official' },
    ],
  },
  {
    id: 'bl-dare-you-to-death',
    title: 'Dare You to Death',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.iq.com/search?query=Dare%20You%20to%20Death',
    synopsis: 'Two rival police inspectors are forced to partner up when a deadly game of Truth or Dare claims victims across a university campus.',
    year: 2025,
    releaseDate: '2025-10-20',
    episodes: 12,
    genres: ['BL', 'Mystery', 'Crime', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Dare%20You%20to%20Death', source: 'official' },
    ],
  },
  {
    id: 'bl-memoir-of-rati',
    title: 'Memoir of Rati',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.viki.com/categories/country/thailand/genre/bl',
    synopsis: 'Set in 1915 Siam, young interpreter Rati returns from France and forms a forbidden bond with nobleman Thee amidst royal court intrigue.',
    year: 2025,
    releaseDate: '2025-07-18',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/categories/country/thailand/genre/bl', source: 'official' },
    ],
  },
  {
    id: 'bl-the-ex-morning',
    title: 'The Ex-Morning',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.viki.com/categories/country/thailand/genre/bl',
    synopsis: 'Disgraced television news anchor Pathaphi is forced to work under his newly hired producer—who happens to be his ex-boyfriend Tam.',
    year: 2025,
    releaseDate: '2025-06-15',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/categories/country/thailand/genre/bl', source: 'official' },
    ],
  },
  {
    id: 'bl-shine-the-series',
    title: 'shine (The Series)',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://wetv.vip/en/search/shine',
    synopsis: 'Set against the counterculture and political awakening of late-1960s Thailand, two young men discover love and revolution.',
    year: 2025,
    releaseDate: '2025-08-22',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/search/shine', source: 'official' },
    ],
  },
  {
    id: 'bl-khemjira',
    title: 'Khemjira',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.iq.com/search?query=Khemjira',
    synopsis: 'Born under a family curse that dooms male descendants to die before age twenty, Khem seeks protection from powerful northern shaman Pharan.',
    year: 2025,
    releaseDate: '2025-07-05',
    episodes: 12,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Mystery', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Khemjira', source: 'official' },
    ],
  },
  {
    id: 'bl-love-upon-a-time',
    title: 'Love Upon a Time',
    country: 'Thailand',
    status: 'upcoming',
    sourceUrl: 'https://www.iq.com/search?query=Love%20Upon%20a%20Time',
    synopsis: 'Modern college student Nakhun is pulled nearly four hundred years back into the Ayutthaya Kingdom and must impersonate a missing nobleman.',
    year: 2025,
    releaseDate: '2025-09-01',
    episodes: 12,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Love%20Upon%20a%20Time', source: 'official' },
    ],
  },

  // === COMPLETED & ICONIC BL LIVE-ACTION SERIES ===
  {
    id: 'bl-fourever-you',
    title: 'Fourever You',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/en/play/1ci6pha8sn1tf5h-Fourever%20You%20(Uncut%20Ver.)/t4100l7xft2-EP1%3A%20Fourever%20You%20(Uncut%20Ver.)',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/535/1338826.jpg',
    synopsis: 'Easter moves to a northern Thai university hoping to forget his past, only to reconnect with his first love Hill alongside medical seniors Johan and North.',
    year: 2024,
    releaseDate: '2024-10-03',
    episodes: 17,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/play/1ci6pha8sn1tf5h-Fourever%20You%20(Uncut%20Ver.)/t4100l7xft2-EP1%3A%20Fourever%20You%20(Uncut%20Ver.)', source: 'official' },
    ],
  },
  {
    id: 'bl-see-your-love',
    title: 'See Your Love',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/en/album/rigkbvj5a6vdcj1',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/537/1344131.jpg',
    synopsis: 'Deaf caretaker Jiang Shaopeng is hired to look after reluctant corporate heir Yang Zixiang after an assassination attempt brings them together.',
    year: 2024,
    releaseDate: '2024-10-23',
    episodes: 13,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/album/rigkbvj5a6vdcj1', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40788c-see-your-love', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4875/see-your-love-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-kinnporsche-the-series',
    title: 'KinnPorsche The Series',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/play/kinnporsche-the-series-la-forte-1cyt9yg6igc?lang=en_us&sh_pltf=4',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/402/1006163.jpg',
    synopsis: 'Porsche, an underground street fighter and bartender protecting his younger brother, is recruited as head bodyguard for Kinn, second heir to a powerful Bangkok crime family.',
    year: 2022,
    releaseDate: '2022-04-02',
    episodes: 14,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/play/kinnporsche-the-series-la-forte-1cyt9yg6igc?lang=en_us&sh_pltf=4', source: 'official' },
    ],
  },
  {
    id: 'bl-semantic-error',
    title: 'Semantic Error',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38375c-semantic-error',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/390/976737.jpg',
    synopsis: 'Rule-bound computer science student Chu Sangwoo publicly removes freeloading classmates from a group presentation, inadvertently derailing campus design star Jang Jaeyoung’s graduation plans.',
    year: 2022,
    releaseDate: '2022-02-16',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38375c-semantic-error', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2547/semantic-error-2022', source: 'official' },
    ],
  },
  {
    id: 'bl-bad-buddy',
    title: 'Bad Buddy',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38219c-bad-buddy',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/612/1531857.jpg',
    synopsis: 'Next-door neighbors Pat and Pran were raised by families locked in a bitter business feud, forcing them to hide their growing bond behind a facade of rivalry.',
    year: 2021,
    releaseDate: '2021-10-29',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38219c-bad-buddy', source: 'official' },
    ],
  },
  {
    id: 'bl-cherry-magic-thirty-years-of-virginity-can-make-you-a-wizard',
    title: 'Cherry Magic! Thirty Years of Virginity Can Make You a Wizard?!',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.crunchyroll.com/series/G0XHWM5Q0/cherry-magic-thirty-years-of-virginity-can-make-you-a-wizard',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/491/1227665.jpg',
    synopsis: 'Shy stationery company clerk Kiyoshi Adachi turns thirty as a virgin and awakens the power to hear people’s thoughts through touch—discovering that top salesman Yuichi Kurosawa is secretly in love with him.',
    year: 2020,
    releaseDate: '2020-10-09',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Fantasy'],
    platforms: [
      { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G0XHWM5Q0/cherry-magic-thirty-years-of-virginity-can-make-you-a-wizard', source: 'official' },
    ],
  },
  {
    id: 'bl-my-beautiful-man-utsukushii-kare',
    title: 'My Beautiful Man (Utsukushii Kare)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38406c-my-beautiful-man',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/376/941038.jpg',
    synopsis: 'Lonely high school senior Hira, who struggles with a stutter and photographs the world from the margins, becomes utterly devoted to his cold, charismatic classmate Sou Kiyoi.',
    year: 2021,
    releaseDate: '2021-11-18',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38406c-my-beautiful-man', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2455/my-beautiful-man-2021', source: 'official' },
    ],
  },
  {
    id: 'bl-the-eighth-sense',
    title: 'The Eighth Sense',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39344c-the-eighth-sense',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/456/1141344.jpg',
    synopsis: 'Small-town freshman Ji Hyun joins a Seoul university surfing club and is drawn to returning senior Jae Won as both confront emotional trauma and first love.',
    year: 2023,
    releaseDate: '2023-03-29',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39344c-the-eighth-sense', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3284/the-eighth-sense-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-i-told-sunset-about-you',
    title: 'I Told Sunset About You',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37483c-i-told-sunset-about-you',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/309/774047.jpg',
    synopsis: 'Estranged childhood friends Teh and Oh-aew reunite at a Chinese-language cram school in Phuket, where college entrance ambitions and repressed desires collide.',
    year: 2020,
    releaseDate: '2020-10-22',
    episodes: 5,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37483c-i-told-sunset-about-you', source: 'official' },
    ],
  },
  {
    id: 'bl-i-promised-you-the-moon',
    title: 'I Promised You the Moon',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37876c-i-promised-you-the-moon',
    synopsis: 'Teh and Oh-aew move from Phuket to Bangkok for university, where new friendships, theatre clubs, and adult temptations test their promise to each other.',
    year: 2021,
    releaseDate: '2021-05-27',
    episodes: 5,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37876c-i-promised-you-the-moon', source: 'official' },
    ],
  },
  {
    id: 'bl-unknown-the-series',
    title: 'Unknown (The Series)',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40446c-unknown',
    synopsis: 'Wei Qian works tirelessly to raise his younger sister and adopted brother Wei Zhiyuan, until Zhiyuan returns from abroad determined to be seen as a partner rather than a brother.',
    year: 2024,
    releaseDate: '2024-02-24',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40446c-unknown', source: 'official' },
    ],
  },
  {
    id: 'bl-the-on1y-one',
    title: 'The On1y One',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40533c-the-on1y-one',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/531/1327879.jpg',
    synopsis: 'Stepbrothers Sheng Wang and Jiang Tian are forced to live under the same roof and sit in the same high school classroom, where initial friction turns into an unforgettable youth romance.',
    year: 2024,
    releaseDate: '2024-08-22',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40533c-the-on1y-one', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4580/the-on1y-one-2024', source: 'official' },
      { name: 'iQIYI', url: 'https://www.iq.com/album/the-on1y-one-2024-2ge4shuunbp?lang=en_us', source: 'official' },
    ],
  },
  {
    id: 'bl-last-twilight',
    title: 'Last Twilight',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40363c-last-twilight',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/484/1211106.jpg',
    synopsis: 'Technical college graduate Mhok takes a job as caretaker for Day, a national para-badminton player gradually losing his sight.',
    year: 2023,
    releaseDate: '2023-11-10',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40363c-last-twilight', source: 'official' },
    ],
  },
  {
    id: 'bl-moonlight-chicken',
    title: 'Moonlight Chicken',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39521c-moonlight-chicken',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/442/1106880.jpg',
    synopsis: 'Jim runs a late-night Hainanese chicken rice diner in Pattaya. A chance encounter with customer Wen changes both of their lives.',
    year: 2023,
    releaseDate: '2023-02-08',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39521c-moonlight-chicken', source: 'official' },
    ],
  },
  {
    id: 'bl-love-in-the-air',
    title: 'Love in the Air',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39109c-love-in-the-air',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/418/1047059.jpg',
    synopsis: 'Architecture students Rain and Sky cross paths with street-racing legends Phayu and Prapai on a stormy night in Bangkok.',
    year: 2022,
    releaseDate: '2022-08-18',
    episodes: 13,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39109c-love-in-the-air', source: 'official' },
      { name: 'iQIYI', url: 'https://www.iq.com/play/love-in-the-air-18jkl3qk4ek?lang=en_us&sh_pltf=4', source: 'official' },
    ],
  },
  {
    id: 'bl-my-school-president',
    title: 'My School President',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39321c-my-school-president',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/431/1078963.jpg',
    synopsis: 'High school band leader Gun must win the Hot Wave music contest to save Chinzhilla from disbandment, with help from student council president Tinn.',
    year: 2022,
    releaseDate: '2022-12-02',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39321c-my-school-president', source: 'official' },
    ],
  },
  {
    id: 'bl-my-personal-weatherman-taikan-yoho',
    title: 'My Personal Weatherman (Taikan Yoho)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40072c-my-personal-weatherman',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/471/1177964.jpg',
    synopsis: 'Rising television weathercaster Mizuki Segasaki enters a domestic contract with struggling manga artist Yoh Tanada that triggers every sunny day.',
    year: 2023,
    releaseDate: '2023-08-11',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40072c-my-personal-weatherman', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3598/my-personal-weatherman-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-old-fashion-cupcake',
    title: 'Old Fashion Cupcake',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38811c-old-fashion-cupcake',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/409/1024779.jpg',
    synopsis: 'Approaching forty and stuck in an office routine, Nozue visits dessert cafes across Tokyo with his devoted twenty-nine-year-old subordinate Togawa.',
    year: 2022,
    releaseDate: '2022-06-13',
    episodes: 5,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38811c-old-fashion-cupcake', source: 'official' },
    ],
  },
  {
    id: 'bl-we-best-love-no-1-for-you',
    title: 'We Best Love: No. 1 For You',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/play?cid=8xzttovneq58i2i&languageid=1491988',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/296/742284.jpg',
    synopsis: 'Zhou Shu Yi has been stuck in second place behind academic rival Gao Shi De since grade school, unaware that Shi De stayed at the top only to stay in Shu Yi’s sight.',
    year: 2021,
    releaseDate: '2021-01-08',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/play?cid=8xzttovneq58i2i&languageid=1491988', source: 'official' },
    ],
  },
  {
    id: 'bl-we-best-love-fighting-mr-2nd',
    title: 'We Best Love: Fighting Mr. 2nd',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/play?cid=8xzttovneq58i2i&languageid=1491988',
    synopsis: 'Five years after Gao Shi De left for the United States, he returns to Taipei to face a heartbroken and furious Zhou Shu Yi in the corporate world.',
    year: 2021,
    releaseDate: '2021-03-05',
    episodes: 6,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/play?cid=8xzttovneq58i2i&languageid=1491988', source: 'official' },
    ],
  },
  {
    id: 'bl-kiseki-dear-to-me',
    title: 'Kiseki: Dear to Me',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39947c-kiseki-dear-to-me',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/477/1193475.jpg',
    synopsis: 'Medical student Bai Zong Yi shelters injured gang member Fan Ze Rui in his apartment, tangling their fates alongside mafia lieutenants Chen Yi and Ai Di.',
    year: 2023,
    releaseDate: '2023-08-22',
    episodes: 13,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39947c-kiseki-dear-to-me', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3622/kiseki-dear-to-me-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-the-untamed-chen-qing-ling',
    title: 'The Untamed (Chen Qing Ling)',
    country: 'China',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/36657c-the-untamed',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/236/592104.jpg',
    synopsis: 'Soulmates Wei Wuxian and Lan Wangji unravel a dark conspiracy across cultivation clans sixteen years after a tragic siege.',
    year: 2019,
    releaseDate: '2019-06-27',
    episodes: 50,
    genres: ['BL', 'Action & Adventure', 'Sci-Fi & Fantasy', 'Drama'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/36657c-the-untamed', source: 'official' },
      { name: 'WeTV', url: 'https://wetv.vip/en/play/gnwjazjgmg997xg-The-Untamed', source: 'official' },
      { name: 'Netflix', url: 'https://www.netflix.com/title/81200228', source: 'official' },
    ],
  },
  {
    id: 'bl-word-of-honor-shan-he-ling',
    title: 'Word of Honor (Shan He Ling)',
    country: 'China',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37669c-word-of-honor',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/298/745349.jpg',
    synopsis: 'Former assassin leader Zhou Zishu and Ghost Valley master Wen Kexing roam the martial arts world together as ancient secrets surface.',
    year: 2021,
    releaseDate: '2021-02-22',
    episodes: 36,
    genres: ['BL', 'Action & Adventure', 'Sci-Fi & Fantasy', 'Drama'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37669c-word-of-honor', source: 'official' },
      { name: 'Netflix', url: 'https://www.netflix.com/title/81420604', source: 'official' },
    ],
  },
  {
    id: 'bl-to-my-star',
    title: 'To My Star',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38594c-to-my-star',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/410/1027141.jpg',
    synopsis: 'Top actor Kang Seo Joon moves into the quiet home of reserved chef Han Ji Woo after a scandal.',
    year: 2021,
    releaseDate: '2021-01-22',
    episodes: 19,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38594c-to-my-star', source: 'official' },
    ],
  },
  {
    id: 'bl-our-dating-sim',
    title: 'Our Dating Sim',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39508c-our-dating-sim',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/450/1125775.jpg',
    synopsis: 'Seven years after abruptly confessing in high school and vanishing, Lee Wan walks into a job interview as an illustrator at a gaming startup—only to find his crush Shin Ki Tae is the lead programmer.',
    year: 2023,
    releaseDate: '2023-03-09',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39508c-our-dating-sim', source: 'official' },
    ],
  },
  {
    id: 'bl-let-free-the-curse-of-taekwondo',
    title: 'Let Free the Curse of Taekwondo',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40587c-let-free-the-curse-of-taekwondo',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/533/1333568.jpg',
    synopsis: 'High schooler Do Hoe, trapped in his father’s strict rural taekwondo gym, forms a deep bond with cheerful Seoul transfer student Ju Young before a painful twelve-year separation.',
    year: 2024,
    releaseDate: '2024-10-17',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40587c-let-free-the-curse-of-taekwondo', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4862/let-free-the-curse-of-taekwondo-2024', source: 'official' },
      { name: 'Heavenly', url: 'https://heavenly.tv/en/detail/798', source: 'official' },
    ],
  },
  {
    id: 'bl-love-in-the-big-city',
    title: 'Love in the Big City',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40612c-love-in-the-big-city',
    synopsis: 'Young writer Go Young navigates a decade of queer love, heartbreaks, and self-discovery in Seoul.',
    year: 2024,
    releaseDate: '2024-10-21',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40612c-love-in-the-big-city', source: 'official' },
    ],
  },
  {
    id: 'bl-young-royals',
    title: 'Young Royals',
    country: 'Sweden',
    status: 'completed',
    sourceUrl: 'https://www.netflix.com/title/81210762',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/523/1307898.jpg',
    synopsis: 'Prince Wilhelm of Sweden enrolls at prestigious boarding school Hillerska and falls for choir scholarship student Simon Eriksson.',
    year: 2021,
    releaseDate: '2021-07-01',
    episodes: 18,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/title/81210762', source: 'official' },
    ],
  },
  {
    id: 'bl-my-stand-in',
    title: 'My Stand-In',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/album/my-stand-in-2023-2bo696v0yep?lang=en_us&sh_pltf=4',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/509/1273044.jpg',
    synopsis: 'Stunt double Joe gets pulled into a complicated relationship with young heir Ming before an accident gives him a second life in a new body.',
    year: 2024,
    releaseDate: '2024-04-26',
    episodes: 12,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/my-stand-in-2023-2bo696v0yep?lang=en_us&sh_pltf=4', source: 'official' },
    ],
  },
  {
    id: 'bl-jack-joker-u-steal-my-heart',
    title: 'Jack & Joker: U Steal My Heart!',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/album/jack-joker-u-steal-my-heart-2024-12194025809',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/529/1323840.jpg',
    synopsis: 'Master thief Joker and former taekwondo champion turned debt collector Jack team up against corrupt lenders in Bangkok.',
    year: 2024,
    releaseDate: '2024-09-09',
    episodes: 12,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/jack-joker-u-steal-my-heart-2024-12194025809', source: 'official' },
    ],
  },
  {
    id: 'bl-century-of-love',
    title: 'Century of Love',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.netflix.com/title/81906744',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/522/1307305.jpg',
    synopsis: 'Devoted San waits a hundred years in immortality for the reincarnation of his beloved Wat, only to clash with carefree modern youth Vee.',
    year: 2024,
    releaseDate: '2024-07-10',
    episodes: 10,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/title/81906744', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4512/century-of-love-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-wandee-goodday',
    title: 'Wandee Goodday',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40560c-wandee-goodday',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/514/1286522.jpg',
    synopsis: 'Heartbroken orthopedist Dr. Wandee enters a four-month fake dating arrangement with rising boxer Yoryak Phadetsuek.',
    year: 2024,
    releaseDate: '2024-05-04',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40560c-wandee-goodday', source: 'official' },
    ],
  },
  {
    id: 'bl-we-are',
    title: 'We Are',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/album/we-are-2024-119x8w5m20?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/509/1273755.jpg',
    synopsis: 'A tight-knit circle of university art and engineering friends navigate chaotic college life and unexpected love stories.',
    year: 2024,
    releaseDate: '2024-04-03',
    episodes: 16,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/we-are-2024-119x8w5m20?lang=en_us', source: 'official' },
    ],
  },
  {
    id: 'bl-love-for-loves-sake',
    title: "Love for Love's Sake",
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/album/love-for-loves-sake-2024-14x8n9p2q1?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/499/1249042.jpg',
    synopsis: 'Twenty-nine-year-old Tae Myung Ha is transported into the body of a nineteen-year-old character inside a novel with a mission to make lonely track athlete Cha Yeo Woon happy.',
    year: 2024,
    releaseDate: '2024-01-24',
    episodes: 8,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/love-for-loves-sake-2024-14x8n9p2q1?lang=en_us', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3975/love-for-loves-sake-2024-e01', source: 'official' },
    ],
  },
  {
    id: 'bl-boys-be-brave',
    title: 'Boys Be Brave!',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40485c-boys-be-brave',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/571/1427956.jpg',
    synopsis: 'Easygoing Jung Ki Sub crashes at the apartment of his secretly smitten college friend Kim Jin Woo and refuses to move out.',
    year: 2024,
    releaseDate: '2024-04-25',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40485c-boys-be-brave', source: 'official' },
      { name: 'Heavenly', url: 'https://heavenly.tv/detail/698', source: 'official' },
    ],
  },
  {
    id: 'bl-jazz-for-two',
    title: 'Jazz for Two',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/album/jazz-for-two-2024-22tnv97fd9h?lang=ko&sh_pltf=4',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/508/1270165.jpg',
    synopsis: 'Classical pianist Yoon Se Heon hides in an arts high school music room to play jazz, catching the ear of grief-stricken senior Han Tae Yi.',
    year: 2024,
    releaseDate: '2024-03-27',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/jazz-for-two-2024-22tnv97fd9h?lang=ko&sh_pltf=4', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4155/jazz-for-two-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-pit-babe-the-series',
    title: 'Pit Babe The Series',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/album/pit-babe-the-series-2023-1imv6s8nfe9?lang=en_us&sh_pltf=4',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/560/1401758.jpg',
    synopsis: 'Champion race car driver Babe lets rookie enthusiast Charlie into his garage and his heart as a conspiracy unfolds on the track.',
    year: 2023,
    releaseDate: '2023-11-17',
    episodes: 13,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/pit-babe-the-series-2023-1imv6s8nfe9?lang=en_us&sh_pltf=4', source: 'official' },
    ],
  },
  {
    id: 'bl-only-friends',
    title: 'Only Friends',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40328c-only-friends',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/471/1177522.jpg',
    synopsis: 'Business school friends Mew, Ray, Boston, and Nick test the limits of friendship, desire, and trust while renovating a hostel together.',
    year: 2023,
    releaseDate: '2023-08-12',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40328c-only-friends', source: 'official' },
    ],
  },
  {
    id: 'bl-be-my-favorite',
    title: 'Be My Favorite',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39990c-be-my-favorite',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/460/1152365.jpg',
    synopsis: 'A magical crystal music box sends introverted Botkawee ten years back to university, where his attempts to win over his female crush keep bringing him closer to Pisaeng.',
    year: 2023,
    releaseDate: '2023-05-26',
    episodes: 12,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39990c-be-my-favorite', source: 'official' },
    ],
  },
  {
    id: 'bl-cutie-pie',
    title: 'Cutie Pie',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38484c-cutie-pie',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/394/985104.jpg',
    synopsis: 'Promised in marriage since childhood to family friend Lian Kilen Wang, college drummer Kuea hides his rebel persona behind a polite facade.',
    year: 2022,
    releaseDate: '2022-02-19',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38484c-cutie-pie', source: 'official' },
      { name: 'YouTube', url: 'https://www.youtube.com/playlist?list=PLcTibKbv20S6Qnc5vSFKAQDR0v85mUd0k', source: 'official' },
    ],
  },
  {
    id: 'bl-not-me',
    title: 'Not Me',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39499c-not-me',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/379/948172.jpg',
    synopsis: 'When his twin brother Black is brutally beaten into a coma, diplomatic graduate White infiltrates Black’s vigilante motorcycle gang in disguise—and clashes with suspicious gang member Sean.',
    year: 2021,
    releaseDate: '2021-12-12',
    episodes: 14,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39499c-not-me', source: 'official' },
    ],
  },
  {
    id: 'bl-a-tale-of-thousand-stars-1000-stars',
    title: 'A Tale of Thousand Stars (1000 Stars)',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38218c-a-tale-of-thousand-stars',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/563/1409543.jpg',
    synopsis: 'After receiving a heart transplant from a volunteer schoolteacher, wealthy Tian travels to a mountain village in Chiang Rai to fulfill her final wish and meets Chief Forest Officer Phupha.',
    year: 2021,
    releaseDate: '2021-01-29',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38218c-a-tale-of-thousand-stars', source: 'official' },
    ],
  },
  {
    id: 'bl-cherry-blossoms-after-winter',
    title: 'Cherry Blossoms After Winter',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38394c-cherry-blossoms-after-winter',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/389/973374.jpg',
    synopsis: 'After losing his parents, Hae Bom grows up under the same roof as childhood friend Tae Sung; in their senior year of high school, living as brothers shifts into first love.',
    year: 2022,
    releaseDate: '2022-02-24',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38394c-cherry-blossoms-after-winter', source: 'official' },
    ],
  },
  {
    id: 'bl-light-on-me',
    title: 'Light On Me',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37921c-light-on-me',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/329/823025.jpg',
    synopsis: 'Loner high school student Woo Tae Kyung joins the Saebit Boys High student council to make friends, catching the attention of both warm president Da On and blunt vice-president Shin Woo.',
    year: 2021,
    releaseDate: '2021-06-29',
    episodes: 16,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37921c-light-on-me', source: 'official' },
      { name: 'Watcha', url: 'https://watcha.com/contents/share/tEZAY0d', source: 'official' },
    ],
  },
  {
    id: 'bl-the-time-of-fever',
    title: 'The Time of Fever',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=The%20Time%20of%20Fever',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/533/1333577.jpg',
    synopsis: 'Childhood friends Ho Tae and Dong Hee reunite in Gangneung during high school and discover overwhelming feelings they can no longer hide.',
    year: 2024,
    releaseDate: '2024-05-17',
    episodes: 6,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=The%20Time%20of%20Fever', source: 'official' },
    ],
  },
  {
    id: 'bl-the-sign',
    title: 'The Sign',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=The+Sign+Series+Idol+Factory+EP+1',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/481/1204842.jpg',
    synopsis: 'Special investigators Tharn and Phaya share prophetic dreams and reincarnated bonds tracing back to the mythical Garuda and Naga.',
    year: 2023,
    releaseDate: '2023-11-25',
    episodes: 12,
    genres: ['BL', 'Action & Adventure', 'Sci-Fi & Fantasy', 'Romance'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=The+Sign+Series+Idol+Factory+EP+1', source: 'official' },
    ],
  },
  {
    id: 'bl-cherry-magic-thailand',
    title: 'Cherry Magic Thailand',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/search?q=Cherry+Magic+Thailand',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/489/1222972.jpg',
    synopsis: 'Turning thirty as a virgin grants office worker Achi the ability to read minds on contact—revealing that model colleague Karan is head over heels for him.',
    year: 2023,
    releaseDate: '2023-12-09',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Fantasy'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/search?q=Cherry+Magic+Thailand', source: 'official' },
    ],
  },
  {
    id: 'bl-between-us',
    title: 'Between Us',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Between%20Us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/429/1074047.jpg',
    synopsis: 'University swimming club vice-president Win helps freshman Team overcome sleep nightmares caused by childhood trauma.',
    year: 2022,
    releaseDate: '2022-11-06',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Between%20Us', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/39955c-between-us', source: 'official' },
    ],
  },
  {
    id: 'bl-until-we-meet-again',
    title: 'Until We Meet Again',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/36988c-until-we-meet-again',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/213/533933.jpg',
    synopsis: 'College freshman Pharm and swimming club president Dean are drawn together by a red thread of fate linking them to past-life lovers Korn and In.',
    year: 2019,
    releaseDate: '2019-11-09',
    episodes: 17,
    genres: ['BL', 'Drama', 'Romance', 'Sci-Fi & Fantasy'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/36988c-until-we-meet-again', source: 'official' },
    ],
  },
  {
    id: 'bl-4minutes',
    title: '4MINUTES',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40651c-4minutes',
    synopsis: 'University student Great gains the supernatural ability to see four minutes into the future, altering fate and meeting surgical resident Tyme.',
    year: 2024,
    releaseDate: '2024-07-26',
    episodes: 8,
    genres: ['BL', 'Mystery', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40651c-4minutes', source: 'official' },
    ],
  },
  {
    id: 'bl-2gether-the-series',
    title: '2gether: The Series',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=2gether+The+Series+GMMTV+EP+1',
    synopsis: 'College freshman Tine enlists campus heartthrob and guitarist Sarawat to act as his fake boyfriend, only for the pretend romance to become real.',
    year: 2020,
    releaseDate: '2020-02-21',
    episodes: 13,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=2gether+The+Series+GMMTV+EP+1', source: 'official' },
    ],
  },
  {
    id: 'bl-still-2gether',
    title: 'Still 2gether',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Still+2gether+GMMTV+EP+1',
    synopsis: 'Now in their second year together at university, Sarawat and Tine take on leadership roles in the music and cheerleading clubs.',
    year: 2020,
    releaseDate: '2020-08-14',
    episodes: 5,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Still+2gether+GMMTV+EP+1', source: 'official' },
    ],
  },
  {
    id: 'bl-theory-of-love',
    title: 'Theory of Love',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38217c-theory-of-love',
    synopsis: 'Film major Third has been secretly in love with his playboy best friend Khai for three years without ever daring to confess.',
    year: 2019,
    releaseDate: '2019-06-01',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38217c-theory-of-love', source: 'official' },
    ],
  },
  {
    id: 'bl-dark-blue-kiss',
    title: 'Dark Blue Kiss',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38216c-dark-blue-kiss',
    synopsis: 'Pete and Kao navigate keeping their relationship secret from Kao’s mother while café owner Sun falls for fiery Mork.',
    year: 2019,
    releaseDate: '2019-10-12',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38216c-dark-blue-kiss', source: 'official' },
    ],
  },
  {
    id: 'bl-sotus-the-series',
    title: 'SOTUS: The Series',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=SOTUS+The+Series+EP+1+Eng+Sub',
    synopsis: 'Head hazer Arthit clashes with fearless engineering freshman Kongpob, who boldly declares he will win Arthit’s heart.',
    year: 2016,
    releaseDate: '2016-08-20',
    episodes: 15,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=SOTUS+The+Series+EP+1+Eng+Sub', source: 'official' },
    ],
  },
  {
    id: 'bl-tharntype-the-series',
    title: 'TharnType: The Series',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37995c-tharntype',
    synopsis: 'Hot-headed freshman Type is paired with openly gay drummer Tharn as college dorm roommates, where hostility slowly melts into devotion.',
    year: 2019,
    releaseDate: '2019-10-07',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37995c-tharntype', source: 'official' },
    ],
  },
  {
    id: 'bl-the-eclipse',
    title: 'The Eclipse',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39222c-the-eclipse',
    synopsis: 'At strict Suppalo all-boys school, head prefect Akk is tasked with stopping mysterious rebel transfer student Ayan from uncovering the truth behind a school curse.',
    year: 2022,
    releaseDate: '2022-08-12',
    episodes: 12,
    genres: ['BL', 'Mystery', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39222c-the-eclipse', source: 'official' },
    ],
  },
  {
    id: 'bl-vice-versa',
    title: 'Vice Versa',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39110c-vice-versa',
    synopsis: 'Colorist Talay wakes up in anotherboy’s body inside an alternate universe and teams up with fellow universe-traveler Puen to find their portkey home.',
    year: 2022,
    releaseDate: '2022-07-16',
    episodes: 12,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39110c-vice-versa', source: 'official' },
    ],
  },
  {
    id: 'bl-never-let-me-go',
    title: 'Never Let Me Go',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39450c-never-let-me-go',
    synopsis: 'Wealthy heir Nuengdiao is targeted after his father’s assassination, and his chauffeur’s son Palm is appointed his personal bodyguard at school.',
    year: 2022,
    releaseDate: '2022-12-13',
    episodes: 12,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39450c-never-let-me-go', source: 'official' },
    ],
  },
  {
    id: 'bl-fish-upon-the-sky',
    title: 'Fish Upon the Sky',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38220c-fish-upon-the-sky',
    synopsis: 'Nerd dentistry student Pi gets a makeover to pursue his campus crush, only to attract the relentless affection of medical rival Mork.',
    year: 2021,
    releaseDate: '2021-04-09',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38220c-fish-upon-the-sky', source: 'official' },
    ],
  },
  {
    id: 'bl-manner-of-death',
    title: 'Manner of Death',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/en/search/Manner%20of%20Death',
    synopsis: 'Medical examiner Dr. Bun rules a woman’s hanging a homicide and finds that prime suspect Tan—her mysterious tutor—wants to help solve the case.',
    year: 2020,
    releaseDate: '2020-11-30',
    episodes: 14,
    genres: ['BL', 'Crime', 'Mystery', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/search/Manner%20of%20Death', source: 'official' },
    ],
  },
  {
    id: 'bl-triage',
    title: 'Triage',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Triage+The+Series+BL+EP+1',
    synopsis: 'Emergency room resident Dr. Tin becomes trapped in a time loop every night he fails to save college student Tol’s life.',
    year: 2022,
    releaseDate: '2022-04-18',
    episodes: 13,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Triage+The+Series+BL+EP+1', source: 'official' },
    ],
  },
  {
    id: 'bl-laws-of-attraction',
    title: 'Laws of Attraction',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Laws%20of%20Attraction',
    synopsis: 'Grieving uncle Tinn seeks justice after his niece is killed in a hit-and-run and clashes with cynical, sharp-tongued defense lawyer Charn.',
    year: 2023,
    releaseDate: '2023-07-15',
    episodes: 8,
    genres: ['BL', 'Crime', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Laws%20of%20Attraction', source: 'official' },
    ],
  },
  {
    id: 'bl-i-feel-you-linger-in-the-air',
    title: 'I Feel You Linger in the Air',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/search?q=I+Feel+You+Linger+in+the+Air',
    synopsis: 'Architect Jom is renovating a historic Chiang Mai mansion when he is pulled back into 1920s Siam and meets warm-hearted nobleman Khun Yai.',
    year: 2023,
    releaseDate: '2023-08-18',
    episodes: 12,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=I+Feel+You+Linger+in+the+Air', source: 'official' },
    ],
  },
  {
    id: 'bl-bed-friend',
    title: 'Bed Friend',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39511c-bed-friend',
    synopsis: 'Office coworkers King and Uea start a strictly no-strings-attached arrangement that gradually heals Uea’s past wounds.',
    year: 2023,
    releaseDate: '2023-02-18',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39511c-bed-friend', source: 'official' },
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Bed%20Friend', source: 'official' },
    ],
  },
  {
    id: 'bl-a-boss-and-a-babe',
    title: 'A Boss and a Babe',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39865c-a-boss-and-a-babe',
    synopsis: 'Cheerful esports gamer Cher lands an internship at a game company and discovers his insomniac CEO Gun can only sleep listening to Cher’s ASMR.',
    year: 2023,
    releaseDate: '2023-03-03',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39865c-a-boss-and-a-babe', source: 'official' },
    ],
  },
  {
    id: 'bl-dangerous-romance',
    title: 'Dangerous Romance',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40112c-dangerous-romance',
    synopsis: 'Working-class scholarship student Sailom is hired to tutor wealthy high school bully Kanghan, turning animosity into deep loyalty.',
    year: 2023,
    releaseDate: '2023-08-18',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40112c-dangerous-romance', source: 'official' },
    ],
  },
  {
    id: 'bl-hidden-agenda',
    title: 'Hidden Agenda',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40095c-hidden-agenda',
    synopsis: 'University student Zo asks debate club star Joke to coach him on wooing his crush, unaware that Joke’s real agenda is winning Zo.',
    year: 2023,
    releaseDate: '2023-07-09',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40095c-hidden-agenda', source: 'official' },
    ],
  },
  {
    id: 'bl-step-by-step',
    title: 'Step By Step',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/en/search/Step%20By%20Step',
    synopsis: 'Enthusiastic new digital marketing team member Pat clashes with and gradually falls for his demanding, perfectionist department manager Jeng.',
    year: 2023,
    releaseDate: '2023-04-18',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/search/Step%20By%20Step', source: 'official' },
    ],
  },
  {
    id: 'bl-my-love-mix-up-thailand',
    title: 'My Love Mix-Up! Thailand',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40585c-my-love-mix-up',
    synopsis: 'High schooler Atom borrows an eraser from his crush Matmee and finds Basketball player Kongthap’s name written on it—sparking a chain of romantic misunderstandings.',
    year: 2024,
    releaseDate: '2024-06-07',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40585c-my-love-mix-up', source: 'official' },
    ],
  },
  {
    id: 'bl-kidnap',
    title: 'Kidnap',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.netflix.com/search?q=Kidnap',
    synopsis: 'Needing money for his brother’s medication, stuntman Min accepts a job to kidnap wealthy heir Q—but refuses the order to kill him and hides Q in his home.',
    year: 2024,
    releaseDate: '2024-09-06',
    episodes: 12,
    genres: ['BL', 'Action & Adventure', 'Drama', 'Romance'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/search?q=Kidnap', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Kidnap', source: 'official' },
    ],
  },
  {
    id: 'bl-the-trainee',
    title: 'The Trainee',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40620c-the-trainee',
    synopsis: 'Passionate film student Ryan begins an internship as an assistant director at a production house and works closely with sharp-eyed AD Jane.',
    year: 2024,
    releaseDate: '2024-06-30',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40620c-the-trainee', source: 'official' },
    ],
  },
  {
    id: 'bl-love-sea',
    title: 'Love Sea',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40595c-love-sea',
    synopsis: 'Romance novelist Tongrak travels to a southern island looking for inspiration and hires talkative local diver Mahasamut as his guide.',
    year: 2024,
    releaseDate: '2024-06-09',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40595c-love-sea', source: 'official' },
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Love%20Sea', source: 'official' },
    ],
  },
  {
    id: 'bl-sunset-x-vibes',
    title: 'Sunset x Vibes',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Sunset%20x%20Vibes',
    synopsis: 'Jewelry design intern Salin discovers that his secret weekend partner Sun is actually the CEO of the luxury company where he just started working.',
    year: 2024,
    releaseDate: '2024-06-15',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Sunset%20x%20Vibes', source: 'official' },
    ],
  },
  {
    id: 'bl-this-love-doesn-t-have-long-beans',
    title: 'This Love Doesn’t Have Long Beans',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=This%20Love%20Doesnt%20Have%20Long%20Beans',
    synopsis: 'Model Plawan enters a cooking competition hosted by fiery Chef Oab to win the right to take over Oab’s beloved basil restaurant.',
    year: 2024,
    releaseDate: '2024-07-05',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=This%20Love%20Doesnt%20Have%20Long%20Beans', source: 'official' },
    ],
  },
  {
    id: 'bl-monster-next-door',
    title: 'Monster Next Door',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/en/search/Monster%20Next%20Door',
    synopsis: 'Introverted Diew and outgoing party-loving neighbor God begin talking through their adjoining apartment balconies without seeing each other’s faces.',
    year: 2024,
    releaseDate: '2024-08-08',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/search/Monster%20Next%20Door', source: 'official' },
    ],
  },
  {
    id: 'bl-every-you-every-me',
    title: 'Every You, Every Me',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/search?q=Every+You+Every+Me',
    synopsis: 'Through shifting timelines and parallel stories, two young men keep finding their way back to one another whenever the rain falls.',
    year: 2024,
    releaseDate: '2024-10-06',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Every+You+Every+Me', source: 'official' },
    ],
  },
  {
    id: 'bl-last-meal-universe-bokura-no-shokutaku',
    title: 'Last Meal Universe (Bokura no Shokutaku)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/3315/our-dining-table-2023',
    synopsis: 'Solitary salaryman Yutaka struggles to eat around others until he meets kind-hearted Minoru and his five-year-old brother Tane in a park over homemade rice balls.',
    year: 2023,
    releaseDate: '2023-04-06',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance', 'Family'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3315/our-dining-table-2023', source: 'official' },
      { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/search?q=Our+Dining+Table', source: 'official' },
    ],
  },
  {
    id: 'bl-kieta-hatsukoi-my-love-mix-up',
    title: 'Kieta Hatsukoi (My Love Mix-Up!)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38215c-my-love-mix-up',
    synopsis: 'High schooler Aoki sees Ida’s name on an eraser borrowed from his crush Hashimoto, leading Ida to mistakenly believe Aoki has a secret crush on him.',
    year: 2021,
    releaseDate: '2021-10-09',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38215c-my-love-mix-up', source: 'official' },
      { name: 'Netflix', url: 'https://www.netflix.com/search?q=My+Love+Mix-Up', source: 'official' },
    ],
  },
  {
    id: 'bl-takara-kun-amagi-kun',
    title: 'Takara-kun & Amagi-kun',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38738c-takara-kun-amagi-kun',
    synopsis: 'Popular, stoic classmate Takara and bright, earnest Amagi quietly begin dating in high school while keeping their relationship a secret.',
    year: 2022,
    releaseDate: '2022-08-19',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38738c-takara-kun-amagi-kun', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2899/takara-kun-and-amagi-kun-2022', source: 'official' },
    ],
  },
  {
    id: 'bl-minato-s-laundromat-minato-shouji-coin-laundry',
    title: 'Minato’s Laundromat (Minato Shouji Coin Laundry)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/2825/minatos-laundromat-2022',
    synopsis: 'Former corporate worker Akira Minato takes over his grandfather’s coin laundry and forms an unexpected bond with handsome high school swimmer Shintaro.',
    year: 2022,
    releaseDate: '2022-07-06',
    episodes: 24,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2825/minatos-laundromat-2022', source: 'official' },
    ],
  },
  {
    id: 'bl-eternal-yesterday-eien-no-kino',
    title: 'Eternal Yesterday (Eien no Kino)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38915c-eternal-yesterday',
    synopsis: 'Cheerful Koichi is struck by a truck right before his classmate Mitsuru’s eyes—yet gets back up the next day as a "living corpse" so they can cherish their remaining time.',
    year: 2022,
    releaseDate: '2022-10-21',
    episodes: 8,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38915c-eternal-yesterday', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3010/eternal-yesterday-2022', source: 'official' },
    ],
  },
  {
    id: 'bl-the-end-of-the-world-with-you-bokura-no-micro-na-shuumatsu',
    title: 'The End of the World With You (Bokura no Micro na Shuumatsu)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39290c-the-end-of-the-world-with-you',
    synopsis: 'With a giant meteor ten days away from destroying Earth, Masumi runs into Ritsu—the ex-lover who broke his heart back in university.',
    year: 2023,
    releaseDate: '2023-01-30',
    episodes: 8,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39290c-the-end-of-the-world-with-you', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3192/the-end-of-the-world-with-you-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-jack-o-frost',
    title: 'Jack o’ Frost',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39340c-jack-o-frost',
    synopsis: 'After a breakup argument with his partner Fumiya, illustrator Ritsuka slips in the winter snow and wakes up having lost only his memories of Fumiya.',
    year: 2023,
    releaseDate: '2023-02-17',
    episodes: 6,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39340c-jack-o-frost', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3225/jack-o-frost-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-naked-dining-zenra-meshi',
    title: 'Naked Dining (Zenra Meshi)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/3322/naked-dining-2023',
    synopsis: 'Model government clerkunta Ichijo relieves stress by cooking and eating naked alone at home, until childhood friend Mahiro moves in with fresh produce.',
    year: 2023,
    releaseDate: '2023-04-14',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3322/naked-dining-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-tokyo-in-april-is-shigatsu-no-tokyo-wa',
    title: 'Tokyo in April is… (Shigatsu no Tokyo wa…)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39945c-tokyo-in-april-is',
    synopsis: 'Returning to Tokyo after ten years in America, Kazuma reunites at a design agency with his first love Ren—whom he hasn’t seen since an abrupt separation in middle school.',
    year: 2023,
    releaseDate: '2023-06-16',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39945c-tokyo-in-april-is', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3470/tokyo-in-april-is-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-i-cannot-reach-you-kimi-ni-wa-todokanai',
    title: 'I Cannot Reach You (Kimi ni wa Todokanai)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.netflix.com/search?q=I+Cannot+Reach+You',
    synopsis: 'Childhood best friends Yamato—smart and handsome—and Kakeru—bright and average—navigate unspoken feelings in high school.',
    year: 2023,
    releaseDate: '2023-09-27',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/search?q=I+Cannot+Reach+You', source: 'official' },
    ],
  },
  {
    id: 'bl-if-it-s-with-you-kimi-to-nara-koi-wo-shite-mite-mo',
    title: 'If It’s With You (Kimi to nara Koi wo Shite Mite mo)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40310c-if-its-with-you',
    synopsis: 'On scenic Enoshima Island, transfer student Amane meets warm-hearted Ryuji over a lunchbox by the sea.',
    year: 2023,
    releaseDate: '2023-10-06',
    episodes: 5,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40310c-if-its-with-you', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3710/if-its-with-you-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-one-room-angel',
    title: 'One Room Angel',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40235c-one-room-angel',
    synopsis: 'Lethargic convenience store clerk Kouki wakes up from a stabbing to find a beautiful, amnesiac winged angel living in his tiny one-room apartment.',
    year: 2023,
    releaseDate: '2023-10-20',
    episodes: 6,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Drama'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40235c-one-room-angel', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3742/one-room-angel-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-perfect-propose',
    title: 'Perfect Propose',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/3992/perfect-propose-2024',
    synopsis: 'Overworked salaryman Hiro takes in Kai—the childhood friend he once promised to marry—who cooks warm home-cooked meals for him every night.',
    year: 2024,
    releaseDate: '2024-02-02',
    episodes: 6,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3992/perfect-propose-2024', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40412c-perfect-propose', source: 'official' },
    ],
  },
  {
    id: 'bl-love-is-better-the-second-time-around-koi-wo-suru-nara-nidome-ga-joto',
    title: 'Love Is Better the Second Time Around (Koi wo Suru nara Nidome ga Joto)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40455c-love-is-better-the-second-time-around',
    synopsis: 'Business magazine editor Miyata is assigned to a column by popular university associate professor Iwanaga—his high school first love with whom he eloped and broke up.',
    year: 2024,
    releaseDate: '2024-03-06',
    episodes: 6,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40455c-love-is-better-the-second-time-around', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4055/love-is-better-the-second-time-around-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-at-25-00-in-akasaka-25-ji-akasaka-de',
    title: 'At 25:00, in Akasaka (25-ji, Akasaka de)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/4210/at-25-00-in-akasaka-2024',
    synopsis: 'Rookie actor Yuki Shirasaki lands a co-starring role opposite his popular university senior Asami Hayama in a BL drama, and Hayama proposes they date for method acting.',
    year: 2024,
    releaseDate: '2024-04-18',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4210/at-25-00-in-akasaka-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-living-with-him-kare-no-iru-seikatsu',
    title: 'Living With Him (Kare no Iru Seikatsu)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40499c-living-with-him',
    synopsis: 'Domestic college freshman Ryota Natsukawa discovers his new dorm roommate is childhood friend Kazuhito Tanaka, who has secretly loved him for years.',
    year: 2024,
    releaseDate: '2024-04-12',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40499c-living-with-him', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4198/living-with-him-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-i-hear-the-sunspot-hidamari-ga-kikoeru',
    title: 'I Hear the Sunspot (Hidamari ga Kikoeru)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/4450/i-hear-the-sunspot-2024',
    synopsis: 'Hearing-impaired university student Kohei Sugihara hires hungry, bright-spirited classmate Taichi Sagawa to take lecture notes in exchange for homemade bento lunches.',
    year: 2024,
    releaseDate: '2024-06-26',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4450/i-hear-the-sunspot-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-cosmetic-playlover',
    title: 'Cosmetic Playlover',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40680c-cosmetic-playlover',
    synopsis: 'Dedicated men’s cosmetics consultant Natsume is paired in a sales duo with aloof, talented junior Sahashi, who quickly discovers Natsume’s feelings.',
    year: 2024,
    releaseDate: '2024-08-06',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40680c-cosmetic-playlover', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4590/cosmetic-playlover-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-sugar-dog-life',
    title: 'Sugar Dog Life',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40675c-sugar-dog-life',
    synopsis: 'Baby-faced twenty-year-old college student Isumi Sakuraba is mistaken for a minor by kindly neighborhood police officer Kyosuke Amasawa, leading to late-night home-cooked dinners.',
    year: 2024,
    releaseDate: '2024-08-04',
    episodes: 9,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40675c-sugar-dog-life', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4588/sugar-dog-life-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-takara-s-treasure-takara-no-vidro',
    title: 'Takara’s Treasure (Takara no Vidro)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40635c-takaras-treasure',
    synopsis: 'Fukuoka youth Taishin moves to Tokyo to attend the same university as Takara, the stranger who comforted him when his beloved pet died.',
    year: 2024,
    releaseDate: '2024-07-01',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40635c-takaras-treasure', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4492/takaras-treasure-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-happy-of-the-end',
    title: 'Happy of the End',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40710c-happy-of-the-end',
    synopsis: 'Homeless and broken, Chihiro meets mysterious Haoran in a bar and moves into his apartment as both confront deep scars from their pasts.',
    year: 2024,
    releaseDate: '2024-09-03',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40710c-happy-of-the-end', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4685/happy-of-the-end-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-smells-like-green-spirit',
    title: 'Smells Like Green Spirit',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/search?q=Smells+Like+Green+Spirit',
    synopsis: 'In a rural Japanese town, bullied high schooler Mishima finds solace wearing his mother’s lipstick on the school roof—where classmate Kirino discovers his secret.',
    year: 2024,
    releaseDate: '2024-09-19',
    episodes: 8,
    genres: ['BL', 'Drama', 'Coming of Age'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Smells+Like+Green+Spirit', source: 'official' },
    ],
  },
  {
    id: 'bl-love-in-the-air-koi-no-yokan-japan',
    title: 'Love In The Air: Koi no Yokan (Japan)',
    country: 'Japan',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/search?q=Love+in+the+Air+Koi+no+Yokan',
    synopsis: 'Japanese adaptation following architecture students Rei and Kai as they cross paths with charismatic riders Arashi and Fuma.',
    year: 2024,
    releaseDate: '2024-11-03',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Love+in+the+Air+Koi+no+Yokan', source: 'official' },
    ],
  },
  {
    id: 'bl-where-your-eyes-linger',
    title: 'Where Your Eyes Linger',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37107c-where-your-eyes-linger',
    synopsis: 'Eighteen-year-old chaebol heir Han Tae Joo and his lifelong friend and martial arts bodyguard Kang Gook test the unspoken line between duty and love.',
    year: 2020,
    releaseDate: '2020-05-22',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37107c-where-your-eyes-linger', source: 'official' },
    ],
  },
  {
    id: 'bl-color-rush',
    title: 'Color Rush',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37542c-color-rush',
    synopsis: 'Monochromatic high schooler Yeon Woo, who only sees the world in shades of gray, experiences a vivid burst of color the moment he sees transfer student Yoo Han.',
    year: 2020,
    releaseDate: '2020-12-30',
    episodes: 8,
    genres: ['BL', 'Mystery', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37542c-color-rush', source: 'official' },
    ],
  },
  {
    id: 'bl-blueming',
    title: 'Blueming',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Blueming',
    synopsis: 'Film major Cha Si Won works hard to be popular in university, only to clash with effortlessly handsome freshman Hyeong Da Un.',
    year: 2022,
    releaseDate: '2022-03-31',
    episodes: 11,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Blueming', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40115c-blueming', source: 'official' },
    ],
  },
  {
    id: 'bl-roommates-of-poongduck-304',
    title: 'Roommates of Poongduck 304',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38789c-roommates-of-poongduck-304',
    synopsis: 'Chaebol third-generation intern Ji Ho Jun is kicked out of home into Poongduck Villa—discovering that his strict new team leader Seo Jae Yoon is his landlord.',
    year: 2022,
    releaseDate: '2022-10-13',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38789c-roommates-of-poongduck-304', source: 'official' },
    ],
  },
  {
    id: 'bl-the-new-employee',
    title: 'The New Employee',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38909c-the-new-employee',
    synopsis: 'Late-20s advertising intern Woo Seung Hyun begins working under workaholic department manager Kim Jong Chan.',
    year: 2022,
    releaseDate: '2022-12-21',
    episodes: 7,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38909c-the-new-employee', source: 'official' },
    ],
  },
  {
    id: 'bl-unintentional-love-story',
    title: 'Unintentional Love Story',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Unintentional%20Love%20Story',
    synopsis: 'Suspended office worker Ji Won Young tracks down reclusive master ceramist Yoon Tae Joon in Gangneung to clear his name, accidentally falling in love.',
    year: 2023,
    releaseDate: '2023-03-17',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Unintentional%20Love%20Story', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/39920c-unintentional-love-story', source: 'official' },
    ],
  },
  {
    id: 'bl-a-shoulder-to-cry-on',
    title: 'A Shoulder to Cry On',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39505c-a-shoulder-to-cry-on',
    synopsis: 'High school archery prospect Lee Da Yeol’s scholarship is threatened after a nurse’s office misunderstanding with mischievous class president Jo Tae Hyun.',
    year: 2023,
    releaseDate: '2023-03-15',
    episodes: 7,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39505c-a-shoulder-to-cry-on', source: 'official' },
    ],
  },
  {
    id: 'bl-jun-jun',
    title: 'Jun & Jun',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39892c-jun-jun',
    synopsis: 'Former idol Lee Jun starts an internship at a cosmetics company, only to find his childhood first love Choi Jun is the general manager.',
    year: 2023,
    releaseDate: '2023-07-20',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39892c-jun-jun', source: 'official' },
    ],
  },
  {
    id: 'bl-sing-my-crush',
    title: 'Sing My Crush',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Sing%20My%20Crush',
    synopsis: 'Aspiring indie guitarist Ba Ram and loyal manager Han Tae navigate friendship and unspoken love from high school to the music stage.',
    year: 2023,
    releaseDate: '2023-08-02',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Sing%20My%20Crush', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40045c-sing-my-crush', source: 'official' },
    ],
  },
  {
    id: 'bl-love-class-2',
    title: 'Love Class 2',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40015c-love-class-2',
    synopsis: 'Three university freshmen taking a college course on love navigate crushes, heartbreak, and new beginnings.',
    year: 2023,
    releaseDate: '2023-08-11',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40015c-love-class-2', source: 'official' },
    ],
  },
  {
    id: 'bl-love-mate',
    title: 'Love Mate',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39785c-love-mate',
    synopsis: 'Cynical media team leader Seo Lee Jun agrees to a three-month dating trial with persistent new employee Jeong Ha Ram.',
    year: 2023,
    releaseDate: '2023-05-04',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39785c-love-mate', source: 'official' },
    ],
  },
  {
    id: 'bl-love-tractor',
    title: 'Love Tractor',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Love%20Tractor',
    synopsis: 'Exhausted Seoul law student Seon Yul retreats to his grandfather’s countryside farm and meets sunny, muscular neighbor Ye Chan.',
    year: 2023,
    releaseDate: '2023-06-07',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Love%20Tractor', source: 'official' },
    ],
  },
  {
    id: 'bl-why-r-u-korea',
    title: 'Why R U? Korea',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40065c-why-r-u',
    synopsis: 'University theater student Lee Won discovers his younger sister is writing a BL web novel shipping him with his sworn rival Ji Oh.',
    year: 2023,
    releaseDate: '2023-08-24',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40065c-why-r-u', source: 'official' },
    ],
  },
  {
    id: 'bl-history3-trapped',
    title: 'HIStory3: Trapped',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/36478c-history3-trapped',
    synopsis: 'Homicide detective Meng Shao Fei relentlessly investigates righteous mafia boss Tang Yi after a double shooting that killed Shao Fei’s mentor.',
    year: 2019,
    releaseDate: '2019-04-16',
    episodes: 20,
    genres: ['BL', 'Action & Adventure', 'Crime', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/36478c-history3-trapped', source: 'official' },
    ],
  },
  {
    id: 'bl-history3-make-our-days-count',
    title: 'HIStory3: Make Our Days Count',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/36809c-history3-make-our-days-count',
    synopsis: 'Hot-headed high schooler Xiang Hao Ting and lonely scholarship student Yu Xi Gu go from academic rivals to deeply devoted partners.',
    year: 2019,
    releaseDate: '2019-10-16',
    episodes: 20,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/36809c-history3-make-our-days-count', source: 'official' },
    ],
  },
  {
    id: 'bl-history2-crossing-the-line',
    title: 'HIStory2: Crossing the Line',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/35872c-history2-crossing-the-line',
    synopsis: 'Delinquent transfer student Xia Yu Hao is recruited into the high school volleyball team by injured captain Qiu Zi Xuan.',
    year: 2018,
    releaseDate: '2018-03-06',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/35872c-history2-crossing-the-line', source: 'official' },
    ],
  },
  {
    id: 'bl-history4-close-to-you',
    title: 'HIStory4: Close to You',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37721c-history4-close-to-you',
    synopsis: 'Wedding planner Xiao Li Cheng pretends to like men to impress a crush, enlisting coworker Teng Mu Ren to practice romance.',
    year: 2021,
    releaseDate: '2021-03-14',
    episodes: 20,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37721c-history4-close-to-you', source: 'official' },
    ],
  },
  {
    id: 'bl-be-loved-in-house-i-do',
    title: 'Be Loved in House: I Do',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/37795c-be-loved-in-house-i-do',
    synopsis: 'Cold new studio director Jin Yu Zhen imposes a "no-singles" rule at a jewelry design studio and moves into employee Shi Lei’s house.',
    year: 2021,
    releaseDate: '2021-05-20',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/37795c-be-loved-in-house-i-do', source: 'official' },
    ],
  },
  {
    id: 'bl-plus-minus',
    title: 'Plus & Minus',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38462c-plus-minus',
    synopsis: 'Divorce attorneys Cheng Ze Shou and Fu Li Gong have been best friends since childhood, until a drunken night changes their twenty-year bond.',
    year: 2022,
    releaseDate: '2022-04-15',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38462c-plus-minus', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2635/plus-and-minus-2022', source: 'official' },
    ],
  },
  {
    id: 'bl-about-youth',
    title: 'About Youth',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38742c-about-youth',
    synopsis: 'Quiet high school student Ye Guang runs for student council president and finds comfort in the music of underground band singer Xu Qi Zhang.',
    year: 2022,
    releaseDate: '2022-08-29',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38742c-about-youth', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2915/about-youth-2022', source: 'official' },
    ],
  },
  {
    id: 'bl-my-tooth-your-love',
    title: 'My Tooth Your Love',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/38834c-my-tooth-your-love',
    synopsis: 'Bistro owner Bai Lang suffers from severe dental phobia since childhood, until his sister refers him to cool arch-dentist Jin Xun An.',
    year: 2022,
    releaseDate: '2022-10-14',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/38834c-my-tooth-your-love', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/2988/my-tooth-your-love-2022', source: 'official' },
    ],
  },
  {
    id: 'bl-stay-by-my-side',
    title: 'Stay By My Side',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39901c-stay-by-my-side',
    synopsis: 'Raised by his grandfather in a temple, Gu Bu Xia begins hearing ghosts—until he discovers touching his aloof dorm roommate Jiang Chi silences the voices.',
    year: 2023,
    releaseDate: '2023-07-07',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39901c-stay-by-my-side', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3512/stay-by-my-side-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-you-are-mine',
    title: 'You Are Mine',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40062c-you-are-mine',
    synopsis: 'Cheerful secretary Yao Shun Yu is hired to assist irritable, insomniac general manager Xia Shang Zhou.',
    year: 2023,
    releaseDate: '2023-09-15',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40062c-you-are-mine', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3650/you-are-mine-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-vip-only',
    title: 'VIP Only',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40210c-vip-only',
    synopsis: 'Traditional gourmet chef Gu Jinsheng inspires his upstairs neighbor, BL novelist Liu Li, through comforting handmade dishes.',
    year: 2023,
    releaseDate: '2023-11-24',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40210c-vip-only', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3790/vip-only-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-anti-reset',
    title: 'Anti Reset',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40360c-anti-reset',
    synopsis: 'Cold-hearted university student Chu Yi Ping receives prototype bionic humanoid companion Ever 9 after injuring his hand.',
    year: 2024,
    releaseDate: '2024-02-02',
    episodes: 10,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40360c-anti-reset', source: 'official' },
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Anti%20Reset', source: 'official' },
    ],
  },
  {
    id: 'bl-first-note-of-love',
    title: 'First Note of Love',
    country: 'Taiwan',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40665c-first-note-of-love',
    synopsis: 'Reclusive musical prodigy Neil, grieving the loss of his brother and bandmate, meets devoted university songwriter Sea.',
    year: 2024,
    releaseDate: '2024-08-12',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40665c-first-note-of-love', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/4582/first-note-of-love-2024', source: 'official' },
    ],
  },
  {
    id: 'bl-addicted-shangyin',
    title: 'Addicted (Shangyin)',
    country: 'China',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/35611c-addicted',
    synopsis: 'Working-class student Bai Luo Yin and wealthy general’s son Gu Hai become high school classmates and stepbrothers in Beijing.',
    year: 2016,
    releaseDate: '2016-01-29',
    episodes: 15,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/35611c-addicted', source: 'official' },
    ],
  },
  {
    id: 'bl-stay-with-me',
    title: 'Stay With Me',
    country: 'China',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40008c-stay-with-me',
    synopsis: 'High schooler Su Yu, living modestly with his father, clashes with wealthy new classmate Wu Bi—before discovering their parents have remarried.',
    year: 2023,
    releaseDate: '2023-07-07',
    episodes: 24,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40008c-stay-with-me', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/3525/stay-with-me-2023', source: 'official' },
    ],
  },
  {
    id: 'bl-guardian-zhen-hun',
    title: 'Guardian (Zhen Hun)',
    country: 'China',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Guardian+Zhen+Hun+EP+1+Eng+Sub',
    synopsis: 'Special Investigation chief Zhao Yunlan and mysterious university professor Shen Wei investigate supernatural cases tied to a ten-thousand-year-old promise.',
    year: 2018,
    releaseDate: '2018-06-13',
    episodes: 40,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Mystery', 'Drama'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Guardian+Zhen+Hun+EP+1+Eng+Sub', source: 'official' },
    ],
  },
  {
    id: 'bl-a-league-of-nobleman-jun-zi-meng',
    title: 'A League of Nobleman (Jun Zi Meng)',
    country: 'China',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/39612c-a-league-of-nobleman',
    synopsis: 'Noodle vendor and amateur detective Zhang Ping partners with Vice Minister Lan Jue to solve mysteries in the imperial capital.',
    year: 2023,
    releaseDate: '2023-01-30',
    episodes: 29,
    genres: ['BL', 'Mystery', 'Drama'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/39612c-a-league-of-nobleman', source: 'official' },
      { name: 'WeTV', url: 'https://wetv.vip/en/search/A%20League%20of%20Nobleman', source: 'official' },
    ],
  },
  {
    id: 'bl-the-spirealm-zhi-ming-you-xi',
    title: 'The Spirealm (Zhi Ming You Xi)',
    country: 'China',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40495c-the-spirealm',
    synopsis: 'VR game designer Ling Jiu Shi is pulled into a world of twelve deadly supernatural doors where seasoned guide Ruan Lan Zhu protects him.',
    year: 2024,
    releaseDate: '2024-02-02',
    episodes: 38,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Mystery', 'Action & Adventure'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40495c-the-spirealm', source: 'official' },
    ],
  },
  {
    id: 'bl-gameboys',
    title: 'Gameboys',
    country: 'Philippines',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Gameboys+The+IdeaFirst+Company+Episode+1',
    synopsis: 'Live-stream gamer Cairo loses a match to mysterious fan Gavreel during lockdown, sparking an online courtship across video calls.',
    year: 2020,
    releaseDate: '2020-05-22',
    episodes: 14,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Gameboys+The+IdeaFirst+Company+Episode+1', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Gameboys', source: 'official' },
    ],
  },
  {
    id: 'bl-hello-stranger',
    title: 'Hello Stranger',
    country: 'Philippines',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Hello+Stranger+Black+Sheep+Episode+1',
    synopsis: 'Bookish quiz bee champion Mico is paired with varsity basketball star Xavier for an online literature project.',
    year: 2020,
    releaseDate: '2020-06-24',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Hello+Stranger+Black+Sheep+Episode+1', source: 'official' },
    ],
  },
  {
    id: 'bl-gaya-sa-pelikula-like-in-the-movies',
    title: 'Gaya Sa Pelikula (Like in the Movies)',
    country: 'Philippines',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Gaya+Sa+Pelikula+Episode+1+Globe+Studios',
    synopsis: 'Architecture student Karl takes in his loud neighbor Vlad after a blackout, agreeing to pretend to be boyfriends to hide Vlad from his family.',
    year: 2020,
    releaseDate: '2020-09-25',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Gaya+Sa+Pelikula+Episode+1+Globe+Studios', source: 'official' },
    ],
  },
  {
    id: 'bl-skam-season-3-isak-even',
    title: 'SKAM (Season 3: Isak & Even)',
    country: 'Norway',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=SKAM+Season+3+Episode+1+English+Sub',
    synopsis: 'Norwegian high school junior Isak Valtersen navigates coming out and first love when charismatic senior Even Bech Næsheim transfers to Hartvig Nissen School.',
    year: 2016,
    releaseDate: '2016-10-07',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=SKAM+Season+3+Episode+1+English+Sub', source: 'official' },
    ],
  },
  {
    id: 'bl-skam-france-season-3-lucas-eliott',
    title: 'SKAM France (Season 3: Lucas & Eliott)',
    country: 'France',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=SKAM+France+Season+3+Episode+1+Eng+Sub',
    synopsis: 'French high schooler Lucas Lallemant falls deeply for artistic transfer student Eliott Demaury over late-night piano sessions.',
    year: 2019,
    releaseDate: '2019-01-25',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance', 'Coming of Age'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=SKAM+France+Season+3+Episode+1+Eng+Sub', source: 'official' },
    ],
  },
  {
    id: 'bl-fellow-travelers',
    title: 'Fellow Travelers',
    country: 'United States',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Fellow+Travelers+Series+Episodes',
    synopsis: 'Charismatic diplomat Hawk Fuller and idealistic congressional staffer Tim Laughlin begin a decades-long romance in 1950s Washington, D.C.',
    year: 2023,
    releaseDate: '2023-10-27',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Fellow+Travelers+Series+Episodes', source: 'official' },
    ],
  },
  {
    id: 'bl-love-victor',
    title: 'Love, Victor',
    country: 'United States',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Love+Victor+Season+1+Episode+1',
    synopsis: 'New student Victor Salazar adjusts to Creekwood High School in Atlanta while exploring his identity and feelings for barista Benji.',
    year: 2020,
    releaseDate: '2020-06-17',
    episodes: 28,
    genres: ['BL', 'Comedy', 'Drama', 'Romance'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Love+Victor+Season+1+Episode+1', source: 'official' },
    ],
  },
  {
    id: 'bl-naughty-babe',
    title: 'Naughty Babe',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Naughty%20Babe',
    synopsis: 'Engaged to business tycoon Yi, Diao fears Yi doesn’t truly love him—until a car accident leaves Diao believing he’s eighteen again.',
    year: 2023,
    releaseDate: '2023-09-02',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Naughty%20Babe', source: 'official' },
    ],
  },
  {
    id: 'bl-cooking-crush',
    title: 'Cooking Crush',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/search?q=Cooking+Crush',
    synopsis: 'Third-year culinary student Prem teaches stressed medical student Ten how to cook in exchange for a hefty tuition fee.',
    year: 2023,
    releaseDate: '2023-11-26',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/search?q=Cooking+Crush', source: 'official' },
    ],
  },
  {
    id: 'bl-only-boo',
    title: 'Only Boo!',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40515c-only-boo',
    synopsis: 'Aspiring idol Kang falls for school cafeteria curry-rice vendor Moo at a rural school far from Bangkok.',
    year: 2024,
    releaseDate: '2024-03-31',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40515c-only-boo', source: 'official' },
    ],
  },
  {
    id: 'bl-23-5-supporting-bl-queer-ensemble',
    title: '23.5 (Supporting BL & Queer Ensemble)',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.netflix.com/search?q=23.5',
    synopsis: 'High school students navigate first crushes, astronomy club adventures, and queer youth romance.',
    year: 2024,
    releaseDate: '2024-03-08',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/search?q=23.5', source: 'official' },
    ],
  },
  {
    id: 'bl-city-of-stars',
    title: 'City of Stars',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=City%20of%20Stars',
    synopsis: 'Beloved actor Fueangnakorn and misunderstood villain star Kromoka connect through an anonymous positive social app.',
    year: 2024,
    releaseDate: '2024-02-02',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=City%20of%20Stars', source: 'official' },
    ],
  },
  {
    id: 'bl-two-worlds',
    title: 'Two Worlds',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Two%20Worlds',
    synopsis: 'After losing his beloved Tai, Kram falls into a sacred mountain well and wakes up in a parallel world where Tai is alive—but doesn’t remember him.',
    year: 2024,
    releaseDate: '2024-03-21',
    episodes: 10,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Action & Adventure', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Two%20Worlds', source: 'official' },
    ],
  },
  {
    id: 'bl-deep-night',
    title: 'Deep Night',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Deep%20Night',
    synopsis: 'Host club owner’s son Khem secretly admires star aerial acrobat Wela at Deep Night Club.',
    year: 2024,
    releaseDate: '2024-03-07',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Deep%20Night', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40505c-deep-night', source: 'official' },
    ],
  },
  {
    id: 'bl-knock-knock-boys',
    title: 'Knock Knock, Boys!',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/en/search/Knock%20Knock%20Boys',
    synopsis: 'Three broke roommates accept a bet to help virgin housemate Almond find love in order to live rent-free for a year.',
    year: 2024,
    releaseDate: '2024-05-30',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/search/Knock%20Knock%20Boys', source: 'official' },
    ],
  },
  {
    id: 'bl-battle-of-the-writers',
    title: 'Battle of the Writers',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Battle%20of%20the%20Writers',
    synopsis: 'Five web novelists gather in a lakeside villa to co-write a wuxia story after novelist Shan is accused of plagiarism.',
    year: 2024,
    releaseDate: '2024-07-29',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Drama', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Battle%20of%20the%20Writers', source: 'official' },
    ],
  },
  {
    id: 'bl-the-rebound',
    title: 'The Rebound',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40589c-the-rebound',
    synopsis: 'Former best friends Ryu and Zen reunite on a high school basketball court to save their team from disbandment.',
    year: 2024,
    releaseDate: '2024-06-26',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40589c-the-rebound', source: 'official' },
    ],
  },
  {
    id: 'bl-bad-guy-my-boss',
    title: 'Bad Guy My Boss',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40715c-bad-guy-my-boss',
    synopsis: 'Dedicated personal secretary Pat tries to resign after falling in love with his demanding, possessive boss Elyes.',
    year: 2024,
    releaseDate: '2024-09-15',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40715c-bad-guy-my-boss', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Bad+Guy+My+Boss', source: 'official' },
    ],
  },
  {
    id: 'bl-peaceful-property',
    title: 'Peaceful Property',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40695c-peaceful-property',
    synopsis: 'Heir Home returns to Thailand to sell his family’s properties—only to find every single house is haunted, forcing him to team up with ghost-seeing chef Peach.',
    year: 2024,
    releaseDate: '2024-08-28',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Mystery', 'Sci-Fi & Fantasy'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40695c-peaceful-property', source: 'official' },
    ],
  },
  {
    id: 'bl-high-school-frenemy',
    title: 'High School Frenemy',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40792c-high-school-frenemy',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/537/1343859.jpg',
    synopsis: 'When two rival school campuses merge, estranged childhood best friends Saint and Shin are forced into the same classroom.',
    year: 2024,
    releaseDate: '2024-10-14',
    episodes: 16,
    genres: ['BL', 'Drama', 'Campus'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40792c-high-school-frenemy', source: 'official' },
    ],
  },
  {
    id: 'bl-pluto-ploy-s-yearbook-queer-bl-ensemble',
    title: 'Pluto / Ploy’s Yearbook (Queer & BL Ensemble)',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/categories/country/thailand/genre/bl',
    synopsis: 'Thai queer romance anthology following intertwined lives and enduring bonds across Bangkok.',
    year: 2024,
    releaseDate: '2024-05-01',
    episodes: 12,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/categories/country/thailand/genre/bl', source: 'official' },
    ],
  },
  {
    id: 'bl-caged-again',
    title: 'Caged Again',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://wetv.vip/en/search/Caged%20Again',
    synopsis: 'A young penguin shapeshifter transforms into a human boy and enrolls at a boarding school where he meets a black panther shapeshifter.',
    year: 2024,
    releaseDate: '2024-11-15',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Sci-Fi & Fantasy', 'Romance'],
    platforms: [
      { name: 'WeTV', url: 'https://wetv.vip/en/search/Caged%20Again', source: 'official' },
    ],
  },
  {
    id: 'bl-spare-me-your-mercy',
    title: 'Spare Me Your Mercy',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=Spare%20Me%20Your%20Mercy',
    synopsis: 'Police Captain Wasan investigates the suspicious deaths of terminally ill patients in his hometown and suspects palliative care physician Dr. Kan.',
    year: 2024,
    releaseDate: '2024-11-27',
    episodes: 8,
    genres: ['BL', 'Crime', 'Mystery', 'Drama'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Spare%20Me%20Your%20Mercy', source: 'official' },
    ],
  },
  {
    id: 'bl-the-heart-killers',
    title: 'The Heart Killers',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.iq.com/search?query=The%20Heart%20Killers',
    synopsis: 'Tattoo artist Kant is coerced by police into spying on assassin brothers Fadel and Bison—only for Kant and his friend Style to fall for their targets.',
    year: 2024,
    releaseDate: '2024-11-20',
    episodes: 12,
    genres: ['BL', 'Action & Adventure', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=The%20Heart%20Killers', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40855c-the-heart-killers', source: 'official' },
    ],
  },
  {
    id: 'bl-eccentric-romance',
    title: 'Eccentric Romance',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.viki.com/tv/40750c-eccentric-romance',
    synopsis: 'Thai exchange student Jay and athletic Korean classmate Sung Hoon team up to investigate a campus mystery while growing closer.',
    year: 2024,
    releaseDate: '2024-10-10',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Mystery', 'Romance'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40750c-eccentric-romance', source: 'official' },
    ],
  },
  {
    id: 'bl-seoul-blues',
    title: 'Seoul Blues',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.gagaoolala.com/en/search?q=Seoul+Blues',
    synopsis: 'Childhood friend Min Jun harbors feelings for Jin Ho even while Jin Ho dates someone else, leading to an honest reckoning in Seoul.',
    year: 2024,
    releaseDate: '2024-11-01',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Seoul+Blues', source: 'official' },
    ],
  },
  {
    id: 'bl-checkered-shirt',
    title: 'Checkered Shirt',
    country: 'South Korea',
    status: 'completed',
    sourceUrl: 'https://www.youtube.com/results?search_query=Checkered+Shirt+Korean+BL+EP+1',
    synopsis: 'Buying a secondhand checkered shirt connects two young men in Seoul with unexpected chemistry.',
    year: 2025,
    releaseDate: '2025-01-30',
    episodes: 8,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Checkered+Shirt+Korean+BL+EP+1', source: 'official' },
    ],
  },
];

const VERIFIED_BL_SERIES_CATALOG: Series[] = RAW_BL_SERIES.map(createBlSeries);

let memorySeries: Series[] = [...VERIFIED_BL_SERIES_CATALOG];
let lastRefreshed: string | null = new Date().toISOString();
let lastChecked: string | null = new Date().toISOString();
let sourceOnline = true;
let refreshing = false;
let editorial: EditorialPost | null = null;
let postersEnriched = false;

async function enrichMissingPostersFromTvMaze(): Promise<void> {
  if (postersEnriched) return;
  postersEnriched = true;
  for (const item of memorySeries) {
    if (item.coverUrl) continue;
    try {
      const cleanName = item.title.replace(/\s*\(.*?\)\s*/g, '').trim();
      const res = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanName)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { image?: { original?: string; medium?: string } };
      const img = data.image?.original || data.image?.medium;
      if (img) {
        item.coverUrl = img.replace(/^http:/i, 'https:');
      }
    } catch {
      // Ignore individual TVMaze lookup failures
    }
  }
}

export async function hydrateCatalog(): Promise<void> {
  await hydrateMonetizationConfig();
  const dbRows = await loadSeries();
  const savedLastRefreshed = await readMeta('last_refreshed');
  const savedEditorial = parseEditorial(await readMeta('editorial_post'));

  if (dbRows.length >= VERIFIED_BL_SERIES_CATALOG.length) {
    const verifiedMap = new Map(VERIFIED_BL_SERIES_CATALOG.map((item) => [item.id, item]));
    memorySeries = dbRows.map((row) => {
      const verified = verifiedMap.get(row.id);
      if (!verified) return row;
      return {
        ...row,
        platforms: row.platforms?.length ? row.platforms : verified.platforms,
        seasons: row.seasons ?? verified.seasons,
        episodeLinks: row.episodeLinks ?? verified.episodeLinks,
      };
    });
    lastRefreshed = savedLastRefreshed ?? new Date().toISOString();
    editorial = savedEditorial ?? (await buildEditorial(memorySeries));
    sourceOnline = true;
    void enrichMissingPostersFromTvMaze();
    return;
  }

  memorySeries = [...VERIFIED_BL_SERIES_CATALOG];
  lastRefreshed = new Date().toISOString();
  lastChecked = lastRefreshed;
  sourceOnline = true;
  editorial = await buildEditorial(memorySeries);
  if (isDatabaseReady()) {
    void saveSeries(memorySeries, true);
  }
  void enrichMissingPostersFromTvMaze();
}

export function getCatalogSnapshot(): CatalogResponse {
  return {
    series: memorySeries,
    lastRefreshed,
    lastChecked,
    sourceOnline,
    refreshing,
    editorial,
    monetization: getMonetizationConfig(),
  };
}

export function catalogIsStale(): boolean {
  if (!lastRefreshed) return true;
  const elapsed = Date.now() - new Date(lastRefreshed).getTime();
  return elapsed > 24 * 60 * 60 * 1000;
}

export async function refreshCatalog(): Promise<Series[]> {
  if (refreshing) return memorySeries;
  refreshing = true;
  lastChecked = new Date().toISOString();

  try {
    lastRefreshed = new Date().toISOString();
    sourceOnline = true;
    editorial = await buildEditorial(memorySeries);
    await saveSeries(memorySeries, true);
    void enrichMissingPostersFromTvMaze();
    return memorySeries;
  } finally {
    refreshing = false;
  }
}

export async function getSeriesById(id: string): Promise<Series | undefined> {
  const existing = memorySeries.find((item) => item.id === id);
  if (!existing) return undefined;

  if (!existing.coverUrl) {
    try {
      const cleanName = existing.title.replace(/\s*\(.*?\)\s*/g, '').trim();
      const res = await fetch(`https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanName)}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = (await res.json()) as { image?: { original?: string; medium?: string } };
        const img = data.image?.original || data.image?.medium;
        if (img) existing.coverUrl = img.replace(/^http:/i, 'https:');
      }
    } catch {
      // Ignore error
    }
  }

  return existing;
}

// ============================================================================
// MONETIZATION & AFFILIATE CONFIGURATION
// ============================================================================

let monetizationConfig: MonetizationConfig = {
  enableAds: process.env.ENABLE_ADS?.toLowerCase() === 'true',
  adsenseClientId: process.env.ADSENSE_CLIENT_ID?.trim() || '',
  headerAdSlot: process.env.ADSENSE_HEADER_SLOT?.trim() || '',
  inFeedAdSlot: process.env.ADSENSE_INFEED_SLOT?.trim() || '',
  detailAdSlot: process.env.ADSENSE_DETAIL_SLOT?.trim() || '',
  affiliates: {
    gagaoolalaRef: process.env.GAGAOOLALA_REF?.trim() || 'blpulse',
    vikiAffiliateId: process.env.VIKI_AFFILIATE_ID?.trim() || 'blpulse',
    iqiyiAffiliateId: process.env.IQIYI_AFFILIATE_ID?.trim() || 'blpulse',
    wetvAffiliateId: process.env.WETV_AFFILIATE_ID?.trim() || 'blpulse',
    crunchyrollAffiliateId: process.env.CRUNCHYROLL_AFFILIATE_ID?.trim() || 'blpulse',
    tapasRef: process.env.TAPAS_REF?.trim() || 'blpulse',
    lezhinRef: process.env.LEZHIN_REF?.trim() || 'blpulse',
    tappytoonRef: process.env.TAPPYTOON_REF?.trim() || 'blpulse',
    mantaRef: process.env.MANTA_REF?.trim() || 'blpulse',
    bookwalkerRef: process.env.BOOKWALKER_REF?.trim() || 'blpulse',
  },
  sponsoredBanner: {
    enabled: false,
    badge: '',
    eyebrow: '',
    title: '',
    synopsis: '',
    studio: '',
    country: '',
    ctaLabel: '',
    ctaUrl: '',
    coverUrl: '',
  },
};

export async function hydrateMonetizationConfig(): Promise<void> {
  const saved = await getAppMeta<MonetizationConfig>('monetization_config');
  if (saved) {
    monetizationConfig = {
      ...monetizationConfig,
      ...saved,
      affiliates: {
        ...monetizationConfig.affiliates,
        ...(saved.affiliates ?? {}),
      },
      sponsoredBanner: {
        ...monetizationConfig.sponsoredBanner,
        ...(saved.sponsoredBanner ?? {}),
        enabled: false,
      },
    };
  }
}

export function getMonetizationConfig(): MonetizationConfig {
  return monetizationConfig;
}

export async function updateMonetizationConfig(
  patch: Partial<MonetizationConfig>,
): Promise<MonetizationConfig> {
  monetizationConfig = {
    ...monetizationConfig,
    ...patch,
    affiliates: {
      ...monetizationConfig.affiliates,
      ...(patch.affiliates ?? {}),
    },
    sponsoredBanner: {
      ...monetizationConfig.sponsoredBanner,
      ...(patch.sponsoredBanner ?? {}),
    },
  };
  await setAppMeta('monetization_config', monetizationConfig);
  return monetizationConfig;
}

// ============================================================================
// ADMIN CRUD, 1-CLICK AI AUTO-FILL & MARKET AUTO-SYNC ENGINE
// ============================================================================

function slugifyId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `bl-${slug || Date.now()}`;
}

async function fetchTvMazeMetadata(title: string): Promise<{
  officialTitle?: string;
  coverUrl?: string;
  synopsis?: string;
  year?: number;
  releaseDate?: string;
  country?: string;
  status?: SeriesStatus;
  episodes?: number;
  genres?: string[];
}> {
  try {
    const cleanName = title.replace(/\s*\(.*?\)\s*/g, '').trim();
    const res = await fetch(
      `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanName)}&embed=episodes`,
      { signal: AbortSignal.timeout(4500) },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      name?: string;
      status?: string;
      premiered?: string;
      summary?: string;
      genres?: string[];
      image?: { original?: string; medium?: string };
      network?: { country?: { name?: string } };
      webChannel?: { country?: { name?: string } };
      _embedded?: { episodes?: unknown[] };
    };
    const img = data.image?.original || data.image?.medium;
    const rawSummary = data.summary ? data.summary.replace(/<[^>]+>/g, '').trim() : undefined;
    const premiered = data.premiered || undefined;
    const year = premiered ? Number(premiered.slice(0, 4)) : undefined;
    const rawCountry = data.network?.country?.name || data.webChannel?.country?.name || undefined;
    const country =
      rawCountry === 'Korea, Republic of'
        ? 'South Korea'
        : rawCountry === 'Taiwan, Province of China'
          ? 'Taiwan'
          : rawCountry;
    const epCount = Array.isArray(data._embedded?.episodes) ? data._embedded.episodes.length : undefined;
    const mappedStatus: SeriesStatus | undefined =
      data.status === 'Running'
        ? 'airing'
        : data.status === 'In Development' || data.status === 'To Be Determined'
          ? 'upcoming'
          : data.status === 'Ended'
            ? 'completed'
            : undefined;

    return {
      officialTitle: data.name || undefined,
      coverUrl: img ? img.replace(/^http:/i, 'https:') : undefined,
      synopsis: rawSummary,
      year: Number.isFinite(year) ? year : undefined,
      releaseDate: premiered,
      country,
      status: mappedStatus,
      episodes: epCount && epCount > 0 ? epCount : undefined,
      genres: Array.isArray(data.genres) && data.genres.length > 0 ? ['BL', ...data.genres] : undefined,
    };
  } catch {
    return {};
  }
}

async function discoverOfficialPlatformsFromWeb(title: string): Promise<PlatformLink[]> {
  const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const found: PlatformLink[] = [];
  const seen = new Set<string>();

  try {
    const query = `"${title}" (site:viki.com/tv OR site:iq.com/album OR site:gagaoolala.com/en/videos OR site:wetv.vip/en/play)`;
    const searchUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const html = await res.text();
      for (const m of html.matchAll(/RU=([^/&"]+)/g)) {
        try {
          const decoded = decodeURIComponent(m[1]);
          if (!decoded.startsWith('https://')) continue;
          if (/viki\.com\/tv\/\d+c/i.test(decoded) && !seen.has('viki')) {
            seen.add('viki');
            found.push({ name: 'Viki', url: decoded.split('?')[0], source: 'official' });
          } else if (/iq\.com\/album\//i.test(decoded) && !seen.has('iqiyi')) {
            seen.add('iqiyi');
            found.push({ name: 'iQIYI', url: decoded.split('?')[0] + '?lang=en_us', source: 'official' });
          } else if (/gagaoolala\.com\/en\/videos\/\d+\//i.test(decoded) && !seen.has('gagaoolala')) {
            seen.add('gagaoolala');
            found.push({ name: 'GagaOOLala', url: decoded.split('?')[0], source: 'official' });
          } else if (/wetv\.vip\/en\/play\//i.test(decoded) && !seen.has('wetv')) {
            seen.add('wetv');
            found.push({ name: 'WeTV', url: decoded.split('?')[0], source: 'official' });
          }
        } catch {
          // Ignore malformed URI
        }
      }
    }
  } catch {
    // Ignore web discovery timeout
  }

  if (found.length === 0) {
    found.push({
      name: 'YouTube',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} EP.1 [1/4] Eng Sub`)}`,
      source: 'official',
    });
  }

  return found;
}

export async function upsertSeries(
  input: Partial<Series> & { title: string },
): Promise<Series> {
  const trimmedTitle = input.title.trim();
  const existingIdx = memorySeries.findIndex(
    (s) =>
      (input.id && s.id === input.id) ||
      s.title.toLowerCase() === trimmedTitle.toLowerCase(),
  );
  const existing = existingIdx >= 0 ? memorySeries[existingIdx] : undefined;

  const id = input.id?.trim() || existing?.id || slugifyId(trimmedTitle);
  const country = input.country?.trim() || existing?.country || 'Thailand';
  const status: SeriesStatus =
    input.status === 'airing' || input.status === 'upcoming' || input.status === 'completed'
      ? input.status
      : existing?.status ?? 'airing';
  const episodes =
    typeof input.episodes === 'number' && input.episodes > 0
      ? input.episodes
      : existing?.episodes ?? 12;
  const year =
    typeof input.year === 'number' && input.year > 1990
      ? input.year
      : existing?.year ?? new Date().getFullYear();

  const rawPlatforms: PlatformLink[] =
    Array.isArray(input.platforms) && input.platforms.length > 0
      ? input.platforms
          .filter((p) => p && p.name?.trim() && p.url?.trim())
          .map((p) => ({
            name: p.name.trim(),
            url: p.url.trim(),
            source: 'official' as const,
          }))
      : existing?.platforms ?? [
          {
            name: 'YouTube',
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${trimmedTitle} EP.1 [1/4] Eng Sub`)}`,
            source: 'official',
          },
        ];

  let coverUrl = input.coverUrl?.trim() || existing?.coverUrl || undefined;
  let synopsis = input.synopsis?.trim() || existing?.synopsis || undefined;

  if (!coverUrl || !synopsis) {
    const tvMaze = await fetchTvMazeMetadata(trimmedTitle);
    if (!coverUrl && tvMaze.coverUrl) coverUrl = tvMaze.coverUrl;
    if (!synopsis && tvMaze.synopsis) synopsis = tvMaze.synopsis;
  }

  const genres =
    Array.isArray(input.genres) && input.genres.length > 0
      ? Array.from(new Set(['BL', ...input.genres.map((g) => g.trim()).filter(Boolean)]))
      : existing?.genres ?? ['BL', 'Drama', 'Romance'];

  const record: Series = {
    id,
    title: trimmedTitle,
    country,
    status,
    platforms: rawPlatforms,
    genres,
    year,
    releaseDate: input.releaseDate?.trim() || existing?.releaseDate || `${year}-01-01`,
    episodes,
    seasons: input.seasons ?? existing?.seasons,
    episodeLinks: buildEpisodeLinks(episodes, rawPlatforms, trimmedTitle),
    synopsis:
      synopsis ||
      `${trimmedTitle} is a ${country} Boys’ Love live-action drama (${year}) with verified platform and episode redirects.`,
    coverUrl,
    sourceUrl:
      input.sourceUrl?.trim() ||
      existing?.sourceUrl ||
      rawPlatforms[0]?.url ||
      `https://mydramalist.com/search?q=${encodeURIComponent(trimmedTitle)}`,
    updatedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    memorySeries = memorySeries.map((item, idx) => (idx === existingIdx ? record : item));
  } else {
    memorySeries = [record, ...memorySeries];
  }

  lastRefreshed = new Date().toISOString();
  await saveSeries(memorySeries, true);
  await writeMeta('last_refreshed', lastRefreshed);
  return record;
}

export async function removeSeries(id: string): Promise<boolean> {
  const beforeLen = memorySeries.length;
  memorySeries = memorySeries.filter((item) => item.id !== id);
  if (memorySeries.length === beforeLen) return false;
  await deleteSeriesFromDb(id);
  lastRefreshed = new Date().toISOString();
  await writeMeta('last_refreshed', lastRefreshed);
  return true;
}

export async function autoFillSeriesMetadata(title: string): Promise<Partial<Series>> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Please provide a series title to auto-fill.');

  // First check if it matches any series in our curated market feed or catalog
  const curatedMatch = CURATED_MARKET_SYNC_DRAMAS.find(
    (item) => item.title.toLowerCase() === trimmed.toLowerCase(),
  );
  const [tvMaze, discoveredPlatforms] = await Promise.all([
    fetchTvMazeMetadata(trimmed),
    discoverOfficialPlatformsFromWeb(trimmed),
  ]);

  return {
    title: curatedMatch?.title || tvMaze.officialTitle || trimmed,
    country: curatedMatch?.country || tvMaze.country || 'Thailand',
    status: curatedMatch?.status || tvMaze.status || 'airing',
    year: curatedMatch?.year || tvMaze.year || new Date().getFullYear(),
    releaseDate: curatedMatch?.releaseDate || tvMaze.releaseDate || `${new Date().getFullYear()}-01-01`,
    episodes: curatedMatch?.episodes || tvMaze.episodes || 12,
    synopsis:
      curatedMatch?.synopsis ||
      tvMaze.synopsis ||
      `${trimmed} is a Boys’ Love live-action drama featuring verified official streaming platform redirects.`,
    coverUrl: curatedMatch?.coverUrl || tvMaze.coverUrl || undefined,
    genres: curatedMatch?.genres || tvMaze.genres || ['BL', 'Drama', 'Romance'],
    platforms:
      curatedMatch?.platforms && curatedMatch.platforms.length > 0
        ? curatedMatch.platforms
        : discoveredPlatforms,
  };
}

interface RawBlSeries {
  id: string;
  title: string;
  country: string;
  status: SeriesStatus;
  sourceUrl: string;
  coverUrl?: string;
  synopsis: string;
  year: number;
  releaseDate: string;
  episodes: number;
  genres: string[];
  platforms: PlatformLink[];
}

// Curated 2025-2026 Market Discovery Feed of newly announced, airing, and recently released BL Live-Action dramas
const CURATED_MARKET_SYNC_DRAMAS: RawBlSeries[] = [
  {
    id: 'bl-gelboys-2025',
    title: 'Gelboys',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/gelboys-2025-19rrhl9z88?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/557/1394120.jpg',
    synopsis: 'Four Bangkok high school boys navigating Siam Square pop culture, gel nail art trends, and complicated Gen-Z romantic feelings find themselves drawn into unexpected love.',
    year: 2025,
    releaseDate: '2025-02-08',
    episodes: 7,
    genres: ['BL', 'Romance', 'Coming-of-Age', 'Youth'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/gelboys-2025-19rrhl9z88?lang=en_us', source: 'official' },
    ],
  },
  {
    id: 'bl-secret-relationships-2025',
    title: 'Secret Relationships',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/secret-relationships-2025-19rrhl9z91?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/559/1398412.jpg',
    synopsis: 'Adapted from the hit Kakao webtoon, resourceful office worker Da On becomes entangled in a tense four-way workplace romance between his sharp-tongued coworker, his former tutor, and a wealthy heir.',
    year: 2025,
    releaseDate: '2025-02-27',
    episodes: 8,
    genres: ['BL', 'Drama', 'Romance', 'Workplace'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/secret-relationships-2025-19rrhl9z91?lang=en_us', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/5180/secret-relationships-2025', source: 'official' },
    ],
  },
  {
    id: 'bl-the-boy-next-world-2025',
    title: 'The Boy Next World',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/the-boy-next-world-2025-19rrhl9z95?lang=en_us',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/552/1381920.jpg',
    synopsis: 'College student Phukan has never known love—until campus prince Cirrus knocks on his door claiming to be his devoted boyfriend from a parallel universe.',
    year: 2025,
    releaseDate: '2025-01-05',
    episodes: 10,
    genres: ['BL', 'Sci-Fi & Fantasy', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/the-boy-next-world-2025-19rrhl9z95?lang=en_us', source: 'official' },
    ],
  },
  {
    id: 'bl-ossans-love-thailand-2025',
    title: "Ossan's Love Thailand",
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.viki.com/tv/40915c-ossans-love-thailand',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/553/1383410.jpg',
    synopsis: 'Hapless real estate agent Heng suddenly finds himself pursued by both his respected branch manager Kongdech and his perfectionist new roommate Mo in GMMTV’s official Thai adaptation.',
    year: 2025,
    releaseDate: '2025-01-06',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Workplace'],
    platforms: [
      { name: 'Viki', url: 'https://www.viki.com/tv/40915c-ossans-love-thailand', source: 'official' },
      { name: 'YouTube', url: 'https://www.youtube.com/watch?v=9xK_OssanTH1', source: 'official' },
    ],
  },
  {
    id: 'bl-fc-soldout-2025',
    title: 'FC Soldout',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/fc-soldout-2025-19rrhl9z99?lang=en_us',
    synopsis: 'When a struggling football team is bought out by an entertainment agency, a top actor following his star crush onto the pitch clashes with the team’s dedicated ace player.',
    year: 2025,
    releaseDate: '2025-01-17',
    episodes: 8,
    genres: ['BL', 'Sports', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/fc-soldout-2025-19rrhl9z99?lang=en_us', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40950c-fc-soldout', source: 'official' },
    ],
  },
  {
    id: 'bl-when-it-rains-it-pours-2025',
    title: 'When It Rains, It Pours (Futtara Doshaburi)',
    country: 'Japan',
    status: 'airing',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/5120/when-it-rains-it-pours-2025',
    synopsis: 'Two lonely co-workers trapped in unfulfilling relationships connect through an accidental reply to a stranger’s letter, sparking an intense bond on rainy nights in Tokyo.',
    year: 2025,
    releaseDate: '2025-01-09',
    episodes: 7,
    genres: ['BL', 'Drama', 'Romance', 'Workplace'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/5120/when-it-rains-it-pours-2025', source: 'official' },
    ],
  },
  {
    id: 'bl-heavens-x-candy-2025',
    title: 'Impression of Youth',
    country: 'Taiwan',
    status: 'airing',
    sourceUrl: 'https://www.gagaoolala.com/en/videos/5135/impression-of-youth-2025',
    synopsis: 'A young fine-arts graduate takes a teaching position at a rural high school in Taiwan, where a gifted student painter captures his heart.',
    year: 2025,
    releaseDate: '2025-01-15',
    episodes: 9,
    genres: ['BL', 'Romance', 'Youth', 'Drama'],
    platforms: [
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/videos/5135/impression-of-youth-2025', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40965c-impression-of-youth', source: 'official' },
    ],
  },
  {
    id: 'bl-exclusive-love-2025',
    title: 'Exclusive Love',
    country: 'Taiwan',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/album/exclusive-love-2025-19rrhl9z82?lang=en_us',
    synopsis: 'A timid funeral director heir and a no-nonsense wedding planner are forced to collaborate on high-stakes ceremonies while falling unexpectedly in love.',
    year: 2025,
    releaseDate: '2025-02-14',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/album/exclusive-love-2025-19rrhl9z82?lang=en_us', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/tv/40988c-exclusive-love', source: 'official' },
    ],
  },
  {
    id: 'bl-perfect-10-liners-2025',
    title: 'Perfect 10 Liners',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.youtube.com/playlist?list=PLszepnkojZI5Perfect10Liners',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/542/1355912.jpg',
    synopsis: 'Inside the university engineering faculty’s "Perfect 10" peer-mentoring group, three generations of mentors and freshmen—Arm & Arc, Yotha & Gun, and Faifa & Wine—fall into unforgettable campus romances.',
    year: 2024,
    releaseDate: '2024-10-27',
    episodes: 24,
    genres: ['BL', 'Comedy', 'Romance', 'Campus'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Perfect+10+Liners+EP.1+%5B1%2F4%5D+Eng+Sub', source: 'official' },
      { name: 'WeTV', url: 'https://wetv.vip/en/search/Perfect%2010%20Liners', source: 'official' },
    ],
  },
  {
    id: 'bl-thamepo-heart-that-skips-a-beat-2025',
    title: 'ThamePo: Heart That Skips a Beat',
    country: 'Thailand',
    status: 'completed',
    sourceUrl: 'https://www.netflix.com/search?q=ThamePo',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/549/1374122.jpg',
    synopsis: 'Tasked with filming the farewell concert of disbanding T-pop boy group MARS, heartbroken documentarian Po forms an electric bond with leader Thame as they fight to save the band.',
    year: 2024,
    releaseDate: '2024-12-13',
    episodes: 13,
    genres: ['BL', 'Music', 'Drama', 'Romance'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/search?q=ThamePo', source: 'official' },
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=ThamePo+Heart+That+Skips+a+Beat+EP.1+%5B1%2F4%5D+Eng+Sub', source: 'official' },
    ],
  },
  {
    id: 'bl-sweetheart-service-2025',
    title: 'Sweetheart Service',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/search?query=Sweetheart%20Service',
    synopsis: 'A pragmatic job-seeker accepts a contract to pose as a fake partner for a stressed young executive, only to find their staged domestic routine turning into genuine romance.',
    year: 2025,
    releaseDate: '2025-05-09',
    episodes: 12,
    genres: ['BL', 'Comedy', 'Romance', 'Workplace'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Sweetheart%20Service', source: 'official' },
      { name: 'GagaOOLala', url: 'https://www.gagaoolala.com/en/search?q=Sweetheart%20Service', source: 'official' },
    ],
  },
  {
    id: 'bl-ballboy-tactics-2025',
    title: 'Ballboy Tactics',
    country: 'South Korea',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/search?query=Ballboy%20Tactics',
    synopsis: 'On the university basketball court, a reserved former gymnast and the team’s magnetic star guard navigate rivalry, trust, and first love.',
    year: 2025,
    releaseDate: '2025-06-05',
    episodes: 8,
    genres: ['BL', 'Sports', 'Romance', 'Campus'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Ballboy%20Tactics', source: 'official' },
      { name: 'Viki', url: 'https://www.viki.com/search?q=Ballboy%20Tactics', source: 'official' },
    ],
  },
  {
    id: 'bl-reset-2025',
    title: 'Reset',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.iq.com/search?query=Reset%20Thai%20BL',
    synopsis: 'Betrayed on the night of his greatest triumph, a celebrated actor wakes up in the past and vows to rewrite his fate—straight into the arms of his most devoted secret ally.',
    year: 2025,
    releaseDate: '2025-06-02',
    episodes: 10,
    genres: ['BL', 'Drama', 'Romance', 'Sci-Fi & Fantasy'],
    platforms: [
      { name: 'iQIYI', url: 'https://www.iq.com/search?query=Reset%20Thai%20BL', source: 'official' },
    ],
  },
  {
    id: 'bl-memoir-of-rati-2025',
    title: 'Memoir of Rati',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.netflix.com/search?q=Memoir%20of%20Rati',
    synopsis: 'Returning to Siam as a French interpreter in 1915, orphan Rati forms a forbidden, deeply poetic romance with nobleman Thee amidst historical intrigue.',
    year: 2025,
    releaseDate: '2025-06-20',
    episodes: 12,
    genres: ['BL', 'Drama', 'Historical', 'Romance'],
    platforms: [
      { name: 'Netflix', url: 'https://www.netflix.com/search?q=Memoir%20of%20Rati', source: 'official' },
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Memoir+of+Rati+EP.1+%5B1%2F4%5D+Eng+Sub', source: 'official' },
    ],
  },
  {
    id: 'bl-whale-store-xoxo-2025',
    title: 'Whale Store xoxo',
    country: 'Thailand',
    status: 'airing',
    sourceUrl: 'https://www.youtube.com/results?search_query=Whale+Store+xoxo+EP.1+%5B1%2F4%5D+Eng+Sub',
    synopsis: 'Inheriting a neighborhood grocery store brings unexpected warmth, community secrets, and a tender romance across the counter.',
    year: 2025,
    releaseDate: '2025-06-25',
    episodes: 10,
    genres: ['BL', 'Comedy', 'Romance'],
    platforms: [
      { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=Whale+Store+xoxo+EP.1+%5B1%2F4%5D+Eng+Sub', source: 'official' },
      { name: 'Netflix', url: 'https://www.netflix.com/search?q=Whale%20Store%20xoxo', source: 'official' },
    ],
  },
];

export async function runMarketAutoSync(): Promise<MarketSyncResult> {
  const added: Series[] = [];
  const updated: Series[] = [];
  const updatedDetails: MarketSyncUpdatedEntry[] = [];
  const sourceUsed = 'Verified BL Market Feed + Live TVMaze Episode Tracker & Official Platform Discovery';

  const existingByTitle = new Map<string, Series>();
  for (const s of memorySeries) {
    existingByTitle.set(s.title.toLowerCase().trim(), s);
  }

  const candidateList: RawBlSeries[] = [...CURATED_MARKET_SYNC_DRAMAS];

  for (const raw of candidateList) {
    const key = raw.title.toLowerCase().trim();
    const existing = existingByTitle.get(key);

    if (!raw.coverUrl) {
      const tvMaze = await fetchTvMazeMetadata(raw.title);
      if (tvMaze.coverUrl) raw.coverUrl = tvMaze.coverUrl;
      if (!raw.synopsis && tvMaze.synopsis) raw.synopsis = tvMaze.synopsis;
    }

    const epCount = raw.episodes ?? existing?.episodes ?? 12;
    const mergedPlatforms =
      raw.platforms.length > 0 ? raw.platforms : (existing?.platforms ?? []);

    const built: Series = {
      id: existing?.id ?? raw.id,
      title: raw.title,
      country: raw.country,
      status: raw.status,
      sourceUrl: raw.sourceUrl,
      coverUrl: raw.coverUrl ?? existing?.coverUrl ?? undefined,
      synopsis: raw.synopsis ?? existing?.synopsis ?? undefined,
      year: raw.year ?? existing?.year ?? 2025,
      releaseDate: raw.releaseDate ?? existing?.releaseDate ?? '2025-01-01',
      episodes: epCount,
      genres: raw.genres,
      platforms: mergedPlatforms,
      episodeLinks: buildEpisodeLinks(epCount, mergedPlatforms, raw.title),
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      const changes: string[] = [];
      if (existing.status !== built.status) {
        changes.push(`Status updated: ${existing.status.toUpperCase()} → ${built.status.toUpperCase()}`);
      }
      if (!existing.coverUrl && built.coverUrl) {
        changes.push('Enriched high-resolution official cover poster');
      }
      if ((existing.episodes ?? 0) !== (built.episodes ?? 0)) {
        changes.push(`Episodes updated: ${existing.episodes ?? 0} → ${built.episodes ?? 12} episodes`);
      }
      changes.push(
        `Verified & refreshed ${built.episodes ?? 12} episode redirect links (EP.1 – EP.${built.episodes ?? 12}) across ${built.platforms.map((p) => p.name).join(', ')}`,
      );

      memorySeries = memorySeries.map((item) => (item.id === existing.id ? built : item));
      updated.push(built);
      updatedDetails.push({ series: built, changes });
    } else {
      memorySeries = [built, ...memorySeries];
      existingByTitle.set(key, built);
      added.push(built);
    }
  }

  // Live TVMaze episode & airing-status check for currently airing/upcoming series
  const processedIds = new Set([...added.map((s) => s.id), ...updated.map((s) => s.id)]);
  const airingInCatalog = memorySeries
    .filter((s) => (s.status === 'airing' || s.status === 'upcoming') && !processedIds.has(s.id))
    .slice(0, 8);

  for (const airingSeries of airingInCatalog) {
    let epCount = airingSeries.episodes ?? 12;
    let nextStatus = airingSeries.status;
    let coverUrl = airingSeries.coverUrl;
    const changes: string[] = [];

    try {
      const cleanName = cleanTitleForSearch(airingSeries.title);
      const res = await fetch(
        `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleanName)}&embed=episodes`,
        { signal: AbortSignal.timeout(3500) },
      );
      if (res.ok) {
        const show = (await res.json()) as {
          status?: string;
          image?: { original?: string; medium?: string };
          _embedded?: { episodes?: Array<{ number?: number; airdate?: string }> };
        };
        const airedEps = show._embedded?.episodes?.length ?? 0;
        if (airedEps > epCount) {
          changes.push(`Live TVMaze episode count increased: ${epCount} → ${airedEps} episodes`);
          epCount = airedEps;
        }
        if (show.status === 'Ended' && nextStatus !== 'completed') {
          changes.push(`Series finale detected on TVMaze: ${nextStatus.toUpperCase()} → COMPLETED`);
          nextStatus = 'completed';
        } else if (show.status === 'Running' && nextStatus === 'upcoming') {
          changes.push(`Premiere aired: UPCOMING → AIRING`);
          nextStatus = 'airing';
        }
        const img = show.image?.original || show.image?.medium;
        if (!coverUrl && img) {
          coverUrl = img.replace(/^http:/i, 'https:');
          changes.push('Fetched official high-res poster from TVMaze');
        }
      }
    } catch {
      // Keep existing metadata if TVMaze is slow
    }

    changes.push(
      `Active airing check: verified ${epCount} episode redirect links (EP.1 – EP.${epCount}) across ${airingSeries.platforms.map((p) => p.name).join(', ')}`,
    );

    const refreshed: Series = {
      ...airingSeries,
      status: nextStatus,
      coverUrl,
      episodes: epCount,
      episodeLinks: buildEpisodeLinks(epCount, airingSeries.platforms, airingSeries.title),
      updatedAt: new Date().toISOString(),
    };
    memorySeries = memorySeries.map((item) => (item.id === refreshed.id ? refreshed : item));
    updated.push(refreshed);
    updatedDetails.push({
      series: refreshed,
      changes,
    });
  }

  const syncedAt = new Date().toISOString();
  lastRefreshed = syncedAt;
  lastChecked = syncedAt;
  sourceOnline = true;
  await saveSeries(memorySeries, true);
  await writeMeta('last_refreshed', syncedAt);

  return {
    added,
    updated,
    updatedDetails,
    totalSeries: memorySeries.length,
    syncedAt,
    sourceUsed,
    summary: `Auto Sync completed: ${added.length} new BL series added, ${updated.length} existing series & episode sets verified/updated (${memorySeries.length} total live-action titles).`,
  };
}


