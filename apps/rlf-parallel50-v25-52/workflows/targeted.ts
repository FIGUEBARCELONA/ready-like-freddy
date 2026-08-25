import {createHash} from 'node:crypto';
import type {Cycle20Target} from '@/lib/cycle20-targets';
import type {DiscoverInput,EvidenceRecord,LaneCycleResult,ProviderAttempt} from './types';
import type {SearchItem} from './search';
import {canonical,domainOf,strip} from './search';
import {sameRegistrableDomain} from './provenance';
import {fetchBundle} from './evidence';
import {assess} from './assessment';

const BRAND=/fred\s*[-_]?\s*perry|fredperry/i;
const CHALLENGE=/captcha|verify you are human|access denied|automated queries|rate limit|too many requests|cloudflare ray id/i;
const MAX_BODY_CHARS=360000;

type TargetedInput=DiscoverInput&{target:Cycle20Target};
type Probe={provider:string;url:string;status:number|null;contentType:string|null;body:string;length:number;sha256:string|null;durationMs:number;challenge:boolean;error:string|null;brandUrls:string[]};

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const rootOf=(raw:string)=>{try{return new URL('/',raw).toString();}catch{return raw;}};
const resolveInternal=(raw:string,base:string)=>{
  try{
    if(!raw||/^(?:mailto:|tel:|javascript:|data:|#)/i.test(raw))return '';
    const url=canonical(new URL(raw.replaceAll('&amp;','&'),base).toString());
    if(!url.startsWith('http')||!sameRegistrableDomain(url,base))return '';
    return url;
  }catch{return '';}
};
const searchOnly=(raw:string)=>{
  try{
    const url=new URL(raw);const value=decodeURIComponent(`${url.pathname}${url.search}`).toLowerCase();
    return /(?:\/search\b|[?&](?:q|s|search)=)/.test(value)&&!/(?:\/products?\/|\/items?\/|\/collections?\/)/.test(value);
  }catch{return false;}
};

function jsonBrandUrls(body:string,base:string){
  const output:string[]=[];
  try{
    const parsed=JSON.parse(body);
    const walk=(value:unknown,depth:number)=>{
      if(depth>8||value==null)return;
      if(Array.isArray(value)){for(const item of value.slice(0,200))walk(item,depth+1);return;}
      if(typeof value!=='object')return;
      const row=value as Record<string,unknown>;
      const serialized=JSON.stringify(row).slice(0,24000);
      if(BRAND.test(serialized)){
        for(const key of ['url','permalink','link','href','handle']){
          const candidate=row[key];if(typeof candidate!=='string')continue;
          const raw=key==='handle'&&!candidate.startsWith('/')?`/products/${candidate}`:candidate;
          const resolved=resolveInternal(raw,base);if(resolved&&!searchOnly(resolved))output.push(resolved);
        }
      }
      for(const child of Object.values(row).slice(0,200))walk(child,depth+1);
    };
    walk(parsed,0);
  }catch{}
  return output;
}

export function extractBrandUrls(body:string,base:string,contentType:string|null){
  const output:string[]=[];
  const add=(raw:string)=>{const resolved=resolveInternal(raw,base);if(resolved&&!searchOnly(resolved))output.push(resolved);};
  for(const match of body.matchAll(/<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)){
    const context=strip(`${match[1]} ${match[3]} ${match[4]}`);
    if(BRAND.test(context)||BRAND.test(match[2]))add(match[2]);
  }
  for(const match of body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi))if(BRAND.test(match[1]))add(match[1]);
  for(const match of body.matchAll(/https?:\\?\/\\?\/[^\s"'<>]{0,500}(?:fred(?:%20|[-_+\s]|\\u002d)*perry|fredperry)[^\s"'<>]{0,500}/gi))add(match[0].replaceAll('\\/','/').replaceAll('\\u0026','&'));
  if(/json/i.test(contentType??''))output.push(...jsonBrandUrls(body,base));
  return [...new Set(output)].sort((a,b)=>rankBrandUrl(b)-rankBrandUrl(a)||a.localeCompare(b));
}

function rankBrandUrl(url:string){
  let score=0;
  try{
    const parsed=new URL(url);const path=decodeURIComponent(parsed.pathname+parsed.search).toLowerCase();
    if(/\/products?\//.test(path))score+=40;
    if(/\/items?\//.test(path))score+=30;
    if(/fred[-_+\s%]*perry|fredperry/.test(path))score+=20;
    if(/search|wp-json/.test(path))score+=5;
    if(/sitemap|robots/.test(path))score-=10;
  }catch{}
  return score;
}

async function fetchProbe(url:string,provider:string,language:string):Promise<Probe>{
  const started=Date.now();
  try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(13000),headers:{accept:'text/html,application/xhtml+xml,application/json,application/xml,text/xml;q=.9,text/plain;q=.8,*/*;q=.5','accept-language':language,'user-agent':'Mozilla/5.0 (compatible; RLF-Research/1.0; +https://readylikefreddy.shop)'}});
    const raw=await response.text();const body=raw.slice(0,MAX_BODY_CHARS);const finalUrl=canonical(response.url||url);const contentType=response.headers.get('content-type');
    const brandUrls=response.ok?extractBrandUrls(body,finalUrl,contentType):[];
    return {provider,url:finalUrl,status:response.status,contentType,body,length:Buffer.byteLength(raw),sha256:hash(raw),durationMs:Date.now()-started,challenge:CHALLENGE.test(body),error:null,brandUrls};
  }catch(error){
    return {provider,url:canonical(url),status:null,contentType:null,body:'',length:0,sha256:null,durationMs:Date.now()-started,challenge:false,error:error instanceof Error?error.name:'TARGET_PROBE_ERROR',brandUrls:[]};
  }
}

export function adapterUrls(target:Cycle20Target,homeBody:string){
  const root=rootOf(target.url);const urls:Array<{provider:string;url:string}>=[];
  const add=(provider:string,path:string)=>{try{urls.push({provider,url:new URL(path,root).toString()});}catch{}};
  add('site-search','/search?q=Fred%20Perry');
  const shopify=/cdn\.shopify\.com|shopify-section|Shopify\.theme|myshopify/i.test(homeBody);
  const wordpress=/wp-content|wp-includes|woocommerce/i.test(homeBody);
  if(shopify){
    add('shopify-suggest','/search/suggest.json?q=Fred%20Perry&resources[type]=product&resources[limit]=20');
    add('shopify-products','/products.json?limit=250');
  }else if(wordpress){
    add('woocommerce-store-api','/wp-json/wc/store/v1/products?search=Fred%20Perry&per_page=20');
    add('wordpress-search-api','/wp-json/wp/v2/search?search=Fred%20Perry&per_page=20');
  }else{
    add('site-query','/?s=Fred+Perry&post_type=product');
    add('sitemap','/sitemap.xml');
  }
  add('robots','/robots.txt');
  return urls.slice(0,4);
}

function probeAttempt(probe:Probe):ProviderAttempt{
  return {name:`targeted-v23:${probe.provider}`,status:probe.status,bodyLength:probe.length,linkCount:probe.brandUrls.length,challenge:probe.challenge,durationMs:probe.durationMs,error:probe.error,contentType:probe.contentType,responseHash:probe.sha256};
}
function probeEvidence(probe:Probe):EvidenceRecord{
  return {role:/sitemap|robots/.test(probe.provider)?'SITEMAP':'BRAND_PROBE',url:probe.url,status:probe.status,contentType:probe.contentType,sha256:probe.sha256,length:probe.length};
}

export async function targetedSmoke(target:Cycle20Target,language='en-GB,en;q=.9'){
  const home=await fetchProbe(target.url,'home',language);const adapters=adapterUrls(target,home.body);
  const probes=[home,...await Promise.all(adapters.map(adapter=>fetchProbe(adapter.url,adapter.provider,language)))];
  const brandUrls=[...new Set(probes.flatMap(probe=>probe.brandUrls))].filter(url=>sameRegistrableDomain(url,target.url));
  const homeBrand=home.status===200&&BRAND.test(strip(home.body));
  return {target:target.domain,transportReady:probes.some(probe=>probe.status===200&&!probe.challenge&&!probe.error),directBrandEvidence:brandUrls.length>0||homeBrand,brandUrlCount:brandUrls.length,probes:probes.map(probe=>({provider:probe.provider,status:probe.status,length:probe.length,contentType:probe.contentType,sha256:probe.sha256,challenge:probe.challenge,error:probe.error,brandUrls:probe.brandUrls.length,durationMs:probe.durationMs}))};
}

export async function verifyTargetedLane(input:TargetedInput):Promise<LaneCycleResult>{
  const searchedAt=new Date().toISOString();const home=await fetchProbe(input.target.url,'home',input.lane.language);
  const adapters=adapterUrls(input.target,home.body);
  const probes=[home,...await Promise.all(adapters.map(adapter=>fetchProbe(adapter.url,adapter.provider,input.lane.language)))];
  const brandUrls=[...new Set(probes.flatMap(probe=>probe.brandUrls))].filter(url=>sameRegistrableDomain(url,input.target.url)).sort((a,b)=>rankBrandUrl(b)-rankBrandUrl(a)||a.localeCompare(b));
  const homeBrand=home.status===200&&BRAND.test(strip(home.body));
  const evidenceUrl=brandUrls[0]??input.target.url;
  const directBrandEvidence=brandUrls.length>0||homeBrand;
  const result:SearchItem={
    title:directBrandEvidence?`${input.target.title} Fred Perry`:input.target.title,
    url:evidenceUrl,
    snippet:directBrandEvidence?'Direct same-domain Fred Perry evidence found by bounded site-native verification.':'Bounded site-native verification completed without direct Fred Perry evidence.',
    provider:'targeted-v23',
  };
  const bundle=await fetchBundle(result,input);
  const query=`TARGETED_V23:${input.target.domain}:${probes.map(probe=>probe.provider).join(',')}`;
  const candidate=assess(input,query,20,-1,result,bundle);
  const existing=new Set(candidate.evidence.map(record=>`${record.url}|${record.sha256??''}`));
  for(const probe of probes){const record=probeEvidence(probe);const key=`${record.url}|${record.sha256??''}`;if(existing.has(key))continue;existing.add(key);candidate.evidence.push(record);}
  const errors=probes.filter(probe=>probe.error||probe.challenge||(probe.status!=null&&probe.status>=400)).map(probe=>`${probe.provider}:${probe.error??(probe.challenge?'CHALLENGE':`HTTP_${probe.status}`)}`);
  if(!directBrandEvidence)errors.push('NO_DIRECT_FRED_PERRY_EVIDENCE');
  if(domainOf(candidate.url)!==input.target.domain&&domainOf(input.target.url)!==input.target.domain)errors.push('TARGET_DOMAIN_MISMATCH');
  const attempts=probes.map(probeAttempt);
  return {slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate:20,identityQueryTemplate:-1,searchedAt,searchStatus:attempts.find(attempt=>attempt.status===200)?.status??attempts[0]?.status??null,candidates:[candidate],errors,searchAttempts:attempts};
}
