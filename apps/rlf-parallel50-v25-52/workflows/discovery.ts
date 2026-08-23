import type {DiscoverInput,LaneCycleResult,Candidate,ProviderAttempt} from './types';
import {NEGATIVE,QUERIES} from './policy';
import {domainOf,searchAll,type SearchItem} from './search';
import {evidence,fetchBundle} from './evidence';
import {assess} from './assessment';

export async function discoverLaneCycle(input:DiscoverInput):Promise<LaneCycleResult> {
  'use step';
  const searchedAt=new Date().toISOString();
  const queryTemplate=(input.cycle+input.lane.index)%QUERIES.length;
  const secondaryTemplate=(queryTemplate+7+(input.lane.index%5))%QUERIES.length;
  const primaryQuery=`${QUERIES[queryTemplate](input.lane)} ${NEGATIVE}`;
  const secondaryQuery=`${QUERIES[secondaryTemplate](input.lane)} ${NEGATIVE}`;
  const [primary,secondary]=await Promise.all([searchAll(primaryQuery,input),searchAll(secondaryQuery,input)]);
  const query=`${primaryQuery} || ${secondaryQuery}`;
  const attempts:ProviderAttempt[]=[...primary.attempts,...secondary.attempts];
  const merged:SearchItem[]=[];
  const seenUrls=new Set<string>();
  for(const item of [...primary.results,...secondary.results]) {
    if(seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);merged.push(item);
  }

  const errors:string[]=[];
  const candidates:Candidate[]=[];
  const domains=new Set<string>();
  for(const result of merged) {
    if(candidates.length>=input.maxCandidates) break;
    const domain=domainOf(result.url);
    if(!domain||domains.has(domain)) continue;
    domains.add(domain);
    const bundle=await fetchBundle(result,input);
    if(bundle.target.error&&(!bundle.home||bundle.home.error)) {
      errors.push(`${domain}:${bundle.target.error}`);
      candidates.push({slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate,searchProviders:[result.provider],title:result.title,url:result.url,domain,httpStatus:null,status:'FETCH_FAILED',score:0,supplierEvidence:'INCOMPLETE',productEvidence:'SUPPLIER_EVIDENCE_ONLY',fredPerryEvidence:false,prelovedEvidence:false,professionalEvidence:false,directPurchaseSignal:false,legalSignal:false,uniqueProductPathSignal:false,euEvidence:false,detectedCountryCode:null,knownDuplicate:false,priceSignal:null,availableProductSignals:0,evidence:[evidence(bundle.target,'TARGET')],checkedAt:new Date().toISOString()});
      continue;
    }
    if(bundle.target.status&&bundle.target.status>=400&&(!bundle.home||!bundle.home.status||bundle.home.status>=400)) errors.push(`${domain}:HTTP_${bundle.target.status}`);
    candidates.push(assess(input,query,queryTemplate,result,bundle));
  }

  if(!merged.length) errors.push('NO_RELEVANT_SEARCH_RESULTS');
  return {slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate,searchedAt,searchStatus:attempts.find(attempt=>attempt.status===200)?.status??attempts[0]?.status??null,candidates,errors,searchAttempts:attempts};
}
