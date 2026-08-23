const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const targetUrl = process.env.TARGET_URL || 'https://uploadnow.io/f/mFyDB1H';
const captureOnly = process.env.CAPTURE_DOWNLOAD_URL_ONLY !== '0';
const outDir = path.resolve('downloaded');
const diagDir = path.resolve('diagnostics');
const apiDir = path.join(diagDir, 'api-bodies');
for (const dir of [outDir, diagDir, apiDir]) fs.mkdirSync(dir, { recursive: true });

function safeName(name) {
  return (name || 'download.bin')
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220) || 'download.bin';
}

function uniqueTarget(name) {
  const safe = safeName(name);
  let target = path.join(outDir, safe);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  for (let i = 2; i < 10000; i += 1) {
    target = path.join(outDir, `${base}_${i}${ext}`);
    if (!fs.existsSync(target)) return target;
  }
  throw new Error(`Unable to allocate unique target for ${safe}`);
}

async function processDownload(download, records) {
  const record = {
    suggestedFilename: download.suggestedFilename(),
    url: download.url(),
    capturedAt: new Date().toISOString(),
    mode: captureOnly ? 'capture-and-cancel' : 'save'
  };
  records.push(record);
  fs.writeFileSync(path.join(diagDir, 'download-candidates.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(diagDir, 'download-url.txt'), `${record.url}\n`, { mode: 0o600 });
  console.log(`DOWNLOAD_URL_CAPTURED ${record.suggestedFilename} ${record.url}`);

  if (captureOnly) {
    await download.cancel();
    record.cancelled = true;
    fs.writeFileSync(path.join(diagDir, 'download-candidates.json'), JSON.stringify(records, null, 2));
    return;
  }

  const target = uniqueTarget(record.suggestedFilename);
  await download.saveAs(target);
  record.savedAs = target;
  record.bytes = fs.statSync(target).size;
  fs.writeFileSync(path.join(diagDir, 'download-candidates.json'), JSON.stringify(records, null, 2));
  console.log(`SAVED_DOWNLOAD ${target} ${record.bytes}`);
}

function bodyFileName(url, contentType, index) {
  const digest = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  const ext = /json/i.test(contentType) ? '.json' : /html/i.test(contentType) ? '.html' : '.txt';
  return `${String(index).padStart(4, '0')}-${digest}${ext}`;
}

function shouldCaptureNetworkUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'uploadnow.io' || parsed.hostname.endsWith('.uploadnow.io');
  } catch {
    return false;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1200 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36'
  });
  const page = await context.newPage();
  const requestLog = [];
  const responseLog = [];
  const consoleLog = [];
  const pageErrors = [];
  const apiIndex = [];
  const bodyTasks = [];
  const pendingDownloads = [];
  const downloadRecords = [];
  let bodyIndex = 0;

  page.on('console', msg => consoleLog.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => pageErrors.push(String(err)));
  page.on('download', download => {
    pendingDownloads.push(processDownload(download, downloadRecords));
  });
  page.on('request', request => {
    const url = request.url();
    if (!shouldCaptureNetworkUrl(url)) return;
    const postData = request.postData();
    requestLog.push(`${request.method()} ${url}${postData ? `\nPOST_DATA ${postData}` : ''}`);
  });
  page.on('response', response => {
    const url = response.url();
    if (!shouldCaptureNetworkUrl(url)) return;
    const headers = response.headers();
    const contentType = headers['content-type'] || '';
    const contentLength = Number(headers['content-length'] || 0);
    responseLog.push(`${response.status()} ${url} ${contentType} ${contentLength || ''}`.trim());
    if (/\/api\//i.test(new URL(url).pathname) &&
        (/json|text|javascript|html/i.test(contentType) || contentLength === 0 || contentLength < 5_000_000)) {
      bodyTasks.push((async () => {
        try {
          const body = await response.body();
          if (body.length > 5_000_000) return;
          bodyIndex += 1;
          const file = bodyFileName(url, contentType, bodyIndex);
          fs.writeFileSync(path.join(apiDir, file), body);
          apiIndex.push({ file, status: response.status(), url, contentType, bytes: body.length });
        } catch (error) {
          apiIndex.push({ status: response.status(), url, contentType, error: String(error) });
        }
      })());
    }
  });

  console.log(`TARGET_URL ${targetUrl}`);
  console.log(`CAPTURE_DOWNLOAD_URL_ONLY ${captureOnly}`);
  const navigation = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  console.log(`NAVIGATION_STATUS ${navigation ? navigation.status() : 'none'}`);
  await page.waitForTimeout(10000);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  fs.writeFileSync(path.join(diagDir, 'initial-url.txt'), page.url());
  fs.writeFileSync(path.join(diagDir, 'initial-title.txt'), await page.title());
  fs.writeFileSync(path.join(diagDir, 'initial-text.txt'), await page.locator('body').innerText().catch(() => ''));
  fs.writeFileSync(path.join(diagDir, 'initial.html'), await page.content());
  await page.screenshot({ path: path.join(diagDir, 'initial.png'), fullPage: true });

  const elementSelector = 'a,button,[role="button"],[download]';
  const initialElements = await page.locator(elementSelector).evaluateAll(nodes => nodes.map((el, i) => ({
    i,
    tag: el.tagName,
    text: (el.innerText || el.textContent || '').trim(),
    href: el.href || '',
    download: el.getAttribute('download') || '',
    aria: el.getAttribute('aria-label') || '',
    title: el.getAttribute('title') || '',
    disabled: Boolean(el.disabled),
    visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    outer: el.outerHTML.slice(0, 1500)
  })));
  fs.writeFileSync(path.join(diagDir, 'initial-interactive-elements.json'), JSON.stringify(initialElements, null, 2));

  const selectors = [
    'button:has(svg[data-icon="arrow-down-to-line"])',
    'button.file_browser_alt_options__SIx68',
    'a[download]',
    'button:has-text("Download selection")',
    'button:has-text("Download")',
    'a:has-text("Download")',
    '[role="button"]:has-text("Download")',
    'button:has-text("Baixar")',
    'button:has-text("Descargar")',
    'button:has-text("Télécharger")',
    'button:has-text("Herunterladen")'
  ];

  const clickedHandles = new Set();
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    console.log(`CANDIDATES ${selector} ${count}`);
    for (let i = 0; i < count; i += 1) {
      const element = locator.nth(i);
      try {
        if (!(await element.isVisible()) || !(await element.isEnabled())) continue;
        const handle = await element.elementHandle();
        if (!handle || clickedHandles.has(handle)) continue;
        clickedHandles.add(handle);
        const text = (await element.innerText().catch(() => '')).trim();
        const icon = await element.locator('svg').first().getAttribute('data-icon').catch(() => '');
        console.log(`CLICK selector=${selector} index=${i} text=${JSON.stringify(text)} icon=${icon || ''}`);
        await element.scrollIntoViewIfNeeded();
        await element.click({ timeout: 20000 });
        await page.waitForTimeout(5000);
        if (downloadRecords.length > 0) break;
      } catch (error) {
        console.log(`CLICK_FAILED ${selector} ${i} ${String(error)}`);
      }
    }
    if (downloadRecords.length > 0) break;
  }

  await page.waitForTimeout(8000);
  await Promise.allSettled(bodyTasks);
  await Promise.allSettled(pendingDownloads);

  fs.writeFileSync(path.join(diagDir, 'final-url.txt'), page.url());
  fs.writeFileSync(path.join(diagDir, 'final-title.txt'), await page.title());
  fs.writeFileSync(path.join(diagDir, 'final-text.txt'), await page.locator('body').innerText().catch(() => ''));
  fs.writeFileSync(path.join(diagDir, 'final.html'), await page.content());
  await page.screenshot({ path: path.join(diagDir, 'final.png'), fullPage: true });

  const finalElements = await page.locator(elementSelector).evaluateAll(nodes => nodes.map((el, i) => ({
    i,
    tag: el.tagName,
    text: (el.innerText || el.textContent || '').trim(),
    href: el.href || '',
    download: el.getAttribute('download') || '',
    aria: el.getAttribute('aria-label') || '',
    title: el.getAttribute('title') || '',
    disabled: Boolean(el.disabled),
    visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
    outer: el.outerHTML.slice(0, 1500)
  })));

  fs.writeFileSync(path.join(diagDir, 'final-interactive-elements.json'), JSON.stringify(finalElements, null, 2));
  fs.writeFileSync(path.join(diagDir, 'requests.txt'), requestLog.join('\n\n'));
  fs.writeFileSync(path.join(diagDir, 'responses.txt'), responseLog.join('\n'));
  fs.writeFileSync(path.join(diagDir, 'console.txt'), consoleLog.join('\n'));
  fs.writeFileSync(path.join(diagDir, 'page-errors.txt'), pageErrors.join('\n'));
  fs.writeFileSync(path.join(diagDir, 'api-index.json'), JSON.stringify(apiIndex, null, 2));
  fs.writeFileSync(path.join(diagDir, 'download-candidates.json'), JSON.stringify(downloadRecords, null, 2));
  fs.writeFileSync(path.join(diagDir, 'resource-urls.txt'), (await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))).join('\n'));

  await browser.close();
  const downloaded = fs.readdirSync(outDir);
  console.log(`DOWNLOADED_FILES ${JSON.stringify(downloaded)}`);
  console.log(`DOWNLOAD_CANDIDATES_CAPTURED ${downloadRecords.length}`);
  if (downloadRecords.length === 0) {
    throw new Error('No per-file download URL was captured from the public share page.');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
