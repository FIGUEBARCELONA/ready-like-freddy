import type {DiscoverInput,ProviderAttempt} from './types';
import {INTERNAL,MARKETPLACES} from './policy';

export type SearchItem={title:string;url:string;snippet:string;provider:string};
type Provider={name:string;url:(query:string,language:string)=>string;rss?:boolean};

const PROVIDERS:Provider[]=[
  {name:'bing-rss',rss:true,url:(query,language)=>`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=40&setlang=${encodeURIComponent(language.split('-')[0])}`},
  {name:'yahoo',url:query=>`https://search.yahoo.com/search?p=${encodeURIComponent(query)}&n=40`},
];

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
    const base=provider==='yahoo'?'https://search.yahoo.com':'https://www.bing.com';
    const url=new URL(value,base);
    if(provider==='yahoo') {
      const match=value.match(/\/RU=([^/]+)\/RK=/i);
      if(match) return canonical(decodeURIComponent(match[1]));
    }
    return canonical(url.toString());
  } catch {return '';}
}

export function relevant(title:string,url:string,description='') {
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
    seen.add(url);output.push({title,url,snippet:'',provider});
    if(output.length>=limit) break;
  }
  return output;
}

function rssResults(xml:string,provider:string,limit:number) {
  const output:SearchItem[]=[];
  const seen=new Set<string>();
  for(const match of xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi)) {
    const title=strip(match[1]).slice(0,260);
    const url=canonical(strip(match[2]));
    const snippet=strip(match[3]).slice(0,500);
    const domain=domainOf(url);
    if(!url.startsWith('http')||!domain||seen.has(url)||!relevant(title,url,snippet)) continue;
    seen.add(url);output.push({title,url,snippet,provider});
    if(output.length>=limit) break;
  }
  return output;
}

async function searchProvider(provider:Provider,query:string,language:string,limit:number) {
  const started=Date.now();
  try {
    const response=await fetch(provider.url(query,language),{redirect:'follow',signal:AbortSignal.timeout(13000),headers:{accept:provider.rss?'application/rss+xml,application/xml,text/xml;q=.9,*/*;q=.8':'text/html,*/*;q=.8','accept-language':language,'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36'}});
    const body=await response.text();
    const results=response.ok?(provider.rss?rssResults(body,provider.name,limit):htmlResults(body,provider.name,limit)):[];
    const attempt:ProviderAttempt={name:provider.name,status:response.status,bodyLength:body.length,linkCount:results.length,challenge:/captcha|unusual traffic|verify you are human|access denied|error getting results|automated queries/i.test(body),durationMs:Date.now()-started,error:null};
    return {attempt,results};
  } catch(error) {
    const attempt:ProviderAttempt={name:provider.name,status:null,bodyLength:0,linkCount:0,challenge:false,durationMs:Date.now()-started,error:error instanceof Error?error.name:'SEARCH_ERROR'};
    return {attempt,results:[] as SearchItem[]};
  }
}

export async function searchAll(query:string,input:DiscoverInput) {
  const attempts:ProviderAttempt[]=[];
  const results:SearchItem[]=[];
  const seen=new Set<string>();
  const pivot=input.lane.index%PROVIDERS.length;
  const rotated=[...PROVIDERS.slice(pivot),...PROVIDERS.slice(0,pivot)];
  for(const provider of rotated) {
    const response=await searchProvider(provider,query,input.lane.language,Math.max(input.maxCandidates*5,30));
    attempts.push(response.attempt);
    for(const item of response.results) {
      const domain=domainOf(item.url);
      if(!domain||MARKETPLACES.some(rule=>domain.includes(rule))||seen.has(item.url)) continue;
      seen.add(item.url);results.push(item);
    }
    if(results.length>=input.maxCandidates*4) break;
  }
  return {attempts,results:results.slice(0,Math.max(input.maxCandidates*5,30))};
}
