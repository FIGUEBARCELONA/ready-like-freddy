const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const outDir = path.resolve('downloaded');
const diagDir = path.resolve('diagnostics');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(diagDir, { recursive: true });

const targets = [
  { id:'OFFICIAL-M3', page:'https://www.fredperry.com/us/brandbook', direct:[
    'https://www.fredperry.com/static/version0.0.0.888/frontend/Magento/base/default/Perry_Brandbook/images/the-shirt/m3-v4.png',
    'https://www.fredperry.com/static/version0.0.0.888/frontend/Magento/base/default/Perry_Brandbook/images/the-shirt/style-tag-3.png'
  ], tokens:['m3-v4','style-tag-3','original one colour fred perry shirt','m1211'] },
  { id:'HIST-M3-1952', page:'https://designmuseum.org/exhibitions/fred-perry-a-british-icon', tokens:['original m3 fred perry shirt','1952','fred perry'] },
  { id:'CAND-073', page:'https://www.ebay.com/itm/358285983712', tokens:['358285983712','union jack','fred perry','cardigan'] },
  { id:'CAND-072', page:'https://www.ebay.com/itm/317781354098', tokens:['317781354098','argyle','merino','fred perry'] },
  { id:'CAND-040-J1826-A', page:'https://item.rakuten.co.jp/better/j1826/', tokens:['j1826','fred perry','made in england','parka'] },
  { id:'CAND-040-J1826-B', page:'https://www.selekta-shop.de/en/Fred-Perry-Parka-Made-in-England-Green-J1826-M', tokens:['j1826','fred perry','parka','england'] },
  { id:'RLF-EXT-020-J1518', page:'https://www.instagram.com/p/DVvOqMrAh5i/', tokens:['j1518','01975','336','fred perry'] },
  { id:'CAND-046', page:'https://www.etsy.com/listing/4416347158', tokens:['4416347158','fred perry','vietnam','down'] },
  { id:'CAND-051', page:'https://www.etsy.com/listing/1504984921', tokens:['1504984921','fred perry','japan','tennis'] }
];

const queries = [
  {id:'OFFICIAL-M3',q:'site:fredperry.com "m3-v4.png" "Fred Perry"'},
  {id:'OFFICIAL-M1211',q:'site:fredperry.com "style-tag-3.png" "M1211"'},
  {id:'HIST-M3-1952',q:'"The Original M3 Fred Perry Shirt, 1952" label'},
  {id:'CAND-073',q:'"358285983712" "Fred Perry"'},
  {id:'CAND-072',q:'"317781354098" "Fred Perry"'},
  {id:'CAND-040-J1826',q:'"J1826" "Fred Perry" label'},
  {id:'RLF-EXT-020-J1518',q:'"J1518/A25/01975/336" "Fred Perry"'},
  {id:'CAND-046',q:'"4416347158" "Fred Perry"'},
  {id:'CAND-051',q:'"1504984921" "Fred Perry"'}
];

const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function mime(b){if(b.length>=12&&b.subarray(0,4).toString('hex')==='52494646'&&b.subarray(8,12).toString()==='WEBP')return'image/webp';if(b.length>=8&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return'image/png';if(b.length>=3&&b.subarray(0,3).toString('hex')==='ffd8ff')return'image/jpeg';return'application/octet-stream'}
function ext(m){return m==='image/webp'?'webp':m==='image/png'?'png':m==='image/jpeg'?'jpg':'bin'}
function safe(s){return String(s||'').replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,150)}
function tokenMatch(text,tokens){const v=String(text||'').toLowerCase();return tokens.some(t=>v.includes(String(t).toLowerCase()))}

