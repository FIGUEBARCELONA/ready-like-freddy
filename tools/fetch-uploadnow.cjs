const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {chromium,request}=require('playwright');
const out=path.resolve('downloaded'),diag=path.resolve('diagnostics');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(diag,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function mime(b){if(b.length>=12&&b.subarray(0,4).toString('hex')==='52494646'&&b.subarray(8,12).toString()==='WEBP')return'image/webp';if(b.length>=8&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return'image/png';if(b.length>=3&&b.subarray(0,3).toString('hex')==='ffd8ff')return'image/jpeg';return'application/octet-stream'}
function ext(m){return m==='image/webp'?'webp':m==='image/png'?'png':m==='image/jpeg'?'jpg':'bin'}
const direct=[
 {id:'J1518_VESTIAIRE_LABEL',url:'https://images.vestiairecollective.com/images/resized/w%3D1246%2Cq%3D75%2Cf%3Dauto%2C/produit/burgundy-cotton-fred-perry-jacket-29492494-7_1.jpg',referer:'https://us.vestiairecollective.com/men-clothing/jackets/fred-perry/burgundy-cotton-fred-perry-jacket-29492494.shtml',role:'EXACT_PHYSICAL_LABEL'},
];
const pages=[
 {id:'J1518_VESTIAIRE_PAGE',url:'https://us.vestiairecollective.com/men-clothing/jackets/fred-perry/burgundy-cotton-fred-perry-jacket-29492494.shtml'},
 {id:'JAPAN_MADE_OFFICIAL',url:'https://www.fredperry.com/us/quarterly/made-in-japan'},
 {id:'HIT_UNION_COMPANY',url:'https://www.fredperry.jp/company/'},
 {id:'JAPAN_LICENSE_HISTORY',url:'https://senken.co.jp/brands/fred-perry'},
 {id:'J1826_SELEKTA',url:'https://www.selekta-shop.de/en/Fred-Perry-Parka-Made-in-England-Green-J1826-M'},
 {id:'J1826_YAHOO',url:'https://store.shopping.yahoo.co.jp/betterdays777/j1826.html'},
 {id:'CAND072_EBAY',url:'https://www.ebay.com/itm/317781354098'},
 {id:'CAND073_EBAY',url:'https://www.ebay.com/itm/358285983712'},
 {id:'CAND046_ETSY',url:'https://www.etsy.com/listing/4416347158'},
 {id:'CAND051_ETSY',url:'https://www.etsy.com/listing/1504984921'}
];
const imageQueries=[
 {id:'CAND072_BING',q:'"Fred Perry Made in Italy Merino Wool Argyle Sweater Mens 40 M Black V-Neck NWT"'},
 {id:'CAND073_BING',q:'"Fred Perry Vintage Union Jack Cardigan Zip Up Blue 100% Wool Made in Italy L"'},
 {id:'CAND051_BING',q:'"Vintage 80s FRED PERRY Shirt Sleeveless Women Tennis Made Japan Size Medium"'},
 {id:'CAND046_BING',q:'"Fred Perry" K010 Vietnam down parka label'},
 {id:'CAND055_BING',q:'"M3/157/835/273" Fred Perry'}
];
(async()=>{
 const rows=[];
 const req=await request.newContext({userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',extraHTTPHeaders:{Accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}});
 for(const t of direct){try{const r=await req.get(t.url,{timeout:120000,failOnStatusCode:false,headers:{Referer:t.referer}}),b=await r.body(),m=mime(b),pass=/^image\/(jpeg|png|webp)$/.test(m)&&b.length>=1500;const row={...t,status:r.status(),headerContentType:r.headers()['content-type']||'',bytes:b.length,sha256:sha(b),magicMime:m,binaryPass:pass};if(pass){const f=`${t.id}.${ext(m)}`;fs.writeFileSync(path.join(out,f),b);row.file=f;row.admission='CANDIDATE_MANUAL_QA'}else row.admission='REJECT_BINARY_GATE';rows.push(row)}catch(e){rows.push({...t,error:String(e),admission:'REQUEST_ERROR'})}}
 await req.dispose();
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1100},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
 for(const p of pages){const page=await context.newPage();const network=[];page.on('response',r=>{const u=r.url();if(/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(u))network.push(u)});try{const nav=await page.goto(p.url,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForTimeout(6000);const body=await page.locator('body').innerText().catch(()=>''),html=await page.content().catch(()=>'');fs.writeFileSync(path.join(diag,`${p.id}_DOM.txt`),body);fs.writeFileSync(path.join(diag,`${p.id}_PAGE.html`),html);await page.screenshot({path:path.join(diag,`${p.id}.png`),fullPage:true});const uniq=[...new Set(network)].slice(0,250);fs.writeFileSync(path.join(diag,`${p.id}_IMAGE_URLS.json`),JSON.stringify(uniq,null,2));rows.push({...p,status:nav?.status()||null,finalUrl:page.url(),bodyChars:body.length,htmlChars:html.length,imageUrls:uniq.length,admission:'PAGE_DIAGNOSTIC_ONLY'})}catch(e){rows.push({...p,error:String(e),admission:'PAGE_ERROR'})}await page.close()}
 for(const q of imageQueries){const page=await context.newPage();try{const url='https://www.bing.com/images/search?q='+encodeURIComponent(q.q);const nav=await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});for(let i=0;i<4;i++){await page.mouse.wheel(0,2200);await page.waitForTimeout(1500)}const items=await page.locator('a.iusc').evaluateAll(nodes=>nodes.map(n=>{try{return JSON.parse(n.getAttribute('m')||'{}')}catch{return{}}}).filter(x=>x.murl));fs.writeFileSync(path.join(diag,`${q.id}_RESULTS.json`),JSON.stringify(items,null,2));await page.screenshot({path:path.join(diag,`${q.id}.png`),fullPage:true});let kept=0;for(let i=0;i<items.length&&kept<24;i++){const item=items[i];try{const r=await context.request.get(item.murl,{timeout:45000,failOnStatusCode:false,headers:{Referer:item.purl||url}}),b=await r.body(),m=mime(b);if(/^image\/(jpeg|png|webp)$/.test(m)&&b.length>=2500){const f=`${q.id}_${String(kept+1).padStart(3,'0')}.${ext(m)}`;fs.writeFileSync(path.join(out,f),b);rows.push({id:q.id,query:q.q,index:i,murl:item.murl,purl:item.purl||'',turl:item.turl||'',status:r.status(),bytes:b.length,sha256:sha(b),magicMime:m,file:f,admission:'SEARCH_CANDIDATE_MANUAL_QA'});kept++}}catch(e){}}
 rows.push({id:q.id,query:q.q,status:nav?.status()||null,totalItems:items.length,downloadedCandidates:kept,admission:'SEARCH_DIAGNOSTIC'})}catch(e){rows.push({id:q.id,query:q.q,error:String(e),admission:'SEARCH_ERROR'})}await page.close()}
 await context.close();await browser.close();
 const report={schema:'rlf-v629-exact-label-factory-lineage-v1',policy:'APPEND_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),rows,canonicalPromotion:false,nextGate:'Manual visual QA, exact identity confirmation, deduplication and source-grade reconciliation.'};
 fs.writeFileSync(path.join(diag,'rlf-v629-report.json'),JSON.stringify(report,null,2));
 const files=fs.readdirSync(out).sort();fs.writeFileSync(path.join(diag,'RLF_V629_SHA256SUMS.txt'),files.map(f=>`${sha(fs.readFileSync(path.join(out,f)))}  ${f}`).join('\n')+'\n');
 console.log(JSON.stringify({generatedAt:report.generatedAt,downloadedFiles:files.length,rows:rows.length},null,2));
})().catch(e=>{fs.writeFileSync(path.join(diag,'fatal-error.txt'),String(e));console.error(e);process.exitCode=1});