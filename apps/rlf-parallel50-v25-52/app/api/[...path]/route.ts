import {getRun} from 'workflow/api';
import {parallel50Campaign,parallel50Sweep} from '@/workflows/campaign';
import {providerSmoke} from '@/workflows/search';
import type {CampaignResult} from '@/workflows/types';
import {REPLACEMENT_POLICY} from '@/lib/replacement-engine';
import {CANONICAL_REGISTRY_COVERAGE,KNOWN_IDENTITY_QUARANTINE_DOMAINS} from '@/lib/known-suppliers';

export const runtime='nodejs';
export const maxDuration=60;
export const preferredRegion='fra1';
const MONITOR_RUN_ID='wrun_01M0Q8981CTB61S3DJJ06JZ2FW';
const LATEST_SWEEP_RUN_ID='wrun_01M0VNXGKMTSAG484467ET9PQY';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
void parallel50Sweep;void parallel50Campaign;
async function runState(id:string,includeOutput=false){if(!id)return{status:'not_started',active:0,output:null as CampaignResult|null,error:null as string|null};try{const run=await getRun(id);const status=await run.status;const output=status==='completed'&&includeOutput?await run.returnValue as CampaignResult:null;return{status,active:['running','pending'].includes(status)?50:0,output,error:null as string|null};}catch(error){return{status:'unavailable',active:0,output:null,error:error instanceof Error?error.message:'run error'};}}

export async function GET(request:Request,{params}:{params:Promise<{path:string[]}>}){
  const parts=(await params).path??[];const path=parts.join('/');void request;
  const base={version:'25.55.52',workflowVersion:'4.8.4_PINNED',searchProfile:'EU27_OSM_OVERPASS_BBOX_TILES_V22R2',delta:'0051',dedupRegistry:CANONICAL_REGISTRY_COVERAGE,identityQuarantineCount:KNOWN_IDENTITY_QUARANTINE_DOMAINS.size,dependencyAudit:{moderate:0,high:0,critical:0,total:0}};
  if(path==='health')return json({ok:true,...base,executionBackend:'VERCEL_WORKFLOW',queue:'VERCEL_QUEUES_MANAGED',persistence:'WORKFLOW_EVENT_LOG',parallelism:50,currentMonitorRunId:MONITOR_RUN_ID,latestSweepRunId:LATEST_SWEEP_RUN_ID,sweepBootstrap:'CLOSED',oneShotSweep:'CLOSED',replacementEngineVersion:REPLACEMENT_POLICY.version,replacementSourcePool:REPLACEMENT_POLICY.sourcePool,qaAcceptedNewSuppliers:0,simulatedWorkersStarted:0,checkedAt:new Date().toISOString()});
  if(path==='provider/smoke')return json({ok:true,...base,smoke:await providerSmoke()});
  if(path==='replacement/policy')return json({ok:true,policy:REPLACEMENT_POLICY,activationState:'FAIL_CLOSED_EMPTY_ACCEPTED_4K'});
  if(path==='sweep-bootstrap'||path==='bootstrap')return json({ok:false,code:'BOOTSTRAP_CLOSED'},410);
  if(path==='status'){
    const[monitor,sweep]=await Promise.all([runState(MONITOR_RUN_ID),runState(LATEST_SWEEP_RUN_ID,true)]);
    const activeWorkers=Math.max(monitor.active,sweep.active);
    const activeRunId=sweep.active?LATEST_SWEEP_RUN_ID:monitor.active?MONITOR_RUN_ID:null;
    const activeRunStatus=sweep.active?sweep.status:monitor.active?monitor.status:'idle';
    return json({ok:true,generatedAt:new Date().toISOString(),deployment:{...base,executionBackend:'CONNECTED',scheduler:'VERCEL_WORKFLOW',durableQueue:'VERCEL_QUEUES_MANAGED',persistence:'WORKFLOW_EVENT_LOG',activeWorkers,activeLanes:activeWorkers,currentRunId:activeRunId,currentRunStatus:activeRunStatus,monitorRunId:MONITOR_RUN_ID,monitorRunStatus:monitor.status,latestSweepRunId:LATEST_SWEEP_RUN_ID,latestSweepStatus:sweep.status,sweepBootstrap:'CLOSED',oneShotSweep:'CLOSED',replacementEngineVersion:REPLACEMENT_POLICY.version,qaAcceptedNewSuppliers:0,simulatedWorkersStarted:0},sweep:{summary:sweep.output?{...sweep.output,candidates:undefined}:null},funnel:{qualifiedSuppliers:154,readyToMerge:12,projectedQualified:166,remainingTo10000:9834,acceptedPool:0,liveSelection:0,reserves:0}});
  }
  if(parts[0]==='run'&&parts[1]){const state=await runState(parts[1],true);return json({ok:state.status!=='unavailable',runId:parts[1],status:state.status,activeWorkers:state.active,activeLanes:state.active,executionSemantics:['running','pending'].includes(state.status)?'DURABLE_RUNNING_OR_SCHEDULED':'TERMINAL',summary:state.output?{...state.output,candidates:undefined}:null,result:state.output,error:state.error},state.status==='unavailable'?404:200);}
  if(path==='results/latest'){
    const state=await runState(LATEST_SWEEP_RUN_ID,true);
    return state.status==='completed'?json({ok:true,runId:LATEST_SWEEP_RUN_ID,result:state.output}):json({ok:false,code:'SWEEP_NOT_COMPLETED',runId:LATEST_SWEEP_RUN_ID,status:state.status},409);
  }
  if(path==='results/latest/seeds'){
    const state=await runState(LATEST_SWEEP_RUN_ID,true);
    if(state.status!=='completed'||!state.output)return json({ok:false,code:'SWEEP_NOT_COMPLETED',runId:LATEST_SWEEP_RUN_ID,status:state.status},409);
    const seeds=state.output.candidates.map(candidate=>({
      domain:candidate.domain,title:candidate.title,url:candidate.url,lane:candidate.slot,laneCountryCode:candidate.countryCode,
      detectedCountryCode:candidate.detectedCountryCode,laneCountryMatch:candidate.laneCountryMatch,status:candidate.status,score:candidate.score,
      fredPerryEvidence:candidate.fredPerryEvidence,prelovedEvidence:candidate.prelovedEvidence,professionalEvidence:candidate.professionalEvidence,
      directPurchaseSignal:candidate.directPurchaseSignal,legalSignal:candidate.legalSignal,euEvidence:candidate.euEvidence,
      identityKey:candidate.identityKey,vatId:candidate.vatId,registrationId:candidate.registrationId,
    })).sort((a,b)=>b.score-a.score||a.domain.localeCompare(b.domain)||a.url.localeCompare(b.url));
    return json({ok:true,runId:LATEST_SWEEP_RUN_ID,count:seeds.length,uniqueDomains:new Set(seeds.map(seed=>seed.domain)).size,seeds});
  }
  return json({ok:false,code:'NOT_FOUND'},404);
}

export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}){
  const path=((await params).path??[]).join('/');void request;
  if(path==='control/sweep'||path==='control/monitor')return json({ok:false,code:'CONTROLLER_CLOSED'},410);
  return json({ok:false,code:'NOT_FOUND'},404);
}
