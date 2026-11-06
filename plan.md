# BL Pulse — revised implementation plan

## Product scope

The World of BL URL is a **visual-layout reference only**. The finished app must not scrape, import, link to, or display its catalog data, artwork, or episode links. BL Pulse will use its own brand and display source attribution for whichever independent data providers are connected.

For live-action titles, the proposed source is The Movie Database (TMDB). Its developer API is free for non-commercial use, but requires a user-created API credential, attribution, and adherence to its terms. TMDB's BL keywords are community data rather than a guaranteed complete classification, so the app will distinguish verified provider data from keyword-based discovery. Its TV Watch Providers endpoint returns region-specific provider names and a TMDB watch-page link, not deep links directly to a streaming service; the provider data comes from JustWatch and requires separate JustWatch attribution. The site must not send TMDB data to an AI/LLM, and the no-ads/non-commercial assumption must be revisited before any monetization.

For BL anime and manga, the proposed source is AniList. Its public GraphQL endpoint needs no API key and supplies titles, covers, tags and some legal `streamingEpisodes` links. AniList's Terms prohibit bulk collection and using the API as a data store, so the app will page through results on visitor demand, use only short-lived in-memory response caching, and not persist its anime/manga catalog in MySQL. Default to the AniList `Boys' Love` tag-rank 70+ subset to reduce obvious low-rank noise, while providing an explicit all-tagged-results option. Display each source rank and classification provenance; AniList tags and rank are community-maintained source metadata, not a verified relevance score, so do not claim every returned title is BL or that its list is complete.

## Architecture and data flow

- The Vite + React + TypeScript client is served by the Node/Express TypeScript application on port 3000. Express serves the production client build and exposes same-origin JSON endpoints.
- `src/server/tmdb.ts` queries only BL-focused TV searches/keywords, normalizes series data and images, and retrieves country-specific provider availability. Its cache respects TMDB's six-month maximum; the implementation will keep records refreshed daily and prune stale TMDB content. Recommendations from TMDB records are deterministic rule-based selections, never AI-generated or sent to an LLM.
- `src/server/anilist.ts` retrieves one paginated anime or manga result page when the visitor searches, opens a section, or requests more results. `Page.pageInfo.hasNextPage` controls browsing. Details are fetched by AniList ID on demand. The API limits each IP/User-Agent bucket to 15 calls per minute, the server caps uncached upstream requests at 20 per minute, caches repeat queries in process memory for two minutes, and honors AniList `Retry-After` responses. The app does not bulk-crawl or persist AniList media rows.
- Anime episode rows use direct AniList streaming URLs when the source supplies them. When it does not, use a verified official streaming-service search only where the search URL pattern is confirmed; otherwise open the AniList-listed title page and tell visitors to select the episode there. TMDB does not provide per-episode streaming deep links, so live-action episode destinations use a clearly labeled official-platform search rather than a direct watch claim. Manga chapters use a number selector and AniList-listed reading page; do not invent chapter URLs or unverified search patterns.
- Managed MySQL remains for the app's job metadata, refresh timestamps, and the compact live-action catalog where permitted by TMDB's cache terms. The former `bl_series` data imported from World of BL is removed from runtime usage and is not shown to visitors.
- The app loads its own saved live-action catalog, refreshes it on startup when needed and on a stale timer, and exposes manual refresh. A daily Manus Heartbeat run at 02:00 IST (`0 30 20 * * *` UTC) calls `/api/scheduled/catalog-refresh` to refresh TMDB discovery. AniList pages are fetched live on visitor demand, not scheduled or bulk-crawled, and its catalog is never persistently stored.
- Heartbeat callbacks verify the platform-issued `app_session_id` JWT, resolve its `taskUid` through the platform identity endpoint, and compare the identity with the configured task before work begins. The stored task identity is registered after the user-approved production version is published. Retries use upserts and a last-success marker.
- Keep the original generated two-guys hero image visibly in place for the opening 8 seconds and as the permanent fallback. After that opening, rotate every 8 seconds through source-provided TMDB posters and AniList covers, begin at a different available title image on each visit, keep headline contrast over varying images, and respect reduced-motion preferences.
- Routes: `/` (home), `/discover` (live-action discovery), `/series/:id`, `/anime`, `/anime/:id`, `/manga`, and `/manga/:id`. `public/manus-routes.json` declares these page routes; API and scheduled callback paths are excluded.
- The About/Credits area includes TMDB's approved logo and required non-endorsement notice, plus separate JustWatch and AniList attribution. TMDB content is used only under the non-commercial assumption; it is not used for LLM generation.

## Project structure

- `src/client/`: React home, live-action discovery, anime/manga explorers, shared detail pages, search/filter controls, progressive episode/chapter rows, rotating hero and poster rails.
- `src/server/`: Express API, TMDB adapter, on-demand AniList adapter, rate controls and short-lived cache, permitted MySQL metadata, deterministic recommendation logic, and Heartbeat callback authentication/idempotency.
- `src/shared/`: normalized series, media, streaming-provider and chapter/episode types shared by browser and server.
- `public/`: route manifest and BL Pulse brand assets; all title artwork comes only from the selected data provider URLs.
- Root configuration: Vite/TypeScript settings, package scripts, Dockerfile, `app.config.ts`, and this plan plus `TODO.md`.

## Design — Midnight Signal (approved direction)

- **Design Movement:** premium, poster-led streaming editorial with a distinctly nocturnal violet identity.
- **Core Principles:** cinematic imagery before metadata; fast, legible discovery; restrained glow for state and focus; honest source provenance and availability.
- **Color Philosophy:** ink-black and charcoal surfaces make artwork luminous; ultraviolet-violet (#8B5CF6) signals discovery and action; pale neutral text keeps long titles readable without competing with the imagery.
- **Layout Paradigm:** a compact persistent top bar above a full-bleed featured story, followed by left-aligned horizontal discovery rails; detail pages use an offset poster-and-story composition rather than a centered dashboard grid.
- **Signature Elements:** violet “live pulse” status marker; poster cards with subtle bottom gradient and hover lift; slim freshness/source strip on the featured story.
- **Interaction Philosophy:** keyboard-friendly search and filters; card click opens details while explicit watch actions open source/platform destinations in a new tab; refresh visibly reports progress and last-success time.
- **Animation:** brief 160–220 ms easing for card lift, focus ring, and rail controls; featured artwork advances every 8 seconds and on a new visit; honor reduced-motion preferences and keep manual browsing available.
- **Typography System:** Manrope; large editorial headlines, medium-weight section headings, and compact muted metadata with consistent line-height and truncation.
- **Brand Essence:** a live, carefully sourced viewing guide for BL fans who want to find the next story and where to continue it; **cinematic, informed, welcoming**.
- **Brand Voice:** warm, concise discovery language. Examples: “Your next story starts here.” “A new episode just entered the signal.”
- **Wordmark & Logo:** a distinctive circular pulse/play mark with two offset violet arcs and a tiny heart-shaped negative-space accent, paired with the BL Pulse name in the interface.
- **Signature Brand Color:** ultraviolet violet `#8B5CF6`.

