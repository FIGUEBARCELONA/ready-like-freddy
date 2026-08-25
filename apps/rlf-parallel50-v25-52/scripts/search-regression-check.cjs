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
const primary=search.primaryCommerceQuery(input);
const alternate=search.alternateCommerceQuery(input);
const fixture=`
<html><body>
<a href="https://www.mojeek.com/about">About</a>
<li class="result"><h2><a data-rank="1" href="https://new-vintage-store.cz/products/fred-perry-polo?utm_source=mojeek">Fred Perry vintage polo</a></h2><p>Curated second hand vintage clothing shop with shipping and returns.</p></li>
<li><a href='https://96casual.de/products/fred-perry-jacket'>Fred Perry jacket</a></li>
<li><a href="https://skroutz.gr/fred-perry">Fred Perry marketplace result</a></li>
</body></html>`;
const metrics=search.mojeekAnchorMetrics(fixture);
const parsed=search.mojeekResults(fixture,10);
const exactCrawl=search.commonCrawlExactUrl('https://new-vintage-store.cz/products/fred-perry-polo?utm_source=test',5);

const fixtures=[
  [search.primaryCorpus(input),'mojeek-html','V21 uses Mojeek primary'],
  [search.shouldRunFallbackSearch(0),true,'empty Mojeek result triggers one Bing fallback'],
  [search.shouldRunFallbackSearch(1),false,'one Mojeek result suppresses Bing fallback'],
  [metrics.anchors,4,'all anchors counted'],
  [metrics.externalAnchors,3,'Mojeek internal anchor excluded'],
  [metrics.brandAnchors,3,'Fred Perry external anchors identified'],
  [metrics.eligibleAnchors,1,'known supplier and marketplace excluded before fetch'],
  [parsed.length,1,'only one eligible result parsed'],
  [parsed[0]?.url,'https://new-vintage-store.cz/products/fred-perry-polo','tracking removed from parsed result'],
  [parsed[0]?.title,'Fred Perry vintage polo','title normalized'],
  [parsed[0]?.snippet.includes('second hand'),true,'nearby result text retained as snippet'],
  [search.COMMON_CRAWL_INDEX,'CC-MAIN-2026-30','Common Crawl collection remains pinned for corroboration'],
  [decodeURIComponent(exactCrawl).includes('https://new-vintage-store.cz/products/fred-perry-polo'),true,'Common Crawl helper uses exact candidate URL'],
  [decodeURIComponent(exactCrawl).includes('*.cz'),false,'Common Crawl helper is never TLD-wide'],
  [decodeURIComponent(exactCrawl).includes('limit=5'),true,'Common Crawl corroboration bounded'],
  [primary.query.includes('Fred Perry'),true,'primary keeps brand constraint'],
  [primary.query.includes('.cz')||primary.query.includes('Czechia'),true,'primary keeps country constraint'],
  [alternate.query.includes('Fred Perry'),true,'fallback keeps brand constraint'],
  [alternate.query.includes('Czechia'),true,'fallback keeps country constraint'],
  [Number.isInteger(primary.index)&&primary.index>=0&&primary.index<8,true,'primary template index bounded'],
  [Number.isInteger(alternate.index)&&alternate.index>=0&&alternate.index<8,true,'fallback template index bounded'],
  [search.eligibleSearchDomain('new-vintage-store.cz'),true,'new professional candidate remains eligible'],
  [search.eligibleSearchDomain('96casual.de'),false,'known supplier excluded'],
  [search.eligibleSearchDomain('toms-paderborn.de'),false,'known rejection excluded'],
  [search.eligibleSearchDomain('careofcarl.fi'),false,'new retail excluded'],
  [search.eligibleSearchDomain('hof.sk'),false,'HOF retail excluded'],
  [search.eligibleSearchDomain('skroutz.gr'),false,'marketplace excluded'],
  [search.relevant('Fred Perry vintage polo','https://shop.example/item'),true,'Fred Perry relevant'],
  [search.relevant('FRED economic data','https://fred.stlouisfed.org/series/X'),false,'Federal Reserve noise rejected'],
  [search.domainOf('https://www.Example.CZ/item'),'example.cz','domain normalization'],
  [search.canonical('https://Example.CZ/item?utm_source=x&ref=y&id=1#fragment'),'https://example.cz/item?id=1','tracking removal'],
];
for(const[actual,expected,label]of fixtures)assert(actual===expected,`Search regression failed for ${label}: expected ${expected}, got ${actual}`);
console.log(`search regression fixtures passed: ${fixtures.length}`);
