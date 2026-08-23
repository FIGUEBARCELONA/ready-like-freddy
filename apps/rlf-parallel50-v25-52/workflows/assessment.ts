import type {Candidate,DiscoverInput} from './types';
import type {SearchItem} from './search';
import type {Bundle} from './evidence';
import {domainOf} from './search';
import {evidence} from './evidence';
import {COUNTRY_NAMES,EU_TLDS,LEGAL,MARKETPLACES,NEW_RETAIL,NON_EU_TLDS,PRELOVED,PROFESSIONAL,PURCHASE,VAT_PREFIX_TO_COUNTRY} from './policy';
import {KNOWN_REJECTED_DOMAINS,KNOWN_SUPPLIER_DOMAINS} from '@/lib/known-suppliers';

function detectCountry(domain:string,pageText:string) {
  const parts=domain.split('.');
  const suffix=parts.slice(-2).join('.');
  const tld=parts.at(-1)??'';
  if(EU_TLDS.has(tld)) return tld.toUpperCase()==='GR'?'GR':tld.toUpperCase();
  const vat=pageText.match(/\b(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[A-Z0-9 .-]{6,16}\b/i);
  if(vat) return VAT_PREFIX_TO_COUNTRY[vat[1].toUpperCase()]??null;
  for(const [code,names] of Object.entries(COUNTRY_NAMES)) if(names.some(name=>pageText.includes(name))) return code;
  if(NON_EU_TLDS.has(suffix)||NON_EU_TLDS.has(tld)) return 'NON_EU';
  return null;
}

export function assess(input:DiscoverInput,query:string,queryTemplate:number,result:SearchItem,bundle:Bundle):Candidate {
  const url=bundle.target.url||result.url;
  const domain=domainOf(url);
  const pageText=`${bundle.target.text} ${bundle.home?.text??''} ${bundle.legal?.text??''} ${bundle.shopify?.text??''}`.toLowerCase();
  const joined=`${result.title} ${result.snippet} ${pageText}`.toLowerCase();
  const marketplace=MARKETPLACES.some(item=>domain.includes(item));
  const knownRejected=KNOWN_REJECTED_DOMAINS.has(domain);
  const knownDuplicate=KNOWN_SUPPLIER_DOMAINS.has(domain);
  const uk=domain.endsWith('.co.uk')||domain.endsWith('.uk')||/\b(united kingdom|england|scotland|wales|northern ireland)\b/i.test(pageText);
  const detectedCountryCode=detectCountry(domain,pageText);
  const nonEU=detectedCountryCode==='NON_EU';
  const euEvidence=Boolean(detectedCountryCode&&detectedCountryCode!=='NON_EU');
  const fred=/fred\s+perry/i.test(joined)||/fredperry/i.test(joined)||bundle.shopifyProducts.length>0;
  const preloved=PRELOVED.some(item=>joined.includes(item));
  const professionalHits=PROFESSIONAL.filter(item=>joined.includes(item)).length;
  const professional=professionalHits>=2||bundle.shopifyProducts.length>0;
  const availableProducts=bundle.shopifyProducts.filter(product=>product.available!==false).length;
  const direct=PURCHASE.some(item=>joined.includes(item))||availableProducts>0;
  const legal=LEGAL.some(item=>pageText.includes(item));
  let productPath=false;
  try {productPath=/\/(products?|items?|shop|store|collections?)\//i.test(new URL(url).pathname)||bundle.shopifyProducts.length>0;} catch {}
  const price=(joined.match(/(?:€|eur|ron|pln|czk|sek|dkk|huf)\s?\d{1,5}(?:[.,]\d{2})?|\d{1,5}(?:[.,]\d{2})?\s?(?:€|eur|ron|pln|czk|sek|dkk|huf)/i)||[])[0]||bundle.shopifyProducts.find(product=>product.price)?.price||null;
  const knownFirstHand=NEW_RETAIL.some(item=>domain.includes(item));
  const supplierReady=!marketplace&&!knownRejected&&!knownDuplicate&&!uk&&!nonEU&&!knownFirstHand&&fred&&preloved&&professional&&legal&&euEvidence;
  const productReady=supplierReady&&direct&&productPath&&Boolean(price)&&availableProducts>0;
  const score=(fred?30:0)+(preloved?20:0)+(professional?15:0)+(legal?12:0)+(euEvidence?10:0)+(direct?6:0)+(productPath?4:0)+(price?3:0)-(knownDuplicate?40:0);

  let status:Candidate['status']='EVIDENCE_INCOMPLETE';
  if(marketplace||knownRejected) status='REJECT_MARKETPLACE';
  else if(knownDuplicate) status='DUPLICATE_KNOWN';
  else if(uk) status='REJECT_UK';
  else if(nonEU) status='REJECT_NON_EU';
  else if(knownFirstHand) status='REJECT_NOT_PRELOVED';
  else if(supplierReady) status='QUALIFIED_PROVISIONAL';

  const records=[evidence(bundle.target,'TARGET')];
  if(bundle.home) records.push(evidence(bundle.home,'HOME'));
  if(bundle.legal) records.push(evidence(bundle.legal,'LEGAL'));
  if(bundle.shopify) records.push(evidence(bundle.shopify,'SHOPIFY_SEARCH'));

  return {
    slot:input.lane.slot,cycle:input.cycle,countryCode:input.lane.countryCode,country:input.lane.country,query,queryTemplate,
    searchProviders:[result.provider],title:result.title,url,domain,httpStatus:bundle.target.status,status,score,
    supplierEvidence:supplierReady?'READY_TO_REVIEW':knownDuplicate?'DUPLICATE':'INCOMPLETE',
    productEvidence:productReady?'DIRECT_PRODUCT_PROVISIONAL':'SUPPLIER_EVIDENCE_ONLY',
    fredPerryEvidence:fred,prelovedEvidence:preloved,professionalEvidence:professional,directPurchaseSignal:direct,legalSignal:legal,uniqueProductPathSignal:productPath,
    euEvidence,detectedCountryCode,knownDuplicate,priceSignal:price,availableProductSignals:availableProducts,evidence:records,checkedAt:new Date().toISOString(),
  };
}
