#!/usr/bin/env node
/**
 * Refresh Instagram follower counts via public /embed/ pages.
 * Uses DEDICATED_PROXY_1..7 (host|port|user|pass) for parallel workers.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const SOURCE = path.join(ROOT, 'artists-source.json');
const OUTPUT = path.join(ROOT, 'artists.json');
const DELAY_MS = 1200;
const COOLDOWN_MS = 20000;
const CHROME =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find(
    (p) => fs.existsSync(p)
  );

function loadProxies() {
  const proxies = [];
  for (let i = 1; i <= 7; i++) {
    const raw = process.env[`DEDICATED_PROXY_${i}`];
    if (!raw) continue;
    const [host, port, username, password] = raw.split('|');
    if (host && port) proxies.push({ id: i, host, port, username, password });
  }
  return proxies;
}

function parseFollowers(text) {
  if (!text) return null;
  if (/Performing security verification|Enable JavaScript|HTTP ERROR 429/i.test(text)) {
    return null;
  }
  if (/profile may be broken|profile may have been removed|Page isn't available/i.test(text)) {
    return 0;
  }
  const m = text.match(/([\d,.]+)\s*([KkMm])?\s*followers?/i);
  if (!m) return null;
  let val = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(val)) return null;
  const suf = (m[2] || '').toUpperCase();
  if (suf === 'K') val *= 1000;
  if (suf === 'M') val *= 1_000_000;
  return Math.round(val);
}

function chunkRoundRobin(items, n) {
  const chunks = Array.from({ length: n }, () => []);
  items.forEach((item, i) => chunks[i % n].push(item));
  return chunks;
}

async function launchBrowser(proxy) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  if (proxy) args.push(`--proxy-server=${proxy.host}:${proxy.port}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args,
  });
  const page = await browser.newPage();
  if (proxy?.username) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  return { browser, page };
}

async function fetchFollowers(page, handle) {
  const url = `https://www.instagram.com/${encodeURIComponent(handle)}/embed/`;
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 900));
  const text = await page.evaluate(() =>
    (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
  );
  const parsed = parseFollowers(text);
  if (parsed === null && resp && resp.status() === 429) {
    return { rateLimited: true, followers: null };
  }
  return { rateLimited: false, followers: parsed === null ? 0 : parsed };
}

async function processShard(shard, proxy, workerId, total, onResult) {
  const label = proxy ? `proxy-${proxy.id}` : 'direct';
  const { browser, page } = await launchBrowser(proxy);
  const results = [];

  try {
    for (let i = 0; i < shard.length; i++) {
      const artist = shard[i];
      const key = artist.handle.toLowerCase();
      process.stdout.write(`[${label} ${i + 1}/${shard.length}] ${artist.handle} ... `);

      let followers = 0;
      try {
        let attempt = 0;
        while (attempt < 3) {
          const { rateLimited, followers: parsed } = await fetchFollowers(page, artist.handle);
          if (rateLimited) {
            attempt += 1;
            console.log(`rate-limited, cooling ${COOLDOWN_MS / 1000}s (attempt ${attempt})`);
            await new Promise((r) => setTimeout(r, COOLDOWN_MS));
            continue;
          }
          followers = parsed;
          break;
        }
        console.log(followers);
      } catch (err) {
        console.log(`error (${err.message})`);
        followers = 0;
      }

      const entry = {
        ...artist,
        followers,
        instagram: `https://www.instagram.com/${artist.handle}/`,
      };
      results.push(entry);
      onResult(key, entry);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  return results;
}

function writeOutput(artists, resultMap, onlyMissing, existing) {
  const merged = artists.map((artist) => {
    const key = artist.handle.toLowerCase();
    if (resultMap.has(key)) return resultMap.get(key);
    if (onlyMissing && existing[key] > 0) {
      return {
        ...artist,
        followers: existing[key],
        instagram: `https://www.instagram.com/${artist.handle}/`,
      };
    }
    return {
      ...artist,
      followers: onlyMissing ? existing[key] || 0 : 0,
      instagram: `https://www.instagram.com/${artist.handle}/`,
    };
  });
  merged.sort((a, b) => b.followers - a.followers);
  fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2) + '\n');
}

async function main() {
  if (!CHROME) {
    console.error('Chrome not found. Set CHROME_PATH or install google-chrome.');
    process.exit(1);
  }

  const artists = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const onlyMissing = process.argv.includes('--only-missing');
  const proxies = loadProxies();
  const workerCount = Math.max(1, proxies.length || 1);

  let existing = {};
  if (onlyMissing && fs.existsSync(OUTPUT)) {
    for (const a of JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))) {
      existing[a.handle.toLowerCase()] = a.followers || 0;
    }
  }

  const toFetch = onlyMissing
    ? artists.filter((a) => !(existing[a.handle.toLowerCase()] > 0))
    : artists;

  if (toFetch.length === 0) {
    console.log('Nothing to fetch.');
    return;
  }

  console.log(
    `Fetching ${toFetch.length} profiles using ${proxies.length || 1} worker(s) (${onlyMissing ? 'only-missing' : 'all'})`
  );

  const shards = chunkRoundRobin(toFetch, workerCount);
  const resultMap = new Map();
  let writeTimer = null;

  const onResult = (key, entry) => {
    resultMap.set(key, entry);
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => writeOutput(artists, resultMap, onlyMissing, existing), 500);
  };

  const workers = shards.map((shard, idx) => {
    const proxy = proxies[idx] || null;
    if (shard.length === 0) return Promise.resolve([]);
    return processShard(shard, proxy, idx + 1, toFetch.length, onResult);
  });

  await Promise.all(workers);
  clearTimeout(writeTimer);
  writeOutput(artists, resultMap, onlyMissing, existing);

  const withCount = [...resultMap.values()].filter((r) => r.followers > 0).length;
  console.log(`\nSaved ${artists.length} artists to ${OUTPUT} (${withCount} fetched with followers)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
