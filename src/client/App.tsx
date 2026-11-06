import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, BookOpen, CalendarDays, Filter, Globe2, LoaderCircle, Radio, Search, Sparkles, Tv, WandSparkles } from 'lucide-react';
import { DEFAULT_MINIMUM_BL_TAG_RANK, type MediaTitle } from '../shared/media';
import type { CatalogResponse, Series } from '../shared/types';
import { metadataForPath } from '../shared/seo';
import { fetchCatalog, fetchMediaPage, fetchSeries, refreshCatalog as requestRefresh } from './api';
import { AdminPage } from './AdminPage';
import {
  AdBanner,
  Footer,
  Freshness,
  Header,
  MixedCatalogRail,
  resolvePlatformEpisodeUrl,
  SectionLink,
  SeriesCard,
  SeriesRail,
  StatusPill,
  type MixedItem,
} from './components';
import { applyPageMetadata } from './seo';
import { MediaCard, MediaCategoryCards, MediaDetailPage, MediaLibraryPage, MediaSpotlightRail } from './MediaPages';

const emptyCatalog: CatalogResponse = {
  series: [], lastRefreshed: null, lastChecked: null, sourceOnline: false, refreshing: false, editorial: null,
};

function timeLabel(value: string | null): string {
  if (!value) return 'Waiting for first sync';
  const date = new Date(value);
  return `Last synced ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

interface HeroArtwork {
  url: string;
  title: string;
  label: 'Live action' | 'Anime' | 'Manga';
  path: string;
}

function interleaveMixedItems(seriesList: Series[], animeList: MediaTitle[], mangaList: MediaTitle[], maxTotal = 24): MixedItem[] {
  const result: MixedItem[] = [];
  const maxLen = Math.max(seriesList.length, animeList.length, mangaList.length);
  for (let i = 0; i < maxLen && result.length < maxTotal; i++) {
    if (i < seriesList.length) {
      result.push({ kind: 'series', data: seriesList[i] });
    }
    if (i < animeList.length && result.length < maxTotal) {
      result.push({ kind: 'media', data: animeList[i] });
    }
    if (i < mangaList.length && result.length < maxTotal) {
      result.push({ kind: 'media', data: mangaList[i] });
    }
  }
  return result;
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<CatalogResponse>(emptyCatalog);
  const [loading, setLoading] = useState(true);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const detailId = location.pathname.match(/^\/series\/([^/]+)\/?$/)?.[1];
  const routeSeries = detailId ? catalog.series.find((item) => item.id === decodeURIComponent(detailId)) : undefined;
  const pageSeo = metadataForPath(location.pathname, routeSeries).metadata;

  // Owner secret keyboard shortcut: Ctrl+Shift+A (or Cmd+Shift+A) opens /admin directly
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        navigate('/admin');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  useEffect(() => {
    if (/^\/(?:anime|manga|comic)\/\d+\/?$/.test(location.pathname)) return;
    applyPageMetadata(pageSeo);
  }, [pageSeo.title, pageSeo.description, pageSeo.canonicalPath, pageSeo.image, pageSeo.noindex, pageSeo.keywords.join(',')]);

  useEffect(() => {
    let active = true;
    let timeoutId: number | undefined;
    let remainingPolls = 24;
    async function load() {
      try {
        const next = await fetchCatalog();
        if (!active) return;
        setCatalog(next);
        if (next.refreshing && remainingPolls > 0) {
          remainingPolls -= 1;
          timeoutId = window.setTimeout(() => { void load(); }, 2_500);
        }
      } catch {
        if (active) setNotice('We could not reach the catalog source. Try syncing again in a moment.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  async function sync() {
    if (refreshBusy) return;
    setRefreshBusy(true);
    setNotice('');
    try {
      const next = await requestRefresh();
      setCatalog(next);
      setNotice('Live-action catalog updated.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The latest source could not be reached.');
      try { setCatalog(await fetchCatalog()); } catch { /* retain current catalog */ }
    } finally {
      setRefreshBusy(false);
    }
  }

  function updateOne(updated: Series) {
    setCatalog((current) => ({ ...current, series: current.series.map((item) => item.id === updated.id ? updated : item) }));
  }

  const status: CatalogResponse = { ...catalog, refreshing: refreshBusy };
  return (
    <div className="app-shell">
      <Header
        refreshing={status.refreshing}
        onRefresh={sync}
        lastRefreshed={catalog.lastRefreshed}
        refreshAvailable={Boolean(catalog.sourceOnline || catalog.lastChecked || catalog.series.length)}
        seriesCatalog={catalog.series}
      />
      <AdBanner placement="header" monetization={catalog.monetization} />
      {notice && <div className={`notice-bar ${notice.includes('could not') || notice.includes('couldn’t') || notice.includes('not reach') ? 'notice-error' : ''}`} role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}
      <main>
        <Routes>
          <Route path="/" element={<HomePage catalog={status} loading={loading} />} />
          <Route path="/discover" element={<DiscoverPage catalog={status} loading={loading} />} />
          <Route path="/series/:id" element={<SeriesPage catalog={status} updateOne={updateOne} />} />
          <Route path="/anime" element={<MediaLibraryPage type="ANIME" monetization={catalog.monetization} />} />
          <Route path="/anime/:id" element={<MediaDetailPage type="ANIME" monetization={catalog.monetization} />} />
          <Route path="/manga" element={<MediaLibraryPage type="MANGA" monetization={catalog.monetization} />} />
          <Route path="/manga/:id" element={<MediaDetailPage type="MANGA" monetization={catalog.monetization} />} />
          <Route path="/comic" element={<MediaLibraryPage type="MANGA" monetization={catalog.monetization} />} />
          <Route path="/comic/:id" element={<MediaDetailPage type="MANGA" monetization={catalog.monetization} />} />
          <Route path="/admin" element={<AdminPage catalog={status} onCatalogUpdated={setCatalog} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function HomePage({ catalog, loading }: { catalog: CatalogResponse; loading: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const globalSearchQuery = (searchParams.get('q') ?? '').trim();

  const airing = catalog.series.filter((item) => item.status === 'airing');
  const upcoming = catalog.series.filter((item) => item.status === 'upcoming');
  const completed = catalog.series.filter((item) => item.status === 'completed');
  const featured = airing[0] ?? upcoming[0] ?? completed[0];

  const [animePicks, setAnimePicks] = useState<MediaTitle[]>([]);
  const [mangaPicks, setMangaPicks] = useState<MediaTitle[]>([]);
  const [animePage2, setAnimePage2] = useState<MediaTitle[]>([]);
  const [mangaPage2, setMangaPage2] = useState<MediaTitle[]>([]);
  const [searchedAnime, setSearchedAnime] = useState<MediaTitle[]>([]);
  const [searchedManga, setSearchedManga] = useState<MediaTitle[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  const [failedArt, setFailedArt] = useState<string[]>([]);
  const [rotationIndex, setRotationIndex] = useState(() => Math.floor(Math.random() * 10_000));
  const [rotationStarted, setRotationStarted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchMediaPage('ANIME', 1, 'POPULARITY_DESC', '', controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK),
      fetchMediaPage('MANGA', 1, 'POPULARITY_DESC', '', controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK),
      fetchMediaPage('ANIME', 1, 'START_DATE_DESC', '', controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK),
      fetchMediaPage('MANGA', 1, 'START_DATE_DESC', '', controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK),
    ]).then(([anime1, manga1, animeRecent, mangaRecent]) => {
      if (controller.signal.aborted) return;
      setAnimePicks(anime1.items);
      setMangaPicks(manga1.items);
      setAnimePage2(animeRecent.items);
      setMangaPage2(mangaRecent.items);
    }).catch(() => {
      // Keep the original generated hero artwork if AniList is temporarily unavailable.
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!globalSearchQuery) {
      setSearchedAnime([]);
      setSearchedManga([]);
      setSearchBusy(false);
      return;
    }
    const controller = new AbortController();
    setSearchBusy(true);
    Promise.all([
      fetchMediaPage('ANIME', 1, 'POPULARITY_DESC', globalSearchQuery, controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK).catch(() => ({ items: [] as MediaTitle[] })),
      fetchMediaPage('MANGA', 1, 'POPULARITY_DESC', globalSearchQuery, controller.signal, false, DEFAULT_MINIMUM_BL_TAG_RANK).catch(() => ({ items: [] as MediaTitle[] })),
    ]).then(([animeRes, mangaRes]) => {
      if (controller.signal.aborted) return;
      setSearchedAnime(animeRes.items);
      setSearchedManga(mangaRes.items);
    }).finally(() => {
      if (!controller.signal.aborted) setSearchBusy(false);
    });
    return () => controller.abort();
  }, [globalSearchQuery]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    let rotationTimer: number | undefined;
    const openingTimer = window.setTimeout(() => {
      setRotationStarted(true);
      rotationTimer = window.setInterval(() => setRotationIndex((index) => index + 1), 8_000);
    }, 8_000);
    return () => {
      window.clearTimeout(openingTimer);
      if (rotationTimer !== undefined) window.clearInterval(rotationTimer);
    };
  }, []);

  const allAnime = useMemo(() => {
    const map = new Map<number, MediaTitle>();
    for (const item of [...animePicks, ...animePage2]) map.set(item.id, item);
    return [...map.values()];
  }, [animePicks, animePage2]);

  const allManga = useMemo(() => {
    const map = new Map<number, MediaTitle>();
    for (const item of [...mangaPicks, ...mangaPage2]) map.set(item.id, item);
    return [...map.values()];
  }, [mangaPicks, mangaPage2]);

  const mixedCurrent = useMemo(() => {
    const releasingAnime = allAnime.filter((item) => item.status === 'RELEASING');
    const releasingManga = allManga.filter((item) => item.status === 'RELEASING');
    const fallbackAnime = releasingAnime.length > 0 ? releasingAnime : allAnime.slice(0, 6);
    const fallbackManga = releasingManga.length > 0 ? releasingManga : allManga.slice(0, 8);
    return interleaveMixedItems(airing, fallbackAnime, fallbackManga, 24);
  }, [airing, allAnime, allManga]);

  const mixedUpcoming = useMemo(() => {
    const upcomingAnime = allAnime.filter((item) => item.status === 'NOT_YET_RELEASED');
    const upcomingManga = allManga.filter((item) => item.status === 'NOT_YET_RELEASED');
    const fallbackAnime = upcomingAnime.length > 0 ? upcomingAnime : allAnime.filter((item) => (item.startYear ?? 0) >= 2024).slice(0, 6);
    const fallbackManga = upcomingManga.length > 0 ? upcomingManga : allManga.filter((item) => item.status === 'RELEASING').slice(0, 6);
    return interleaveMixedItems(upcoming, fallbackAnime, fallbackManga, 24);
  }, [upcoming, allAnime, allManga]);

  const mixedCompleted = useMemo(() => {
    const completedAnime = allAnime.filter((item) => item.status === 'FINISHED');
    const completedManga = allManga.filter((item) => item.status === 'FINISHED');
    return interleaveMixedItems(completed, completedAnime, completedManga, 24);
  }, [completed, allAnime, allManga]);

  const liveActionExplore = useMemo(() => {
    return [...airing.slice(0, 5), ...completed.slice(0, 10), ...upcoming.slice(0, 3)].slice(0, 14);
  }, [airing, completed, upcoming]);

  const searchedLiveAction = useMemo(() => {
    if (!globalSearchQuery) return [];
    const qLower = globalSearchQuery.toLowerCase();
    return catalog.series.filter((item) =>
      item.title.toLowerCase().includes(qLower) ||
      item.country.toLowerCase().includes(qLower) ||
      item.genres.some((g) => g.toLowerCase().includes(qLower))
    );
  }, [catalog.series, globalSearchQuery]);

  const heroArt = useMemo(() => {
    if (!rotationStarted) return null;
    const candidates: HeroArtwork[] = [
      ...catalog.series.flatMap((item) => item.coverUrl ? [{ url: item.coverUrl, title: item.title, label: 'Live action' as const, path: `/series/${item.id}` }] : []),
      ...animePicks.flatMap((item) => item.bannerImage || item.coverImage ? [{ url: item.bannerImage || item.coverImage!, title: item.displayTitle, label: 'Anime' as const, path: `/anime/${item.id}` }] : []),
      ...mangaPicks.flatMap((item) => item.bannerImage || item.coverImage ? [{ url: item.bannerImage || item.coverImage!, title: item.displayTitle, label: 'Manga' as const, path: `/manga/${item.id}` }] : []),
    ].filter((item, index, all) => !failedArt.includes(item.url) && all.findIndex((candidate) => candidate.url === item.url) === index);
    return candidates.length ? candidates[rotationIndex % candidates.length] : null;
  }, [animePicks, catalog.series, failedArt, mangaPicks, rotationIndex, rotationStarted]);

  return (
    <>
      <section className="hero">
        {heroArt && <div className="hero-dynamic-backdrop" key={heroArt.url}><img src={heroArt.url} alt="" onError={() => setFailedArt((current) => [...current, heroArt.url])} /></div>}
        <div className="hero-glow" />
        <div className="hero-content">
          <Freshness lastRefreshed={catalog.lastRefreshed} sourceOnline={catalog.sourceOnline} />
          <div className="hero-kicker"><span className="kicker-icon"><Radio size={14} /></span> STORIES WORTH STAYING UP FOR</div>
          <h1>Your next story<br /><span>starts here.</span></h1>
          <p className="hero-copy">Explore BL live-action series, anime and comics — select your platform and episode or chapter, then jump directly to your story.</p>
          {featured && <div className="hero-feature"><span className="hero-feature-line" /><div><span className="hero-feature-label">ON THE SIGNAL</span><strong>{featured.title}</strong><span className="hero-feature-meta">{featured.country} <span>·</span> {featured.status === 'airing' ? 'Airing now' : featured.status === 'upcoming' ? 'Coming soon' : 'Completed'}</span></div></div>}
          <div className="hero-actions">
            <Link className="button button-primary" to={featured ? `/series/${featured.id}` : '/discover'}><Sparkles size={17} /> Explore the story</Link>
            <Link className="button button-secondary" to="/discover"><BookOpen size={17} /> Browse Live-Action ({catalog.series.length})</Link>
          </div>
          <div className="hero-footnote"><span className="pulse-mini" /> {catalog.series.length ? `${catalog.series.length.toLocaleString()} live-action series · BL Anime · BL Comic` : 'BL Live-Action · Anime · Comic'} <span className="footnote-divider">/</span> {catalog.lastRefreshed ? timeLabel(catalog.lastRefreshed) : 'Multi-platform episode & chapter redirects active'}</div>
        </div>
        <div className="hero-side-note"><span>THE</span><span>BL</span><span>COLLECTION</span></div>
        {heroArt && <div className="hero-art-credit"><span>IN THE ROTATION · {heroArt.label.toUpperCase()}</span><Link to={heroArt.path}>{heroArt.title} <ArrowUpRight size={12} /></Link></div>}
        <div className="hero-bottom-fade" />
      </section>

      <div className="page-content">
        {globalSearchQuery && (
          <section className="rail-section" style={{ marginBottom: '36px', padding: '24px', borderRadius: '18px', background: 'rgba(155, 92, 255, 0.07)', border: '1px solid rgba(199, 146, 255, 0.28)' }}>
            <div className="rail-header">
              <div>
                <div className="eyebrow">GLOBAL SEARCH ACROSS ALL CATEGORIES</div>
                <h2>Results for “{globalSearchQuery}”</h2>
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete('q');
                  setSearchParams(next, { replace: true });
                }}
              >
                Clear search
              </button>
            </div>
            {searchBusy && <LoadingState label={`Searching Live-Action, Anime, and Comic for "${globalSearchQuery}"`} />}
            {!searchBusy && searchedLiveAction.length === 0 && searchedAnime.length === 0 && searchedManga.length === 0 && (
              <div className="empty-results" style={{ marginTop: '16px' }}>
                <div className="empty-mark"><Search size={21} /></div>
                <h2>No matching BL series, anime, or comic found.</h2>
                <p>Try searching by another title keyword across Live-Action, Anime, or Comic.</p>
              </div>
            )}
            {searchedLiveAction.length > 0 && (
              <div style={{ marginTop: '18px' }}>
                <div className="eyebrow" style={{ marginBottom: '12px' }}>LIVE-ACTION SERIES ({searchedLiveAction.length})</div>
                <div className="discover-grid">
                  {searchedLiveAction.slice(0, 12).map((item) => <SeriesCard key={item.id} series={item} />)}
                </div>
              </div>
            )}
            {searchedAnime.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <div className="eyebrow" style={{ marginBottom: '12px' }}>BL ANIME ({searchedAnime.length})</div>
                <div className="media-grid">
                  {searchedAnime.slice(0, 12).map((item) => <MediaCard key={item.id} item={item} />)}
                </div>
              </div>
            )}
            {searchedManga.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <div className="eyebrow" style={{ marginBottom: '12px' }}>BL COMIC — MANGA, MANHWA &amp; WEBTOON ({searchedManga.length})</div>
                <div className="media-grid">
                  {searchedManga.slice(0, 12).map((item) => <MediaCard key={item.id} item={item} />)}
                </div>
              </div>
            )}
          </section>
        )}

        <div className="catalog-intro">
          <div className="intro-copy"><div className="eyebrow">THE UNIFIED BL CATALOG</div><h2>Find the feeling.<br /><em>Follow the story.</em></h2></div>
          <p>Strictly Boys’ Love live-action series, BL anime, and BL comics (manga, manhwa &amp; webtoons) — choose your preferred platform (YouTube, Crunchyroll, GagaOOLala, iQIYI, Viki, MangaDex &amp; more) and jump straight to any episode or chapter.</p>
        </div>

        <MediaCategoryCards liveActionCount={catalog.series.length} />

        {/* Explore Rails for all 3 categories on the Home Page */}
        <SeriesRail
          title="BL Live-Action Series to explore"
          eyebrow={`LIVE-ACTION SERIES · ${catalog.series.length} TITLES`}
          series={liveActionExplore}
          action={<SectionLink to="/discover">Open Live-Action</SectionLink>}
        />
        <AdBanner placement="infeed" monetization={catalog.monetization} />
        <MediaSpotlightRail type="ANIME" items={animePicks} />
        <MediaSpotlightRail type="MANGA" items={mangaPicks} />

        {loading && catalog.sourceOnline && catalog.series.length === 0 && <LoadingState label="Finding the latest stories" />}
        {!loading && catalog.series.length === 0 && <EmptyState />}

        {/* Unified Mixed Status Rails on the Home Page (Live-Action + Anime + Comic) */}
        <MixedCatalogRail
          title="Happening now"
          eyebrow="CURRENTLY AIRING & RELEASING · LIVE-ACTION · ANIME · COMIC"
          items={mixedCurrent}
          action={<SectionLink to="/discover?status=airing">Live-Action Airing</SectionLink>}
        />
        <MixedCatalogRail
          title="On the horizon"
          eyebrow="UPCOMING · LIVE-ACTION · ANIME · COMIC"
          items={mixedUpcoming}
          action={<SectionLink to="/discover?status=upcoming">Upcoming Releases</SectionLink>}
        />
        {catalog.editorial && <EditorialCard post={catalog.editorial} />}
        <MixedCatalogRail
          title="A story for every mood"
          eyebrow="COMPLETED ARCHIVE · LIVE-ACTION · ANIME · COMIC"
          items={mixedCompleted}
          action={<SectionLink to="/discover?status=completed">Explore Archive</SectionLink>}
        />

        <div className="source-note"><span className="source-note-icon"><Radio size={16} /></span><p><strong>Strictly verified platforms &amp; direct links.</strong> Every Live-Action series, Anime, and Comic lists only verified streaming or reading platforms with direct URLs and episode or chapter selection.</p><Link className="text-link" to="/discover">Explore All {catalog.series.length} Live-Action Series <ArrowUpRight size={15} /></Link></div>
      </div>
    </>
  );
}

function EditorialCard({ post }: { post: NonNullable<CatalogResponse['editorial']> }) {
  return (
    <section className="editorial-card">
      <div className="editorial-icon"><WandSparkles size={20} /></div>
      <div className="editorial-content"><div className="eyebrow">A NOTE FROM THE SIGNAL <span className="editorial-source">{post.source === 'AI-assisted' ? 'AI · SOURCE-GROUNDED' : 'CATALOG PICK'}</span></div><h2>{post.title}</h2><p>{post.body}</p></div>
      <span className="editorial-decoration">✳</span>
    </section>
  );
}

function DiscoverPage({ catalog, loading }: { catalog: CatalogResponse; loading: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all');
  const [country, setCountry] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [genre, setGenre] = useState('all');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState('featured');

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
    setStatus(searchParams.get('status') ?? 'all');
  }, [searchParams]);

  const countries = useMemo(() => [...new Set(catalog.series.map((item) => item.country))].sort(), [catalog.series]);
  const platforms = useMemo(() => [...new Set(catalog.series.flatMap((item) => item.platforms.map((link) => link.name)))].sort(), [catalog.series]);
  const genres = useMemo(() => [...new Set(catalog.series.flatMap((item) => item.genres))].sort(), [catalog.series]);
  const years = useMemo(() => [...new Set(catalog.series.map((item) => item.year).filter((item): item is number => typeof item === 'number'))].sort((a, b) => b - a), [catalog.series]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const items = catalog.series.filter((item) => {
      const matchesText = !normalized || [item.title, item.country, item.year, ...item.genres, ...item.platforms.map((link) => link.name)].join(' ').toLowerCase().includes(normalized);
      const matchesStatus = status === 'all' || item.status === status;
      const matchesCountry = country === 'all' || item.country === country;
      const matchesPlatform = platform === 'all' || item.platforms.some((link) => link.name === platform);
      const matchesGenre = genre === 'all' || item.genres.includes(genre);
      const matchesYear = year === 'all' || String(item.year ?? '') === year;
      return matchesText && matchesStatus && matchesCountry && matchesPlatform && matchesGenre && matchesYear;
    });
    if (sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'country') items.sort((a, b) => a.country.localeCompare(b.country) || a.title.localeCompare(b.title));
    if (sort === 'newest') items.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
    return items;
  }, [catalog.series, query, status, country, platform, genre, year, sort]);

  function chooseStatus(value: string) {
    setStatus(value);
    const next = new URLSearchParams(searchParams);
    if (value === 'all') next.delete('status'); else next.set('status', value);
    setSearchParams(next, { replace: true });
  }

  function clearFilters() {
    setQuery(''); setCountry('all'); setPlatform('all'); setGenre('all'); setYear('all'); setSort('featured'); chooseStatus('all');
  }

  return (
    <div className="discover-page page-content">
      <div className="discover-heading"><div className="eyebrow"><span className="live-indicator"><i /></span> LIVE-ACTION BL ROOT CATALOG ({catalog.series.length} SERIES)</div><h1>Find your <em>next Live-Action story.</em></h1><p>This section shows strictly Boys’ Love live-action series across Thailand, South Korea, Japan, Taiwan, China, the Philippines, and beyond — with multi-platform and episode selection.</p><Freshness lastRefreshed={catalog.lastRefreshed} sourceOnline={catalog.sourceOnline} /></div>
      <div className="filters-panel">
        <div className="filter-search"><Filter size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search live-action titles, countries, years, platforms" aria-label="Search all live-action series" /></div>
        <div className="filter-selects">
          <label><span>Status</span><select value={status} onChange={(event) => chooseStatus(event.target.value)}><option value="all">All statuses</option><option value="airing">Airing now</option><option value="upcoming">Coming soon</option><option value="completed">Completed</option></select></label>
          <label><span>Country</span><select value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">All countries</option>{countries.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Platform</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">All known platforms</option>{platforms.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Source tag</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="all">All source tags</option>{genres.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Year</span><select value={year} onChange={(event) => setYear(event.target.value)}><option value="all">All years</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Source order</option><option value="title">Title A–Z</option><option value="country">Country</option><option value="newest">Latest source year</option></select></label>
        </div>
        <p className="filter-hint">Showing strictly BL Live-Action series only. Open any series to choose your streaming platform (YouTube, Viki, iQIYI, GagaOOLala, WeTV, Netflix, etc.) and select an episode.</p>
      </div>
      <div className="results-line"><div><strong>{filtered.length.toLocaleString()}</strong> live-action series<span> · </span><span>{status === 'all' ? 'All statuses' : status === 'airing' ? 'Airing now' : status === 'upcoming' ? 'Coming soon' : 'Completed'}</span></div><button className="clear-filters" onClick={clearFilters}>Clear filters</button></div>
      <AdBanner placement="infeed" monetization={catalog.monetization} />
      {loading && catalog.sourceOnline && catalog.series.length === 0 ? <LoadingState label="Loading the source catalog" /> : filtered.length > 0 ? <div className="discover-grid">{filtered.map((item) => <SeriesCard key={item.id} series={item} />)}</div> : !catalog.sourceOnline && catalog.series.length === 0 ? <EmptyState /> : <div className="empty-results"><div className="empty-mark"><Filter size={21} /></div><h2>No series match these filters.</h2><p>Try another title, country, platform, or category.</p><button className="button button-secondary" onClick={clearFilters}>Reset discovery filters</button></div>}
      {!catalog.sourceOnline && catalog.series.length > 0 && <div className="stale-banner"><Radio size={16} /><span>The live-action source is offline. Showing only the last saved TMDB catalog snapshot.</span></div>}
    </div>
  );
}

function SeriesPage({ catalog, updateOne }: { catalog: CatalogResponse; updateOne: (series: Series) => void }) {
  const { id = '' } = useParams();
  const cached = catalog.series.find((item) => item.id === id);
  const [series, setSeries] = useState<Series | undefined>(cached);
  const [loading, setLoading] = useState(!cached);
  const [failed, setFailed] = useState(false);
  const [seasonNum, setSeasonNum] = useState(1);
  const [episodeNum, setEpisodeNum] = useState(1);
  const [selectedPlatform, setSelectedPlatform] = useState<string>(cached?.platforms[0]?.name ?? '');

  // Keep series synced if catalog finishes loading after initial mount, without resetting episodeNum or seasonNum
  useEffect(() => {
    if (cached && !series) {
      setSeries(cached);
      setLoading(false);
      setSelectedPlatform((prev) => (cached.platforms.some((p) => p.name === prev) ? prev : (cached.platforms[0]?.name ?? '')));
    }
  }, [cached, series]);

  // Only reset season and episode when navigating to a different series ID
  useEffect(() => {
    let active = true;
    const initial = catalog.series.find((item) => item.id === id);
    setSeries(initial);
    setLoading(!initial);
    setFailed(false);
    setSeasonNum(1);
    setEpisodeNum(1);
    setSelectedPlatform(initial?.platforms[0]?.name ?? '');

    fetchSeries(id).then((detail) => {
      if (!active) return;
      setSeries(detail);
      updateOne(detail);
      setSelectedPlatform((prev) => {
        if (detail.platforms?.some((p) => p.name === prev)) return prev;
        return detail.platforms?.[0]?.name ?? '';
      });
    }).catch(() => {
      if (active && !initial) setFailed(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id]);

  if (loading && !series) return <LoadingState label="Opening the source guide" />;
  if (!series) return <div className="detail-missing page-content"><div className="empty-mark"><BookOpen size={22} /></div><h1>{failed ? 'This series is not in the live catalog.' : 'Series not found.'}</h1><Link className="button button-secondary" to="/discover"><ArrowLeft size={16} /> Back to discovery</Link></div>;

  const seasons = series.seasons && series.seasons.length >= 2 ? series.seasons : undefined;
  const activeSeason = seasons?.find((s) => s.seasonNumber === seasonNum) ?? seasons?.[0];
  const totalEpisodes = activeSeason?.episodes ?? series.episodes ?? 12;
  const safeEpisodeNum = Math.min(episodeNum, totalEpisodes);

  const activePlatformObj = series.platforms.find((p) => p.name === selectedPlatform) ?? series.platforms[0];
  const activePlatformName = activePlatformObj?.name ?? 'Official Platform';
  const activeEpisodeRedirectUrl = resolvePlatformEpisodeUrl(
    activePlatformName,
    activePlatformObj?.url,
    series.title,
    safeEpisodeNum,
    'series',
    undefined,
    activeSeason?.seasonNumber,
    activeSeason?.title,
  );

  function chooseSeason(nextSeasonNum: number) {
    setSeasonNum(nextSeasonNum);
    const nextSeasonObj = seasons?.find((s) => s.seasonNumber === nextSeasonNum);
    if (nextSeasonObj && episodeNum > nextSeasonObj.episodes) {
      setEpisodeNum(1);
    }
  }

  return (
    <div className="detail-page">
      <section className="detail-hero">
        <div className="detail-hero-image" style={series.coverUrl ? { backgroundImage: `linear-gradient(90deg, rgba(9,8,13,.99) 0%, rgba(9,8,13,.9) 36%, rgba(9,8,13,.38) 72%, rgba(9,8,13,.45) 100%), url("${series.coverUrl}")` } : undefined} />
        <div className="detail-hero-content">
          <Link className="back-link" to="/discover"><ArrowLeft size={16} /> Back to Live-Action discovery</Link>
          <div className="detail-kicker"><StatusPill status={series.status} /> <span className="detail-country"><Globe2 size={14} /> {series.country}</span></div>
          <h1>{series.title}</h1>
          <div className="detail-tags">{series.genres.slice(0, 4).map((item) => <span key={item}>{item}</span>)}</div>
          <p className="detail-synopsis">{series.synopsis ?? 'No synopsis is available from the current live-action data source.'}</p>
          <div className="detail-actions">
            <a className="button button-primary" href={activeEpisodeRedirectUrl} target="_blank" rel="noopener noreferrer">
              <Tv size={17} /> Watch {seasons && activeSeason ? `S${activeSeason.seasonNumber} ` : ''}Ep {safeEpisodeNum} on {activePlatformName} <ArrowUpRight size={16} />
            </a>
            {activePlatformObj?.url && (
              <a className="button button-secondary" href={activePlatformObj.url} target="_blank" rel="noopener noreferrer">
                Direct {activePlatformName} URL <ArrowUpRight size={16} />
              </a>
            )}
          </div>
        </div>
      </section>
      <div className="detail-body page-content">
        <div className="detail-info-card">
          <div className="eyebrow">AT A GLANCE</div>
          <div className="detail-facts">
            <div><span>STATUS</span><strong>{series.status === 'airing' ? 'Airing now' : series.status === 'upcoming' ? 'Coming soon' : 'Completed'}</strong></div>
            <div><span>COUNTRY</span><strong>{series.country}</strong></div>
            <div>
              <span>YEAR / RELEASE</span>
              <strong>
                {series.releaseDate ?? (series.year ? String(series.year) : 'Not listed')}
                {seasons ? ` · ${seasons.length} Seasons` : series.episodes ? ` · ${series.episodes} eps` : ''}
              </strong>
            </div>
            <div><span>SELECTED PLATFORM</span><strong>{activePlatformName}</strong></div>
          </div>
        </div>
        <div className="source-card"><span className="source-card-mark"><Radio size={18} /></span><div><div className="eyebrow">VERIFIED DIRECT STREAMING</div><p>Strictly BL catalog entry with verified platform{seasons ? ', season,' : ''} and episode selection.</p><a href={activeEpisodeRedirectUrl} target="_blank" rel="noopener noreferrer">Watch Episode {safeEpisodeNum} on {activePlatformName} <ArrowUpRight size={14} /></a><small>Catalog snapshot {timeLabel(catalog.lastRefreshed).replace('Last synced ', '')}</small></div></div>

        <section className="episode-panel" style={{ gridColumn: '1 / -1', marginTop: 0 }} aria-labelledby="series-episode-panel-title">
          <div className="episode-panel-heading">
            <div>
              <div className="eyebrow">VERIFIED PLATFORM{seasons ? ', SEASON' : ''} &amp; EPISODE SELECTOR</div>
              <h2 id="series-episode-panel-title">
                Select available platform{seasons ? ', season,' : ''} and episode to watch.
              </h2>
            </div>
            <span className="episode-source-badge">
              {series.platforms.length} {series.platforms.length === 1 ? 'verified platform' : 'verified platforms'}
              {seasons ? ` · ${seasons.length} seasons` : ''}
              {` · ${totalEpisodes} episodes`}
            </span>
          </div>

          <div className="episode-search-block">
            {/* Step 1: Verified Available Platform Selector */}
            <div style={{ marginBottom: '18px' }}>
              <label className="episode-select-label" htmlFor="series-platform-select">
                1. Select Available Streaming Platform ({series.platforms.length} verified for {series.title})
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px', marginBottom: '6px' }}>
                {series.platforms.map((pf) => {
                  const active = pf.name === activePlatformObj?.name;
                  return (
                    <button
                      key={pf.name}
                      type="button"
                      onClick={() => setSelectedPlatform(pf.name)}
                      style={{
                        padding: '8px 15px',
                        borderRadius: '10px',
                        border: active ? '1px solid rgba(199, 146, 255, 0.85)' : '1px solid rgba(255,255,255,0.14)',
                        background: active ? 'linear-gradient(135deg, rgba(155, 92, 255, 0.34), rgba(112, 66, 212, 0.28))' : 'rgba(255,255,255,0.04)',
                        color: active ? '#fff' : 'rgba(246, 241, 255, 0.82)',
                        fontSize: '0.86rem',
                        fontWeight: active ? 700 : 500,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Tv size={14} />
                      {pf.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Conditional Step: Season Selector ONLY if 2 or more seasons exist */}
            {seasons && seasons.length >= 2 && (
              <div style={{ marginBottom: '18px' }}>
                <label className="episode-select-label" htmlFor="series-season-select" style={{ display: 'block', marginBottom: '8px' }}>
                  2. Select Season ({seasons.length} Seasons Available)
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
                  {seasons.map((s) => {
                    const active = s.seasonNumber === activeSeason?.seasonNumber;
                    return (
                      <button
                        key={s.seasonNumber}
                        type="button"
                        onClick={() => chooseSeason(s.seasonNumber)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '10px',
                          border: active ? '1px solid rgba(199, 146, 255, 0.85)' : '1px solid rgba(255,255,255,0.14)',
                          background: active ? 'rgba(155, 92, 255, 0.28)' : 'rgba(255,255,255,0.04)',
                          color: active ? '#fff' : 'rgba(246, 241, 255, 0.82)',
                          fontSize: '0.85rem',
                          fontWeight: active ? 700 : 500,
                          cursor: 'pointer',
                        }}
                      >
                        Season {s.seasonNumber}: {s.title} ({s.episodes} eps{s.year ? ` · ${s.year}` : ''})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Episode Selector */}
            <label className="episode-select-label" htmlFor="series-episode-select">
              {seasons ? '3.' : '2.'} Select Episode (1 to {totalEpisodes}) &amp; Open on {activePlatformObj?.name ?? 'Platform'}
            </label>
            <div className="episode-control-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
              <select
                id="series-platform-select"
                value={activePlatformObj?.name ?? ''}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                aria-label="Select platform"
              >
                {series.platforms.map((pf) => (
                  <option key={pf.name} value={pf.name}>Platform: {pf.name}</option>
                ))}
              </select>

              {seasons && seasons.length >= 2 && (
                <select
                  id="series-season-select"
                  value={activeSeason?.seasonNumber ?? 1}
                  onChange={(e) => chooseSeason(Number(e.target.value))}
                  aria-label="Select season"
                >
                  {seasons.map((s) => (
                    <option key={s.seasonNumber} value={s.seasonNumber}>
                      Season {s.seasonNumber} ({s.episodes} eps)
                    </option>
                  ))}
                </select>
              )}

              <select
                id="series-episode-select"
                value={safeEpisodeNum}
                onChange={(e) => setEpisodeNum(Number(e.target.value))}
                aria-label="Select episode"
              >
                {Array.from({ length: totalEpisodes }, (_, idx) => idx + 1).map((num) => (
                  <option key={num} value={num}>Episode {num}</option>
                ))}
              </select>

              <a className="button button-primary" href={activeEpisodeRedirectUrl} target="_blank" rel="noopener noreferrer">
                Watch {seasons && activeSeason ? `S${activeSeason.seasonNumber} ` : ''}Episode {safeEpisodeNum} on {activePlatformObj?.name ?? 'Platform'} <ArrowUpRight size={15} />
              </a>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px', marginBottom: '12px' }}>
              {Array.from({ length: Math.min(totalEpisodes, 36) }, (_, idx) => idx + 1).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setEpisodeNum(num)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: num === safeEpisodeNum ? '1px solid rgba(199, 146, 255, 0.7)' : '1px solid rgba(255,255,255,0.12)',
                    background: num === safeEpisodeNum ? 'rgba(155, 92, 255, 0.22)' : 'rgba(255,255,255,0.04)',
                    color: num === safeEpisodeNum ? '#fff' : 'rgba(246, 241, 255, 0.78)',
                    fontSize: '0.82rem',
                    fontWeight: num === safeEpisodeNum ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  Ep {num}
                </button>
              ))}
            </div>

            <p style={{ margin: 0 }}>
              Ready to open: <strong>{activeSeason ? activeSeason.title : series.title}</strong>
              {seasons && activeSeason ? <> (Season {activeSeason.seasonNumber})</> : null}
              {' — '}
              <strong>Episode {safeEpisodeNum}</strong> on <strong>{activePlatformObj?.name ?? 'Platform'}</strong>.
            </p>
          </div>
        </section>
        <div style={{ gridColumn: '1 / -1' }}>
          <AdBanner placement="detail" monetization={catalog.monetization} />
        </div>
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className="loading-state"><LoaderCircle size={25} className="spin" /><span>{label}</span><small>Checking the connected catalog source</small></div>;
}

function EmptyState() {
  return <div className="empty-results empty-catalog"><div className="empty-mark"><Radio size={22} /></div><h2>Live-action is waiting on its source.</h2><p>Connect the licensed TMDB data source to populate this section. Anime and Manga are already browsable from AniList.</p><div className="empty-actions"><Link className="button button-secondary" to="/anime">Browse BL Anime</Link><Link className="button button-secondary" to="/manga">Browse BL Manga</Link></div></div>;
}

function NotFound() {
  return <div className="detail-missing page-content"><div className="empty-mark"><CalendarDays size={22} /></div><h1>Page not on the signal.</h1><Link className="button button-secondary" to="/">Back to BL Pulse</Link></div>;
}

export default App;
