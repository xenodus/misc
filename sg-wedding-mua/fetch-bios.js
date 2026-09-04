#!/usr/bin/env node
/**
 * Fetch Instagram profile bios (biography) into artists.json as `description`.
 *
 * Uses curl against Instagram's public web_profile_info endpoint (Node fetch is
 * rate-limited more aggressively from this environment).
 *
 * Proxies (optional):
 * - Reads DEDICATED_PROXY_1 .. DEDICATED_PROXY_7 (http:// or socks5:// URLs)
 * - Round-robins across available proxies; rotates on 401/429
 * - Falls back to direct egress when none are set
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
const { spawnSync } = require('child_process');
const { URL } = require('url');

const ROOT = __dirname;
const ARTISTS_PATH = path.join(ROOT, 'artists.json');
const PROGRESS_PATH = path.join(ROOT, 'bios-progress.jsonl');

const DELAY_MS = Number(process.env.DELAY_MS || 1000);
const BACKOFF_MS = Number(process.env.BACKOFF_MS || 5000);
const JITTER_MS = Number(process.env.JITTER_MS || 500);
const CONCURRENCY = 1;
const UA = 'Mozilla/5.0';
const ENDPOINTS = [
  (h) => `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`,
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jittered(ms) {
  return ms + Math.floor(Math.random() * JITTER_MS);
}

function loadProxies() {
  const proxies = [];
  for (let i = 1; i <= 7; i++) {
    const raw = (process.env[`DEDICATED_PROXY_${i}`] || '').trim();
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (!u.hostname) throw new Error('missing host');
      proxies.push({
        index: i,
        url: raw,
        label: `DEDICATED_PROXY_${i}(${u.protocol}//${u.hostname}:${u.port || ''})`,
      });
    } catch (err) {
      console.warn(`Ignoring invalid DEDICATED_PROXY_${i}: ${err.message}`);
    }
  }
  return proxies;
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

function curlGet(url, proxy) {
  const bodyPath = path.join('/tmp', `ig-bio-${process.pid}-${Date.now()}.json`);
  const args = [
    '-sS',
    '-m',
    '45',
    '-o',
    bodyPath,
    '-w',
    '%{http_code}',
    '-A',
    UA,
    '-H',
    'X-IG-App-ID: 936619743392459',
    '-H',
    'Accept: */*',
  ];
  if (proxy) {
    args.push('-x', proxy.url);
  }
  args.push(url);

  const result = spawnSync('curl', args, { encoding: 'utf8' });

  const status = Number((result.stdout || '').trim());
  let text = '';
  try {
    if (fs.existsSync(bodyPath)) {
      text = fs.readFileSync(bodyPath, 'utf8');
      fs.unlinkSync(bodyPath);
    }
  } catch {
    // ignore cleanup errors
  }

  if (result.error) {
    return { status: 0, text: '', error: result.error.message };
  }
  if (result.status !== 0 && !status) {
    return { status: 0, text: '', error: (result.stderr || '').trim() || `curl_exit_${result.status}` };
  }
  return { status, text, stderr: (result.stderr || '').trim() };
}

function createFetcher(proxies) {
  let cursor = 0;

  function nextProxy() {
    if (!proxies.length) return null;
    const proxy = proxies[cursor % proxies.length];
    cursor += 1;
    return proxy;
  }

  function rotateAfterFailure() {
    // Force next request onto a different proxy when we have more than one.
    if (proxies.length > 1) cursor += 0; // already advanced in nextProxy
  }

  function fetchBio(handle) {
    let lastStatus = 'no_response';
    const attempts = Math.max(1, proxies.length || 1);

    for (let attempt = 0; attempt < attempts; attempt++) {
      const proxy = nextProxy();
      const url = ENDPOINTS[0](handle);
      const { status, text, error, stderr } = curlGet(url, proxy);
      const via = proxy ? proxy.label : 'direct';

      if (error) {
        lastStatus = `exception:${error}`;
        console.log(`\n  ${via} error: ${error}`);
        rotateAfterFailure();
        continue;
      }

      lastStatus = `http_${status}`;
      if (status === 401 || status === 429) {
        // Try remaining proxies immediately before declaring rate-limited.
        if (attempt < attempts - 1) {
          process.stdout.write(`(${via} ${lastStatus}, rotate) `);
          continue;
        }
        return { status: lastStatus, description: '', rateLimited: true, proxy: via };
      }
      if (status !== 200) {
        if (stderr) process.stdout.write(`(${via} ${lastStatus}) `);
        continue;
      }

      try {
        const json = JSON.parse(text);
        const user = json?.data?.user;
        if (!user) return { status: 'no_user', description: '', proxy: via };
        return {
          status: 'ok',
          description: user.biography || '',
          full_name: user.full_name || '',
          category: user.category_name || user.business_category_name || null,
          followers: user.edge_followed_by?.count ?? null,
          proxy: via,
        };
      } catch {
        lastStatus = 'parse_fail';
      }
    }
    return { status: lastStatus, description: '' };
  }

  return { fetchBio, proxyCount: proxies.length };
}

async function main() {
  if (CONCURRENCY !== 1) {
    console.error('This script only supports concurrency=1 to protect against rate limits.');
    process.exit(1);
  }

  const proxies = loadProxies();
  const { fetchBio, proxyCount } = createFetcher(proxies);
  if (proxyCount) {
    console.log(
      `Using ${proxyCount} dedicated prox${proxyCount === 1 ? 'y' : 'ies'}: ${proxies
        .map((p) => p.label)
        .join(', ')}`
    );
  } else {
    console.warn(
      'No DEDICATED_PROXY_1..7 set; using direct egress (likely to hit Instagram rate limits).'
    );
  }

  const onlyMissing = process.argv.includes('--only-missing');
  const artists = JSON.parse(fs.readFileSync(ARTISTS_PATH, 'utf8'));
  const progress = loadProgress();

  let seeded = 0;
  for (const artist of artists) {
    const prev = progress[artist.handle.toLowerCase()];
    if (prev?.status === 'ok' && prev.description != null && !(artist.description || '').trim()) {
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
      result = fetchBio(artist.handle);
    } catch (err) {
      result = { status: 'exception', description: '', err: err.message };
    }

    const row = {
      handle: artist.handle,
      status: result.status,
      description: result.description || '',
      full_name: result.full_name || null,
      category: result.category || null,
      proxy: result.proxy || null,
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
