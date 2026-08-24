import type {DiscoverInput,ProviderAttempt} from './types';
import {INTERNAL,MARKETPLACES,NEW_RETAIL} from './policy';
import {KNOWN_REJECTED_DOMAINS,KNOWN_SUPPLIER_ALIAS_DOMAINS,KNOWN_SUPPLIER_DOMAINS,STAGED_SUPPLIER_DOMAINS} from '@/lib/known-suppliers';

export type SearchItem={title:string;url:string;snippet:string;provider:string};
type Provider={name:string;url:(query:string,language:string)=>string;rss?:boolean};

const BING_RSS:Provider={name:'bing-rss',rss:true,url:(query,language)=>`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=50&setlang=${encodeURIComponent(language.split('-')[0])}`};

const decode=(value:string)=>String(value||'').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
export const strip=(value:string)=>decode(String(value||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());

export function canonical(raw:string) {
  try {
    const url=new URL(raw);
    url.hash='';
    for(const key of [...url.searchParams.keys()]) if(/^(utm_|gclid|fbclid|ref$|source$|_pos$|_psq$|_psid$|_ss$)/i.test(key)) url.searchParams.delete(key);
    url.hostname=url.hostname.toLowerCase();
    return url.toString().replace(/\/$/,'');
  } catch {return raw;}
}

export function domainOf(raw:string) {
  try {return new URL(raw).hostname.toLowerCase().replace(/^www\./,'');}
  catch {return '';}
}

function clean(raw:string,provider:string) {
  const value=decode(raw);
  try {
    if(/^(javascript:|mailto:|tel:|#)/i.test(value)) return '';
    const url=new URL(value,'https://www.bing.com');
    return canonical(url.toString());
  } catch {return '';}
}

export function relevant(title:string,url:string,description='') {
  const text=`${strip(title)} ${url} ${strip(description)}`.toLowerCase().replace(/[-_/%]+/g,' ');
  if(/federal reserve|economic data|st\. louis fed|\bfred\b.*econom/i.test(text)) return false;
  return /fred\s+perry/.test(text)||/fredperry/.test(text);
}

export function eligibleSearchDomain(domain:string) {
  if(!domain) return false;
  if(INTERNAL.some(item=>domain===item||domain.endsWith(`.${item}`))) return false;
  if(MARKETPLACES.some(rule=>domain.includes(rule))) return false;
  if(NEW_RETAIL.some(rule=>domain.includes(rule))) return false;
  if(KNOWN_REJECTED_DOMAINS.has(domain)) return false;
  if(KNOWN_SUPPLIER_DOMAINS.has(domain)||KNOWN_SUPPLIER_ALIAS_DOMAINS.has(domain)||STAGED_SUPPLIER_DOMAINS.has(domain)) return false;
  return true;
}

function rssResults(xml:string,provider:string,limit:number) {
  const output:SearchItem[]=[];
  const seen=new Set<string>();
  for(const match of xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi)) {
    const title=strip(match[1]).slice(0,260);
    const url=canonical(strip(match[2]));
    const snippet=strip(match[3]).slice(0,500);
    const domain=domainOf(url);
    if(!url.startsWith('http')||!domain||seen.has(url)||!relevant(title,url,snippet)||!eligibleSearchDomain(domain)) continue;
    seen.add(url);output.push({title,url,snippet,provider});
    if(output.length>=limit) break;
  }
  return output;
}

async function searchProvider(provider:Provider,query:string,language:string,limit:number) {
  const started=Date.now();
  try {
    const response=await fetch(provider.url(query,language),{redirect:'follow',signal:AbortSignal.timeout(13000),headers:{accept:'application/rss+xml,application/xml,text/xml;q=.9,*/*;q=.8','accept-language':language,'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36'}});
    const body=await response.text();
    const results=response.ok?rssResults(body,provider.name,limit):[];
    const attempt:ProviderAttempt={name:provider.name,status:response.status,bodyLength:body.length,linkCount:results.length,challenge:/captcha|unusual traffic|verify you are human|access denied|error getting results|automated queries/i.test(body),durationMs:Date.now()-started,error:null};
    return {attempt,results};
  } catch(error) {
    const attempt:ProviderAttempt={name:provider.name,status:null,bodyLength:0,linkCount:0,challenge:false,durationMs:Date.now()-started,error:error instanceof Error?error.name:'SEARCH_ERROR'};
    return {attempt,results:[] as SearchItem[]};
  }
}

export function shouldRunContextualRecovery(primaryCount:number,identityCount:number) {
  return primaryCount===0&&identityCount===0;
}

export function contextualRecoveryQuery(input:DiscoverInput) {
  const lane=input.lane;
  const templates=[
    `site:.${lane.tld} inurl:product "Fred Perry" ${lane.localSecondhand}`,
    `site:.${lane.tld} inurl:shop "Fred Perry" vintage`,
    `site:.${lane.tld} "Fred Perry" ${lane.localSecondhand} webshop`,
    `"Fred Perry" ${lane.localSecondhand} online shop ${lane.country}`,
    `site:.${lane.tld} "Fred Perry" pre-owned clothing store`,
    `site:.${lane.tld} "Fred Perry" vintage ecommerce`,
  ];
  return templates[(input.cycle+lane.index)%templates.length];
}

export async function searchAll(query:string,input:DiscoverInput) {
  const limit=Math.max(input.maxCandidates*6,36);
  const response=await searchProvider(BING_RSS,query,input.lane.language,limit);
  return {attempts:[response.attempt],results:response.results.slice(0,limit)};
}
