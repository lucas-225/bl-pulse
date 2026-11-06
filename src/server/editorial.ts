import type { EditorialPost, Series } from '../shared/types.js';

export function currentDateKey(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hashDateSeed(dateKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

const EDITORIAL_HEADLINE_TEMPLATES = [
  (s: Series) => `Tonight on the Signal: ${s.title}`,
  (s: Series) => `Midnight Spotlight: ${s.title} (${s.country})`,
  (s: Series) => `Why ${s.title} belongs on your watchlist tonight`,
  (s: Series) => `From ${s.country}: ${s.title} is capturing the signal`,
  (s: Series) => `Editor’s Midnight Pick: ${s.title}`,
  (s: Series) => `Don’t miss ${s.title} on official platforms`,
];

export function buildDailyEditorialSync(series: Series[], now = new Date()): EditorialPost {
  const generatedAt = now.toISOString();
  if (!series || series.length === 0) {
    return {
      title: 'Your next story starts here',
      body: 'The catalog is refreshing. Come back soon to explore the latest verified Boys’ Love series.',
      generatedAt,
      source: 'BL Pulse',
    };
  }

  // Prioritize airing and upcoming series alongside top completed titles for daily variety
  const airingAndUpcoming = series.filter((s) => s.status === 'airing' || s.status === 'upcoming');
  const pool = airingAndUpcoming.length >= 7 ? [...airingAndUpcoming, ...series.slice(0, 25)] : series;

  const dateKey = currentDateKey(now);
  const seed = hashDateSeed(dateKey);
  const pick = pool[seed % pool.length] ?? series[0];
  const template = EDITORIAL_HEADLINE_TEMPLATES[seed % EDITORIAL_HEADLINE_TEMPLATES.length];

  const platformNames = pick.platforms.map((p) => p.name).join(', ') || 'official licensed platforms';
  const statusPhrase =
    pick.status === 'airing'
      ? 'currently airing new episodes'
      : pick.status === 'upcoming'
        ? 'gearing up for its upcoming premiere'
        : `available to binge across ${pick.episodes ?? 12} episodes`;

  const cleanSynopsis = pick.synopsis
    ? pick.synopsis.length > 210
      ? `${pick.synopsis.slice(0, 207).trimEnd()}…`
      : pick.synopsis
    : `${pick.title} is a standout ${pick.country} Boys’ Love drama (${pick.genres.slice(0, 3).join(' · ') || 'Romance'}).`;

  return {
    title: template(pick),
    body: `${cleanSynopsis} Now ${statusPhrase} from ${pick.country} — stream or follow directly on ${platformNames}.`,
    generatedAt,
    source: 'BL Pulse',
  };
}

export async function buildEditorial(series: Series[], now = new Date()): Promise<EditorialPost> {
  return buildDailyEditorialSync(series, now);
}
