const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {chromium}=require('playwright');
const diag=path.resolve('diagnostics');fs.mkdirSync(diag,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1200},userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36'});
 const page=await context.newPage();
 const captures=[];
 page.on('response',async response=>{
  const url=response.url();
  if(url.includes('/api/facilities/')&&url.includes('contributors=1092')){
   try{const body=await response.body();const file=`OS_HUB_FRED_PERRY_FACILITIES_${captures.length+1}.json`;fs.writeFileSync(path.join(diag,file),body);captures.push({url,status:response.status(),contentType:response.headers()['content-type']||'',file,bytes:body.length,sha256:sha(body)});}catch(e){captures.push({url,status:response.status(),error:String(e)});}
  }
 });
 const nav=await page.goto('https://opensupplyhub.org/facilities/?contributors=1092',{waitUntil:'networkidle',timeout:180000});
 await page.waitForTimeout(12000);
 const text=await page.locator('body').innerText();fs.writeFileSync(path.join(diag,'OS_HUB_FRED_PERRY_DOM.txt'),text);
 await page.screenshot({path:path.join(diag,'OS_HUB_FRED_PERRY_PAGE.png'),fullPage:true});
 const report={schema:'rlf-v628c-osh-inflight-response-v1',policy:'APPEND_ONLY_FAIL_CLOSED',generatedAt:new Date().toISOString(),navStatus:nav?.status()||null,finalUrl:page.url(),captures,canonicalPromotion:false};
 fs.writeFileSync(path.join(diag,'rlf-v628c-report.json'),JSON.stringify(report,null,2));
 await context.close();await browser.close();console.log(JSON.stringify(report,null,2));
})().catch(e=>{fs.writeFileSync(path.join(diag,'fatal-error.txt'),String(e));console.error(e);process.exitCode=1});