import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, CircleAlert, Film, Filter, LoaderCircle, Sparkles, Tv } from 'lucide-react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import {
  ALL_ANI_LIST_TAG_RANKS,
  DEFAULT_MINIMUM_BL_TAG_RANK,
  type AniListMediaType,
  type AniListSort,
  type AniListTagRankFilter,
  type MediaPageResponse,
  type MediaTitle,
  type StreamingLink,
} from '../shared/media';
import { metadataForPath } from '../shared/seo';
import { applyPageMetadata } from './seo';
import { fetchMediaPage, fetchMediaTitle } from './api';
import { resolvePlatformEpisodeUrl } from './components';

const rankCaption = 'AniList Boys’ Love tag rank';

const COUNTRY_LABELS: Record<string, string> = {
  JP: 'Japan',
  KR: 'South Korea',
  CN: 'China',
  TW: 'Taiwan',
};

function headingFor(type: AniListMediaType): string {
  return type === 'ANIME' ? 'BL Anime' : 'BL Manga';
}

function browsePath(type: AniListMediaType): string {
  return type === 'ANIME' ? '/anime' : '/manga';
}

function boundedHeading(value: string): string {
  return value.length <= 78 ? value : `${value.slice(0, 77).trimEnd()}…`;
}

export function MediaCard({ item }: { item: MediaTitle }) {
  const params = new URLSearchParams();
  if (item.isAdult) params.set('mature', '1');
  if ((item.boysLoveRank ?? 0) < DEFAULT_MINIMUM_BL_TAG_RANK) params.set('tagRank', 'all');
  const query = params.toString();
  const detailPath = `${browsePath(item.type)}/${item.id}${query ? `?${query}` : ''}`;
  const countryName = item.countryOfOrigin ? (COUNTRY_LABELS[item.countryOfOrigin] ?? item.countryOfOrigin) : null;
  return (
    <Link className="media-card" to={detailPath}>
      <div className="media-card-art">
        {item.coverImage
          ? <img src={item.coverImage} alt={`${item.displayTitle} cover`} loading="lazy" />
          : <div className="media-card-fallback"><Sparkles size={24} /><span>{headingFor(item.type)}</span></div>}
        <span className="media-rank" aria-label={`${rankCaption}: ${item.boysLoveRank ?? 'not reported'}`}>BL {item.boysLoveRank ?? '—'}</span>
        {item.isAdult && <span className="media-adult-badge">MATURE</span>}
      </div>
      <div className="media-card-copy">
        <h2 title={item.displayTitle}>{boundedHeading(item.displayTitle)}</h2>
        <p>{[countryName, item.format, item.startYear, item.status?.replaceAll('_', ' ')].filter(Boolean).join(' · ') || headingFor(item.type)}</p>
        {item.averageScore !== null && <span className="media-score">AniList score {item.averageScore}%</span>}
      </div>
    </Link>
  );
}

export function MediaSpotlightRail({ type, items }: { type: AniListMediaType; items: MediaTitle[] }) {
  if (items.length === 0) return null;
  return (
    <section className="media-spotlight content-section" aria-label={`Popular BL ${type === 'ANIME' ? 'Anime' : 'Manga'} titles`}>
      <div className="section-heading"><div><div className="eyebrow">ANILIST · STRICTLY BL</div><h2>{type === 'ANIME' ? 'BL Anime to explore' : 'BL Manga to explore'}</h2></div><Link className="text-link" to={browsePath(type)}>See all <ArrowUpRight size={13} /></Link></div>
      <div className="media-spotlight-rail">{items.slice(0, 10).map((item) => <MediaCard item={item} key={item.id} />)}</div>
    </section>
  );
}

