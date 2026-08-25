import {createHash} from 'node:crypto';
import type {Lane} from '@/lib/lanes';
import type {Candidate,DiscoverInput,EvidenceRecord,LaneCycleResult,ProviderAttempt} from './types';
import type {SearchItem} from './search';
import {canonical,domainOf,eligibleSearchDomain} from './search';
import {fetchBundle} from './evidence';
import {assess} from './assessment';
import {sameRegistrableDomain} from './provenance';

export const COMMON_CRAWL_PRIMARY='CC-MAIN-2026-34' as const;
export const COMMON_CRAWL_FALLBACKS=['CC-MAIN-2026-30','CC-MAIN-2026-25','CC-MAIN-2026-21','CC-MAIN-2026-17'] as const;
const INDEX_ROOT='https://index.commoncrawl.org';
const PROVIDER='common-crawl-cdxj';
const MAX_BODY_CHARS=900000;
const LOCAL_PREFIX:Record<string,string>={
  DE:'produkt',FR:'produit',IT:'prodotto',ES:'producto',PL:'produkt',NL:'product',BE:'product',PT:'produto',SE:'produkt',DK:'produkt',FI:'tuote',AT:'produkt',CZ:'produkt',RO:'produs',GR:'product',HU:'termek',IE:'product',HR:'proizvod',SK:'produkt',SI:'izdelek',BG:'product',LT:'produktas',EE:'toode',
};
const INVENTORY_PATH=/(?:^|\/)(?:products?|collections?|items?|shop|store|produkt|produit|prodotto|producto|produto|tuote|produs|termek|proizvod|izdelek|produktas|toode)(?:\/|$)/i;
const BRAND_PATH=/fred(?:%20|[-_+\s])*perry|fredperry/i;
const RATE_LIMIT=/rate.?limit|too many requests|temporarily unavailable|service unavailable/i;

export type CommonCrawlRecord={url:string;timestamp:string;status:string;mime:string;digest:string;filename?:string;offset?:string;length?:string};
export type CommonCrawlPartition={primaryIndex:string;fallbackIndex:string;primaryPattern:string;fallbackPattern:string;signature:string;staggerMs:number};

type CdxResponse={attempt:ProviderAttempt;records:CommonCrawlRecord[];queryUrl:string};

const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const stableRecord=(record:CommonCrawlRecord)=>JSON.stringify({url:canonical(record.url),timestamp:record.timestamp,status:record.status,mime:record.mime,digest:record.digest,filename:record.filename??'',offset:record.offset??'',length:record.length??''});

export function archiveRecordHash(record:CommonCrawlRecord){return sha256(stableRecord(record));}
export function inventoryArchiveUrl(raw:string,lane:Lane){
  try{
    const url=new URL(canonical(raw));const domain=domainOf(url.toString());const path=decodeURIComponent(`${url.pathname}${url.search}`);
    if(!eligibleSearchDomain(domain))return false;
    if(!(domain===lane.tld||domain.endsWith(`.${lane.tld}`)))return false;
    if(!INVENTORY_PATH.test(path)||!BRAND_PATH.test(path))return false;
    if(domain.endsWith('.uk')||domain.endsWith('.co.uk'))return false;
    return true;
  }catch{return false;}
}

export function commonCrawlPartition(lane:Lane):CommonCrawlPartition{
  const secondary=lane.index>=27;
  const primaryPrefix=secondary?(LOCAL_PREFIX[lane.countryCode]??'product'):'products';
  const fallbackPrefix=secondary?'products':'collections';
  const primaryPattern=`*.${lane.tld}/${primaryPrefix}/fred-perry*`;
  const fallbackPattern=`*.${lane.tld}/${fallbackPrefix}/fredperry*`;
  const fallbackIndex=COMMON_CRAWL_FALLBACKS[lane.index%COMMON_CRAWL_FALLBACKS.length];
  const staggerMs=Math.floor(lane.index/5)*1000+(lane.index%5)*120;
  return {primaryIndex:COMMON_CRAWL_PRIMARY,fallbackIndex,primaryPattern,fallbackPattern,signature:sha256(`${lane.slot}|${lane.countryCode}|${primaryPattern}|${fallbackIndex}|${fallbackPattern}`),staggerMs};
}

