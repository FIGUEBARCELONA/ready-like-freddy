import type {Candidate,DiscoverInput} from './types';
import type {SearchItem} from './search';
import type {Bundle} from './evidence';
import {domainOf} from './search';
import {evidence} from './evidence';
import {LEGAL,MARKETPLACES,NEW_RETAIL,PRELOVED,PROFESSIONAL,PURCHASE,UK_OPERATORS} from './policy';
import {analyzeIdentity,detectCountry} from './identity';
import {KNOWN_IDENTITY_KEYS,KNOWN_IDENTITY_QUARANTINE_DOMAINS,KNOWN_REJECTED_DOMAINS,KNOWN_SUPPLIER_ALIAS_DOMAINS,KNOWN_SUPPLIER_DOMAINS,STAGED_SUPPLIER_DOMAINS} from '@/lib/known-suppliers';

export function assess(input:DiscoverInput,query:string,queryTemplate:number,identityQueryTemplate:number,result:SearchItem,bundle:Bundle):Candidate {
  const url=bundle.target.url||result.url;
  const domain=domainOf(url);
  const targetText=bundle.target.text.toLowerCase();
  const homeText=(bundle.home?.text??'').toLowerCase();
  const legalText=(bundle.legal?.text??'').toLowerCase();
  const shopifyText=(bundle.shopify?.text??'').toLowerCase();
  const pageText=`${targetText} ${homeText} ${legalText} ${shopifyText}`;
  const joined=`${result.title} ${result.snippet} ${pageText}`.toLowerCase();
  const marketplace=MARKETPLACES.some(item=>domain.includes(item));
  const knownRejected=KNOWN_REJECTED_DOMAINS.has(domain);
  const knownDuplicateDomain=KNOWN_SUPPLIER_DOMAINS.has(domain)||KNOWN_SUPPLIER_ALIAS_DOMAINS.has(domain)||STAGED_SUPPLIER_DOMAINS.has(domain);
  const identityQuarantine=KNOWN_IDENTITY_QUARANTINE_DOMAINS.has(domain);
  const explicitUK=/\b(united kingdom|england|scotland|wales|northern ireland|company registered in england|companies house)\b/i.test(legalText);
  const contextualUKPostcode=/\b(?:registered office|return address|business address|postal address|based in|located in)[^.;|]{0,180}\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(legalText);
  const uk=UK_OPERATORS.includes(domain)||domain.endsWith('.co.uk')||domain.endsWith('.uk')||explicitUK||contextualUKPostcode;
  const country=detectCountry(domain,legalText);
  const detectedCountryCode=uk?'NON_EU':country.code;
  const nonEU=detectedCountryCode==='NON_EU';
  const euEvidence=Boolean(detectedCountryCode&&detectedCountryCode!=='NON_EU'&&country.basis!=='NONE');
  const identity=analyzeIdentity(domain,legalText,country);
  const knownDuplicateIdentity=Boolean(identity.identityKey&&KNOWN_IDENTITY_KEYS.has(identity.identityKey));
  const fred=/fred\s+perry/i.test(joined)||/fredperry/i.test(joined)||bundle.shopifyProducts.length>0;
  const preloved=PRELOVED.some(item=>joined.includes(item));
  const professionalHits=PROFESSIONAL.filter(item=>joined.includes(item)).length;
  const availableProducts=bundle.shopifyProducts.filter(product=>product.available!==false).length;
  const commerceSignal=PURCHASE.some(item=>joined.includes(item))||availableProducts>0||/\b(cart|basket|checkout|shipping|returns?)\b/i.test(joined);
  const professional=professionalHits>=2&&commerceSignal;
  const direct=PURCHASE.some(item=>joined.includes(item))||availableProducts>0;
  const legalSignal=LEGAL.some(item=>legalText.includes(item));
  const legalHealthy=bundle.legal?.status===200&&legalSignal&&identity.strong;
  const sourceHealthy=bundle.target.status===200||availableProducts>0;
  let productPath=false;
  try {productPath=/\/(products?|items?|shop|store|collections?)\//i.test(new URL(url).pathname)||bundle.shopifyProducts.length>0;} catch {}
  const price=(joined.match(/(?:€|eur|ron|pln|czk|sek|dkk|huf|bgn)\s?\d{1,5}(?:[.,]\d{2})?|\d{1,5}(?:[.,]\d{2})?\s?(?:€|eur|ron|pln|czk|sek|dkk|huf|bgn|лв)/i)||[])[0]||bundle.shopifyProducts.find(product=>product.price)?.price||null;
  const knownFirstHand=NEW_RETAIL.some(item=>domain.includes(item));
  const knownDuplicate=knownDuplicateDomain||knownDuplicateIdentity;
  const supplierReady=sourceHealthy&&legalHealthy&&!marketplace&&!knownRejected&&!knownDuplicate&&!identityQuarantine&&!uk&&!nonEU&&!knownFirstHand&&fred&&preloved&&professional&&euEvidence;
  const productReady=supplierReady&&direct&&productPath&&Boolean(price)&&availableProducts>0;
  const score=(fred?30:0)+(preloved?20:0)+(professional?15:0)+(legalHealthy?20:0)+(euEvidence?10:0)+(sourceHealthy?5:0)+(direct?6:0)+(productPath?4:0)+(price?3:0)-(knownDuplicate?45:0)-(identityQuarantine?20:0);
  let status:Candidate['status']='EVIDENCE_INCOMPLETE';
  let duplicateBasis:Candidate['duplicateBasis']='NONE';
  if(marketplace) status='REJECT_MARKETPLACE';
  else if(knownDuplicateDomain){status='DUPLICATE_KNOWN';duplicateBasis='DOMAIN';}
  else if(knownDuplicateIdentity){status='DUPLICATE_KNOWN';duplicateBasis='IDENTITY_REGISTRY';}
  else if(uk) status='REJECT_UK';
  else if(nonEU) status='REJECT_NON_EU';
  else if(knownRejected||knownFirstHand) status='REJECT_NOT_PRELOVED';
  else if(identityQuarantine) status='QUARANTINE_IDENTITY';
  else if(supplierReady) status='QUALIFIED_PROVISIONAL';
  const records=[evidence(bundle.target,'TARGET')];
  if(bundle.home) records.push(evidence(bundle.home,'HOME'));
  if(bundle.legal) records.push(evidence(bundle.legal,'LEGAL'));
  if(bundle.shopify) records.push(evidence(bundle.shopify,'SHOPIFY_SEARCH'));
  return {slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate,identityQueryTemplate,searchProviders:[result.provider],title:result.title,url,domain,httpStatus:bundle.target.status,status,score,supplierEvidence:supplierReady?'READY_TO_REVIEW':knownDuplicate?'DUPLICATE':identityQuarantine?'IDENTITY_QUARANTINE':'INCOMPLETE',productEvidence:productReady?'DIRECT_PRODUCT_PROVISIONAL':'SUPPLIER_EVIDENCE_ONLY',fredPerryEvidence:fred,prelovedEvidence:preloved,professionalEvidence:professional,directPurchaseSignal:direct,legalSignal:legalHealthy,uniqueProductPathSignal:productPath,euEvidence,detectedCountryCode,countryBasis:country.basis,laneCountryMatch:detectedCountryCode===input.lane.countryCode,knownDuplicate,identityQuarantine,duplicateBasis,identityKey:identity.identityKey,identityBasis:identity.identityBasis,vatId:identity.vatId,registrationId:identity.registrationId,contractingName:identity.contractingName,addressSignal:identity.addressSignal,priceSignal:price,availableProductSignals:availableProducts,evidence:records,checkedAt:new Date().toISOString()};
}
