const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const outDir = path.resolve('downloaded');
const diagDir = path.resolve('diagnostics');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(diagDir, { recursive: true });

const target = {
  id: 'RLF-EXT-020',
  exactCode: 'J1518/A25/01975/336',
  expectedOrigin: 'MADE IN VIETNAM',
  sourcePage: 'https://www.instagram.com/p/DVvOqMrAh5i/',
  query: '"J1518/A25/01975/336" "FRED PERRY"',
};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mimeFromMagic(buffer) {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('hex') === '52494646' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  return 'application/octet-stream';
}

function extForMime(mime) {
  return mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'bin';
}

const seenHashes = new Set();
const candidates = [];

function preserveCandidate(buffer, provenance) {
  const mime = mimeFromMagic(buffer);
  const digest = sha256(buffer);
  const acceptedBinary = /^image\/(jpeg|png|webp)$/.test(mime) && buffer.length >= 1024;
  const record = {
    ...provenance,
    bytes: buffer.length,
    sha256: digest,
    magicMime: mime,
    acceptedBinary,
    exactIdentityVerified: false,
    admission: acceptedBinary ? 'CANDIDATE_ONLY_MANUAL_VISUAL_GATE' : 'REJECT_BINARY_GATE',
  };
  if (acceptedBinary && !seenHashes.has(digest)) {
    seenHashes.add(digest);
    const ordinal = String(candidates.filter((x) => x.acceptedBinary).length + 1).padStart(2, '0');
    const file = `${target.id}_J1518_01975_336_candidate_${ordinal}.${extForMime(mime)}`;
    fs.writeFileSync(path.join(outDir, file), buffer);
    record.file = file;
  }
  candidates.push(record);
  return record;
}

async function fetchUrl(request, url, provenance) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await request.get(url, {
      timeout: 120000,
      failOnStatusCode: false,
      headers: { Referer: target.sourcePage },
    });
    const body = await response.body();
    return preserveCandidate(body, {
      ...provenance,
      url,
      status: response.status(),
      headerContentType: response.headers()['content-type'] || '',
    });
  } catch (error) {
    candidates.push({ ...provenance, url, error: String(error), acceptedBinary: false, admission: 'REQUEST_ERROR' });
    return null;
  }
}

async function collectPageImages(page, stage) {
  const images = await page.locator('img').evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    src: node.currentSrc || node.src || '',
    srcset: node.srcset || '',
    alt: node.alt || '',
    naturalWidth: node.naturalWidth || 0,
    naturalHeight: node.naturalHeight || 0,
    visible: Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
  }))).catch(() => []);
  fs.writeFileSync(path.join(diagDir, `${stage}_images.json`), JSON.stringify(images, null, 2));

  const urls = new Set();
  for (const image of images) {
    if (image.src) urls.add(image.src);
    for (const part of String(image.srcset || '').split(',')) {
      const url = part.trim().split(/\s+/)[0];
      if (url) urls.add(url);
    }
  }
  let ordinal = 0;
  for (const url of urls) {
    ordinal += 1;
    await fetchUrl(page.context().request, url, { mode: 'page_img_request', stage, ordinal });
  }
  return images;
}

