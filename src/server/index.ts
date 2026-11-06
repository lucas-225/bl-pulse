import express from 'express';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initDatabase, isDatabaseReady } from './db.js';
import { getCatalogSnapshot, getSeriesById, hydrateCatalog, refreshCatalog } from './catalog.js';
import { AniListRateLimitError, browseAniList, getAniListMedia } from './anilist.js';
import { ALL_ANI_LIST_TAG_RANKS, DEFAULT_MINIMUM_BL_TAG_RANK, type AniListMediaType, type AniListSort } from '../shared/media.js';
import { configuredPublicOrigin, renderRobots, renderSeoDocument, renderSitemap } from './seo.js';
import { resolvePlatformRedirect } from './redirect.js';

const app = express();
const server = createServer(app);
const PORT = Number(process.env.PORT ?? 3000);
let transformIndexHtml: ((url: string, html: string) => Promise<string>) | null = null;
let installViteMiddleware: () => void = () => undefined;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const API_WINDOW_MS = 60_000;
const API_CLIENT_LIMIT = 15;
const apiClientWindows = new Map<string, { resetAt: number; count: number }>();

app.use('/api/media', (request, response, next) => {
  const now = Date.now();
  const clientKey = `${request.ip || request.socket.remoteAddress || 'unknown'}|${request.get('user-agent')?.slice(0, 120) ?? ''}`;
  let window = apiClientWindows.get(clientKey);
  if (!window || window.resetAt <= now) {
    window = { resetAt: now + API_WINDOW_MS, count: 0 };
    apiClientWindows.set(clientKey, window);
  }
  if (window.count >= API_CLIENT_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    response.setHeader('Retry-After', String(retryAfterSeconds));
    response.setHeader('Cache-Control', 'no-store');
    response.status(429).json({ message: `Too many AniList requests. Retry in ${retryAfterSeconds} seconds.`, retryAfterSeconds });
    return;
  }
  window.count += 1;
  if (apiClientWindows.size > 1_000) {
    for (const [key, value] of apiClientWindows) if (value.resetAt <= now) apiClientWindows.delete(key);
  }
  next();
});

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', database: isDatabaseReady() });
});

app.get('/api/catalog', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json(getCatalogSnapshot());
});

app.post('/api/catalog/refresh', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  try {
    await refreshCatalog();
    response.json(getCatalogSnapshot());
  } catch (error) {
    response.status(503).json({
      ...getCatalogSnapshot(),
      message: error instanceof Error ? error.message : 'Live-action discovery is waiting for a licensed data connection.',
    });
  }
});

app.get('/api/series/:id', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const record = await getSeriesById(String(request.params.id));
  if (!record) {
    response.status(404).json({ message: 'Series not found in the current source catalog.' });
    return;
  }
  response.json(record);
});

