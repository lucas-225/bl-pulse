import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, Radio, RefreshCw, Search, Sparkles } from 'lucide-react';
import { DEFAULT_MINIMUM_BL_TAG_RANK, type MediaTitle } from '../shared/media';
import type { Series, SeriesStatus } from '../shared/types';
import { fetchMediaPage } from './api';

const MARK_URL = '/assets/aistudio/blpulse-mark_2739ad76.png';

export interface UnifiedRecommendation {
  key: string;
  title: string;
  category: 'Live Action' | 'Anime' | 'Manga';
  subtitle: string;
  coverUrl?: string | null;
  path: string;
}

export function resolvePlatformEpisodeUrl(
  platformName: string,
  basePlatformUrl: string | undefined,
  title: string,
  episodeOrChapterNum: number,
  kind: 'series' | 'anime' | 'manga',
  directEpisodeUrl?: string,
  seasonNumber?: number,
  seasonTitle?: string,
): string {
  if (directEpisodeUrl && !/themoviedb\.org|justwatch\.com/i.test(directEpisodeUrl)) {
    return directEpisodeUrl;
  }

  const cleanBaseUrl =
    basePlatformUrl &&
    /^https?:\/\//i.test(basePlatformUrl) &&
    !/themoviedb\.org|justwatch\.com|\/search\b|\/results\?|\/categories\//i.test(basePlatformUrl)
      ? basePlatformUrl
      : undefined;

  if (cleanBaseUrl && episodeOrChapterNum === 1 && (!seasonNumber || seasonNumber === 1)) {
    return cleanBaseUrl;
  }

  const params = new URLSearchParams();
  params.set('platform', platformName);
  params.set('title', title);
  params.set('episode', String(episodeOrChapterNum));
  params.set('kind', kind);
  if (seasonNumber && seasonNumber > 0) {
    params.set('season', String(seasonNumber));
  }
  if (seasonTitle) {
    params.set('seasonTitle', seasonTitle);
  }
  if (cleanBaseUrl) {
    params.set('baseUrl', cleanBaseUrl);
  }

  return `/api/redirect?${params.toString()}`;
}

