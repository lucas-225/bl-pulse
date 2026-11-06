import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  ExternalLink,
  LoaderCircle,
  Lock,
  Megaphone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import type {
  CatalogResponse,
  MarketSyncResult,
  MonetizationConfig,
  PlatformLink,
  RedirectAnalyticsSummary,
  Series,
  SeriesStatus,
} from '../shared/types';
import {
  autoFillSeries,
  deleteAdminSeries,
  fetchAdminAnalytics,
  saveAdminSeries,
  saveMonetizationConfig,
  triggerMarketAutoSync,
  verifyAdminPassword,
} from './api';

const STORAGE_KEY = 'bl_pulse_admin_pw';

const DEFAULT_MONETIZATION: MonetizationConfig = {
  enableAds: false,
  adsenseClientId: '',
  headerAdSlot: '',
  inFeedAdSlot: '',
  detailAdSlot: '',
  affiliates: {
    gagaoolalaRef: 'blpulse',
    vikiAffiliateId: 'blpulse',
    iqiyiAffiliateId: 'blpulse',
    wetvAffiliateId: 'blpulse',
    crunchyrollAffiliateId: 'blpulse',
    tapasRef: 'blpulse',
    lezhinRef: 'blpulse',
    tappytoonRef: 'blpulse',
    mantaRef: 'blpulse',
    bookwalkerRef: 'blpulse',
  },
  sponsoredBanner: {
    enabled: true,
    badge: 'FEATURED PREMIERE SPOTLIGHT',
    eyebrow: 'OFFICIAL STUDIO PARTNER SHOWCASE',
    title: 'Revamp: The Undead Story',
    synopsis:
      'An antique shop owner with the rare gift to mend broken heirlooms accidentally awakens a centuries-old vampire heir—and must help him reclaim his lost powers.',
    studio: 'GMMTV · Thailand',
    country: 'Thailand',
    ctaLabel: 'Explore Premiere & Platforms',
    ctaUrl: '/series/tmdb-254102',
    coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/547/1369725.jpg',
  },
};

