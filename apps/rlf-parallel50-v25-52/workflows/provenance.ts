const COMPOUND_SUFFIXES=new Set(['co.uk','org.uk','gov.uk','com.au','com.br','com.pl','com.pt','com.ro','com.hr','co.nl']);

function host(value:string):string|null {
  try {
    const input=/^https?:\/\//i.test(value)?value:`https://${value}`;
    return new URL(input).hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  } catch {return null;}
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

export function legalResourceEligible(candidateUrl:string,finalUrl:string,operatorUrl:string,contentType:string|null):boolean {
  return sameRegistrableDomain(candidateUrl,operatorUrl)&&sameRegistrableDomain(finalUrl,operatorUrl)&&legalContentTypeAllowed(contentType);
}
