import type {DiscoverInput,ProviderAttempt} from './types';
import {INTERNAL,MARKETPLACES,NEW_RETAIL} from './policy';
import {KNOWN_REJECTED_DOMAINS,KNOWN_SUPPLIER_ALIAS_DOMAINS,KNOWN_SUPPLIER_DOMAINS,STAGED_SUPPLIER_DOMAINS} from '@/lib/known-suppliers';

export type SearchItem={title:string;url:string;snippet:string;provider:string};
type Provider={name:string;url:(query:string,language:string)=>string;rss?:boolean};

const BING_RSS:Provider={name:'bing-rss',rss:true,url:(query,language)=>`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=50&setlang=${encodeURIComponent(language.split('-')[0])}`};
const PURCHASE_TERM:Record<string,string>={
  AT:'in den warenkorb',BE:'toevoegen aan winkelwagen',BG:'добави в количката',HR:'dodaj u košaricu',CY:'add to cart',CZ:'přidat do košíku',DK:'tilføj til kurv',EE:'lisa ostukorvi',FI:'lisää ostoskoriin',FR:'ajouter au panier',DE:'in den warenkorb',GR:'προσθήκη στο καλάθι',HU:'kosárba',IE:'add to cart',IT:'aggiungi al carrello',LV:'pievienot grozam',LT:'į krepšelį',LU:'ajouter au panier',MT:'add to cart',NL:'toevoegen aan winkelwagen',PL:'dodaj do koszyka',PT:'adicionar ao carrinho',RO:'adaugă în coș',SK:'pridať do košíka',SI:'dodaj v košarico',ES:'añadir al carrito',SE:'lägg i varukorg',
};

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

export function primaryCommerceQuery(input:DiscoverInput) {
  const lane=input.lane;
  const purchase=PURCHASE_TERM[lane.countryCode]??'add to cart';
  const templates=[
    `site:.${lane.tld} inurl:product "Fred Perry" "${lane.localSecondhand}"`,
    `site:.${lane.tld} inurl:shop "Fred Perry" "${lane.localSecondhand}"`,
    `site:.${lane.tld} "Fred Perry" "${purchase}" vintage`,
    `site:.${lane.tld} "Fred Perry" "${purchase}" "${lane.localSecondhand}"`,
    `site:.${lane.tld} inurl:products "Fred Perry" pre-owned`,
    `site:.${lane.tld} inurl:collection "Fred Perry" secondhand`,
    `site:.${lane.tld} "Fred Perry" vintage webshop`,
    `site:.${lane.tld} "Fred Perry" used clothing "${purchase}"`,
  ];
  const index=(input.cycle+lane.index)%templates.length;
  return {index,query:templates[index]};
}

export function alternateCommerceQuery(input:DiscoverInput) {
  const lane=input.lane;
  const purchase=PURCHASE_TERM[lane.countryCode]??'add to cart';
  const templates=[
    `"Fred Perry" "${lane.localSecondhand}" online shop ${lane.country}`,
    `"Fred Perry" vintage boutique "${purchase}" ${lane.country}`,
    `"Fred Perry" pre-owned menswear shop ${lane.country}`,
    `"Fred Perry" secondhand ecommerce ${lane.country}`,
    `"Fred Perry" archive clothing store ${lane.country}`,
    `"Fred Perry" retro clothing webshop ${lane.country}`,
    `"Fred Perry" used polo shop ${lane.country}`,
    `"Fred Perry" vintage track jacket shop ${lane.country}`,
  ];
  const index=(input.cycle*3+lane.index)%templates.length;
  return {index,query:templates[index]};
}

export function shouldRunAlternateSearch(primaryCount:number) {
  return primaryCount===0;
}

export async function searchAll(query:string,input:DiscoverInput) {
  const limit=Math.max(input.maxCandidates*6,36);
  const response=await searchProvider(BING_RSS,query,input.lane.language,limit);
  return {attempts:[response.attempt],results:response.results.slice(0,limit)};
}
