import type { MediaPageResponse, MediaTitle } from '../shared/media.js';
import { DEFAULT_MINIMUM_BL_TAG_RANK } from '../shared/media.js';
import type { CatalogResponse, Series } from '../shared/types.js';
import { metadataForPath, type SeoMetadata } from '../shared/seo.js';

export interface SeoDocument {
  status: number;
  metadata: SeoMetadata;
  html: string;
}

const HERO_IMAGE_PATH = '/assets/aistudio/blpulse-mark_2739ad76.png';

export function configuredPublicOrigin(): string | null {
  const raw = (
    process.env.BL_PULSE_PUBLIC_ORIGIN?.trim() ||
    process.env.APP_URL?.trim() ||
    'https://ais-pre-jpbci2wrepcgwlz5asgvyt-726732803057.asia-southeast1.run.app'
  );
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function safeHttpsUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function boundedHeading(value: string): string {
  return value.length <= 78 ? value : `${value.slice(0, 77).trimEnd()}…`;
}

function seriesLinks(series: Series[]): string {
  if (!series.length) return '<p class="seo-empty">Live-action title discovery will appear here when its licensed data connection is enabled.</p>';
  return `<ul class="seo-title-list">${series.slice(0, 12).map((item) => `<li><a href="/series/${encodeURIComponent(item.id)}">${escapeHtml(item.title)}</a><span>${escapeHtml(item.country)} · ${escapeHtml(item.status)}</span></li>`).join('')}</ul>`;
}

function mediaLinks(page: MediaPageResponse | undefined, kind: 'anime' | 'manga'): string {
  if (!page?.items.length) return `<p class="seo-empty">${kind === 'anime' ? 'BL anime' : 'BL manga'} titles will appear when AniList returns a matching page. Use the controls below to retry or browse another order.</p>`;
  return `<ul class="seo-title-list">${page.items.slice(0, 12).map((item) => { const params = new URLSearchParams(); if (item.isAdult) params.set('mature', '1'); if ((item.boysLoveRank ?? 0) < DEFAULT_MINIMUM_BL_TAG_RANK) params.set('tagRank', 'all'); const query = params.toString(); return `<li><a href="/${kind}/${item.id}${query ? `?${query}` : ''}">${escapeHtml(item.displayTitle)}</a><span>${escapeHtml(item.format ?? (kind === 'anime' ? 'Anime' : 'Manga'))}${item.startYear ? ` · ${item.startYear}` : ''} · BL tag rank ${item.boysLoveRank ?? '—'}${item.isAdult ? ' · Mature content' : ''}</span></li>`; }).join('')}</ul>`;
}

function prerenderBody(
  pathname: string,
  catalog: CatalogResponse,
  series?: Series,
  mediaPage?: MediaPageResponse,
  media?: MediaTitle,
  homeAnimePage?: MediaPageResponse,
  homeMangaPage?: MediaPageResponse,
  mediaSourceUnavailable = false,
): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  if (mediaSourceUnavailable && /^\/(?:anime|manga)$/.test(path)) {
    const kind = path.slice(1);
    return `<div class="app-shell"><main class="detail-missing page-content"><a href="/${kind}">Retry ${kind} discovery</a><h1>${kind === 'anime' ? 'BL Anime' : 'BL Manga'} temporarily unavailable.</h1><p>AniList did not return this collection just now. Please retry shortly; the catalog is fetched live.</p></main></div>`;
  }
  if (path === '/') {
    return `<div class="app-shell"><main><section class="hero"><div class="hero-glow"></div><div class="hero-content"><div class="hero-kicker">BL PULSE · STORIES WORTH STAYING UP FOR</div><h1>Your next story<br><span>starts here.</span></h1><p class="hero-copy">Explore BL series, anime and manga, then follow source-backed links to official viewing platforms.</p><div class="hero-actions"><a class="button button-primary" href="/discover">Explore live-action</a><a class="button button-secondary" href="/anime">Browse BL anime</a><a class="button button-secondary" href="/manga">Browse BL manga</a></div><div class="hero-footnote"><span class="pulse-mini"></span>Live-action, Anime and Manga browse live</div></div><div class="hero-side-note"><span>THE</span><span>BL</span><span>COLLECTION</span></div><div class="hero-bottom-fade"></div></section><div class="page-content"><section class="content-section"><div class="section-heading"><div><div class="eyebrow">LIVE-ACTION DISCOVERY</div><h2>Find the feeling. Follow the story.</h2></div></div>${seriesLinks(catalog.series)}</section><section class="content-section"><div class="section-heading"><div><div class="eyebrow">ANILIST · LIVE BROWSING</div><h2>BL Anime</h2></div></div>${mediaLinks(homeAnimePage ?? mediaPage, 'anime')}<a href="/anime">Explore the anime library</a></section><section class="content-section"><div class="section-heading"><div><div class="eyebrow">ANILIST · LIVE BROWSING</div><h2>BL Manga</h2></div></div>${mediaLinks(homeMangaPage, 'manga')}<a href="/manga">Explore the manga library</a></section></div></main></div>`;
  }

  if (path === '/discover') {
    return `<div class="app-shell"><main class="discover-page page-content"><div class="discover-heading"><div class="eyebrow">BL PULSE · DISCOVERY</div><h1>Find your next story.</h1><p>Search strictly Boys’ Love live-action series, then review title details, episodes, and direct streaming destinations.</p>${seriesLinks(catalog.series)}</div></main></div>`;
  }

  if (path === '/anime' || path === '/manga') {
    const kind = path.slice(1) as 'anime' | 'manga';
    const title = kind === 'anime' ? 'BL Anime discovery' : 'BL Manga discovery';
    const category = kind === 'anime' ? 'anime' : 'manga';
    return `<div class="app-shell"><main class="media-library page-content"><div class="eyebrow">ANILIST · BOYS’ LOVE TAG</div><h1>${title}</h1><p>Search the live AniList index, browse recent or older releases, and open each title for source tags and available episode or chapter destinations.</p><p class="media-attribution">Titles and cover art are supplied by AniList. Results are fetched as you browse; this site does not store the catalog.</p>${mediaLinks(mediaPage, category)}<p>Browse popular, newest and oldest matching titles. Use Load more to continue the source pagination.</p></main></div>`;
  }

  if (series) {
    const synopsis = series.synopsis?.trim() || `Explore ${series.title}, a ${series.country} BL series. See available release details and follow the listed viewing destinations.`;
    const platforms = series.platforms.map((platform) => {
      const url = safeHttpsUrl(platform.url);
      return url ? `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(platform.name)} viewing destination</a></li>` : '';
    }).filter(Boolean).join('');
    const image = safeHttpsUrl(series.coverUrl);
    const imageMarkup = image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(series.title)} poster" width="360" height="520">` : '';
    return `<div class="app-shell"><main class="detail-page"><section class="detail-hero"><div class="detail-hero-image" style="${image ? `background-image:linear-gradient(90deg,rgba(9,8,13,.99),rgba(9,8,13,.38)),url('${escapeHtml(image)}')` : ''}"></div><div class="detail-hero-content"><div class="eyebrow">BL SERIES · ${escapeHtml(series.country)}</div><h1>${escapeHtml(boundedHeading(series.title))}</h1><p class="detail-synopsis">${escapeHtml(synopsis)}</p><a class="button button-secondary" href="/discover">Back to discovery</a></div></section><article class="detail-body page-content">${imageMarkup}<h2>Series details</h2><p>${escapeHtml(synopsis)}</p><p>Status: ${escapeHtml(series.status)}${series.year ? ` · ${series.year}` : ''}</p><h2>Viewing destinations</h2>${platforms ? `<ul>${platforms}</ul>` : '<p>No confirmed destination is listed yet. Check the title details again for updates.</p>'}</article></main></div>`;
  }

  if (media) {
    const kind = media.type === 'ANIME' ? 'anime' : 'manga';
    const links = media.streamingEpisodes.map((episode) => `<li><a href="${escapeHtml(episode.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(episode.title)}${episode.site ? ` · ${escapeHtml(episode.site)}` : ''}</a></li>`).join('');
    const platforms = media.streamingLinks.map((link) => `<li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.site)} ${kind === 'anime' ? 'title page' : 'reading page'}</a></li>`).join('');
    const image = safeHttpsUrl(media.coverImage);
    return `<div class="app-shell"><main class="media-detail page-content"><a class="back-link" href="/${kind}">Back to BL ${kind}</a><section class="media-detail-hero">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(media.displayTitle)} cover" width="300" height="440">` : ''}<div><div class="eyebrow">ANILIST · ${kind.toUpperCase()} · BL TAG RANK ${media.boysLoveRank ?? '—'}${media.isAdult ? ' · MATURE CONTENT' : ''}</div><h1>${escapeHtml(boundedHeading(media.displayTitle))}</h1><p>${escapeHtml(media.description ?? `Discover this AniList-tagged ${kind} title using its source details and available link destinations.`)}</p><a href="${escapeHtml(media.sourceUrl)}" target="_blank" rel="noopener noreferrer">View source details</a></div></section><section><h2>${kind === 'anime' ? 'Available episode links' : 'Chapter destinations'}</h2>${links ? `<ul>${links}</ul>` : `<p>Select an episode or chapter in the page controls and follow an official ${kind === 'anime' ? 'streaming' : 'reading'} destination.</p>`}${platforms ? `<h2>Source-listed ${kind === 'anime' ? 'streaming' : 'reading'} services</h2><ul>${platforms}</ul>` : ''}</section></main></div>`;
  }

  if (mediaSourceUnavailable && /^\/(?:anime|manga)\/\d+\/?$/.test(path)) {
    const kind = path.startsWith('/anime/') ? 'anime' : 'manga';
    return `<div class="app-shell"><main class="detail-missing page-content"><a href="/${kind}">Back to BL ${kind}</a><h1>Title details temporarily unavailable.</h1><p>The live AniList lookup did not respond, so this title could not be verified. Please retry shortly.</p></main></div>`;
  }

  return '<div class="app-shell"><main class="detail-missing page-content"><h1>This page is not on the signal.</h1><p>The requested BL Pulse page could not be found.</p><a href="/">Return to BL Pulse</a></main></div>';
}

function metaTag(attribute: 'name' | 'property', key: string, value: string): string {
  return `<meta ${attribute}="${escapeHtml(key)}" content="${escapeHtml(value)}">`;
}

function buildJsonLd(metadata: SeoMetadata, origin: string | null, series?: Series, media?: MediaTitle): string {
  const url = origin ? new URL(metadata.canonicalPath, `${origin}/`).toString() : undefined;
  const image = safeHttpsUrl(metadata.image) ?? (origin ? new URL(HERO_IMAGE_PATH, `${origin}/`).toString() : undefined);

  if (series) {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'TVSeries',
      name: series.title,
      description: metadata.description,
      ...(url ? { url } : {}),
      ...(image ? { image } : {}),
      countryOfOrigin: { '@type': 'Country', name: series.country },
      ...(series.episodes ? { numberOfEpisodes: series.episodes } : {}),
      genre: series.genres,
    });
  }

  if (media) {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': media.type === 'ANIME' ? 'TVSeries' : 'ComicSeries',
      name: media.displayTitle,
      description: metadata.description,
      ...(url ? { url } : {}),
      ...(image ? { image } : {}),
      genre: ["Boys' Love", ...media.genres],
    });
  }

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'BL Pulse',
    alternateName: 'BL Pulse — Boys’ Love Series, Anime & Manga Guide',
    description: metadata.description,
    applicationCategory: 'EntertainmentApplication',
    operatingSystem: 'All',
    ...(url ? { url } : {}),
    ...(image ? { image } : {}),
  });
}

function replaceHead(template: string, metadata: SeoMetadata, origin: string | null, series?: Series, media?: MediaTitle): string {
  const cleaned = template.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\b[^>]*(?:name|property)\s*=\s*(["'])(?:description|keywords|robots|og:[^"']+|twitter:[^"']+|bl-pulse-public-origin)\1[^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*rel\s*=\s*(["'])canonical\1[^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>[\s\S]*?<\/script>\s*/gi, '');
  const canonical = origin && !metadata.noindex ? new URL(metadata.canonicalPath, `${origin}/`).toString() : '';
  const image = safeHttpsUrl(metadata.image) ?? (origin ? new URL(HERO_IMAGE_PATH, `${origin}/`).toString() : null);
  const jsonLd = buildJsonLd(metadata, origin, series, media);
  const tags = [
    `<title>${escapeHtml(metadata.title)}</title>`,
    metaTag('name', 'description', metadata.description),
    metaTag('name', 'keywords', metadata.keywords.slice(0, 8).join(', ')),
    metaTag('name', 'robots', metadata.noindex ? 'noindex,follow' : 'index,follow'),
    metaTag('property', 'og:type', series || media ? 'video.tv_show' : 'website'),
    metaTag('property', 'og:title', metadata.title),
    metaTag('property', 'og:description', metadata.description),
    metaTag('property', 'og:site_name', 'BL Pulse'),
    metaTag('name', 'twitter:card', 'summary_large_image'),
    metaTag('name', 'twitter:title', metadata.title),
    metaTag('name', 'twitter:description', metadata.description),
    ...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}">`, metaTag('property', 'og:url', canonical)] : []),
    ...(image ? [metaTag('property', 'og:image', image), metaTag('name', 'twitter:image', image)] : []),
    ...(origin ? [metaTag('name', 'bl-pulse-public-origin', origin)] : []),
    `<script id="bl-pulse-jsonld" type="application/ld+json">${jsonLd}</script>`,
  ].join('\n    ');
  return cleaned.replace(/<head\b[^>]*>/i, (head) => `${head}\n    ${tags}`);
}

