import type {DiscoverInput,LaneCycleResult,Candidate,ProviderAttempt} from './types';
import type {Lane} from '@/lib/lanes';

const BANNED=[
  'ebay.','vinted.','wallapop.','depop.','etsy.','amazon.','facebook.com','instagram.com','pinterest.','reddit.com','youtube.com','tiktok.com',
  'grailed.com','vestiairecollective.','shpock.','olx.','allegro.','leboncoin.fr','2dehands.','marktplaats.nl','kleinanzeigen.de','catawiki.','tradera.',
  'finn.no','tori.fi','willhaben.at','marketplace.',
];

const INTERNAL=['google.com','googleusercontent.com','gstatic.com','brave.com','mojeek.com','yahoo.com','yahoo.net','bing.com','microsoft.com'];
const PRELOVED=['vintage','second hand','secondhand','preloved','pre-loved','used clothing','seconde main','friperie','gebraucht','zweite hand','tweedehands','usato','seconda mano','segunda mano','segunda mão','odzież używana','használt','rabljena','použité','genbrug','käytetyt','lietoti','dėvėti','дрехи втора употреба','μεταχειρισμένα','haine second hand','kasutatud riided'];
const PROFESSIONAL=['add to cart','add to bag','basket','checkout','shop now','buy now','shipping','delivery','returns','return policy','terms and conditions','contact us','about us','ajouter au panier','in den warenkorb','aggiungi al carrello','añadir al carrito','adicionar ao carrinho','toevoegen aan winkelwagen','lägg i varukorg','dodaj do koszyka','tilføj til kurv'];
const LEGAL=['vat','iva','nif','cif','p.iva','partita iva','btw','kvk','siret','siren','ust-id','company number','registration number','impressum','legal notice','mentions légales','aviso legal','privacy policy','regulamin'];
const PURCHASE=['add to cart','add to bag','buy now','checkout','ajouter au panier','in den warenkorb','aggiungi al carrello','añadir al carrito','adicionar ao carrinho','dodaj do koszyka'];

const QUERIES:Array<(lane:Lane)=>string>=[
  lane=>`"Fred Perry" polo vintage second hand ${lane.country} -Federal -Reserve -economics`,
  lane=>`"Fred Perry" clothing preloved vintage shop ${lane.country} -Federal -Reserve`,
  lane=>`site:.${lane.tld} "Fred Perry" polo vintage ${lane.localSecondhand}`,
  lane=>`site:.${lane.tld} "Fred Perry" second hand clothing shop`,
  lane=>`"Fred Perry" track jacket vintage shop ${lane.country}`,
  lane=>`"Fred Perry" shirt used clothing boutique ${lane.country}`,
];

type SearchItem={title:string;url:string;snippet:string};
type Provider={name:string;url:(query:string,language:string)=>string;rss?:boolean};

const PROVIDERS:Provider[]=[
  {name:'google',url:(query,language)=>`https://www.google.com/search?q=${encodeURIComponent(query)}&num=30&hl=${encodeURIComponent(language.split('-')[0])}`},
  {name:'brave',url:query=>`https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`},
  {name:'mojeek',url:query=>`https://www.mojeek.com/search?q=${encodeURIComponent(query)}`},
  {name:'yahoo',url:query=>`https://search.yahoo.com/search?p=${encodeURIComponent(query)}&n=30`},
  {name:'bing-rss',rss:true,url:(query,language)=>`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=30&setlang=${encodeURIComponent(language.split('-')[0])}`},
];

