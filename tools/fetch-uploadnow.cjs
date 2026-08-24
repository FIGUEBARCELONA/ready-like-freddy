const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const outDir = path.resolve('downloaded');
const diagDir = path.resolve('diagnostics');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(diagDir, { recursive: true });

const routes = [
  {
    id: 'RLF-EXT-020',
    code: 'J1518/A25/01975/336',
    file: 'RLF-EXT-020_J1518_Vietnam.jpg',
    page: 'https://us.vestiairecollective.com/men-clothing/jackets/fred-perry/burgundy-cotton-fred-perry-jacket-29492494.shtml',
    urls: [
      'https://images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/burgundy-cotton-fred-perry-jacket-29492494-7_1.jpg',
      'https://images.weserv.nl/?url=images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/burgundy-cotton-fred-perry-jacket-29492494-7_1.jpg'
    ]
  },
  {
    id: 'RLF-EXT-026',
    code: 'M12/1576/35237',
    file: 'RLF-EXT-026_M12_1576_England.jpg',
    page: 'https://us.vestiairecollective.com/men-clothing/polo-shirts/fred-perry/black-cotton-fred-perry-polo-shirt-43131917.shtml',
    urls: [
      'https://images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/black-cotton-fred-perry-polo-shirt-43131917-3_2.jpg',
      'https://images.weserv.nl/?url=images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/black-cotton-fred-perry-polo-shirt-43131917-3_2.jpg'
    ]
  },
  {
    id: 'RLF-EXT-021',
    code: 'J6319/170/2990/154',
    file: 'RLF-EXT-021_J6319_Portugal.jpg',
    page: 'https://gem.app/',
    urls: [
      'https://img.gem.app/449928663/5f/1695627431/fred-perry-fred-ferry-vintage-made-in-portugal.jpg',
      'https://images.weserv.nl/?url=img.gem.app/449928663/5f/1695627431/fred-perry-fred-ferry-vintage-made-in-portugal.jpg'
    ]
  },
  {
    id: 'RLF-EXT-022',
    code: 'J6327/330/2090/196',
    file: 'RLF-EXT-022_J6327_Portugal.jpg',
    page: 'https://gem.app/',
    urls: [
      'https://img.gem.app/317472623/7f/1658213994/fred-perry-fred-perry-laurel-wreath-track-jacket.jpg',
      'https://images.weserv.nl/?url=img.gem.app/317472623/7f/1658213994/fred-perry-fred-perry-laurel-wreath-track-jacket.jpg'
    ]
  }
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isAcceptedImage(contentType, buffer) {
  if (!/^image\/(jpeg|png|webp)$/i.test(contentType || '')) return false;
  if (buffer.length < 1024) return false;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const png = buffer.slice(1, 4).toString('ascii') === 'PNG';
  const webp = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
    extraHTTPHeaders: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
  });
  const report = [];

  for (const route of routes) {
    const attempts = [];
    let accepted = null;
    for (let i = 0; i < route.urls.length; i += 1) {
      const url = route.urls[i];
      try {
        const response = await context.request.get(url, {
          headers: { Referer: route.page },
          timeout: 180000,
          failOnStatusCode: false
        });
        const body = await response.body();
        const contentType = response.headers()['content-type'] || '';
        const row = {
          route: i + 1,
          url,
          status: response.status(),
          contentType,
          bytes: body.length,
          sha256: sha256(body),
          accepted: response.ok() && isAcceptedImage(contentType, body)
        };
        attempts.push(row);
        if (row.accepted) {
          const target = path.join(outDir, route.file);
          fs.writeFileSync(target, body);
          accepted = { file: route.file, ...row };
          break;
        }
        fs.writeFileSync(path.join(diagDir, `${route.id}_route_${i + 1}_rejected.bin`), body);
      } catch (error) {
        attempts.push({ route: i + 1, url, error: String(error), accepted: false });
      }
    }
    report.push({ id: route.id, code: route.code, sourcePage: route.page, accepted, attempts });
  }

  await browser.close();
  const files = fs.readdirSync(outDir).sort().map(file => {
    const body = fs.readFileSync(path.join(outDir, file));
    return { file, bytes: body.length, sha256: sha256(body) };
  });
  fs.writeFileSync(path.join(diagDir, 'rlf-v624-fetch-report.json'), JSON.stringify({
    schema: 'rlf-v624-playwright-fetch-v1',
    policy: 'APPEND_ONLY_FAIL_CLOSED',
    generatedAt: new Date().toISOString(),
    acceptedFiles: files,
    routes: report
  }, null, 2));
  fs.writeFileSync(path.join(diagDir, 'RLF_V624_SHA256SUMS.txt'), files.map(x => `${x.sha256}  ${x.file}`).join('\n') + '\n');
  console.log(JSON.stringify({ accepted: files.length, files }, null, 2));
}

main().catch(error => {
  fs.writeFileSync(path.join(diagDir, 'fatal-error.txt'), String(error));
  console.error(error);
  process.exitCode = 1;
});