export function Header({
  refreshing,
  onRefresh,
  lastRefreshed,
  refreshAvailable,
  seriesCatalog = [],
}: {
  refreshing: boolean;
  onRefresh: () => void;
  lastRefreshed: string | null;
  refreshAvailable: boolean;
  seriesCatalog?: Series[];
}) {
  const [query, setQuery] = useState('');
  const [openDropdown, setOpenDropdown] = useState(false);
  const [remoteMedia, setRemoteMedia] = useState<MediaTitle[]>([]);
  const [searchingMedia, setSearchingMedia] = useState(false);
  const containerRef = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setRemoteMedia([]);
      setSearchingMedia(false);
      return;
    }
    const controller = new AbortController();
    setSearchingMedia(true);
    const timer = window.setTimeout(() => {
      Promise.all([
        fetchMediaPage('ANIME', 1, 'POPULARITY_DESC', trimmed, controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK).catch(() => ({ items: [] as MediaTitle[] })),
        fetchMediaPage('MANGA', 1, 'POPULARITY_DESC', trimmed, controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK).catch(() => ({ items: [] as MediaTitle[] })),
      ])
        .then(([animeRes, mangaRes]) => {
          if (controller.signal.aborted) return;
          setRemoteMedia([...animeRes.items.slice(0, 6), ...mangaRes.items.slice(0, 6)]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingMedia(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const recommendations: UnifiedRecommendation[] = (() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const matchedLiveAction: UnifiedRecommendation[] = seriesCatalog
      .filter((item) => item.title.toLowerCase().includes(normalized) || item.country.toLowerCase().includes(normalized))
      .slice(0, 6)
      .map((item) => ({
        key: `series-${item.id}`,
        title: item.title,
        category: 'Live Action' as const,
        subtitle: `${item.country}${item.year ? ` · ${item.year}` : ''} · ${item.status === 'airing' ? 'Airing' : item.status === 'upcoming' ? 'Upcoming' : 'Completed'}`,
        coverUrl: item.coverUrl,
        path: `/series/${encodeURIComponent(item.id)}`,
      }));

    const matchedMedia: UnifiedRecommendation[] = remoteMedia.map((item) => {
      const params = new URLSearchParams();
      if (item.isAdult) params.set('mature', '1');
      if ((item.boysLoveRank ?? 0) < DEFAULT_MINIMUM_BL_TAG_RANK) params.set('tagRank', 'all');
      const qs = params.toString();
      return {
        key: `${item.type}-${item.id}`,
        title: item.displayTitle,
        category: item.type === 'ANIME' ? ('Anime' as const) : ('Manga' as const),
        subtitle: [item.format, item.startYear, item.status?.replaceAll('_', ' ')].filter(Boolean).join(' · '),
        coverUrl: item.coverImage,
        path: `/${item.type === 'ANIME' ? 'anime' : 'manga'}/${item.id}${qs ? `?${qs}` : ''}`,
      };
    });

    // Interleave & sort by exact/prefix title match regardless of category
    const all = [...matchedLiveAction, ...matchedMedia];
    all.sort((a, b) => {
      const aStarts = a.title.toLowerCase().startsWith(normalized) ? 0 : 1;
      const bStarts = b.title.toLowerCase().startsWith(normalized) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.title.localeCompare(b.title);
    });
    return all.slice(0, 12);
  })();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    setOpenDropdown(false);
    if (!value) {
      navigate('/');
      return;
    }
    if (recommendations.length === 1) {
      navigate(recommendations[0].path);
      return;
    }
    navigate(`/?q=${encodeURIComponent(value)}`);
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" to="/" aria-label="BL Pulse home">
          <span className="brand-mark"><img src={MARK_URL} alt="" /></span>
          <span className="brand-name">BL<span>PULSE</span></span>
        </Link>
        <nav className="primary-nav" aria-label="Main navigation">
          <NavLink to="/discover" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Live action</NavLink>
          <NavLink to="/anime" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Anime</NavLink>
          <NavLink to="/manga" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Manga</NavLink>
        </nav>
        <div className="topbar-actions">
          <form
            className="header-search"
            onSubmit={submit}
            role="search"
            ref={containerRef}
            style={{ position: 'relative' }}
          >
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search all BL series, anime, and manga"
              value={query}
              onFocus={() => setOpenDropdown(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpenDropdown(true);
              }}
              placeholder="Search BL series, anime & manga…"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setQuery('');
                  setOpenDropdown(false);
                }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
            {openDropdown && query.trim().length > 0 && (
              <div
                role="listbox"
                aria-label="Search recommendations across Live Action, Anime, and Manga"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  right: 0,
                  minWidth: '320px',
                  maxHeight: '420px',
                  overflowY: 'auto',
                  background: 'rgba(16, 13, 24, 0.98)',
                  border: '1px solid rgba(199, 146, 255, 0.28)',
                  borderRadius: '14px',
                  boxShadow: '0 20px 48px rgba(0, 0, 0, 0.75)',
                  zIndex: 100,
                  padding: '8px',
                }}
              >
                {recommendations.length > 0 ? (
                  <>
                    {recommendations.map((rec) => (
                      <Link
                        key={rec.key}
                        to={rec.path}
                        onClick={() => setOpenDropdown(false)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 10px',
                          borderRadius: '10px',
                          textDecoration: 'none',
                          color: '#f5f0ff',
                        }}
                      >
                        <div
                          style={{
                            width: '38px',
                            height: '52px',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            flexShrink: 0,
                            background: 'rgba(155, 92, 255, 0.16)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {rec.coverUrl ? (
                            <img src={rec.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <Sparkles size={15} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <strong
                              style={{
                                fontSize: '0.88rem',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {rec.title}
                            </strong>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px', fontSize: '0.75rem', color: 'rgba(226, 214, 248, 0.72)' }}>
                            <span
                              style={{
                                padding: '1px 6px',
                                borderRadius: '4px',
                                background:
                                  rec.category === 'Live Action'
                                    ? 'rgba(155, 92, 255, 0.25)'
                                    : rec.category === 'Anime'
                                      ? 'rgba(56, 189, 248, 0.22)'
                                      : 'rgba(244, 114, 182, 0.22)',
                                color: '#fff',
                                fontWeight: 600,
                                fontSize: '0.68rem',
                              }}
                            >
                              {rec.category}
                            </span>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {rec.subtitle}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                    <button
                      type="submit"
                      style={{
                        width: '100%',
                        marginTop: '6px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: '1px solid rgba(199, 146, 255, 0.25)',
                        background: 'rgba(155, 92, 255, 0.14)',
                        color: '#e9d5ff',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      See all results for “{query.trim()}” across Live Action, Anime &amp; Manga
                    </button>
                  </>
                ) : (
                  <div style={{ padding: '14px 12px', fontSize: '0.84rem', color: 'rgba(226, 214, 248, 0.75)' }}>
                    {searchingMedia ? 'Searching Live Action, Anime & Manga…' : `Press Enter to search “${query.trim()}” across all categories`}
                  </div>
                )}
              </div>
            )}
          </form>
          {refreshAvailable
            ? <button className={`refresh-button ${refreshing ? 'is-refreshing' : ''}`} onClick={onRefresh} disabled={refreshing} title={lastRefreshed ? `Last refreshed ${new Date(lastRefreshed).toLocaleString()}` : 'Refresh from source'} aria-label="Refresh catalog from source"><RefreshCw size={17} /><span>{refreshing ? 'Syncing' : 'Sync'}</span></button>
            : <span className="refresh-pending"><Radio size={14} /> TMDB setup pending</span>}
        </div>
      </div>
    </header>
  );
}

const statusLabel: Record<SeriesStatus, string> = {
  airing: 'Airing now',
  upcoming: 'Coming soon',
  completed: 'Completed',
};

export function StatusPill({ status, compact = false }: { status: SeriesStatus; compact?: boolean }) {
  return <span className={`status-pill status-${status} ${compact ? 'compact' : ''}`}><i />{statusLabel[status]}</span>;
}

function titleHue(title: string): number {
  return title.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
}

export function SeriesCard({ series }: { series: Series }) {
  const [imageFailed, setImageFailed] = useState(false);
  const hue = titleHue(series.title);
  const hueStyle = { '--poster-hue': `${hue}deg` } as CSSProperties;
  return (
    <Link className="series-card" to={`/series/${encodeURIComponent(series.id)}`} style={hueStyle}>
      <div className={`poster-art ${series.coverUrl && !imageFailed ? 'has-art' : 'generated-art'}`}>
        {series.coverUrl && !imageFailed
          ? <img src={series.coverUrl} alt={`${series.title} source artwork`} loading="lazy" onError={() => setImageFailed(true)} />
          : <div className="poster-fallback"><span className="poster-orbit" /><span className="poster-country">{series.country}</span><strong>{series.title}</strong><span className="poster-edition">A BL PULSE PICK</span></div>}
        <div className="poster-shade" />
        <div className="poster-badges"><StatusPill status={series.status} compact /></div>
        <div className="poster-caption">
          <div className="poster-country-label">{series.country}</div>
          <h3>{series.title}</h3>
          {series.platforms.length > 0 && <div className="poster-platforms">{series.platforms.slice(0, 3).map((platform) => <span key={platform.name}>{platform.name}</span>)}</div>}
        </div>
        <span className="poster-open"><ArrowUpRight size={16} /></span>
      </div>
    </Link>
  );
}

export function SeriesRail({ title, eyebrow, series, action }: { title: string; eyebrow?: string; series: Series[]; action?: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  function scroll(direction: number) {
    rail.current?.scrollBy({ left: direction * 620, behavior: 'smooth' });
  }
  if (series.length === 0) return null;
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
        </div>
        <div className="section-tools">
          {action}
          <button className="rail-arrow" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}><ArrowLeft size={17} /></button>
          <button className="rail-arrow" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}><ArrowRight size={17} /></button>
        </div>
      </div>
      <div className="series-rail" ref={rail}>
        {series.map((item) => <SeriesCard key={item.id} series={item} />)}
      </div>
    </section>
  );
}

export type MixedItem =
  | { kind: 'series'; data: Series }
  | { kind: 'media'; data: MediaTitle };

function MixedMediaCard({ item }: { item: MediaTitle }) {
  const [imageFailed, setImageFailed] = useState(false);
  const hue = titleHue(item.displayTitle);
  const hueStyle = { '--poster-hue': `${hue}deg` } as CSSProperties;
  const params = new URLSearchParams();
  if (item.isAdult) params.set('mature', '1');
  if ((item.boysLoveRank ?? 0) < DEFAULT_MINIMUM_BL_TAG_RANK) params.set('tagRank', 'all');
  const query = params.toString();
  const detailPath = `/${item.type === 'ANIME' ? 'anime' : 'manga'}/${item.id}${query ? `?${query}` : ''}`;
  const statusMap: SeriesStatus =
    item.status === 'RELEASING'
      ? 'airing'
      : item.status === 'NOT_YET_RELEASED'
        ? 'upcoming'
        : 'completed';
  const categoryLabel = item.type === 'ANIME' ? 'BL Anime' : 'BL Manga';

  return (
    <Link className="series-card" to={detailPath} style={hueStyle}>
      <div className={`poster-art ${item.coverImage && !imageFailed ? 'has-art' : 'generated-art'}`}>
        {item.coverImage && !imageFailed
          ? <img src={item.coverImage} alt={`${item.displayTitle} cover`} loading="lazy" onError={() => setImageFailed(true)} />
          : <div className="poster-fallback"><span className="poster-orbit" /><span className="poster-country">{categoryLabel}</span><strong>{item.displayTitle}</strong><span className="poster-edition">ANILIST · BL</span></div>}
        <div className="poster-shade" />
        <div className="poster-badges"><StatusPill status={statusMap} compact /></div>
        <div className="poster-caption">
          <div className="poster-country-label">{categoryLabel}{item.startYear ? ` · ${item.startYear}` : ''}</div>
          <h3>{item.displayTitle}</h3>
          {item.streamingLinks.length > 0 && (
            <div className="poster-platforms">
              {item.streamingLinks.slice(0, 2).map((link) => (
                <span key={link.site}>{link.site}</span>
              ))}
            </div>
          )}
        </div>
        <span className="poster-open"><ArrowUpRight size={16} /></span>
      </div>
    </Link>
  );
}

export function MixedCatalogRail({
  title,
  eyebrow,
  items,
  action,
}: {
  title: string;
  eyebrow?: string;
  items: MixedItem[];
  action?: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  function scroll(direction: number) {
    rail.current?.scrollBy({ left: direction * 620, behavior: 'smooth' });
  }
  if (items.length === 0) return null;
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
        </div>
        <div className="section-tools">
          {action}
          <button className="rail-arrow" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}><ArrowLeft size={17} /></button>
          <button className="rail-arrow" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}><ArrowRight size={17} /></button>
        </div>
      </div>
      <div className="series-rail" ref={rail}>
        {items.map((entry) =>
          entry.kind === 'series' ? (
            <SeriesCard key={`series-${entry.data.id}`} series={entry.data} />
          ) : (
            <MixedMediaCard key={`media-${entry.data.type}-${entry.data.id}`} item={entry.data} />
          ),
        )}
      </div>
    </section>
  );
}

export function Freshness({ lastRefreshed, sourceOnline }: { lastRefreshed: string | null; sourceOnline: boolean }) {
  const date = lastRefreshed ? new Date(lastRefreshed) : null;
  return (
    <div className="freshness-strip">
      <span className={`signal-dot ${sourceOnline ? '' : 'offline'}`}><i /></span>
      <span>{sourceOnline ? 'Source signal live' : lastRefreshed ? 'Showing last saved catalog' : 'Live-action source setup pending'}</span>
      <span className="freshness-divider" />
      <span>{date ? `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : sourceOnline ? 'No refresh timestamp recorded' : 'Connect TMDB to enable live-action listings'}</span>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <Link className="footer-brand" to="/"><span className="brand-mark" style={{ width: '26px', height: '26px', borderRadius: '8px' }}><img src={MARK_URL} alt="BL Pulse logo" style={{ width: '24px', height: '24px' }} /></span> BL PULSE</Link>
      <p>Find the story. Follow the source. Watch on the platform.</p>
      <a href="https://anilist.co/" target="_blank" rel="noopener noreferrer">Anime &amp; manga data: AniList</a>
      <span className="footer-note">BL Pulse is an independent Boys’ Love discovery guide. Availability varies by region; titles, cover art and source links are credited to their official providers.</span>
    </footer>
  );
}

export function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="text-link" to={to}>{children}<ChevronRight size={16} /></Link>;
}
