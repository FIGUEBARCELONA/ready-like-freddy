const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const outDir = path.resolve('downloaded');
const diagDir = path.resolve('diagnostics');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(diagDir, { recursive: true });

const targets = [
  {
    id: 'CAND-046',
    listingId: '4416347158',
    page: 'https://www.etsy.com/fi-en/listing/4416347158/fred-perry-jacket-mens-m-down-filled',
    query: '"FRED PERRY Jacket Men’s M Down Filled Parka" "4416347158"',
    expected: 'MADE IN VIETNAM | shell 100% nylon | fill 80% down / 20% feathers | lining 100% nylon',
  },
  {
    id: 'CAND-051',
    listingId: '1504984921',
    page: 'https://www.etsy.com/listing/1504984921/vintage-80s-fred-perry-shirt-sleeveless',
    query: '"Vintage 80s FRED PERRY Shirt Sleeveless Women Tennis Made Japan Size Medium"',
    expected: 'MADE IN JAPAN | size Medium | sleeveless women tennis shirt',
  },
];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function magicMime(b) {
  if (b.length >= 12 && b.subarray(0,4).toString('hex') === '52494646' && b.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  if (b.length >= 8 && b.subarray(0,8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (b.length >= 3 && b.subarray(0,3).toString('hex') === 'ffd8ff') return 'image/jpeg';
  return 'application/octet-stream';
}
function ext(m) { return m === 'image/webp' ? 'webp' : m === 'image/png' ? 'png' : m === 'image/jpeg' ? 'jpg' : 'bin'; }
function safe(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,120); }

const report = {
  schema: 'rlf-v625-exact-etsy-recovery-v1',
  policy: 'APPEND_ONLY_FAIL_CLOSED',
  generatedAt: new Date().toISOString(),
  targets: [],
  exactIdentityVerified: false,
  canonicalPromotion: false,
};
const seen = new Set();

function preserve(target, buffer, provenance) {
  const mime = magicMime(buffer);
  const hash = sha256(buffer);
  const binaryPass = /^image\/(jpeg|png|webp)$/.test(mime) && buffer.length >= 2048;
  const row = { targetId: target.id, listingId: target.listingId, expected: target.expected, ...provenance, bytes: buffer.length, sha256: hash, magicMime: mime, binaryPass };
  if (binaryPass && !seen.has(hash)) {
    seen.add(hash);
    const n = String(report.targets.flatMap((x) => x.preserved || []).filter((x) => x.targetId === target.id).length + 1).padStart(2,'0');
    const file = `${target.id}_${target.listingId}_candidate_${n}.${ext(mime)}`;
    fs.writeFileSync(path.join(outDir,file),buffer);
    row.file = file;
    row.admission = 'CANDIDATE_ONLY_MANUAL_VISUAL_GATE';
  } else {
    row.admission = binaryPass ? 'DUPLICATE_SHA' : 'REJECT_BINARY_GATE';
  }
  return row;
}

async function fetchImage(context, target, url, provenance) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await context.request.get(url, { timeout: 90000, failOnStatusCode: false, headers: { Referer: target.page, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    return preserve(target, await response.body(), { ...provenance, url, status: response.status(), headerContentType: response.headers()['content-type'] || '' });
  } catch (error) {
    return { targetId: target.id, ...provenance, url, error: String(error), admission: 'REQUEST_ERROR' };
  }
}

async function inspectTarget(context, target) {
  const result = { ...target, source: null, attempts: [], preserved: [] };
  const page = await context.newPage();
  try {
    const nav = await page.goto(target.page, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(14000);
    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    const data = await page.evaluate(() => {
      const meta = (s,a='content') => document.querySelector(s)?.getAttribute(a) || '';
      return {
        title: document.title,
        finalUrl: location.href,
        canonical: meta('link[rel="canonical"]','href'),
        ogImage: meta('meta[property="og:image"]'),
        ogDescription: meta('meta[property="og:description"]'),
        bodyText: (document.body?.innerText || '').slice(0,50000),
        images: [...document.images].map((img,index) => ({ index, src: img.currentSrc || img.src || '', srcset: img.srcset || '', alt: img.alt || '', width: img.naturalWidth || 0, height: img.naturalHeight || 0 })),
      };
    }).catch((error) => ({ error: String(error), images: [] }));
    result.source = { status: nav ? nav.status() : null, ...data };
    fs.writeFileSync(path.join(diagDir,`${target.id}_source.json`),JSON.stringify(result.source,null,2));
    fs.writeFileSync(path.join(diagDir,`${target.id}_source_body.txt`),data.bodyText || '');
    await page.screenshot({ path: path.join(diagDir,`${target.id}_source_full.png`), fullPage: true });

    const urls = new Set();
    if (data.ogImage) urls.add(data.ogImage);
    for (const image of data.images || []) {
      const contextText = `${image.src} ${image.srcset} ${image.alt}`.toLowerCase();
      if (image.width >= 250 && image.height >= 250 && (/etsystatic|etsy/.test(contextText))) {
        if (image.src) urls.add(image.src);
        for (const part of String(image.srcset || '').split(',')) {
          const u = part.trim().split(/\s+/)[0]; if (u) urls.add(u);
        }
      }
      if (urls.size >= 30) break;
    }
    let n = 0;
    for (const url of urls) {
      n += 1;
      const row = await fetchImage(context,target,url,{mode:'etsy_source_image',ordinal:n});
      result.attempts.push(row);
      if (row?.file) result.preserved.push(row);
    }
  } catch (error) {
    result.source = { ...(result.source || {}), error: String(error) };
  } finally {
    await page.close();
  }

  const bing = await context.newPage();
  try {
    const qurl = `https://www.bing.com/images/search?q=${encodeURIComponent(target.query)}`;
    const nav = await bing.goto(qurl,{waitUntil:'domcontentloaded',timeout:120000});
    await sleep(9000);
    await bing.screenshot({path:path.join(diagDir,`${target.id}_bing_full.png`),fullPage:true});
    const tiles = await bing.locator('a.iusc').evaluateAll((nodes) => nodes.map((node,index) => {
      let m={}; try{m=JSON.parse(node.getAttribute('m')||'{}')}catch(_){}
      const img=node.querySelector('img.mimg');
      return {index,metadata:m,thumbSrc:img?.currentSrc||img?.src||'',thumbAlt:img?.alt||''};
    })).catch(()=>[]);
    fs.writeFileSync(path.join(diagDir,`${target.id}_bing_tiles.json`),JSON.stringify({status:nav?.status(),query:target.query,tiles},null,2));
    const exact = tiles.filter((tile) => {
      const text = JSON.stringify(tile).toLowerCase();
      return text.includes(target.listingId) || text.includes(target.page.toLowerCase()) || (target.id === 'CAND-051' && text.includes('vintage 80s fred perry shirt sleeveless women tennis made japan size medium'));
    }).slice(0,20);
    let n=0;
    for (const tile of exact) {
      n+=1;
      for (const [kind,url] of [['murl',tile.metadata?.murl],['turl',tile.metadata?.turl],['thumb',tile.thumbSrc]]) {
        if (!url) continue;
        const row=await fetchImage(context,target,url,{mode:`bing_${kind}`,ordinal:n,sourcePage:tile.metadata?.purl||'',title:tile.metadata?.t||''});
        result.attempts.push(row); if(row?.file) result.preserved.push(row);
      }
    }
    result.bingExactMatches = exact.length;
  } catch (error) {
    result.bingError = String(error);
  } finally {
    await bing.close();
  }
  return result;
}

async function main(){
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1400},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
  for(const target of targets) report.targets.push(await inspectTarget(context,target));
  await browser.close();
  const files=fs.readdirSync(outDir).sort().map((file)=>{const b=fs.readFileSync(path.join(outDir,file));return{file,bytes:b.length,sha256:sha256(b),magicMime:magicMime(b)}});
  report.preservedFiles=files;
  report.nextGate='Manual visual QA must prove exact same-piece identity and physical sewn-label text; no source title alone is promotable.';
  fs.writeFileSync(path.join(diagDir,'rlf-v625-exact-etsy-report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(diagDir,'RLF_V625_ETSY_SHA256SUMS.txt'),files.map((x)=>`${x.sha256}  ${x.file}`).join('\n')+'\n');
  console.log(JSON.stringify({files:files.length,canonicalPromotion:false},null,2));
}
main().catch((error)=>{fs.writeFileSync(path.join(diagDir,'fatal-error.txt'),String(error));console.error(error);process.exitCode=1;});
