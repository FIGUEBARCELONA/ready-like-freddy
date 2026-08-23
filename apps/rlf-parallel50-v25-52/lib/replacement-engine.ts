export const REPLACEMENT_POLICY={
  version:'1.0.0',
  sourcePool:'ACCEPTED_4K_ONLY',
  liveTarget:1000,
  reserveTarget:100,
  stockTtlHours:24,
  minimumDiscountPct:70,
  minimumNetProfitEur:25,
  maximumPriceVsComparableRatio:0.90,
  minimumQc:9,
  minimumEvidenceCompletenessPct:100,
  maximumSameSupplierShare:0.08,
} as const;

export type ReplacementCandidate={
  productId:string;
  supplierId:string;
  status:'ACCEPTED_4K'|'LIVE'|'RESERVE'|'BLOCKED'|'SOLD'|'ORIGIN_MISSING';
  category:string;
  modelFamily:string|null;
  styleCode:string|null;
  size:string|null;
  colourFamily:string|null;
  eraBucket:string|null;
  conditionScore:number;
  qcScore:number;
  evidenceCompletenessPct:number;
  discountPct:number;
  netProfitEur:number;
  rlfPriceEur:number;
  cheapestComparableEur:number;
  stockAvailable:boolean;
  stockCheckedAt:string;
  supplierRiskScore:number;
};

export type ReplacementTarget=Pick<ReplacementCandidate,'productId'|'supplierId'|'category'|'modelFamily'|'styleCode'|'size'|'colourFamily'|'eraBucket'|'conditionScore'|'rlfPriceEur'>;
export type ReplacementDecision={candidate:ReplacementCandidate;score:number;reasons:string[]};

const normal=(value:string|null)=>String(value??'').trim().toLowerCase();
const hoursSince=(iso:string,now:number)=>Math.max(0,(now-Date.parse(iso))/3_600_000);

export function commercialGate(candidate:ReplacementCandidate,now=Date.now()) {
  const failures:string[]=[];
  if(candidate.status!=='ACCEPTED_4K'&&candidate.status!=='RESERVE') failures.push('NOT_ACCEPTED_4K_OR_RESERVE');
  if(!candidate.stockAvailable) failures.push('OUT_OF_STOCK');
  if(!Number.isFinite(Date.parse(candidate.stockCheckedAt))||hoursSince(candidate.stockCheckedAt,now)>REPLACEMENT_POLICY.stockTtlHours) failures.push('STALE_STOCK');
  if(candidate.discountPct<REPLACEMENT_POLICY.minimumDiscountPct) failures.push('DISCOUNT_LT_70');
  if(candidate.netProfitEur<REPLACEMENT_POLICY.minimumNetProfitEur) failures.push('NET_PROFIT_LT_25');
  if(candidate.qcScore<REPLACEMENT_POLICY.minimumQc) failures.push('QC_LT_9');
  if(candidate.evidenceCompletenessPct<REPLACEMENT_POLICY.minimumEvidenceCompletenessPct) failures.push('EVIDENCE_INCOMPLETE');
  if(candidate.cheapestComparableEur<=0||candidate.rlfPriceEur>candidate.cheapestComparableEur*REPLACEMENT_POLICY.maximumPriceVsComparableRatio) failures.push('PRICE_NOT_10PCT_BELOW_COMPARABLE');
  return {eligible:failures.length===0,failures};
}

export function scoreReplacement(target:ReplacementTarget,candidate:ReplacementCandidate,now=Date.now()):ReplacementDecision|null {
  const gate=commercialGate(candidate,now);
  if(!gate.eligible||candidate.productId===target.productId) return null;
  const reasons:string[]=[];
  let score=0;
  if(normal(candidate.styleCode)&&normal(candidate.styleCode)===normal(target.styleCode)) {score+=32;reasons.push('SAME_STYLE_CODE');}
  if(normal(candidate.modelFamily)&&normal(candidate.modelFamily)===normal(target.modelFamily)) {score+=22;reasons.push('SAME_MODEL_FAMILY');}
  if(normal(candidate.category)===normal(target.category)) {score+=18;reasons.push('SAME_CATEGORY');} else return null;
  if(normal(candidate.size)&&normal(candidate.size)===normal(target.size)) {score+=10;reasons.push('SAME_SIZE');}
  if(normal(candidate.colourFamily)&&normal(candidate.colourFamily)===normal(target.colourFamily)) {score+=6;reasons.push('SAME_COLOUR_FAMILY');}
  if(normal(candidate.eraBucket)&&normal(candidate.eraBucket)===normal(target.eraBucket)) {score+=4;reasons.push('SAME_ERA');}
  const conditionDelta=Math.abs(candidate.conditionScore-target.conditionScore);
  score+=Math.max(0,5-conditionDelta);
  const priceDelta=Math.abs(candidate.rlfPriceEur-target.rlfPriceEur)/Math.max(1,target.rlfPriceEur);
  score+=Math.max(0,5-Math.round(priceDelta*10));
  score+=Math.min(5,Math.max(0,(candidate.netProfitEur-25)/15));
  score+=Math.min(4,Math.max(0,(candidate.discountPct-70)/7.5));
  score-=Math.min(8,Math.max(0,candidate.supplierRiskScore));
  if(candidate.supplierId!==target.supplierId) {score+=3;reasons.push('SUPPLIER_DIVERSIFICATION');}
  score+=Math.max(0,3-hoursSince(candidate.stockCheckedAt,now)/8);
  return {candidate,score:Number(score.toFixed(3)),reasons};
}

export function rankReplacements(target:ReplacementTarget,candidates:ReplacementCandidate[],limit=20,now=Date.now()) {
  return candidates
    .map(candidate=>scoreReplacement(target,candidate,now))
    .filter((row):row is ReplacementDecision=>Boolean(row))
    .sort((a,b)=>b.score-a.score||b.candidate.qcScore-a.candidate.qcScore||b.candidate.netProfitEur-a.candidate.netProfitEur||a.candidate.productId.localeCompare(b.candidate.productId))
    .slice(0,Math.max(0,limit));
}

export function selectReservePool(candidates:ReplacementCandidate[],limit=REPLACEMENT_POLICY.reserveTarget,now=Date.now()) {
  const eligible=candidates.filter(candidate=>commercialGate(candidate,now).eligible);
  const supplierCap=Math.max(1,Math.floor(limit*REPLACEMENT_POLICY.maximumSameSupplierShare));
  const supplierCount=new Map<string,number>();
  const categoryCount=new Map<string,number>();
  const sorted=[...eligible].sort((a,b)=>
    b.qcScore-a.qcScore||b.netProfitEur-a.netProfitEur||b.discountPct-a.discountPct||a.productId.localeCompare(b.productId)
  );
  const selected:ReplacementCandidate[]=[];
  for(const candidate of sorted) {
    if(selected.length>=limit) break;
    const supplierUsed=supplierCount.get(candidate.supplierId)??0;
    if(supplierUsed>=supplierCap) continue;
    const category=normal(candidate.category);
    const categoryUsed=categoryCount.get(category)??0;
    const categorySoftCap=Math.max(2,Math.ceil(limit*0.20));
    if(categoryUsed>=categorySoftCap&&selected.length<Math.floor(limit*0.8)) continue;
    selected.push({...candidate,status:'RESERVE'});
    supplierCount.set(candidate.supplierId,supplierUsed+1);
    categoryCount.set(category,categoryUsed+1);
  }
  return selected;
}
