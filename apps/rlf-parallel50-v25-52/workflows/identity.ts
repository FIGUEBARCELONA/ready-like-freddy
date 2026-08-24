import {COUNTRY_NAMES,EU_TLDS,NON_EU_TLDS,VAT_PREFIX_TO_COUNTRY} from './policy';

export type CountryBasis='EU_TLD'|'NON_EU_TLD'|'VAT'|'LEGAL_COUNTRY'|'UK_LEGAL'|'NONE';
export type IdentityBasis='VAT'|'REGISTRATION'|'NAME_ADDRESS'|'NONE';
export type CountryDetection={code:string|null;basis:CountryBasis};
export type IdentityAnalysis={identityKey:string|null;identityBasis:IdentityBasis;vatId:string|null;registrationId:string|null;contractingName:string|null;addressSignal:string|null;strong:boolean};

type RegistrationMatch={keyPrefix:string;id:string;countryCode:string|null};

const LEGAL_FORM=/\b(gmbh|ug\b|gbr\b|s\.r\.l\.?|srl\b|s\.r\.o\.?|sp\. z o\.o\.|sas\b|sarl\b|e\.u\.|einzelunternehmer|aktiebolag|ltd\b|limited|societ[aà]|empresa|unternehmen|company|sole trader|proprietor|innehaber|owner|unipessoal|soc\. coop\.)\b/i;
const NAMED_OPERATOR=/\b(impressum|legal notice|mentions légales|aviso legal|terms of service|terms and conditions|contracting party|innehaber|owner|proprietor|unternehmen|company|titular|ragione sociale|denominazione)\b/i;
const ADDRESS=/\b(address|anschrift|adresse|sitz|registered office|return address|returadress|domicilio|sede|ul\.|straße|strasse|street|road|avenue|gade|gata|gatve|calle|carrer|via|rue|οδός|ул\.)\b/i;
const ADDRESS_MARKER=/\b(?:company address|business address|postal address|registered office|return address|head office|principal office|address|anschrift|adresse|sitz|returadress|domicilio|sede|ul\.|straße|strasse|street|road|avenue|gade|gata|gatve|calle|carrer|via|rue|οδός|ул\.)\s*:?\s*/gi;
const BAD_NAME_LINE=/\b(agreement|arbitrat|dispute|privacy|refund|cookie|terms of use|terms and conditions|bank|credit card|skip to content|shipping|delivery|free shipping|bestellwert|versandkostenfrei|collection|clothing)\b/i;
const UK_COMPANY_DECLARATION=/\b(?:company\s+registered\s+in\s+(?:england(?:\s+and\s+wales)?|scotland|northern\s+ireland)|registered\s+in\s+(?:england\s+and\s+wales|scotland|northern\s+ireland)|incorporated\s+in\s+(?:england(?:\s+and\s+wales)?|scotland|northern\s+ireland)|companies\s+house|registered\s+office\s+(?:is\s+)?in\s+the\s+united\s+kingdom)\b/i;
const UK_CONTEXTUAL_POSTCODE=/\b(?:registered office|company address|business address|head office|principal office)[^.;|]{0,180}\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i;
const compact=(value:string)=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const norm=(value:string)=>String(value||'').replace(/\s+/g,' ').trim();
const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

const VAT_PATTERNS:RegExp[]=[
  /\bAT[\s.-]*U(?:[\s.-]*\d){8}\b/i,/\bBE(?:[\s.-]*\d){10}\b/i,/\bBG(?:[\s.-]*\d){9,10}\b/i,
  /\bCY(?:[\s.-]*\d){8}[\s.-]*[A-Z]\b/i,/\bCZ(?:[\s.-]*\d){8,10}\b/i,/\bDE(?:[\s.-]*\d){9}\b/i,
  /\bDK(?:[\s.-]*\d){8}\b/i,/\bEE(?:[\s.-]*\d){9}\b/i,/\b(?:EL|GR)(?:[\s.-]*\d){9}\b/i,
  /\bES[\s.-]*[A-Z0-9](?:[\s.-]*\d){7}[\s.-]*[A-Z0-9]\b/i,/\bFI(?:[\s.-]*\d){8}\b/i,
  /\bFR(?:[\s.-]*[A-Z0-9]){2}(?:[\s.-]*\d){9}\b/i,/\bHR(?:[\s.-]*\d){11}\b/i,/\bHU(?:[\s.-]*\d){8}\b/i,
  /\bIE(?:[\s.-]*[A-Z0-9]){8,9}\b/i,/\bIT(?:[\s.-]*\d){11}\b/i,
  /\bLT(?:(?:[\s.-]*\d){9}|(?:[\s.-]*\d){12})\b/i,/\bLU(?:[\s.-]*\d){8}\b/i,/\bLV(?:[\s.-]*\d){11}\b/i,
  /\bMT(?:[\s.-]*\d){8}\b/i,/\bNL(?:[\s.-]*\d){9}[\s.-]*B(?:[\s.-]*\d){2}\b/i,/\bPL(?:[\s.-]*\d){10}\b/i,
  /\bPT(?:[\s.-]*\d){9}\b/i,/\bRO(?:[\s.-]*\d){2,10}\b/i,/\bSE(?:[\s.-]*\d){12}\b/i,
  /\bSI(?:[\s.-]*\d){8}\b/i,/\bSK(?:[\s.-]*\d){10}\b/i,
];