export function commonCrawlQueryUrl(index:string,pattern:string,limit=24){
  const params=new URLSearchParams();
  params.set('url',pattern);params.set('output','json');params.append('filter','status:200');params.append('filter','mime:text/html');params.set('collapse','urlkey');params.set('limit',String(Math.max(1,Math.min(limit,60))));params.set('fields','url,timestamp,status,mime,digest,filename,offset,length');
  return `${INDEX_ROOT}/${index}-index?${params.toString()}`;
}

export function parseCommonCrawl(body:string,lane:Lane,limit=24){
  const output:CommonCrawlRecord[]=[];const seenDomains=new Set<string>();
  for(const line of body.split(/\r?\n/)){
    const value=line.trim();if(!value.startsWith('{'))continue;
    try{
      const row=JSON.parse(value) as CommonCrawlRecord;
      if(String(row.status)!=='200'||!/text\/html/i.test(String(row.mime??''))||!inventoryArchiveUrl(row.url,lane))continue;
      const domain=domainOf(row.url);if(!domain||seenDomains.has(domain))continue;
      seenDomains.add(domain);output.push(row);
      if(output.length>=limit)break;
    }catch{}
  }
  return output;
}

async function fetchCdx(index:string,pattern:string,lane:Lane,limit:number,delayMs:number):Promise<CdxResponse>{
  if(delayMs>0)await wait(delayMs);
  const queryUrl=commonCrawlQueryUrl(index,pattern,Math.max(limit*4,20));const started=Date.now();
  try{
    const response=await fetch(queryUrl,{redirect:'follow',signal:AbortSignal.timeout(22000),headers:{accept:'application/x-ndjson,application/json,text/plain;q=.8,*/*;q=.5','accept-language':lane.language,'user-agent':'RLF-Research/1.0 (+https://readylikefreddy.shop)'}});
    const raw=await response.text();const body=raw.slice(0,MAX_BODY_CHARS);const records=response.ok?parseCommonCrawl(body,lane,Math.max(limit*3,12)):[];
    const challenge=response.status===429||response.status===503||RATE_LIMIT.test(body);
    return {queryUrl,records,attempt:{name:`${PROVIDER}:${index}`,status:response.status,bodyLength:Buffer.byteLength(raw),linkCount:records.length,challenge,durationMs:Date.now()-started,error:null,contentType:response.headers.get('content-type'),responseHash:sha256(raw)}};
  }catch(error){
    return {queryUrl,records:[],attempt:{name:`${PROVIDER}:${index}`,status:null,bodyLength:0,linkCount:0,challenge:false,durationMs:Date.now()-started,error:error instanceof Error?error.name:'COMMON_CRAWL_ERROR',contentType:null,responseHash:null}};
  }
}

function archiveEvidence(record:CommonCrawlRecord):EvidenceRecord{
  return {role:'ARCHIVE_INDEX',url:canonical(record.url),status:Number(record.status)||200,contentType:record.mime||'text/html',sha256:archiveRecordHash(record),length:Number(record.length)||0};
}
function protectedStatus(status:Candidate['status']){return status==='DUPLICATE_KNOWN'||status==='DUPLICATE_IDENTITY_IN_SWEEP'||status==='QUARANTINE_IDENTITY'||status==='REJECT_MARKETPLACE'||status==='REJECT_NOT_PRELOVED'||status==='REJECT_UK'||status==='REJECT_NON_EU';}
function applyArchiveSupplierGate(candidate:Candidate,record:CommonCrawlRecord,sourceUrl:string){
  candidate.searchProviders=[`${PROVIDER}:${record.timestamp.slice(0,6)}`];
  candidate.fredPerryEvidence=true;candidate.uniqueProductPathSignal=true;candidate.productEvidence='SUPPLIER_EVIDENCE_ONLY';candidate.score+=10;
  candidate.evidence.unshift(archiveEvidence(record));
  if(!sameRegistrableDomain(candidate.url,sourceUrl)){
    candidate.status='EVIDENCE_INCOMPLETE';candidate.supplierEvidence='INCOMPLETE';candidate.score=Math.min(candidate.score,45);return candidate;
  }
  const supplierReady=candidate.legalSignal&&candidate.prelovedEvidence&&candidate.professionalEvidence&&candidate.euEvidence&&!candidate.knownDuplicate&&!candidate.identityQuarantine&&!protectedStatus(candidate.status);
  if(supplierReady){candidate.status='QUALIFIED_PROVISIONAL';candidate.supplierEvidence='READY_TO_REVIEW';}
  return candidate;
}

