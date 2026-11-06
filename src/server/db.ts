import mysql from 'mysql2/promise';
import type { EditorialPost, Series } from '../shared/types.js';

let pool: mysql.Pool | null = null;
let dbInitialized = false;
const memoryMeta = new Map<string, string>();

export function normalizeDatabaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    // Route '/sys', '/test', or empty path to the production '/blpulse' database schema
    if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '/sys' || parsed.pathname === '/test') {
      parsed.pathname = '/blpulse';
    }
    parsed.searchParams.delete('ssl-mode');
    parsed.searchParams.delete('sslaccept');
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/(sys|test)(\?|$)/, '/blpulse$2');
  }
}

export function getDbPool(): mysql.Pool | null {
  if (pool) return pool;
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl || rawUrl.includes('<PASSWORD>')) return null;

  const url = normalizeDatabaseUrl(rawUrl);
  const needsTls =
    url.includes('tidbcloud.com') ||
    rawUrl.includes('ssl') ||
    process.env.DB_SSL === 'true';

  try {
    pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
      ...(needsTls
        ? {
            ssl: {
              minVersion: 'TLSv1.2',
              rejectUnauthorized: true,
            },
          }
        : {}),
    });
    return pool;
  } catch {
    return null;
  }
}

export async function initDatabase(): Promise<boolean> {
  const db = getDbPool();
  if (!db) return false;
  if (dbInitialized) return true;

  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS bl_series (
        id VARCHAR(191) PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        country VARCHAR(120) NOT NULL,
        status VARCHAR(32) NOT NULL,
        platforms_json JSON NOT NULL,
        genres_json JSON NOT NULL,
        seasons_json JSON NULL,
        year INT NULL,
        release_date VARCHAR(64) NULL,
        episodes INT NULL,
        synopsis TEXT NULL,
        cover_url TEXT NULL,
        source_url TEXT NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        INDEX idx_status (status),
        INDEX idx_country (country),
        INDEX idx_sort (sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS bl_platforms (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        series_id VARCHAR(191) NOT NULL,
        platform_name VARCHAR(120) NOT NULL,
        platform_url TEXT NOT NULL,
        UNIQUE KEY uniq_series_platform (series_id, platform_name),
        INDEX idx_platform_series (series_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS bl_episodes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        series_id VARCHAR(191) NOT NULL,
        season_number INT NOT NULL DEFAULT 1,
        episode_number INT NOT NULL,
        platform_name VARCHAR(120) NOT NULL,
        redirect_url TEXT NOT NULL,
        UNIQUE KEY uniq_series_ep_platform (series_id, season_number, episode_number, platform_name),
        INDEX idx_episode_series (series_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS bl_app_meta (
        meta_key VARCHAR(120) PRIMARY KEY,
        meta_value LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    dbInitialized = true;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } catch {
      // Ignore close error
    }
    pool = null;
    dbInitialized = false;
  }
}

export function isDatabaseReady(): boolean {
  return dbInitialized && pool !== null;
}

export async function loadSeries(): Promise<Series[]> {
  const rows = await loadSeriesFromDb();
  return rows ?? [];
}

export async function loadSeriesFromDb(): Promise<Series[] | null> {
  const ready = await initDatabase();
  const db = getDbPool();
  if (!ready || !db) return null;

  try {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      'SELECT * FROM bl_series ORDER BY sort_order ASC, title ASC',
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];

    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      country: String(row.country),
      status: (row.status as Series['status']) || 'completed',
      platforms:
        typeof row.platforms_json === 'string'
          ? JSON.parse(row.platforms_json)
          : (row.platforms_json ?? []),
      genres:
        typeof row.genres_json === 'string'
          ? JSON.parse(row.genres_json)
          : (row.genres_json ?? []),
      seasons: row.seasons_json
        ? typeof row.seasons_json === 'string'
          ? JSON.parse(row.seasons_json)
          : row.seasons_json
        : undefined,
      year: row.year !== null && row.year !== undefined ? Number(row.year) : undefined,
      releaseDate: row.release_date ? String(row.release_date) : undefined,
      episodes: row.episodes !== null && row.episodes !== undefined ? Number(row.episodes) : undefined,
      synopsis: row.synopsis ? String(row.synopsis) : undefined,
      coverUrl: row.cover_url ? String(row.cover_url) : undefined,
      sourceUrl: String(row.source_url),
      updatedAt: String(row.updated_at),
    }));
  } catch {
    return null;
  }
}

export async function saveSeries(seriesList: Series[], _replaceAll = false): Promise<void> {
  await saveSeriesToDb(seriesList);
}