## Source documentation

TMDB states its API is free for non-commercial use with attribution and requires a developer API key; its TV Watch Providers endpoint supplies region-specific providers and a TMDB link rather than deep links, and requires JustWatch attribution. TMDB's terms also prohibit using its data with AI applications and require a written agreement for commercial use. AniList's public API supplies paginated media/episode data, but its terms prohibit mass collection and storing its catalog. Sources: [TMDB FAQ](https://developer.themoviedb.org/docs/faq), [TMDB setup](https://developer.themoviedb.org/docs/getting-started), [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application), [TV Watch Providers](https://developer.themoviedb.org/reference/tv-series-watch-providers), [TMDB API terms](https://www.themoviedb.org/api-terms-of-use), [AniList API terms](https://docs.anilist.co/guide/terms-of-use), [AniList Media](https://docs.anilist.co/reference/object/media). The TMDB Read Access Token is server-side only; no credentials go to browser code, Git or frontend build output.

## Current decision needed

A TMDB Read Access Token has not yet been supplied. The user should create a developer API credential for a genuinely non-commercial site and provide it through a secure secret-input card, not chat. The catalog should not be published with the old World of BL data source enabled.

## SEO requirements

The public site must serve content-bearing initial HTML for its indexable routes rather than an empty React mount. Generate route-specific titles, descriptions, 3–8 relevant keywords, Open Graph and Twitter card metadata, and meaningful body content on the server. Detail pages use current public title content; unknown routes or missing media return HTTP 404 and `noindex,follow`, rather than a soft 404. Client-side navigation keeps metadata aligned with the route. Canonical and `og:url` values use only a known, explicitly configured final public site origin; never infer them from request headers, internal hosts, or Preview URLs. Generate a sitemap from implemented public routes and a robots file that permits public pages but blocks APIs. Include source-aware descriptions/credits where appropriate. Before a canonical public origin is configured, omit absolute canonical/og:url values and do not advertise a guessed sitemap URL.
