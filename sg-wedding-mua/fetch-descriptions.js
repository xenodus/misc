#!/usr/bin/env node
/**
 * Fetch Instagram profile bios via dedicated proxies (DEDICATED_PROXY_1..N).
 * Puppeteer fallback when the web_profile_info API is rate-limited.
 */
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const ARTISTS_PATH = path.join(ROOT, 'artists.json');
const DELAY_MS = 1200;
const CHROME =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find(
    (p) => fs.existsSync(p)
  );

function parseProxyEnv(value) {
  if (!value || !value.trim()) return null;
  const raw = value.trim();
  if (raw.includes('|')) {
    const [host, port, username, password] = raw.split('|');
    if (!host || !port || !username || !password) return null;
    return { host, port, username, password, server: `http://${host}:${port}` };
  }
  try {
    const u = new URL(raw);
    if (!u.hostname) return null;
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return {
      host: u.hostname,
      port: String(port),
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      server: `${u.protocol}//${u.hostname}:${port}`,
    };
  } catch {
    return null;
  }
}

function loadProxies({ residentialOnly = false } = {}) {
  const proxies = [];
  if (!residentialOnly) {
    for (let i = 1; i <= 20; i++) {
      const proxy = parseProxyEnv(process.env[`DEDICATED_PROXY_${i}`]);
      if (proxy) proxies.push({ ...proxy, label: `DEDICATED_PROXY_${i}` });
    }
  }
  const residential = parseProxyEnv(process.env.RESIDENTIAL_PROXY_1);
  if (residential) proxies.push({ ...residential, label: 'RESIDENTIAL_PROXY_1' });
  return proxies;
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#064;/g, '@')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseDescription(text) {
  if (!text) return '';
  const decoded = decodeHtml(text).replace(/\s+/g, ' ').trim();
  if (/Performing security verification|Enable JavaScript|HTTP ERROR 429/i.test(decoded)) return null;
  if (/profile may be broken|profile may have been removed|Page isn't available|Sorry, this page/i.test(decoded)) {
    return '';
  }
  const quoted = decoded.match(/on Instagram:\s*"([\s\S]*)"\s*$/i);
  if (quoted) return quoted[1].replace(/\\n/g, '\n').trim();
  if (/See Instagram photos and videos from/i.test(decoded)) return '';
  return '';
}

async function createBrowser(proxy) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--proxy-server=${proxy.server}`,
    ],
  });
  const page = await browser.newPage();
  await page.authenticate({ username: proxy.username, password: proxy.password });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  return { browser, page };
}

async function fetchDescription(page, handle) {
  const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 900));
  const meta = await page.evaluate(() => ({
    og: document.querySelector('meta[property="og:description"]')?.content || '',
    desc: document.querySelector('meta[name="description"]')?.content || '',
  }));
  const parsed = parseDescription(meta.desc || meta.og);
  if (parsed === null && resp && resp.status() === 429) {
    return { description: null, rateLimited: true };
  }
  return { description: parsed === null ? '' : parsed, rateLimited: false };
}

function writeArtists(artists) {
  const sorted = [...artists].sort((a, b) => (b.followers || 0) - (a.followers || 0));
  fs.writeFileSync(ARTISTS_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

async function worker(workerId, proxy, artists, allArtists, onUpdate) {
  let browser;
  let page;
  try {
    ({ browser, page } = await createBrowser(proxy));
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const key = artist.handle.toLowerCase();
      process.stdout.write(`[w${workerId} ${i + 1}/${artists.length}] ${artist.handle} ... `);

      let description = '';
      try {
        let attempts = 0;
        while (attempts < 3) {
          const result = await fetchDescription(page, artist.handle);
          if (result.rateLimited) {
            attempts += 1;
            console.log(`rate-limited, cooling 20s (attempt ${attempts})`);
            await new Promise((r) => setTimeout(r, 20000));
            continue;
          }
          description = result.description;
          break;
        }
        console.log(description ? `"${description.slice(0, 60)}${description.length > 60 ? '…' : ''}"` : '(empty)');
      } catch (err) {
        console.log(`error (${err.message})`);
      }

      const idx = allArtists.findIndex((a) => a.handle.toLowerCase() === key);
      if (idx >= 0) allArtists[idx] = { ...allArtists[idx], description };
      onUpdate();
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

  const residentialOnly = process.argv.includes('--residential-only');
  const proxies = loadProxies({ residentialOnly });
  if (!proxies.length) {
    console.error(
      'No proxies found. Set DEDICATED_PROXY_1..N and/or RESIDENTIAL_PROXY_1 (host|port|user|pass or URL).'
    );
    process.exit(1);
  }
  if (residentialOnly) {
    console.log('Using residential proxy only (RESIDENTIAL_PROXY_1)');
  } else if (proxies.some((p) => p.label === 'RESIDENTIAL_PROXY_1')) {
    console.log('Including RESIDENTIAL_PROXY_1 as fallback worker');
  }

  const onlyMissing = process.argv.includes('--only-missing');
  const allArtists = JSON.parse(fs.readFileSync(ARTISTS_PATH, 'utf8'));
  const toFetch = allArtists.filter((a) => !onlyMissing || !(a.description || '').trim());
  if (!toFetch.length) {
    console.log('All artists already have descriptions.');
    return;
  }

  console.log(`Fetching descriptions for ${toFetch.length} artists using ${proxies.length} proxies`);
  const buckets = proxies.map(() => []);
  toFetch.forEach((artist, i) => buckets[i % proxies.length].push(artist));

  let writeTimer = null;
  const scheduleWrite = () => {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      writeArtists(allArtists);
    }, 250);
  };

  await Promise.all(
    proxies.map((proxy, i) => {
      if (!buckets[i].length) return Promise.resolve();
      return worker(i + 1, proxy, buckets[i], allArtists, scheduleWrite);
    })
  );

  if (writeTimer) clearTimeout(writeTimer);
  writeArtists(allArtists);

  const withDesc = allArtists.filter((a) => (a.description || '').trim()).length;
  console.log(`\nSaved ${allArtists.length} artists (${withDesc} with descriptions)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
