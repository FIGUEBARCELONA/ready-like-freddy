const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const root=path.resolve(__dirname,'..');

function compile(file){
  const source=fs.readFileSync(file,'utf8');
  return ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,importsNotUsedAsValues:ts.ImportsNotUsedAsValues.Remove},
    fileName:file,
  }).outputText;
}
function evaluate(file,requireFn){
  const module={exports:{}};
  const code=compile(file);
  const wrapper=`(function(exports,require,module,__filename,__dirname){${code}\n})`;
  const fn=vm.runInNewContext(wrapper,{console,URL,Set,Map,RegExp,String,Object,Array,Boolean,Number,Math,Date});
  fn(module.exports,requireFn,module,file,path.dirname(file));
  return module.exports;
}
const policyFile=path.join(root,'workflows','policy.ts');
const identityFile=path.join(root,'workflows','identity.ts');
const policy=evaluate(policyFile,(id)=>{throw new Error(`Unexpected policy import: ${id}`);});
const identity=evaluate(identityFile,(id)=>{if(id==='./policy')return policy;throw new Error(`Unexpected identity import: ${id}`);});
function assert(condition,message){if(!condition)throw new Error(message);}
function analyze(domain,text){const country=identity.detectCountry(domain,text);return{country,result:identity.analyzeIdentity(domain,text,country)};}

const falseVatFixtures=[
  ['example.sk','skip to content privacy policy company address 12 main street'],
  ['example.sk','site not valid company address 12 main street'],
  ['example.sk','skip to main company address 12 main street'],
  ['example.pl','playsuits leggings company address 12 main street'],
  ['example.de','best company company address 12 main street'],
];
for(const[domain,text]of falseVatFixtures){const{result}=analyze(domain,text);assert(result.vatId===null,`False VAT accepted for ${domain}: ${result.vatId}`);assert(!result.identityKey?.startsWith('EU-VAT:'),`False EU VAT key accepted for ${domain}: ${result.identityKey}`);}

const validVatFixtures=[
  ['shop.mt','Company address 12 Main Street. VAT Reg No: MT 1724-3326','MT17243326'],
  ['shop.de','GmbH address 12 Hauptstraße. VAT: DE 123 456 789','DE123456789'],
  ['shop.pt','Empresa address Rua 12. VAT PT 198 687 974','PT198687974'],
  ['shop.fr','SAS address 12 rue Exemple. TVA FR 43 507 928 935','FR43507928935'],
  ['shop.nl','BV company address 12 Street. VAT NL 123456789 B 01','NL123456789B01'],
  ['shop.ie','Limited company address Dublin Ireland. VAT Number: IE9331506J','IE9331506J'],
];
for(const[domain,text,expected]of validVatFixtures){const{result}=analyze(domain,text);assert(result.vatId===expected,`Valid VAT missed for ${domain}: expected ${expected}, got ${result.vatId}`);assert(result.identityKey===`EU-VAT:${expected}`,`Wrong VAT key for ${domain}: ${result.identityKey}`);}

const registrationFixtures=[
  ['shop.pl','Company address ul. Testowa 12. NIP: 882-213-42-74','PL-NIP:8822134274'],
  ['shop.fr','SAS address 12 rue Exemple. SIRET: 50792893500109','FR-SIRET:50792893500109'],
  ['shop.cz','s.r.o. address Ulice 12. IČO: 14416042','CZ-ICO:14416042'],
  ['shop.ro','SRL address Strada 12. CUI: RO 41820792','RO-CUI:41820792'],
  ['shop.it','SRL address Via Roma 12. Partita IVA: 07431160485','IT-PIVA:07431160485'],
  ['vintagie.com','Company address Amsterdam Netherlands. KVK: 85882623','NL-KVK:85882623'],
  ['weighnpay.ie','Cliché Vintage Limited. Company address Unit 9 Ossory Court Dublin 3. Company number 599102 and our VAT number is IE9331506J.','IE-CRO:599102'],
];
for(const[domain,text,expected]of registrationFixtures){const{result}=analyze(domain,text);assert(result.identityKey===expected,`Registration key mismatch for ${domain}: expected ${expected}, got ${result.identityKey}`);}

const countryFixtures=[
  ['shop.com','Company registered in England. Registered office 76 Temperance St Manchester M12 6HU','NON_EU','UK_LEGAL'],
  ['shop.com','Business address 76 Temperance St Manchester M12 6HU','NON_EU','UK_LEGAL'],
  ['clochard92.com','Company address Dei Serragli 31R, Firenze FI, Italy. Vintage clothing store.','IT','LEGAL_COUNTRY'],
  ['shop.fr','SAS address 12 rue Exemple France. Company registered in England.','NON_EU','UK_LEGAL'],
  ['careofcarl.fi','Company terms. Shipping destinations include United Kingdom and Finland.','FI','EU_TLD'],
  ['vintagewholesalespain.com','Company address Calle Cementerio 19, Manises Valencia Spain. We ship to the United Kingdom.','ES','LEGAL_COUNTRY'],
  ['shop.de','GmbH address Berlin Germany. Returns accepted from England and Wales.','DE','EU_TLD'],
];
for(const[domain,text,expectedCode,expectedBasis]of countryFixtures){const{country}=analyze(domain,text);assert(country.code===expectedCode&&country.basis===expectedBasis,`Country mismatch for ${domain}: expected ${expectedCode}/${expectedBasis}, got ${country.code}/${country.basis}`);}

const residualFalseIdentityFixtures=[
  ['clochard92.com','Company address Dei Serragli 31R, Firenze FI, Italy. registration number lity in 2020 with th.','IT'],
  ['thrifted.com','Company address 12 Example Street. company number 11116145 VAT number.','NONE'],
  ['pappers.fr','Pappers SAS address 12 rue Exemple France. RO 888207859','FR'],
  ['joinfleek.com','Among other things this company agreement requires arbitration of disputes. Address 4612 San Francisco California 94114.','NONE'],
  ['vintager2.de','Ab einem Bestellwert von 90 Euro versenden wir versandkostenfrei. Sportswear und clothing shop. Adresse Berlin 12 Germany.','DE'],
  ['shop.es','Empresa address Calle Mayor 12 Spain. No VAT or registration identifier is published.','ES'],
];
for(const[domain,text,expectedCountry]of residualFalseIdentityFixtures){const{country,result}=analyze(domain,text);if(expectedCountry!=='NONE')assert(country.code===expectedCountry,`Residual fixture country mismatch for ${domain}: ${country.code}`);assert(result.identityKey===null,`Residual false identity accepted for ${domain}: ${result.identityKey}`);assert(result.vatId===null,`Residual false VAT accepted for ${domain}: ${result.vatId}`);assert(result.registrationId===null,`Residual false registration accepted for ${domain}: ${result.registrationId}`);}

const total=falseVatFixtures.length+validVatFixtures.length+registrationFixtures.length+countryFixtures.length+residualFalseIdentityFixtures.length;
console.log(`identity regression fixtures passed: ${total}`);
