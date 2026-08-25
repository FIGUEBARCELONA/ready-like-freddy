const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {chromium,request}=require('playwright');
const out=path.resolve('downloaded'),diag=path.resolve('diagnostics');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(diag,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function mime(b){if(b.length>=12&&b.subarray(0,4).toString('hex')==='52494646'&&b.subarray(8,12).toString()==='WEBP')return'image/webp';if(b.length>=8&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return'image/png';if(b.length>=3&&b.subarray(0,3).toString('hex')==='ffd8ff')return'image/jpeg';return'application/octet-stream'}
function ext(m){return m==='image/webp'?'webp':m==='image/png'?'png':m==='image/jpeg'?'jpg':'bin'}
function safe(s){return String(s).replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,120)}
(async()=>{
 const report={schema:'rlf-v630-exact-galleries-industrial-archives-v1',policy:'APPEND_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),rows:[],queries:[],canonicalPromotion:false};
 const req=await request.newContext({userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36',extraHTTPHeaders:{Accept:'text/html,application/xhtml+xml,application/json,image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}});
 let fileCounter=0;
 async function downloadBinary(id,url,role,referer=''){
  try{const r=await req.get(url,{timeout:90000,failOnStatusCode:false,headers:referer?{Referer:referer}:{}}),b=await r.body(),m=mime(b),pass=/^image\/(jpeg|png|webp)$/.test(m)&&b.length>=1500;const row={id,url,role,referer,status:r.status(),contentType:r.headers()['content-type']||'',bytes:b.length,sha256:sha(b),magicMime:m,binaryPass:pass};if(pass){fileCounter++;const f=`${safe(id)}_${String(fileCounter).padStart(4,'0')}.${ext(m)}`;fs.writeFileSync(path.join(out,f),b);row.file=f;row.admission='MANUAL_VISUAL_IDENTITY_AND_LITERAL_QA'}else row.admission='REJECT_BINARY_GATE';report.rows.push(row);return row}catch(e){const row={id,url,role,referer,error:String(e),admission:'REQUEST_ERROR'};report.rows.push(row);return row}
 }
 async function fetchText(id,url,role){
  try{const r=await req.get(url,{timeout:120000,failOnStatusCode:false}),b=await r.body(),text=b.toString('utf8');const f=`${safe(id)}_${safe(role)}.txt`;fs.writeFileSync(path.join(diag,f),text);const row={id,url,role,status:r.status(),contentType:r.headers()['content-type']||'',bytes:b.length,sha256:sha(b),textChars:text.length,file:f,admission:'SOURCE_DIAGNOSTIC'};report.rows.push(row);return text}catch(e){report.rows.push({id,url,role,error:String(e),admission:'REQUEST_ERROR'});return''}
 }
 async function jina(id,target){
  const reader='https://r.jina.ai/'+target;const text=await fetchText(id,reader,'JINA_READER');
  const urls=[...new Set((text.match(/https?:\/\/[^\s\]\)<>"']+/g)||[]).map(u=>u.replace(/[),.;]+$/,'')))];
  fs.writeFileSync(path.join(diag,`${safe(id)}_JINA_URLS.json`),JSON.stringify(urls,null,2));
  const imageUrls=urls.filter(u=>/(i\.etsystatic\.com|i\.ebayimg\.com|images\.vestiairecollective\.com|media-assets\.grailed\.com|cdn\.shopify\.com)/i.test(u)&&/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(u));
  let n=0;for(const u of imageUrls){if(n>=35)break;await downloadBinary(id,u,'JINA_DISCOVERED_IMAGE',target);n++}
  return{text,urls,imageUrls};
 }
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1100},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
 async function browse(id,url){
  const page=await context.newPage();try{const nav=await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForTimeout(5000);const body=await page.locator('body').innerText().catch(()=>''),html=await page.content().catch(()=>'');fs.writeFileSync(path.join(diag,`${safe(id)}_DOM.txt`),body);fs.writeFileSync(path.join(diag,`${safe(id)}_PAGE.html`),html);await page.screenshot({path:path.join(diag,`${safe(id)}.png`),fullPage:true});const domUrls=await page.locator('img').evaluateAll(nodes=>nodes.flatMap(n=>[n.src,n.currentSrc,n.getAttribute('data-src'),n.getAttribute('data-zoom-src'),n.getAttribute('data-image')]).filter(Boolean));const regexUrls=html.match(/https?:\\?\/\\?\/[^"'<>\s]+/g)||[];const urls=[...new Set([...domUrls,...regexUrls.map(x=>x.replace(/\\\//g,'/').replace(/&amp;/g,'&'))].filter(u=>/^https?:/.test(u)))];fs.writeFileSync(path.join(diag,`${safe(id)}_IMAGE_URLS.json`),JSON.stringify(urls,null,2));const row={id,url,status:nav?.status()||null,finalUrl:page.url(),bodyChars:body.length,htmlChars:html.length,imageUrls:urls.length,admission:'PAGE_DIAGNOSTIC'};report.rows.push(row);let n=0;for(const u of urls){if(n>=45)break;if(!/(i\.ebayimg\.com|i\.etsystatic\.com|images\.vestiairecollective\.com|media\.rakuten|shopping\.yahoo|selekta-shop)/i.test(u))continue;if(!/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(u))continue;await downloadBinary(id,u,'PAGE_DISCOVERED_IMAGE',url);n++}return{body,html,urls}}catch(e){report.rows.push({id,url,error:String(e),admission:'PAGE_ERROR'});return{body:'',html:'',urls:[]}}finally{await page.close()}
 }
 async function bingImages(id,query,requiredTokens=[]){
  const page=await context.newPage();const searchUrl='https://www.bing.com/images/search?q='+encodeURIComponent(query);try{const nav=await page.goto(searchUrl,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForTimeout(4500);const items=await page.locator('a.iusc').evaluateAll(nodes=>nodes.map(n=>{try{return JSON.parse(n.getAttribute('m')||'{}')}catch{return{}}}).filter(x=>x.murl||x.turl));fs.writeFileSync(path.join(diag,`${safe(id)}_BING_RESULTS.json`),JSON.stringify(items,null,2));await page.screenshot({path:path.join(diag,`${safe(id)}_BING.png`),fullPage:true});report.queries.push({id,query,status:nav?.status()||null,totalItems:items.length});let kept=0;for(let i=0;i<items.length;i++){const item=items[i];const hay=((item.purl||'')+' '+(item.murl||'')+' '+(item.t||'')+' '+(item.desc||'')).toLowerCase();if(requiredTokens.length&&!requiredTokens.some(t=>hay.includes(String(t).toLowerCase())))continue;for(const [kind,u] of [['SOURCE',item.murl],['THUMBNAIL',item.turl]]){if(!u)continue;if(kept>=50)break;await downloadBinary(id,u,`BING_${kind}`,item.purl||searchUrl);kept++}if(kept>=50)break}return items}catch(e){report.rows.push({id,query,error:String(e),admission:'SEARCH_ERROR'});return[]}finally{await page.close()}
 }
 async function jinaSearch(id,query){const url='https://s.jina.ai/'+encodeURIComponent(query);const text=await fetchText(id,url,'JINA_SEARCH');report.queries.push({id,query,textChars:text.length});return text}
 const pages=[
  ['CAND072_EBAY','https://www.ebay.com/itm/317781354098'],
  ['CAND073_EBAY','https://www.ebay.com/itm/358285983712'],
  ['CAND046_ETSY','https://www.etsy.com/listing/4416347158'],
  ['CAND051_ETSY','https://www.etsy.com/listing/1504984921'],
  ['BETA_MJ3295_EBAY','https://www.ebay.com/itm/355768691776'],
  ['J1826_SELEKTA','https://www.selekta-shop.de/en/Fred-Perry-Parka-Made-in-England-Green-J1826-M'],
  ['J1826_YAHOO','https://store.shopping.yahoo.co.jp/betterdays777/j1826.html'],
  ['HIT_UNION_COMPANY','https://www.fredperry.jp/company/'],
  ['HIT_UNION_TAKEFU','https://291jobs.pref.fukui.lg.jp/uiturn/search/detail.php?ID=2285'],
  ['FRED_PERRY_MADE_IN_JAPAN','https://www.fredperry.com/us/quarterly/made-in-japan'],
  ['BETA_GAZZETTA_1990','https://www.gazzettaufficiale.it/atto/parte_seconda/caricaDettaglioAtto/originario?atto.codiceRedazionale=C-11424&atto.dataPubblicazioneGazzetta=1990-04-12'],
  ['BETA_GAZZETTA_1991','https://www.gazzettaufficiale.it/atto/parte_seconda/caricaDettaglioAtto/originario?atto.codiceRedazionale=C-11318&atto.dataPubblicazioneGazzetta=1991-04-10']
 ];
 for(const [id,url] of pages){await browse(id,url);await jina(id,url)}
 const searches=[
  ['CAND072_EXACT','site:ebay.com/itm/317781354098 "Fred Perry Made in Italy Merino Wool Argyle Sweater Mens 40 M Black V-Neck NWT"',['317781354098']],
  ['CAND073_EXACT','site:ebay.com/itm/358285983712 "Fred Perry Vintage Union Jack Cardigan Zip Up Blue 100% Wool Made in Italy L"',['358285983712','union jack cardigan']],
  ['CAND046_EXACT','site:etsy.com/listing/4416347158 "FRED PERRY Jacket Men\'s M Down Filled Parka"',['4416347158','down filled parka']],
  ['CAND046_LABEL','"MADE IN VIETNAM" "80% down" "20% feathers" "Fred Perry"',['made in vietnam','80% down','fred perry']],
  ['CAND051_EXACT','site:etsy.com/listing/1504984921 "Fred Perry"',['1504984921']],
  ['CAND055_M3','"M3/157/835/273" "Fred Perry"',['m3/157/835/273']],
  ['CAND055_M12','"M12/157/835/273" "Fred Perry"',['m12/157/835/273']],
  ['J1826_LABEL','"J1826" "Fred Perry" label care tag',['j1826','fred perry']],
  ['BETA_MJ3295','site:ebay.com/itm/355768691776 "MJ3295" "Beta S.p.A."',['355768691776','mj3295']],
  ['HONG_KONG_LABEL','"Fred Perry" "Made in Hong Kong" label',['made in hong kong','fred perry']],
  ['HONG_KONG_LICENSE','"Fred Perry" Hong Kong licensee manufacturer',['hong kong','fred perry']]
 ];
 for(const [id,q,tokens] of searches)await bingImages(id,q,tokens);
 const archiveQueries=[
  ['JAPAN_LICENSE_PRIMARY','site:fredperry.jp OR site:hit-union.co.jp Fred Perry 1970 1971 history license'],
  ['HIT_UNION_HISTORY','Hit Union company history Fred Perry 1969 1970 official'],
  ['HONG_KONG_PRIMARY','Fred Perry Hong Kong licensee importer manufacturer historical company'],
  ['HONG_KONG_LABEL_ARCHIVE','Fred Perry Made in Hong Kong label company address'],
  ['BETA_DATE','Beta S.p.A. Fred Perry license 1980 1990 Verrone Massazza'],
  ['MJ3295_DATE','Fred Perry MJ3295 release year Beta S.p.A.']
 ];
 for(const [id,q] of archiveQueries)await jinaSearch(id,q);
 await context.close();await browser.close();await req.dispose();
 report.downloadedFiles=fs.readdirSync(out).sort();report.downloadedCount=report.downloadedFiles.length;
 fs.writeFileSync(path.join(diag,'rlf-v630-report.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(diag,'RLF_V630_SHA256SUMS.txt'),report.downloadedFiles.map(f=>`${sha(fs.readFileSync(path.join(out,f)))}  ${f}`).join('\n')+'\n');
 console.log(JSON.stringify({downloadedFiles:report.downloadedCount,rows:report.rows.length,queries:report.queries.length},null,2));
})().catch(e=>{fs.writeFileSync(path.join(diag,'fatal-error.txt'),String(e));console.error(e);process.exitCode=1});