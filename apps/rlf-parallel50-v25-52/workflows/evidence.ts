import {createHash} from 'node:crypto';
import type {DiscoverInput,EvidenceRecord} from './types';
import type {SearchItem} from './search';
import {canonical,relevant,strip} from './search';
import {LEGAL} from './policy';
import {legalResourceEligible} from './provenance';

export type Resource={url:string;status:number|null;contentType:string|null;bytes:Uint8Array;text:string;raw:string;sha256:string|null;length:number;error:string|null};
export type Bundle={target:Resource;home:Resource|null;legal:Resource|null;shopify:Resource|null;shopifyProducts:Array<{title:string;url:string;available:boolean|null;price:string|null}>};

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

async function fetchResource(url:string):Promise<Resource> {
  try {
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(14000),headers:{accept:'text/html,application/xhtml+xml,text/plain,application/json;q=.8,*/*;q=.5','accept-language':'en-US,en;q=.8','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'}});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const decoded=new TextDecoder().decode(bytes);
    return {url:canonical(response.url||url),status:response.status,contentType:response.headers.get('content-type'),bytes,text:strip(decoded).slice(0,110000),raw:decoded.slice(0,260000),sha256:hash(bytes),length:bytes.byteLength,error:null};
  } catch(error) {
    return {url:canonical(url),status:null,contentType:null,bytes:new Uint8Array(),text:'',raw:'',sha256:null,length:0,error:error instanceof Error?error.name:'FETCH_ERROR'};
  }
}

function legalPaths(input:DiscoverInput) {
  const common=['/pages/impressum','/impressum','/pages/legal-notice','/policies/legal-notice','/legal-notice','/policies/terms-of-service','/terms-and-conditions','/terms','/pages/contact','/contact'];
  const byCountry:Record<string,string[]>={
    DE:['/pages/impressum','/impressum','/anbieterkennzeichnung'],AT:['/pages/impressum','/impressum','/firmenbuch'],
    FR:['/pages/mentions-legales','/mentions-legales','/conditions-generales-de-vente'],BE:['/pages/mentions-legales','/mentions-legales','/algemene-voorwaarden'],LU:['/pages/mentions-legales','/mentions-legales'],
    ES:['/pages/aviso-legal','/aviso-legal','/terminos-y-condiciones'],IT:['/pages/contatti','/contatti','/note-legali','/termini-e-condizioni'],PT:['/pages/contactos','/contactos','/termos-e-condicoes'],
    PL:['/pages/regulamin','/regulamin','/kontakt'],RO:['/policies/terms-of-service','/termeni-si-conditii','/pages/contact','/contact'],NL:['/pages/contact','/algemene-voorwaarden','/over-ons'],
    SE:['/pages/kontakt','/pages/frakt-retur','/kontakt','/kopvillkor'],DK:['/pages/kontakt','/handelsbetingelser','/kontakt'],FI:['/pages/yhteystiedot','/toimitusehdot'],
    CZ:['/obchodni-podminky','/kontakt'],SK:['/obchodne-podmienky','/kontakt'],HU:['/altalanos-szerzodesi-feltetelek','/kapcsolat'],
    SI:['/splosni-pogoji','/kontakt'],HR:['/uvjeti-poslovanja','/kontakt'],EE:['/muugitingimused','/kontakt'],LV:['/noteikumi','/kontakti'],LT:['/taisykles','/kontaktai'],
    GR:['/oroi-xrisis','/epikoinonia'],BG:['/obshti-usloviya','/kontakti'],IE:['/terms-and-conditions','/contact-us'],MT:['/terms-and-conditions','/contact'],CY:['/terms-and-conditions','/contact-us'],
  };
  return [...(byCountry[input.lane.countryCode]??[]),...common].filter((value,index,array)=>array.indexOf(value)===index);
}

function linkedLegalPaths(raw:string) {
  const output:string[]=[];
  for(const match of raw.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href=match[1];
    if(/^(?:mailto:|tel:|javascript:|data:|#)/i.test(href))continue;
    if(/impressum|legal|mentions-legales|aviso-legal|terms|conditions|regulamin|kontakt|contact|retur|refund|company|about/i.test(href)) output.push(href);
  }
  return [...new Set(output)].slice(0,12);
}

export function evidence(resource:Resource,role:EvidenceRecord['role']):EvidenceRecord {
  return {role,url:resource.url,status:resource.status,contentType:resource.contentType,sha256:resource.sha256,length:resource.length};
}

export async function fetchBundle(result:SearchItem,input:DiscoverInput):Promise<Bundle> {
  const target=await fetchResource(result.url);
  const operatorUrl=target.url||result.url;
  const rootUrl=(()=>{try{return new URL('/',operatorUrl).toString();}catch{return result.url;}})();
  const targetPath=(()=>{try{return new URL(operatorUrl).pathname;}catch{return '/';}})();
  const home=targetPath==='/'?null:await fetchResource(rootUrl);
  const combinedRaw=`${target.raw} ${home?.raw??''}`;
  const shopify=/cdn\.shopify\.com|shopify-section|Shopify\.theme|myshopify/i.test(combinedRaw);

  let shopifyResource:Resource|null=null;
  const shopifyProducts:Array<{title:string;url:string;available:boolean|null;price:string|null}>=[];
  if(shopify) {
    const suggest=new URL('/search/suggest.json',rootUrl);
    suggest.searchParams.set('q','Fred Perry');
    suggest.searchParams.set('resources[type]','product');
    suggest.searchParams.set('resources[limit]','20');
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

  let legal:Resource|null=null;
  const candidates=[...linkedLegalPaths(combinedRaw),...legalPaths(input)];
  const seen=new Set<string>();
  for(const candidate of candidates.slice(0,14)) {
    let url:string;
    try {url=new URL(candidate,rootUrl).toString();} catch {continue;}
    if(seen.has(url)||!legalResourceEligible(url,url,operatorUrl,'text/html'))continue;
    seen.add(url);
    const resource=await fetchResource(url);
    if(!legalResourceEligible(url,resource.url,operatorUrl,resource.contentType))continue;
    const legalHits=LEGAL.filter(term=>resource.text.toLowerCase().includes(term)).length;
    if(resource.status===200&&resource.length>300&&(legalHits>0||/impressum|legal|terms|conditions|contact|kontakt|retur/i.test(resource.url))) {legal=resource;break;}
  }

  return {target,home,legal,shopify:shopifyResource,shopifyProducts};
}
