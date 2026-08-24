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
const searchFile=path.join(root,'workflows','search.ts');
const policy=evaluate(policyFile,(id)=>{throw new Error(`Unexpected policy import: ${id}`);});
const search=evaluate(searchFile,(id)=>{if(id==='./policy')return policy;throw new Error(`Unexpected search import: ${id}`);});

const okAttempt={name:'bing-rss',status:200,bodyLength:100,linkCount:1,challenge:false,durationMs:10,error:null};
const fixtures=[
  [search.shouldFallbackSearch(okAttempt,1),false,'one relevant Bing result suppresses Yahoo'],
  [search.shouldFallbackSearch(okAttempt,0),true,'zero-result Bing triggers Yahoo'],
  [search.shouldFallbackSearch({...okAttempt,status:503},0),true,'HTTP failure triggers Yahoo'],
  [search.shouldFallbackSearch({...okAttempt,challenge:true},1),true,'challenge triggers Yahoo'],
  [search.shouldFallbackSearch({...okAttempt,error:'TimeoutError'},1),true,'transport error triggers Yahoo'],
  [search.relevant('Fred Perry vintage polo','https://shop.example/item'),true,'Fred Perry relevant'],
  [search.relevant('FRED economic data','https://fred.stlouisfed.org/series/X'),false,'Federal Reserve noise rejected'],
  [search.domainOf('https://www.Example.CZ/item'),'example.cz','domain normalization'],
  [search.canonical('https://Example.CZ/item?utm_source=x&ref=y&id=1#fragment'),'https://example.cz/item?id=1','tracking removal'],
  [policy.MARKETPLACES.some((item)=>'skroutz.gr'.includes(item)),true,'Skroutz marketplace policy'],
  [policy.NEW_RETAIL.includes('deblauwezebra.be'),true,'De Blauwe Zebra retail policy'],
];
for(const[actual,expected,label]of fixtures)assert(actual===expected,`Search regression failed for ${label}: expected ${expected}, got ${actual}`);
console.log(`search regression fixtures passed: ${fixtures.length}`);
