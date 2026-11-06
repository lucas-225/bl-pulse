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

// Strictly verified BL anime (by exact AniList ID) that genuinely stream full episodes, OVAs, ONAs, or movies on YouTube
const VERIFIED_YOUTUBE_ANIME_URLS: Record<number, string> = {
  21709: 'https://www.youtube.com/watch?v=8FlQecyv0ek',  // Yuri!!! on ICE (Full Episodes 1-12)
  108430: 'https://www.youtube.com/watch?v=YH2KpQcMOuA', // given
  111734: 'https://www.youtube.com/watch?v=YH2KpQcMOuA', // Given The Movie
  134710: 'https://www.youtube.com/watch?v=MaRgBdKKmrM', // given: on the other hand OVA
  175199: 'https://www.youtube.com/watch?v=YH2KpQcMOuA', // given The Movie: To the Sea
  126288: 'https://www.youtube.com/watch?v=iENQpq6__PQ', // Sasaki and Miyano
  143082: 'https://www.youtube.com/watch?v=iENQpq6__PQ', // Sasaki and Miyano: A Tiny Episode From Before He Realized His Feelings
  146743: 'https://www.youtube.com/watch?v=HXcEt2xC6FA', // Sasaki and Miyano: Graduation
  21096: 'https://www.youtube.com/watch?v=vrcua2WDwTg',  // Doukyuusei -Classmates- (Full Movie)
  113260: 'https://www.youtube.com/watch?v=ddbi3UQW73U', // Heaven Official's Blessing (Tian Guan Ci Fu)
  126356: 'https://www.youtube.com/watch?v=ddbi3UQW73U', // Heaven Official's Blessing Special Episode
  127976: 'https://www.youtube.com/watch?v=XEQgRcYTmeA', // Heaven Official's Blessing Season 2
  101972: 'https://www.youtube.com/watch?v=1a04FyRdSgo', // Mo Dao Zu Shi / The Founder of Diabolism S1 (Tencent Video Official)
  104458: 'https://www.youtube.com/watch?v=1a04FyRdSgo', // The Founder of Diabolism 2 (Tencent Video Official)
  121467: 'https://www.youtube.com/watch?v=1a04FyRdSgo', // The Founder of Diabolism: Final Season (Tencent Video Official)
  108978: 'https://www.youtube.com/watch?v=fvCB2bCSQr4', // Scumbag System / Chuan Shu Zijiu Zhinan (Tencent Video Official)
  120213: 'https://www.youtube.com/watch?v=jgd0X6j14KM', // Thousand Autumns / Shanhe Jian Xin (Tencent Video Official EP01-16)
  116182: 'https://www.youtube.com/watch?v=hRUbuwKaSJc', // Legend of Exorcism / Tianbao Fuyao Lu (Bilibili Official Full Episodes)
  126366: 'https://www.youtube.com/watch?v=TW3ePyzhQac', // Epic of Divinity Light / Dinghai Fusheng Lu (Bilibili Official All Episodes)
  10161: 'https://www.youtube.com/watch?v=Uipgs8qP2XQ',  // No. 6
  20520: 'https://www.youtube.com/watch?v=XFvkPu0MEA4',  // LOVE STAGE!!
  20960: 'https://www.youtube.com/watch?v=XFvkPu0MEA4',  // LOVE STAGE!!: Chotto ja Nakutte OVA
  87494: 'https://www.youtube.com/watch?v=6VGqe9YforU',  // Hitorijime My Hero
  3092: 'https://www.youtube.com/watch?v=OGYx-oK4rs4',   // Junjo Romantica
  4814: 'https://www.youtube.com/watch?v=tJnvKGSuZtw',   // Junjo Romantica 2
  20796: 'https://www.youtube.com/watch?v=SrQMzxYDFio',  // Junjou Romantica 3
  13767: 'https://www.youtube.com/watch?v=tJnvKGSuZtw',  // Junjou Romantica OVA
  9926: 'https://www.youtube.com/watch?v=kBr9TdLxX0w',   // Sekai Ichi Hatsukoi - The World's Greatest First Love
  11123: 'https://www.youtube.com/watch?v=kBr9TdLxX0w',  // Sekai Ichi Hatsukoi 2
  20371: 'https://www.youtube.com/watch?v=kBr9TdLxX0w',  // Sekai Ichi Hatsukoi: Yokozawa Takafumi no Baai
  8063: 'https://www.youtube.com/watch?v=kBr9TdLxX0w',   // Sekaiichi Hatsukoi OVA
  20684: 'https://www.youtube.com/watch?v=kBr9TdLxX0w',  // Sekaiichi Hatsukoi: Valentine-hen
  111305: 'https://www.youtube.com/watch?v=kBr9TdLxX0w', // Sekaiichi Hatsukoi: Propose-hen
  167087: 'https://www.youtube.com/watch?v=o1u3niikZKo', // Cherry Magic! Thirty Years of Virginity Can Make You a Wizard?!
  166700: 'https://www.youtube.com/playlist?list=PLxSscENEp7JhJvAQ5lW4naMb67Rlv3J1j', // Twilight Out of Focus (Ani-One Official Playlist)
  21177: 'https://www.youtube.com/playlist?list=PLxSscENEp7JglWiR0yhW9tGY-dt5XVAqX',  // SUPER LOVERS (Ani-One Official Playlist)
  21836: 'https://www.youtube.com/playlist?list=PLxSscENEp7JhyjmWrOjshiPzt2wIkDJ2t',  // SUPER LOVERS 2 (Ani-One Official Playlist)
  183127: 'https://www.youtube.com/watch?v=xVF41MtAmr8', // Let's Go Karaoke! (Karaoke Iko!)
  20677: 'https://www.youtube.com/watch?v=tZNq6SK82b4',  // DRAMAtical Murder
  21011: 'https://www.youtube.com/watch?v=tZNq6SK82b4',  // DRAMAtical Murder OVA: Data_xx_Transitory
  130591: 'https://www.youtube.com/watch?v=E0pstfl0MMM', // Sabikui Bisco (Muse Asia Official)
  103303: 'https://www.youtube.com/watch?v=DiwKqV4j6os', // Sparks of Tomorrow
  5525: 'https://www.youtube.com/watch?v=FqToRGCbNJo',   // 07-Ghost
  3655: 'https://www.youtube.com/watch?v=VlBl9s92R9A',   // Nabari no Ou
  101374: 'https://www.youtube.com/watch?v=M6tVHsjJA-k', // Yarichin☆Bitch-bu
  98031: 'https://www.youtube.com/watch?v=UvqkF3x44kc',  // Spiritpact (Ling Qi)
  100813: 'https://www.youtube.com/watch?v=FB8NETZdC6g', // Spiritpact -Bond of The Underworld-
  243: 'https://www.youtube.com/watch?v=x1_TDNby62U',    // Gravitation (Nozomi Entertainment)
  507: 'https://www.youtube.com/watch?v=Kp2nJaD8TWo',    // Gravitation: Lyrics of Love OVA
  21782: 'https://www.youtube.com/watch?v=r7swEZR-RA0',  // The Highschool Life of a Fudanshi
  103000: 'https://www.youtube.com/watch?v=zPGq99wMVFI', // Jingai-san no Yome
  21837: 'https://www.youtube.com/watch?v=7USUlg9OaBs',  // Gakuen Handsome
  21392: 'https://www.youtube.com/watch?v=yuOotAUSAIM',  // Gakuen Handsome The Animation
  531: 'https://www.youtube.com/watch?v=mq9bKHDWZSo',    // Sailor Moon R: The Movie (Official YouTube Movie)
  18465: 'https://www.youtube.com/watch?v=vsqL9NgjRWo',  // Genshiken Second Generation
  11135: 'https://www.youtube.com/watch?v=5jUvcfCTDLQ',  // Hybrid Child OVA
  907: 'https://www.youtube.com/watch?v=cY7YmN-NpVo',    // Princess Princess
  8634: 'https://www.youtube.com/watch?v=FzEm0wxqiKw',   // Koi Suru Boukun (The Tyrant Falls in Love) OVA
  135584: 'https://www.youtube.com/watch?v=EyMT3rj8SMw', // Mignon
  109412: 'https://www.youtube.com/watch?v=wEH9ylNS16w', // Hyperventilation
  184815: 'https://www.youtube.com/watch?v=wEH9ylNS16w', // Hyperventilation Special
  12695: 'https://www.youtube.com/watch?v=zrlx4KA4rFk',  // Tight-rope OVA
  553: 'https://www.youtube.com/watch?v=kI3eZge9ATo',    // Descendants of Darkness (Yami no Matsuei)
  5774: 'https://www.youtube.com/watch?v=hNgt1zNDO50',   // Hey, Class President! (Seitokaichou ni Chuukoku) OVA
  15933: 'https://www.youtube.com/watch?v=x48drkte3wI',  // Vassalord. OVA
  104080: 'https://www.youtube.com/watch?v=5_eqP15scOg', // Look, I Can See Your Ears! (Bilibili Official)
  107984: 'https://www.youtube.com/watch?v=BaiPymJF5FM', // Look, I Can See Your Ears! S2 (Bilibili Official)
  719: 'https://www.youtube.com/watch?v=HZCnBpM7UNs',    // Ai no Kusabi
  5784: 'https://www.youtube.com/watch?v=5RZtvWiVi3E',   // Ai no Kusabi (2012)
  3375: 'https://www.youtube.com/watch?v=CAGwQF0G8SM',   // Kirepapa. OVA
  1532: 'https://www.youtube.com/watch?v=TcnWBQw1SyM',   // Sukisho
  746: 'https://www.youtube.com/watch?v=MCt33fyeuAA',    // Papa to Kiss in the Dark OVA
  132821: 'https://www.youtube.com/watch?v=X9QMvlwcTEc', // Semantic Error Special
  1961: 'https://www.youtube.com/watch?v=Wri-mwxRGUc',   // One Stormy Night (Arashi no Yoru ni)
  106165: 'https://www.youtube.com/watch?v=EK1C0vb0SLU', // Even a Dad Still Wants It... (Papa Datte, Shitai)
  11355: 'https://www.youtube.com/watch?v=Uvrc08UwKc0',  // This Boy Can Fight Aliens!
  15439: 'https://www.youtube.com/watch?v=ZjvGT27S2w0',  // This Boy Caught a Merman
  1637: 'https://www.youtube.com/watch?v=-gMcBHYiSpI',   // The Poem of Wind and Trees (Kaze to Ki no Uta)
  3210: 'https://www.youtube.com/watch?v=HcMfHBIgkJQ',   // Ikoku Irokoi Romantan OVA
  4080: 'https://www.youtube.com/watch?v=Osga0vPXNqI',   // Kyo Kara Maoh! Season 3
  2971: 'https://www.youtube.com/watch?v=Kqjr4rEw4R4',   // Kyo Kara Maoh R
  103888: 'https://www.youtube.com/watch?v=G26nYZljB8E', // Caramel Honey
  621: 'https://www.youtube.com/watch?v=JkyCXEeiiDA',    // Nightwalker: The Midnight Detective
  2148: 'https://www.youtube.com/watch?v=IehLfePFib8',   // No Money! (Okane ga Nai) OVA
  129046: 'https://www.youtube.com/watch?v=h2N7OfAO_zU', // 6 LOVERS
  5902: 'https://www.youtube.com/watch?v=k6R0C0YgzOg',   // Maiden Rose (Hyakujitsu no Bara) OVA
  5719: 'https://www.youtube.com/watch?v=nLDgcN-Smok',   // SEX PISTOLS OVA
  2835: 'https://www.youtube.com/watch?v=cmGQhAf0NqA',   // Patalliro!
  1035: 'https://www.youtube.com/watch?v=eWbFe34_fpc',   // Patalliro Saiyuki!
  205068: 'https://www.youtube.com/watch?v=HJf9EbFYVXU', // One-Room TA (All Episodes)
  129973: 'https://www.youtube.com/watch?v=05bkyd_wYf4', // Everything for Demon King Evelogia
  365: 'https://www.youtube.com/watch?v=hZtQo4F5uFs',    // FAKE OVA
  187362: 'https://www.youtube.com/watch?v=Oo5n2ErFmYM', // Tamaranai no wa Koi nano ka
  1019: 'https://www.youtube.com/watch?v=L6l7uus3Ano',   // Mirage of Blaze
  1020: 'https://www.youtube.com/watch?v=L6l7uus3Ano',   // Mirage of Blaze: Rebels of the River Edge OVA
  747: 'https://www.youtube.com/watch?v=iwq-VAj82t0',    // Embracing Love: Cherished Spring (Haru wo Daiteita) OVA
  2238: 'https://www.youtube.com/watch?v=iwq-VAj82t0',   // Embracing Love: A Cicada in Winter (Fuyu no Semi) OVA
  201961: 'https://www.youtube.com/watch?v=jw9dRj4eces', // Quiet Please!
  98081: 'https://www.youtube.com/watch?v=JdO33JZqviQ',  // Otokonoko ♂ Delivery
  185261: 'https://www.youtube.com/watch?v=DnrPZtIF79U', // Neko ni Naritai Tamagawa-kun
  213666: 'https://www.youtube.com/watch?v=lJIiCnJfDOw', // Perfect Addiction
  7110: 'https://www.youtube.com/watch?v=RWYOF2AuN9o',   // Shounen Maid Kuro-kun: Tenshi no Uta OVA
  212563: 'https://www.youtube.com/watch?v=pD3jhTYmsME', // Isekai Office Worker OVA
  12137: 'https://www.youtube.com/watch?v=d9xAlU4BZwM',  // Robotica * Robotics
  1041: 'https://www.youtube.com/watch?v=u2rb7_FYZJE',   // Zetsuai 1989 OVA
  1042: 'https://www.youtube.com/watch?v=S1qKwgOvN7I',   // BRONZE: ZETSUAI since 1989 OVA
  199446: 'https://www.youtube.com/watch?v=Tlg_4jb2w44', // I'll Live a Long Life to Dote on My Favorite Stepbrother!
  20568: 'https://www.youtube.com/watch?v=dEmiKKBK_Uw',  // Angel's Feather
  2592: 'https://www.youtube.com/watch?v=bB2uPeXxmTg',   // Kimera OVA
  177678: 'https://www.youtube.com/watch?v=8ORXhm3Bm6g', // Unexpectedly Naughty Fukami
  2220: 'https://www.youtube.com/watch?v=gj6gskwU55c',   // BE-BOY KIDNAPP'N IDOL OVA
  8339: 'https://www.youtube.com/watch?v=eRzh5c8F4YQ',   // Kachou no Koi OVA
  724: 'https://www.youtube.com/watch?v=_f9IG_lJ7tw',    // Enzai OVA
  1912: 'https://www.youtube.com/watch?v=OFCRvLicUr4',   // Marginal Prince
  1908: 'https://www.youtube.com/watch?v=8Mttu-2Cmkw',   // LESSON XX OVA
  173240: 'https://www.youtube.com/watch?v=m0ja93h_8s4', // The Perfect Prince Loves Me, the Side Character?!
  168632: 'https://www.youtube.com/watch?v=paUWu0cnUIs', // The Dangerous Convenience Store
  97920: 'https://www.youtube.com/watch?v=DUHzggKBT8k',  // Koisuru Shirokuma
  733: 'https://www.youtube.com/watch?v=6EJEcshRXXg',    // KIZUNA OVA
  734: 'https://www.youtube.com/watch?v=ff5NL-CxOmk',    // Kizuna: Much Ado About Nothing OVA
  136796: 'https://www.youtube.com/watch?v=lDXmqREmQoo', // Caressing the Nipples of My Hibernating Bear
  110211: 'https://www.youtube.com/watch?v=wtxL7oUtqig', // Someone Else's BL Comic Animation
  132816: 'https://www.youtube.com/watch?v=HRQXnNOO1PY', // Unbelievable Space Love
  1217: 'https://www.youtube.com/watch?v=AAbRQQAbz-Q',   // Seikimatsu★Darling OVA
  1216: 'https://www.youtube.com/watch?v=Og2x_UDRcFc',   // I shall never return (Boku wa Konomama Kaeranai) OVA
  2219: 'https://www.youtube.com/watch?v=vbsGGpIW2d0',   // Ryokunohara Labyrinth: Sparkling Phantom OVA
  730: 'https://www.youtube.com/watch?v=ogviYgC44YA',    // After School in the Teachers' Lounge OVA
  184290: 'https://www.youtube.com/watch?v=rLTlTTXki88', // 4 Week Lovers
  2153: 'https://www.youtube.com/watch?v=oKKg5PNARdU',   // Saint Beast: Kouin Jojishi Tenshi Tan
  120771: 'https://www.youtube.com/watch?v=L6QopiKEnlQ', // Manly Appetites: Minegishi Loves Otsu
};

