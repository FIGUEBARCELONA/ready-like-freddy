import { DASHBOARD_HTML } from './dashboard.js';

const EU27 = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE']);
const STATUS_VALUES = new Set(['verified','not_verified','blocked','needs_more_evidence']);
const SECONDHAND_RE = /second[ -]?hand|pre[- ]?loved|vintage|used clothing|thrift|friperie|moda usada|ropa de segunda mano|seconde main|gebraucht|sekáč|kirppis|käytetty|vêtements d'occasion/i;
const COMMERCE_RE = /add to cart|ajouter au panier|añadir al carrito|warenkorb|koszyk|košík|cart|checkout|basket|comprar|buy now|shop now/i;
const LEGAL_RE = /impressum|mentions légales|legal notice|terms and conditions|conditions générales|obchodní podmínky|agb|privacy policy|vat|nif|siret|krs|company number/i;
const FP_RE = /fred\s+perry/i;

function now(){return new Date().toISOString()}
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}})}
function text(value,status=200,type='text/plain; charset=utf-8'){return new Response(value,{status,headers:{'content-type':type,'cache-control':'no-store'}})}
function normalizeDomain(input){try{return new URL(input).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}}
function laneFor(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (Math.abs(h)%50)+1}
async function sha256(value){const data=new TextEncoder().encode(value);const hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function stripHtml(html){return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function titleFrom(html){const m=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);return m?stripHtml(m[1]).slice(0,300):''}
function indicators(body){return {secondhand:SECONDHAND_RE.test(body),commerce:COMMERCE_RE.test(body),legal:LEGAL_RE.test(body),fred_perry:FP_RE.test(body)}}
function checkRobots(body,userAgent){const lines=body.split(/\r?\n/);let applies=false;let blocked=false;for(const raw of lines){const line=raw.split('#')[0].trim();if(!line)continue;const idx=line.indexOf(':');if(idx<0)continue;const key=line.slice(0,idx).trim().toLowerCase();const val=line.slice(idx+1).trim();if(key==='user-agent')applies=val==='*'||userAgent.toLowerCase().includes(val.toLowerCase());else if(applies&&key==='disallow'&&val==='/')blocked=true}return !blocked}
async function fetchWithTimeout(url,init,ms){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),ms);try{return await fetch(url,{...init,signal:controller.signal,redirect:'follow'})}finally{clearTimeout(timer)}}
async function setting(env,key,fallback=null){const row=await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();return row?.value??fallback}
async function setSetting(env,key,value){await env.DB.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,String(value),now()).run()}
async function log(env,level,eventType,message,metadata={}){await env.DB.prepare('INSERT INTO activity(level,event_type,message,metadata_json,created_at) VALUES(?,?,?,?,?)').bind(level,eventType,message,JSON.stringify(metadata),now()).run()}

async function identity(request,env,ctx){
  if(ctx?.access){const user=await ctx.access.getIdentity();const email=user?.email?.toLowerCase();if(email&&(!env.ADMIN_EMAIL||env.ADMIN_EMAIL==='REPLACE_WITH_YOUR_EMAIL'||email===env.ADMIN_EMAIL.toLowerCase()))return {email,method:'cloudflare_access'}}
  const auth=request.headers.get('authorization')||'';
  if(env.ADMIN_TOKEN&&auth===`Bearer ${env.ADMIN_TOKEN}`)return {email:null,method:'bearer_token'};
  if(env.ALLOW_UNAUTHENTICATED_DEV==='true'&&new URL(request.url).hostname==='localhost')return {email:'dev@localhost',method:'local_dev'};
  return null;
}
async function requireIdentity(request,env,ctx){const id=await identity(request,env,ctx);if(!id)throw Object.assign(new Error('Accés no autoritzat. Activa Cloudflare Access o configura ADMIN_TOKEN.'),{status:401});return id}

