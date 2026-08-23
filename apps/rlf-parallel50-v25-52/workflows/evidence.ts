import {createHash} from 'node:crypto';
import type {DiscoverInput,EvidenceRecord} from './types';
import type {SearchItem} from './search';
import {canonical,relevant,strip} from './search';
import {LEGAL} from './policy';

export type Resource={url:string;status:number|null;contentType:string|null;bytes:Uint8Array;text:string;raw:string;sha256:string|null;length:number;error:string|null};
export type Bundle={target:Resource;home:Resource|null;legal:Resource|null;shopify:Resource|null;shopifyProducts:Array<{title:string;url:string;available:boolean|null;price:string|null}>};

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

async function fetchResource(url:string):Promise<Resource> {
  try {
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(14000),headers:{accept:'text/html,application/json,application/xml;q=.9,*/*;q=.8','accept-language':'en-US,en;q=.8','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'}});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const raw=new TextDecoder().decode(bytes);
    return {url:canonical(response.url||url),status:response.status,contentType:response.headers.get('content-type'),bytes,text:strip(raw).slice(0,90000),raw:raw.slice(0,160000),sha256:hash(bytes),length:bytes.byteLength,error:null};
  } catch(error) {
    return {url:canonical(url),status:null,contentType:null,bytes:new Uint8Array(),text:'',raw:'',sha256:null,length:0,error:error instanceof Error?error.name:'FETCH_ERROR'};
  }
}

function legalPaths(input:DiscoverInput) {
  const common=['/policies/terms-of-service','/pages/contact','/contact'];
  const byCountry:Record<string,string[]>={
    DE:['/pages/impressum','/impressum','/policies/legal-notice'],AT:['/pages/impressum','/impressum','/policies/legal-notice'],
    FR:['/pages/mentions-legales','/mentions-legales','/policies/legal-notice'],BE:['/pages/mentions-legales','/mentions-legales','/policies/legal-notice'],LU:['/pages/mentions-legales','/mentions-legales'],
    ES:['/pages/aviso-legal','/aviso-legal','/policies/legal-notice'],IT:['/pages/contatti','/contatti','/policies/terms-of-service'],PT:['/pages/contactos','/contactos','/policies/terms-of-service'],
    PL:['/pages/regulamin','/regulamin','/policies/terms-of-service'],RO:['/policies/terms-of-service','/pages/contact','/contact'],NL:['/pages/contact','/policies/terms-of-service'],
  };
  return [...(byCountry[input.lane.countryCode]??[]),...common].filter((value,index,array)=>array.indexOf(value)===index);
}

export function evidence(resource:Resource,role:EvidenceRecord['role']):EvidenceRecord {
  return {role,url:resource.url,status:resource.status,contentType:resource.contentType,sha256:resource.sha256,length:resource.length};
}

export async function fetchBundle(result:SearchItem,input:DiscoverInput):Promise<Bundle> {
  const target=await fetchResource(result.url);
  const rootUrl=(()=>{try{return new URL('/',target.url||result.url).toString();}catch{return result.url;}})();
  const targetPath=(()=>{try{return new URL(target.url||result.url).pathname;}catch{return '/';}})();
  const home=targetPath==='/'?null:await fetchResource(rootUrl);
  const combinedRaw=`${target.raw} ${home?.raw??''}`;
  const shopify=/cdn\.shopify\.com|shopify-section|Shopify\.theme|myshopify/i.test(combinedRaw);

  let shopifyResource:Resource|null=null;
  const shopifyProducts:Array<{title:string;url:string;available:boolean|null;price:string|null}>=[];
  if(shopify) {
    const suggest=new URL('/search/suggest.json',rootUrl);
    suggest.searchParams.set('q','Fred Perry');
    suggest.searchParams.set('resources[type]','product');
    suggest.searchParams.set('resources[limit]','12');
    shopifyResource=await fetchResource(suggest.toString());
    if(shopifyResource.status===200) {
      try {
        const json=JSON.parse(shopifyResource.raw);
        const rows=json?.resources?.results?.products??[];
        for(const row of rows) {
          if(!relevant(row.title??'',row.url??'',row.body??'')) continue;
          const url=canonical(new URL(row.url??`/products/${row.handle}`,rootUrl).toString());
          shopifyProducts.push({title:String(row.title??''),url,available:typeof row.available==='boolean'?row.available:null,price:row.price==null?null:String(row.price)});
        }
      } catch {}
    }
  }

  const baseText=`${target.text} ${home?.text??''}`.toLowerCase();
  let legal:Resource|null=null;
  if(!LEGAL.some(term=>baseText.includes(term))) {
    for(const path of legalPaths(input).slice(0,5)) {
      const resource=await fetchResource(new URL(path,rootUrl).toString());
      if(resource.status===200&&resource.length>250) {legal=resource;break;}
    }
  }
  return {target,home,legal,shopify:shopifyResource,shopifyProducts};
}