export async function saveSeriesToDb(seriesList: Series[]): Promise<void> {
  const ready = await initDatabase();
  const db = getDbPool();
  if (!ready || !db || seriesList.length === 0) return;

  try {
    const sql = `
      INSERT INTO bl_series (
        id, title, country, status, platforms_json, genres_json, seasons_json,
        year, release_date, episodes, synopsis, cover_url, source_url, updated_at, sort_order
      ) VALUES ?
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        country = VALUES(country),
        status = VALUES(status),
        platforms_json = VALUES(platforms_json),
        genres_json = VALUES(genres_json),
        seasons_json = VALUES(seasons_json),
        year = VALUES(year),
        release_date = VALUES(release_date),
        episodes = VALUES(episodes),
        synopsis = VALUES(synopsis),
        cover_url = VALUES(cover_url),
        source_url = VALUES(source_url),
        updated_at = VALUES(updated_at),
        sort_order = VALUES(sort_order)
    `;

    const nowIso = new Date().toISOString();
    const values = seriesList.map((s, idx) => [
      s.id,
      s.title,
      s.country,
      s.status,
      JSON.stringify(s.platforms ?? []),
      JSON.stringify(s.genres ?? []),
      s.seasons ? JSON.stringify(s.seasons) : null,
      s.year ?? null,
      s.releaseDate ?? null,
      s.episodes ?? null,
      s.synopsis ?? null,
      s.coverUrl ?? null,
      s.sourceUrl,
      s.updatedAt ?? nowIso,
      idx,
    ]);

    const chunkSize = 50;
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      await db.query(sql, [chunk]);
    }

    // Also sync normalized bl_platforms and bl_episodes tables for SQL queryability
    const platformRows: Array<[string, string, string]> = [];
    const episodeRows: Array<[string, number, number, string, string]> = [];

    for (const s of seriesList) {
      for (const pf of s.platforms ?? []) {
        platformRows.push([s.id, pf.name, pf.url]);
      }
      if (s.platforms?.[0]) {
        const primaryPf = s.platforms[0];
        const epCount = Math.min(Math.max(s.episodes ?? 12, 1), 24);
        for (let epNum = 1; epNum <= epCount; epNum++) {
          const epUrl =
            epNum === 1
              ? primaryPf.url
              : `/api/redirect?platform=${encodeURIComponent(primaryPf.name)}&title=${encodeURIComponent(s.title)}&episode=${epNum}&kind=series&baseUrl=${encodeURIComponent(primaryPf.url)}`;
          episodeRows.push([s.id, 1, epNum, primaryPf.name, epUrl]);
        }
      }
    }

    if (platformRows.length > 0) {
      const pfSql = `
        INSERT INTO bl_platforms (series_id, platform_name, platform_url)
        VALUES ?
        ON DUPLICATE KEY UPDATE platform_url = VALUES(platform_url)
      `;
      for (let i = 0; i < platformRows.length; i += 100) {
        await db.query(pfSql, [platformRows.slice(i, i + 100)]);
      }
    }

    if (episodeRows.length > 0) {
      const epSql = `
        INSERT INTO bl_episodes (series_id, season_number, episode_number, platform_name, redirect_url)
        VALUES ?
        ON DUPLICATE KEY UPDATE redirect_url = VALUES(redirect_url)
      `;
      for (let i = 0; i < episodeRows.length; i += 200) {
        await db.query(epSql, [episodeRows.slice(i, i + 200)]);
      }
    }
  } catch {
    // Fallback to in-memory cache when DB is not reachable
  }
}

export async function deleteSeriesFromDb(seriesId: string): Promise<void> {
  const ready = await initDatabase();
  const db = getDbPool();
  if (!ready || !db) return;

  try {
    await db.execute('DELETE FROM bl_episodes WHERE series_id = ?', [seriesId]);
    await db.execute('DELETE FROM bl_platforms WHERE series_id = ?', [seriesId]);
    await db.execute('DELETE FROM bl_series WHERE id = ?', [seriesId]);
  } catch {
    // Ignore DB delete error when using in-memory cache
  }
}

export async function readMeta(key: string): Promise<string | null> {
  if (memoryMeta.has(key)) {
    return memoryMeta.get(key) ?? null;
  }
  const ready = await initDatabase();
  const db = getDbPool();
  if (!ready || !db) return null;

  try {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      'SELECT meta_value FROM bl_app_meta WHERE meta_key = ? LIMIT 1',
      [key],
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const val = String(rows[0].meta_value);
    memoryMeta.set(key, val);
    return val;
  } catch {
    return null;
  }
}

export async function writeMeta(key: string, value: string): Promise<void> {
  memoryMeta.set(key, value);
  const ready = await initDatabase();
  const db = getDbPool();
  if (!ready || !db) return;

  try {
    await db.execute(
      `INSERT INTO bl_app_meta (meta_key, meta_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [key, value],
    );
  } catch {
    // Ignore meta write errors
  }
}

export function parseEditorial(raw: string | null): EditorialPost | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EditorialPost;
    if (parsed && typeof parsed.title === 'string' && typeof parsed.body === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getAppMeta<T>(key: string): Promise<T | null> {
  const raw = await readMeta(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setAppMeta<T>(key: string, value: T): Promise<void> {
  await writeMeta(key, JSON.stringify(value));
}

export async function loadEditorialFromDb(): Promise<EditorialPost | null> {
  return getAppMeta<EditorialPost>('editorial_post');
}

export async function saveEditorialToDb(post: EditorialPost): Promise<void> {
  await setAppMeta('editorial_post', post);
}