async function statusPayload(env,id){
  const [supplierRows,queueRows,evidenceRow,decisionRow,lanes,activity,jobs,systemMode,canonicalBatch]=await Promise.all([
    env.DB.prepare('SELECT status,COUNT(*) n FROM suppliers GROUP BY status').all(),
    env.DB.prepare('SELECT status,COUNT(*) n FROM queue_jobs GROUP BY status').all(),
    env.DB.prepare('SELECT COUNT(*) n FROM evidence').first(),
    env.DB.prepare('SELECT COUNT(*) n FROM decisions').first(),
    env.DB.prepare('SELECT * FROM worker_lanes ORDER BY lane').all(),
    env.DB.prepare('SELECT activity_id,level,event_type,message,created_at FROM activity ORDER BY activity_id DESC LIMIT 80').all(),
    env.DB.prepare("SELECT job_id,supplier_id,lane,status,domain,country_code,attempts,updated_at FROM queue_jobs WHERE status IN ('queued','enqueued','active','retry','manual_review','failed') ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'manual_review' THEN 1 ELSE 2 END, priority DESC, rank ASC LIMIT 150").all(),
    setting(env,'system_mode','paused'),setting(env,'canonical_batch','10')
  ]);
  const suppliers=Object.fromEntries(supplierRows.results.map(r=>[r.status,Number(r.n)]));
  const queue=Object.fromEntries(queueRows.results.map(r=>[r.status,Number(r.n)]));
  const verified=suppliers.verified||0;const target=Number(env.TARGET_VERIFIED||10000);
  return {schema_version:1,identity:id,system:{mode:systemMode,canonical_batch:canonicalBatch,target_verified:target,kb_records:0,fail_closed:true},counts:{verified,not_verified:suppliers.not_verified||0,blocked:suppliers.blocked||0,remaining:Math.max(0,target-verified),evidence:Number(evidenceRow?.n||0),decisions:Number(decisionRow?.n||0)},queue:{queued:queue.queued||0,enqueued:queue.enqueued||0,active:queue.active||0,retry:queue.retry||0,manual_review:queue.manual_review||0,failed:queue.failed||0},lanes:lanes.results,activity:activity.results,jobs:jobs.results};
}

async function enqueueTopup(env,limit=50){
  const mode=await setting(env,'system_mode','paused');if(mode!=='running')return {enqueued:0,reason:'system_paused'};
  const rows=await env.DB.prepare("SELECT job_id,supplier_id,lane,website_url,domain,country_code,attempts FROM queue_jobs WHERE status IN ('queued','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY priority DESC,rank ASC LIMIT ?").bind(now(),Math.max(1,Math.min(50,limit))).all();
  if(!rows.results.length)return {enqueued:0,reason:'queue_empty'};
  const messages=rows.results.map(r=>({body:{jobId:r.job_id,supplierId:r.supplier_id,lane:r.lane,url:r.website_url,domain:r.domain,country:r.country_code,attempt:Number(r.attempts||0)}}));
  await env.VERIFY_QUEUE.sendBatch(messages);const ts=now();
  for(const r of rows.results){await env.DB.batch([
    env.DB.prepare("UPDATE queue_jobs SET status='enqueued',enqueued_at=?,updated_at=? WHERE job_id=? AND status IN ('queued','retry')").bind(ts,ts,r.job_id),
    env.DB.prepare("UPDATE worker_lanes SET status='enqueued',current_job_id=?,current_supplier_id=?,current_domain=?,heartbeat_at=?,last_message='Tasques enviada a Cloudflare Queue' WHERE lane=?").bind(r.job_id,r.supplier_id,r.domain,ts,r.lane)
  ])}
  await log(env,'info','queue_topup',`${rows.results.length} tasques enviades a la cua real`,{count:rows.results.length});return {enqueued:rows.results.length};
}

