import type {DiscoverInput,LaneCycleResult,Candidate,ProviderAttempt} from './types';
import {NEGATIVE} from './policy';
import {alternateCommerceQuery,domainOf,primaryCommerceQuery,primaryCorpus,searchFallback,searchPrimary,shouldRunFallbackSearch,type SearchItem} from './search';
import {evidence,fetchBundle} from './evidence';
import {assess} from './assessment';

export async function discoverLaneCycle(input:DiscoverInput):Promise<LaneCycleResult> {
  'use step';
  const searchedAt=new Date().toISOString();
  const primaryTemplate=primaryCommerceQuery(input);
  const discoveryQuery=`${primaryTemplate.query} ${NEGATIVE}`;
  const primary=await searchPrimary(discoveryQuery,input);
  const attempts:ProviderAttempt[]=[...primary.attempts];
  const merged:SearchItem[]=[];const seenUrls=new Set<string>();
  const merge=(items:SearchItem[])=>{for(const item of items){if(seenUrls.has(item.url))continue;seenUrls.add(item.url);merged.push(item);}};
  merge(primary.results);
  let query=`${primaryCorpus(input).toUpperCase()}:${discoveryQuery}`;
  if(shouldRunFallbackSearch(primary.results.length)) {
    const alternateTemplate=alternateCommerceQuery(input);
    const fallbackQuery=`${alternateTemplate.query} ${NEGATIVE}`;
    const fallback=await searchFallback(fallbackQuery,input);
    attempts.push(...fallback.attempts);merge(fallback.results);
    query+=` || BING_FALLBACK:${fallbackQuery}`;
  }
  const errors:string[]=[];const candidates:Candidate[]=[];const domains=new Set<string>();
  for(const result of merged) {
    if(candidates.length>=input.maxCandidates) break;
    const domain=domainOf(result.url);if(!domain||domains.has(domain)) continue;domains.add(domain);
    const bundle=await fetchBundle(result,input);
    if(bundle.target.error&&(!bundle.home||bundle.home.error)) {
      errors.push(`${domain}:${bundle.target.error}`);
      candidates.push({slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate:primaryTemplate.index,identityQueryTemplate:-1,searchProviders:[result.provider],title:result.title,url:result.url,domain,httpStatus:null,status:'FETCH_FAILED',score:0,supplierEvidence:'INCOMPLETE',productEvidence:'SUPPLIER_EVIDENCE_ONLY',fredPerryEvidence:false,prelovedEvidence:false,professionalEvidence:false,directPurchaseSignal:false,legalSignal:false,uniqueProductPathSignal:false,euEvidence:false,detectedCountryCode:null,countryBasis:'NONE',laneCountryMatch:false,knownDuplicate:false,identityQuarantine:false,duplicateBasis:'NONE',identityKey:null,identityBasis:'NONE',vatId:null,registrationId:null,contractingName:null,addressSignal:null,priceSignal:null,availableProductSignals:0,evidence:[evidence(bundle.target,'TARGET')],checkedAt:new Date().toISOString()});
      continue;
    }
    if(bundle.target.status&&bundle.target.status>=400&&(!bundle.home||!bundle.home.status||bundle.home.status>=400)) errors.push(`${domain}:HTTP_${bundle.target.status}`);
    candidates.push(assess(input,query,primaryTemplate.index,-1,result,bundle));
  }
  if(!merged.length) errors.push('NO_ELIGIBLE_MULTI_CORPUS_RESULTS');
  return {slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate:primaryTemplate.index,identityQueryTemplate:-1,searchedAt,searchStatus:attempts.find(attempt=>attempt.status===200)?.status??attempts[0]?.status??null,candidates,errors,searchAttempts:attempts};
}
