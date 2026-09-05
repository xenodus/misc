#!/usr/bin/env node
/**
 * Refresh TikTok follower counts and profile descriptions.
 *
 * Input:  artists-source-tiktok.json
 * Output: artists-tiktok.json
 *
 * Usage:
 *   node fetch-tiktok-profiles.js
 *   node fetch-tiktok-profiles.js --only-missing
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const SOURCE = path.join(ROOT, 'artists-source-tiktok.json');
const OUTPUT = path.join(ROOT, 'artists-tiktok.json');
const DELAY_MS = 1500;

const CHROME =
  process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find(
    (p) => fs.existsSync(p)
  );

function tiktokUrl(handle) {
  return `https://www.tiktok.com/@${handle}`;
}

async function createBrowser() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  return { browser, page };
}

async function fetchProfile(page, handle) {
  const url = tiktokUrl(handle);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 1200));
  return page.evaluate(() => {
    const el = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!el) return null;
    const data = JSON.parse(el.textContent);
    const userDetail = data['__DEFAULT_SCOPE__']?.['webapp.user-detail'] || {};
    const user = userDetail.userInfo?.user;
    const stats = userDetail.userInfo?.stats || {};
    if (!user?.uniqueId) return null;
    return {
      name: user.nickname || user.uniqueId,
      handle: user.uniqueId,
      description: user.signature || '',
      followers: stats.followerCount || 0,
      videoCount: stats.videoCount || 0,
      privateAccount: Boolean(user.privateAccount || user.secret),
    };
  });
}

function writeOutput(artists, resultsByHandle, existingRecords, onlyMissing) {
  const merged = artists.map((artist) => {
    const key = artist.handle.toLowerCase();
    const prior = existingRecords[key] || {};
    const fetched = resultsByHandle[key];
    const base = {
      name: fetched?.name || prior.name || artist.name,
      handle: artist.handle,
      tiktok: prior.tiktok || tiktokUrl(artist.handle),
      ...(artist.tag || prior.tag ? { tag: artist.tag || prior.tag } : {}),
    };

    if (fetched) {
      return {
        ...base,
        description: fetched.description || '',
        followers: fetched.privateAccount ? 0 : fetched.followers || 0,
      };
    }

    return {
      ...base,
      description: onlyMissing ? prior.description || '' : '',
      followers: onlyMissing ? prior.followers || 0 : 0,
    };
  });

  merged.sort((a, b) => (b.followers || 0) - (a.followers || 0));
  fs.writeFileSync(OUTPUT, JSON.stringify(merged, null, 2) + '\n');
}

async function main() {
  if (!CHROME) {
    console.error('Chrome not found. Set CHROME_PATH.');
    process.exit(1);
  }

  if (!fs.existsSync(SOURCE)) {
    console.error(`Missing ${SOURCE}. Run search-tiktok-artists.js first.`);
    process.exit(1);
  }

  const onlyMissing = process.argv.includes('--only-missing');
  const artists = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));

  let existingRecords = {};
  if (fs.existsSync(OUTPUT)) {
    for (const a of JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))) {
      existingRecords[a.handle.toLowerCase()] = a;
    }
  }

  let toFetch = artists;
  if (onlyMissing) {
    toFetch = artists.filter((a) => {
      const prior = existingRecords[a.handle.toLowerCase()];
      return !prior || !prior.followers || !prior.description;
    });
  }

  if (toFetch.length === 0) {
    console.log('Nothing to fetch.');
    return;
  }

  const resultsByHandle = {};
  const { browser, page } = await createBrowser();

  try {
    for (let i = 0; i < toFetch.length; i++) {
      const artist = toFetch[i];
      const key = artist.handle.toLowerCase();
      process.stdout.write(`[${i + 1}/${toFetch.length}] @${artist.handle} ... `);

      try {
        const profile = await fetchProfile(page, artist.handle);
        if (!profile) {
          console.log('no data');
          resultsByHandle[key] = { name: artist.name, handle: artist.handle, description: '', followers: 0 };
        } else {
          console.log(`${profile.followers} followers`);
          resultsByHandle[key] = profile;
        }
      } catch (err) {
        console.log(`error (${err.message})`);
        resultsByHandle[key] = { name: artist.name, handle: artist.handle, description: '', followers: 0 };
      }

      writeOutput(artists, resultsByHandle, existingRecords, onlyMissing);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  writeOutput(artists, resultsByHandle, existingRecords, onlyMissing);
  console.log(`\nSaved ${artists.length} artists to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
