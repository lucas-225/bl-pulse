import 'dotenv/config';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  ALL_ANI_LIST_TAG_RANKS,
  DEFAULT_MINIMUM_BL_TAG_RANK,
  type AniListMediaType,
  type AniListSort,
  type AniListTagRankFilter,
  type MediaPageResponse,
  type MediaTitle,
} from '../shared/media.js';
import type { MonetizationConfig, Series } from '../shared/types.js';
import { browseAniList, getAniListMedia } from './anilist.js';
import {
  autoFillSeriesMetadata,
  getCatalogSnapshot,
  getMonetizationConfig,
  getSeriesById,
  hydrateCatalog,
  refreshCatalog,
  removeSeries,
  runMarketAutoSync,
  updateMonetizationConfig,
  upsertSeries,
} from './catalog.js';
import { initDatabase, isDatabaseReady } from './db.js';
import {
  applyAffiliateParams,
  getAnalyticsSummary,
  hydrateAnalytics,
  recordRedirectClick,
  resolvePlatformRedirect,
} from './redirect.js';
import { configuredPublicOrigin, renderRobots, renderSeoDocument, renderSitemap } from './seo.js';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD?.trim() || 'blpulse2026';
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const provided =
    (req.headers['x-admin-password'] as string | undefined)?.trim() ||
    (typeof req.body?.password === 'string' ? req.body.password.trim() : '');
  if (!provided || provided !== getAdminPassword()) {
    res.status(401).json({ message: 'Invalid admin password. Please enter your owner password.' });
    return;
  }
  next();
}

function parseMinimumRank(value: unknown): AniListTagRankFilter {
  const numeric = Number(value);
  return numeric === ALL_ANI_LIST_TAG_RANKS ? ALL_ANI_LIST_TAG_RANKS : DEFAULT_MINIMUM_BL_TAG_RANK;
}

function isAniListMediaType(value: string): value is AniListMediaType {
  return value === 'ANIME' || value === 'MANGA';
}

function isAniListSort(value: string): value is AniListSort {
  return (
    value === 'POPULARITY_DESC' ||
    value === 'SCORE_DESC' ||
    value === 'START_DATE_DESC' ||
    value === 'START_DATE'
  );
}

async function resolveSeoData(pathname: string): Promise<{
  series?: Series;
  mediaPage?: MediaPageResponse;
  media?: MediaTitle;
  homeAnimePage?: MediaPageResponse;
  homeMangaPage?: MediaPageResponse;
  mediaSourceUnavailable?: boolean;
}> {
  const pathClean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  if (pathClean === '/') {
    const [homeAnimePage, homeMangaPage] = await Promise.all([
      browseAniList({ type: 'ANIME', page: 1, sort: 'POPULARITY_DESC', minimumRank: DEFAULT_MINIMUM_BL_TAG_RANK }).catch(() => undefined),
      browseAniList({ type: 'MANGA', page: 1, sort: 'POPULARITY_DESC', minimumRank: DEFAULT_MINIMUM_BL_TAG_RANK }).catch(() => undefined),
    ]);
    return { homeAnimePage, homeMangaPage };
  }

  const seriesId = pathClean.match(/^\/series\/([^/]+)$/)?.[1];
  if (seriesId) {
    const decoded = decodeURIComponent(seriesId);
    const series =
      getCatalogSnapshot().series.find((item) => item.id === decoded) ??
      (await getSeriesById(decoded).catch(() => undefined));
    return { series };
  }

  if (pathClean === '/anime' || pathClean === '/manga' || pathClean === '/comic') {
    const type: AniListMediaType = pathClean === '/anime' ? 'ANIME' : 'MANGA';
    try {
      const mediaPage = await browseAniList({ type, page: 1, sort: 'POPULARITY_DESC', minimumRank: DEFAULT_MINIMUM_BL_TAG_RANK });
      return { mediaPage };
    } catch {
      return { mediaSourceUnavailable: true };
    }
  }

  const mediaMatch = pathClean.match(/^\/(anime|manga|comic)\/(\d+)$/);
  if (mediaMatch) {
    const type: AniListMediaType = mediaMatch[1] === 'anime' ? 'ANIME' : 'MANGA';
    try {
      const media = (await getAniListMedia(type, Number(mediaMatch[2]), false, DEFAULT_MINIMUM_BL_TAG_RANK)) ?? undefined;
      return { media };
    } catch {
      return { mediaSourceUnavailable: true };
    }
  }

  return {};
}

