import {createHash} from 'node:crypto';
import type {DiscoverInput,ProviderAttempt} from './types';
import {INTERNAL,MARKETPLACES,NEW_RETAIL} from './policy';
import {KNOWN_REJECTED_DOMAINS,KNOWN_SUPPLIER_ALIAS_DOMAINS,KNOWN_SUPPLIER_DOMAINS,STAGED_SUPPLIER_DOMAINS} from '@/lib/known-suppliers';

export type SearchItem={title:string;url:string;snippet:string;provider:string};
type OSMTags=Record<string,string|undefined>;
type OSMElement={type?:string;id?:number;tags?:OSMTags};
type BBox=[number,number,number,number];

export const COMMON_CRAWL_INDEX='CC-MAIN-2026-30' as const;
export const OVERPASS_ENDPOINTS=[
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
] as const;
const OVERPASS_PROVIDER='overpass-json';
const NON_OPERATOR_DOMAINS=['facebook.com','instagram.com','linkedin.com','linktr.ee','tiktok.com','x.com','twitter.com','youtube.com','google.com','goo.gl','maps.app.goo.gl','openstreetmap.org'];
const CLOTHING_TERMS=/vintage|second.?hand|pre.?loved|thrift|retro|clothes|clothing|fashion|frip|kilo|moda|roupa|odzie|kleding|kleidung|abbigliamento|vaatte|ruha|oble|drabu|apģēr|rõiv|genbrug/i;
const COUNTRY_BBOX:Record<string,BBox>={
  AT:[46.37,9.53,49.02,17.16],BE:[49.50,2.54,51.51,6.41],BG:[41.24,22.35,44.22,28.61],HR:[42.39,13.49,46.56,19.45],CY:[34.56,32.27,35.71,34.60],CZ:[48.55,12.09,51.06,18.87],DK:[54.45,8.07,57.75,15.20],EE:[57.51,21.64,59.68,28.21],FI:[59.45,19.08,70.10,31.59],FR:[41.33,-5.15,51.12,9.56],DE:[47.27,5.87,55.10,15.04],GR:[34.80,19.37,41.75,28.25],HU:[45.74,16.11,48.59,22.90],IE:[51.39,-10.70,55.43,-5.99],IT:[35.49,6.63,47.10,18.52],LV:[55.67,20.97,58.09,28.24],LT:[53.90,20.94,56.45,26.84],LU:[49.44,5.73,50.18,6.53],MT:[35.79,14.18,36.09,14.58],NL:[50.75,3.36,53.56,7.23],PL:[49.00,14.12,54.84,24.15],PT:[36.84,-9.56,42.15,-6.19],RO:[43.62,20.26,48.27,29.72],SK:[47.73,16.83,49.61,22.57],SI:[45.42,13.38,46.88,16.61],ES:[35.17,-9.40,43.80,4.33],SE:[55.34,10.96,69.06,24.17],
};

