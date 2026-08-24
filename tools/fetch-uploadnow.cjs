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
    id: 'RLF-EXT-020', code: 'J1518/A25/01975/336', stem: 'RLF-EXT-020_J1518_Vietnam',
    sourcePage: 'https://us.vestiairecollective.com/men-clothing/jackets/fred-perry/burgundy-cotton-fred-perry-jacket-29492494.shtml',
    imageNeedle: 'burgundy-cotton-fred-perry-jacket-29492494-7_1',
    direct: 'https://images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/burgundy-cotton-fred-perry-jacket-29492494-7_1.jpg',
    query: 'J1518/A25/01975/336 Fred Perry label'
  },
  {
    id: 'RLF-EXT-026', code: 'M12/1576/35237', stem: 'RLF-EXT-026_M12_1576_England',
    sourcePage: 'https://us.vestiairecollective.com/men-clothing/polo-shirts/fred-perry/black-cotton-fred-perry-polo-shirt-43131917.shtml',
    imageNeedle: 'black-cotton-fred-perry-polo-shirt-43131917-3_2',
    direct: 'https://images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/black-cotton-fred-perry-polo-shirt-43131917-3_2.jpg',
    query: 'M12/1576/35237 Fred Perry label'
  }
];
const blocked = [
  { id:'RLF-EXT-021', code:'J6319/170/2990/154', url:'https://img.gem.app/449928663/5f/1695627431/fred-perry-fred-ferry-vintage-made-in-portugal.jpg' },
  { id:'RLF-EXT-022', code:'J6327/330/2090/196', url:'https://img.gem.app/317472623/7f/1658213994/fred-perry-fred-perry-laurel-wreath-track-jacket.jpg' }
];

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const acceptedImage = (ct,b) => /^image\/(jpeg|png|webp)$/i.test(ct||'') && b.length >= 1024;

async function requestAttempt(context, target, report) {
  try {
    const r = await context.request.get(target.direct, { headers:{Referer:target.sourcePage}, timeout:120000, failOnStatusCode:false });
    const b = await r.body(); const ct=r.headers()['content-type']||'';
    const row={mode:'direct_request',status:r.status(),contentType:ct,bytes:b.length,sha256:sha256(b),accepted:r.ok()&&acceptedImage(ct,b)};
    report.attempts.push(row);
    if(row.accepted){ const f=`${target.stem}_original.jpg`; fs.writeFileSync(path.join(outDir,f),b); report.accepted={file:f,evidenceClass:'ORIGINAL_BINARY',...row}; return true; }
    fs.writeFileSync(path.join(diagDir,`${target.id}_direct_rejected.bin`),b);
  } catch(e){ report.attempts.push({mode:'direct_request',error:String(e),accepted:false}); }
  return false;
}

