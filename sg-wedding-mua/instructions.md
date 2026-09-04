# Artist checklist

When adding or updating an artist in `artists-source.json` and `artists.json`, verify all of the following before saving:

## Required checks

1. **From Singapore** — The artist is based in Singapore or primarily serves Singapore bridal clients.
2. **Has at least 5 posts on Instagram** — The profile is active and has a minimum of 5 public posts.
3. **Is a makeup artist** — The account belongs to a makeup artist (bridal/wedding MUA), not a photographer, venue, planner, or unrelated business.

## Workflow

1. Open the artist’s Instagram profile and confirm all three checks above.
2. Add or update the entry in `artists-source.json` with `name` and `handle`.
3. Run `node fetch-followers.js --only-missing` to refresh follower counts and add the `instagram` URL in `artists.json`.
4. Remove any artist who no longer meets these criteria from both files.