const decode=(value:string)=>String(value||'').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
export const strip=(value:string)=>decode(String(value||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const responseHash=(body:string)=>createHash('sha256').update(body).digest('hex');

export function canonical(raw:string){
  try{
    const url=new URL(raw);url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^(utm_|gclid|fbclid|ref$|source$|_pos$|_psq$|_psid$|_ss$)/i.test(key))url.searchParams.delete(key);
    url.hostname=url.hostname.toLowerCase();
    return url.toString().replace(/\/$/,'');
  }catch{return raw;}
}
export function domainOf(raw:string){try{return new URL(raw).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
export function relevant(title:string,url:string,description=''){
  const text=`${strip(title)} ${url} ${strip(description)}`.toLowerCase().replace(/[-_/%+]+/g,' ');
  if(/federal reserve|economic data|st\. louis fed|\bfred\b.*econom/i.test(text))return false;
  return /fred\s+perry/.test(text)||/fredperry/.test(text);
}
export function eligibleSearchDomain(domain:string){
  if(!domain)return false;
  if(INTERNAL.some(item=>domain===item||domain.endsWith(`.${item}`)))return false;
  if(NON_OPERATOR_DOMAINS.some(item=>domain===item||domain.endsWith(`.${item}`)))return false;
  if(MARKETPLACES.some(rule=>domain.includes(rule)))return false;
  if(NEW_RETAIL.some(rule=>domain.includes(rule)))return false;
  if(KNOWN_REJECTED_DOMAINS.has(domain))return false;
  if(KNOWN_SUPPLIER_DOMAINS.has(domain)||KNOWN_SUPPLIER_ALIAS_DOMAINS.has(domain)||STAGED_SUPPLIER_DOMAINS.has(domain))return false;
  return true;
}

function normalizeWebsite(raw:string){
  const value=decode(String(raw||'').trim());
  if(!value||/^(mailto:|tel:|javascript:|#)/i.test(value))return '';
  const withScheme=/^https?:\/\//i.test(value)?value:/^www\./i.test(value)?`https://${value}`:'';
  if(!withScheme)return '';
  const url=canonical(withScheme);const domain=domainOf(url);
  return eligibleSearchDomain(domain)?url:'';
}
export function websiteValues(tags:OSMTags){
  const values=['website','contact:website','url','contact:url'].flatMap(key=>String(tags[key]??'').split(/\s*;\s*/));
  return [...new Set(values.map(normalizeWebsite).filter(Boolean))];
}
function seedScore(tags:OSMTags){
  const shop=String(tags.shop??'');const second=String(tags.second_hand??'');const name=`${tags.name??''} ${tags.operator??''}`;
  let score=0;
  if(shop==='clothes'&&/^(yes|only)$/.test(second))score+=5;
  if(shop==='second_hand')score+=3;
  if(shop==='charity')score+=1;
  if(CLOTHING_TERMS.test(name))score+=4;
  return score;
}
export function overpassResults(body:string,limit:number){
  let json:{elements?:OSMElement[]};
  try{json=JSON.parse(body);}catch{return [] as SearchItem[];}
  const rows:Array<{score:number;item:SearchItem}>=[];const seen=new Set<string>();
  for(const element of json.elements??[]){
    const tags=element.tags??{};const name=strip(String(tags.name??tags.operator??tags.brand??'Second-hand operator')).slice(0,260);
    const snippet=strip(`OSM discovery seed; shop=${tags.shop??''}; second_hand=${tags.second_hand??''}; operator=${tags.operator??''}; brand=${tags.brand??''}`).slice(0,500);
    for(const url of websiteValues(tags)){
      const domain=domainOf(url);if(!domain||seen.has(domain))continue;seen.add(domain);
      rows.push({score:seedScore(tags),item:{title:name,url,snippet,provider:OVERPASS_PROVIDER}});
    }
  }
  return rows.sort((a,b)=>b.score-a.score||a.item.title.localeCompare(b.item.title)||a.item.url.localeCompare(b.item.url)).slice(0,limit).map(row=>row.item);
}

export function overpassVariant(input:DiscoverInput){return (input.cycle+input.lane.index)%3;}
export function tileIndex(input:DiscoverInput){return (input.cycle*7+input.lane.index)%4;}
export function countryTile(input:DiscoverInput):BBox{
  const source=COUNTRY_BBOX[input.lane.countryCode];if(!source)throw new Error(`BBOX_MISSING_${input.lane.countryCode}`);
  const[s,w,n,e]=source;const midLat=(s+n)/2;const midLon=(w+e)/2;
  const tiles:BBox[]=[[s,w,midLat,midLon],[s,midLon,midLat,e],[midLat,w,n,midLon],[midLat,midLon,n,e]];
  return tiles[tileIndex(input)];
}
const bboxText=(bbox:BBox)=>bbox.map(value=>Number(value.toFixed(5))).join(',');
export function overpassQuery(input:DiscoverInput,maxRows=36,bboxOverride?:BBox){
  const variant=overpassVariant(input);const rows=Math.max(8,Math.min(maxRows,60));const bbox=bboxText(bboxOverride??countryTile(input));
  const clauses=variant===0?[
    `nwr["shop"="second_hand"]["website"](${bbox});`,`nwr["shop"="second_hand"]["contact:website"](${bbox});`,
    `nwr["shop"="clothes"]["second_hand"~"^(yes|only)$"]["website"](${bbox});`,`nwr["shop"="clothes"]["second_hand"~"^(yes|only)$"]["contact:website"](${bbox});`,
  ]:variant===1?[
    `nwr["shop"="charity"]["website"](${bbox});`,`nwr["shop"="charity"]["contact:website"](${bbox});`,
    `nwr["shop"="charity"]["url"](${bbox});`,`nwr["shop"="charity"]["contact:url"](${bbox});`,
  ]:[
    `nwr["shop"~"^(clothes|second_hand|charity|variety_store)$"]["second_hand"~"^(yes|only)$"]["website"](${bbox});`,`nwr["shop"~"^(clothes|second_hand|charity|variety_store)$"]["second_hand"~"^(yes|only)$"]["contact:website"](${bbox});`,
    `nwr["shop"="second_hand"]["url"](${bbox});`,`nwr["shop"="second_hand"]["contact:url"](${bbox});`,
  ];
  return `[out:json][timeout:10];(${clauses.join('')});out tags qt ${rows};`;
}
export function primaryCorpus(_input:DiscoverInput){return OVERPASS_PROVIDER;}
export function primaryEndpoint(input:DiscoverInput){return OVERPASS_ENDPOINTS[input.lane.index%OVERPASS_ENDPOINTS.length];}
export function secondaryEndpoint(input:DiscoverInput){return OVERPASS_ENDPOINTS[(input.lane.index+1)%OVERPASS_ENDPOINTS.length];}
export function shouldRetryOverpass(attempt:ProviderAttempt){return attempt.status!==200||attempt.challenge||Boolean(attempt.error);}

async function fetchOverpass(endpoint:string,input:DiscoverInput,limit:number,bboxOverride?:BBox){
  const started=Date.now();const query=overpassQuery(input,Math.max(limit*3,24),bboxOverride);
  try{
    const bodyData=new URLSearchParams({data:query}).toString();
    const response=await fetch(endpoint,{method:'POST',body:bodyData,redirect:'follow',signal:AbortSignal.timeout(15000),headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded;charset=UTF-8','accept-encoding':'gzip, deflate','user-agent':'RLF-Research/1.0 (+https://readylikefreddy.shop)'}});
    const body=await response.text();let remark:string|null=null;
    try{const json=JSON.parse(body);remark=typeof json?.remark==='string'?strip(json.remark).slice(0,400):null;}catch{}
    const results=response.ok&&!remark?overpassResults(body,limit):[];
    const challenge=response.status===429||response.status===504||Boolean(remark);
    const name=`${OVERPASS_PROVIDER}:${new URL(endpoint).hostname}`;
    const attempt:ProviderAttempt={name,status:response.status,bodyLength:body.length,linkCount:results.length,challenge,durationMs:Date.now()-started,error:null,contentType:response.headers.get('content-type'),responseHash:responseHash(body)};
    return {attempt,results,query,remark};
  }catch(error){
    const name=`${OVERPASS_PROVIDER}:${new URL(endpoint).hostname}`;
    const attempt:ProviderAttempt={name,status:null,bodyLength:0,linkCount:0,challenge:false,durationMs:Date.now()-started,error:error instanceof Error?error.name:'OVERPASS_ERROR',contentType:null,responseHash:null};
    return {attempt,results:[] as SearchItem[],query,remark:null};
  }
}
export async function searchPrimary(input:DiscoverInput){
  const limit=Math.max(input.maxCandidates*5,24);const response=await fetchOverpass(primaryEndpoint(input),input,limit);return {attempts:[response.attempt],results:response.results.slice(0,limit),query:response.query};
}
export async function searchSecondary(input:DiscoverInput){
  const limit=Math.max(input.maxCandidates*5,24);const response=await fetchOverpass(secondaryEndpoint(input),input,limit);return {attempts:[response.attempt],results:response.results.slice(0,limit),query:response.query};
}
export function commonCrawlExactUrl(raw:string,limit=5){
  const params=new URLSearchParams();params.set('url',canonical(raw));params.set('output','json');params.append('filter','=status:200');params.set('collapse','digest');params.set('limit',String(limit));params.set('fields','url,timestamp,status,mime,digest');
  return `https://index.commoncrawl.org/${COMMON_CRAWL_INDEX}-index?${params.toString()}`;
}
export async function providerSmoke(){
  const input:DiscoverInput={cycle:18,maxCandidates:6,lane:{slot:'SMOKE',countryCode:'DE',country:'Germany',language:'de-DE,de;q=.9,en;q=.7',tld:'de',localSecondhand:'second hand kleidung',index:0}};
  const berlin:BBox=[52.30,13.00,52.70,13.80];
  const first=await fetchOverpass(OVERPASS_ENDPOINTS[0],input,12,berlin);
  const second=shouldRetryOverpass(first.attempt)?await fetchOverpass(OVERPASS_ENDPOINTS[1],input,12,berlin):null;
  const responses=[first,...(second?[second]:[])];
  const attempts=responses.map(row=>({provider:row.attempt.name,status:row.attempt.status,bodyLength:row.attempt.bodyLength,contentType:row.attempt.contentType,responseHash:row.attempt.responseHash,challenge:row.attempt.challenge,error:row.attempt.error,remark:row.remark,durationMs:row.attempt.durationMs,parsedLinks:row.results.length}));
  const ready=attempts.some(row=>row.status===200&&!row.challenge&&!row.error&&row.parsedLinks>0);
  return {ready,queryFingerprint:createHash('sha256').update(first.query).digest('hex'),variant:overpassVariant(input),tile:'BERLIN_SMOKE_BBOX',attempts};
}
