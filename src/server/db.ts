import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type { EditorialPost, Series, SeriesStatus, PlatformLink } from '../shared/types.js';

let pool: Pool | null = null;
let ready = false;

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function initDatabase(): Promise<void> {
  const dsn = process.env.DATABASE_URL?.trim();
  if (!dsn) {
    console.warn('DATABASE_URL is not configured; catalog will use its in-process cache.');
    return;
  }

  pool = createPool(dsn);
  try {
    await pool.query('SELECT 1');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bl_series (
        id VARCHAR(191) NOT NULL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        country VARCHAR(100) NOT NULL,
        status VARCHAR(24) NOT NULL,
        source_url TEXT NOT NULL,
        cover_url TEXT NULL,
        synopsis TEXT NULL,
        year_num INT NULL,
        release_date VARCHAR(120) NULL,
        genres_json JSON NOT NULL,
        platforms_json JSON NOT NULL,
        updated_at DATETIME NOT NULL,
        detail_fetched_at DATETIME NULL,
        INDEX bl_series_status_idx (status),
        INDEX bl_series_country_idx (country)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bl_app_meta (
        meta_key VARCHAR(80) NOT NULL PRIMARY KEY,
        value_text MEDIUMTEXT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    ready = true;
    console.info('Managed catalog database is ready.');
  } catch {
    ready = false;
    console.error('Managed catalog database is unavailable; keeping the live in-process catalog active.');
  }
}

export function isDatabaseReady(): boolean {
  return ready;
}

export async function loadSeries(): Promise<Series[]> {
  if (!pool || !ready) return [];
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM bl_series ORDER BY title');
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      country: String(row.country),
      status: String(row.status) as SeriesStatus,
      sourceUrl: String(row.source_url),
      coverUrl: row.cover_url ? String(row.cover_url) : undefined,
      synopsis: row.synopsis ? String(row.synopsis) : undefined,
      year: row.year_num == null ? undefined : Number(row.year_num),
      releaseDate: row.release_date ? String(row.release_date) : undefined,
      genres: parseJson<string[]>(row.genres_json, []),
      platforms: parseJson<PlatformLink[]>(row.platforms_json, []),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
      detailFetchedAt: row.detail_fetched_at ? new Date(row.detail_fetched_at).toISOString() : undefined,
    }));
  } catch {
    console.error('Unable to read the managed catalog; continuing with the in-process catalog.');
    return [];
  }
}

export async function saveSeries(series: Series[], replaceSnapshot = false): Promise<void> {
  if (!pool || !ready || series.length === 0) return;
  let connection: PoolConnection | undefined;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    let previousCount = 0;
    if (replaceSnapshot) {
      const [countRows] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM bl_series');
      previousCount = Number(countRows[0]?.total ?? 0);
    }
    const columns = [
      'id', 'title', 'country', 'status', 'source_url', 'cover_url', 'synopsis',
      'year_num', 'release_date', 'genres_json', 'platforms_json', 'updated_at', 'detail_fetched_at',
    ];
    const updateColumns = columns.slice(1).map((column) => `${column}=VALUES(${column})`).join(', ');
    const sql = `INSERT INTO bl_series (${columns.join(', ')}) VALUES ? ON DUPLICATE KEY UPDATE ${updateColumns}`;
    for (let offset = 0; offset < series.length; offset += 100) {
      const batch = series.slice(offset, offset + 100).map((item) => [
        item.id,
        item.title.slice(0, 255),
        item.country,
        item.status,
        item.sourceUrl,
        item.coverUrl ?? null,
        item.synopsis ?? null,
        item.year ?? null,
        item.releaseDate ?? null,
        JSON.stringify(item.genres ?? []),
        JSON.stringify(item.platforms ?? []),
        item.updatedAt,
        item.detailFetchedAt ?? null,
      ]);
      await connection.query(sql, [batch]);
    }
    const safeToPrune = replaceSnapshot && series.length >= 20
      && (previousCount === 0 || series.length >= Math.ceil(previousCount * 0.75));
    if (safeToPrune) {
      const placeholders = series.map(() => '?').join(', ');
      await connection.query(`DELETE FROM bl_series WHERE id NOT IN (${placeholders})`, series.map((item) => item.id));
    } else if (replaceSnapshot && previousCount > 0) {
      console.warn('Skipped stale-row pruning because the refreshed source snapshot was much smaller than the saved catalog.');
    }
    await connection.commit();
  } catch {
    if (connection) await connection.rollback().catch(() => undefined);
    console.error('Unable to save the catalog snapshot to the managed database.');
  } finally {
    connection?.release();
  }
}

export async function readMeta(key: string): Promise<string | null> {
  if (!pool || !ready) return null;
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT value_text FROM bl_app_meta WHERE meta_key = ?', [key]);
    return rows[0]?.value_text == null ? null : String(rows[0].value_text);
  } catch {
    return null;
  }
}

export async function writeMeta(key: string, value: string): Promise<void> {
  if (!pool || !ready) return;
  try {
    await pool.query(
      'INSERT INTO bl_app_meta (meta_key, value_text) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)',
      [key, value],
    );
  } catch {
    console.error('Unable to save catalog metadata to the managed database.');
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  ready = false;
}

export function parseEditorial(value: string | null): EditorialPost | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as EditorialPost;
  } catch {
    return null;
  }
}