export function renderSeoDocument(
  template: string,
  pathname: string,
  catalog: CatalogResponse,
  series?: Series,
  mediaPage?: MediaPageResponse,
  media?: MediaTitle,
  homeAnimePage?: MediaPageResponse,
  homeMangaPage?: MediaPageResponse,
  mediaSourceUnavailable = false,
): SeoDocument {
  const unavailableDetail = mediaSourceUnavailable && /^\/(?:anime|manga)\/\d+\/?$/.test(pathname);
  const unavailableListing = mediaSourceUnavailable && /^\/(?:anime|manga)\/?$/.test(pathname);
  const unavailableMediaPage = unavailableDetail || unavailableListing;
  const route = unavailableDetail ? {
    status: 503,
    metadata: {
      title: 'Title Details Temporarily Unavailable | BL Pulse',
      description: 'The live AniList title lookup did not respond. Please retry shortly to view verified Boys’ Love anime or manga details.',
      keywords: ['BL anime', 'BL manga', 'AniList', 'title details'],
      canonicalPath: pathname,
      noindex: true,
    },
  } : unavailableListing ? {
    status: 503,
    metadata: {
      title: pathname.startsWith('/anime') ? 'BL Anime Temporarily Unavailable | BL Pulse' : 'BL Manga Temporarily Unavailable | BL Pulse',
      description: 'AniList did not return the live title collection. Please retry shortly to browse current Boys’ Love anime or manga.',
      keywords: ['BL anime', 'BL manga', 'AniList', 'title collection'],
      canonicalPath: pathname,
      noindex: true,
    },
  } : metadataForPath(pathname, series, media);
  const html = replaceHead(template, route.metadata, configuredPublicOrigin(), series, media)
    .replace('<div id="root"></div>', `<div id="root">${prerenderBody(pathname, catalog, series, mediaPage, media, homeAnimePage, homeMangaPage, unavailableMediaPage)}</div>`);
  return { status: route.status, metadata: route.metadata, html };
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

export function renderSitemap(origin: string, catalog: CatalogResponse): string {
  const paths = ['/', '/discover', '/anime', '/manga', ...catalog.series.map((series) => `/series/${encodeURIComponent(series.id)}`)];
  const lastUpdate = catalog.lastRefreshed ? new Date(catalog.lastRefreshed) : null;
  const lastmod = lastUpdate && !Number.isNaN(lastUpdate.getTime()) ? lastUpdate.toISOString() : null;
  const unique = [...new Set(paths)];
  const entries = unique.map((path) => `<url><loc>${xmlEscape(new URL(path, `${origin}/`).toString())}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
}

export function renderRobots(origin: string | null): string {
  if (!origin) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`;
}
