import type {Lane} from '@/lib/lanes';

export type ProviderAttempt={
  name:string;
  status:number|null;
  bodyLength:number;
  linkCount:number;
  challenge:boolean;
  durationMs:number;
  error:string|null;
};

export type CandidateStatus='QUALIFIED_PROVISIONAL'|'EVIDENCE_INCOMPLETE'|'REJECT_MARKETPLACE'|'REJECT_UK'|'FETCH_FAILED';

export type Candidate={
  slot:string;
  cycle:number;
  countryCode:string;
  country:string;
  query:string;
  title:string;
  url:string;
  domain:string;
  httpStatus:number|null;
  status:CandidateStatus;
  score:number;
  supplierEvidence:'READY_TO_REVIEW'|'INCOMPLETE';
  productEvidence:'DIRECT_PRODUCT_PROVISIONAL'|'SUPPLIER_EVIDENCE_ONLY';
  fredPerryEvidence:boolean;
  prelovedEvidence:boolean;
  professionalEvidence:boolean;
  directPurchaseSignal:boolean;
  legalSignal:boolean;
  uniqueProductPathSignal:boolean;
  priceSignal:string|null;
  checkedAt:string;
};

export type LaneCycleResult={
  slot:string;
  cycle:number;
  countryCode:string;
  country:string;
  query:string;
  searchedAt:string;
  searchStatus:number|null;
  candidates:Candidate[];
  errors:string[];
  searchAttempts:ProviderAttempt[];
};

export type CampaignInput={campaignId:string;cycles:number;interval:string;maxCandidatesPerLaneCycle:number};
export type SweepInput={campaignId:string;cycle:number;maxCandidatesPerLaneCycle:number};
export type ProviderStats=Record<string,{attempts:number;http200:number;relevantLinks:number;challenges:number;errors:number;durationMs:number}>;

export type CampaignResult={
  campaignId:string;
  startedAt:string;
  completedAt:string;
  parallelism:50;
  cycles:number;
  laneExecutions:number;
  rawCandidates:number;
  uniqueCandidates:number;
  uniqueDomains:number;
  qualifiedProvisional:number;
  directProductProvisional:number;
  evidenceIncomplete:number;
  rejectedMarketplaces:number;
  rejectedUK:number;
  fetchFailed:number;
  searchErrors:number;
  zeroResultLanes:number;
  providerStats:ProviderStats;
  candidates:Candidate[];
};

export type DiscoverInput={lane:Lane;cycle:number;maxCandidates:number};
