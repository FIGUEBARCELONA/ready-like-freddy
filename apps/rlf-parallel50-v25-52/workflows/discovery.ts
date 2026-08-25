import type {DiscoverInput,LaneCycleResult,Candidate,ProviderAttempt} from './types';
import {CYCLE20_TARGETS} from '@/lib/cycle20-targets';
import {domainOf,overpassVariant,primaryCorpus,searchPrimary,searchSecondary,shouldRetryOverpass,type SearchItem} from './search';
import {verifyTargetedLane} from './targeted';
import {evidence,fetchBundle} from './evidence';
import {assess} from './assessment';

export async function discoverLaneCycle(input:DiscoverInput):Promise<LaneCycleResult> {
  'use step';
  if(input.cycle===20){
    const target=CYCLE20_TARGETS[input.lane.index];
    if(!target)throw new Error(`CYCLE20_TARGET_MISSING_${input.lane.index}`);
    return verifyTargetedLane({...input,target});
  }
  const searchedAt=new Date().toISOString();
  const primary=await searchPrimary(input);
  const attempts:ProviderAttempt[]=[...primary.attempts];
  const merged:SearchItem[]=[];const seenUrls=new Set<string>();
  const merge=(items:SearchItem[])=>{for(const item of items){if(seenUrls.has(item.url))continue;seenUrls.add(item.url);merged.push(item);}};
  merge(primary.results);
  const variant=overpassVariant(input);
  let query=`${primaryCorpus(input).toUpperCase()}:${input.lane.countryCode}:VARIANT_${variant}`;
  if(shouldRetryOverpass(primary.attempts[0])) {
    const secondary=await searchSecondary(input);
    attempts.push(...secondary.attempts);merge(secondary.results);
    query+=` || OVERPASS_RETRY:${input.lane.countryCode}:VARIANT_${variant}`;
  }
  const errors:string[]=[];const candidates:Candidate[]=[];const domains=new Set<string>();
  for(const result of merged) {
    if(candidates.length>=input.maxCandidates) break;
    const domain=domainOf(result.url);if(!domain||domains.has(domain)) continue;domains.add(domain);
    const bundle=await fetchBundle(result,input);
    if(bundle.target.error&&(!bundle.home||bundle.home.error)) {
      errors.push(`${domain}:${bundle.target.error}`);
      candidates.push({slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate:variant,identityQueryTemplate:-1,searchProviders:[result.provider],title:result.title,url:result.url,domain,httpStatus:null,status:'FETCH_FAILED',score:0,supplierEvidence:'INCOMPLETE',productEvidence:'SUPPLIER_EVIDENCE_ONLY',fredPerryEvidence:false,prelovedEvidence:false,professionalEvidence:false,directPurchaseSignal:false,legalSignal:false,uniqueProductPathSignal:false,euEvidence:false,detectedCountryCode:null,countryBasis:'NONE',laneCountryMatch:false,knownDuplicate:false,identityQuarantine:false,duplicateBasis:'NONE',identityKey:null,identityBasis:'NONE',vatId:null,registrationId:null,contractingName:null,addressSignal:null,priceSignal:null,availableProductSignals:0,evidence:[evidence(bundle.target,'TARGET')],checkedAt:new Date().toISOString()});
      continue;
    }
    if(bundle.target.status&&bundle.target.status>=400&&(!bundle.home||!bundle.home.status||bundle.home.status>=400)) errors.push(`${domain}:HTTP_${bundle.target.status}`);
    candidates.push(assess(input,query,variant,-1,result,bundle));
  }
  if(!merged.length) errors.push('NO_ELIGIBLE_OSM_WEBSITE_SEEDS');
  return {slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate:variant,identityQueryTemplate:-1,searchedAt,searchStatus:attempts.find(attempt=>attempt.status===200)?.status??attempts[0]?.status??null,candidates,errors,searchAttempts:attempts};
}
