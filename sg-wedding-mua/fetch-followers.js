#!/usr/bin/env node
/**
 * Refresh Instagram follower counts via public /embed/ pages.
 * StarNgage only indexes a small subset of bridal MUA accounts;
 * embed pages expose "N followers" for public profiles without login.
 *
 * Proxies: set DEDICATED_PROXY_1 .. DEDICATED_PROXY_7 as host|port|username|password
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const SOURCE = path.join(ROOT, 'artists-source.json');
const OUTPUT = path.join(ROOT, 'artists.json');
const DELAY_MS = 1500;
const CHROME =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find(
    (p) => fs.existsSync(p)
  );

function parseProxyEnv(value) {
  if (!value || !value.trim()) return null;
  const parts = value.trim().split('|');
  if (parts.length < 4) return null;
  const [host, port, username, password] = parts;
  if (!host || !port) return null;
  return { host, port, username, password, server: `${host}:${port}` };
}

function loadProxies() {
  const proxies = [];
  for (let i = 1; i <= 7; i++) {
    const proxy = parseProxyEnv(process.env[`DEDICATED_PROXY_${i}`]);
    if (proxy) proxies.push({ ...proxy, index: i });
  }
  return proxies;
}

function filterHealthyProxies(proxies) {
  const healthy = [];
  for (const proxy of proxies) {
    const proxyUrl = `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.host}:${proxy.port}`;
    try {
      const code = execFileSync(
        'curl',
        ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', '-x', proxyUrl, 'https://www.instagram.com/instagram/embed/'],
        { encoding: 'utf8' }
      ).trim();
      if (code === '200') {
        healthy.push(proxy);
        console.log(`Proxy ${proxy.index} (${proxy.host}) OK`);
      } else {
        console.warn(`Proxy ${proxy.index} (${proxy.host}) skipped (HTTP ${code})`);
      }
    } catch {
      console.warn(`Proxy ${proxy.index} (${proxy.host}) skipped (connection failed)`);
    }
  }
  return healthy;
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

function instagramUrl(handle) {
  return `https://www.instagram.com/${handle}/`;
}

async function createBrowser(proxy) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  if (proxy) args.push(`--proxy-server=http://${proxy.server}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args,
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  if (proxy?.username) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }
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
    return { followers: null, rateLimited: true };
  }
  return { followers: parsed === null ? 0 : parsed, rateLimited: false };
}

function splitWork(items, buckets) {
  const groups = Array.from({ length: buckets }, () => []);
  items.forEach((item, i) => groups[i % buckets].push(item));
  return groups;
}

function writeOutput(artists, resultsByHandle, existing, onlyMissing, existingRecords) {
  const merged = artists.map((artist) => {
    const key = artist.handle.toLowerCase();
    const prior = existingRecords[key] || {};
    const base = {
      ...artist,
      instagram: prior.instagram || instagramUrl(artist.handle),
      ...(prior.description ? { description: prior.description } : {}),
    };
    if (Object.prototype.hasOwnProperty.call(resultsByHandle, key)) {
      return { ...base, followers: resultsByHandle[key] };
    }
    return {
      ...base,
      followers: onlyMissing ? existing[key] || 0 : 0,
    };
  });
  merged.sort((a, b) => b.followers - a.followers);
  fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2) + '\n');
}

async function runWorker(workerId, proxy, queue, resultsByHandle, onResult) {
  const label = proxy ? `proxy-${workerId} (${proxy.host})` : `direct-${workerId}`;
  let browser;
  let page;
  try {
    ({ browser, page } = await createBrowser(proxy));

    for (const { artist, index, total } of queue) {
      const key = artist.handle.toLowerCase();
      process.stdout.write(`[${index}/${total}] [${label}] ${artist.handle} ... `);

      let followers = 0;
      try {
        let attempt = 0;
        while (attempt < 3) {
          const { followers: parsed, rateLimited } = await fetchFollowers(page, artist.handle);
          if (rateLimited) {
            attempt += 1;
            console.log(`rate-limited, cooling 20s (attempt ${attempt})`);
            await new Promise((r) => setTimeout(r, 20000));
            continue;
          }
          followers = parsed === null ? 0 : parsed;
          break;
        }
        console.log(followers);
      } catch (err) {
        console.log(`error (${err.message})`);
        followers = 0;
      }

      resultsByHandle[key] = followers;
      await onResult();
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } finally {
    if (browser) await browser.close();
  }
}

async function main() {
  if (!CHROME) {
    console.error('Chrome not found. Set CHROME_PATH or install google-chrome.');
    process.exit(1);
  }

  const proxies = filterHealthyProxies(loadProxies());
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
  const onlyMissing = process.argv.includes('--only-missing');

  const artists = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  let existing = {};
  let existingRecords = {};
  if (fs.existsSync(OUTPUT)) {
    for (const a of JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))) {
      const key = a.handle.toLowerCase();
      existing[key] = a.followers || 0;
      existingRecords[key] = a;
    }
  }

  let toFetch = artists.map((artist, i) => ({ artist, index: i + 1, total: artists.length }));
  if (onlyMissing) {
    toFetch = toFetch.filter(({ artist }) => !(existing[artist.handle.toLowerCase()] > 0));
  }
  if (limit && limit > 0) {
    toFetch = toFetch.slice(0, limit);
  }

  if (toFetch.length === 0) {
    console.log('Nothing to fetch.');
    return;
  }

  console.log(
    `Fetching ${toFetch.length} profile(s) via ${proxies.length ? proxies.length + ' proxy worker(s)' : 'direct connection'}`
  );

  const resultsByHandle = { ...existing };
  const workerCount = Math.max(1, proxies.length || 1);
  const proxySlots = proxies.length ? proxies : [null];
  const groups = splitWork(toFetch, workerCount);

  let writeChain = Promise.resolve();
  const onResult = () => {
    writeChain = writeChain.then(() =>
      writeOutput(artists, resultsByHandle, existing, onlyMissing, existingRecords)
    );
    return writeChain;
  };

  await Promise.all(
    groups.map((queue, i) =>
      runWorker(i + 1, proxySlots[i % proxySlots.length], queue, resultsByHandle, onResult)
    )
  );

  writeOutput(artists, resultsByHandle, existing, onlyMissing, existingRecords);
  const fetched = toFetch.map(({ artist }) => artist.handle.toLowerCase());
  const withCount = fetched.filter((key) => resultsByHandle[key] > 0).length;
  console.log(`\nSaved ${artists.length} artists to ${OUTPUT} (${withCount}/${fetched.length} newly fetched with followers)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
