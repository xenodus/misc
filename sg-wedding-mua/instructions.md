# Singapore Wedding Makeup Artists — instructions

This document describes the files and tools in `sg-wedding-mua/`, and the checklist for adding or updating artists.

Live site: **https://xenodus.github.io/misc/**

---

## Repository layout

```
sg-wedding-mua/
├── index.html                  # Main webpage (Instagram + TikTok tabs)
├── styles.css                  # Page styling
├── app.js                      # Table UI, tabs, search, processed checkboxes
├── artists-source.json         # Instagram curated source list (name + handle)
├── artists.json                # Instagram enriched data served to the browser
├── artists-source-tiktok.json  # TikTok curated source list (name + handle)
├── artists-tiktok.json         # TikTok enriched data served to the browser
├── fetch-followers.js          # CLI: refresh Instagram follower counts
├── fetch-bios.js               # CLI: refresh Instagram profile descriptions (primary)
├── fetch-descriptions.js       # CLI: refresh Instagram descriptions (Puppeteer fallback)
├── search-tiktok-artists.js    # CLI: discover TikTok MUAs (excludes IG registry)
├── fetch-tiktok-profiles.js    # CLI: refresh TikTok followers and bios
├── bios-progress.jsonl         # Append-only log from fetch-bios.js (gitignored)
├── package.json                # Node dependencies (puppeteer-core)
├── README.md                   # Project overview
└── instructions.md             # This file
```

Repo root also contains `.github/workflows/deploy-sg-wedding-mua.yml`, which deploys the `sg-wedding-mua/` folder to GitHub Pages on pushes to `master`.

---

## Data files

### `artists-source.json`

Canonical list of artists. Used as input when (re)building `artists.json`.

| Field    | Type   | Description                          |
|----------|--------|--------------------------------------|
| `name`   | string | Display name                         |
| `handle` | string | Instagram username (no `@`)          |
| `tag`    | string | Optional UI badge, e.g. `"new"` for recently added artists. Keep until you manually remove it. |

When adding a new artist, update this file first.

### `artists.json`

Runtime data loaded by the webpage (Instagram tab). Sorted by `followers` (descending).

| Field         | Type   | Description                                      |
|---------------|--------|--------------------------------------------------|
| `name`        | string | Display name                                     |
| `handle`      | string | Instagram username                               |
| `followers`   | number | Follower count (`0` if private or unavailable)   |
| `description` | string | Instagram profile bio (shown as **Profile description** in the UI) |
| `instagram`   | string | Full profile URL, e.g. `https://www.instagram.com/handle/` |
| `tag`         | string | Optional UI badge mirrored from `artists-source.json` (e.g. `"new"`). Do not strip when running fetch scripts. |

Populated by `fetch-followers.js` and the bio-fetch scripts. Do not hand-edit follower counts or descriptions unless correcting a bad scrape.

### `artists-source-tiktok.json`

Canonical list of TikTok artists. Used as input when (re)building `artists-tiktok.json`.

| Field    | Type   | Description                          |
|----------|--------|--------------------------------------|
| `name`   | string | Display name                         |
| `handle` | string | TikTok username (no `@`)             |
| `tag`    | string | Optional UI badge, e.g. `"new"` for recently discovered artists |

Populated by `search-tiktok-artists.js`, which discovers candidates from TikTok hashtags and excludes artists already in the Instagram registry.

### `artists-tiktok.json`

Runtime data loaded by the webpage (TikTok tab). Sorted by `followers` (descending).

| Field         | Type   | Description                                      |
|---------------|--------|--------------------------------------------------|
| `name`        | string | Display name                                     |
| `handle`      | string | TikTok username                                  |
| `followers`   | number | Follower count (`0` if private or unavailable)   |
| `description` | string | TikTok profile bio                               |
| `tiktok`      | string | Full profile URL, e.g. `https://www.tiktok.com/@handle` |
| `tag`         | string | Optional UI badge mirrored from source           |

Populated by `fetch-tiktok-profiles.js`. Do not hand-edit follower counts or descriptions unless correcting a bad scrape.

### `bios-progress.jsonl`

Append-only JSON-lines log written by `fetch-bios.js`. One line per fetch attempt, with `handle`, `status`, `description`, `proxy`, and `fetchedAt`. Gitignored. Useful for resuming after interruptions or debugging rate limits.

---

## Frontend files

### `index.html`

