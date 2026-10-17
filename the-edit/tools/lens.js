#!/usr/bin/env node
// Reverse image search clothing photos with Google Lens and print the matching product pages as JSON.
// Usage: node the-edit/tools/lens.js <photo.jpg> [more photos…] [--headed]
// Only use with photos of the garment itself (crop out faces and rooms first).
// Google blocks cloud and datacentre networks, so run this on your own computer.
// Needs Playwright: npm i playwright && npx playwright install chromium
// --headed opens a visible browser so you can tick a captcha if Google shows one.
const fs = require('fs');
const path = require('path');
module.paths.push('/opt/node22/lib/node_modules');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Playwright is not installed. Run: npm i playwright && npx playwright install chromium');
  process.exit(2);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

async function lens(ctx, page, file, headed) {
  const ext = path.extname(file).slice(1).toLowerCase();
  // lens.google.com redirects headless browsers to the Google homepage, so upload straight to the Lens endpoint
  const res = await ctx.request.post('https://lens.google.com/v3/upload?hl=en-AU&re=df&st=' + Date.now(), {
    multipart: { encoded_image: { name: path.basename(file), mimeType: MIME[ext], buffer: fs.readFileSync(file) } },
    maxRedirects: 0,
  });
  const next = res.headers()['location'];
  if (!next) return { file, ok: false, blocked: false, error: 'Lens upload returned HTTP ' + res.status(), results: [] };
  await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Give a person a minute to clear a captcha in headed mode
  if (headed && /\/sorry\//.test(page.url())) await page.waitForURL(u => !/\/sorry\//.test(u.href), { timeout: 120000 }).catch(() => {});
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
  const blocked = /\/sorry\/|consent\.google/.test(page.url()) || (/unusual traffic|captcha/i.test(await page.content()) && !results.length);
  return { file, ok: !blocked && results.length > 0, blocked, finalUrl: page.url(), results };
}

async function main() {
  const headed = process.argv.includes('--headed');
  const files = process.argv.slice(2).filter(a => a !== '--headed');
  const bad = files.filter(f => !fs.existsSync(f) || !/\.(jpe?g|png|webp)$/i.test(f));
  if (!files.length || bad.length) {
    console.error('Usage: node the-edit/tools/lens.js <photo.jpg|png|webp> [more photos…] [--headed]' + (bad.length ? '\nNot found or not an image: ' + bad.join(', ') : ''));
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: !headed });
  const out = [];
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'en-AU' });
    // Pre-accept Google's consent screen so results load
    await ctx.addCookies([{ name: 'SOCS', value: 'CAISHAgBEhJnd3NfMjAyNDA1MTUtMF9SQzIaAmVuIAEaBgiA_LyyBg', domain: '.google.com', path: '/' }]);
    const page = await ctx.newPage();
    for (const f of files) {
      try { out.push(await lens(ctx, page, path.resolve(f), headed)); } catch (e) { out.push({ file: f, ok: false, error: String(e), results: [] }); }
      console.error(`${path.basename(f)}: ${out[out.length - 1].ok ? out[out.length - 1].results.length + ' results' : 'no results'}`);
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(files.length === 1 ? out[0] : out, null, 2));
}
main().catch(e => { console.error(String(e)); process.exit(1); });
