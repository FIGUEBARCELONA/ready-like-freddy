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

export type EvidenceRecord={
  role:'TARGET'|'HOME'|'LEGAL'|'SHOPIFY_SEARCH';
  url:string;
  status:number|null;
  contentType:string|null;
  sha256:string|null;
  length:number;
};

export type CandidateStatus=
  |'QUALIFIED_PROVISIONAL'
  |'DUPLICATE_KNOWN'
  |'EVIDENCE_INCOMPLETE'
  |'REJECT_MARKETPLACE'
  |'REJECT_NOT_PRELOVED'
  |'REJECT_UK'
  |'REJECT_NON_EU'
  |'FETCH_FAILED';

export type Candidate={
  slot:string;
  cycle:number;
  countryCode:string;
  country:string;
  query:string;
  queryTemplate:number;
  searchProviders:string[];
  title:string;
  url:string;
  domain:string;
  httpStatus:number|null;
  status:CandidateStatus;
  score:number;
  supplierEvidence:'READY_TO_REVIEW'|'DUPLICATE'|'INCOMPLETE';
  productEvidence:'DIRECT_PRODUCT_PROVISIONAL'|'SUPPLIER_EVIDENCE_ONLY';
  fredPerryEvidence:boolean;
  prelovedEvidence:boolean;
  professionalEvidence:boolean;
  directPurchaseSignal:boolean;
  legalSignal:boolean;
  uniqueProductPathSignal:boolean;
  euEvidence:boolean;
  detectedCountryCode:string|null;
  knownDuplicate:boolean;
  priceSignal:string|null;
  availableProductSignals:number;
  evidence:EvidenceRecord[];
  checkedAt:string;
};

export type LaneCycleResult={
  slot:string;
  cycle:number;
  countryCode:string;
  country:string;
  query:string;
  queryTemplate:number;
  searchedAt:string;
  searchStatus:number|null;
  candidates:Candidate[];
  errors:string[];
  searchAttempts:ProviderAttempt[];
};

export type CampaignInput={campaignId:string;cycles:number;intervalMs:number;maxCandidatesPerLaneCycle:number};
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
  duplicateKnown:number;
  directProductProvisional:number;
  evidenceIncomplete:number;
  rejectedMarketplaces:number;
  rejectedNotPreloved:number;
  rejectedUK:number;
  rejectedNonEU:number;
  fetchFailed:number;
  searchErrors:number;
  zeroResultLanes:number;
  evidenceRecords:number;
  providerStats:ProviderStats;
  candidates:Candidate[];
};

export type DiscoverInput={lane:Lane;cycle:number;maxCandidates:number};
