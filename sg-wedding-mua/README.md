# Singapore Wedding Makeup Artists Directory

A local webpage listing Singapore bridal makeup artists with Instagram handles, follower counts, and a **Processed** checkbox tracked in your browser.

## Files

| File | Description |
|------|-------------|
| `index.html` | Main webpage |
| `styles.css` | Styling |
| `app.js` | Table rendering, search, localStorage for processed state |
| `artists.json` | Artist data (name, description, handle, followers, instagram) sorted by followers |
| `artists-source.json` | Source list of artists used to generate `artists.json` |
| `fetch-followers.js` | Optional script to refresh follower counts from Instagram embeds |
| `fetch-bios.js` | Optional throttled script to refresh Instagram profile descriptions |
| `fetch-descriptions.js` | Puppeteer + proxy fallback when `fetch-bios.js` is rate-limited |
| `instructions.md` | Checklist for adding or updating artists |

## Live site

**https://xenodus.github.io/misc/**

Deployed automatically via GitHub Actions when changes are pushed to `master`.

## Usage

1. Open the [live site](https://xenodus.github.io/misc/) or `index.html` locally.
2. Click Instagram handles to open profiles.
3. Tick **Processed** checkboxes to track artists you've reviewed — state is saved in `localStorage`.
4. Use search to filter by name, handle, or description.

### Refresh follower counts (optional)

```bash
npm install puppeteer-core
node fetch-followers.js              # scrape all via Instagram /embed/
node fetch-followers.js --only-missing  # skip handles that already have counts
```

Set `DEDICATED_PROXY_1` … `DEDICATED_PROXY_7` as `host|port|username|password` to fan out requests across healthy proxies in parallel. Dead proxies are skipped automatically at startup.

Requires Google Chrome (`CHROME_PATH` or a standard install path). Counts come from each profile’s public embed page (`N followers`), which works without Instagram login for public accounts. Each artist record includes an `instagram` profile URL.

### Refresh profile descriptions (optional)

```bash
node fetch-bios.js --only-missing
# optional proxies (round-robin 1→2→…→7→1):
# DEDICATED_PROXY_1=host|port|username|password ... DEDICATED_PROXY_7=...
# or full URLs: DEDICATED_PROXY_1=http://user:pass@host:port
```

Looks up Instagram bios **sequentially** (concurrency 1) via curl. Each lookup takes at least 1 second (`MIN_LOOKUP_MS`, default 1000): if a request finishes in 0.2s, the script waits 0.8s before starting the next one. On HTTP 401/429 it backs off (`BACKOFF_MS`, default 5s) after that minimum wait.

When `DEDICATED_PROXY_1`…`DEDICATED_PROXY_7` are set, each lookup uses the next proxy in order (1 → 2 → … → 7 → 1). Empty slots fall back to direct egress for that lookup only. Progress is appended to `bios-progress.jsonl`.

If the API is rate-limited, use the Puppeteer fallback:

```bash
node fetch-descriptions.js --only-missing
```

Uses parallel headless Chrome workers (one per proxy) to scrape bios from profile page meta tags.

See `fetch-bios.js` header comments for full behavior.

## Data sources

Artists were compiled from curated Singapore bridal directories and wedding industry lists, including **SingaporeBrides**, **Just Married Films**, **Daily Vanity**, **Bone & Grey**, **Blissful Brides**, **Bridely** (full makeup-artists directory), **Bridestory**, **Terris**, **The Wedding Vow**, **Her World Brides**, and studio team pages. The list contains **263** Singapore wedding makeup artists with Instagram handles (non-MUA, private, non-Singapore, inactive, and unreachable profiles removed).

Follower counts are scraped from Instagram’s public `/embed/` pages. Private, deleted, or rate-limited profiles show `—`. Re-run `fetch-followers.js` to refresh counts.

See `instructions.md` for criteria when adding or updating artists.

## Notes

- Checkboxes are stored locally per browser; clearing site data resets them.
- Some handles may show `—` for followers if the profile is private, deleted, or temporarily blocked by Instagram.
- This is a static tool — no data is sent to any server.