async function inspectInstagram(context, report) {
  const page = await context.newPage();
  const networkImageUrls = new Set();
  page.on('response', (response) => {
    const ct = response.headers()['content-type'] || '';
    const url = response.url();
    if (/^image\//i.test(ct) && /(cdninstagram|fbcdn|instagram)/i.test(url)) networkImageUrls.add(url);
  });

  try {
    const nav = await page.goto(target.sourcePage, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(15000);
    report.instagram = {
      status: nav ? nav.status() : null,
      finalUrl: page.url(),
      title: await page.title(),
    };
    await page.screenshot({ path: path.join(diagDir, 'instagram_full_page.png'), fullPage: true });

    const meta = await page.evaluate(() => {
      const value = (selector, attribute = 'content') => document.querySelector(selector)?.getAttribute(attribute) || '';
      return {
        ogImage: value('meta[property="og:image"]'),
        ogDescription: value('meta[property="og:description"]'),
        description: value('meta[name="description"]'),
        canonical: value('link[rel="canonical"]', 'href'),
        bodyText: (document.body?.innerText || '').slice(0, 30000),
      };
    }).catch((error) => ({ error: String(error) }));
    fs.writeFileSync(path.join(diagDir, 'instagram_metadata.json'), JSON.stringify(meta, null, 2));
    if (meta.bodyText) fs.writeFileSync(path.join(diagDir, 'instagram_body_text.txt'), meta.bodyText);
    if (meta.ogImage) await fetchUrl(context.request, meta.ogImage, { mode: 'instagram_og_image' });

    await collectPageImages(page, 'instagram_slide_00');

    for (let slide = 1; slide <= 10; slide += 1) {
      const selectors = [
        'button[aria-label="Next"]',
        'button[aria-label="Següent"]',
        'button[aria-label="Siguiente"]',
        'button:has(svg[aria-label="Next"])',
      ];
      let clicked = false;
      for (const selector of selectors) {
        const button = page.locator(selector).last();
        if (await button.isVisible().catch(() => false)) {
          await button.click({ timeout: 10000 }).catch(() => {});
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
      await sleep(2500);
      const stage = `instagram_slide_${String(slide).padStart(2, '0')}`;
      await page.screenshot({ path: path.join(diagDir, `${stage}.png`), fullPage: false });
      await collectPageImages(page, stage);
    }

    let netOrdinal = 0;
    for (const url of networkImageUrls) {
      netOrdinal += 1;
      await fetchUrl(context.request, url, { mode: 'instagram_network_image', ordinal: netOrdinal });
    }
  } catch (error) {
    report.instagram = { ...(report.instagram || {}), error: String(error) };
  } finally {
    await page.close();
  }
}

async function inspectBing(context, report) {
  const page = await context.newPage();
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(target.query)}`;
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(10000);
    report.bing = { status: nav ? nav.status() : null, finalUrl: page.url(), title: await page.title() };
    await page.screenshot({ path: path.join(diagDir, 'bing_exact_query_full_page.png'), fullPage: true });

    const tiles = await page.locator('a.iusc').evaluateAll((nodes) => nodes.slice(0, 40).map((node, index) => {
      let metadata = {};
      try { metadata = JSON.parse(node.getAttribute('m') || '{}'); } catch (_) {}
      return { index, href: node.href || '', metadata };
    })).catch(() => []);
    fs.writeFileSync(path.join(diagDir, 'bing_exact_query_tiles.json'), JSON.stringify(tiles, null, 2));

    let ordinal = 0;
    for (const tile of tiles) {
      const mediaUrl = tile.metadata?.murl || tile.metadata?.turl || '';
      if (!mediaUrl) continue;
      ordinal += 1;
      await fetchUrl(context.request, mediaUrl, {
        mode: 'bing_exact_query_media',
        ordinal,
        sourcePage: tile.metadata?.purl || '',
        title: tile.metadata?.t || '',
      });
    }
  } catch (error) {
    report.bing = { ...(report.bing || {}), error: String(error) };
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 1400 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  });

  const report = {
    schema: 'rlf-v625-exact-instagram-recovery-v1',
    policy: 'APPEND_ONLY_FAIL_CLOSED',
    target,
    generatedAt: new Date().toISOString(),
    instagram: null,
    bing: null,
  };

  await inspectInstagram(context, report);
  await inspectBing(context, report);
  await browser.close();

  const files = fs.readdirSync(outDir).sort().map((file) => {
    const buffer = fs.readFileSync(path.join(outDir, file));
    return { file, bytes: buffer.length, sha256: sha256(buffer), magicMime: mimeFromMagic(buffer) };
  });
  report.candidates = candidates;
  report.preservedFiles = files;
  report.exactIdentityVerified = false;
  report.canonicalPromotion = false;
  report.nextGate = 'Manual visual inspection must confirm exact J1518/A25/01975/336 and MADE IN VIETNAM on a same-piece physical label.';

  fs.writeFileSync(path.join(diagDir, 'rlf-v625-instagram-recovery-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(diagDir, 'RLF_V625_SHA256SUMS.txt'), files.map((item) => `${item.sha256}  ${item.file}`).join('\n') + '\n');
  console.log(JSON.stringify({ preservedCandidates: files.length, files, canonicalPromotion: false }, null, 2));
}

main().catch((error) => {
  fs.writeFileSync(path.join(diagDir, 'fatal-error.txt'), String(error));
  console.error(error);
  process.exitCode = 1;
});
