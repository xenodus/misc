#!/usr/bin/env node
/**
 * Discover Singapore bridal makeup artists on TikTok via hashtag pages.
 * Excludes artists already in the Instagram registry (artists-source.json).
 *
 * Usage:
 *   node search-tiktok-artists.js
 *   node search-tiktok-artists.js --dry-run
 *   node search-tiktok-artists.js --hashtags=sgmua,sgbridalmua
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const IG_SOURCE = path.join(ROOT, 'artists-source.json');
const IG_DATA = path.join(ROOT, 'artists.json');
const TT_SOURCE = path.join(ROOT, 'artists-source-tiktok.json');
const TT_OUTPUT = path.join(ROOT, 'artists-tiktok.json');

const CHROME =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find(
    (p) => fs.existsSync(p)
  );

const DEFAULT_HASHTAGS = [
  'sgmua',
  'sgbridalmua',
  'singaporemakeupartist',
  'sgwedding',
  'bridalmakeupsg',
  'singaporemua',
  'sgbrides',
];

const SEED_HANDLES = [
  'g3bridalstudioandacademy',
  'seemrenminasky',
  'fadillahlatiff',
  'queenmakeupartist',
  'sgmakeupartistshermaine',
  'jessgill.makeup',
  'linlinmakeup_25',
  'lynh.mua.sg',
  'tamaramakeupartist_',
  'vlenmakeupartist',
  'giegie_makeup',
  'yinks_artistry',
  'nhi.shin.makeup',
  'shereenbegum_',
  'tasfia.beauty',
  'dhen.mua',
  'trgemua',
];

const SG_KEYWORDS = [
  'singapore',
  'sg ',
  ' sg',
  '🇸🇬',
  '+65',
  'sgmua',
  'sg bride',
  'sg bridal',
  'sgwedding',
];

const MUA_KEYWORDS = [
  'makeup artist',
  'makeupartist',
  'mua',
  'bridal',
  'make up artist',
  'make-up artist',
  'makeup & hair',
  'makeup and hair',
  'hmua',
  'makeover',
];

const NON_MUA_KEYWORDS = [
  'photographer',
  'photography',
  'wedding planner',
  'bridal boutique',
  'gown rental',
  'venue',
  'catering',
  'dj ',
  ' florist',
  'florist ',
  'nail salon',
  'lash tech',
  'skincare clinic',
  'aesthetic clinic',
  'dental',
  'fitness coach',
  'real estate',
  'on the beat',
  'onthebeat',
  'music producer',
  'content creator only',
  'marketplace',
  'wedding marketplace',
  'content creator',
  'bridal haven',
  'dream dress',
  'charleston',
];

function normalizeHandle(handle) {
  return String(handle || '').replace(/^@/, '').trim().toLowerCase();
}

function loadInstagramRegistry() {
  const source = JSON.parse(fs.readFileSync(IG_SOURCE, 'utf8'));
  const enriched = fs.existsSync(IG_DATA) ? JSON.parse(fs.readFileSync(IG_DATA, 'utf8')) : [];

  const handles = new Set();
  const names = new Set();
  const tiktokFromIg = new Set();

  for (const artist of source) {
    handles.add(normalizeHandle(artist.handle));
    names.add(artist.name.toLowerCase().trim());
  }

  for (const artist of enriched) {
    handles.add(normalizeHandle(artist.handle));
    names.add(artist.name.toLowerCase().trim());
    const desc = artist.description || '';
    const tiktokMatches = desc.match(/(?:tiktok|tt)\s*[:@]?\s*@?([a-z0-9._]+)/gi) || [];
    for (const match of tiktokMatches) {
      const h = match.replace(/.*@/, '').trim();
      if (h) tiktokFromIg.add(normalizeHandle(h));
    }
    const atMatches = desc.match(/@([a-z0-9._]+)/gi) || [];
    for (const match of atMatches) {
      tiktokFromIg.add(normalizeHandle(match.replace('@', '')));
    }
  }

  return { handles, names, tiktokFromIg };
}

function isInstagramDuplicate(handle, nickname, igRegistry) {
  const h = normalizeHandle(handle);
  if (igRegistry.handles.has(h)) return 'same-handle';
  if (igRegistry.tiktokFromIg.has(h)) return 'linked-in-ig-bio';

  const nick = (nickname || '').toLowerCase().trim();
  if (nick && igRegistry.names.has(nick)) return 'same-name';

  return null;
}

function matchesSingapore(signature, nickname) {
  const text = `${signature || ''} ${nickname || ''}`.toLowerCase();
  return SG_KEYWORDS.some((kw) => text.includes(kw));
}

function matchesMua(signature, nickname) {
  const text = `${signature || ''} ${nickname || ''}`.toLowerCase();
  if (NON_MUA_KEYWORDS.some((kw) => text.includes(kw))) return false;
  return MUA_KEYWORDS.some((kw) => text.includes(kw));
}

function hasBio(signature) {
  return Boolean((signature || '').trim());
}

function parseUniversalProfile(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!el) return null;
    const data = JSON.parse(el.textContent);
    const userDetail = data['__DEFAULT_SCOPE__']?.['webapp.user-detail'] || {};
    const user = userDetail.userInfo?.user;
    const stats = userDetail.userInfo?.stats || {};
    if (!user?.uniqueId) return null;
    return {
      handle: user.uniqueId,
      name: user.nickname || user.uniqueId,
      description: user.signature || '',
      followers: stats.followerCount || 0,
      videoCount: stats.videoCount || 0,
      privateAccount: Boolean(user.privateAccount || user.secret),
    };
  });
}

async function createBrowser() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,900'],
  });
  return browser;
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  return page;
}

async function scrapeHashtagHandles(page, hashtag) {
  const url = `https://www.tiktok.com/tag/${encodeURIComponent(hashtag)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  return page.evaluate(() =>
    [...new Set(
      Array.from(document.querySelectorAll('a[href*="/@"]'))
        .map((a) => a.href.match(/@([^/?]+)/)?.[1])
        .filter(Boolean)
    )]
  );
}

async function fetchProfile(page, handle) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1000));
    return await parseUniversalProfile(page);
  } catch (err) {
    return { error: err.message, handle };
  }
}

function splitWork(items, buckets) {
  const groups = Array.from({ length: buckets }, () => []);
  items.forEach((item, i) => groups[i % buckets].push(item));
  return groups;
}

async function runWorker(workerId, page, queue, igRegistry, existingByHandle, onResult) {
  for (const { handle, index, total } of queue) {
    process.stdout.write(`[${index}/${total}] [w${workerId}] @${handle} ... `);

    const profile = await fetchProfile(page, handle);
    const { pass, reasons } = evaluateProfile(profile, igRegistry);
    let result;

    if (pass) {
      console.log(`✓ ${profile.name} (${profile.followers} followers)`);
      const prior = existingByHandle.get(normalizeHandle(handle));
      result = {
        accepted: {
          name: profile.name,
          handle: profile.handle,
          ...(prior?.tag ? { tag: prior.tag } : { tag: 'new' }),
        },
      };
    } else {
      console.log(`✗ ${reasons.join(', ')}`);
      result = { rejected: { handle, reasons, name: profile?.name } };
    }

    await onResult(result);
    await new Promise((r) => setTimeout(r, 600));
  }
}

function evaluateProfile(profile, igRegistry) {
  const reasons = [];
  if (!profile || profile.error) {
    return { pass: false, reasons: [profile?.error || 'profile-unavailable'] };
  }
  if (profile.privateAccount) reasons.push('private-account');
  if (!hasBio(profile.description)) reasons.push('no-bio');
  if ((profile.videoCount || 0) < 5) reasons.push('under-5-posts');
  if (!matchesMua(profile.description, profile.name)) reasons.push('not-mua');
  if (!matchesSingapore(profile.description, profile.name)) reasons.push('not-singapore');

  const igDup = isInstagramDuplicate(profile.handle, profile.name, igRegistry);
  if (igDup) reasons.push(`in-instagram-registry:${igDup}`);

  return { pass: reasons.length === 0, reasons };
}

async function main() {
  if (!CHROME) {
    console.error('Chrome not found. Set CHROME_PATH.');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const hashtagArg = process.argv.find((a) => a.startsWith('--hashtags='));
  const hashtags = hashtagArg
    ? hashtagArg.split('=')[1].split(',').map((h) => h.trim()).filter(Boolean)
    : DEFAULT_HASHTAGS;

  const igRegistry = loadInstagramRegistry();
  console.log(`Instagram registry: ${igRegistry.handles.size} handles`);

  const browser = await createBrowser();
  const page = await createPage(browser);
  const discovered = new Set(SEED_HANDLES.map(normalizeHandle));

  try {
    for (const hashtag of hashtags) {
      console.log(`\nScraping #${hashtag}...`);
      try {
        const handles = await scrapeHashtagHandles(page, hashtag);
        console.log(`  Found ${handles.length} handles`);
        handles.forEach((h) => discovered.add(normalizeHandle(h)));
      } catch (err) {
        console.warn(`  Failed #${hashtag}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  } finally {
    await browser.close();
  }

  const candidates = [...discovered].filter(Boolean);
  console.log(`\n${candidates.length} unique candidate handles to evaluate`);

  const existingSource = fs.existsSync(TT_SOURCE)
    ? JSON.parse(fs.readFileSync(TT_SOURCE, 'utf8'))
    : [];
  const existingByHandle = new Map(
    existingSource.map((a) => [normalizeHandle(a.handle), a])
  );

  const accepted = [];
  const rejected = [];
  const workerCount = Math.min(4, Math.max(1, parseInt(process.env.WORKERS || '3', 10)));

  const browser2 = await createBrowser();
  const pages = await Promise.all(
    Array.from({ length: workerCount }, () => createPage(browser2))
  );

  const queue = candidates.map((handle, i) => ({
    handle,
    index: i + 1,
    total: candidates.length,
  }));
  const groups = splitWork(queue, workerCount);

  try {
    await Promise.all(
      groups.map((group, i) =>
        runWorker(i + 1, pages[i], group, igRegistry, existingByHandle, async (result) => {
          if (result.accepted) accepted.push(result.accepted);
          if (result.rejected) rejected.push(result.rejected);
        })
      )
    );
  } finally {
    await browser2.close();
  }

  accepted.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\nAccepted: ${accepted.length}`);
  console.log(`Rejected: ${rejected.length}`);

  if (dryRun) {
    console.log('\nDry run — not writing files.');
    console.log(JSON.stringify(accepted, null, 2));
    return;
  }

  fs.writeFileSync(TT_SOURCE, JSON.stringify(accepted, null, 2) + '\n');
  console.log(`\nWrote ${accepted.length} artists to ${TT_SOURCE}`);

  if (accepted.length > 0) {
    console.log('Run `node fetch-tiktok-profiles.js` to refresh followers and bios.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