export function MediaCategoryCards({ liveActionCount }: { liveActionCount?: number }) {
  return (
    <section
      className="media-category-section"
      aria-label="Browse Live-Action Series, Anime and Manga"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
    >
      <Link className="media-category-card" to="/discover">
        <span className="media-category-icon"><Film size={21} /></span>
        <span className="eyebrow">LIVE-ACTION · STRICTLY BL</span>
        <h2>BL Live-Action Series</h2>
        <p>
          Explore {liveActionCount ? `${liveActionCount}+ ` : ''}strictly Boys’ Love dramas across Thailand, Korea, Japan, Taiwan &amp; beyond with platform and episode selection.
        </p>
        <span className="media-category-link">Explore live-action <ArrowUpRight size={15} /></span>
      </Link>
      <Link className="media-category-card media-category-anime" to="/anime">
        <span className="media-category-icon"><Tv size={21} /></span>
        <span className="eyebrow">ANILIST · LIVE BROWSING</span>
        <h2>BL Anime</h2>
        <p>Browse strictly Boys’ Love anime with YouTube, Crunchyroll, Bilibili &amp; multi-platform episode redirects.</p>
        <span className="media-category-link">Explore anime <ArrowUpRight size={15} /></span>
      </Link>
      <Link className="media-category-card media-category-manga" to="/manga">
        <span className="media-category-icon"><BookOpen size={21} /></span>
        <span className="eyebrow">ANILIST · LIVE BROWSING</span>
        <h2>BL Manga, Manhwa &amp; Manhua</h2>
        <p>Find strictly BL manga, Korean manhwa, and Chinese manhua with platform and chapter selection.</p>
        <span className="media-category-link">Explore manga <ArrowUpRight size={15} /></span>
      </Link>
    </section>
  );
}

