import {sleep} from 'workflow';
import {LANES} from '@/lib/lanes';
import {discoverLaneCycle} from './discovery';
import type {CampaignInput,SweepInput,CampaignResult,Candidate,LaneCycleResult,ProviderStats} from './types';

function candidateKey(candidate:Candidate){return `${candidate.domain}|${candidate.url.replace(/\/$/,'')}`;}
function collapseIdentityDuplicates(input:Candidate[]){
  const sorted=[...input].sort((a,b)=>b.score-a.score||a.domain.localeCompare(b.domain));
  const owners=new Map<string,Candidate>();
  return sorted.map(candidate=>{
    if(!candidate.identityKey||candidate.status==='DUPLICATE_KNOWN'||candidate.status==='QUARANTINE_IDENTITY') return candidate;
    const owner=owners.get(candidate.identityKey);
    if(!owner){owners.set(candidate.identityKey,candidate);return candidate;}
    if(owner.domain===candidate.domain) return candidate;
    return {...candidate,status:'DUPLICATE_IDENTITY_IN_SWEEP' as const,supplierEvidence:'DUPLICATE' as const,knownDuplicate:true,duplicateBasis:'IDENTITY_IN_SWEEP' as const,score:candidate.score-45};
  });
}
function finalize(campaignId:string,startedAt:string,completedAt:string,cycles:number,results:LaneCycleResult[]):CampaignResult {
  const map=new Map<string,Candidate>();const providerStats:ProviderStats={};
  for(const candidate of results.flatMap(result=>result.candidates)){const key=candidateKey(candidate);const previous=map.get(key);if(!previous||candidate.score>previous.score) map.set(key,candidate);}
  for(const result of results) for(const attempt of result.searchAttempts){const row=providerStats[attempt.name]??={attempts:0,http200:0,relevantLinks:0,challenges:0,errors:0,durationMs:0};row.attempts+=1;row.http200+=attempt.status===200?1:0;row.relevantLinks+=attempt.linkCount;row.challenges+=attempt.challenge?1:0;row.errors+=attempt.error?1:0;row.durationMs+=attempt.durationMs;}
  const candidates=collapseIdentityDuplicates([...map.values()]).sort((a,b)=>b.score-a.score||a.domain.localeCompare(b.domain));
  const count=(status:Candidate['status'])=>candidates.filter(candidate=>candidate.status===status).length;
  return {campaignId,startedAt,completedAt,parallelism:50,cycles,laneExecutions:results.length,rawCandidates:results.reduce((total,result)=>total+result.candidates.length,0),uniqueCandidates:candidates.length,uniqueDomains:new Set(candidates.map(candidate=>candidate.domain)).size,uniqueIdentityKeys:new Set(candidates.map(candidate=>candidate.identityKey).filter(Boolean)).size,qualifiedProvisional:count('QUALIFIED_PROVISIONAL'),duplicateKnown:count('DUPLICATE_KNOWN'),duplicateIdentityInSweep:count('DUPLICATE_IDENTITY_IN_SWEEP'),quarantinedIdentity:count('QUARANTINE_IDENTITY'),directProductProvisional:candidates.filter(candidate=>candidate.productEvidence==='DIRECT_PRODUCT_PROVISIONAL').length,evidenceIncomplete:count('EVIDENCE_INCOMPLETE'),rejectedMarketplaces:count('REJECT_MARKETPLACE'),rejectedNotPreloved:count('REJECT_NOT_PRELOVED'),rejectedUK:count('REJECT_UK'),rejectedNonEU:count('REJECT_NON_EU'),fetchFailed:count('FETCH_FAILED'),searchErrors:results.reduce((total,result)=>total+result.errors.length,0),zeroResultLanes:results.filter(result=>result.candidates.length===0).length,evidenceRecords:candidates.reduce((total,candidate)=>total+candidate.evidence.length,0),providerStats,candidates};
}
async function timestampStep(){'use step';return new Date().toISOString();}
export async function parallel50Sweep(input:SweepInput):Promise<CampaignResult>{'use workflow';const startedAt=await timestampStep();const results=await Promise.all(LANES.map(lane=>discoverLaneCycle({lane,cycle:input.cycle,maxCandidates:input.maxCandidatesPerLaneCycle})));return finalize(input.campaignId,startedAt,await timestampStep(),1,results);}
export async function parallel50Campaign(input:CampaignInput):Promise<CampaignResult>{'use workflow';const startedAt=await timestampStep();const allResults:LaneCycleResult[]=[];for(let cycle=0;cycle<input.cycles;cycle+=1){allResults.push(...await Promise.all(LANES.map(lane=>discoverLaneCycle({lane,cycle,maxCandidates:input.maxCandidatesPerLaneCycle}))));if(cycle<input.cycles-1) await sleep(input.intervalMs);}return finalize(input.campaignId,startedAt,await timestampStep(),input.cycles,allResults);}