function validEuVat(id:string):boolean {
  return /^(?:ATU\d{8}|BE\d{10}|BG\d{9,10}|CY\d{8}[A-Z]|CZ\d{8,10}|DE\d{9}|DK\d{8}|EE\d{9}|(?:EL|GR)\d{9}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-Z0-9]{2}\d{9}|HR\d{11}|HU\d{8}|IE(?=[A-Z0-9]{8,9}$)(?=(?:.*\d){5})[A-Z0-9]{8,9}|IT\d{11}|LT(?:\d{9}|\d{12})|LU\d{8}|LV\d{11}|MT\d{8}|NL\d{9}B\d{2}|PL\d{10}|PT\d{9}|RO\d{2,10}|SE\d{12}|SI\d{8}|SK\d{10})$/.test(id);
}
function vatCountry(id:string):string|null {const prefix=id.slice(0,2);return VAT_PREFIX_TO_COUNTRY[prefix]??(prefix==='EL'||prefix==='GR'?'GR':null);}
function findEuVat(text:string):string|null {for(const pattern of VAT_PATTERNS){const match=text.match(pattern);if(!match)continue;const id=compact(match[0]);if(validEuVat(id))return id;}return null;}
function validRegistration(id:string,minDigits:number,maxLength=20):boolean {const digits=(id.match(/\d/g)?.length??0);return id.length>=5&&id.length<=maxLength&&digits>=minDigits&&!/^(?:0+|1+)$/.test(id)&&!/VATNUMBER|TAXNUMBER|COMPANYNUMBER|REGISTRATIONNUMBER/.test(id);}

