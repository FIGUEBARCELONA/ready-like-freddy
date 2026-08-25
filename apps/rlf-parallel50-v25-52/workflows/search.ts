import {createHash} from 'node:crypto';
import type {DiscoverInput,ProviderAttempt} from './types';
import {INTERNAL,MARKETPLACES,NEW_RETAIL} from './policy';
import {KNOWN_REJECTED_DOMAINS,KNOWN_SUPPLIER_ALIAS_DOMAINS,KNOWN_SUPPLIER_DOMAINS,STAGED_SUPPLIER_DOMAINS} from '@/lib/known-suppliers';

export type SearchItem={title:string;url:string;snippet:string;provider:string};
type Provider={name:string;url:(query:string,language:string)=>string};

export const COMMON_CRAWL_INDEX='CC-MAIN-2026-30' as const;
const DUCKDUCKGO_PROVIDER='duckduckgo-html';
const BING_PROVIDER='bing-rss';
const BING_RSS:Provider={name:BING_PROVIDER,url:(query,language)=>`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=50&setlang=${encodeURIComponent(language.split('-')[0])}`};
const DUCKDUCKGO_HTML:Provider={name:DUCKDUCKGO_PROVIDER,url:(query)=>`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`};

const PURCHASE_TERM:Record<string,string>={
  AT:'in den warenkorb',BE:'toevoegen aan winkelwagen',BG:'добави в количката',HR:'dodaj u košaricu',CY:'add to cart',CZ:'přidat do košíku',DK:'tilføj til kurv',EE:'lisa ostukorvi',FI:'lisää ostoskoriin',FR:'ajouter au panier',DE:'in den warenkorb',GR:'προσθήκη στο καλάθι',HU:'kosárba',IE:'add to cart',IT:'aggiungi al carrello',LV:'pievienot grozam',LT:'į krepšelį',LU:'ajouter au panier',MT:'add to cart',NL:'toevoegen aan winkelwagen',PL:'dodaj do koszyka',PT:'adicionar ao carrinho',RO:'adaugă în coș',SK:'pridať do košíka',SI:'dodaj v košarico',ES:'añadir al carrito',SE:'lägg i varukorg',
};

