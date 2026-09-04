# Singapore Wedding Makeup Artists Directory

A local webpage listing Singapore bridal makeup artists with Instagram handles, follower counts, and a **Processed** checkbox tracked in your browser.

## Files

| File | Description |
|------|-------------|
| `index.html` | Main webpage |
| `styles.css` | Styling |
| `app.js` | Table rendering, search, localStorage for processed state |
| `artists.json` | Artist data (name, handle, followers) sorted by followers |
| `artists-source.json` | Source list of artists used to generate `artists.json` |
| `fetch-followers.js` | Optional script to refresh follower counts from public analytics |

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
node fetch-followers.js
```

Requires Google Chrome at `/usr/local/bin/google-chrome` (adjust path in script if needed).

## Data sources

Artists were compiled from curated Singapore bridal directories and wedding industry lists, including **SingaporeBrides**, **Just Married Films**, **Daily Vanity**, **Bone & Grey**, **Blissful Brides**, **Bridely** (full makeup-artists directory), **Bridestory**, **Terris**, **The Wedding Vow**, **Her World Brides**, and studio team pages. The list contains **403** Singapore wedding makeup artists with Instagram handles (242 original + 161 new).

Follower counts are sourced from public Instagram analytics (StarNgage) where available. Profiles not indexed by the analytics source show `—` for followers. Re-run `fetch-followers.js` to refresh counts.

## Notes

- Checkboxes are stored locally per browser; clearing site data resets them.
- Some handles may show `—` for followers if the profile was not found in the analytics source.
- This is a static tool — no data is sent to any server.
