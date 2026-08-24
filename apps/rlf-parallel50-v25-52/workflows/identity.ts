import {COUNTRY_NAMES,EU_TLDS,NON_EU_TLDS,VAT_PREFIX_TO_COUNTRY} from './policy';

export type CountryBasis='EU_TLD'|'NON_EU_TLD'|'VAT'|'LEGAL_COUNTRY'|'UK_LEGAL'|'NONE';
export type IdentityBasis='VAT'|'REGISTRATION'|'NAME_ADDRESS'|'NONE';
export type CountryDetection={code:string|null;basis:CountryBasis};
export type IdentityAnalysis={identityKey:string|null;identityBasis:IdentityBasis;vatId:string|null;registrationId:string|null;contractingName:string|null;addressSignal:string|null;strong:boolean};

const LEGAL_FORM=/\b(gmbh|ug\b|gbr\b|s\.r\.l\.?|srl\b|s\.r\.o\.?|sp\. z o\.o\.|sas\b|sarl\b|e\.u\.|einzelunternehmer|aktiebolag|\bab\b|ltd\b|limited|societ[aà]|empresa|unternehmen|company|sole trader|proprietor|innehaber|owner|unipessoal|soc\. coop\.)\b/i;
const NAMED_OPERATOR=/\b(impressum|legal notice|mentions légales|aviso legal|terms of service|terms and conditions|contracting party|innehaber|owner|proprietor|unternehmen|company|titular|ragione sociale|denominazione)\b/i;
const ADDRESS=/\b(address|anschrift|adresse|sitz|registered office|return address|returadress|domicilio|sede|ul\.|straße|strasse|street|road|avenue|gade|gata|gatve|calle|carrer|via|rue|οδός|ул\.)\b/i;
const compact=(value:string)=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const norm=(value:string)=>String(value||'').replace(/\s+/g,' ').trim();

export function detectCountry(domain:string,legalText:string):CountryDetection {
  const parts=domain.toLowerCase().split('.');
  const suffix=parts.slice(-2).join('.');
  const tld=parts.at(-1)??'';
  if(EU_TLDS.has(tld)) return {code:tld.toUpperCase(),basis:'EU_TLD'};
  if(NON_EU_TLDS.has(suffix)||NON_EU_TLDS.has(tld)) return {code:'NON_EU',basis:'NON_EU_TLD'};
  if(/\b(united kingdom|england|scotland|wales|northern ireland|company registered in england|companies house)\b/i.test(legalText)||/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i.test(legalText)) return {code:'NON_EU',basis:'UK_LEGAL'};
  const vat=legalText.match(/\b(ATU\d{8}|BE0?\d{9}|BG\d{9,10}|CY\d{8}[A-Z]|CZ\d{8,10}|DE\d{9}|DK\d{8}|EE\d{9}|EL\d{9}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-Z0-9]{2}\d{9}|HR\d{11}|HU\d{8}|IE[A-Z0-9]{8,9}|IT\d{11}|LT\d{9,12}|LU\d{8}|LV\d{11}|MT\d{8}|NL[A-Z0-9]{12}|PL\d{10}|PT\d{9}|RO\d{2,10}|SE\d{12}|SI\d{8}|SK\d{10})\b/i);
  if(vat) {const id=compact(vat[1]);const prefix=id.slice(0,2);return {code:VAT_PREFIX_TO_COUNTRY[prefix]??(prefix==='EL'?'GR':null),basis:'VAT'};}
  if(LEGAL_FORM.test(legalText)&&ADDRESS.test(legalText)) {
    for(const [code,names] of Object.entries(COUNTRY_NAMES)) if(names.some(name=>new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(legalText))) return {code,basis:'LEGAL_COUNTRY'};
  }
  return {code:null,basis:'NONE'};
}

function first(text:string,patterns:RegExp[]) {for(const pattern of patterns){const match=text.match(pattern);if(match?.[1]) return compact(match[1]);}return null;}
function contractingName(text:string) {const lines=norm(text).split(/(?<=[.;|])\s+/).filter(Boolean);const line=lines.find(item=>LEGAL_FORM.test(item)&&item.length>=5&&item.length<=220);return line?.slice(0,180)??null;}
function address(text:string) {const normalized=norm(text);const match=normalized.match(/(?:address|anschrift|adresse|sitz|registered office|return address|returadress|domicilio|sede|ul\.|straße|strasse|street|road|avenue|gade|gata|gatve|calle|carrer|via|rue)\s*:?\s*([^.;|]{8,180}\d[^.;|]{0,100})/i);return match?.[1]?.slice(0,220)??null;}

export function analyzeIdentity(domain:string,legalText:string,country:CountryDetection):IdentityAnalysis {
  const text=norm(legalText);
  const euVat=first(text,[/\b((?:ATU|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[\s.-]?[A-Z0-9][A-Z0-9 .-]{5,15})\b/i]);
  const local=first(text,[/\bNIP\s*[:#]?\s*([0-9 -]{10,14})/i,/\bSIRET\s*[:#]?\s*(\d{14})/i,/\bSIREN\s*[:#]?\s*(\d{9})/i,/\bIČO\s*[:#]?\s*(\d{6,10})/i,/\bCUI\s*[:#]?\s*(?:RO)?\s*(\d{2,10})/i,/\b(?:P\.?\s*IVA|PARTITA IVA)\s*[:#]?\s*(?:IT)?\s*(\d{11})/i,/\b(?:NIF|CIF)\s*[:#]?\s*([A-Z0-9 -]{8,12})/i,/\bKVK\s*[:#]?\s*(\d{8})/i,/\b(?:ORG\.?\s*NR|ORGANISATIONSNUMMER)\s*[:#]?\s*([A-Z0-9 -]{8,14})/i,/\b(?:COMPANY|REGISTRATION)\s+NUMBER\s*[:#]?\s*([A-Z0-9 -]{5,20})/i,/\b(?:HRB|HRA|REA)\s*[:#]?\s*([A-Z0-9 -]{3,20})/i]);
  const name=contractingName(text);const addr=address(text);
  let identityKey:string|null=null;let basis:IdentityBasis='NONE';
  if(euVat){identityKey=`EU-VAT:${euVat}`;basis='VAT';}
  else if(local){identityKey=`${country.code??'EU'}-REG:${local}`;basis='REGISTRATION';}
  else if(name&&addr){const key=compact(`${name}|${addr}`).slice(0,96);identityKey=key?`NAME-ADDRESS:${key}`:null;basis=identityKey?'NAME_ADDRESS':'NONE';}
  const generic=/\.(com|net|org|shop|store)$|myshopify\.com$/i.test(domain);
  const named=NAMED_OPERATOR.test(text)||Boolean(name);
  const hasAddress=Boolean(addr)||(ADDRESS.test(text)&&/\b\d{1,5}\b/.test(text));
  const strong=text.length>=120&&named&&hasAddress&&(basis==='VAT'||basis==='REGISTRATION'||(!generic&&basis==='NAME_ADDRESS'&&country.code!==null&&country.code!=='NON_EU'));
  return {identityKey,identityBasis:basis,vatId:euVat,registrationId:euVat?null:local,contractingName:name,addressSignal:addr,strong};
}
