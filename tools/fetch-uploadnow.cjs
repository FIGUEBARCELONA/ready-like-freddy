const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {chromium,request}=require('playwright');
const out=path.resolve('downloaded'),diag=path.resolve('diagnostics');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(diag,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function mime(b){if(b.length>=12&&b.subarray(0,4).toString('hex')==='52494646'&&b.subarray(8,12).toString()==='WEBP')return'image/webp';if(b.length>=8&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return'image/png';if(b.length>=3&&b.subarray(0,3).toString('hex')==='ffd8ff')return'image/jpeg';return'application/octet-stream'}
(async()=>{
 const report={schema:'rlf-v628b-osh-browser-context-v1',policy:'APPEND_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),requests:[],canonicalPromotion:false};
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
 const page=await context.newPage();
 const pageUrl='https://opensupplyhub.org/facilities/?contributors=1092';
 const nav=await page.goto(pageUrl,{waitUntil:'networkidle',timeout:180000});
 await page.waitForTimeout(8000);
 const endpoints=[
  '/api/facilities/?contributors=1092&sort_by=name_asc&number_of_public_contributors=true&pageSize=50',
  '/api/contributor-lists-sorted/?contributors=1092',
  '/api/contributors/'
 ];
 for(let i=0;i<endpoints.length;i++){
  const endpoint=endpoints[i];
  const result=await page.evaluate(async endpoint=>{const r=await fetch(endpoint,{credentials:'include',headers:{Accept:'application/json'}});return{status:r.status,contentType:r.headers.get('content-type')||'',text:await r.text()};},endpoint);
  const file=`OS_HUB_BROWSER_API_${String(i+1).padStart(2,'0')}.json`;
  fs.writeFileSync(path.join(diag,file),result.text);
  report.requests.push({endpoint,status:result.status,contentType:result.contentType,file,bytes:Buffer.byteLength(result.text),sha256:sha(Buffer.from(result.text))});
 }
 const dom=await page.evaluate(()=>({title:document.title,url:location.href,body:document.body?.innerText||'',html:document.documentElement.outerHTML}));
 fs.writeFileSync(path.join(diag,'OS_HUB_BROWSER_DOM.txt'),dom.body);
 fs.writeFileSync(path.join(diag,'OS_HUB_BROWSER_REPORT.json'),JSON.stringify({...report,navStatus:nav?.status()||null,title:dom.title,finalUrl:dom.url},null,2));
 await page.screenshot({path:path.join(diag,'OS_HUB_BROWSER_PAGE.png'),fullPage:true});
 await context.close();await browser.close();
 const req=await request.newContext({userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
 const creative='https://creative-boom-media.lon1.cdn.digitaloceanspaces.com/62e3c35c-eb58-4cb9-859c-e769633d42a7/512b0ddcd73e0f2eb4086f01a3af6c39823aca49.jpg';
 try{const r=await req.get(creative,{timeout:120000,failOnStatusCode:false,headers:{Referer:'https://www.creativeboom.com/inspiration/fred-perry-a-british-icon/'}});const b=await r.body(),m=mime(b);const rec={url:creative,status:r.status(),bytes:b.length,sha256:sha(b),magicMime:m};if(m==='image/jpeg'&&b.length>1500){const file='HIST-M3-1952_CREATIVE_BOOM.jpg';fs.writeFileSync(path.join(out,file),b);rec.file=file;rec.admission='SECONDARY_SAME_OBJECT_CANDIDATE'}else rec.admission='REJECT_BINARY_GATE';report.creativeBoom=rec;}catch(e){report.creativeBoom={url:creative,error:String(e),admission:'REQUEST_ERROR'};}
 await req.dispose();
 fs.writeFileSync(path.join(diag,'rlf-v628b-final-report.json'),JSON.stringify(report,null,2));
 const files=fs.readdirSync(out).sort().map(f=>{const b=fs.readFileSync(path.join(out,f));return{file:f,bytes:b.length,sha256:sha(b),magicMime:mime(b)}});
 fs.writeFileSync(path.join(diag,'RLF_V628B_SHA256SUMS.txt'),files.map(x=>`${x.sha256}  ${x.file}`).join('\n')+'\n');
 console.log(JSON.stringify({requests:report.requests,creativeBoom:report.creativeBoom,files},null,2));
})().catch(e=>{fs.writeFileSync(path.join(diag,'fatal-error.txt'),String(e));console.error(e);process.exitCode=1});