Static shell for the directory page: header, **Instagram / TikTok tabs**, search bar, processed filter, and table columns:

`#` · Name · Profile description · Handle · Followers · Processed

### `app.js`

Browser logic:

- Loads `artists.json` (Instagram tab) or `artists-tiktok.json` (TikTok tab) via `fetch()`
- Renders the sortable/filterable table
- Search matches name, handle, or description
- **Show new only** filters to artists with `"tag": "new"` in the data
- **Processed** checkboxes persist in `localStorage` under key `sg-wedding-mua-processed-v2`, keyed by `{platform}:{handle}` (per browser, not synced)

### `styles.css`

Layout and visual styling for the table, header, and responsive behaviour.

---

## CLI tools

Install dependencies once:

```bash
cd sg-wedding-mua
npm install
```

All scripts support `--only-missing` to skip records that already have the target field populated.

### `fetch-followers.js`

Refreshes **follower counts** and the `instagram` URL for each artist.

- **Input:** `artists-source.json`
- **Output:** `artists.json`
- **Method:** Headless Chrome (Puppeteer) visits public `/embed/` pages and parses `"N followers"` from the page text
- **Proxies:** Optional. Set `DEDICATED_PROXY_1` … `DEDICATED_PROXY_7` as `host|port|username|password`. Uses parallel workers (one per healthy proxy). Dead proxies are skipped at startup.
- **Requires:** Google Chrome (`CHROME_PATH` or a standard install path)

```bash
node fetch-followers.js              # scrape all
node fetch-followers.js --only-missing
```

### `fetch-bios.js`

Refreshes **profile descriptions** (Instagram bios) into the `description` field. Primary tool — fast and lightweight.

- **Input / output:** `artists.json`
- **Method:** `curl` against Instagram's `web_profile_info` API endpoint
- **Proxies:** Optional. `DEDICATED_PROXY_1` … `DEDICATED_PROXY_7` as `host|port|username|password` or a full `http://` / `socks5://` URL. Round-robins across proxies; rotates on 401/429. On rate limit, falls back to `RESIDENTIAL_PROXY_1` via headless Chrome.
- **Throttling:** Concurrency 1; `DELAY_MS` (default 1000) between requests; `BACKOFF_MS` (default 5000) on rate limits
- **Progress:** Appends each attempt to `bios-progress.jsonl`

```bash
node fetch-bios.js --only-missing
DELAY_MS=1000 BACKOFF_MS=5000 node fetch-bios.js --only-missing
```

### `fetch-descriptions.js`

Fallback for **profile descriptions** when `fetch-bios.js` returns 401 on all proxies.

- **Input / output:** `artists.json`
- **Method:** Parallel headless Chrome workers (one per proxy) scrape each profile page and parse the bio from meta tags
- **Proxies:** Required unless using residential fallback. `DEDICATED_PROXY_1` … `DEDICATED_PROXY_N` as `host|port|username|password` or URL. Also loads `RESIDENTIAL_PROXY_1` when set. Use `--residential-only` to skip dedicated proxies.
- **Requires:** Google Chrome

```bash
node fetch-descriptions.js --only-missing
```

### `search-tiktok-artists.js`

Discovers **TikTok bridal makeup artists** and writes `artists-source-tiktok.json`.

- **Input:** `artists-source.json` (to exclude existing Instagram artists)
- **Output:** `artists-source-tiktok.json`
- **Method:** Scrapes TikTok hashtag pages (`#sgmua`, `#sgbridalmua`, etc.) and seed handles, then visits each profile to verify criteria
- **Excludes:** Artists whose handle matches the Instagram registry, whose TikTok handle is linked in an Instagram bio, or whose display name matches an Instagram entry
- **Requires:** Google Chrome

```bash
node search-tiktok-artists.js              # discover and write source list
node search-tiktok-artists.js --dry-run    # preview without writing
node search-tiktok-artists.js --hashtags=sgmua,sgwedding
```

### `fetch-tiktok-profiles.js`

Refreshes **TikTok follower counts** and profile bios into `artists-tiktok.json`.

- **Input:** `artists-source-tiktok.json`
- **Output:** `artists-tiktok.json`
- **Method:** Headless Chrome visits each TikTok profile page
- **Requires:** Google Chrome

```bash
node fetch-tiktok-profiles.js
node fetch-tiktok-profiles.js --only-missing
```

### Which tool to use when

