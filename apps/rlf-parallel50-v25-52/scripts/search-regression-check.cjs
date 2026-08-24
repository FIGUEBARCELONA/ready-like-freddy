const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const root=path.resolve(__dirname,'..');
function compile(file){
  return ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,importsNotUsedAsValues:ts.ImportsNotUsedAsValues.Remove},
    fileName:file,
  }).outputText;
}
function evaluate(file,requireFn){
  const module={exports:{}};
  const wrapper=`(function(exports,require,module,__filename,__dirname){${compile(file)}\n})`;
  const context={console,URL,Set,Map,RegExp,String,Object,Array,Boolean,Number,Math,Date,AbortSignal,fetch};
  const fn=vm.runInNewContext(wrapper,context);
  fn(module.exports,requireFn,module,file,path.dirname(file));
  return module.exports;
}
function assert(condition,message){if(!condition)throw new Error(message);}
const policyFile=path.join(root,'workflows','policy.ts');
const registryFile=path.join(root,'lib','known-suppliers.ts');
const searchFile=path.join(root,'workflows','search.ts');
const policy=evaluate(policyFile,(id)=>{throw new Error(`Unexpected policy import: ${id}`);});
const registry=evaluate(registryFile,(id)=>{throw new Error(`Unexpected registry import: ${id}`);});
const search=evaluate(searchFile,(id)=>{
  if(id==='./policy')return policy;
  if(id==='@/lib/known-suppliers')return registry;
  throw new Error(`Unexpected search import: ${id}`);
});

const input={cycle:15,maxCandidates:8,lane:{slot:'F06',countryCode:'CZ',country:'Czechia',language:'cs-CZ,cs;q=.9,en;q=.7',tld:'cz',localSecondhand:'použité oblečení',index:5}};
const recovery=search.contextualRecoveryQuery(input);
const fixtures=[
  [search.shouldRunContextualRecovery(0,0),true,'both primary paths empty trigger recovery'],
  [search.shouldRunContextualRecovery(1,0),false,'primary result suppresses recovery'],
  [search.shouldRunContextualRecovery(0,1),false,'identity result suppresses recovery'],
  [recovery.includes('Fred Perry'),true,'recovery keeps brand constraint'],
  [recovery.includes('.cz')||recovery.includes('Czechia'),true,'recovery keeps country constraint'],
  [search.eligibleSearchDomain('new-vintage-store.cz'),true,'new professional candidate remains eligible'],
  [search.eligibleSearchDomain('96casual.de'),false,'known supplier excluded before fetch'],
  [search.eligibleSearchDomain('toms-paderborn.de'),false,'known rejection excluded before fetch'],
  [search.eligibleSearchDomain('careofcarl.fi'),false,'new retail excluded before fetch'],
  [search.eligibleSearchDomain('skroutz.gr'),false,'marketplace excluded before fetch'],
  [search.relevant('Fred Perry vintage polo','https://shop.example/item'),true,'Fred Perry relevant'],
  [search.relevant('FRED economic data','https://fred.stlouisfed.org/series/X'),false,'Federal Reserve noise rejected'],
  [search.domainOf('https://www.Example.CZ/item'),'example.cz','domain normalization'],
  [search.canonical('https://Example.CZ/item?utm_source=x&ref=y&id=1#fragment'),'https://example.cz/item?id=1','tracking removal'],
];
for(const[actual,expected,label]of fixtures)assert(actual===expected,`Search regression failed for ${label}: expected ${expected}, got ${actual}`);
console.log(`search regression fixtures passed: ${fixtures.length}`);