async function sourcePageAttempt(context, target, report) {
  const page=await context.newPage();
  try {
    const nav=await page.goto(target.sourcePage,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForTimeout(10000);
    await page.screenshot({path:path.join(diagDir,`${target.id}_source_page.png`),fullPage:true});
    const meta=await page.locator('img').evaluateAll((nodes,needle)=>nodes.map((n,i)=>({i,src:n.currentSrc||n.src||'',srcset:n.srcset||'',alt:n.alt||'',nw:n.naturalWidth,nh:n.naturalHeight,visible:!!(n.offsetWidth||n.offsetHeight||n.getClientRects().length)})).filter(x=>(x.src+x.srcset).includes(needle)),target.imageNeedle).catch(()=>[]);
    fs.writeFileSync(path.join(diagDir,`${target.id}_source_images.json`),JSON.stringify({status:nav&&nav.status(),url:page.url(),title:await page.title(),matches:meta},null,2));
    if(meta.length){
      const loc=page.locator('img').nth(meta[0].i);
      if(await loc.isVisible().catch(()=>false)){
        const f=`${target.stem}_rendered_source.png`;
        await loc.screenshot({path:path.join(outDir,f),timeout:60000});
        const b=fs.readFileSync(path.join(outDir,f));
        report.accepted={file:f,evidenceClass:'RENDERED_SOURCE_ELEMENT',bytes:b.length,sha256:sha256(b),accepted:true};
        report.attempts.push({mode:'source_element_screenshot',matches:meta.length,bytes:b.length,accepted:true});
        return true;
      }
    }
    report.attempts.push({mode:'source_element_screenshot',matches:meta.length,accepted:false});
  } catch(e){ report.attempts.push({mode:'source_page',error:String(e),accepted:false}); }
  finally { await page.close(); }
  return false;
}

async function bingAttempt(context,target,report){
  const page=await context.newPage();
  try{
    const url='https://www.bing.com/images/search?q='+encodeURIComponent(target.query);
    const nav=await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForTimeout(8000);
    await page.screenshot({path:path.join(diagDir,`${target.id}_bing_page.png`),fullPage:true});
    const imgs=await page.locator('img.mimg').evaluateAll(nodes=>nodes.map((n,i)=>({i,src:n.currentSrc||n.src||'',alt:n.alt||'',nw:n.naturalWidth,nh:n.naturalHeight,visible:!!(n.offsetWidth||n.offsetHeight||n.getClientRects().length)})).filter(x=>x.visible&&x.nw>=200&&x.nh>=200)).catch(()=>[]);
    fs.writeFileSync(path.join(diagDir,`${target.id}_bing_images.json`),JSON.stringify({status:nav&&nav.status(),url:page.url(),title:await page.title(),images:imgs.slice(0,20)},null,2));
    if(imgs.length){
      const loc=page.locator('img.mimg').nth(imgs[0].i);
      const f=`${target.stem}_rendered_search.png`;
      await loc.screenshot({path:path.join(outDir,f),timeout:60000});
      const b=fs.readFileSync(path.join(outDir,f));
      report.accepted={file:f,evidenceClass:'RENDERED_SEARCH_RESULT',bytes:b.length,sha256:sha256(b),accepted:true,query:target.query};
      report.attempts.push({mode:'bing_result_screenshot',candidates:imgs.length,bytes:b.length,accepted:true});
      return true;
    }
    report.attempts.push({mode:'bing_result_screenshot',candidates:0,accepted:false});
  }catch(e){report.attempts.push({mode:'bing_search',error:String(e),accepted:false});}
  finally{await page.close();}
  return false;
}

async function blockedAttempt(context,item){
  try{const r=await context.request.get(item.url,{timeout:90000,failOnStatusCode:false}); const b=await r.body(); return {id:item.id,code:item.code,status:r.status(),contentType:r.headers()['content-type']||'',bytes:b.length,sha256:sha256(b),accepted:r.ok()&&acceptedImage(r.headers()['content-type'],b)};}catch(e){return {id:item.id,code:item.code,error:String(e),accepted:false};}
}

async function main(){
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
  const reports=[];
  for(const target of targets){const r={id:target.id,code:target.code,sourcePage:target.sourcePage,directUrl:target.direct,accepted:null,attempts:[]}; if(!await requestAttempt(context,target,r) && !await sourcePageAttempt(context,target,r)) await bingAttempt(context,target,r); reports.push(r);}
  const blockedReports=[]; for(const item of blocked) blockedReports.push(await blockedAttempt(context,item));
  await browser.close();
  const files=fs.readdirSync(outDir).sort().map(file=>{const b=fs.readFileSync(path.join(outDir,file));return {file,bytes:b.length,sha256:sha256(b)};});
  const manifest={schema:'rlf-v624-browser-recovery-v2',policy:'APPEND_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),acceptedFiles:files,targets:reports,blocked:blockedReports};
  fs.writeFileSync(path.join(diagDir,'rlf-v624-fetch-report.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(diagDir,'RLF_V624_SHA256SUMS.txt'),files.map(x=>`${x.sha256}  ${x.file}`).join('\n')+'\n');
  console.log(JSON.stringify({accepted:files.length,files,blocked:blockedReports},null,2));
}
main().catch(e=>{fs.writeFileSync(path.join(diagDir,'fatal-error.txt'),String(e));console.error(e);process.exitCode=1;});
