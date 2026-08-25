const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const root=path.resolve(__dirname,'..');
function compile(file){return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,importsNotUsedAsValues:ts.ImportsNotUsedAsValues.Remove},fileName:file}).outputText;}
function evaluate(file,requireFn){
  const module={exports:{}};const wrapper=`(function(exports,require,module,__filename,__dirname){${compile(file)}\n})`;
  const context={console,URL,URLSearchParams,Set,Map,RegExp,String,Object,Array,Boolean,Number,Math,Date,AbortSignal,fetch,Buffer,TextDecoder,Uint8Array,decodeURIComponent,encodeURIComponent,setTimeout,clearTimeout};
  const fn=vm.runInNewContext(wrapper,context);fn(module.exports,requireFn,module,file,path.dirname(file));return module.exports;
}
function assert(condition,message){if(!condition)throw new Error(message);}

const policy=evaluate(path.join(root,'workflows','policy.ts'),id=>{throw new Error(`Unexpected policy import: ${id}`);});
const registry=evaluate(path.join(root,'lib','known-suppliers.ts'),id=>{throw new Error(`Unexpected registry import: ${id}`);});
const lanes=evaluate(path.join(root,'lib','lanes.ts'),id=>{throw new Error(`Unexpected lane import: ${id}`);});
const provenance=evaluate(path.join(root,'workflows','provenance.ts'),id=>{throw new Error(`Unexpected provenance import: ${id}`);});
const search=evaluate(path.join(root,'workflows','search.ts'),id=>{
  if(id==='node:crypto')return require('node:crypto');
  if(id==='./policy')return policy;
  if(id==='@/lib/known-suppliers')return registry;
  throw new Error(`Unexpected search import: ${id}`);
});
const cc=evaluate(path.join(root,'workflows','common-crawl.ts'),id=>{
  if(id==='node:crypto')return require('node:crypto');
  if(id==='./search')return search;
  if(id==='./provenance')return provenance;
  if(id==='./evidence')return {fetchBundle:()=>{throw new Error('fetchBundle must not execute in regression fixtures');}};
  if(id==='./assessment')return {assess:()=>{throw new Error('assess must not execute in regression fixtures');}};
  throw new Error(`Unexpected Common Crawl import: ${id}`);
});

const partitions=lanes.LANES.map(cc.commonCrawlPartition);
const deLane=lanes.LANES.find(row=>row.countryCode==='DE'&&row.index<27);
const frLane=lanes.LANES.find(row=>row.countryCode==='FR'&&row.index<27);
const fixture=[
  {url:'https://fresh-vintage-example.de/products/fred-perry-polo-123',timestamp:'20260801010101',status:'200',mime:'text/html',digest:'ABC',filename:'crawl-data/a',offset:'1',length:'500'},
  {url:'https://fresh-vintage-example.de/products/fred-perry-jacket-456',timestamp:'20260802010101',status:'200',mime:'text/html',digest:'DEF',filename:'crawl-data/b',offset:'2',length:'600'},
  {url:'https://other-example.fr/products/fred-perry-polo',timestamp:'20260801010101',status:'200',mime:'text/html',digest:'GHI'},
  {url:'https://fresh-vintage-example.de/about/fred-perry',timestamp:'20260801010101',status:'200',mime:'text/html',digest:'JKL'},
  {url:'https://www.ebay.de/products/fred-perry-polo',timestamp:'20260801010101',status:'200',mime:'text/html',digest:'MNO'},
  {url:'https://fresh-two-example.de/produkt/fred-perry-cardigan',timestamp:'20260801010101',status:'200',mime:'text/html',digest:'PQR'},
  {url:'https://fresh-three-example.de/products/fred-perry-shirt',timestamp:'20260801010101',status:'301',mime:'text/html',digest:'STU'},
].map(row=>JSON.stringify(row)).join('\n');
const parsed=cc.parseCommonCrawl(fixture,deLane,10);
const query=cc.commonCrawlQueryUrl(cc.COMMON_CRAWL_PRIMARY,'*.de/products/fred-perry*',24);
const hash=cc.archiveRecordHash(parsed[0]);
const buckets=new Map();for(const row of partitions){const bucket=Math.floor(row.staggerMs/1000);buckets.set(bucket,(buckets.get(bucket)||0)+1);}

const checks=[
  [lanes.LANES.length,50,'dashboard has exactly fifty lanes'],
  [partitions.length,50,'partition count is exactly fifty'],
  [new Set(partitions.map(row=>row.signature)).size,50,'partition signatures are unique'],
  [partitions.every(row=>row.primaryIndex==='CC-MAIN-2026-34'),true,'latest crawl pinned'],
  [partitions.every(row=>!row.primaryPattern.includes('.uk/')&&!row.fallbackPattern.includes('.uk/')),true,'UK absent from partitions'],
  [Math.max(...partitions.map(row=>row.staggerMs))<10000,true,'stagger window bounded below ten seconds'],
  [Math.max(...buckets.values())<=5,true,'no more than five primary queries scheduled per second'],
  [query.includes('output=json'),true,'CDX output is NDJSON'],
  [query.includes('filter=status%3A200'),true,'HTTP 200 filter fixed'],
  [query.includes('filter=mime%3Atext%2Fhtml'),true,'HTML filter fixed'],
  [query.includes('collapse=urlkey'),true,'URL-key collapse fixed'],
  [query.includes('fields=url%2Ctimestamp%2Cstatus%2Cmime%2Cdigest%2Cfilename%2Coffset%2Clength'),true,'audit fields fixed'],
  [cc.inventoryArchiveUrl('https://shop.example.de/products/fred-perry-polo',deLane),true,'English product path accepted'],
  [cc.inventoryArchiveUrl('https://shop.example.de/produkt/fred-perry-polo',deLane),true,'localized product path accepted'],
  [cc.inventoryArchiveUrl('https://shop.example.fr/products/fred-perry-polo',deLane),false,'wrong country TLD rejected'],
  [cc.inventoryArchiveUrl('https://shop.example.de/about/fred-perry',deLane),false,'editorial path rejected'],
  [cc.inventoryArchiveUrl('https://www.ebay.de/products/fred-perry-polo',deLane),false,'marketplace rejected'],
  [parsed.length,2,'records deduplicated by domain and invalid rows rejected'],
  [parsed[0].url,'https://fresh-vintage-example.de/products/fred-perry-polo-123','first eligible record stable'],
  [parsed[1].url,'https://fresh-two-example.de/produkt/fred-perry-cardigan','localized record retained'],
  [/^[a-f0-9]{64}$/.test(hash),true,'archive record SHA-256 format'],
  [hash,cc.archiveRecordHash(parsed[0]),'archive record hash deterministic'],
  [cc.inventoryArchiveUrl('https://shop.example.fr/produit/fred-perry-polo',frLane),true,'French localized inventory path accepted'],
];
for(const[actual,expected,label]of checks)assert(actual===expected,`Common Crawl regression failed for ${label}: expected ${expected}, got ${actual}`);
console.log(`Common Crawl regression fixtures passed: ${checks.length}`);