function registration(text:string,country:CountryDetection):RegistrationMatch|null {
  const patterns:Array<{keyPrefix:string;countryCode:string;regex:RegExp;minDigits:number}>=[
    {keyPrefix:'PL-NIP',countryCode:'PL',regex:/\bNIP\s*[:#]?\s*([0-9][0-9 -]{8,13}[0-9])/i,minDigits:10},
    {keyPrefix:'FR-SIRET',countryCode:'FR',regex:/\bSIRET\s*[:#]?\s*(\d{14})\b/i,minDigits:14},
    {keyPrefix:'FR-SIREN',countryCode:'FR',regex:/\bSIREN\s*[:#]?\s*(\d{9})\b/i,minDigits:9},
    {keyPrefix:'CZ-ICO',countryCode:'CZ',regex:/\bIČO\s*[:#]?\s*(\d{6,10})\b/i,minDigits:6},
    {keyPrefix:'DK-CVR',countryCode:'DK',regex:/\bCVR(?:\s*(?:NR\.?|NUMBER|NUMMER))?\s*[:#]?\s*(\d{8})\b/i,minDigits:8},
    {keyPrefix:'RO-CUI',countryCode:'RO',regex:/\bCUI\s*[:#]?\s*(?:RO)?\s*(\d{2,10})\b/i,minDigits:2},
    {keyPrefix:'IT-PIVA',countryCode:'IT',regex:/\b(?:P\.?\s*IVA|PARTITA IVA)\s*[:#]?\s*(?:IT)?\s*(\d{11})\b/i,minDigits:11},
    {keyPrefix:'NL-KVK',countryCode:'NL',regex:/\bKVK\s*[:#]?\s*(\d{8})\b/i,minDigits:8},
    {keyPrefix:'SE-ORG',countryCode:'SE',regex:/\b(?:ORG\.?\s*NR|ORGANISATIONSNUMMER)\s*[:#]?\s*([0-9][0-9 -]{7,13})\b/i,minDigits:8},
    {keyPrefix:'DE-REG',countryCode:'DE',regex:/\b(?:HRB|HRA|VR|PR|GNR)\s*[:#]?\s*([0-9][0-9 A-Z/-]{1,15})\b/i,minDigits:2},
  ];
  for(const item of patterns){const match=text.match(item.regex);if(!match?.[1])continue;const id=compact(match[1]);if(validRegistration(id,item.minDigits))return{keyPrefix:item.keyPrefix,id,countryCode:item.countryCode};}
  if(country.code==='IE'){
    const cro=text.match(/\b(?:COMPANY\s+(?:REGISTRATION\s+)?NUMBER|CRO\s+NUMBER)\s*[:#]?\s*(\d{5,8})\b/i);
    if(cro?.[1]){const id=compact(cro[1]);if(validRegistration(id,5,8))return{keyPrefix:'IE-CRO',id,countryCode:'IE'};}
  }
  if(country.code==='PT'||country.code==='ES'){
    const nif=text.match(/\b(?:NIF|CIF)\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{6,10}[A-Z0-9])\b/i);
    if(nif?.[1]){const id=compact(nif[1]);if(validRegistration(id,7,12))return{keyPrefix:country.code==='PT'?'PT-NIF':'ES-NIF',id,countryCode:country.code};}
  }
  return null;
}

function countryFromAddressContext(text:string):string|null {
  const normalized=norm(text);ADDRESS_MARKER.lastIndex=0;
  for(const match of normalized.matchAll(ADDRESS_MARKER)) {
    const start=(match.index??0)+match[0].length;
    const remainder=normalized.slice(start,start+280);
    const chunk=remainder.split(/[.;|]/,1)[0];
    let best:{code:string;index:number}|null=null;
    for(const[code,names]of Object.entries(COUNTRY_NAMES))for(const name of names){const found=chunk.search(new RegExp(`\\b${escaped(name)}\\b`,'i'));if(found>=0&&(!best||found<best.index))best={code,index:found};}
    if(best)return best.code;
  }
  return null;
}

export function detectCountry(domain:string,legalText:string):CountryDetection {
  const parts=domain.toLowerCase().split('.');const suffix=parts.slice(-2).join('.');const tld=parts.at(-1)??'';const euTld=EU_TLDS.has(tld);
  if(NON_EU_TLDS.has(suffix)||NON_EU_TLDS.has(tld))return{code:'NON_EU',basis:'NON_EU_TLD'};
  if(UK_COMPANY_DECLARATION.test(legalText))return{code:'NON_EU',basis:'UK_LEGAL'};
  if(!euTld&&UK_CONTEXTUAL_POSTCODE.test(legalText))return{code:'NON_EU',basis:'UK_LEGAL'};
  if(euTld)return{code:tld.toUpperCase(),basis:'EU_TLD'};
  const vat=findEuVat(legalText);if(vat)return{code:vatCountry(vat),basis:'VAT'};
  const local=registration(legalText,{code:null,basis:'NONE'});if(local?.countryCode)return{code:local.countryCode,basis:'LEGAL_COUNTRY'};
  const contextualCountry=countryFromAddressContext(legalText);if(contextualCountry)return{code:contextualCountry,basis:'LEGAL_COUNTRY'};
  return{code:null,basis:'NONE'};
}

function contractingName(text:string){const lines=norm(text).split(/(?<=[.;|])\s+/).filter(Boolean);const line=lines.find(item=>LEGAL_FORM.test(item)&&!BAD_NAME_LINE.test(item)&&item.length>=5&&item.length<=180);return line?.slice(0,180)??null;}
function address(text:string){const normalized=norm(text);const match=normalized.match(/(?:address|anschrift|adresse|sitz|registered office|return address|returadress|domicilio|sede|ul\.|straße|strasse|street|road|avenue|gade|gata|gatve|calle|carrer|via|rue)\s*:?\s*([^.;|]{8,180}\d[^.;|]{0,100})/i);return match?.[1]?.slice(0,220)??null;}

export function analyzeIdentity(domain:string,legalText:string,country:CountryDetection):IdentityAnalysis {
  const text=norm(legalText);const rawVat=country.code==='NON_EU'?null:findEuVat(text);const euVat=rawVat&&(!country.code||country.basis==='VAT'||vatCountry(rawVat)===country.code)?rawVat:null;
  const rawLocal=country.code==='NON_EU'?null:registration(text,country);const local=rawLocal&&(!country.code||rawLocal.countryCode===country.code)?rawLocal:null;
  const name=contractingName(text);const addr=address(text);let identityKey:string|null=null;let basis:IdentityBasis='NONE';
  if(local){identityKey=`${local.keyPrefix}:${local.id}`;basis='REGISTRATION';}else if(euVat){identityKey=`EU-VAT:${euVat}`;basis='VAT';}
  const named=NAMED_OPERATOR.test(text)||Boolean(name);const hasAddress=Boolean(addr)||(ADDRESS.test(text)&&/\b\d{1,5}\b/.test(text));
  const strong=text.length>=120&&named&&hasAddress&&(basis==='VAT'||basis==='REGISTRATION');
  return{identityKey,identityBasis:basis,vatId:basis==='VAT'?euVat:null,registrationId:basis==='REGISTRATION'?local?.id??null:null,contractingName:name,addressSignal:addr,strong};
}