async function verifyMessage(env,message){
  const start=Date.now();const body=message.body||{};const {jobId,supplierId,lane,url,domain,country}=body;
  if(!jobId||!supplierId||!url||!lane)throw new Error('Missatge de cua incomplet');
  const ts=now();await env.DB.batch([
    env.DB.prepare("UPDATE queue_jobs SET status='active',started_at=?,attempts=attempts+1,updated_at=? WHERE job_id=?").bind(ts,ts,jobId),
    env.DB.prepare("UPDATE worker_lanes SET status='active',current_job_id=?,current_supplier_id=?,current_domain=?,heartbeat_at=?,last_message='Verificació HTTP real en curs' WHERE lane=?").bind(jobId,supplierId,domain||normalizeDomain(url),ts,lane)
  ]);
  try{
    const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error('Protocol no permès');if(country&&!EU27.has(String(country).toUpperCase()))throw new Error('País fora UE-27');
    const ua=env.USER_AGENT||'RLFProviderVerifier/1.0';const timeout=Number(env.FETCH_TIMEOUT_MS||12000);let robotsAllowed=true;let robotsStatus=null;
    try{const rr=await fetchWithTimeout(`${parsed.protocol}//${parsed.host}/robots.txt`,{headers:{'user-agent':ua,'accept':'text/plain'}},Math.min(timeout,6000));robotsStatus=rr.status;if(rr.ok)robotsAllowed=checkRobots((await rr.text()).slice(0,200000),ua)}catch{}
    if(!robotsAllowed)throw new Error('robots.txt prohibeix el rastreig');
    const response=await fetchWithTimeout(url,{headers:{'user-agent':ua,'accept':'text/html,application/xhtml+xml'}},timeout);const html=(await response.text()).slice(0,900000);const plain=stripHtml(html).slice(0,120000);const flags=indicators(plain);const hash=await sha256(`${response.status}\n${response.url}\n${html}`);const evidenceId=`ev-${hash.slice(0,32)}`;const observed=now();
    const payload={http_status:response.status,final_url:response.url,title:titleFrom(html),content_length:html.length,robots_status:robotsStatus,robots_allowed:robotsAllowed,indicators:flags,headers:{content_type:response.headers.get('content-type'),last_modified:response.headers.get('last-modified')}};
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO evidence(evidence_id,supplier_id,job_id,evidence_type,source_url,http_status,final_url,content_hash,observed_at,excerpt,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(evidenceId,supplierId,jobId,'live_http_snapshot',url,response.status,response.url,hash,observed,plain.slice(0,1400),JSON.stringify(payload)),
      env.DB.prepare("INSERT INTO manual_reviews(supplier_id,job_id,status,reason,gate_summary_json,created_at,updated_at) VALUES(?,?,'pending',?,?,?,?) ON CONFLICT(supplier_id,job_id) DO UPDATE SET status='pending',reason=excluded.reason,gate_summary_json=excluded.gate_summary_json,updated_at=excluded.updated_at").bind(supplierId,jobId,'Evidència primària recollida; promoció automàtica prohibida',JSON.stringify(flags),observed,observed),
      env.DB.prepare("UPDATE queue_jobs SET status='manual_review',finished_at=?,last_error=NULL,updated_at=? WHERE job_id=?").bind(observed,observed,jobId),
      env.DB.prepare("UPDATE worker_lanes SET status='review',heartbeat_at=?,processed=processed+1,reviews=reviews+1,last_duration_ms=?,last_message='Evidència recollida; pendent revisió humana' WHERE lane=?").bind(observed,Date.now()-start,lane)
    ]);
    await log(env,'info','verification_complete',`F${String(lane).padStart(2,'0')} ha recollit evidència real de ${domain||normalizeDomain(url)}`,{job_id:jobId,supplier_id:supplierId,evidence_id:evidenceId,flags,http_status:response.status});message.ack();
  }catch(error){const msg=error instanceof Error?error.message:String(error);const attempts=Number(body.attempt||0)+1;const terminal=attempts>=3;const t=now();await env.DB.batch([
    env.DB.prepare('UPDATE queue_jobs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE job_id=?').bind(terminal?'failed':'retry',msg,terminal?null:new Date(Date.now()+120000).toISOString(),t,jobId),
    env.DB.prepare("UPDATE worker_lanes SET status='error',heartbeat_at=?,errors=errors+1,last_duration_ms=?,last_message=? WHERE lane=?").bind(t,Date.now()-start,msg.slice(0,300),lane)
  ]);await log(env,'error','verification_error',`F${String(lane).padStart(2,'0')}: ${msg}`,{job_id:jobId,supplier_id:supplierId,terminal});if(terminal)message.ack();else message.retry({delaySeconds:120})}
}

