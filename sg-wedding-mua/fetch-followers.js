#!/usr/bin/env node
/**
 * Refresh Instagram follower counts via public /embed/ pages.
 * StarNgage only indexes a small subset of bridal MUA accounts;
 * embed pages expose "N followers" for public profiles without login.
 */
const fs = require('fs');
const path = require('path');
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

function parseFollowers(text) {
  if (!text) return null;
  if (/Performing security verification|Enable JavaScript|HTTP ERROR 429/i.test(text)) {
    return null;
  }
  if (/profile may be broken|profile may have been removed|Page isn't available/i.test(text)) {
    return 0;
  }
  // e.g. "5,553 followers", "13.7K followers", "1 follower"
  const m = text.match(/([\d,.]+)\s*([KkMm])?\s*followers?/i);
  if (!m) return null;
  let val = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(val)) return null;
  const suf = (m[2] || '').toUpperCase();
  if (suf === 'K') val *= 1000;
  if (suf === 'M') val *= 1_000_000;
  return Math.round(val);
}

async function main() {
  if (!CHROME) {
    console.error('Chrome not found. Set CHROME_PATH or install google-chrome.');
    process.exit(1);
  }

  const artists = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const onlyMissing = process.argv.includes('--only-missing');
  let existing = {};
  if (onlyMissing && fs.existsSync(OUTPUT)) {
    for (const a of JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))) {
      existing[a.handle.toLowerCase()] = a.followers || 0;
    }
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );

  const results = [];
  try {
    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      const key = artist.handle.toLowerCase();
      process.stdout.write(`[${i + 1}/${artists.length}] ${artist.handle} ... `);

      if (onlyMissing && existing[key] > 0) {
        results.push({ ...artist, followers: existing[key] });
        console.log(`${existing[key]} (kept)`);
        continue;
      }

      let followers = 0;
      try {
        const url = `https://www.instagram.com/${encodeURIComponent(artist.handle)}/embed/`;
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise((r) => setTimeout(r, 900));
        const text = await page.evaluate(() =>
          (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
        );
        const parsed = parseFollowers(text);
        if (parsed === null && resp && resp.status() === 429) {
          console.log('rate-limited, cooling 20s');
          await new Promise((r) => setTimeout(r, 20000));
          i -= 1;
          continue;
        }
        followers = parsed === null ? 0 : parsed;
        console.log(followers);
      } catch (err) {
        console.log(`error (${err.message})`);
        followers = 0;
      }

      results.push({ ...artist, followers });
      const sorted = [...results].sort((a, b) => b.followers - a.followers);
      // Merge unfetched remainder so partial runs stay usable
      const done = new Set(results.map((r) => r.handle.toLowerCase()));
      for (const a of artists) {
        if (!done.has(a.handle.toLowerCase())) {
          sorted.push({
            ...a,
            followers: onlyMissing ? existing[a.handle.toLowerCase()] || 0 : 0,
          });
        }
      }
      sorted.sort((a, b) => b.followers - a.followers);
      fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2) + '\n');
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } finally {
    await browser.close();
  }

  const withCount = results.filter((r) => r.followers > 0).length;
  console.log(`\nSaved ${results.length} artists to ${OUTPUT} (${withCount} with followers)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
