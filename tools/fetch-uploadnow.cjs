const fs=require('fs'),path=require('path'),crypto=require('crypto');const{chromium,request}=require('playwright');
const out=path.resolve('downloaded'),diag=path.resolve('diagnostics');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(diag,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const safe=s=>String(s).replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,90);function mime(b){if(b.length>=12&&b.subarray(0,4).toString('hex')==='52494646'&&b.subarray(8,12).toString()==='WEBP')return'image/webp';if(b.length>=8&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return'image/png';if(b.length>=3&&b.subarray(0,3).toString('hex')==='ffd8ff')return'image/jpeg';return'application/octet-stream'}function ext(m){return m==='image/webp'?'webp':m==='image/png'?'png':m==='image/jpeg'?'jpg':'bin'}
(async()=>{const rows=[],searches=[],pages=[],archives=[];let kept=0;const req=await request.newContext({userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',extraHTTPHeaders:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}});
async function dl(id,url,role,referer=''){try{const r=await req.get(url,{timeout:90000,failOnStatusCode:false,headers:referer?{Referer:referer,Accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}:{Accept:'image/*,*/*;q=0.8'}}),b=await r.body(),m=mime(b),pass=/^image\/(jpeg|png|webp)$/.test(m)&&b.length>=1800;const row={id,url,role,referer,status:r.status(),contentType:r.headers()['content-type']||'',bytes:b.length,sha256:sha(b),magicMime:m,binaryPass:pass};if(pass){kept++;const f=`${safe(id)}_${String(kept).padStart(4,'0')}.${ext(m)}`;fs.writeFileSync(path.join(out,f),b);row.file=f;row.admission='MANUAL_IDENTITY_AND_LITERAL_QA'}else row.admission='REJECT_BINARY_GATE';rows.push(row);return row}catch(e){const row={id,url,role,referer,error:String(e),admission:'REQUEST_ERROR'};rows.push(row);return row}}
async function saveText(id,url){try{const r=await req.get(url,{timeout:90000,failOnStatusCode:false}),t=await r.text();fs.writeFileSync(path.join(diag,`${safe(id)}.txt`),t);return{status:r.status(),chars:t.length}}catch(e){return{error:String(e)}}}
const direct=[
['HK_M3000_RETROSPECT','https://retrospectclothes.com/cdn/shop/products/MG_7084.jpg?v=1587703455&width=3840','EXACT_PRO_STORE_LABEL','https://retrospectclothes.com/products/copy-o-280'],
['HK_WOOL_RESale_EBAY','https://i.ebayimg.com/images/g/SioAAeSwj9No2slG/s-l1200.jpg','EXACT_EBAY_LABEL','https://www.ebay.com/itm/297646927418']
];for(const x of direct)await dl(...x);
const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1050},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
async function capturePage(id,url,max=60){const p=await ctx.newPage();try{const nav=await p.goto(url,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForTimeout(4500);const html=await p.content(),body=await p.locator('body').innerText().catch(()=>''),urls=[...new Set((html.match(/https?:\\?\/\\?\/[^"'<>\s]+/g)||[]).map(x=>x.replace(/\\\//g,'/').replace(/&amp;/g,'&')).filter(u=>/(i\.ebayimg\.com|i\.etsystatic\.com|cdn\.shopify\.com|retrospectclothes\.com\/cdn)/i.test(u)&&/\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(u)))];fs.writeFileSync(path.join(diag,`${safe(id)}_PAGE.html`),html);fs.writeFileSync(path.join(diag,`${safe(id)}_DOM.txt`),body);fs.writeFileSync(path.join(diag,`${safe(id)}_URLS.json`),JSON.stringify(urls,null,2));await p.screenshot({path:path.join(diag,`${safe(id)}.png`),fullPage:true});pages.push({id,url,status:nav?.status()||null,bodyChars:body.length,htmlChars:html.length,imageUrls:urls.length});let n=0;for(const u of urls){if(n++>=max)break;await dl(id,u,'PAGE_IMAGE',url)}}catch(e){pages.push({id,url,error:String(e)})}await p.close()}
const exactPages=[
['CAND046_ETSY','https://www.etsy.com/fi-en/listing/4416347158/fred-perry-jacket-mens-m-down-filled'],
['CAND051_ETSY','https://www.etsy.com/listing/1504984921'],
['CAND072_EBAY','https://www.ebay.com/itm/317781354098'],
['CAND073_EBAY','https://www.ebay.com/itm/358285983712'],
['J1826_SELEKTA','https://www.selekta-shop.de/en/Fred-Perry-Parka-Made-in-England-Green-J1826-M'],
['J1826_YAHOO','https://store.shopping.yahoo.co.jp/betterdays777/j1826.html'],
['HK_M3000_RETROSPECT_PAGE','https://retrospectclothes.com/products/copy-o-280'],
['HK_WOOL_EBAY_PAGE','https://www.ebay.com/itm/297646927418'],
['FP_WINZEN_OFFICIAL','https://www.fredperry.com/us/subculture/articles/china-factory-winzen'],
['FP_LS_OFFICIAL','https://www.fredperry.com/au-en/subculture/articles/made-in-england-wolverhampton'],
['FP_JAPAN_OFFICIAL','https://www.fredperry.com/us/quarterly/made-in-japan']
];for(const x of exactPages)await capturePage(...x);
async function bing(id,q,filter=''){const p=await ctx.newPage(),url='https://www.bing.com/images/search?q='+encodeURIComponent(q);try{const nav=await p.goto(url,{waitUntil:'domcontentloaded',timeout:120000});await p.waitForTimeout(5000);const items=await p.locator('a.iusc').evaluateAll(ns=>ns.map(n=>{try{return JSON.parse(n.getAttribute('m')||'{}')}catch{return{}}}).filter(x=>x.murl));fs.writeFileSync(path.join(diag,`${safe(id)}_BING.json`),JSON.stringify(items,null,2));await p.screenshot({path:path.join(diag,`${safe(id)}_BING.png`),fullPage:true});searches.push({id,q,status:nav?.status()||null,total:items.length,filter});let n=0;for(const x of items){if(n>=50)break;if(filter&&!String(x.purl||'').includes(filter)&&!String(x.murl||'').includes(filter))continue;await dl(id,x.murl,'BING_MURL',x.purl||url);n++}}catch(e){searches.push({id,q,error:String(e)})}await p.close()}
const jobs=[
['CAND046_EXACT','"4416347158" "Fred Perry" "Made in Vietnam"','4416347158'],
['CAND046_TITLE','"FRED PERRY Jacket Men M Down Filled Parka"',''],
['CAND051_EXACT','"1504984921" "Fred Perry"','1504984921'],
['CAND055_M3','"M3/157/835/273" "Fred Perry"',''],
['CAND055_M12','"M12/157/835/273" "Fred Perry"',''],
['J1826_LABEL','"J1826" "Fred Perry" label',''],
['CAND072_LABEL','"317781354098" "Fred Perry" label','317781354098'],
['CAND073_LABEL','"358285983712" "Fred Perry" label','358285983712'],
['MJ3295_DATE','"MJ3295" "Fred Perry" label',''],
['HK_LICENSE','"Fred Perry" "Made in Hong Kong" label',''],
['HK_M3000_CODE','"M3000/216/2390/203"',''],
['HK_FOR_RESALE','"Fred Perry" "Made in Hong Kong" "FOR RESALE"','']
];for(const x of jobs)await bing(...x);
const archiveTargets=[
['ARCH_CAND046','https://web.archive.org/cdx/search/cdx?url=etsy.com/listing/4416347158*&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=digest&fl=timestamp,original,statuscode,mimetype,digest&limit=50'],
['ARCH_CAND051','https://web.archive.org/cdx/search/cdx?url=etsy.com/listing/1504984921*&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=digest&fl=timestamp,original,statuscode,mimetype,digest&limit=50'],
['ARCH_CAND072','https://web.archive.org/cdx/search/cdx?url=ebay.com/itm/317781354098*&output=json&filter=statuscode:200&collapse=digest&fl=timestamp,original,statuscode,mimetype,digest&limit=50'],
['ARCH_CAND073','https://web.archive.org/cdx/search/cdx?url=ebay.com/itm/358285983712*&output=json&filter=statuscode:200&collapse=digest&fl=timestamp,original,statuscode,mimetype,digest&limit=50'],
['ARCH_J1826','https://web.archive.org/cdx/search/cdx?url=*J1826*&output=json&filter=statuscode:200&collapse=digest&fl=timestamp,original,statuscode,mimetype,digest&limit=100']
];for(const [id,url] of archiveTargets){archives.push({id,url,...await saveText(id,url)})}
await ctx.close();await browser.close();await req.dispose();const files=fs.readdirSync(out).sort();const report={schema:'rlf-v631-exact-recovery-v1',policy:'APPEND_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),rows,pages,searches,archives,downloadedFiles:files,canonicalPromotion:false,nextGate:'Manual visual identity/literal QA, deduplication, and factory-role boundaries.'};fs.writeFileSync(path.join(diag,'rlf-v631-report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(diag,'RLF_V631_SHA256SUMS.txt'),files.map(f=>`${sha(fs.readFileSync(path.join(out,f)))}  ${f}`).join('\n')+'\n');console.log(JSON.stringify({downloadedFiles:files.length,rows:rows.length,pages:pages.length,searches:searches.length,archives:archives.length},null,2));})().catch(e=>{fs.writeFileSync(path.join(diag,'fatal-error.txt'),String(e));console.error(e);process.exitCode=1});