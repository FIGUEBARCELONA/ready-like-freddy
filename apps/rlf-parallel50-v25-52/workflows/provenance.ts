const COMPOUND_SUFFIXES=new Set(['co.uk','org.uk','gov.uk','com.au','com.br','com.pl','com.pt','com.ro','com.hr','co.nl','com.mt']);

function parsed(value:string):URL|null {
  try {return new URL(/^https?:\/\//i.test(value)?value:`https://${value}`);} catch {return null;}
}

function host(value:string):string|null {
  const url=parsed(value);return url?url.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,''):null;
}

export function registrableDomain(value:string):string|null {
  const hostname=host(value);if(!hostname)return null;
  const labels=hostname.split('.').filter(Boolean);if(labels.length<2)return hostname;
  const suffix=labels.slice(-2).join('.');
  return COMPOUND_SUFFIXES.has(suffix)&&labels.length>=3?labels.slice(-3).join('.'):suffix;
}

export function sameRegistrableDomain(left:string,right:string):boolean {
  const a=registrableDomain(left);const b=registrableDomain(right);return Boolean(a&&b&&a===b);
}

export function legalContentTypeAllowed(contentType:string|null):boolean {
  if(!contentType)return false;
  const value=contentType.toLowerCase().split(';',1)[0].trim();
  return value==='text/html'||value==='application/xhtml+xml'||value==='text/plain';
}

export function strongLegalPath(value:string):boolean {
  const url=parsed(value);if(!url)return false;
  const path=decodeURIComponent(url.pathname).toLowerCase().replace(/[_\s]+/g,'-');
  return /(?:^|\/)(?:pages\/|policies\/)?(?:impressum|anbieterkennzeichnung|legal(?:-notice)?|mentions-legales|aviso-legal|terms(?:-and-conditions|-of-service)?|conditions-generales(?:-de-vente)?|regulamin|firmenbuch|algemene-voorwaarden|note-legali|termini-e-condizioni|termos-e-condicoes|termeni-si-conditii|obchodni-podminky|obchodne-podmienky|uvjeti-poslovanja|kopvillkor|handelsbetingelser|toimitusehdot|splosni-pogoji|muugitingimused|oroi-xrisis|obshti-usloviya)(?:[\/.?#-]|$)/i.test(path);
}

export function contactLikePath(value:string):boolean {
  const url=parsed(value);if(!url)return false;
  const path=decodeURIComponent(url.pathname).toLowerCase().replace(/[_\s]+/g,'-');
  return /(?:^|\/)(?:pages\/)?(?:contact|contact-us|contactos|contatti|kontakt|kontakti|kontaktai|kapcsolat|yhteystiedot|epikoinonia)(?:[\/.?#-]|$)/i.test(path);
}

export function legalResourceEligible(candidateUrl:string,finalUrl:string,operatorUrl:string,contentType:string|null):boolean {
  return sameRegistrableDomain(candidateUrl,operatorUrl)&&sameRegistrableDomain(finalUrl,operatorUrl)&&legalContentTypeAllowed(contentType);
}
