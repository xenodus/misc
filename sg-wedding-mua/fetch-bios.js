#!/usr/bin/env node
/**
 * Fetch Instagram profile bios (biography) into artists.json as `description`.
 *
 * Uses curl against Instagram's public web_profile_info endpoint (Node fetch is
 * rate-limited more aggressively from this environment).
 *
 * Proxies (optional):
 * - Reads DEDICATED_PROXY_1 .. DEDICATED_PROXY_7 (http:// or socks5:// URLs)
 * - Round-robins through slots 1 → 2 → … → 7 → 1 (one proxy per lookup)
 * - Empty slots use direct egress for that lookup
 * - Falls back to direct egress when none are set
 *
 * Throttling:
 * - Concurrency is always 1 (lookups run sequentially)
 * - Each lookup takes at least MIN_LOOKUP_MS (default 1s): if a request finishes
 *   in 0.2s, the script waits 0.8s before starting the next lookup
 * - Backs off on HTTP 401/429 (default 5s, escalates up to 3x on streaks)
 *
 * Usage:
 *   node fetch-bios.js
 *   node fetch-bios.js --only-missing
 *   MIN_LOOKUP_MS=1000 BACKOFF_MS=5000 node fetch-bios.js --only-missing
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');

const ROOT = __dirname;
const ARTISTS_PATH = path.join(ROOT, 'artists.json');
const PROGRESS_PATH = path.join(ROOT, 'bios-progress.jsonl');

const MIN_LOOKUP_MS = Number(process.env.MIN_LOOKUP_MS || process.env.DELAY_MS || 1000);
const BACKOFF_MS = Number(process.env.BACKOFF_MS || 5000);
const CONCURRENCY = 1;
const PROXY_SLOT_COUNT = 7;
const UA = 'Mozilla/5.0';
const ENDPOINT = (h) =>
  `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntilMinLookupElapsed(startedAt) {
  const wait = Math.max(0, MIN_LOOKUP_MS - (Date.now() - startedAt));
  if (wait > 0) await sleep(wait);
}

function loadProxySlots() {
  const slots = Array(PROXY_SLOT_COUNT).fill(null);
  for (let i = 1; i <= PROXY_SLOT_COUNT; i++) {
    const raw = (process.env[`DEDICATED_PROXY_${i}`] || '').trim();
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if (!u.hostname) throw new Error('missing host');
      slots[i - 1] = {
        slot: i,
        url: raw,
        label: `DEDICATED_PROXY_${i}(${u.protocol}//${u.hostname}:${u.port || ''})`,
      };
    } catch (err) {
      console.warn(`Ignoring invalid DEDICATED_PROXY_${i}: ${err.message}`);
    }
  }
  return slots;
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

function createFetcher(slots) {
  let cursor = 0;

  function nextProxy() {
    const slotIndex = cursor;
    cursor = (cursor + 1) % PROXY_SLOT_COUNT;
    return { proxy: slots[slotIndex], slot: slotIndex + 1 };
  }

  function fetchBio(handle) {
    const { proxy, slot } = nextProxy();
    const url = ENDPOINT(handle);
    const { status, text, error, stderr } = curlGet(url, proxy);
    const via = proxy ? proxy.label : `direct(slot ${slot})`;

    if (error) {
      return { status: `exception:${error}`, description: '', proxy: via, proxySlot: slot };
    }

    if (status === 401 || status === 429) {
      return { status: `http_${status}`, description: '', rateLimited: true, proxy: via, proxySlot: slot };
    }
    if (status !== 200) {
      if (stderr) process.stdout.write(`(${via} http_${status}) `);
      return { status: `http_${status}`, description: '', proxy: via, proxySlot: slot };
    }

    try {
      const json = JSON.parse(text);
      const user = json?.data?.user;
      if (!user) return { status: 'no_user', description: '', proxy: via, proxySlot: slot };
      return {
        status: 'ok',
        description: user.biography || '',
        full_name: user.full_name || '',
        category: user.category_name || user.business_category_name || null,
        followers: user.edge_followed_by?.count ?? null,
        proxy: via,
        proxySlot: slot,
      };
    } catch {
      return { status: 'parse_fail', description: '', proxy: via, proxySlot: slot };
    }
  }

  return { fetchBio, configuredProxyCount: slots.filter(Boolean).length };
}

async function main() {
  if (CONCURRENCY !== 1) {
    console.error('This script only supports concurrency=1 to protect against rate limits.');
    process.exit(1);
  }

  const proxySlots = loadProxySlots();
  const { fetchBio, configuredProxyCount } = createFetcher(proxySlots);
  if (configuredProxyCount) {
    console.log(
      `Using ${configuredProxyCount}/${PROXY_SLOT_COUNT} dedicated proxies (round-robin 1→7): ${proxySlots
        .filter(Boolean)
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
    `Fetching bios for ${todo.length}/${artists.length} artists (concurrency=${CONCURRENCY}, min_lookup=${MIN_LOOKUP_MS}ms, backoff=${BACKOFF_MS}ms)`
  );

  let ok = 0;
  let fail = 0;
  let consecutiveAuthFails = 0;

  for (let i = 0; i < todo.length; i++) {
    const lookupStartedAt = Date.now();
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
      proxySlot: result.proxySlot || null,
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
    } else {
      fail++;
      console.log(result.status);
      const authFail = result.rateLimited || /http_401|http_429/.test(result.status);
      if (authFail) {
        consecutiveAuthFails++;
        const wait = BACKOFF_MS * Math.min(consecutiveAuthFails, 3);
        console.log(`  rate-limited; backing off ${Math.round(wait / 1000)}s`);
        await waitUntilMinLookupElapsed(lookupStartedAt);
        await sleep(wait);
        continue;
      }
      consecutiveAuthFails = 0;
    }

    await waitUntilMinLookupElapsed(lookupStartedAt);
  }

  const withDesc = artists.filter((a) => (a.description || '').trim()).length;
  console.log(`\nDone. ok=${ok} fail=${fail}. artists.json now has ${withDesc}/${artists.length} descriptions.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
