#!/usr/bin/env node
/**
 * Fetch Instagram profile bios (biography) into artists.json as `description`.
 *
 * Throttling (to avoid Instagram rate limits):
 * - Concurrency is always 1 (no parallel profile lookups)
 * - Waits DELAY_MS between successful requests (default 12s)
 * - Backs off longer on HTTP 401/429
 * - Reuses one browser session; refreshes it after auth failures
 *
 * Usage:
 *   node fetch-bios.js
 *   node fetch-bios.js --only-missing
 *   DELAY_MS=15000 BACKOFF_MS=60000 node fetch-bios.js --only-missing
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const ARTISTS_PATH = path.join(ROOT, 'artists.json');
const PROGRESS_PATH = path.join(ROOT, 'bios-progress.jsonl');
const CHROME =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find(
    (p) => fs.existsSync(p)
  );

const DELAY_MS = Number(process.env.DELAY_MS || 12000);
const BACKOFF_MS = Number(process.env.BACKOFF_MS || 60000);
const JITTER_MS = Number(process.env.JITTER_MS || 3000);
const CONCURRENCY = 1; // hard-capped; do not raise without expecting rate limits

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

async function createBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  // Warm session lightly via a public embed (less aggressive than hammering the API)
  await page
    .goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch(() => {});
  await sleep(2000);
  return page;
}

async function fetchBio(page, handle) {
  await page
    .goto(`https://www.instagram.com/${encodeURIComponent(handle)}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    .catch(() => {});
  await sleep(1500);

  let data = await page.evaluate(async (h) => {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
      {
        headers: {
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: '*/*',
        },
        credentials: 'include',
      }
    );
    return { status: res.status, text: await res.text() };
  }, handle);

  // Transient schema/asset errors sometimes clear after a soft reload
  if (data.status === 400) {
    await sleep(2000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(1500);
    data = await page.evaluate(async (h) => {
      const res = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
        {
          headers: {
            'X-IG-App-ID': '936619743392459',
            'X-Requested-With': 'XMLHttpRequest',
            Accept: '*/*',
          },
          credentials: 'include',
        }
      );
      return { status: res.status, text: await res.text() };
    }, handle);
  }

  if (data.status === 200) {
    try {
      const json = JSON.parse(data.text);
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
      return { status: 'parse_fail', description: '' };
    }
  }

  return { status: `http_${data.status}`, description: '' };
}

async function main() {
  if (!CHROME) {
    console.error('Chrome not found. Set CHROME_PATH.');
    process.exit(1);
  }
  if (CONCURRENCY !== 1) {
    console.error('This script only supports concurrency=1 to protect against rate limits.');
    process.exit(1);
  }

  const onlyMissing = process.argv.includes('--only-missing');
  const artists = JSON.parse(fs.readFileSync(ARTISTS_PATH, 'utf8'));
  const progress = loadProgress();

  // Seed artists.json from any prior successful progress rows
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
    // Retry previous failures; skip if we already stored an ok bio in progress
    // and artists.json already has it when --only-missing
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

  let browser = await createBrowser();
  let page = await createPage(browser);
  let ok = 0;
  let fail = 0;
  let consecutiveAuthFails = 0;

  try {
    for (let i = 0; i < todo.length; i++) {
      const artist = todo[i];
      process.stdout.write(`[${i + 1}/${todo.length}] @${artist.handle} ... `);

      let result;
      try {
        result = await fetchBio(page, artist.handle);
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
        const authFail = /http_401|http_429/.test(result.status);
        if (authFail) {
          consecutiveAuthFails++;
          const wait = jittered(BACKOFF_MS * Math.min(consecutiveAuthFails, 3));
          console.log(`  rate-limited; backing off ${Math.round(wait / 1000)}s and refreshing session`);
          await page.close().catch(() => {});
          await browser.close().catch(() => {});
          await sleep(wait);
          browser = await createBrowser();
          page = await createPage(browser);
        } else {
          consecutiveAuthFails = 0;
          await sleep(jittered(DELAY_MS));
        }
      }
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const withDesc = artists.filter((a) => (a.description || '').trim()).length;
  console.log(`\nDone. ok=${ok} fail=${fail}. artists.json now has ${withDesc}/${artists.length} descriptions.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
