#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ARTIFACTS_DIR = '/opt/cursor/artifacts/sg-wedding-mua';
const SOURCE = path.join(ARTIFACTS_DIR, 'artists-source.json');
const OUTPUT = path.join(ARTIFACTS_DIR, 'artists.json');
const DELAY_MS = 2000;

function parseFollowers(text) {
  if (/Performing security verification|Enable JavaScript/i.test(text)) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() === 'followers' && i > 0) {
      const num = Number(lines[i - 1].replace(/,/g, ''));
      if (!Number.isNaN(num) && num > 0) return num;
    }
  }
  return 0;
}

async function fetchFollowerCount(handle) {
  const browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    const url = `https://starngage.com/plus/en-us/brands/instagram/${encodeURIComponent(handle)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 6000));
    const text = await page.evaluate(() => document.body.innerText);
    const followers = parseFollowers(text);
    return followers === null ? 0 : followers;
  } finally {
    await browser.close();
  }
}

async function main() {
  const artists = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const results = [];

  for (let i = 0; i < artists.length; i++) {
    const artist = artists[i];
    process.stdout.write(`[${i + 1}/${artists.length}] ${artist.handle} ... `);
    try {
      const followers = await fetchFollowerCount(artist.handle);
      results.push({ ...artist, followers });
      console.log(followers);
    } catch (err) {
      results.push({ ...artist, followers: 0 });
      console.log(`error (${err.message})`);
    }

    const sorted = [...results].sort((a, b) => b.followers - a.followers);
    fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\nSaved ${results.length} artists to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
