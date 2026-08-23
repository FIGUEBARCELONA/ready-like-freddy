import {createHash,timingSafeEqual} from 'node:crypto';

export const runtime='nodejs';
export const maxDuration=60;
export const preferredRegion='fra1';

const TOKEN_HASH='8196948725e376ee7faa97a1f146c63de38b072e2219cfb635c465ac8db1492d';
const ALLOWED=new Set(['www.rostreetwear.com','www.olesstore.com']);
const digest=(value:string)=>createHash('sha256').update(value).digest();
const secure=(value:string)=>{try{return timingSafeEqual(digest(value),Buffer.from(TOKEN_HASH,'hex'));}catch{return false;}};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

async function getBytes(url:string){
  const started=Date.now();
  const response=await fetch(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (compatible; RLF-Audit/25.52)','accept':'text/html,application/json,application/xml;q=0.9,*/*;q=0.8'}});
  const bytes=new Uint8Array(await response.arrayBuffer());
  return {url:response.url,status:response.status,contentType:response.headers.get('content-type'),bytes,sha256:sha(bytes),length:bytes.byteLength,durationMs:Date.now()-started};
}

function asText(bytes:Uint8Array){return new TextDecoder().decode(bytes);}

async function resolveHost(host:string){
  if(!ALLOWED.has(host)) throw new Error('HOST_NOT_ALLOWED');
  const base=`https://${host}`;
  const suggestUrl=`${base}/search/suggest.json?q=${encodeURIComponent('Fred Perry')}&resources[type]=product&resources[limit]=20`;
  const suggest=await getBytes(suggestUrl);
  const products:any[]=[];
  try{
    const json=JSON.parse(asText(suggest.bytes));
    const rows=json?.resources?.results?.products??[];
    for(const row of rows){
      const path=row.url??(row.handle?`/products/${row.handle}`:null);
      if(!path) continue;
      const productUrl=new URL(path,base).toString();
      const page=await getBytes(productUrl);
      let machine:null|Awaited<ReturnType<typeof getBytes>>=null;
      try{machine=await getBytes(productUrl.replace(/\/$/,'')+'.js');}catch{}
      products.push({title:row.title??null,handle:row.handle??null,productUrl,available:row.available??null,price:row.price??null,page:{url:page.url,status:page.status,contentType:page.contentType,sha256:page.sha256,length:page.length},machine:machine?{url:machine.url,status:machine.status,contentType:machine.contentType,sha256:machine.sha256,length:machine.length}:null});
    }
  }catch{}

  const sitemapRoot=await getBytes(`${base}/sitemap.xml`);
  const rootText=asText(sitemapRoot.bytes);
  const sitemapUrls=[...rootText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&')).filter(u=>u.includes('sitemap_products'));
  const sitemapMatches:any[]=[];
  for(const sitemapUrl of sitemapUrls.slice(0,8)){
    const map=await getBytes(sitemapUrl);
    const text=asText(map.bytes);
    const locs=[...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
    for(const loc of locs){
      if(/fred[-+%20_]?perry/i.test(loc)) sitemapMatches.push({url:loc,sitemapUrl:map.url,sitemapSha256:map.sha256});
    }
  }
  return {host,suggest:{url:suggest.url,status:suggest.status,contentType:suggest.contentType,sha256:suggest.sha256,length:suggest.length},sitemapRoot:{url:sitemapRoot.url,status:sitemapRoot.status,sha256:sitemapRoot.sha256,length:sitemapRoot.length},products,sitemapMatches};
}

export async function GET(request:Request){
  const url=new URL(request.url);
  if(!secure(url.searchParams.get('token')??'')) return Response.json({ok:false,code:'NOT_FOUND'},{status:404});
  const hosts=(url.searchParams.get('hosts')??'www.rostreetwear.com,www.olesstore.com').split(',').map(x=>x.trim()).filter(Boolean);
  const results=[];
  for(const host of hosts){try{results.push(await resolveHost(host));}catch(error){results.push({host,error:error instanceof Error?error.message:'ERROR'});}}
  return Response.json({ok:true,checkedAt:new Date().toISOString(),results},{headers:{'cache-control':'no-store'}});
}