app.get('/api/redirect', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const platform = typeof request.query.platform === 'string' ? request.query.platform.trim() : '';
  const title = typeof request.query.title === 'string' ? request.query.title.trim() : '';
  const episode = Number(request.query.episode) || 1;
  const season = Number(request.query.season) || 1;
  const seasonTitle = typeof request.query.seasonTitle === 'string' ? request.query.seasonTitle.trim() : undefined;
  const kindRaw = typeof request.query.kind === 'string' ? request.query.kind.trim() : 'series';
  const kind = kindRaw === 'anime' || kindRaw === 'manga' ? kindRaw : 'series';
  const baseUrl = typeof request.query.baseUrl === 'string' ? request.query.baseUrl.trim() : undefined;
  const directUrl = typeof request.query.directUrl === 'string' ? request.query.directUrl.trim() : undefined;

  if (!platform || !title) {
    response.redirect(302, '/');
    return;
  }

  try {
    const targetUrl = await resolvePlatformRedirect({
      platform,
      title,
      episode,
      season,
      seasonTitle,
      kind,
      baseUrl,
      directUrl,
    });
    response.redirect(302, targetUrl);
  } catch {
    response.redirect(
      302,
      `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} Episode ${episode} Eng Sub`)}`,
    );
  }
});

app.post('/api/media/search', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const type = request.body?.type;
  const sort = request.body?.sort;
  const page = Number(request.body?.page);
  const includeAdult = request.body?.includeAdult;
  const minimumRank = request.body?.minimumRank;
  const status = typeof request.body?.status === 'string' ? request.body.status : undefined;
  const format = typeof request.body?.format === 'string' ? request.body.format : undefined;
  const countryOfOrigin = typeof request.body?.countryOfOrigin === 'string' ? request.body.countryOfOrigin : undefined;
  if ((type !== 'ANIME' && type !== 'MANGA')
    || !['POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'START_DATE'].includes(sort)
    || !Number.isFinite(page)
    || (includeAdult !== undefined && typeof includeAdult !== 'boolean')
    || (minimumRank !== undefined && minimumRank !== ALL_ANI_LIST_TAG_RANKS && minimumRank !== DEFAULT_MINIMUM_BL_TAG_RANK && minimumRank !== 0 && minimumRank !== 70)
    || (request.body?.search !== undefined && typeof request.body.search !== 'string')) {
    response.status(400).json({ message: 'Choose Anime or Manga, a valid sort order, and a page number.' });
    return;
  }
  try {
    response.json(await browseAniList({
      type: type as AniListMediaType,
      page,
      sort: sort as AniListSort,
      search: request.body.search,
      includeAdult: Boolean(includeAdult),
      minimumRank: (minimumRank === ALL_ANI_LIST_TAG_RANKS || minimumRank === 0) ? ALL_ANI_LIST_TAG_RANKS : DEFAULT_MINIMUM_BL_TAG_RANK,
      status,
      format,
      countryOfOrigin,
    }));
  } catch (error) {
    if (error instanceof AniListRateLimitError) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
      response.status(429).json({ message: error.message, retryAfterSeconds: error.retryAfterSeconds });
      return;
    }
    response.status(502).json({ message: 'AniList could not be reached. Please try again shortly.' });
  }
});

app.get('/api/media/:type/:id', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const type = String(request.params.type).toLowerCase() === 'anime' ? 'ANIME'
    : String(request.params.type).toLowerCase() === 'manga' ? 'MANGA' : null;
  const id = Number(request.params.id);
  if (!type || !Number.isSafeInteger(id) || id <= 0) {
    response.status(400).json({ message: 'Choose a valid anime or manga title.' });
    return;
  }
  try {
    const item = await getAniListMedia(type, id, request.query.mature === '1', request.query.tagRank === 'all' ? ALL_ANI_LIST_TAG_RANKS : DEFAULT_MINIMUM_BL_TAG_RANK);
    if (!item) {
      response.status(404).json({ message: 'This title is not available in the current Boys’ Love catalog.' });
      return;
    }
    response.json(item);
  } catch (error) {
    if (error instanceof AniListRateLimitError) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
      response.status(429).json({ message: error.message, retryAfterSeconds: error.retryAfterSeconds });
      return;
    }
    response.status(502).json({ message: 'AniList could not be reached. Please try again shortly.' });
  }
});

app.get('/robots.txt', (_request, response) => {
  response.setHeader('Cache-Control', 'public, max-age=300');
  response.type('text/plain').send(renderRobots(configuredPublicOrigin()));
});

app.get('/sitemap.xml', (_request, response) => {
  const origin = configuredPublicOrigin();
  if (!origin) {
    response.setHeader('X-Robots-Tag', 'noindex');
    response.setHeader('Cache-Control', 'no-store');
    response.status(503).type('text/plain').send('Sitemap is unavailable until the public site origin is explicitly configured.');
    return;
  }
  response.setHeader('Cache-Control', 'public, max-age=300');
  response.type('application/xml').send(renderSitemap(origin, getCatalogSnapshot()));
});

async function start(): Promise<void> {
  void initDatabase()
    .then(() => hydrateCatalog())
    .catch((err) => {
      console.error('Background catalog hydration warning:', err);
    });

  const clientRoot = resolve(process.cwd(), 'dist/client');
  const sourceHtml = resolve(process.cwd(), 'index.html');

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(clientRoot, { maxAge: '1h', index: false }));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    transformIndexHtml = (url, html) => vite.transformIndexHtml(url, html);
    installViteMiddleware = () => { app.use(vite.middlewares); };
  }

  app.use(async (request, response, next) => {
    const pathname = request.path;
    if (request.method !== 'GET'
      || pathname.startsWith('/api/')
      || pathname.startsWith('/manus-storage/')
      || pathname.startsWith('/@')
      || pathname === '/manus-routes.json'
      || /\.[a-z\d]{1,8}$/i.test(pathname)) {
      next();
      return;
    }

    try {
      const catalog = getCatalogSnapshot();
      const detailMatch = pathname.match(/^\/series\/([^/]+)\/?$/);
      let series;
      if (detailMatch) {
        let id: string;
        try {
          id = decodeURIComponent(detailMatch[1]);
        } catch {
          id = '';
        }
        if (id) series = await getSeriesById(id) ?? undefined;
      }

      const mediaListingMatch = pathname.match(/^\/(anime|manga)\/?$/);
      const mediaDetailMatch = pathname.match(/^\/(anime|manga)\/(\d+)\/?$/);
      let mediaPage;
      let mediaItem;
      let mediaSourceUnavailable = false;
      let homeAnimePage;
      let homeMangaPage;
      if (mediaListingMatch) {
        const type = mediaListingMatch[1] === 'anime' ? 'ANIME' : 'MANGA';
        try { mediaPage = await browseAniList({ type, page: 1, sort: 'POPULARITY_DESC' }); } catch { mediaSourceUnavailable = true; }
      } else if (mediaDetailMatch) {
        const type = mediaDetailMatch[1] === 'anime' ? 'ANIME' : 'MANGA';
        try { mediaItem = await getAniListMedia(type, Number(mediaDetailMatch[2]), request.query.mature === '1', request.query.tagRank === 'all' ? ALL_ANI_LIST_TAG_RANKS : DEFAULT_MINIMUM_BL_TAG_RANK) ?? undefined; } catch { mediaSourceUnavailable = true; }
      } else if (pathname === '/') {
        [homeAnimePage, homeMangaPage] = await Promise.all([
          browseAniList({ type: 'ANIME', page: 1, sort: 'POPULARITY_DESC', minimumRank: DEFAULT_MINIMUM_BL_TAG_RANK }).catch(() => undefined),
          browseAniList({ type: 'MANGA', page: 1, sort: 'POPULARITY_DESC', minimumRank: DEFAULT_MINIMUM_BL_TAG_RANK }).catch(() => undefined),
        ]);
      }

      let template = await readFile(process.env.NODE_ENV === 'production' ? resolve(clientRoot, 'index.html') : sourceHtml, 'utf8');
      if (transformIndexHtml) template = await transformIndexHtml(request.originalUrl, template);
      const page = renderSeoDocument(template, pathname, catalog, series, mediaPage, mediaItem, homeAnimePage, homeMangaPage, mediaSourceUnavailable);
      response.status(page.status);
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', page.status === 200 ? 'public, max-age=0' : 'no-store');
      if (page.status === 503) response.setHeader('Retry-After', '60');
      if (page.metadata.noindex) response.setHeader('X-Robots-Tag', 'noindex, follow');
      response.send(page.html);
    } catch (error) {
      next(error);
    }
  });

  installViteMiddleware();

  server.listen(PORT, '0.0.0.0', () => {
    console.info(`BL Pulse listening on port ${PORT}.`);
  });

}

void start().catch((error) => {
  console.error('BL Pulse could not start.', error instanceof Error ? error.message : 'Unknown startup error.');
  process.exitCode = 1;
});