const seen=new Set();
const report={schema:'rlf-v626-multisource-recovery-v1',policy:'APPEND_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),pages:[],attempts:[],preserved:[],searches:[],canonicalPromotion:false};
function preserve(buffer,targetId,label,provenance={}){const magicMime=mime(buffer),hash=sha256(buffer),binaryPass=/^image\/(jpeg|png|webp)$/.test(magicMime)&&buffer.length>=1500;const row={targetId,label,...provenance,bytes:buffer.length,sha256:hash,magicMime,binaryPass};if(binaryPass&&!seen.has(hash)){seen.add(hash);const ordinal=String(report.preserved.filter(x=>x.targetId===targetId).length+1).padStart(3,'0');const file=`${safe(targetId)}_${ordinal}_${safe(label)}.${ext(magicMime)}`;fs.writeFileSync(path.join(outDir,file),buffer);row.file=file;row.admission='CANDIDATE_ONLY_MANUAL_VISUAL_GATE';report.preserved.push(row)}else row.admission=binaryPass?'DUPLICATE_SHA':'REJECT_BINARY_GATE';report.attempts.push(row);return row}
async function fetchCandidate(request,targetId,url,label,provenance={}){if(!url||!/^https?:\/\//i.test(url))return;try{const response=await request.get(url,{timeout:90000,failOnStatusCode:false,headers:{Referer:provenance.referer||provenance.sourcePage||'',Accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}});const body=await response.body();preserve(body,targetId,label,{...provenance,url,status:response.status(),headerContentType:response.headers()['content-type']||''})}catch(error){report.attempts.push({targetId,label,url,...provenance,error:String(error),admission:'REQUEST_ERROR'})}}
function extractImageUrls(text){const out=new Set(),decoded=String(text||'').replace(/\\u002F/g,'/').replace(/\\\//g,'/').replace(/&amp;/g,'&');const re=/https?:[^"'<>\s]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'<>\s]*)?/gi;for(const m of decoded.matchAll(re))out.add(m[0]);return[...out]}

async function inspectPage(context,target){const page=await context.newPage(),network=new Set();page.on('response',response=>{const ct=response.headers()['content-type']||'';if(/^image\//i.test(ct))network.add(response.url())});const row={id:target.id,page:target.page};try{const nav=await page.goto(target.page,{waitUntil:'domcontentloaded',timeout:120000});await sleep(9000);await page.waitForLoadState('networkidle',{timeout:20000}).catch(()=>{});row.status=nav?nav.status():null;row.finalUrl=page.url();row.title=await page.title();const data=await page.evaluate(()=>({bodyText:(document.body?.innerText||'').slice(0,100000),html:document.documentElement?.outerHTML||'',ogImage:document.querySelector('meta[property="og:image"]')?.content||'',images:[...document.images].map((img,index)=>({index,src:img.currentSrc||img.src||'',srcset:img.srcset||'',alt:img.alt||'',width:img.naturalWidth||0,height:img.naturalHeight||0}))}));fs.writeFileSync(path.join(diagDir,`${safe(target.id)}_page.json`),JSON.stringify({...row,bodyText:data.bodyText,images:data.images},null,2));fs.writeFileSync(path.join(diagDir,`${safe(target.id)}_page.html`),data.html);await page.screenshot({path:path.join(diagDir,`${safe(target.id)}_page.png`),fullPage:true}).catch(()=>{});const urls=new Set();if(data.ogImage)urls.add(data.ogImage);for(const img of data.images){const descriptor=`${img.src} ${img.srcset} ${img.alt}`;const relevant=tokenMatch(descriptor,target.tokens)||(img.width>=500&&img.height>=400&&/fred|perry|ebayimg|rakuten|selekta|designmuseum/i.test(descriptor));if(!relevant)continue;if(img.src)urls.add(img.src);for(const part of String(img.srcset||'').split(',')){const u=part.trim().split(/\s+/)[0];if(u)urls.add(u)}}for(const u of extractImageUrls(data.html)){if(tokenMatch(u,target.tokens)||/i\.ebayimg\.com|fredperry\.com\/static|designmuseum|rakuten|selekta/i.test(u))urls.add(u)}for(const u of network){if(tokenMatch(u,target.tokens)||/i\.ebayimg\.com|fredperry\.com\/static|designmuseum|rakuten|selekta/i.test(u))urls.add(u)}let i=0;for(const u of[...urls].slice(0,120)){i++;await fetchCandidate(context.request,target.id,u,`page_${String(i).padStart(3,'0')}`,{sourcePage:target.page,referer:target.page})}}catch(error){row.error=String(error)}finally{report.pages.push(row);await page.close()}}

async function bingSearch(context,entry){const page=await context.newPage(),result={id:entry.id,query:entry.q,tiles:0,matched:0};try{const url=`https://www.bing.com/images/search?q=${encodeURIComponent(entry.q)}`;const nav=await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});await sleep(7000);const tiles=await page.locator('a.iusc').evaluateAll(nodes=>nodes.slice(0,80).map((node,index)=>{let m={};try{m=JSON.parse(node.getAttribute('m')||'{}')}catch(_){}return{index,m}})).catch(()=>[]);result.status=nav?nav.status():null;result.tiles=tiles.length;const tokens=entry.q.toLowerCase().replace(/["']/g,'').split(/\s+/).filter(x=>x.length>=4),matched=tiles.filter(t=>tokenMatch(JSON.stringify(t.m),tokens));result.matched=matched.length;let i=0;for(const tile of matched.slice(0,30)){i++;for(const[kind,u]of[['murl',tile.m?.murl],['turl',tile.m?.turl]])if(u)await fetchCandidate(context.request,entry.id,u,`bing_${String(i).padStart(3,'0')}_${kind}`,{sourcePage:tile.m?.purl||'',title:tile.m?.t||'',referer:url})}await page.screenshot({path:path.join(diagDir,`${safe(entry.id)}_bing.png`),fullPage:true}).catch(()=>{})}catch(error){result.error=String(error)}finally{report.searches.push(result);await page.close()}}

(async()=>{const browser=await chromium.launch({headless:true});const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});for(const target of targets){for(let i=0;i<(target.direct||[]).length;i++)await fetchCandidate(context.request,target.id,target.direct[i],`direct_${i+1}`,{sourcePage:target.page,referer:target.page});await inspectPage(context,target)}for(const q of queries)await bingSearch(context,q);await browser.close();report.exactIdentityVerified=false;report.nextGate='Manual visual review per target, then exact physical-text transcription and scoped/global deduplication. No automatic promotion.';fs.writeFileSync(path.join(diagDir,'rlf-v626-multisource-report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(diagDir,'RLF_V626_SHA256SUMS.txt'),report.preserved.map(x=>`${x.sha256}  ${x.file}`).join('\n')+'\n');console.log(JSON.stringify({preserved:report.preserved.length,targets:[...new Set(report.preserved.map(x=>x.targetId))],canonicalPromotion:false},null,2))})().catch(error=>{fs.writeFileSync(path.join(diagDir,'fatal-error.txt'),String(error));console.error(error);process.exitCode=1});
