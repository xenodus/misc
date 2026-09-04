#!/usr/bin/env node
/**
 * Fetch Instagram profile bios (biography) into artists.json as `description`.
 *
 * Uses Instagram's public web_profile_info endpoint (no browser).
 *
 * Throttling:
 * - Concurrency is always 1
 * - Waits DELAY_MS between requests (default 1s)
 * - Backs off on HTTP 401/429 (default 5s, escalates up to 3x on streaks)
 *
 * Usage:
 *   node fetch-bios.js
 *   node fetch-bios.js --only-missing
 *   DELAY_MS=1000 BACKOFF_MS=5000 node fetch-bios.js --only-missing
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ARTISTS_PATH = path.join(ROOT, 'artists.json');
const PROGRESS_PATH = path.join(ROOT, 'bios-progress.jsonl');

const DELAY_MS = Number(process.env.DELAY_MS || 1000);
const BACKOFF_MS = Number(process.env.BACKOFF_MS || 5000);
const JITTER_MS = Number(process.env.JITTER_MS || 500);
const CONCURRENCY = 1;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const ENDPOINTS = [
  (h) => `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
  (h) => `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jittered(ms) {
  return ms + Math.floor(Math.random() * JITTER_MS);
}

function loadProgress() {
  const map = {};
  if (!fs.existsSync(PROGRESS_PATH)) return map;
  for (const line of fs.readFileSync(PROGRESS_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.handle) map[row.handle.toLowerCase()] = row;
    } catch {
      // skip bad lines
    }
  }
  return map;
}

function appendProgress(row) {
  fs.appendFileSync(PROGRESS_PATH, JSON.stringify(row) + '\n');
}

function writeArtists(artists) {
  const sorted = [...artists].sort((a, b) => (b.followers || 0) - (a.followers || 0));
  fs.writeFileSync(ARTISTS_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

async function fetchBio(handle) {
  let lastStatus = 'no_response';
  for (const makeUrl of ENDPOINTS) {
    let res;
    try {
      res = await fetch(makeUrl(handle), {
        headers: {
          'User-Agent': UA,
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: '*/*',
        },
      });
    } catch (err) {
      lastStatus = `exception:${err.message}`;
      continue;
    }

    lastStatus = `http_${res.status}`;
    if (res.status === 401 || res.status === 429) {
      return { status: lastStatus, description: '', rateLimited: true };
    }
    if (res.status !== 200) continue;

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const user = json?.data?.user;
      if (!user) return { status: 'no_user', description: '' };
      return {
        status: 'ok',
        description: user.biography || '',
        full_name: user.full_name || '',
        category: user.category_name || user.business_category_name || null,
        followers: user.edge_followed_by?.count ?? null,
      };
    } catch {
      lastStatus = 'parse_fail';
    }
  }
  return { status: lastStatus, description: '' };
}

async function main() {
  if (CONCURRENCY !== 1) {
    console.error('This script only supports concurrency=1 to protect against rate limits.');
    process.exit(1);
  }

  const onlyMissing = process.argv.includes('--only-missing');
  const artists = JSON.parse(fs.readFileSync(ARTISTS_PATH, 'utf8'));
  const progress = loadProgress();

  let seeded = 0;
  for (const artist of artists) {
    const prev = progress[artist.handle.toLowerCase()];
    if (prev?.status === 'ok' && prev.description != null && artist.description == null) {
      artist.description = prev.description;
      seeded++;
    }
  }
  if (seeded) {
    writeArtists(artists);
    console.log(`Seeded ${seeded} descriptions from ${path.basename(PROGRESS_PATH)}`);
  }

  const todo = artists.filter((a) => {
    if (onlyMissing && (a.description || '').trim()) return false;
    const prev = progress[a.handle.toLowerCase()];
    if (onlyMissing && prev?.status === 'ok' && (prev.description || '') === (a.description || '')) {
      return false;
    }
    if (!onlyMissing && prev?.status === 'ok' && (a.description || '') === (prev.description || '')) {
      return false;
    }
    return true;
  });

  console.log(
    `Fetching bios for ${todo.length}/${artists.length} artists (concurrency=${CONCURRENCY}, delay=${DELAY_MS}ms, backoff=${BACKOFF_MS}ms)`
  );

  let ok = 0;
  let fail = 0;
  let consecutiveAuthFails = 0;

  for (let i = 0; i < todo.length; i++) {
    const artist = todo[i];
    process.stdout.write(`[${i + 1}/${todo.length}] @${artist.handle} ... `);

    let result;
    try {
      result = await fetchBio(artist.handle);
    } catch (err) {
      result = { status: 'exception', description: '', err: err.message };
    }

    const row = {
      handle: artist.handle,
      status: result.status,
      description: result.description || '',
      full_name: result.full_name || null,
      category: result.category || null,
      fetchedAt: new Date().toISOString(),
    };
    appendProgress(row);
    progress[artist.handle.toLowerCase()] = row;

    if (result.status === 'ok') {
      artist.description = result.description || '';
      writeArtists(artists);
      ok++;
      consecutiveAuthFails = 0;
      const preview = (result.description || '').replace(/\s+/g, ' ').slice(0, 90);
      console.log(`ok | ${preview || '(empty bio)'}`);
      await sleep(jittered(DELAY_MS));
    } else {
      fail++;
      console.log(result.status);
      const authFail = result.rateLimited || /http_401|http_429/.test(result.status);
      if (authFail) {
        consecutiveAuthFails++;
        const wait = jittered(BACKOFF_MS * Math.min(consecutiveAuthFails, 3));
        console.log(`  rate-limited; backing off ${Math.round(wait / 1000)}s`);
        await sleep(wait);
      } else {
        consecutiveAuthFails = 0;
        await sleep(jittered(DELAY_MS));
      }
    }
  }

  const withDesc = artists.filter((a) => (a.description || '').trim()).length;
  console.log(`\nDone. ok=${ok} fail=${fail}. artists.json now has ${withDesc}/${artists.length} descriptions.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