| Goal                         | Tool                    |
|------------------------------|-------------------------|
| Add new artists to the list  | Edit `artists-source.json`, then run `fetch-followers.js` |
| Refresh follower counts      | `fetch-followers.js`    |
| Refresh profile descriptions | `fetch-bios.js` first; `fetch-descriptions.js` if rate-limited |
| Discover TikTok artists      | `search-tiktok-artists.js`, then `fetch-tiktok-profiles.js` |
| Refresh TikTok data          | `fetch-tiktok-profiles.js` |
| Browse and review artists    | Open `index.html` or the live site |

---

## Environment variables

| Variable              | Used by                         | Format / default                          |
|-----------------------|---------------------------------|-------------------------------------------|
| `DEDICATED_PROXY_1`–`7` | All fetch scripts             | `host\|port\|username\|password` or URL  |
| `RESIDENTIAL_PROXY_1` | `fetch-bios.js`, `fetch-descriptions.js` | Same format; web-scrape fallback when API is rate-limited |
| `CHROME_PATH`         | `fetch-followers.js`, `fetch-descriptions.js` | Path to Chrome binary     |
| `DELAY_MS`            | `fetch-bios.js`                 | Default `1000`                            |
| `BACKOFF_MS`          | `fetch-bios.js`                 | Default `5000`                            |
| `JITTER_MS`           | `fetch-bios.js`                 | Default `500`                             |

---

## Deployment

Pushes to `master` that touch `sg-wedding-mua/**` trigger `.github/workflows/deploy-sg-wedding-mua.yml`, which publishes the folder to GitHub Pages. No build step — the static files are deployed as-is.

---

## Artist checklist

When adding or updating an artist in `artists-source.json` and `artists.json`, verify all of the following before saving:

### Instagram required checks

1. **From Singapore** — The artist is based in Singapore or primarily serves Singapore bridal clients.
2. **Public account** — The Instagram profile is public (not private). Private accounts cannot be scraped for followers or descriptions and must be excluded.
3. **Has at least 5 posts on Instagram** — The profile is active and has a minimum of 5 public posts.
4. **Is a makeup artist** — The account belongs to a makeup artist (bridal/wedding MUA), not a photographer, venue, planner, or unrelated business.
5. **Has a profile description** — The Instagram account has bio text. If `fetch-bios.js` (including `RESIDENTIAL_PROXY_1` fallback) or `fetch-descriptions.js` confirms the profile has no bio, remove the artist from both `artists-source.json` and `artists.json`.

### TikTok required checks

Applied automatically by `search-tiktok-artists.js` when discovering new artists:

1. **From Singapore** — Bio or display name mentions Singapore, SG, 🇸🇬, +65, or common SG bridal hashtags.
2. **Public account** — The TikTok profile is public (not private).
3. **Has at least 5 posts on TikTok** — The profile is active with a minimum of 5 videos.
4. **Is a makeup artist** — Bio or name indicates bridal/MUA work; photographers, venues, and unrelated businesses are excluded.
5. **Has a profile description** — The TikTok account has bio text.
6. **Not already in Instagram registry** — Excludes artists whose handle, linked TikTok handle, or display name matches an existing Instagram entry.

### Instagram workflow

1. Open the artist's Instagram profile and confirm all checks above.
2. Add or update the entry in `artists-source.json` with `name` and `handle`. Add `"tag": "new"` for recently added artists; leave the tag in place until you deliberately remove it.
3. Run `node fetch-followers.js --only-missing` to refresh follower counts and the `instagram` URL in `artists.json`.
4. Run `node fetch-bios.js --only-missing` to refresh the profile description. If the API is rate-limited, run `node fetch-descriptions.js --only-missing` instead.
5. Remove any artist with a confirmed empty Instagram bio from both `artists-source.json` and `artists.json`.
6. Remove any artist who no longer meets these criteria from both files.
7. Push to `master` to deploy the updated site.

### TikTok workflow

1. Run `node search-tiktok-artists.js` to discover new TikTok artists (excludes Instagram registry automatically).
2. Review `artists-source-tiktok.json` and remove any false positives.
3. Run `node fetch-tiktok-profiles.js` to populate `artists-tiktok.json` with followers and bios.
4. Open the site and use the **TikTok** tab to review artists. Mark entries as **Processed** when reviewed.
5. Remove `"tag": "new"` from artists after review.
6. Push to `master` to deploy the updated site.
