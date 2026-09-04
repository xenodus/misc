# Singapore Wedding Makeup Artists — instructions

This document describes the files and tools in `sg-wedding-mua/`, and the checklist for adding or updating artists.

Live site: **https://xenodus.github.io/misc/**

---

## Repository layout

```
sg-wedding-mua/
├── index.html              # Main webpage
├── styles.css              # Page styling
├── app.js                  # Table UI, search, processed checkboxes
├── artists-source.json     # Curated source list (name + handle)
├── artists.json            # Enriched data served to the browser
├── fetch-followers.js      # CLI: refresh follower counts
├── fetch-bios.js           # CLI: refresh profile descriptions (primary)
├── fetch-descriptions.js   # CLI: refresh descriptions (Puppeteer fallback)
├── bios-progress.jsonl     # Append-only log from fetch-bios.js (gitignored)
├── package.json            # Node dependencies (puppeteer-core)
├── README.md               # Project overview
└── instructions.md         # This file
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

When adding a new artist, update this file first.

### `artists.json`

Runtime data loaded by the webpage. Sorted by `followers` (descending).

| Field         | Type   | Description                                      |
|---------------|--------|--------------------------------------------------|
| `name`        | string | Display name                                     |
| `handle`      | string | Instagram username                               |
| `followers`   | number | Follower count (`0` if private or unavailable)   |
| `description` | string | Instagram profile bio (shown as **Profile description** in the UI) |
| `instagram`   | string | Full profile URL, e.g. `https://www.instagram.com/handle/` |

Populated by `fetch-followers.js` and the bio-fetch scripts. Do not hand-edit follower counts or descriptions unless correcting a bad scrape.

### `bios-progress.jsonl`

Append-only JSON-lines log written by `fetch-bios.js`. One line per fetch attempt, with `handle`, `status`, `description`, `proxy`, and `fetchedAt`. Gitignored. Useful for resuming after interruptions or debugging rate limits.

---

## Frontend files

### `index.html`

Static shell for the directory page: header, search bar, processed filter, and table columns:

`#` · Name · Profile description · Instagram Handle · Followers · Processed

### `app.js`

Browser logic:

- Loads `artists.json` via `fetch()`
- Renders the sortable/filterable table
- Search matches name, handle, or description
- **Processed** checkboxes persist in `localStorage` under key `sg-wedding-mua-processed-v1` (per browser, not synced)

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

### Which tool to use when

| Goal                         | Tool                    |
|------------------------------|-------------------------|
| Add new artists to the list  | Edit `artists-source.json`, then run `fetch-followers.js` |
| Refresh follower counts      | `fetch-followers.js`    |
| Refresh profile descriptions | `fetch-bios.js` first; `fetch-descriptions.js` if rate-limited |
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

### Required checks

1. **From Singapore** — The artist is based in Singapore or primarily serves Singapore bridal clients.
2. **Public account** — The Instagram profile is public (not private). Private accounts cannot be scraped for followers or descriptions and must be excluded.
3. **Has at least 5 posts on Instagram** — The profile is active and has a minimum of 5 public posts.
4. **Is a makeup artist** — The account belongs to a makeup artist (bridal/wedding MUA), not a photographer, venue, planner, or unrelated business.

### Workflow

1. Open the artist's Instagram profile and confirm all four checks above.
2. Add or update the entry in `artists-source.json` with `name` and `handle`.
3. Run `node fetch-followers.js --only-missing` to refresh follower counts and the `instagram` URL in `artists.json`.
4. Run `node fetch-bios.js --only-missing` to refresh the profile description. If the API is rate-limited, run `node fetch-descriptions.js --only-missing` instead.
5. Remove any artist who no longer meets these criteria from both files.
6. Push to `master` to deploy the updated site.
