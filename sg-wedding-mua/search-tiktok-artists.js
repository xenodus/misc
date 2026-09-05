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
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  return { browser, page };
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
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));
    return await parseUniversalProfile(page);
  } catch (err) {
    return { error: err.message, handle };
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

  const { browser, page } = await createBrowser();
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
      await new Promise((r) => setTimeout(r, 1000));
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

  const { browser: browser2, page: page2 } = await createBrowser();
  try {
    for (let i = 0; i < candidates.length; i++) {
      const handle = candidates[i];
      process.stdout.write(`[${i + 1}/${candidates.length}] @${handle} ... `);

      const profile = await fetchProfile(page2, handle);
      const { pass, reasons } = evaluateProfile(profile, igRegistry);

      if (pass) {
        console.log(`✓ ${profile.name} (${profile.followers} followers)`);
        const prior = existingByHandle.get(normalizeHandle(handle));
        accepted.push({
          name: profile.name,
          handle: profile.handle,
          ...(prior?.tag ? { tag: prior.tag } : { tag: 'new' }),
        });
      } else {
        console.log(`✗ ${reasons.join(', ')}`);
        rejected.push({ handle, reasons, name: profile?.name });
      }

      await new Promise((r) => setTimeout(r, 1200));
    }
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
