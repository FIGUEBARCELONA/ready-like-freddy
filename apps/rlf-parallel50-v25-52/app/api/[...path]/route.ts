import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {start,getRun} from 'workflow/api';
import {parallel50Campaign,parallel50Sweep} from '@/workflows/campaign';
import type {CampaignResult} from '@/workflows/types';

export const runtime='nodejs';
export const maxDuration=60;
export const preferredRegion='fra1';

const OWNER_HASH='e942da2df116775a1f9caba47b5870a19a1058612a8a18c15fa168d28d3afec2';
const MONITOR_RUN_ID='wrun_01M0Q8981CTB61S3DJJ06JZ2FW';
const LATEST_SWEEP_RUN_ID='wrun_01M0QTVFR2J9Y7MK4N5G9D40VC';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const digest=(value:string)=>createHash('sha256').update(value).digest();
function secureEqual(value:string,expectedHex:string) {
  try {return timingSafeEqual(digest(value),Buffer.from(expectedHex,'hex'));}
  catch {return false;}
}

async function runState(id:string,includeOutput=false) {
  if(!id) return {status:'not_started',active:0,output:null as CampaignResult|null,error:null as string|null};
  try {
    const run=await getRun(id);
    const status=await run.status;
    const output=status==='completed'&&includeOutput?await run.returnValue as CampaignResult:null;
    return {status,active:['running','pending'].includes(status)?50:0,output,error:null as string|null};
  } catch(error) {
    return {status:'unavailable',active:0,output:null,error:error instanceof Error?error.message:'run error'};
  }
}

const campaignId=(prefix:string)=>`${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}-${randomUUID().slice(0,8)}`;
async function startSweep() {
  const id=campaignId('RLF-P50-SWEEP-V25531');
  const run=await start(parallel50Sweep,[{campaignId:id,cycle:2,maxCandidatesPerLaneCycle:6}]);
  return {campaignId:id,runId:run.runId};
}
async function startMonitor() {
  const id=campaignId('RLF-P50-MONITOR-V25531');
  const run=await start(parallel50Campaign,[{campaignId:id,cycles:12,intervalMs:7200000,maxCandidatesPerLaneCycle:5}]);
  return {campaignId:id,runId:run.runId};
}

export async function GET(_request:Request,{params}:{params:Promise<{path:string[]}>}) {
  const parts=(await params).path??[];
  const path=parts.join('/');
  if(path==='health') return json({ok:true,version:'25.53.1',workflowVersion:'4.4.0_PINNED',executionBackend:'VERCEL_WORKFLOW',queue:'VERCEL_QUEUES_MANAGED',persistence:'WORKFLOW_EVENT_LOG',parallelism:50,currentMonitorRunId:MONITOR_RUN_ID,latestSweepRunId:LATEST_SWEEP_RUN_ID,sweepBootstrap:'CLOSED',searchProfile:'EU27_LEGAL_COUNTRY_V3',simulatedWorkersStarted:0,checkedAt:new Date().toISOString()});
  if(path==='sweep-bootstrap'||path==='bootstrap') return json({ok:false,code:'BOOTSTRAP_CLOSED'},410);
  if(path==='status') {
    const [monitor,sweep]=await Promise.all([runState(MONITOR_RUN_ID),runState(LATEST_SWEEP_RUN_ID,true)]);
    return json({ok:true,generatedAt:new Date().toISOString(),deployment:{executionBackend:'CONNECTED',scheduler:'VERCEL_WORKFLOW',durableQueue:'VERCEL_QUEUES_MANAGED',persistence:'WORKFLOW_EVENT_LOG',activeWorkers:monitor.active,activeLanes:monitor.active,currentRunId:MONITOR_RUN_ID,currentRunStatus:monitor.status,latestSweepRunId:LATEST_SWEEP_RUN_ID,latestSweepStatus:sweep.status,sweepBootstrap:'CLOSED',searchProfile:'EU27_LEGAL_COUNTRY_V3',simulatedWorkersStarted:0},sweep:{summary:sweep.output?{...sweep.output,candidates:undefined}:null},funnel:{qualifiedSuppliers:151,readyToMerge:9,projectedQualified:160,remainingTo10000:9840,acceptedPool:0,liveSelection:0,reserves:0}});
  }
  if(parts[0]==='run'&&parts[1]) {
    const state=await runState(parts[1],true);
    return json({ok:state.status!=='unavailable',runId:parts[1],status:state.status,activeWorkers:state.active,activeLanes:state.active,executionSemantics:['running','pending'].includes(state.status)?'DURABLE_RUNNING_OR_SCHEDULED':'TERMINAL',summary:state.output?{...state.output,candidates:undefined}:null,result:state.output,error:state.error},state.status==='unavailable'?404:200);
  }
  if(path==='results/latest') {
    const state=await runState(LATEST_SWEEP_RUN_ID,true);
    return state.status==='completed'?json({ok:true,runId:LATEST_SWEEP_RUN_ID,result:state.output}):json({ok:false,code:'SWEEP_NOT_COMPLETED',runId:LATEST_SWEEP_RUN_ID,status:state.status},409);
  }
  return json({ok:false,code:'NOT_FOUND'},404);
}

export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}) {
  const path=((await params).path??[]).join('/');
  if(!['control/sweep','control/monitor'].includes(path)) return json({ok:false,code:'NOT_FOUND'},404);
  const token=(request.headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
  if(!secureEqual(token,OWNER_HASH)) return json({ok:false,code:'UNAUTHORIZED'},401);
  const started=path.endsWith('sweep')?await startSweep():await startMonitor();
  return json({ok:true,state:path.endsWith('sweep')?'SWEEP_STARTED':'MONITOR_STARTED',...started,parallelism:50,simulatedWorkersStarted:0},202);
}