const decode=(value:string)=>String(value||'').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
export const strip=(value:string)=>decode(String(value||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const responseHash=(body:string)=>createHash('sha256').update(body).digest('hex');

export function canonical(raw:string) {
  try {
    const url=new URL(raw);url.hash='';
    for(const key of [...url.searchParams.keys()]) if(/^(utm_|gclid|fbclid|ref$|source$|_pos$|_psq$|_psid$|_ss$)/i.test(key)) url.searchParams.delete(key);
    url.hostname=url.hostname.toLowerCase();
    return url.toString().replace(/\/$/,'');
  } catch {return raw;}
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
  if(MARKETPLACES.some(rule=>domain.includes(rule)))return false;
  if(NEW_RETAIL.some(rule=>domain.includes(rule)))return false;
  if(KNOWN_REJECTED_DOMAINS.has(domain))return false;
  if(KNOWN_SUPPLIER_DOMAINS.has(domain)||KNOWN_SUPPLIER_ALIAS_DOMAINS.has(domain)||STAGED_SUPPLIER_DOMAINS.has(domain))return false;
  return true;
}
function pushUnique(output:SearchItem[],seen:Set<string>,item:SearchItem,limit:number){
  const url=canonical(item.url);const domain=domainOf(url);
  if(!url.startsWith('http')||!domain||seen.has(url)||!relevant(item.title,url,item.snippet)||!eligibleSearchDomain(domain))return;
  seen.add(url);output.push({...item,url});if(output.length>limit)output.length=limit;
}
function rssResults(xml:string,provider:string,limit:number){
  const output:SearchItem[]=[];const seen=new Set<string>();
  for(const match of xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi)){
    pushUnique(output,seen,{title:strip(match[1]).slice(0,260),url:strip(match[2]),snippet:strip(match[3]).slice(0,500),provider},limit);
    if(output.length>=limit)break;
  }
  return output;
}
export function unwrapDuckDuckGo(raw:string){
  const decoded=decode(raw);
  try{
    const candidate=decoded.startsWith('//')?`https:${decoded}`:decoded;
    const url=new URL(candidate,'https://html.duckduckgo.com');
    const redirected=url.searchParams.get('uddg');
    return canonical(redirected?decodeURIComponent(redirected):url.toString());
  }catch{return '';}
}
const attr=(attrs:string,name:string)=>{
  const quoted=attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`,'i'));if(quoted)return quoted[1];
  const bare=attrs.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`,'i'));return bare?.[1]??'';
};
export function duckDuckGoResults(html:string,limit:number){
  const output:SearchItem[]=[];const seen=new Set<string>();
  for(const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const attrs=match[1];const className=attr(attrs,'class');const href=attr(attrs,'href');const title=strip(match[2]).slice(0,260);
    const resultClass=/(?:^|\s)(?:result__a|result-link)(?:\s|$)/i.test(className);
    const redirected=/duckduckgo\.com\/l\/\?|[?&]uddg=/i.test(href);
    if(!href||(!resultClass&&!redirected))continue;
    pushUnique(output,seen,{title,url:unwrapDuckDuckGo(href),snippet:'',provider:DUCKDUCKGO_PROVIDER},limit);
    if(output.length>=limit)break;
  }
  return output;
}
export function commonCrawlExactUrl(raw:string,limit=5){
  const params=new URLSearchParams();params.set('url',canonical(raw));params.set('output','json');params.append('filter','=status:200');params.set('collapse','digest');params.set('limit',String(limit));params.set('fields','url,timestamp,status,mime,digest');
  return `https://index.commoncrawl.org/${COMMON_CRAWL_INDEX}-index?${params.toString()}`;
}
async function fetchProvider(provider:Provider,query:string,language:string,limit:number,parser:(body:string,limit:number)=>SearchItem[]){
  const started=Date.now();
  try{
    const response=await fetch(provider.url(query,language),{redirect:'follow',signal:AbortSignal.timeout(13000),headers:{accept:'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=.9,*/*;q=.8','accept-language':language,'user-agent':'Mozilla/5.0 (compatible; RLF-Research/1.0; +https://readylikefreddy.shop)'}});
    const body=await response.text();const results=response.ok?parser(body,limit):[];
    const attempt:ProviderAttempt={name:provider.name,status:response.status,bodyLength:body.length,linkCount:results.length,challenge:/captcha|unusual traffic|verify you are human|access denied|automated queries|anomaly-modal|bots use duckduckgo/i.test(body),durationMs:Date.now()-started,error:null,contentType:response.headers.get('content-type'),responseHash:responseHash(body)};
    return {attempt,results};
  }catch(error){
    const attempt:ProviderAttempt={name:provider.name,status:null,bodyLength:0,linkCount:0,challenge:false,durationMs:Date.now()-started,error:error instanceof Error?error.name:'SEARCH_ERROR',contentType:null,responseHash:null};
    return {attempt,results:[] as SearchItem[]};
  }
}
export function primaryCommerceQuery(input:DiscoverInput){
  const lane=input.lane;const purchase=PURCHASE_TERM[lane.countryCode]??'add to cart';
  const templates=[
    `site:.${lane.tld} inurl:product "Fred Perry" "${lane.localSecondhand}"`,
    `site:.${lane.tld} inurl:shop "Fred Perry" "${lane.localSecondhand}"`,
    `site:.${lane.tld} "Fred Perry" "${purchase}" vintage`,
    `site:.${lane.tld} "Fred Perry" "${purchase}" "${lane.localSecondhand}"`,
    `site:.${lane.tld} inurl:products "Fred Perry" pre-owned`,
    `site:.${lane.tld} inurl:collection "Fred Perry" secondhand`,
    `site:.${lane.tld} "Fred Perry" vintage webshop`,
    `site:.${lane.tld} "Fred Perry" used clothing "${purchase}"`,
  ];const index=(input.cycle+lane.index)%templates.length;return {index,query:templates[index]};
}
export function alternateCommerceQuery(input:DiscoverInput){
  const lane=input.lane;const purchase=PURCHASE_TERM[lane.countryCode]??'add to cart';
  const templates=[
    `"Fred Perry" "${lane.localSecondhand}" online shop ${lane.country}`,
    `"Fred Perry" vintage boutique "${purchase}" ${lane.country}`,
    `"Fred Perry" pre-owned menswear shop ${lane.country}`,
    `"Fred Perry" secondhand ecommerce ${lane.country}`,
    `"Fred Perry" archive clothing store ${lane.country}`,
    `"Fred Perry" retro clothing webshop ${lane.country}`,
    `"Fred Perry" used polo shop ${lane.country}`,
    `"Fred Perry" vintage track jacket shop ${lane.country}`,
  ];const index=(input.cycle*3+lane.index)%templates.length;return {index,query:templates[index]};
}
export function primaryCorpus(_input:DiscoverInput){return DUCKDUCKGO_PROVIDER;}
export function shouldRunFallbackSearch(primaryCount:number){return primaryCount===0;}
export async function searchPrimary(query:string,input:DiscoverInput){
  const limit=Math.max(input.maxCandidates*6,36);const response=await fetchProvider(DUCKDUCKGO_HTML,query,input.lane.language,limit,duckDuckGoResults);return {attempts:[response.attempt],results:response.results.slice(0,limit)};
}
export async function searchFallback(query:string,input:DiscoverInput){
  const limit=Math.max(input.maxCandidates*6,36);const response=await fetchProvider(BING_RSS,query,input.lane.language,limit,(body,max)=>rssResults(body,BING_PROVIDER,max));return {attempts:[response.attempt],results:response.results.slice(0,limit)};
}