async function start() {
  const app = express();
  const server = http.createServer(app);
  app.use(express.json({ limit: '2mb' }));

  // In production (Cloud Run / Koyeb), bind 0.0.0.0:${PORT} immediately so container health checks succeed with zero delay
  let serverListening = false;
  if (isProduction) {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`BL Pulse production server listening on http://0.0.0.0:${PORT}`);
    });
    serverListening = true;
  }

  // Hydrate database, catalog, and analytics
  void (async () => {
    await initDatabase();
    await Promise.all([hydrateCatalog(), hydrateAnalytics()]);
  })();

  app.get('/api/health', (_req, res) => {
    const snapshot = getCatalogSnapshot();
    res.json({
      ok: true,
      databaseReady: isDatabaseReady(),
      anilistConfigured: true,
      seriesCount: snapshot.series.length,
      lastRefreshed: snapshot.lastRefreshed,
      sourceOnline: snapshot.sourceOnline,
    });
  });

  // One-click downloadable JSON backup of the entire Live-Action catalog, platforms, episodes & monetization config
  app.get('/api/export', (_req, res) => {
    const snapshot = getCatalogSnapshot();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="blpulse-catalog.json"');
    res.send(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          version: '2.0.0',
          totalSeries: snapshot.series.length,
          lastRefreshed: snapshot.lastRefreshed,
          editorial: snapshot.editorial,
          monetization: getMonetizationConfig(),
          series: snapshot.series,
        },
        null,
        2,
      ),
    );
  });

  app.get('/api/catalog', (_req, res) => {
    res.json(getCatalogSnapshot());
  });

  app.post('/api/refresh', async (_req, res) => {
    try {
      await refreshCatalog();
      res.json(getCatalogSnapshot());
    } catch (error) {
      res.status(503).json({
        message: error instanceof Error ? error.message : 'Unable to refresh the catalog.',
        catalog: getCatalogSnapshot(),
      });
    }
  });

  app.get('/api/series/:id', async (req, res) => {
    try {
      const series = await getSeriesById(req.params.id);
      if (!series) {
        res.status(404).json({ message: 'Series not found in the live catalog.' });
        return;
      }
      res.json(series);
    } catch {
      res.status(503).json({ message: 'Series details could not be loaded right now.' });
    }
  });

  // Legal 302 Redirect Engine with Affiliate Link Injection & Click Analytics
  app.get('/api/redirect', async (req, res) => {
    const platform = typeof req.query.platform === 'string' ? req.query.platform : 'YouTube';
    const title = typeof req.query.title === 'string' ? req.query.title : '';
    const episode = Math.max(1, Number(req.query.episode || 1));
    const season = req.query.season ? Math.max(1, Number(req.query.season)) : 1;
    const seasonTitle = typeof req.query.seasonTitle === 'string' ? req.query.seasonTitle : undefined;
    const kind =
      req.query.kind === 'anime' || req.query.kind === 'manga' ? req.query.kind : 'series';
    const baseUrl = typeof req.query.baseUrl === 'string' ? req.query.baseUrl : undefined;
    const directUrl = typeof req.query.directUrl === 'string' ? req.query.directUrl : undefined;

    if (!title.trim()) {
      res.redirect(302, baseUrl || 'https://www.youtube.com');
      return;
    }

    try {
      const rawTargetUrl = await resolvePlatformRedirect({
        platform,
        title,
        episode,
        season,
        seasonTitle,
        kind,
        baseUrl,
        directUrl,
      });

      const monetization = getMonetizationConfig();
      const { url: finalUrl, affiliateApplied } = applyAffiliateParams(
        rawTargetUrl,
        platform,
        monetization.affiliates,
      );

      recordRedirectClick({
        title,
        platform,
        kind,
        episode,
        season,
        targetUrl: finalUrl,
        affiliateApplied,
        timestamp: new Date().toISOString(),
      });

      res.redirect(302, finalUrl);
    } catch {
      res.redirect(
        302,
        baseUrl || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} Episode ${episode}`)}`,
      );
    }
  });

  app.get('/api/media', async (req, res) => {
    const rawType = typeof req.query.type === 'string' ? req.query.type.toUpperCase() : 'ANIME';
    const rawSort = typeof req.query.sort === 'string' ? req.query.sort.toUpperCase() : 'POPULARITY_DESC';
    const type: AniListMediaType = isAniListMediaType(rawType) ? rawType : 'ANIME';
    const sort: AniListSort = isAniListSort(rawSort) ? rawSort : 'POPULARITY_DESC';
    const page = Number(req.query.page || 1);
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const includeAdult = req.query.includeAdult === 'true' || req.query.includeAdult === '1';
    const minimumRank = parseMinimumRank(req.query.minRank);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const format = typeof req.query.format === 'string' ? req.query.format : undefined;
    const countryOfOrigin = typeof req.query.country === 'string' ? req.query.country : undefined;

    try {
      res.json(
        await browseAniList({
          type,
          page,
          sort,
          search,
          includeAdult,
          minimumRank,
          status,
          format,
          countryOfOrigin,
        }),
      );
    } catch (error) {
      res.status(503).json({
        message: error instanceof Error ? error.message : 'Unable to load titles from AniList.',
      });
    }
  });

  app.get('/api/media/:type/:id', async (req, res) => {
    const rawType = req.params.type.toUpperCase();
    if (!isAniListMediaType(rawType)) {
      res.status(400).json({ message: 'Media type must be anime or manga.' });
      return;
    }

    const includeAdult = req.query.includeAdult === 'true' || req.query.includeAdult === '1';
    const minimumRank = parseMinimumRank(req.query.minRank);

    try {
      const item = await getAniListMedia(rawType, Number(req.params.id), includeAdult, minimumRank);
      if (!item) {
        res.status(404).json({ message: 'Title not found in the AniList Boys’ Love catalog.' });
        return;
      }
      res.json(item);
    } catch (error) {
      res.status(503).json({
        message: error instanceof Error ? error.message : 'Unable to load title details from AniList.',
      });
    }
  });

  // ============================================================================
  // PASSWORD-PROTECTED ADMIN & MONETIZATION ENDPOINTS (/api/admin/*)
  // ============================================================================

  app.post('/api/admin/verify', requireAdminAuth, (_req, res) => {
    const snapshot = getCatalogSnapshot();
    res.json({
      ok: true,
      databaseReady: isDatabaseReady(),
      seriesCount: snapshot.series.length,
      lastRefreshed: snapshot.lastRefreshed,
      monetization: getMonetizationConfig(),
      analytics: getAnalyticsSummary(),
    });
  });

  app.get('/api/admin/analytics', requireAdminAuth, (_req, res) => {
    res.json({
      databaseReady: isDatabaseReady(),
      analytics: getAnalyticsSummary(),
      monetization: getMonetizationConfig(),
    });
  });

  app.post('/api/admin/sync-market', requireAdminAuth, async (_req, res) => {
    try {
      const result = await runMarketAutoSync();
      res.json({
        ...result,
        catalog: getCatalogSnapshot(),
      });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : 'Market Auto-Sync encountered an error.',
      });
    }
  });

  app.post('/api/admin/autofill', requireAdminAuth, async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) {
      res.status(400).json({ message: 'Please provide a series title.' });
      return;
    }
    try {
      const metadata = await autoFillSeriesMetadata(title);
      res.json({ metadata });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : 'Could not auto-fill metadata for this title.',
      });
    }
  });

  app.post('/api/admin/series', requireAdminAuth, async (req, res) => {
    const payload = req.body as Partial<Series> & { title?: string };
    if (!payload?.title?.trim()) {
      res.status(400).json({ message: 'Series title is required.' });
      return;
    }
    try {
      const saved = await upsertSeries({ ...payload, title: payload.title.trim() });
      res.json({
        series: saved,
        catalog: getCatalogSnapshot(),
      });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : 'Failed to save series.',
      });
    }
  });

  app.delete('/api/admin/series/:id', requireAdminAuth, async (req, res) => {
    try {
      const removed = await removeSeries(req.params.id);
      if (!removed) {
        res.status(404).json({ message: 'Series not found.' });
        return;
      }
      res.json({
        deletedId: req.params.id,
        catalog: getCatalogSnapshot(),
      });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : 'Failed to delete series.',
      });
    }
  });

  app.put('/api/admin/monetization', requireAdminAuth, async (req, res) => {
    try {
      const patch = req.body as Partial<MonetizationConfig>;
      const updated = await updateMonetizationConfig(patch);
      res.json({
        monetization: updated,
        catalog: getCatalogSnapshot(),
      });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : 'Failed to update monetization settings.',
      });
    }
  });

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain; charset=utf-8').send(renderRobots(configuredPublicOrigin()));
  });

  app.get('/sitemap.xml', (_req, res) => {
    const origin = configuredPublicOrigin();
    if (!origin) {
      res.status(404).type('text/plain; charset=utf-8').send('Public origin is not configured.');
      return;
    }
    res.type('application/xml; charset=utf-8').send(renderSitemap(origin, getCatalogSnapshot()));
  });

  if (isProduction) {
    const clientDir = path.resolve(process.cwd(), 'dist/client');
    const indexPath = path.join(clientDir, 'index.html');
    const template = await fs.readFile(indexPath, 'utf8');
    app.use(express.static(clientDir, { index: false }));
    app.get('*', async (req, res) => {
      const seoData = await resolveSeoData(req.path);
      const doc = renderSeoDocument(
        template,
        req.path,
        getCatalogSnapshot(),
        seoData.series,
        seoData.mediaPage,
        seoData.media,
        seoData.homeAnimePage,
        seoData.homeMangaPage,
        seoData.mediaSourceUnavailable,
      );
      res.status(doc.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(doc.html);
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR === 'true' ? false : { server } },
      appType: 'custom',
    });
    const indexPath = path.resolve(process.cwd(), 'index.html');
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      try {
        const rawTemplate = await fs.readFile(indexPath, 'utf8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawTemplate);
        const seoData = await resolveSeoData(req.path);
        const doc = renderSeoDocument(
          transformed,
          req.path,
          getCatalogSnapshot(),
          seoData.series,
          seoData.mediaPage,
          seoData.media,
          seoData.homeAnimePage,
          seoData.homeMangaPage,
          seoData.mediaSourceUnavailable,
        );
        res.status(doc.status).setHeader('Content-Type', 'text/html; charset=utf-8').send(doc.html);
      } catch (error) {
        next(error);
      }
    });
  }

  if (!serverListening) {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`BL Pulse running on http://0.0.0.0:${PORT}`);
    });
  }
}

void start();
