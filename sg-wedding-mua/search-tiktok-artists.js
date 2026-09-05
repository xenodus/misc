#!/usr/bin/env node
/**
 * Discover Singapore bridal makeup artists on TikTok via hashtag pages.
 * Excludes artists already in the Instagram registry (artists-source.json).
 *
 * Usage:
 *   node search-tiktok-artists.js
 *   node search-tiktok-artists.js --dry-run
 *   node search-tiktok-artists.js --max=200
 *   node search-tiktok-artists.js --crawl-only --max=150
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const IG_SOURCE = path.join(ROOT, 'artists-source.json');
const IG_DATA = path.join(ROOT, 'artists.json');
const TT_SOURCE = path.join(ROOT, 'artists-source-tiktok.json');
const TT_OUTPUT = path.join(ROOT, 'artists-tiktok.json');

const SCROLL_DELAY_MS = parseInt(process.env.SCROLL_DELAY_MS || '500', 10);
const PAGE_DELAY_MS = parseInt(process.env.PAGE_DELAY_MS || '1200', 10);
const PROFILE_DELAY_MS = parseInt(process.env.PROFILE_DELAY_MS || '150', 10);
const FETCH_PROFILE_WAIT_MS = parseInt(process.env.FETCH_PROFILE_WAIT_MS || '350', 10);
const STEP_DELAY_MS = parseInt(process.env.STEP_DELAY_MS || '200', 10);
const PROGRESS_INTERVAL_MS = parseInt(process.env.PROGRESS_INTERVAL_MS || '60000', 10);

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
  'sgbridalmakeup',
  'sgmakeupartist',
  'muasg',
  'muasingapore',
  'makeupsg',
  'sgweddingmakeup',
  'sgbridal',
  'bridalsg',
  'sgmakeup',
  'makeupartistsg',
  'makeupartistsingapore',
  'sgbridalmakeupartist',
  'sgweddingmakeupartist',
  'singaporebridalmakeupartist',
  'sgbridalhair',
  'romsg',
  'sgbridestobe',
  'weddingsg',
  'singaporewedding',
  'sgweddings',
  'malayweddingsg',
  'indianweddingsg',
  'chineseweddingsg',
  'sgweddingmakeupbridal',
  'makandamsg',
  'sgigmakeup',
  'weddingmakeupsg',
  'bridalmakeupsingapore',
  'makeupsingapore',
  'bridalmua',
  'weddingmua',
  'sgweddinghair',
  'sgweddingstylist',
  'sgweddingcontent',
  'sgweddingtips',
  'sgweddingguide',
  'sgweddingfair',
  'sgweddingexpo',
  'sgweddingbazaar',
  'sgweddingcommunity',
  'sgweddingnetwork',
  'sgweddingprofessionals',
  'sgweddingservices',
  'sgweddingvendors',
  'sgweddingplanner',
  'sgweddingcoordinator',
  'sgweddingmakeupclass',
  'sgweddingmakeupcourse',
  'sgweddingmakeupacademy',
  'sgweddingmakeuptraining',
  'sgweddingmakeupworkshop',
  'sgweddingmakeuplesson',
  'sgweddingmakeuptutorial',
  'sgweddingmakeupdemo',
  'sgweddingmakeuptransformation',
  'sgweddingmakeupinspo',
  'sgweddingmakeupideas',
  'sgweddingmakeuplook',
  'sgweddingmakeupstyle',
  'sgweddingmakeuptrend',
  'sgweddingmakeupglow',
  'sgweddingmakeupwestern',
  'sgweddingmakeupclassic',
  'sgweddingmakeupmodern',
  'sgweddingmakeupvintage',
  'sgweddingmakeupbohemian',
  'sgweddingmakeupromantic',
  'sgweddingmakeupelegant',
  'sgweddingmakeupminimal',
  'sgweddingmakeupchic',
  'sgweddingmakeupgorgeous',
  'sgweddingmakeupstunning',
  'sgweddingmakeupbeautiful',
  'sgweddingmakeupdreamy',
  'sgweddingmakeupfairytale',
  'sgweddingmakeupprincess',
  'sgweddingmakeupqueen',
  'sgweddingmakeupbride',
];

const SEARCH_QUERIES = [
  'singapore makeup artist',
  'sg bridal mua',
  'singapore bridal makeup',
  'sg mua',
  'makeup artist singapore',
  'bridal makeup singapore',
  'sg wedding makeup',
  'singapore mua bridal',
  'sg makeup artist bridal',
  'freelance mua singapore',
  'sg indian bridal makeup',
  'sg malay bridal makeup',
  'sg chinese bridal makeup',
  'sg korean bridal makeup',
  'sg thai bridal makeup',
  'sg wedding mua',
  'bridal glam singapore',
  'sg bridal hair makeup',
  'sg rom makeup',
  'sg solemnization makeup',
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
  'velvabeautysg',
  'makeupbyhaz_singapore',
  'glowbyziemakeup',
  'ksha.mua',
  'makeupbysyadaahally',
  'meevamakeup',
  'nakedglam.studio',
  'rosiebrennan.makeup',
  'sgmakeupby.azizahh',
  'shimyshimyyeah',
  'mua.sg_',
  'titystellamakeupnbridal',
  'vichwangmua',
  'withloveyumi',
  'angeline_makeups_artis',
  'carorolee.mua',
  'feliarahue',
  'makeyouglamz',
  'nui_daily',
  'siti.jfrii',
  'vanezbeaute',
  'clarasongmakeup',
  '3teemakeup',
  'kenhermannsofficial',
  'melvin_tseng',
  'shaunleelee',
  'heizlearissa',
  'claraslays',
  'makeupbyrashidahmarican',
  'makeuphairbyannabella',
  'stbridalmakeup',
  'dreammakers_makeup',
  'bridalbytiffany',
  'tiffiningbeauty',
  'makeupbysusanliew',
  'chloe_makeup_sg',
  'zoel.makeup',
  'mua.dawn',
  'yukilim_makeupartist',
  'makeup_by_fionab',
  'sasa_hmua_sg',
  'bygabytan',
  'aoismakeup',
  'xara_lee_makeup',
  'zihanmakeup',
  'andriana_jamil',
  'candy__t',
  'minnie_makeupartist3428',
  'ululada.sg',
  'zanncreations_makeup',
  'shinomakeupnhairstyling',
  'canvaseety',
  'kireibeauty.sg',
  'yuhui.13rushes',
  'amber_weng',
  'makeupartistrybyjulie_mua',
  'aesta_makeup',
  'angelgwee',
  'teambride_sg',
  'lovebeautysociety',
  'sue.zb',
  'themakeuproom_sg',
  'elsayan_makeup',
  'dearmuse.makeup',
  'suburbs.studio',
  'candyle.makeup',
  'monikamakeovers.singapore',
  'sandyxsher',
  'yyingcui',
  'juliekimmakeup',
  'veraveralim',
  'cocoonmakeupandhair',
  'sarahlee_autelier',
  'deniseleemakeup',
  'lilimakeupspecialist',
  'angelchuamakeuphair',
  'nishaa_mua',
  'charmainelin_makeup',
  'christinechiamakeup',
  'dblchin',
  'lingspalette',
  'christinetan.makeup',
  'veela_makeup_haiyan',
  'belladonna.artistry',
  'zinnytheint',
  'victoriahan_makeup',
  'saydanar_hmua',
  'adeline.ariel',
  'mooilove_makeup_studio',
  'elitemakeupartistsinc',
  'canvasofglory',
  'stella.ang.makeup',
  'rachelongll',
  'tangyongmakeup',
  'lindalino.makeup',
  'ladyyclairemakeup',
  'muasusan',
  'roseannetangrs',
  'silviana.makeup',
  'adindasardjono',
  'daisysartistry',
  'looksstudio',
  'moninamonisha',
  'autelier_makeup',
  'mahes_mua',
  'cynderellasg',
  'mizroxx',
  'keith_makeup_artist',
  'renugha_m_vadivelu',
  'bypattcia',
  'shobabridals',
  'vivienbeautystudio',
  'nooc.makeup',
  'makeupdoyennes_brides',
  'beautywithoutfilter',
  'makeupmaestrosg',
  'powderpuffedmakeup',
  'jenniswongmakeup',
  'enchantemakeup',
  'atiiqahho',
  'victoriahan_makeup',
  'aesta_makeup',
  'stbridalmakeup',
  'dearmuse.makeup',
  'makeupartistrybyjulie_mua',
  'linlinmakeup_25',
  'giegie_makeup',
  'yinks_artistry',
  'nhi.shin.makeup',
  'shereenbegum_',
  'tasfia.beauty',
  'dhen.mua',
  'trgemua',
  'vlenmakeupartist',
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
  'watch shop',
  'watch store',
  'sgwatch',
  'gown connoisseur',
  'gown rental',
  'proposal journey',
  'wedding planner',
  'event planner',
  'coordination',
  'jewellery',
  'jewelry store',
  'fashion brand',
  'clothing brand',
  'skincare brand',
  'cosmetics brand',
  'beauty brand',
  'salon chain',
  'academy only',
  'training centre',
  'modelling agency',
  'model agency',
  'influencer agency',
  'media company',
  'production house',
  'videographer',
  'wedding video',
  'wedding film',
  'wedding photo',
  'wedding photography',
  'wedding studio',
  'photo studio',
  'hair salon only',
  'nail artist only',
  'lash artist only',
  'brow artist only',
  'pmu only',
  'permanent makeup only',
  'tattoo artist',
  'barber shop',
  'barbershop',
  'spa only',
  'massage',
  'wellness centre',
  'yoga instructor',
  'fitness trainer',
  'personal trainer',
  'life coach',
  'motivational speaker',
  'public speaker',
  'author',
  'writer',
  'blogger only',
  'vlogger only',
  'youtuber only',
  'streamer',
  'gamer',
  'musician',
  'singer',
  'dancer',
  'actor',
  'actress',
  'model only',
  'fashion model',
  'influencer only',
  'brand ambassador only',
  'pr agency',
  'marketing agency',
  'advertising agency',
  'social media agency',
  'digital agency',
  'web design',
  'graphic design',
  'interior design',
  'event decor',
  'event styling only',
  'floral design only',
  'cake designer',
  'baker',
  'caterer',
  'restaurant',
  'hotel',
  'resort',
  'travel agency',
  'tour guide',
  'property agent',
  'real estate agent',
  'insurance agent',
  'financial advisor',
  'lawyer',
  'doctor',
  'dentist',
  'clinic',
  'hospital',
  'pharmacy',
  'supplement',
  'health product',
  'beauty product seller',
  'beauty product reseller',
  'dropship',
  'ecommerce',
  'online shop',
  'shopee seller',
  'lazada seller',
  'carousell',
  'marketplace seller',
  'contact lens seller',
  'lens seller',
  'wig seller',
  'hair extension seller',
  'beauty tool seller',
  'makeup brush seller',
  'skincare seller',
  'perfume seller',
  'fashion seller',
  'clothing seller',
  'accessories seller',
  'bag seller',
  'shoe seller',
  'jewellery seller',
  'watch seller',
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

function loadTikTokRegistry() {
  const source = fs.existsSync(TT_SOURCE) ? JSON.parse(fs.readFileSync(TT_SOURCE, 'utf8')) : [];
  const enriched = fs.existsSync(TT_OUTPUT) ? JSON.parse(fs.readFileSync(TT_OUTPUT, 'utf8')) : [];

  const handles = new Set();
  const names = new Set();

  for (const artist of [...source, ...enriched]) {
    handles.add(normalizeHandle(artist.handle));
    names.add(artist.name.toLowerCase().trim());
  }

  return { handles, names, source };
}

function isRegistryDuplicate(handle, nickname, igRegistry, ttRegistry) {
  const h = normalizeHandle(handle);
  if (igRegistry.handles.has(h)) return 'in-instagram-registry:same-handle';
  if (igRegistry.tiktokFromIg.has(h)) return 'in-instagram-registry:linked-in-ig-bio';
  if (ttRegistry.handles.has(h)) return 'in-tiktok-registry:same-handle';

  const nick = (nickname || '').toLowerCase().trim();
  if (nick && igRegistry.names.has(nick)) return 'in-instagram-registry:same-name';
  if (nick && ttRegistry.names.has(nick)) return 'in-tiktok-registry:same-name';

  return null;
}

function matchesSingapore(signature, nickname, handle) {
  const text = `${signature || ''} ${nickname || ''} ${handle || ''}`.toLowerCase();
  if (SG_KEYWORDS.some((kw) => text.includes(kw))) return true;
  const h = (handle || '').toLowerCase();
  if (h.includes('singapore') || h.includes('.sg') || h.endsWith('sg') || h.includes('_sg') || h.includes('sg_')) {
    return true;
  }
  return false;
}

function matchesMua(signature, nickname, handle) {
  const text = `${signature || ''} ${nickname || ''} ${handle || ''}`.toLowerCase();
  if (NON_MUA_KEYWORDS.some((kw) => text.includes(kw))) return false;
  if (MUA_KEYWORDS.some((kw) => text.includes(kw))) return true;
  const h = (handle || '').toLowerCase();
  return h.includes('makeup') || h.includes('mua') || h.includes('bridal') || h.includes('glam');
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
  const fromLinks = await page.evaluate(() =>
    [...new Set(
      Array.from(document.querySelectorAll('a[href*="/@"]'))
        .map((a) => a.href.match(/@([^/?]+)/)?.[1])
        .filter(Boolean)
    )]
  );

  const fromHydration = await page.evaluate(() => {
    const el = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!el) return [];
    const handles = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.uniqueId === 'string' && node.uniqueId) handles.add(node.uniqueId);
      if (typeof node.author === 'string' && node.author.startsWith('@')) {
        handles.add(node.author.replace('@', ''));
      }
      for (const value of Object.values(node)) walk(value);
    };
    try {
      walk(JSON.parse(el.textContent));
    } catch (_) {}
    return [...handles];
  });

  return [...new Set([...fromLinks, ...fromHydration])];
}

async function scrapeFollowingHandles(page, handle) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  await scrollPage(page, 3);
  return extractHandlesFromPage(page);
}

async function scrollPage(page, times = 4) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await new Promise((r) => setTimeout(r, SCROLL_DELAY_MS));
  }
}

async function scrapeHashtagHandles(page, hashtag) {
  const url = `https://www.tiktok.com/tag/${encodeURIComponent(hashtag)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  await scrollPage(page, 4);
  return extractHandlesFromPage(page);
}

async function scrapeSearchHandles(page, query) {
  const url = `https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  await scrollPage(page, 4);
  return extractHandlesFromPage(page);
}

async function fetchProfile(page, handle) {
  const url = `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, FETCH_PROFILE_WAIT_MS));
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

async function runWorker(workerId, page, queue, igRegistry, ttRegistry, existingByHandle, onResult, maxNewRef, progress) {
  for (const { handle, index, total } of queue) {
    if (maxNewRef.value <= 0) break;

    process.stdout.write(`[${index}/${total}] [w${workerId}] @${handle} ... `);

    const profile = await fetchProfile(page, handle);
    const { pass, reasons } = evaluateProfile(profile, igRegistry, ttRegistry);
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
      maxNewRef.value -= 1;
      progress.accepted += 1;
    } else {
      console.log(`✗ ${reasons.join(', ')}`);
      result = { rejected: { handle, reasons, name: profile?.name } };
      progress.rejected += 1;
    }

    progress.checked += 1;
    progress.lastHandle = handle;
    await onResult(result);
    await new Promise((r) => setTimeout(r, PROFILE_DELAY_MS));
  }
}

function startProgressReporter(progress, total) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    const rate = progress.checked > 0 ? (progress.checked / ((Date.now() - startedAt) / 1000)).toFixed(1) : 0;
    const remaining = total - progress.checked;
    const etaMin = rate > 0 ? (remaining / rate / 60).toFixed(1) : '?';
    console.log(
      `\n[PROGRESS] ${progress.checked}/${total} checked | ${progress.accepted} accepted | ${progress.rejected} rejected | ${rate}/s | elapsed ${elapsedMin}m | ETA ${etaMin}m | last @${progress.lastHandle || '-'}`
    );
  }, PROGRESS_INTERVAL_MS);
  return () => clearInterval(timer);
}

function evaluateProfile(profile, igRegistry, ttRegistry) {
  const reasons = [];
  if (!profile || profile.error) {
    return { pass: false, reasons: [profile?.error || 'profile-unavailable'] };
  }
  if (profile.privateAccount) reasons.push('private-account');
  if (!hasBio(profile.description)) reasons.push('no-bio');
  if ((profile.videoCount || 0) < 5) reasons.push('under-5-posts');
  if (!matchesMua(profile.description, profile.name, profile.handle)) reasons.push('not-mua');
  if (!matchesSingapore(profile.description, profile.name, profile.handle)) reasons.push('not-singapore');

  const dup = isRegistryDuplicate(profile.handle, profile.name, igRegistry, ttRegistry);
  if (dup) reasons.push(dup);

  return { pass: reasons.length === 0, reasons };
}

async function main() {
  if (!CHROME) {
    console.error('Chrome not found. Set CHROME_PATH.');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const crawlOnly = process.argv.includes('--crawl-only');
  const hashtagArg = process.argv.find((a) => a.startsWith('--hashtags='));
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxNew = maxArg ? parseInt(maxArg.split('=')[1], 10) : 200;
  const hashtags = hashtagArg
    ? hashtagArg.split('=')[1].split(',').map((h) => h.trim()).filter(Boolean)
    : DEFAULT_HASHTAGS;

  const igRegistry = loadInstagramRegistry();
  const ttRegistry = loadTikTokRegistry();
  console.log(`Instagram registry: ${igRegistry.handles.size} handles`);
  console.log(`TikTok registry: ${ttRegistry.handles.size} handles`);

  const existingSource = ttRegistry.source;
  const existingByHandle = new Map(
    existingSource.map((a) => [normalizeHandle(a.handle), a])
  );

  const browser = await createBrowser();
  const page = await createPage(browser);
  const discovered = new Set(SEED_HANDLES.map(normalizeHandle));

  const crawlSeeds = [
    ...existingSource.map((a) => normalizeHandle(a.handle)),
    ...SEED_HANDLES.map(normalizeHandle),
  ].filter((h) => h && !igRegistry.handles.has(h));

  try {
    if (!crawlOnly) {
      for (const hashtag of hashtags) {
        console.log(`\nScraping #${hashtag}...`);
        try {
          const handles = await scrapeHashtagHandles(page, hashtag);
          console.log(`  Found ${handles.length} handles`);
          handles.forEach((h) => discovered.add(normalizeHandle(h)));
        } catch (err) {
          console.warn(`  Failed #${hashtag}: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      }

      for (const query of SEARCH_QUERIES) {
        console.log(`\nSearching users: "${query}"...`);
        try {
          const handles = await scrapeSearchHandles(page, query);
          console.log(`  Found ${handles.length} handles`);
          handles.forEach((h) => discovered.add(normalizeHandle(h)));
        } catch (err) {
          console.warn(`  Failed search "${query}": ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      }
    } else {
      console.log('\nCrawl-only mode — skipping hashtag/search scraping');
    }

    const uniqueCrawlSeeds = [...new Set(crawlSeeds)].slice(0, 60);
    for (const seed of uniqueCrawlSeeds) {
      console.log(`\nCrawling related from @${seed}...`);
      try {
        const handles = await scrapeFollowingHandles(page, seed);
        console.log(`  Found ${handles.length} handles`);
        handles.forEach((h) => discovered.add(normalizeHandle(h)));
      } catch (err) {
        console.warn(`  Failed crawl @${seed}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  const candidates = [...discovered]
    .filter(Boolean)
    .filter((h) => !ttRegistry.handles.has(h));
  console.log(`\n${candidates.length} new candidate handles to evaluate (${discovered.size} total discovered)`);

  const accepted = [];
  const rejected = [];
  const workerCount = Math.min(6, Math.max(1, parseInt(process.env.WORKERS || '6', 10)));
  const maxNewRef = { value: maxNew };
  const progress = { checked: 0, accepted: 0, rejected: 0, lastHandle: '' };

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
  const stopProgress = startProgressReporter(progress, candidates.length);

  try {
    await Promise.all(
      groups.map((group, i) =>
        runWorker(i + 1, pages[i], group, igRegistry, ttRegistry, existingByHandle, async (result) => {
          if (result.accepted) accepted.push(result.accepted);
          if (result.rejected) rejected.push(result.rejected);
        }, maxNewRef, progress)
      )
    );
  } finally {
    stopProgress();
    await browser2.close();
  }

  const mergedByHandle = new Map(
    existingSource.map((a) => [normalizeHandle(a.handle), a])
  );
  for (const artist of accepted) {
    mergedByHandle.set(normalizeHandle(artist.handle), artist);
  }
  const merged = [...mergedByHandle.values()].sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\nNewly accepted: ${accepted.length}`);
  console.log(`Rejected: ${rejected.length}`);
  console.log(`Total in registry: ${merged.length}`);

  if (dryRun) {
    console.log('\nDry run — not writing files.');
    console.log(JSON.stringify(merged, null, 2));
    return;
  }

  fs.writeFileSync(TT_SOURCE, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nWrote ${merged.length} artists to ${TT_SOURCE}`);

  if (accepted.length > 0) {
    console.log('Run `node fetch-tiktok-profiles.js` to refresh followers and bios.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