// Verified direct streaming platform links for BL anime (by exact AniList ID)
const VERIFIED_ANIME_PLATFORM_SUPPLEMENTS: Record<number, StreamingLink[]> = {
  108430: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GRG5WWD4R/given' }],
  111734: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/watch/G64G2V8E6/given-the-movie' }],
  134710: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GRG5WWD4R/given' }],
  162987: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GRG5WWD4R/given' }],
  175199: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GRG5WWD4R/given' }],
  21709: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GY8VM85MR/yuri-on-ice' }],
  124153: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G5PHNM434/sk8-the-infinity' }],
  100388: [{ site: 'Amazon Prime Video', url: 'https://www.amazon.com/dp/B07F8579GX' }],
  169698: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G9VHN9Q34/tadaima-okaeri' }],
  167087: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GQWH0M1P3/cherry-magic-thirty-years-of-virginity-can-make-you-a-wizard' }],
  166700: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G8DHV7843/twilight-out-of-focus' }],
  126288: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GEXH3W804/sasaki-and-miyano' }],
  146743: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GEXH3W804/sasaki-and-miyano' }],
  112788: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/watch/G31UXW8E0/the-stranger-by-the-shore' }],
  101381: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G6W43K05R/dakaichi--im-being-harassed-by-the-sexiest-man-of-the-year-' }],
  149: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GYQ43P536/loveless' }],
  553: [{ site: 'RetroCrush', url: 'https://www.retrocrush.tv/series/012399s/descendants-of-darkness' }],
  112930: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G0XHWM380/yes-no-or-maybe' }],
  10161: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GY19042QR/no-6' }],
  21177: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GRW42D70R/super-lovers' }],
  21836: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GRW42D70R/super-lovers' }],
  3092: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GR758GE4Y/junjo-romantica' }],
  4814: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GR758GE4Y/junjo-romantica' }],
  20796: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/GR758GE4Y/junjo-romantica' }],
  9926: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G6JQVM3GY/sekai-ichi-hatsukoi---the-worlds-greatest-first-love' }],
  11123: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G6JQVM3GY/sekai-ichi-hatsukoi---the-worlds-greatest-first-love' }],
  20520: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G609G480Y/love-stage' }],
  87494: [{ site: 'Amazon Prime Video', url: 'https://www.amazon.com/dp/B073SFHBM2' }],
  113260: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G79H23XX8/heaven-officials-blessing' }],
  127976: [{ site: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/G79H23XX8/heaven-officials-blessing' }],
  177689: [{ site: 'Netflix', url: 'https://www.netflix.com/title/81948057' }],
};

function safeDirectMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
    }
    if (url.protocol !== 'https:') return null;
    if (url.hostname === 'youtu.be') {
      const vid = url.pathname.replace(/^\/+/, '').split('/')[0];
      return vid && /^[a-zA-Z0-9_-]{11}$/.test(vid) ? `https://www.youtube.com/watch?v=${vid}` : null;
    }
    // Reject generic root homepages or bare language homepages (e.g. /, /en, /en-us/)
    if ((url.pathname === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(url.pathname)) && !url.search) return null;
    // Reject generic search result or category pages
    if (/\/search\b|\/results\b|\/categories\b/i.test(url.pathname)) return null;
    // For YouTube, allow verified /watch?v= videos and official /playlist?list= streaming playlists; reject bare channel/user handles
    if (/(?:^|\.)youtube\.com$/i.test(url.hostname)) {
      const isWatch = url.pathname === '/watch' && Boolean(url.searchParams.get('v'));
      const isPlaylist = url.pathname === '/playlist' && Boolean(url.searchParams.get('list'));
      if (!isWatch && !isPlaylist) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isEnglishOrGlobalUrl(url: string): boolean {
  return /lezhinus\.com|\/en\/|tapas\.io|tappytoon\.com\/en|manta\.net|webtoons\.com\/en|crunchyroll\.com|netflix\.com|bilibili\.tv\/en|iq\.com|wetv\.vip\/en|gagaoolala\.com\/en|mangaplaza\.com|viz\.com|yenpress\.com|sevenseasentertainment\.com|sublimemanga\.com|kodansha\.us|comics\.inkr\.com/i.test(
    url,
  );
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
  if (record.status === 'CANCELLED') return false;
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

  // Sort STREAMING links ahead of INFO/READING publisher links, and prefer English/global URLs
  const rawExternal = [...(record.externalLinks ?? [])].sort((a, b) => {
    const aScore = a.type === 'STREAMING' ? 0 : 1;
    const bScore = b.type === 'STREAMING' ? 0 : 1;
    if (aScore !== bScore) return aScore - bScore;
    const aEn = isEnglishOrGlobalUrl(a.url ?? '') ? 0 : 1;
    const bEn = isEnglishOrGlobalUrl(b.url ?? '') ? 0 : 1;
    return aEn - bEn;
  });

  const streamingOnlyLinks: StreamingLink[] = rawExternal
    .filter((link) => link.type === 'STREAMING')
    .filter((link) => !/twitter|x\.com|tiktok|instagram|facebook|weibo|bsky\.app|bluesky/i.test(`${link.site ?? ''} ${link.url ?? ''}`))
    .flatMap((link) => {
      const url = safeDirectMediaUrl(link.url);
      const site = link.site?.trim();
      return url && site ? [{ url, site }] : [];
    });

  const infoPublisherLinks: StreamingLink[] = rawExternal
    .filter((link) => link.type !== 'STREAMING')
    .filter((link) => !/twitter|x\.com|tiktok|instagram|facebook|weibo|bsky\.app|bluesky|wikipedia|animenewsnetwork|myanimelist|anilist|syoboi/i.test(`${link.site ?? ''} ${link.url ?? ''}`))
    .flatMap((link) => {
      const url = safeDirectMediaUrl(link.url);
      const site = link.site?.trim();
      if (!url || !site) return [];
      // Exclude generic corporate "Official Site" links when verified streaming or reading platforms exist
      if (/official site/i.test(site)) return [];
      return [{ url, site }];
    });

  const bySite = new Map<string, StreamingLink>();
  const titleText = displayTitle(record);

  // Include verified supplements for anime when known
  const supplements = type === 'ANIME' ? (VERIFIED_ANIME_PLATFORM_SUPPLEMENTS[record.id] ?? []) : [];

  for (const link of [...streamingOnlyLinks, ...supplements, ...infoPublisherLinks]) {
    const key = link.site.toLowerCase();
    const existing = bySite.get(key);
    if (!existing || (!isEnglishOrGlobalUrl(existing.url) && isEnglishOrGlobalUrl(link.url))) {
      bySite.set(key, link);
    }
  }

  for (const ep of episodeLinks) {
    if (ep.site && !bySite.has(ep.site.toLowerCase())) {
      bySite.set(ep.site.toLowerCase(), { site: ep.site, url: ep.url });
    }
  }

  // Only include YouTube under an anime if it is strictly verified to stream full episodes on YouTube
  const verifiedYtUrl = type === 'ANIME' ? VERIFIED_YOUTUBE_ANIME_URLS[record.id] : undefined;
  if (verifiedYtUrl) {
    bySite.set('youtube', { site: 'YouTube', url: verifiedYtUrl });
  }

  const directLinks = Array.from(bySite.values());
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

    // Verify that MangaDex actually has readable chapters before listing MangaDex as a verified reading platform
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

    // Only list MangaDex if chapters are actually verified on MangaDex
    if (chapterEpisodes.length === 0) {
      return normalized;
    }

    const mdUrl = `https://mangadex.org/title/${matched.id}`;
    const hasMdLink = normalized.streamingLinks.some((l) => l.site.toLowerCase() === 'mangadex');
    const updatedLinks = hasMdLink
      ? normalized.streamingLinks.map((l) => (l.site.toLowerCase() === 'mangadex' ? { site: 'MangaDex', url: mdUrl } : l))
      : [{ site: 'MangaDex', url: mdUrl }, ...normalized.streamingLinks];

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
          if (!url || !site) return [];
          if (/wikipedia|ann|animenewsnetwork|syoboi|myanimelist|anilist|official/i.test(site)) return [];
          // For YouTube, only allow if verified in VERIFIED_YOUTUBE_ANIME_URLS or direct /watch?v=
          if (/youtube/i.test(site) && !VERIFIED_YOUTUBE_ANIME_URLS[record.id]) return [];
          return [{ site, url }];
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