export function AdminPage({
  catalog,
  onCatalogUpdated,
}: {
  catalog: CatalogResponse;
  onCatalogUpdated: (next: CatalogResponse) => void;
}) {
  const [passwordInput, setPasswordInput] = useState(() => sessionStorage.getItem(STORAGE_KEY) ?? '');
  const [authenticatedPw, setAuthenticatedPw] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState<'catalog' | 'monetization' | 'analytics'>('catalog');
  const [dbReady, setDbReady] = useState(false);
  const [analytics, setAnalytics] = useState<RedirectAnalyticsSummary | null>(null);
  const [monetization, setMonetization] = useState<MonetizationConfig>(
    catalog.monetization ?? DEFAULT_MONETIZATION,
  );

  // Market Auto-Sync state
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<MarketSyncResult | null>(null);
  const [bannerNotice, setBannerNotice] = useState('');

  // Series CRUD & Auto-Fill form state
  const [editingId, setEditingId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [country, setCountry] = useState('Thailand');
  const [status, setStatus] = useState<SeriesStatus>('airing');
  const [year, setYear] = useState<number>(2025);
  const [releaseDate, setReleaseDate] = useState('2025-01-01');
  const [episodes, setEpisodes] = useState<number>(12);
  const [coverUrl, setCoverUrl] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [genresText, setGenresText] = useState('BL, Drama, Romance');
  const [platforms, setPlatforms] = useState<PlatformLink[]>([
    { name: 'YouTube', url: '' },
  ]);
  const [autoFillBusy, setAutoFillBusy] = useState(false);
  const [saveSeriesBusy, setSaveSeriesBusy] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Monetization save state
  const [saveMonetizationBusy, setSaveMonetizationBusy] = useState(false);

  useEffect(() => {
    const savedPw = sessionStorage.getItem(STORAGE_KEY);
    if (savedPw) {
      void handleVerify(savedPw);
    }
  }, []);

  async function handleVerify(pwToUse: string) {
    setAuthBusy(true);
    setAuthError('');
    try {
      const res = await verifyAdminPassword(pwToUse);
      sessionStorage.setItem(STORAGE_KEY, pwToUse);
      setAuthenticatedPw(pwToUse);
      setDbReady(res.databaseReady);
      setAnalytics(res.analytics);
      setMonetization(res.monetization);
    } catch (err) {
      sessionStorage.removeItem(STORAGE_KEY);
      setAuthenticatedPw(null);
      setAuthError(err instanceof Error ? err.message : 'Invalid password.');
    } finally {
      setAuthBusy(false);
    }
  }

  function submitLogin(e: FormEvent) {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    void handleVerify(passwordInput.trim());
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setAuthenticatedPw(null);
    setPasswordInput('');
  }

  async function refreshAnalytics() {
    if (!authenticatedPw) return;
    try {
      const res = await fetchAdminAnalytics(authenticatedPw);
      setDbReady(res.databaseReady);
      setAnalytics(res.analytics);
      setMonetization(res.monetization);
    } catch {
      // Ignore refresh error
    }
  }

  async function handleMarketAutoSync() {
    if (!authenticatedPw || syncBusy) return;
    setSyncBusy(true);
    setBannerNotice('');
    try {
      const res = await triggerMarketAutoSync(authenticatedPw);
      setSyncResult(res);
      onCatalogUpdated(res.catalog);
      setBannerNotice(res.summary);
    } catch (err) {
      setBannerNotice(err instanceof Error ? err.message : 'Market Auto-Sync failed.');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleAutoFill() {
    if (!authenticatedPw || !title.trim() || autoFillBusy) return;
    setAutoFillBusy(true);
    setBannerNotice('');
    try {
      const { metadata } = await autoFillSeries(authenticatedPw, title.trim());
      if (metadata.title) setTitle(metadata.title);
      if (metadata.country) setCountry(metadata.country);
      if (metadata.status) setStatus(metadata.status);
      if (metadata.year) setYear(metadata.year);
      if (metadata.releaseDate) setReleaseDate(metadata.releaseDate);
      if (metadata.episodes) setEpisodes(metadata.episodes);
      if (metadata.coverUrl) setCoverUrl(metadata.coverUrl);
      if (metadata.synopsis) setSynopsis(metadata.synopsis);
      if (metadata.genres && metadata.genres.length > 0) {
        setGenresText(metadata.genres.join(', '));
      }
      if (metadata.platforms && metadata.platforms.length > 0) {
        setPlatforms(metadata.platforms);
      }
      setBannerNotice(`Auto-filled metadata & verified streaming links for "${metadata.title || title}".`);
    } catch (err) {
      setBannerNotice(err instanceof Error ? err.message : 'Auto-Fill lookup failed.');
    } finally {
      setAutoFillBusy(false);
    }
  }

  function resetSeriesForm() {
    setEditingId('');
    setTitle('');
    setCountry('Thailand');
    setStatus('airing');
    setYear(2025);
    setReleaseDate('2025-01-01');
    setEpisodes(12);
    setCoverUrl('');
    setSynopsis('');
    setGenresText('BL, Drama, Romance');
    setPlatforms([{ name: 'YouTube', url: '' }]);
  }

  function loadSeriesIntoForm(s: Series) {
    setEditingId(s.id);
    setTitle(s.title);
    setCountry(s.country);
    setStatus(s.status);
    setYear(s.year ?? 2025);
    setReleaseDate(s.releaseDate ?? `${s.year ?? 2025}-01-01`);
    setEpisodes(s.episodes ?? 12);
    setCoverUrl(s.coverUrl ?? '');
    setSynopsis(s.synopsis ?? '');
    setGenresText(s.genres.join(', '));
    setPlatforms(
      s.platforms.length > 0
        ? s.platforms.map((p) => ({ name: p.name, url: p.url }))
        : [{ name: 'YouTube', url: '' }],
    );
    window.scrollTo({ top: 240, behavior: 'smooth' });
  }

  async function handleSaveSeries(e: FormEvent) {
    e.preventDefault();
    if (!authenticatedPw || !title.trim() || saveSeriesBusy) return;
    setSaveSeriesBusy(true);
    setBannerNotice('');
    try {
      const validPlatforms = platforms
        .filter((p) => p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          url:
            p.url.trim() ||
            `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title.trim()} EP.1 [1/4] Eng Sub`)}`,
        }));

      const genres = genresText
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean);

      const res = await saveAdminSeries(authenticatedPw, {
        id: editingId || undefined,
        title: title.trim(),
        country: country.trim() || 'Thailand',
        status,
        year: Number(year) || 2025,
        releaseDate: releaseDate.trim() || `${year}-01-01`,
        episodes: Number(episodes) || 12,
        coverUrl: coverUrl.trim() || undefined,
        synopsis: synopsis.trim() || undefined,
        genres,
        platforms: validPlatforms,
      });

      onCatalogUpdated(res.catalog);
      setBannerNotice(`Saved "${res.series.title}" to the Live-Action catalog.`);
      resetSeriesForm();
    } catch (err) {
      setBannerNotice(err instanceof Error ? err.message : 'Failed to save series.');
    } finally {
      setSaveSeriesBusy(false);
    }
  }

  async function handleDeleteSeries(s: Series) {
    if (!authenticatedPw) return;
    try {
      const res = await deleteAdminSeries(authenticatedPw, s.id);
      onCatalogUpdated(res.catalog);
      setBannerNotice(`Removed "${s.title}" from the catalog.`);
    } catch (err) {
      setBannerNotice(err instanceof Error ? err.message : 'Failed to delete series.');
    }
  }

  async function handleSaveMonetization(e: FormEvent) {
    e.preventDefault();
    if (!authenticatedPw || saveMonetizationBusy) return;
    setSaveMonetizationBusy(true);
    setBannerNotice('');
    try {
      const res = await saveMonetizationConfig(authenticatedPw, monetization);
      setMonetization(res.monetization);
      onCatalogUpdated(res.catalog);
      setBannerNotice('Monetization, Affiliate IDs, Display Ads, and Sponsored Spotlight settings saved.');
    } catch (err) {
      setBannerNotice(err instanceof Error ? err.message : 'Failed to save monetization config.');
    } finally {
      setSaveMonetizationBusy(false);
    }
  }

  const filteredSeries = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return catalog.series;
    return catalog.series.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q) ||
        s.platforms.some((p) => p.name.toLowerCase().includes(q)),
    );
  }, [catalog.series, searchFilter]);

  if (!authenticatedPw) {
    return (
      <div className="page-content" style={{ maxWidth: '520px', margin: '64px auto' }}>
        <section
          style={{
            padding: '32px',
            borderRadius: '20px',
            background: 'rgba(18, 14, 28, 0.94)',
            border: '1px solid rgba(199, 146, 255, 0.28)',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', color: '#c792ff' }}>
            <Lock size={20} />
            <span className="eyebrow" style={{ margin: 0 }}>BL PULSE · OWNER CONTROL CENTER</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', margin: '0 0 10px' }}>Admin &amp; Monetization Login</h1>
          <p style={{ color: 'rgba(226, 214, 248, 0.76)', fontSize: '0.92rem', lineHeight: 1.55, marginBottom: '20px' }}>
            Public visitors never need to log in. Enter your owner password to access Market Auto-Sync, Series CRUD, Affiliate Monetization, Display Ads, and Click Analytics.
          </p>
          {authError && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'rgba(244, 63, 94, 0.16)',
                border: '1px solid rgba(244, 63, 94, 0.4)',
                color: '#fda4af',
                fontSize: '0.85rem',
                marginBottom: '16px',
              }}
            >
              {authError}
            </div>
          )}
          <form onSubmit={submitLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.84rem', fontWeight: 600 }}>
              <span>Admin Password (default: <code>blpulse2026</code>)</span>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter ADMIN_PASSWORD…"
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(199, 146, 255, 0.3)',
                  background: 'rgba(9, 8, 13, 0.9)',
                  color: '#fff',
                  fontSize: '0.95rem',
                }}
              />
            </label>
            <button type="submit" className="button button-primary" disabled={authBusy} style={{ justifyContent: 'center' }}>
              {authBusy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}
              {authBusy ? 'Verifying…' : 'Unlock Admin Control Panel'}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="page-content" style={{ paddingTop: '28px', paddingBottom: '64px' }}>
      {/* Top Admin Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={15} /> SELF-OWNED PORTAL · COPYRIGHT-SAFE · MONETIZED
          </div>
          <h1 style={{ fontSize: 'clamp(1.7rem, 2.6vw, 2.35rem)', margin: '6px 0' }}>
            BLPulse Owner &amp; Monetization Studio
          </h1>
          <p style={{ margin: 0, color: 'rgba(226, 214, 248, 0.76)', fontSize: '0.93rem' }}>
            AniList powers live BL Anime &amp; Manga automatically · Self-hosted database powers {catalog.series.length} verified BL Live-Action series.
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <a
            href="/api/export"
            download="blpulse-catalog.json"
            className="button button-secondary"
            style={{ fontSize: '0.84rem' }}
          >
            <Download size={15} /> Export JSON Backup
          </a>
          <button type="button" className="button button-secondary" onClick={logout} style={{ fontSize: '0.84rem' }}>
            Lock Admin
          </button>
        </div>
      </div>

      {bannerNotice && (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: '12px',
            background: 'rgba(155, 92, 255, 0.16)',
            border: '1px solid rgba(199, 146, 255, 0.42)',
            color: '#f3e8ff',
            marginBottom: '22px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600 }}>
            <CheckCircle2 size={17} color="#c084fc" /> {bannerNotice}
          </span>
          <button
            type="button"
            onClick={() => setBannerNotice('')}
            style={{ background: 'transparent', border: 0, color: '#fff', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            ×
          </button>
        </div>
      )}

      {/* One-Click Market Auto-Sync Hero Card */}
      <section
        style={{
          padding: '24px 26px',
          borderRadius: '18px',
          background: 'linear-gradient(135deg, rgba(35, 22, 58, 0.94), rgba(17, 13, 28, 0.97))',
          border: '1px solid rgba(199, 146, 255, 0.36)',
          marginBottom: '26px',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        <div style={{ maxWidth: '720px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#e9d5ff', fontSize: '0.76rem', fontWeight: 700, letterSpacing: '0.08em' }}>
            <WandSparkles size={15} /> ONE-CLICK MARKET AUTO-SYNC ENGINE
          </div>
          <h2 style={{ margin: '6px 0 8px', fontSize: '1.35rem' }}>
            Discover &amp; Sync Newly Announced and Airing BL Live-Action Dramas
          </h2>
          <p style={{ margin: 0, color: 'rgba(226, 214, 248, 0.8)', fontSize: '0.88rem', lineHeight: 1.55 }}>
            Scans the 2025–2026 BL drama market (GMMTV, Mandee, IdolFactory, iQIYI, Viki, GagaOOLala, WeTV) with Gemini Search Grounding + TVMaze poster lookup to populate synopses, posters, release years, and verified Episode [1/4] redirect links.
          </p>
          {syncResult && (
            <div style={{ marginTop: '12px', fontSize: '0.82rem', color: '#d8b4fe' }}>
              <strong>Last Sync ({syncResult.sourceUsed}):</strong> Added {syncResult.added.length} new series · Updated {syncResult.updated.length} series · Total {syncResult.totalSeries} Live-Action titles.
            </div>
          )}
        </div>

        <button
          type="button"
          className="button button-primary"
          onClick={() => void handleMarketAutoSync()}
          disabled={syncBusy}
          style={{ padding: '13px 22px', fontSize: '0.92rem' }}
        >
          {syncBusy ? <LoaderCircle size={18} className="spin" /> : <RefreshCw size={18} />}
          {syncBusy ? 'Scanning BL Market & Grounding…' : 'One-Click Market Auto-Sync'}
        </button>
      </section>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '24px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('catalog')}
          className={activeTab === 'catalog' ? 'button button-primary' : 'button button-secondary'}
        >
          <Database size={16} /> Live-Action Catalog &amp; Auto-Fill ({catalog.series.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('monetization')}
          className={activeTab === 'monetization' ? 'button button-primary' : 'button button-secondary'}
        >
          <Megaphone size={16} /> Monetization, Affiliates &amp; Ads
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('analytics');
            void refreshAnalytics();
          }}
          className={activeTab === 'analytics' ? 'button button-primary' : 'button button-secondary'}
        >
          <BarChart3 size={16} /> Redirect &amp; Affiliate Analytics ({analytics?.totalRedirects ?? 0})
        </button>
      </div>

      {/* TAB 1: CATALOG CRUD & 1-CLICK AUTO-FILL */}
      {activeTab === 'catalog' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', alignItems: 'start' }}>
          {/* Add / Edit Series Form */}
          <form
            onSubmit={handleSaveSeries}
            style={{
              padding: '24px',
              borderRadius: '18px',
              background: 'rgba(17, 13, 27, 0.94)',
              border: '1px solid rgba(199, 146, 255, 0.24)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="eyebrow">{editingId ? 'EDIT EXISTING SERIES' : 'ADD NEW LIVE-ACTION SERIES'}</div>
                <h3 style={{ margin: '4px 0 0', fontSize: '1.2rem' }}>
                  {editingId ? `Editing: ${title}` : 'Add / Edit Series + 1-Click Auto-Fill'}
                </h3>
              </div>
              {editingId && (
                <button type="button" className="button button-secondary" onClick={resetSeriesForm} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                  New Series
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
                <span>Series Title *</span>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Gelboys, My Golden Blood, Secret Relationships"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void handleAutoFill()}
                disabled={autoFillBusy || !title.trim()}
                title="Auto-fill synopsis, poster, year, country & platforms using AI + TVMaze"
                style={{ height: '41px', whiteSpace: 'nowrap' }}
              >
                {autoFillBusy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
                {autoFillBusy ? 'Filling…' : '1-Click Auto-Fill'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
                <span>Country</span>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="Thailand, South Korea, Japan, Taiwan"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
                <span>Airing Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SeriesStatus)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                >
                  <option value="airing">Airing now</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
                <span>Release Year</span>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
                <span>Episodes</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={episodes}
                  onChange={(e) => setEpisodes(Number(e.target.value))}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
                <span>Release Date</span>
                <input
                  value={releaseDate}
                  onChange={(e) => setReleaseDate(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
              <span>Cover Poster Image URL (HTTPS)</span>
              <input
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="https://static.tvmaze.com/uploads/images/..."
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(9, 8, 13, 0.9)',
                  color: '#fff',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
              <span>Genre Tags (comma-separated)</span>
              <input
                value={genresText}
                onChange={(e) => setGenresText(e.target.value)}
                placeholder="BL, Romance, Drama, Campus"
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(9, 8, 13, 0.9)',
                  color: '#fff',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.82rem' }}>
              <span>Synopsis</span>
              <textarea
                rows={3}
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                placeholder="Plot synopsis..."
                style={{
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(9, 8, 13, 0.9)',
                  color: '#fff',
                  fontFamily: 'inherit',
                }}
              />
            </label>

            {/* Verified Platforms List */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Verified Streaming Platforms</span>
                <button
                  type="button"
                  onClick={() => setPlatforms([...platforms, { name: 'Viki', url: '' }])}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '8px',
                    border: '1px solid rgba(199, 146, 255, 0.35)',
                    background: 'rgba(155, 92, 255, 0.16)',
                    color: '#e9d5ff',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Plus size={13} /> Add Platform
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {platforms.map((pf, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: '8px' }}>
                    <input
                      value={pf.name}
                      onChange={(e) => {
                        const next = [...platforms];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setPlatforms(next);
                      }}
                      placeholder="YouTube / iQIYI / Viki"
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: 'rgba(9, 8, 13, 0.9)',
                        color: '#fff',
                        fontSize: '0.82rem',
                      }}
                    />
                    <input
                      value={pf.url}
                      onChange={(e) => {
                        const next = [...platforms];
                        next[idx] = { ...next[idx], url: e.target.value };
                        setPlatforms(next);
                      }}
                      placeholder="Official URL (or leave blank for auto EP.1 [1/4])"
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: 'rgba(9, 8, 13, 0.9)',
                        color: '#fff',
                        fontSize: '0.82rem',
                      }}
                    />
                    {platforms.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPlatforms(platforms.filter((_, i) => i !== idx))}
                        style={{
                          padding: '0 10px',
                          borderRadius: '8px',
                          border: '1px solid rgba(244, 63, 94, 0.35)',
                          background: 'rgba(244, 63, 94, 0.14)',
                          color: '#fda4af',
                          cursor: 'pointer',
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button type="submit" className="button button-primary" disabled={saveSeriesBusy} style={{ justifyContent: 'center', marginTop: '6px' }}>
              {saveSeriesBusy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
              {saveSeriesBusy ? 'Saving to Database…' : editingId ? 'Update Series in Catalog' : 'Add Series to Catalog'}
            </button>
          </form>

          {/* Existing Live-Action Catalog Manager */}
          <div
            style={{
              padding: '24px',
              borderRadius: '18px',
              background: 'rgba(17, 13, 27, 0.94)',
              border: '1px solid rgba(199, 146, 255, 0.24)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <div>
                <div className="eyebrow">SELF-HOSTED LIVE-ACTION DATABASE</div>
                <h3 style={{ margin: '4px 0 0', fontSize: '1.15rem' }}>
                  Manage Series ({filteredSeries.length} of {catalog.series.length})
                </h3>
              </div>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: dbReady ? 'rgba(34, 197, 94, 0.16)' : 'rgba(56, 189, 248, 0.16)',
                  color: dbReady ? '#86efac' : '#7dd3fc',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                }}
              >
                {dbReady ? 'TiDB / MySQL Synced' : 'In-Memory High-Speed Cache'}
              </span>
            </div>

            <div className="filter-search" style={{ marginBottom: '14px' }}>
              <Search size={16} />
              <input
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter by title, country, or platform…"
              />
            </div>

            <div style={{ maxHeight: '580px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredSeries.slice(0, 80).map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'rgba(226, 214, 248, 0.68)', marginTop: '2px' }}>
                      {item.country} · {item.year ?? '—'} · {item.status.toUpperCase()} · {item.platforms.map((p) => p.name).join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => loadSeriesIntoForm(item)}
                      title="Edit series"
                      style={{
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: '1px solid rgba(199, 146, 255, 0.3)',
                        background: 'rgba(155, 92, 255, 0.15)',
                        color: '#e9d5ff',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.75rem',
                      }}
                    >
                      <Edit3 size={13} /> Edit
                    </button>
                    <Link
                      to={`/series/${encodeURIComponent(item.id)}`}
                      title="View series page"
                      style={{
                        padding: '6px 9px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.14)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#fff',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      <ExternalLink size={13} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSeries(item)}
                      title="Delete series"
                      style={{
                        padding: '6px 9px',
                        borderRadius: '8px',
                        border: '1px solid rgba(244, 63, 94, 0.3)',
                        background: 'rgba(244, 63, 94, 0.12)',
                        color: '#fda4af',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MONETIZATION, AFFILIATES & DISPLAY ADS */}
      {activeTab === 'monetization' && (
        <form
          onSubmit={handleSaveMonetization}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: '24px',
            alignItems: 'start',
          }}
        >
          {/* Column 1: Affiliate Partner IDs */}
          <div
            style={{
              padding: '24px',
              borderRadius: '18px',
              background: 'rgba(17, 13, 27, 0.94)',
              border: '1px solid rgba(199, 146, 255, 0.24)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div>
              <div className="eyebrow">STREAMING &amp; READING AFFILIATE TAGS</div>
              <h3 style={{ margin: '4px 0 6px', fontSize: '1.2rem' }}>Official Partner Referral IDs</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'rgba(226, 214, 248, 0.72)' }}>
                Automatically appended to every 302 redirect when users click to watch or read on licensed platforms.
              </p>
            </div>

            {(
              [
                ['gagaoolalaRef', 'GagaOOLala Referral Code (GAGAOOLALA_REF)'],
                ['vikiAffiliateId', 'Rakuten Viki Affiliate ID (VIKI_AFFILIATE_ID)'],
                ['iqiyiAffiliateId', 'iQIYI Partner ID (IQIYI_AFFILIATE_ID)'],
                ['wetvAffiliateId', 'WeTV / Tencent Referral ID (WETV_AFFILIATE_ID)'],
                ['crunchyrollAffiliateId', 'Crunchyroll Affiliate ID (CRUNCHYROLL_AFFILIATE_ID)'],
                ['tapasRef', 'Tapas Comics Referral ID (TAPAS_REF)'],
                ['lezhinRef', 'Lezhin Comics Referral ID (LEZHIN_REF)'],
                ['tappytoonRef', 'Tappytoon Partner ID (TAPPYTOON_REF)'],
                ['mantaRef', 'Manta Comics Referral ID (MANTA_REF)'],
                ['bookwalkerRef', 'BookWalker Affiliate Code (BOOKWALKER_REF)'],
              ] as const
            ).map(([fieldKey, label]) => (
              <label key={fieldKey} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                <span>{label}</span>
                <input
                  value={monetization.affiliates[fieldKey]}
                  onChange={(e) =>
                    setMonetization({
                      ...monetization,
                      affiliates: {
                        ...monetization.affiliates,
                        [fieldKey]: e.target.value,
                      },
                    })
                  }
                  placeholder="e.g., blpulse"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '9px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>
            ))}
          </div>

          {/* Column 2: Display Ads & Sponsored Drama Spotlight */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div
              style={{
                padding: '24px',
                borderRadius: '18px',
                background: 'rgba(17, 13, 27, 0.94)',
                border: '1px solid rgba(199, 146, 255, 0.24)',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
              }}
            >
              <div>
                <div className="eyebrow">DISPLAY AD NETWORKS (ADSENSE &amp; NATIVE)</div>
                <h3 style={{ margin: '4px 0 6px', fontSize: '1.2rem' }}>Responsive Ad Banner Placements</h3>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={monetization.enableAds}
                  onChange={(e) => setMonetization({ ...monetization, enableAds: e.target.checked })}
                />
                <span>Enable Display Ad Units (Header, In-Feed &amp; Below-Episode)</span>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                <span>Google AdSense Publisher ID (Optional)</span>
                <input
                  value={monetization.adsenseClientId}
                  onChange={(e) => setMonetization({ ...monetization, adsenseClientId: e.target.value })}
                  placeholder="ca-pub-XXXXXXXXXXXXXXXX"
                  style={{
                    padding: '9px 12px',
                    borderRadius: '9px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem' }}>
                  <span>Header Slot ID</span>
                  <input
                    value={monetization.headerAdSlot}
                    onChange={(e) => setMonetization({ ...monetization, headerAdSlot: e.target.value })}
                    placeholder="Slot #1"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(9, 8, 13, 0.9)',
                      color: '#fff',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem' }}>
                  <span>In-Feed Slot ID</span>
                  <input
                    value={monetization.inFeedAdSlot}
                    onChange={(e) => setMonetization({ ...monetization, inFeedAdSlot: e.target.value })}
                    placeholder="Slot #2"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(9, 8, 13, 0.9)',
                      color: '#fff',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.78rem' }}>
                  <span>Detail Slot ID</span>
                  <input
                    value={monetization.detailAdSlot}
                    onChange={(e) => setMonetization({ ...monetization, detailAdSlot: e.target.value })}
                    placeholder="Slot #3"
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(9, 8, 13, 0.9)',
                      color: '#fff',
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Sponsored Drama Spotlight Config */}
            <div
              style={{
                padding: '24px',
                borderRadius: '18px',
                background: 'rgba(17, 13, 27, 0.94)',
                border: '1px solid rgba(199, 146, 255, 0.24)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div>
                <div className="eyebrow">SPONSORED DRAMA SPOTLIGHT</div>
                <h3 style={{ margin: '4px 0 6px', fontSize: '1.2rem' }}>Homepage Featured Premiere Banner</h3>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={monetization.sponsoredBanner.enabled}
                  onChange={(e) =>
                    setMonetization({
                      ...monetization,
                      sponsoredBanner: { ...monetization.sponsoredBanner, enabled: e.target.checked },
                    })
                  }
                />
                <span>Display Sponsored Premiere Banner on Homepage</span>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                  <span>Featured Title</span>
                  <input
                    value={monetization.sponsoredBanner.title}
                    onChange={(e) =>
                      setMonetization({
                        ...monetization,
                        sponsoredBanner: { ...monetization.sponsoredBanner, title: e.target.value },
                      })
                    }
                    style={{
                      padding: '9px 12px',
                      borderRadius: '9px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(9, 8, 13, 0.9)',
                      color: '#fff',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                  <span>Studio / Partner Label</span>
                  <input
                    value={monetization.sponsoredBanner.studio}
                    onChange={(e) =>
                      setMonetization({
                        ...monetization,
                        sponsoredBanner: { ...monetization.sponsoredBanner, studio: e.target.value },
                      })
                    }
                    style={{
                      padding: '9px 12px',
                      borderRadius: '9px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(9, 8, 13, 0.9)',
                      color: '#fff',
                    }}
                  />
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                <span>Spotlight Synopsis</span>
                <textarea
                  rows={2}
                  value={monetization.sponsoredBanner.synopsis}
                  onChange={(e) =>
                    setMonetization({
                      ...monetization,
                      sponsoredBanner: { ...monetization.sponsoredBanner, synopsis: e.target.value },
                    })
                  }
                  style={{
                    padding: '9px 12px',
                    borderRadius: '9px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                    fontFamily: 'inherit',
                  }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                  <span>CTA Button Label</span>
                  <input
                    value={monetization.sponsoredBanner.ctaLabel}
                    onChange={(e) =>
                      setMonetization({
                        ...monetization,
                        sponsoredBanner: { ...monetization.sponsoredBanner, ctaLabel: e.target.value },
                      })
                    }
                    style={{
                      padding: '9px 12px',
                      borderRadius: '9px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(9, 8, 13, 0.9)',
                      color: '#fff',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                  <span>Target URL or /series/:id</span>
                  <input
                    value={monetization.sponsoredBanner.ctaUrl}
                    onChange={(e) =>
                      setMonetization({
                        ...monetization,
                        sponsoredBanner: { ...monetization.sponsoredBanner, ctaUrl: e.target.value },
                      })
                    }
                    style={{
                      padding: '9px 12px',
                      borderRadius: '9px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(9, 8, 13, 0.9)',
                      color: '#fff',
                    }}
                  />
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
                <span>Poster Image URL</span>
                <input
                  value={monetization.sponsoredBanner.coverUrl}
                  onChange={(e) =>
                    setMonetization({
                      ...monetization,
                      sponsoredBanner: { ...monetization.sponsoredBanner, coverUrl: e.target.value },
                    })
                  }
                  style={{
                    padding: '9px 12px',
                    borderRadius: '9px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(9, 8, 13, 0.9)',
                    color: '#fff',
                  }}
                />
              </label>

              <button type="submit" className="button button-primary" disabled={saveMonetizationBusy} style={{ justifyContent: 'center', marginTop: '6px' }}>
                {saveMonetizationBusy ? <LoaderCircle size={16} className="spin" /> : <CheckCircle2 size={16} />}
                {saveMonetizationBusy ? 'Saving Monetization Settings…' : 'Save All Monetization & Ad Settings'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 3: REDIRECT & AFFILIATE ANALYTICS */}
      {activeTab === 'analytics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* KPI Summary Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(17, 13, 27, 0.94)', border: '1px solid rgba(199, 146, 255, 0.24)' }}>
              <div className="eyebrow">TOTAL 302 REDIRECTS</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '6px' }}>
                {analytics?.totalRedirects.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'rgba(226, 214, 248, 0.68)', marginTop: '4px' }}>
                Outbound watch &amp; read clicks
              </div>
            </div>

            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(17, 13, 27, 0.94)', border: '1px solid rgba(199, 146, 255, 0.24)' }}>
              <div className="eyebrow">AFFILIATE-TAGGED CLICKS</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '6px', color: '#c084fc' }}>
                {analytics?.affiliateClicks.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'rgba(226, 214, 248, 0.68)', marginTop: '4px' }}>
                Monetized partner referrals
              </div>
            </div>

            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(17, 13, 27, 0.94)', border: '1px solid rgba(199, 146, 255, 0.24)' }}>
              <div className="eyebrow">BY MEDIA CATEGORY</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, marginTop: '10px', lineHeight: 1.6 }}>
                Live-Action: {analytics?.byCategory.series ?? 0} · Anime: {analytics?.byCategory.anime ?? 0} · Manga: {analytics?.byCategory.manga ?? 0}
              </div>
            </div>

            <div style={{ padding: '20px', borderRadius: '16px', background: 'rgba(17, 13, 27, 0.94)', border: '1px solid rgba(199, 146, 255, 0.24)' }}>
              <div className="eyebrow">SELF-HOSTED CATALOG</div>
              <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '6px', color: '#86efac' }}>
                {catalog.series.length}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'rgba(226, 214, 248, 0.68)', marginTop: '4px' }}>
                Verified Live-Action dramas + 92 YouTube Anime
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
            {/* Top Streaming & Reading Platforms */}
            <div style={{ padding: '22px', borderRadius: '18px', background: 'rgba(17, 13, 27, 0.94)', border: '1px solid rgba(199, 146, 255, 0.24)' }}>
              <div className="eyebrow">PLATFORM DEMAND</div>
              <h3 style={{ margin: '4px 0 14px', fontSize: '1.15rem' }}>Clicks by Official Platform</h3>
              {analytics && Object.keys(analytics.byPlatform).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {Object.entries(analytics.byPlatform)
                    .sort((a, b) => b[1] - a[1])
                    .map(([pfName, count]) => (
                      <div key={pfName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)' }}>
                        <span style={{ fontWeight: 600 }}>{pfName}</span>
                        <span style={{ fontWeight: 700, color: '#c084fc' }}>{count} redirects</span>
                      </div>
                    ))}
                </div>
              ) : (
                <p style={{ color: 'rgba(226, 214, 248, 0.65)', fontSize: '0.86rem' }}>
                  Click any Watch or Read button on a Series, Anime, or Manga detail page to see live platform telemetry here.
                </p>
              )}
            </div>

            {/* Top Clicked Titles */}
            <div style={{ padding: '22px', borderRadius: '18px', background: 'rgba(17, 13, 27, 0.94)', border: '1px solid rgba(199, 146, 255, 0.24)' }}>
              <div className="eyebrow">MOST WATCHED &amp; READ</div>
              <h3 style={{ margin: '4px 0 14px', fontSize: '1.15rem' }}>Top Trending Titles by Redirects</h3>
              {analytics && analytics.topTitles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {analytics.topTitles.map((t) => (
                    <div key={`${t.kind}-${t.title}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)' }}>
                      <div>
                        <strong style={{ fontSize: '0.88rem' }}>{t.title}</strong>
                        <span style={{ marginLeft: '8px', fontSize: '0.7rem', textTransform: 'uppercase', color: '#a78bfa' }}>
                          {t.kind}
                        </span>
                      </div>
                      <span style={{ fontWeight: 700 }}>{t.count} clicks</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'rgba(226, 214, 248, 0.65)', fontSize: '0.86rem' }}>
                  No title redirect events recorded in this session yet.
                </p>
              )}
            </div>
          </div>

          {/* Recent Redirect Stream */}
          {analytics && analytics.recentClicks.length > 0 && (
            <div style={{ padding: '22px', borderRadius: '18px', background: 'rgba(17, 13, 27, 0.94)', border: '1px solid rgba(199, 146, 255, 0.24)' }}>
              <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Activity size={14} /> LIVE REDIRECT STREAM
              </div>
              <h3 style={{ margin: '4px 0 14px', fontSize: '1.15rem' }}>Recent Outbound 302 Redirects</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {analytics.recentClicks.slice(0, 15).map((ev, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '9px 12px',
                      borderRadius: '10px',
                      background: 'rgba(255,255,255,0.03)',
                      fontSize: '0.82rem',
                    }}
                  >
                    <div>
                      <strong>{ev.title}</strong> · {ev.kind === 'manga' ? `Ch ${ev.episode}` : `Ep ${ev.episode}`} on{' '}
                      <span style={{ color: '#c084fc', fontWeight: 600 }}>{ev.platform}</span>
                      {ev.affiliateApplied && (
                        <span
                          style={{
                            marginLeft: '8px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(34, 197, 94, 0.18)',
                            color: '#86efac',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                          }}
                        >
                          AFFILIATE REF APPLIED
                        </span>
                      )}
                    </div>
                    <a
                      href={ev.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'rgba(226, 214, 248, 0.72)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    >
                      Target <ArrowUpRight size={13} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