async function reviewDecision(request,env,id,jobId){
  const body=await request.json();const decision=body.decision;if(!STATUS_VALUES.has(decision))return json({error:'Decisió invàlida'},400);
  const job=await env.DB.prepare('SELECT * FROM queue_jobs WHERE job_id=?').bind(jobId).first();if(!job)return json({error:'Job inexistent'},404);
  const previous=await env.DB.prepare('SELECT decision_id FROM decisions WHERE supplier_id=? ORDER BY decided_at DESC LIMIT 1').bind(job.supplier_id).first();const decisionId=`decision-${crypto.randomUUID()}`;const decided=now();const supplierStatus=decision==='needs_more_evidence'?'not_verified':decision;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO decisions(decision_id,supplier_id,job_id,decision,reason_codes_json,actor_email,actor_type,evidence_refs_json,previous_decision_id,decided_at,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(decisionId,job.supplier_id,jobId,decision,JSON.stringify(body.reason_codes||[]),id.email,'human',JSON.stringify(body.evidence_refs||[]),previous?.decision_id||null,decided,JSON.stringify(body)),
    env.DB.prepare('UPDATE suppliers SET status=?,latest_decision_id=?,updated_at=? WHERE supplier_id=?').bind(supplierStatus,decisionId,decided,job.supplier_id),
    env.DB.prepare('UPDATE manual_reviews SET status=?,reason=?,updated_at=? WHERE job_id=?').bind(decision==='verified'?'approved':decision==='not_verified'?'rejected':decision,body.reason||null,decided,jobId),
    env.DB.prepare('UPDATE queue_jobs SET status=?,finished_at=?,updated_at=? WHERE job_id=?').bind(decision==='needs_more_evidence'?'retry':'completed',decided,decided,jobId),
    env.DB.prepare("UPDATE worker_lanes SET status='idle',current_job_id=NULL,current_supplier_id=NULL,current_domain=NULL,heartbeat_at=?,last_message=? WHERE lane=?").bind(decided,`Revisió humana: ${decision}`,job.lane)
  ]);await log(env,'info','manual_decision',`${job.supplier_id}: ${decision}`,{job_id:jobId,decision_id:decisionId,actor:id.email});return json({ok:true,decision_id:decisionId});
}

async function route(request,env,ctx){
  const url=new URL(request.url);if(url.pathname==='/health')return json({ok:true,runtime:'cloudflare-worker',time:now()});const id=await requireIdentity(request,env,ctx);
  if(request.method==='GET'&&url.pathname==='/')return text(DASHBOARD_HTML,200,'text/html; charset=utf-8');
  if(request.method==='GET'&&url.pathname==='/api/status')return json(await statusPayload(env,id));
  if(request.method==='POST'&&url.pathname==='/api/system/resume'){await setSetting(env,'system_mode','running');await log(env,'info','system_resume','Motor activat',{actor:id.email});return json({ok:true,mode:'running'})}
  if(request.method==='POST'&&url.pathname==='/api/system/pause'){await setSetting(env,'system_mode','paused');await log(env,'warn','system_pause','Motor pausat',{actor:id.email});return json({ok:true,mode:'paused'})}
  if(request.method==='POST'&&url.pathname==='/api/queue/topup')return json(await enqueueTopup(env,50));
  const m=url.pathname.match(/^\/api\/reviews\/([^/]+)$/);if(request.method==='POST'&&m)return reviewDecision(request,env,id,decodeURIComponent(m[1]));return json({error:'Ruta inexistent'},404);
}

export default {
  async fetch(request,env,ctx){try{return await route(request,env,ctx)}catch(error){const status=error?.status||500;return json({error:status===500?'Internal error':error.message,message:error.message},status)}},
  async queue(batch,env){await Promise.all(batch.messages.map(message=>verifyMessage(env,message)))},
  async scheduled(controller,env,ctx){ctx.waitUntil((async()=>{const result=await enqueueTopup(env,50);await log(env,'info','cron_tick','Cron de 5 minuts executat',result)})())}
};

export { normalizeDomain, laneFor, indicators, checkRobots, stripHtml };