export function MediaLibraryPage({ type }: { type: AniListMediaType }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const [draft, setDraft] = useState(initialQ);
  const [query, setQuery] = useState(initialQ);
  const [sort, setSort] = useState<AniListSort>('POPULARITY_DESC');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [includeAdult, setIncludeAdult] = useState(false);
  const [minimumRank, setMinimumRank] = useState<AniListTagRankFilter>(DEFAULT_MINIMUM_BL_TAG_RANK);
  const [items, setItems] = useState<MediaTitle[]>([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const paramQ = searchParams.get('q') ?? '';
    setDraft(paramQ);
    setQuery(paramQ);
  }, [searchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = draft.trim();
      setQuery(trimmed);
      const next = new URLSearchParams(searchParams);
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      setSearchParams(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setItems([]);
    setPage(1);
    fetchMediaPage(
      type,
      1,
      sort,
      query,
      controller.signal,
      includeAdult,
      minimumRank,
      {
        status: statusFilter === 'all' ? undefined : statusFilter,
        format: formatFilter === 'all' ? undefined : formatFilter,
        countryOfOrigin: countryFilter === 'all' ? undefined : countryFilter,
      },
    ).then((result: MediaPageResponse) => {
      setItems(result.items);
      setPage(result.page);
      setHasNextPage(result.hasNextPage);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'The AniList catalog could not be loaded.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [type, sort, query, includeAdult, minimumRank, statusFilter, formatFilter, countryFilter, retryVersion]);

  async function loadMore() {
    if (loadingMore || !hasNextPage) return;
    setLoadingMore(true);
    setError('');
    try {
      const next = await fetchMediaPage(
        type,
        page + 1,
        sort,
        query,
        undefined,
        includeAdult,
        minimumRank,
        {
          status: statusFilter === 'all' ? undefined : statusFilter,
          format: formatFilter === 'all' ? undefined : formatFilter,
          countryOfOrigin: countryFilter === 'all' ? undefined : countryFilter,
        },
      );
      setItems((current) => [...current, ...next.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setPage(next.page);
      setHasNextPage(next.hasNextPage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The next page could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  }

  const availablePlatforms = useMemo(() => {
    const sites = new Set<string>();
    for (const item of items) {
      for (const link of item.streamingLinks) sites.add(link.site);
    }
    return Array.from(sites).sort();
  }, [items]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const item of items) {
      if (typeof item.startYear === 'number') years.add(item.startYear);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesPlatform = platformFilter === 'all' || item.streamingLinks.some((l) => l.site === platformFilter);
      const matchesYear = yearFilter === 'all' || String(item.startYear ?? '') === yearFilter;
      return matchesPlatform && matchesYear;
    });
  }, [items, platformFilter, yearFilter]);

  function clearAllFilters() {
    setDraft('');
    setQuery('');
    setSort('POPULARITY_DESC');
    setStatusFilter('all');
    setFormatFilter('all');
    setCountryFilter('all');
    setPlatformFilter('all');
    setYearFilter('all');
    setMinimumRank(DEFAULT_MINIMUM_BL_TAG_RANK);
  }

  function changeSort(event: ChangeEvent<HTMLSelectElement>) {
    setSort(event.target.value as AniListSort);
  }

  function changeMinimumRank(event: ChangeEvent<HTMLSelectElement>) {
    setMinimumRank(event.target.value === String(ALL_ANI_LIST_TAG_RANKS) ? ALL_ANI_LIST_TAG_RANKS : DEFAULT_MINIMUM_BL_TAG_RANK);
  }

  return (
    <div className="media-library page-content">
      <header className="media-library-heading">
        <div className="eyebrow"><span className="live-indicator"><i /></span> ANILIST · STRICTLY BOYS’ LOVE</div>
        <h1>{headingFor(type)}<span> discovery.</span></h1>
        <p>Browse strictly Boys’ Love {type === 'ANIME' ? 'anime' : 'manga, manhwa and manhua'} with full filters and selectable streaming or reading platforms.</p>
        <div className="media-attribution">Titles and cover art are supplied by AniList. Straight/heterosexual titles are automatically excluded.</div>
      </header>

      <div className="filters-panel">
        <div className="filter-search">
          <Filter size={17} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Search BL ${type === 'ANIME' ? 'anime' : 'manga, manhwa & manhua'} titles…`}
            aria-label={`Search ${type === 'ANIME' ? 'anime' : 'manga'} titles`}
          />
        </div>
        <div className="filter-selects">
          <label>
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="RELEASING">{type === 'ANIME' ? 'Airing now' : 'Releasing now'}</option>
              <option value="FINISHED">Completed</option>
              <option value="NOT_YET_RELEASED">Coming soon</option>
            </select>
          </label>
          <label>
            <span>Format</span>
            <select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)}>
              <option value="all">All formats</option>
              {type === 'ANIME' ? (
                <>
                  <option value="TV">TV Series</option>
                  <option value="MOVIE">Movie</option>
                  <option value="ONA">ONA (Web Anime)</option>
                  <option value="OVA">OVA</option>
                </>
              ) : (
                <>
                  <option value="MANGA">Manga / Manhwa / Manhua</option>
                  <option value="NOVEL">BL Light Novel</option>
                  <option value="ONE_SHOT">One-Shot</option>
                </>
              )}
            </select>
          </label>
          <label>
            <span>Country / Origin</span>
            <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}>
              <option value="all">All origins</option>
              <option value="JP">Japan ({type === 'ANIME' ? 'Anime' : 'Manga'})</option>
              <option value="KR">South Korea ({type === 'ANIME' ? 'Korean Animation' : 'BL Manhwa'})</option>
              <option value="CN">China ({type === 'ANIME' ? 'Danmei Donghua' : 'BL Manhua'})</option>
              <option value="TW">Taiwan</option>
            </select>
          </label>
          <label>
            <span>Platform</span>
            <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
              <option value="all">All platforms</option>
              {availablePlatforms.map((pf) => (
                <option key={pf} value={pf}>{pf}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Year</span>
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
              <option value="all">All years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={String(yr)}>{yr}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={changeSort}>
              <option value="POPULARITY_DESC">Popular</option>
              <option value="SCORE_DESC">Highest score</option>
              <option value="START_DATE_DESC">Newest first</option>
              <option value="START_DATE">Oldest first</option>
            </select>
          </label>
        </div>
      </div>

      <div className="media-filter-row">
        <label className="media-mature-toggle"><input type="checkbox" checked={includeAdult} onChange={(event) => setIncludeAdult(event.target.checked)} /><span>Include mature BL titles</span><small>Off by default · mature results are labeled</small></label>
        <label className="media-rank-filter"><span>BL tag strictness</span><select value={minimumRank} onChange={changeMinimumRank} aria-label="Choose a minimum AniList Boys’ Love tag rank"><option value={DEFAULT_MINIMUM_BL_TAG_RANK}>Rank 75+ · Strict Core BL</option><option value={ALL_ANI_LIST_TAG_RANKS}>Rank 60+ · Extended BL</option></select><small>Heterosexual &amp; non-BL titles are excluded.</small></label>
      </div>

      <div className="results-line">
        <div>
          <strong>{loading ? 'Checking AniList…' : `${filteredItems.length.toLocaleString()}`}</strong> {filteredItems.length === 1 ? 'BL title' : 'BL titles'}
          <span> · </span>
          <span>Page {page} · Strictly BL filtered</span>
        </div>
        <button className="clear-filters" onClick={clearAllFilters}>Clear filters</button>
      </div>

      {error && <div className="media-alert" role="alert"><CircleAlert size={17} /><span>{error}</span><button type="button" onClick={() => setRetryVersion((version) => version + 1)}>Retry</button></div>}
      {loading && items.length === 0 && <div className="media-loading"><LoaderCircle className="spin" size={24} /><span>Finding strictly BL titles…</span></div>}
      {!loading && !error && filteredItems.length === 0 && <div className="media-empty"><Filter size={22} /><h2>No BL titles match these filters.</h2><p>Try clearing one of the filters or loading more pages from AniList.</p><button className="button button-secondary" onClick={clearAllFilters}>Reset filters</button></div>}

      {filteredItems.length > 0 && <div className="media-grid">{filteredItems.map((item) => <MediaCard item={item} key={item.id} />)}</div>}
      {hasNextPage && <div className="media-more-wrap"><button className="button button-secondary media-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="spin" size={16} /> : null}{loadingMore ? 'Loading more' : 'Load more BL titles'}</button></div>}
      <div className="media-source-footnote">Filtered strictly to <strong>Boys’ Love</strong> titles with heterosexual/non-BL tags excluded. Select your preferred platform and episode/chapter on any title page.</div>
    </div>
  );
}

function EpisodeAndChapterPicker({ item }: { item: MediaTitle }) {
  const isAnime = item.type === 'ANIME';
  const uniquePlatforms: StreamingLink[] = useMemo(() => {
    const map = new Map<string, StreamingLink>();
    for (const link of item.streamingLinks) {
      const key = link.site.toLowerCase();
      if (!map.has(key)) map.set(key, link);
    }
    return Array.from(map.values());
  }, [item.streamingLinks]);

  const defaultPlatform = useMemo(() => {
    return uniquePlatforms[0]?.site ?? '';
  }, [uniquePlatforms]);

  const [selectedPlatform, setSelectedPlatform] = useState(defaultPlatform);
  const [number, setNumber] = useState(1);

  // Only reset episode/chapter number when navigating to a different title ID
  useEffect(() => {
    setSelectedPlatform(defaultPlatform);
    setNumber(1);
  }, [item.id, defaultPlatform]);

  // Ensure selectedPlatform stays valid if uniquePlatforms updates for the same item
  useEffect(() => {
    if (!uniquePlatforms.some((p) => p.site === selectedPlatform)) {
      setSelectedPlatform(defaultPlatform);
    }
  }, [uniquePlatforms, defaultPlatform, selectedPlatform]);

  const seasons = item.seasons && item.seasons.length >= 2 ? item.seasons : undefined;
  const currentSeasonObj = seasons?.find((s) => s.id === item.id) ?? seasons?.[0];

  const rawMax = isAnime ? item.episodes : item.chapters;
  const maxNumber = rawMax && rawMax > 0 ? rawMax : Math.max(item.streamingEpisodes.length, isAnime ? 12 : 30);
  const dropdownTotal = Math.min(Math.max(maxNumber, 1), 200);

  const activePlatformObj = uniquePlatforms.find((p) => p.site === selectedPlatform) ?? uniquePlatforms[0];

  if (uniquePlatforms.length === 0) {
    return (
      <section className="episode-panel" aria-labelledby="episode-panel-title">
        <div className="episode-panel-heading">
          <div>
            <div className="eyebrow">STRICT PLATFORM VERIFICATION</div>
            <h2 id="episode-panel-title">
              No verified {isAnime ? 'streaming' : 'digital reading'} platform is currently listed for this title.
            </h2>
          </div>
          <span className="episode-source-badge">0 verified platforms</span>
        </div>
        <div className="episode-search-block">
          <p style={{ marginTop: 0, marginBottom: '14px' }}>
            BL Pulse only lists platforms after verifying that the title genuinely streams or is readable on that service. Check the official AniList entry for licensing updates or physical editions.
          </p>
          <a className="button button-secondary" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
            Check official AniList page <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
    );
  }

  function getEpisodeUrlFor(epNumber: number, platformName: string, basePlatformUrl?: string): string {
    const platformEps = item.streamingEpisodes.filter(
      (ep) => ep.site && ep.site.toLowerCase() === platformName.toLowerCase(),
    );
    const matchingDirectEp =
      platformEps.find((ep) => {
        const numMatch =
          ep.title.match(/(?:episode|ep\.?|ch\.?|chapter|#)\s*0*(\d+)\b/i) ??
          ep.title.match(/^0*(\d+)\b/);
        return numMatch ? Number(numMatch[1]) === epNumber : false;
      }) ?? platformEps[epNumber - 1];

    return resolvePlatformEpisodeUrl(
      platformName,
      basePlatformUrl,
      item.displayTitle,
      epNumber,
      isAnime ? 'anime' : 'manga',
      matchingDirectEp?.url,
      currentSeasonObj?.seasonNumber,
      currentSeasonObj?.title,
    );
  }

  const currentRedirectUrl = getEpisodeUrlFor(number, selectedPlatform, activePlatformObj?.url);

  return (
    <section className="episode-panel" aria-labelledby="episode-panel-title">
      <div className="episode-panel-heading">
        <div>
          <div className="eyebrow">
            {isAnime
              ? `VERIFIED PLATFORM${seasons ? ', SEASON' : ''} & EPISODE SELECTOR`
              : `VERIFIED PLATFORM${seasons ? ', SEASON' : ''} & CHAPTER SELECTOR`}
          </div>
          <h2 id="episode-panel-title">
            {isAnime
              ? `Select verified platform${seasons ? ', season,' : ''} and episode to watch.`
              : `Select verified platform${seasons ? ', season,' : ''} and chapter to read.`}
          </h2>
        </div>
        <span className="episode-source-badge">
          {uniquePlatforms.length} {uniquePlatforms.length === 1 ? 'verified platform' : 'verified platforms'}
          {seasons ? ` · ${seasons.length} seasons` : ''}
          {' · '}
          {rawMax ? `${rawMax} ${isAnime ? 'episodes' : 'chapters'}` : `${dropdownTotal} ${isAnime ? 'episodes' : 'chapters'}`}
        </span>
      </div>

      <div className="episode-search-block">
        {/* Step 1: Verified Available Platforms */}
        <div style={{ marginBottom: '18px' }}>
          <label className="episode-select-label" htmlFor="platform-select" style={{ display: 'block', marginBottom: '8px' }}>
            1. Select Verified Platform ({uniquePlatforms.length} verified for this {isAnime ? 'anime' : 'manga'})
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
            {uniquePlatforms.map((pf) => {
              const active = pf.site === selectedPlatform;
              return (
                <button
                  key={pf.site}
                  type="button"
                  onClick={() => setSelectedPlatform(pf.site)}
                  style={{
                    padding: '8px 15px',
                    borderRadius: '10px',
                    border: active ? '1px solid rgba(199, 146, 255, 0.85)' : '1px solid rgba(255,255,255,0.14)',
                    background: active ? 'linear-gradient(135deg, rgba(155, 92, 255, 0.34), rgba(112, 66, 212, 0.28))' : 'rgba(255,255,255,0.05)',
                    color: active ? '#fff' : 'rgba(246, 241, 255, 0.82)',
                    fontSize: '0.85rem',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {pf.site}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conditional Step: Season Selector ONLY if 2 or more seasons exist */}
        {seasons && seasons.length >= 2 && (
          <div style={{ marginBottom: '18px' }}>
            <label className="episode-select-label" style={{ display: 'block', marginBottom: '8px' }}>
              2. Select Season ({seasons.length} Seasons Available)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {seasons.map((season) => {
                const isCurrentSeason = season.id === item.id;
                return (
                  <Link
                    key={season.id}
                    to={`${browsePath(item.type)}/${season.id}`}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '10px',
                      border: isCurrentSeason ? '1px solid rgba(199, 146, 255, 0.85)' : '1px solid rgba(255,255,255,0.14)',
                      background: isCurrentSeason ? 'rgba(155, 92, 255, 0.28)' : 'rgba(255,255,255,0.05)',
                      color: isCurrentSeason ? '#fff' : 'rgba(246, 241, 255, 0.82)',
                      fontSize: '0.84rem',
                      fontWeight: isCurrentSeason ? 700 : 500,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>Season {season.seasonNumber}: {season.title}</span>
                    {season.startYear ? <small style={{ opacity: 0.75 }}>({season.startYear})</small> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Episode / Chapter Selector */}
        <label className="episode-select-label" htmlFor="chapter-episode-select">
          {seasons ? '3.' : '2.'} Select {isAnime ? 'Episode' : 'Chapter'} (1 to {dropdownTotal}) &amp; Open on {selectedPlatform}
        </label>
        <div className="episode-control-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
          <select
            id="platform-select"
            aria-label="Select platform"
            value={selectedPlatform}
            onChange={(event) => setSelectedPlatform(event.target.value)}
            style={{ minWidth: '170px' }}
          >
            {uniquePlatforms.map((pf) => (
              <option key={pf.site} value={pf.site}>
                Platform: {pf.site}
              </option>
            ))}
          </select>

          <select
            id="chapter-episode-select"
            aria-label={isAnime ? 'Select episode' : 'Select chapter'}
            value={number}
            onChange={(event) => setNumber(Number(event.target.value))}
            style={{ minWidth: '170px' }}
          >
            {Array.from({ length: dropdownTotal }, (_, idx) => idx + 1).map((num) => (
              <option key={num} value={num}>
                {isAnime ? `Episode ${num}` : `Chapter ${num}`}
              </option>
            ))}
          </select>

          <a className="button button-primary" href={currentRedirectUrl} target="_blank" rel="noopener noreferrer">
            {isAnime
              ? `Watch ${seasons && currentSeasonObj ? `S${currentSeasonObj.seasonNumber} ` : ''}Episode ${number} on ${selectedPlatform}`
              : `Read Chapter ${number} on ${selectedPlatform}`}{' '}
            <ArrowUpRight size={15} />
          </a>

          {activePlatformObj?.url && (
            <a className="button button-secondary" href={activePlatformObj.url} target="_blank" rel="noopener noreferrer">
              Direct {selectedPlatform} URL <ArrowUpRight size={15} />
            </a>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px', marginBottom: '12px' }}>
          {Array.from({ length: Math.min(dropdownTotal, 36) }, (_, idx) => idx + 1).map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => setNumber(num)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: num === number ? '1px solid rgba(199, 146, 255, 0.7)' : '1px solid rgba(255,255,255,0.12)',
                background: num === number ? 'rgba(155, 92, 255, 0.22)' : 'rgba(255,255,255,0.04)',
                color: num === number ? '#fff' : 'rgba(246, 241, 255, 0.78)',
                fontSize: '0.82rem',
                fontWeight: num === number ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {isAnime ? `Ep ${num}` : `Ch ${num}`}
            </button>
          ))}
        </div>

        <p style={{ margin: 0 }}>
          Ready to open: <strong>{item.displayTitle}</strong>
          {seasons && currentSeasonObj ? <> · <strong>Season {currentSeasonObj.seasonNumber}</strong></> : null}
          {' — '}
          <strong>{isAnime ? `Episode ${number}` : `Chapter ${number}`}</strong> on <strong>{selectedPlatform}</strong>.
        </p>
      </div>
    </section>
  );
}

export function MediaDetailPage({ type }: { type: AniListMediaType }) {
  const { id = '' } = useParams();
  const location = useLocation();
  const includeAdult = new URLSearchParams(location.search).get('mature') === '1';
  const minimumRank: AniListTagRankFilter = new URLSearchParams(location.search).get('tagRank') === 'all'
    ? ALL_ANI_LIST_TAG_RANKS
    : DEFAULT_MINIMUM_BL_TAG_RANK;
  const numericId = Number(id);
  const [item, setItem] = useState<MediaTitle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setItem(null);
    setError('');
    setLoading(true);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      setError('This title is not available in the AniList catalog.');
      setLoading(false);
      return () => controller.abort();
    }
    fetchMediaTitle(type, numericId, includeAdult, minimumRank, controller.signal).then((nextItem) => {
      if (!controller.signal.aborted) setItem(nextItem);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This title could not be loaded.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [type, numericId, includeAdult, minimumRank]);

  useEffect(() => {
    applyPageMetadata(metadataForPath(location.pathname, undefined, item ?? undefined).metadata);
  }, [location.pathname, item?.id, item?.displayTitle, item?.description]);

  if (loading) return <div className="media-loading page-content"><LoaderCircle className="spin" size={24} /><span>Opening AniList title details…</span></div>;
  if (!item) return <div className="detail-missing page-content"><div className="empty-mark"><CircleAlert size={22} /></div><h1>{error || 'Title not found.'}</h1><Link className="button button-secondary" to={browsePath(type)}>Browse {headingFor(type)} <ArrowLeft size={16} /></Link></div>;

  const seasons = item.seasons && item.seasons.length >= 2 ? item.seasons : undefined;

  return (
    <div className="media-detail page-content">
      <Link className="back-link" to={browsePath(type)}><ArrowLeft size={16} /> Back to {headingFor(type)}</Link>
      <section className="media-detail-hero">
        {item.bannerImage && <img className="media-detail-banner" src={item.bannerImage} alt="" />}
        <div className="media-detail-poster">{item.coverImage ? <img src={item.coverImage} alt={`${item.displayTitle} cover`} /> : <BookOpen size={34} />}</div>
        <div className="media-detail-copy">
          <div className="eyebrow">ANILIST · {item.type === 'ANIME' ? 'BL ANIME' : 'BL MANGA'} · BL TAG RANK {item.boysLoveRank ?? '—'}</div>
          <h1 title={item.displayTitle}>{boundedHeading(item.displayTitle)}</h1>
          <div className="media-detail-facts">
            {[
              item.countryOfOrigin ? (COUNTRY_LABELS[item.countryOfOrigin] ?? item.countryOfOrigin) : null,
              item.format,
              item.startYear,
              item.status?.replaceAll('_', ' '),
              seasons ? `${seasons.length} Seasons` : null,
              item.type === 'ANIME' && item.episodes ? `${item.episodes} episodes` : null,
              item.type === 'MANGA' && item.chapters ? `${item.chapters} chapters` : null,
              item.isAdult ? 'Mature content · AniList' : 'Strictly BL · AniList',
            ].filter(Boolean).map((fact) => <span key={String(fact)}>{fact}</span>)}
          </div>
          <p>{item.description || 'AniList has not provided a synopsis for this title.'}</p>
          <div className="detail-actions">
            <a className="button button-secondary" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
              AniList source page <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </section>
      <EpisodeAndChapterPicker item={item} key={item.id} />
    </div>
  );
}

