import type {DiscoverInput,LaneCycleResult,Candidate,ProviderAttempt} from './types';
import {NEGATIVE,QUERIES} from './policy';
import {domainOf,searchAll,type SearchItem} from './search';
import {evidence,fetchBundle} from './evidence';
import {assess} from './assessment';

const LEGAL_TERMS:Record<string,[string,string]>={
  AT:['impressum','uid-nummer'],BE:['mentions légales','btw'],BG:['общи условия','еик'],HR:['uvjeti poslovanja','oib'],CY:['terms and conditions','vat'],CZ:['obchodní podmínky','ičo'],DK:['handelsbetingelser','cvr'],EE:['müügitingimused','registrikood'],FI:['toimitusehdot','y-tunnus'],FR:['mentions légales','siret'],DE:['impressum','ust-id'],GR:['όροι χρήσης','αφμ'],HU:['általános szerződési feltételek','adószám'],IE:['terms and conditions','company number'],IT:['termini e condizioni','partita iva'],LV:['noteikumi','reģistrācijas numurs'],LT:['taisyklės','įmonės kodas'],LU:['mentions légales','tva'],MT:['terms and conditions','vat'],NL:['algemene voorwaarden','kvk'],PL:['regulamin','nip'],PT:['termos e condições','nif'],RO:['termeni si conditii','cui'],SK:['obchodné podmienky','ičo'],SI:['splošni pogoji','matična številka'],ES:['aviso legal','nif'],SE:['köpvillkor','organisationsnummer'],
};
const identityQuery=(input:DiscoverInput,index:number)=>{
  const terms=LEGAL_TERMS[input.lane.countryCode]??['legal notice','vat'];
  const templates=[`site:.${input.lane.tld} "Fred Perry" "${terms[0]}"`,`site:.${input.lane.tld} "Fred Perry" "${terms[1]}"`,`site:.${input.lane.tld} "Fred Perry" ${input.lane.localSecondhand} "${terms[0]}"`,`"Fred Perry" ${input.lane.localSecondhand} "${terms[1]}" ${input.lane.country}`,`site:.${input.lane.tld} "Fred Perry" ("contact" OR "${terms[0]}") vintage`,`site:.${input.lane.tld} "Fred Perry" ("terms" OR "${terms[1]}") second hand`];
  return {index:index%templates.length,query:templates[index%templates.length]};
};

export async function discoverLaneCycle(input:DiscoverInput):Promise<LaneCycleResult> {
  'use step';
  const searchedAt=new Date().toISOString();
  const queryTemplate=(input.cycle+input.lane.index)%QUERIES.length;
  const identity=identityQuery(input,input.cycle*3+input.lane.index);
  const discoveryQuery=`${QUERIES[queryTemplate](input.lane)} ${NEGATIVE}`;
  const legalQuery=`${identity.query} ${NEGATIVE}`;
  const [primary,identitySearch]=await Promise.all([searchAll(discoveryQuery,input),searchAll(legalQuery,input)]);
  const query=`${discoveryQuery} || IDENTITY:${legalQuery}`;
  const attempts:ProviderAttempt[]=[...primary.attempts,...identitySearch.attempts];
  const merged:SearchItem[]=[];const seenUrls=new Set<string>();
  for(const item of [...identitySearch.results,...primary.results]) {if(seenUrls.has(item.url)) continue;seenUrls.add(item.url);merged.push(item);}
  const errors:string[]=[];const candidates:Candidate[]=[];const domains=new Set<string>();
  for(const result of merged) {
    if(candidates.length>=input.maxCandidates) break;
    const domain=domainOf(result.url);if(!domain||domains.has(domain)) continue;domains.add(domain);
    const bundle=await fetchBundle(result,input);
    if(bundle.target.error&&(!bundle.home||bundle.home.error)) {
      errors.push(`${domain}:${bundle.target.error}`);
      candidates.push({slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate,identityQueryTemplate:identity.index,searchProviders:[result.provider],title:result.title,url:result.url,domain,httpStatus:null,status:'FETCH_FAILED',score:0,supplierEvidence:'INCOMPLETE',productEvidence:'SUPPLIER_EVIDENCE_ONLY',fredPerryEvidence:false,prelovedEvidence:false,professionalEvidence:false,directPurchaseSignal:false,legalSignal:false,uniqueProductPathSignal:false,euEvidence:false,detectedCountryCode:null,countryBasis:'NONE',laneCountryMatch:false,knownDuplicate:false,duplicateBasis:'NONE',identityKey:null,identityBasis:'NONE',vatId:null,registrationId:null,contractingName:null,addressSignal:null,priceSignal:null,availableProductSignals:0,evidence:[evidence(bundle.target,'TARGET')],checkedAt:new Date().toISOString()});
      continue;
    }
    if(bundle.target.status&&bundle.target.status>=400&&(!bundle.home||!bundle.home.status||bundle.home.status>=400)) errors.push(`${domain}:HTTP_${bundle.target.status}`);
    candidates.push(assess(input,query,queryTemplate,identity.index,result,bundle));
  }
  if(!merged.length) errors.push('NO_RELEVANT_SEARCH_RESULTS');
  return {slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate,identityQueryTemplate:identity.index,searchedAt,searchStatus:attempts.find(attempt=>attempt.status===200)?.status??attempts[0]?.status??null,candidates,errors,searchAttempts:attempts};
}
