#!/usr/bin/env node
// Reverse image search one clothing photo with Google Lens and print the matching product pages as JSON.
// Usage: node the-edit/tools/lens.js <photo.jpg> [--crop x,y,w,h]
// Only use with photos of the garment itself (crop out faces and rooms first).
const fs = require('fs');
const path = require('path');
module.paths.push('/opt/node22/lib/node_modules');
const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file) || !/\.(jpe?g|png|webp)$/i.test(file)) {
    console.error('Usage: node the-edit/tools/lens.js <photo.jpg|png|webp>');
    process.exit(2);
  }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'en-AU' });
    // Pre-accept Google's consent screen so results load
    await ctx.addCookies([{ name: 'SOCS', value: 'CAISHAgBEhJnd3NfMjAyNDA1MTUtMF9SQzIaAmVuIAEaBgiA_LyyBg', domain: '.google.com', path: '/' }]);
    const page = await ctx.newPage();
    await page.goto('https://lens.google.com/?hl=en-AU', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const input = await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 15000 });
    await input.setInputFiles(path.resolve(file));
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const results = await page.evaluate(() => {
      const seen = new Set(), out = [];
      for (const a of document.querySelectorAll('a[href^="http"]')) {
        const href = a.href;
        let host;
        try { host = new URL(href).hostname; } catch { continue; }
        if (/google\.|gstatic\.|googleusercontent\./.test(host) || seen.has(href)) continue;
        const text = (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        seen.add(href);
        const img = a.querySelector('img');
        out.push({ title: text.slice(0, 160), url: href, site: host.replace(/^www\./, ''), image: img ? img.src : null });
        if (out.length >= 25) break;
      }
      return out;
    });
    const blocked = /unusual traffic|captcha|consent\.google/i.test(await page.content()) && !results.length;
    console.log(JSON.stringify({ ok: !blocked && results.length > 0, blocked, finalUrl: page.url(), results }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(String(e)); process.exit(1); });