const decode=(value:string)=>String(value||'').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const strip=(value:string)=>decode(String(value||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());

function canonical(raw:string) {
  try {
    const url=new URL(raw);
    url.hash='';
    for(const key of [...url.searchParams.keys()]) if(/^(utm_|gclid|fbclid|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    return url.toString().replace(/\/$/,'');
  } catch {
    return raw;
  }
}

function domainOf(raw:string) {
  try {return new URL(raw).hostname.toLowerCase().replace(/^www\./,'');}
  catch {return '';}
}

function clean(raw:string,provider:string) {
  const value=decode(raw);
  try {
    if(/^(javascript:|mailto:|tel:|#)/i.test(value)) return '';
    const base=provider==='google'?'https://www.google.com':provider==='brave'?'https://search.brave.com':provider==='mojeek'?'https://www.mojeek.com':provider==='yahoo'?'https://search.yahoo.com':'https://www.bing.com';
    const url=new URL(value,base);
    if(provider==='google'&&url.pathname==='/url') {
      const redirected=url.searchParams.get('q')||url.searchParams.get('url');
      if(redirected) return canonical(decodeURIComponent(redirected));
    }
    if(provider==='yahoo') {
      const match=value.match(/\/RU=([^/]+)\/RK=/i);
      if(match) return canonical(decodeURIComponent(match[1]));
    }
    return canonical(url.toString());
  } catch {
    return '';
  }
}

function relevant(title:string,url:string,description='') {
  const text=`${strip(title)} ${url} ${strip(description)}`.toLowerCase().replace(/[-_/%]+/g,' ');
  if(/federal reserve|economic data|st\. louis fed|\bfred\b.*econom/i.test(text)) return false;
  return /fred\s+perry/.test(text)||/fredperry/.test(text);
}

function htmlResults(html:string,provider:string,limit:number) {
  const output:SearchItem[]=[];
  const seen=new Set<string>();
  for(const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url=clean(match[1],provider);
    const title=strip(match[2]).slice(0,260);
    const domain=domainOf(url);
    if(!url.startsWith('http')||!domain||seen.has(url)||INTERNAL.some(item=>domain===item||domain.endsWith(`.${item}`))||!relevant(title,url)) continue;
    seen.add(url);
    output.push({title,url,snippet:''});
    if(output.length>=limit) break;
  }
  return output;
}

function rssResults(xml:string,limit:number) {
  const output:SearchItem[]=[];
  const seen=new Set<string>();
  for(const match of xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi)) {
    const title=strip(match[1]).slice(0,260);
    const url=canonical(strip(match[2]));
    const snippet=strip(match[3]).slice(0,500);
    const domain=domainOf(url);
    if(!url.startsWith('http')||!domain||seen.has(url)||!relevant(title,url,snippet)) continue;
    seen.add(url);
    output.push({title,url,snippet});
    if(output.length>=limit) break;
  }
  return output;
}

async function searchProvider(provider:Provider,query:string,language:string,limit:number) {
  const started=Date.now();
  try {
    const response=await fetch(provider.url(query,language),{
      redirect:'follow',
      signal:AbortSignal.timeout(18000),
      headers:{
        accept:provider.rss?'application/rss+xml,application/xml,text/xml;q=.9,*/*;q=.8':'text/html,*/*;q=.8',
        'accept-language':language,
        'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      },
    });
    const body=await response.text();
    const results=response.ok?(provider.rss?rssResults(body,limit):htmlResults(body,provider.name,limit)):[];
    const attempt:ProviderAttempt={
      name:provider.name,
      status:response.status,
      bodyLength:body.length,
      linkCount:results.length,
      challenge:/captcha|unusual traffic|verify you are human|access denied|error getting results/i.test(body),
      durationMs:Date.now()-started,
      error:null,
    };
    return {attempt,results};
  } catch(error) {
    const attempt:ProviderAttempt={name:provider.name,status:null,bodyLength:0,linkCount:0,challenge:false,durationMs:Date.now()-started,error:error instanceof Error?error.name:'SEARCH_ERROR'};
    return {attempt,results:[] as SearchItem[]};
  }
}

async function searchAll(query:string,input:DiscoverInput) {
  const attempts:ProviderAttempt[]=[];
  const results:SearchItem[]=[];
  const seen=new Set<string>();
  for(let offset=0;offset<PROVIDERS.length;offset+=1) {
    const provider=PROVIDERS[(input.lane.index+offset)%PROVIDERS.length];
    const response=await searchProvider(provider,query,input.lane.language,Math.max(input.maxCandidates*3,15));
    attempts.push(response.attempt);
    for(const item of response.results) if(!seen.has(item.url)) {seen.add(item.url);results.push(item);}
    if(results.length>=input.maxCandidates*2) break;
  }
  return {attempts,results:results.slice(0,Math.max(input.maxCandidates*3,15))};
}

async function fetchPage(url:string) {
  const response=await fetch(url,{
    redirect:'follow',
    signal:AbortSignal.timeout(14000),
    headers:{accept:'text/html,text/plain;q=.8','user-agent':'Mozilla/5.0 (compatible; RLFResearchBot/1.4; +https://readylikefreddy.shop)'},
  });
  return {status:response.status,finalUrl:canonical(response.url||url),text:strip(await response.text()).slice(0,65000)};
}

function assess(input:DiscoverInput,query:string,result:SearchItem,page:{status:number;finalUrl:string;text:string}):Candidate {
  const url=page.finalUrl||result.url;
  const domain=domainOf(url);
  const joined=`${result.title} ${result.snippet} ${page.text}`.toLowerCase();
  const marketplace=BANNED.some(item=>domain.includes(item));
  const uk=domain.endsWith('.co.uk')||domain.endsWith('.uk')||/\b(united kingdom|england|scotland|wales|northern ireland)\b/i.test(joined);
  const fred=/fred\s+perry/i.test(joined);
  const preloved=PRELOVED.some(item=>joined.includes(item));
  const professionalHits=PROFESSIONAL.filter(item=>joined.includes(item)).length;
  const professional=professionalHits>=2;
  const direct=PURCHASE.some(item=>joined.includes(item));
  const legal=LEGAL.some(item=>joined.includes(item));
  let productPath=false;
  try {productPath=/\/(products?|items?|shop|store|collections?)\//i.test(new URL(url).pathname);} catch {}
  const price=(joined.match(/(?:€|eur)\s?\d{1,4}(?:[.,]\d{2})?|\d{1,4}(?:[.,]\d{2})?\s?(?:€|eur)/i)||[])[0]||null;
  const supplierReady=!marketplace&&!uk&&fred&&preloved&&professional;
  const productReady=supplierReady&&direct&&productPath&&Boolean(price);
  const score=(fred?32:0)+(preloved?22:0)+(professional?18:0)+(direct?10:0)+(legal?8:0)+(productPath?5:0)+(price?5:0);
  const status:Candidate['status']=marketplace?'REJECT_MARKETPLACE':uk?'REJECT_UK':supplierReady?'QUALIFIED_PROVISIONAL':'EVIDENCE_INCOMPLETE';
  return {
    slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,
    title:result.title,url,domain,httpStatus:page.status,status,score,
    supplierEvidence:supplierReady?'READY_TO_REVIEW':'INCOMPLETE',
    productEvidence:productReady?'DIRECT_PRODUCT_PROVISIONAL':'SUPPLIER_EVIDENCE_ONLY',
    fredPerryEvidence:fred,prelovedEvidence:preloved,professionalEvidence:professional,directPurchaseSignal:direct,legalSignal:legal,uniqueProductPathSignal:productPath,priceSignal:price,checkedAt:new Date().toISOString(),
  };
}

export async function discoverLaneCycle(input:DiscoverInput):Promise<LaneCycleResult> {
  'use step';
  const searchedAt=new Date().toISOString();
  const query=`${QUERIES[input.cycle%QUERIES.length](input.lane)} -ebay -vinted -wallapop -depop -etsy -amazon`;
  const found=await searchAll(query,input);
  const errors:string[]=[];
  const candidates:Candidate[]=[];
  const domains=new Set<string>();

  for(const result of found.results) {
    if(candidates.length>=input.maxCandidates) break;
    const domain=domainOf(result.url);
    if(!domain||domains.has(domain)) continue;
    domains.add(domain);
    try {
      const page=await fetchPage(result.url);
      if(page.status>=400) errors.push(`${domain}:HTTP_${page.status}`);
      candidates.push(assess(input,query,result,page));
    } catch(error) {
      errors.push(`${domain}:${error instanceof Error?error.name:'FETCH_ERROR'}`);
      candidates.push({slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,title:result.title,url:result.url,domain,httpStatus:null,status:'FETCH_FAILED',score:0,supplierEvidence:'INCOMPLETE',productEvidence:'SUPPLIER_EVIDENCE_ONLY',fredPerryEvidence:false,prelovedEvidence:false,professionalEvidence:false,directPurchaseSignal:false,legalSignal:false,uniqueProductPathSignal:false,priceSignal:null,checkedAt:new Date().toISOString()});
    }
  }

  if(!found.results.length) errors.push('NO_RELEVANT_SEARCH_RESULTS');
  return {
    slot:input.lane.slot,
    cycle:input.cycle,
    countryCode:input.lane.countryCode,
    country:input.lane.country,
    query,
    searchedAt,
    searchStatus:found.attempts.find(attempt=>attempt.status===200)?.status??found.attempts[0]?.status??null,
    candidates,
    errors,
    searchAttempts:found.attempts,
  };
}
