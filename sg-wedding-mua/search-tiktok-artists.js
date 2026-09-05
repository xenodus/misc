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
  'sgbridal',
  'sgbridemakeup',
  'sgweddingmakeup',
  'sgmakeupartist',
  'sgmakeup',
  'bridalmakeupsingapore',
  'weddingmakeupsg',
  'makeupartistsg',
  'sgbride',
  'sgweddingmua',
  'bridalmua',
  'bridalmakeup',
  'weddingmua',
  'makeupartistsg',
  'sgmakeupartists',
  'sgbridalmakeupartist',
  'makeupbysg',
  'sgbeauty',
];

const SEARCH_QUERIES = [
  'singapore bridal makeup artist',
  'singapore wedding makeup artist',
  'sg bridal mua',
  'singapore mua bridal',
  'sg makeup artist wedding',
  'bridal makeup singapore',
  'wedding makeup singapore',
  'sg bridal makeup',
  'makeup artist singapore bridal',
  'hmua singapore',
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

async function extractHandlesFromPage(page) {
  return page.evaluate(() =>
    [...new Set(
      Array.from(document.querySelectorAll('a[href*="/@"]'))
        .map((a) => a.href.match(/@([^/?]+)/)?.[1])
        .filter(Boolean)
    )]
  );
}

async function scrollPage(page, scrolls = 8, pauseMs = 1200) {
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    await new Promise((r) => setTimeout(r, pauseMs));
  }
}

async function scrapeHashtagHandles(page, hashtag) {
  const url = `https://www.tiktok.com/tag/${encodeURIComponent(hashtag)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await scrollPage(page, 10, 1000);
  return extractHandlesFromPage(page);
}

async function scrapeSearchHandles(page, query) {
  const url = `https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await scrollPage(page, 6, 1000);
  return extractHandlesFromPage(page);
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

async function runWorker(workerId, page, queue, igRegistry, existingByHandle, onResult, maxAccepted) {
  for (const { handle, index, total } of queue) {
    if (maxAccepted > 0 && onResult.acceptedCount >= maxAccepted) break;

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

    await onResult.call(result);
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
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxAccepted = maxArg ? parseInt(maxArg.split('=')[1], 10) : 100;
  const hashtags = hashtagArg
    ? hashtagArg.split('=')[1].split(',').map((h) => h.trim()).filter(Boolean)
    : DEFAULT_HASHTAGS;

  const existingSource = fs.existsSync(TT_SOURCE)
    ? JSON.parse(fs.readFileSync(TT_SOURCE, 'utf8'))
    : [];
  const existingByHandle = new Map(
    existingSource.map((a) => [normalizeHandle(a.handle), a])
  );

  const igRegistry = loadInstagramRegistry();
  console.log(`Instagram registry: ${igRegistry.handles.size} handles`);
  console.log(`Existing TikTok source: ${existingSource.length} artists`);
  if (maxAccepted > 0) console.log(`Target: up to ${maxAccepted} accepted artists`);

  const browser = await createBrowser();
  const page = await createPage(browser);
  const discovered = new Set([
    ...SEED_HANDLES.map(normalizeHandle),
    ...existingSource.map((a) => normalizeHandle(a.handle)),
  ]);

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

    for (const query of SEARCH_QUERIES) {
      console.log(`\nSearching "${query}"...`);
      try {
        const handles = await scrapeSearchHandles(page, query);
        console.log(`  Found ${handles.length} handles`);
        handles.forEach((h) => discovered.add(normalizeHandle(h)));
      } catch (err) {
        console.warn(`  Failed search "${query}": ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  } finally {
    await browser.close();
  }

  const candidates = [...discovered].filter(Boolean);
  console.log(`\n${candidates.length} unique candidate handles to evaluate`);

  const accepted = [];
  const rejected = [];
  const acceptedHandles = new Set();
  const onResult = {
    acceptedCount: 0,
    async call(result) {
      if (result.accepted) {
        const key = normalizeHandle(result.accepted.handle);
        if (!acceptedHandles.has(key)) {
          acceptedHandles.add(key);
          accepted.push(result.accepted);
          this.acceptedCount = accepted.length;
        }
      }
      if (result.rejected) rejected.push(result.rejected);
    },
  };

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
        runWorker(i + 1, pages[i], group, igRegistry, existingByHandle, onResult, maxAccepted)
      )
    );
  } finally {
    await browser2.close();
  }

  accepted.sort((a, b) => a.name.localeCompare(b.name));

  const finalList = accepted;

  console.log(`\nAccepted: ${finalList.length}`);
  console.log(`Rejected: ${rejected.length}`);

  if (dryRun) {
    console.log('\nDry run — not writing files.');
    console.log(JSON.stringify(finalList, null, 2));
    return;
  }

  fs.writeFileSync(TT_SOURCE, JSON.stringify(finalList, null, 2) + '\n');
  console.log(`\nWrote ${finalList.length} artists to ${TT_SOURCE}`);

  if (finalList.length > 0) {
    console.log('Run `node fetch-tiktok-profiles.js` to refresh followers and bios.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
