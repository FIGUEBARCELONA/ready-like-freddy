const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.resolve('downloaded');
const diagDir = path.resolve('diagnostics');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(diagDir, { recursive: true });

function safeName(name) {
  return name.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 240) || 'download.bin';
}

async function saveDownload(download, index) {
  const suggested = safeName(download.suggestedFilename());
  let target = path.join(outDir, suggested);
  if (fs.existsSync(target)) {
    const ext = path.extname(suggested);
    const base = path.basename(suggested, ext);
    target = path.join(outDir, `${base}_${index}${ext}`);
  }
  await download.saveAs(target);
  console.log(`SAVED_DOWNLOAD ${target}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1200 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/139 Safari/537.36'
  });
  const page = await context.newPage();
  const responseLog = [];
  const requestLog = [];
  const consoleLog = [];
  let downloadIndex = 0;
  const pendingDownloads = [];

  page.on('console', msg => consoleLog.push(`[${msg.type()}] ${msg.text()}`));
  page.on('request', req => {
    const url = req.url();
    if (/upload|download|file|api|storage|cdn|s3/i.test(url)) requestLog.push(`${req.method()} ${url}`);
  });
  page.on('response', res => {
    const url = res.url();
    if (/upload|download|file|api|storage|cdn|s3/i.test(url)) responseLog.push(`${res.status()} ${url}`);
  });
  page.on('download', download => {
    downloadIndex += 1;
    pendingDownloads.push(saveDownload(download, downloadIndex));
  });

  await page.goto(process.env.TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(15000);

  fs.writeFileSync(path.join(diagDir, 'page-url.txt'), page.url());
  fs.writeFileSync(path.join(diagDir, 'page-title.txt'), await page.title());
  fs.writeFileSync(path.join(diagDir, 'page-text.txt'), await page.locator('body').innerText().catch(() => ''));
  fs.writeFileSync(path.join(diagDir, 'page.html'), await page.content());
  await page.screenshot({ path: path.join(diagDir, 'page.png'), fullPage: true });

  const elements = await page.locator('a,button,[role="button"]').evaluateAll(nodes => nodes.map((el, i) => ({
    i,
    tag: el.tagName,
    text: (el.innerText || el.textContent || '').trim(),
    href: el.href || '',
    aria: el.getAttribute('aria-label') || '',
    title: el.getAttribute('title') || '',
    disabled: !!el.disabled,
    outer: el.outerHTML.slice(0, 1000)
  })));
  fs.writeFileSync(path.join(diagDir, 'interactive-elements.json'), JSON.stringify(elements, null, 2));

  const candidates = page.locator('a,button,[role="button"]').filter({ hasText: /download|baixar|descargar|télécharger|herunterladen/i });
  const count = await candidates.count();
  console.log(`DOWNLOAD_CANDIDATES ${count}`);

  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    try {
      if (!(await el.isVisible()) || !(await el.isEnabled())) continue;
      console.log(`CLICK_CANDIDATE ${i} ${((await el.innerText().catch(() => '')) || '').trim()}`);
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 15000 });
      await page.waitForTimeout(5000);
    } catch (err) {
      console.log(`CLICK_FAILED ${i} ${String(err)}`);
    }
  }

  fs.writeFileSync(path.join(diagDir, 'hrefs.txt'), elements.map(e => e.href).filter(Boolean).join('\n'));
  fs.writeFileSync(path.join(diagDir, 'resource-urls.txt'), (await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name))).join('\n'));
  fs.writeFileSync(path.join(diagDir, 'requests.txt'), requestLog.join('\n'));
  fs.writeFileSync(path.join(diagDir, 'responses.txt'), responseLog.join('\n'));
  fs.writeFileSync(path.join(diagDir, 'console.txt'), consoleLog.join('\n'));

  await page.waitForTimeout(10000);
  await Promise.allSettled(pendingDownloads);
  await browser.close();

  const downloaded = fs.readdirSync(outDir);
  console.log(`DOWNLOADED_FILES ${JSON.stringify(downloaded)}`);
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