export async function discoverCommonCrawlLane(input:DiscoverInput):Promise<LaneCycleResult>{
  const searchedAt=new Date().toISOString();const partition=commonCrawlPartition(input.lane);const attempts:ProviderAttempt[]=[];
  const primary=await fetchCdx(partition.primaryIndex,partition.primaryPattern,input.lane,input.maxCandidates,partition.staggerMs);attempts.push(primary.attempt);
  let records=[...primary.records];let query=`COMMON_CRAWL_V24:${partition.primaryIndex}:${partition.primaryPattern}`;
  if(records.length===0&&!primary.attempt.challenge&&!primary.attempt.error&&(primary.attempt.status===200||primary.attempt.status===404)){
    const fallback=await fetchCdx(partition.fallbackIndex,partition.fallbackPattern,input.lane,input.maxCandidates,180);attempts.push(fallback.attempt);records=[...fallback.records];query+=` || FALLBACK:${partition.fallbackIndex}:${partition.fallbackPattern}`;
  }
  const candidates:Candidate[]=[];const errors:string[]=[];const seenDomains=new Set<string>();
  for(const record of records){
    if(candidates.length>=input.maxCandidates)break;
    const sourceUrl=canonical(record.url);const domain=domainOf(sourceUrl);if(!domain||seenDomains.has(domain))continue;seenDomains.add(domain);
    const result:SearchItem={title:`Archived Fred Perry inventory · ${domain}`,url:sourceUrl,snippet:`Common Crawl capture ${record.timestamp}; direct same-domain inventory path.`,provider:`${PROVIDER}:${partition.primaryIndex}`};
    const bundle=await fetchBundle(result,input);let candidate=assess(input,query,24,-1,result,bundle);candidate=applyArchiveSupplierGate(candidate,record,sourceUrl);candidates.push(candidate);
    if(bundle.target.error&&(!bundle.home||bundle.home.error))errors.push(`${domain}:CURRENT_SITE_UNAVAILABLE`);
    if(!candidate.legalSignal)errors.push(`${domain}:LEGAL_IDENTITY_INCOMPLETE`);
  }
  if(records.length===0)errors.push('NO_ELIGIBLE_COMMON_CRAWL_RECORDS');
  return {slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate:24,identityQueryTemplate:-1,searchedAt,searchStatus:attempts.find(attempt=>attempt.status===200)?.status??attempts[0]?.status??null,candidates,errors,searchAttempts:attempts};
}

export async function commonCrawlSmoke(lane:Lane){
  const partition=commonCrawlPartition(lane);const response=await fetchCdx(partition.primaryIndex,partition.primaryPattern,lane,3,0);
  return {ready:response.attempt.status===200&&!response.attempt.challenge&&!response.attempt.error,index:partition.primaryIndex,pattern:partition.primaryPattern,queryUrl:response.queryUrl,partitionSignature:partition.signature,status:response.attempt.status,contentType:response.attempt.contentType,responseHash:response.attempt.responseHash,bodyLength:response.attempt.bodyLength,eligibleRecords:response.records.length,sample:response.records.slice(0,3).map(record=>({url:record.url,timestamp:record.timestamp,digest:record.digest,recordSha256:archiveRecordHash(record)})),challenge:response.attempt.challenge,error:response.attempt.error,durationMs:response.attempt.durationMs};
}
