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
  code: 'J1518/A25/01975/336',
  origin: 'MADE IN VIETNAM',
  listingId: '29492494',
  sourcePage: 'https://us.vestiairecollective.com/men-clothing/jackets/fred-perry/burgundy-cotton-fred-perry-jacket-29492494.shtml',
  directImage: 'https://images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/burgundy-cotton-fred-perry-jacket-29492494-7_1.jpg',
  queries: [
    'burgundy cotton Fred Perry jacket 29492494 label',
    'Vestiaire 29492494 J1518 336',
  ],
};

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function magicMime(b) {
  if (b.length >= 12 && b.subarray(0, 4).toString('hex') === '52494646' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.length >= 8 && b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (b.length >= 3 && b.subarray(0, 3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  return 'application/octet-stream';
}
function ext(m) { return m === 'image/webp' ? 'webp' : m === 'image/png' ? 'png' : m === 'image/jpeg' ? 'jpg' : 'bin'; }

const report = {
  schema: 'rlf-v625b-exact-vestiaire-recovery-v1',
  policy: 'APPEND_ONLY_FAIL_CLOSED',
  generatedAt: new Date().toISOString(),
  target,
  attempts: [],
  preserved: [],
  exactIdentityVerified: false,
  canonicalPromotion: false,
};
const seen = new Set();

function preserve(b, label, provenance) {
  const mime = magicMime(b);
  const hash = sha256(b);
  const binaryPass = /^image\/(jpeg|png|webp)$/.test(mime) && b.length >= 1024;
  const row = { label, ...provenance, bytes: b.length, sha256: hash, magicMime: mime, binaryPass };
  if (binaryPass && !seen.has(hash)) {
    seen.add(hash);
    const file = `${target.id}_${target.code.replace(/[^A-Za-z0-9]+/g, '_')}_${label}.${ext(mime)}`;
    fs.writeFileSync(path.join(outDir, file), b);
    row.file = file;
    row.admission = 'CANDIDATE_ONLY_MANUAL_VISUAL_GATE';
    report.preserved.push(row);
  } else {
    row.admission = binaryPass ? 'DUPLICATE_SHA' : 'REJECT_BINARY_GATE';
  }
  report.attempts.push(row);
  return row;
}

async function fetchCandidate(request, url, label, provenance = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await request.get(url, {
      timeout: 45000,
      failOnStatusCode: false,
      headers: {
        Referer: provenance.referer || target.sourcePage,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    const body = await response.body();
    return preserve(body, label, {
      ...provenance,
      url,
      status: response.status(),
      headerContentType: response.headers()['content-type'] || '',
    });
  } catch (error) {
    report.attempts.push({ label, ...provenance, url, error: String(error), admission: 'REQUEST_ERROR' });
    return null;
  }
}

async function directAndSource(context) {
  await fetchCandidate(context.request, target.directImage, 'vestiaire_direct', { mode: 'direct', referer: target.sourcePage });
  const page = await context.newPage();
  try {
    const nav = await page.goto(target.sourcePage, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(12000);
    await page.screenshot({ path: path.join(diagDir, 'vestiaire_source_full.png'), fullPage: true });
    const data = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      bodyText: (document.body?.innerText || '').slice(0, 20000),
      ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
      images: [...document.images].map((img, index) => ({
        index,
        src: img.currentSrc || img.src || '',
        srcset: img.srcset || '',
        alt: img.alt || '',
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
    })).catch((error) => ({ error: String(error) }));
    fs.writeFileSync(path.join(diagDir, 'vestiaire_source.json'), JSON.stringify({ status: nav?.status(), ...data }, null, 2));
    if (data.ogImage) await fetchCandidate(context.request, data.ogImage, 'vestiaire_og', { mode: 'source_og' });
    for (const image of (data.images || []).filter((x) => String(x.src + x.srcset).includes(target.listingId)).slice(0, 12)) {
      if (image.src) await fetchCandidate(context.request, image.src, `vestiaire_dom_${String(image.index).padStart(2, '0')}`, { mode: 'source_dom', alt: image.alt });
    }
  } catch (error) {
    report.attempts.push({ label: 'vestiaire_source', error: String(error), admission: 'PAGE_ERROR' });
  } finally {
    await page.close();
  }
}

async function exactBing(context, query, queryIndex) {
  const page = await context.newPage();
  try {
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}`;
    const nav = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(10000);
    await page.screenshot({ path: path.join(diagDir, `bing_${queryIndex}_full.png`), fullPage: true });
    const tiles = await page.locator('a.iusc').evaluateAll((nodes) => nodes.map((node, index) => {
      let metadata = {};
      try { metadata = JSON.parse(node.getAttribute('m') || '{}'); } catch (_) {}
      const image = node.querySelector('img.mimg');
      return {
        index,
        metadata,
        thumbSrc: image?.currentSrc || image?.src || '',
        thumbAlt: image?.alt || '',
        width: image?.naturalWidth || 0,
        height: image?.naturalHeight || 0,
      };
    })).catch(() => []);
    fs.writeFileSync(path.join(diagDir, `bing_${queryIndex}_tiles.json`), JSON.stringify({ status: nav?.status(), query, tiles }, null, 2));

    const exact = tiles.filter((tile) => {
      const text = JSON.stringify(tile).toLowerCase();
      return text.includes(target.listingId) || text.includes('burgundy-cotton-fred-perry-jacket-29492494-7_1');
    });
    report.attempts.push({ label: `bing_${queryIndex}_exact_matches`, query, matches: exact.length, admission: exact.length ? 'MATCHES_FOUND' : 'NO_MATCH' });

    let matchOrdinal = 0;
    for (const tile of exact) {
      matchOrdinal += 1;
      const locator = page.locator('a.iusc').nth(tile.index).locator('img.mimg').first();
      if (await locator.isVisible().catch(() => false)) {
        const temp = path.join(diagDir, `bing_${queryIndex}_match_${matchOrdinal}_rendered.png`);
        await locator.screenshot({ path: temp, timeout: 30000 });
        preserve(fs.readFileSync(temp), `bing_${queryIndex}_match_${matchOrdinal}_rendered`, {
          mode: 'rendered_search_element', query, sourcePage: tile.metadata?.purl || '', originalUrl: tile.metadata?.murl || '',
        });
      }
      const urls = [
        ['murl', tile.metadata?.murl],
        ['turl', tile.metadata?.turl],
        ['thumb', tile.thumbSrc],
      ];
      for (const [kind, candidateUrl] of urls) {
        if (candidateUrl) await fetchCandidate(context.request, candidateUrl, `bing_${queryIndex}_match_${matchOrdinal}_${kind}`, {
          mode: `bing_${kind}`,
          query,
          sourcePage: tile.metadata?.purl || '',
          title: tile.metadata?.t || '',
          referer: url,
        });
      }
    }
  } catch (error) {
    report.attempts.push({ label: `bing_${queryIndex}`, query, error: String(error), admission: 'PAGE_ERROR' });
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1440, height: 1200 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  });

  await directAndSource(context);
  for (let i = 0; i < target.queries.length; i += 1) await exactBing(context, target.queries[i], i + 1);
  await browser.close();

  report.nextGate = 'Manually verify that a preserved image visibly contains FRED PERRY, MADE IN VIETNAM and exact code J1518/A25/01975/336; then run global SHA and perceptual deduplication.';
  fs.writeFileSync(path.join(diagDir, 'rlf-v625b-exact-vestiaire-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(diagDir, 'RLF_V625B_SHA256SUMS.txt'), report.preserved.map((x) => `${x.sha256}  ${x.file}`).join('\n') + '\n');
  console.log(JSON.stringify({ preserved: report.preserved.length, files: report.preserved, canonicalPromotion: false }, null, 2));
}

main().catch((error) => {
  fs.writeFileSync(path.join(diagDir, 'fatal-error.txt'), String(error));
  console.error(error);
  process.exitCode = 1;
});
