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
  const context={console,URL,URLSearchParams,Set,Map,RegExp,String,Object,Array,Boolean,Number,Math,Date,AbortSignal,fetch,decodeURIComponent,encodeURIComponent};
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

const baseLane={slot:'F06',countryCode:'CZ',country:'Czechia',language:'cs-CZ,cs;q=.9,en;q=.7',tld:'cz',localSecondhand:'použité oblečení',index:5};
const commonInput={cycle:17,maxCandidates:8,lane:baseLane};
const ddgInput={cycle:17,maxCandidates:8,lane:{...baseLane,slot:'F33',index:32}};
const primary=search.primaryCommerceQuery(commonInput);
const alternate=search.alternateCommerceQuery(commonInput);
const ccUrl=search.commonCrawlUrl(commonInput,48);
const unwrapped=search.unwrapDuckDuckGo('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.cz%2Fproducts%2Ffred-perry-polo%3Futm_source%3Dddg');

const fixtures=[
  [search.COMMON_CRAWL_INDEX,'CC-MAIN-2026-30','Common Crawl collection is pinned'],
  [search.primaryCorpus(commonInput),'commoncrawl-cdx','first EU-27 lane uses Common Crawl'],
  [search.primaryCorpus(ddgInput),'duckduckgo-html','duplicate-country lane uses DuckDuckGo'],
  [search.shouldRunFallbackSearch(0),true,'empty primary corpus triggers one Bing fallback'],
  [search.shouldRunFallbackSearch(1),false,'one primary result suppresses Bing fallback'],
  [ccUrl.includes('index.commoncrawl.org/CC-MAIN-2026-30-index'),true,'Common Crawl endpoint is pinned'],
  [decodeURIComponent(ccUrl).includes('*.cz'),true,'Common Crawl query keeps ccTLD boundary'],
  [decodeURIComponent(ccUrl).includes('matchType=domain'),true,'Common Crawl query uses domain match'],
  [decodeURIComponent(ccUrl).includes('status:200'),true,'Common Crawl query filters HTTP 200'],
  [decodeURIComponent(ccUrl).includes('mime:text/html'),true,'Common Crawl query filters HTML'],
  [decodeURIComponent(ccUrl).includes('fred[^/?#]{0,12}perry'),true,'Common Crawl query filters Fred Perry URL forms'],
  [decodeURIComponent(ccUrl).includes('limit=48'),true,'Common Crawl query is bounded'],
  [unwrapped,'https://example.cz/products/fred-perry-polo','DuckDuckGo redirect is unwrapped and tracking removed'],
  [primary.query.includes('Fred Perry'),true,'primary keeps brand constraint'],
  [primary.query.includes('.cz')||primary.query.includes('Czechia'),true,'primary keeps country constraint'],
  [alternate.query.includes('Fred Perry'),true,'fallback keeps brand constraint'],
  [alternate.query.includes('Czechia'),true,'fallback keeps country constraint'],
  [Number.isInteger(primary.index)&&primary.index>=0&&primary.index<8,true,'primary template index bounded'],
  [Number.isInteger(alternate.index)&&alternate.index>=0&&alternate.index<8,true,'fallback template index bounded'],
  [search.eligibleSearchDomain('new-vintage-store.cz'),true,'new professional candidate remains eligible'],
  [search.eligibleSearchDomain('96casual.de'),false,'known supplier excluded before fetch'],
  [search.eligibleSearchDomain('toms-paderborn.de'),false,'known rejection excluded before fetch'],
  [search.eligibleSearchDomain('careofcarl.fi'),false,'new retail excluded before fetch'],
  [search.eligibleSearchDomain('hof.sk'),false,'HOF new retail excluded before fetch'],
  [search.eligibleSearchDomain('skroutz.gr'),false,'marketplace excluded before fetch'],
  [search.relevant('Fred Perry vintage polo','https://shop.example/item'),true,'Fred Perry relevant'],
  [search.relevant('FRED economic data','https://fred.stlouisfed.org/series/X'),false,'Federal Reserve noise rejected'],
  [search.domainOf('https://www.Example.CZ/item'),'example.cz','domain normalization'],
  [search.canonical('https://Example.CZ/item?utm_source=x&ref=y&id=1#fragment'),'https://example.cz/item?id=1','tracking removal'],
];
for(const[actual,expected,label]of fixtures)assert(actual===expected,`Search regression failed for ${label}: expected ${expected}, got ${actual}`);
console.log(`search regression fixtures passed: ${fixtures.length}`);
