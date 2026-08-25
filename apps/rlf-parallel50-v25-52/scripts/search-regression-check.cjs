const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const root=path.resolve(__dirname,'..');
function compile(file){return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,importsNotUsedAsValues:ts.ImportsNotUsedAsValues.Remove},fileName:file}).outputText;}
function evaluate(file,requireFn){const module={exports:{}};const wrapper=`(function(exports,require,module,__filename,__dirname){${compile(file)}\n})`;const context={console,URL,URLSearchParams,Set,Map,RegExp,String,Object,Array,Boolean,Number,Math,Date,AbortSignal,fetch,decodeURIComponent,encodeURIComponent};const fn=vm.runInNewContext(wrapper,context);fn(module.exports,requireFn,module,file,path.dirname(file));return module.exports;}
function assert(condition,message){if(!condition)throw new Error(message);}
const policyFile=path.join(root,'workflows','policy.ts');
const registryFile=path.join(root,'lib','known-suppliers.ts');
const searchFile=path.join(root,'workflows','search.ts');
const policy=evaluate(policyFile,(id)=>{throw new Error(`Unexpected policy import: ${id}`);});
const registry=evaluate(registryFile,(id)=>{throw new Error(`Unexpected registry import: ${id}`);});
const search=evaluate(searchFile,(id)=>{if(id==='node:crypto')return require('node:crypto');if(id==='./policy')return policy;if(id==='@/lib/known-suppliers')return registry;throw new Error(`Unexpected search import: ${id}`);});

const lane={slot:'F06',countryCode:'CZ',country:'Czechia',language:'cs-CZ,cs;q=.9,en;q=.7',tld:'cz',localSecondhand:'použité oblečení',index:5};
const input={cycle:19,maxCandidates:8,lane};
const query=search.overpassQuery(input,36);
const exactCrawl=search.commonCrawlExactUrl('https://new-vintage-store.cz/products/fred-perry-polo?utm_source=test',5);
const osmFixture=JSON.stringify({elements:[
  {type:'node',id:1,tags:{name:'New Vintage Store',shop:'clothes',second_hand:'only',website:'https://new-vintage-store.cz/?utm_source=osm'}},
  {type:'node',id:2,tags:{name:'Known Supplier',shop:'second_hand',website:'https://96casual.de'}},
  {type:'node',id:3,tags:{name:'Marketplace',shop:'second_hand',website:'https://skroutz.gr/fred-perry'}},
  {type:'node',id:4,tags:{name:'Social Only',shop:'clothes',second_hand:'yes',website:'https://instagram.com/social-only'}},
  {type:'way',id:5,tags:{name:'Charity Vintage',shop:'charity','contact:website':'www.charity-vintage.cz'}},
  {type:'relation',id:6,tags:{name:'Duplicate Store',shop:'second_hand','contact:website':'https://new-vintage-store.cz/contact'}},
  {type:'node',id:7,tags:{name:'No Website',shop:'second_hand'}},
]});
const parsed=search.overpassResults(osmFixture,10);
const retryBase={name:'overpass',status:200,bodyLength:10,linkCount:0,challenge:false,durationMs:1,error:null,contentType:'application/json',responseHash:'x'};

const fixtures=[
  [search.primaryCorpus(input),'overpass-json','V22 uses Overpass primary'],
  [search.overpassVariant(input),0,'country lane receives deterministic variant'],
  [query.includes('["ISO3166-1"="CZ"]'),true,'query keeps ISO country boundary'],
  [query.includes('shop"="second_hand'),true,'query includes dedicated second-hand shops'],
  [query.includes('shop"="clothes'),true,'query includes clothing shops'],
  [query.includes('contact:website'),true,'query includes contact website tags'],
  [query.endsWith('out tags 36;'),true,'query output is bounded'],
  [search.primaryEndpoint(input),'https://overpass-api.de/api/interpreter','lane selects deterministic primary endpoint'],
  [search.secondaryEndpoint(input),'https://overpass.private.coffee/api/interpreter','retry selects the other endpoint'],
  [search.shouldRetryOverpass(retryBase),false,'HTTP 200 without challenge does not retry'],
  [search.shouldRetryOverpass({...retryBase,status:429}),true,'rate limit retries'],
  [search.shouldRetryOverpass({...retryBase,challenge:true}),true,'challenge retries'],
  [search.shouldRetryOverpass({...retryBase,status:null,error:'TimeoutError'}),true,'transport error retries'],
  [parsed.length,2,'only two new operator domains survive prefilter'],
  [parsed[0]?.url,'https://new-vintage-store.cz','highest-quality clothing seed ranks first'],
  [parsed[0]?.title,'New Vintage Store','OSM name retained'],
  [parsed[0]?.snippet.includes('second_hand=only'),true,'OSM provenance retained in snippet'],
  [parsed[1]?.url,'https://charity-vintage.cz','contact website normalized with HTTPS'],
  [search.websiteValues({website:'https://one.example; https://two.example'}).length,2,'semicolon website values split'],
  [search.websiteValues({website:'https://instagram.com/nope'}).length,0,'social profile rejected as operator website'],
  [search.eligibleSearchDomain('new-vintage-store.cz'),true,'new professional candidate remains eligible'],
  [search.eligibleSearchDomain('96casual.de'),false,'known supplier excluded'],
  [search.eligibleSearchDomain('toms-paderborn.de'),false,'known rejection excluded'],
  [search.eligibleSearchDomain('careofcarl.fi'),false,'new retail excluded'],
  [search.eligibleSearchDomain('hof.sk'),false,'HOF retail excluded'],
  [search.eligibleSearchDomain('skroutz.gr'),false,'marketplace excluded'],
  [search.eligibleSearchDomain('instagram.com'),false,'social network excluded'],
  [search.COMMON_CRAWL_INDEX,'CC-MAIN-2026-30','Common Crawl collection remains pinned for exact corroboration'],
  [decodeURIComponent(exactCrawl).includes('https://new-vintage-store.cz/products/fred-perry-polo'),true,'Common Crawl helper uses exact candidate URL'],
  [decodeURIComponent(exactCrawl).includes('*.cz'),false,'Common Crawl helper is never TLD-wide'],
  [decodeURIComponent(exactCrawl).includes('limit=5'),true,'Common Crawl corroboration bounded'],
  [search.relevant('Fred Perry vintage polo','https://shop.example/item'),true,'Fred Perry relevant'],
  [search.relevant('FRED economic data','https://fred.stlouisfed.org/series/X'),false,'Federal Reserve noise rejected'],
  [search.domainOf('https://www.Example.CZ/item'),'example.cz','domain normalization'],
  [search.canonical('https://Example.CZ/item?utm_source=x&ref=y&id=1#fragment'),'https://example.cz/item?id=1','tracking removal'],
];
for(const[actual,expected,label]of fixtures)assert(actual===expected,`Search regression failed for ${label}: expected ${expected}, got ${actual}`);
console.log(`search regression fixtures passed: ${fixtures.length}`);
