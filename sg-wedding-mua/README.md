# Singapore Wedding Makeup Artists Directory

A local webpage listing Singapore bridal makeup artists with Instagram handles, follower counts, and a **Processed** checkbox tracked in your browser.

## Files

| File | Description |
|------|-------------|
| `index.html` | Main webpage |
| `styles.css` | Styling |
| `app.js` | Table rendering, search, localStorage for processed state |
| `artists.json` | Artist data (name, handle, followers, description) sorted by followers |
| `artists-source.json` | Source list of artists used to generate `artists.json` |
| `fetch-followers.js` | Optional script to refresh follower counts from public analytics |
| `fetch-descriptions.js` | Optional script to fetch Instagram profile bios via dedicated proxies |

## Live site

**https://xenodus.github.io/misc/**

Deployed automatically via GitHub Actions when changes are pushed to `master`.

## Usage

1. Open the [live site](https://xenodus.github.io/misc/) or `index.html` locally.
2. Click Instagram handles to open profiles.
3. Tick **Processed** checkboxes to track artists you've reviewed — state is saved in `localStorage`.
4. Use search to filter by name or handle.

### Refresh follower counts (optional)

```bash
npm install puppeteer-core
node fetch-followers.js              # scrape all via Instagram /embed/
node fetch-followers.js --only-missing  # skip handles that already have counts
```

Requires Google Chrome (`CHROME_PATH` or a standard install path). Counts come from each profile’s public embed page (`N followers`), which works without Instagram login for public accounts.

### Refresh profile descriptions (optional)

```bash
npm install puppeteer-core
node fetch-descriptions.js              # fetch all bios via proxies
node fetch-descriptions.js --only-missing  # skip handles that already have a bio
```

Requires `DEDICATED_PROXY_1`, `DEDICATED_PROXY_2`, … env vars (`host|port|username|password`). Uses parallel workers (one per proxy) to fetch each profile page and parse the Instagram bio from the meta description.

## Data sources

Artists were compiled from curated Singapore bridal directories and wedding industry lists, including **SingaporeBrides**, **Just Married Films**, **Daily Vanity**, **Bone & Grey**, **Blissful Brides**, **Bridely** (full makeup-artists directory), **Bridestory**, **Terris**, **The Wedding Vow**, **Her World Brides**, and studio team pages. The list contains **375** Singapore wedding makeup artists with Instagram handles (private accounts and non-Singapore-based artists removed).

Follower counts are scraped from Instagram’s public `/embed/` pages. Private, deleted, or rate-limited profiles show `—`. Re-run `fetch-followers.js` to refresh counts.

## Notes

- Checkboxes are stored locally per browser; clearing site data resets them.
- Some handles may show `—` for followers if the profile is private, deleted, or temporarily blocked by Instagram.
- This is a static tool — no data is sent to any server.
