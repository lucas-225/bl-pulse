import type { EditorialPost, Series } from '../shared/types.js';

function fallbackPost(series: Series[]): EditorialPost {
  const pick = series.find((item) => item.status === 'airing') ?? series.find((item) => item.status === 'upcoming') ?? series[0];
  const generatedAt = new Date().toISOString();
  if (!pick) {
    return {
      title: 'Your next story starts here',
      body: 'The catalog is refreshing. Come back soon to explore the latest source-listed series.',
      generatedAt,
      source: 'BL Pulse',
    };
  }
  const status = pick.status === 'airing' ? 'currently airing' : pick.status === 'upcoming' ? 'upcoming' : 'completed';
  return {
    title: `${pick.title} is on the signal`,
    body: `${pick.title} is listed as ${status} in ${pick.country}. Open its source guide for available details and verified viewing links.`,
    generatedAt,
    source: 'BL Pulse',
  };
}

function getText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => typeof part?.text === 'string' ? part.text : '').join('\n').trim();
  return '';
}

export async function buildEditorial(series: Series[]): Promise<EditorialPost> {
  const fallback = fallbackPost(series);
  const apiUrl = process.env.MANUS_API_URL || process.env.BUILT_IN_FORGE_API_URL;
  const apiKey = process.env.MANUS_API_KEY || process.env.BUILT_IN_FORGE_API_KEY;
  if (!apiUrl || !apiKey) return fallback;

  const evidence = series.filter((item) => item.status !== 'completed').slice(0, 12).map((item) => ({
    title: item.title,
    status: item.status,
    country: item.country,
    verifiedPlatforms: item.platforms.map((platform) => platform.name),
  }));
  if (evidence.length === 0) return fallback;

  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(18_000),
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'Write one short editorial recommendation for a BL series discovery site. Use only the supplied title, status, country, and verified-platform facts. Do not invent a plot, cast, release date, award, or availability. Return exactly two plain-text lines: a short headline, then one or two concise sentences. Do not add markdown or quotation marks.',
          },
          { role: 'user', content: JSON.stringify(evidence) },
        ],
        max_tokens: 150,
        temperature: 0.55,
      }),
    });
    if (!response.ok) return fallback;
    const result = await response.json() as { error?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
    if (result.error) return fallback;
    const content = getText(result.choices?.[0]?.message?.content).trim();
    const lines = content.split(/\r?\n/).map((line) => line.replace(/^[-*#\s]+/, '').trim()).filter(Boolean);
    if (lines.length < 2) return fallback;
    const title = lines[0].slice(0, 100);
    const body = lines.slice(1).join(' ').slice(0, 420);
    if (title.length < 4 || body.length < 20) return fallback;
    return { title, body, generatedAt: new Date().toISOString(), source: 'AI-assisted' };
  } catch {
    return fallback;
  }
}
