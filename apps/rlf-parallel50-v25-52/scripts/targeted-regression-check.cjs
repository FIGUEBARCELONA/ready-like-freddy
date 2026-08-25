const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

const root=path.resolve(__dirname,'..');
function compile(file){return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,importsNotUsedAsValues:ts.ImportsNotUsedAsValues.Remove},fileName:file}).outputText;}
function evaluate(file,requireFn){
  const module={exports:{}};const wrapper=`(function(exports,require,module,__filename,__dirname){${compile(file)}\n})`;
  const context={console,URL,URLSearchParams,Set,Map,RegExp,String,Object,Array,Boolean,Number,Math,Date,AbortSignal,fetch,Buffer,decodeURIComponent,encodeURIComponent,TextDecoder,Uint8Array};
  const fn=vm.runInNewContext(wrapper,context);fn(module.exports,requireFn,module,file,path.dirname(file));return module.exports;
}
function assert(condition,message){if(!condition)throw new Error(message);}

const policy=evaluate(path.join(root,'workflows','policy.ts'),id=>{throw new Error(`Unexpected policy import: ${id}`);});
const registry=evaluate(path.join(root,'lib','known-suppliers.ts'),id=>{throw new Error(`Unexpected registry import: ${id}`);});
const provenance=evaluate(path.join(root,'workflows','provenance.ts'),id=>{throw new Error(`Unexpected provenance import: ${id}`);});
const search=evaluate(path.join(root,'workflows','search.ts'),id=>{
  if(id==='node:crypto')return require('node:crypto');
  if(id==='./policy')return policy;
  if(id==='@/lib/known-suppliers')return registry;
  throw new Error(`Unexpected search import: ${id}`);
});
const targets=evaluate(path.join(root,'lib','cycle20-targets.ts'),id=>{throw new Error(`Unexpected target import: ${id}`);});
const targeted=evaluate(path.join(root,'workflows','targeted.ts'),id=>{
  if(id==='node:crypto')return require('node:crypto');
  if(id==='./search')return search;
  if(id==='./provenance')return provenance;
  if(id==='./evidence')return {fetchBundle:()=>{throw new Error('fetchBundle must not execute in regression fixtures');}};
  if(id==='./assessment')return {assess:()=>{throw new Error('assess must not execute in regression fixtures');}};
  throw new Error(`Unexpected targeted import: ${id}`);
});

const target={domain:'new-vintage-store.cz',url:'https://new-vintage-store.cz',title:'New Vintage Store',countryCode:'CZ'};
const shopify=targeted.adapterUrls(target,'<script src="https://cdn.shopify.com/theme.js"></script>');
const woo=targeted.adapterUrls(target,'<link href="/wp-content/plugins/woocommerce/style.css">');
const generic=targeted.adapterUrls(target,'<html>custom storefront</html>');
const html=`<a href="/products/fred-perry-polo?utm_source=test">Fred Perry vintage polo</a><a href="https://skroutz.gr/fred-perry">Fred Perry marketplace</a><a href="/products/lacoste">Lacoste</a>`;
const htmlUrls=targeted.extractBrandUrls(html,'https://new-vintage-store.cz/search?q=Fred+Perry','text/html');
const xmlUrls=targeted.extractBrandUrls('<urlset><url><loc>https://new-vintage-store.cz/products/fred-perry-jacket</loc></url><url><loc>https://external.example/fred-perry</loc></url></urlset>','https://new-vintage-store.cz/sitemap.xml','application/xml');
const jsonUrls=targeted.extractBrandUrls(JSON.stringify({products:[{title:'Fred Perry Twin Tipped Polo',handle:'fred-perry-twin-tipped-polo',available:true},{title:'Other brand',handle:'other-brand'}]}),'https://new-vintage-store.cz/products.json','application/json');
const emptyUrls=targeted.extractBrandUrls('<html><a href="/products/other">Other brand</a></html>','https://new-vintage-store.cz/search?q=Fred+Perry','text/html');
const reflectedUrls=targeted.extractBrandUrls('<html><h1>Search results for Fred Perry</h1><p>No products found.</p><link rel="canonical" href="https://new-vintage-store.cz/search?q=Fred+Perry"></html>','https://new-vintage-store.cz/search?q=Fred+Perry','text/html');
const inferredCandidate={status:'QUALIFIED_PROVISIONAL',supplierEvidence:'READY_TO_REVIEW',productEvidence:'DIRECT_PRODUCT_PROVISIONAL',fredPerryEvidence:true,uniqueProductPathSignal:true,availableProductSignals:4,score:91};
const closedCandidate=targeted.applyDirectBrandGate(inferredCandidate,false);
const directCandidate=targeted.applyDirectBrandGate({...inferredCandidate,fredPerryEvidence:false},true);

const checks=[
  [targets.CYCLE20_TARGETS.length,50,'target queue has exactly fifty lanes'],
  [new Set(targets.CYCLE20_TARGETS.map(row=>row.domain)).size,50,'target queue domains are unique'],
  [targets.CYCLE20_TARGETS.some(row=>/\.co\.uk$|\.uk$/.test(row.domain)),false,'target queue excludes UK domains'],
  [shopify.length,4,'Shopify adapter count bounded'],
  [shopify.map(row=>row.provider).join(','),'site-search,shopify-suggest,shopify-products,robots','Shopify adapters deterministic'],
  [woo.length,4,'WooCommerce adapter count bounded'],
  [woo.map(row=>row.provider).join(','),'site-search,woocommerce-store-api,wordpress-search-api,robots','WooCommerce adapters deterministic'],
  [generic.length,4,'generic adapter count bounded'],
  [generic.map(row=>row.provider).join(','),'site-search,site-query,sitemap,robots','generic adapters deterministic'],
  [htmlUrls.includes('https://new-vintage-store.cz/products/fred-perry-polo'),true,'same-domain product URL retained and canonicalized'],
  [htmlUrls.some(url=>url.includes('skroutz.gr')),false,'external marketplace URL rejected'],
  [xmlUrls.includes('https://new-vintage-store.cz/products/fred-perry-jacket'),true,'same-domain sitemap URL retained'],
  [xmlUrls.some(url=>url.includes('external.example')),false,'external sitemap URL rejected'],
  [jsonUrls.includes('https://new-vintage-store.cz/products/fred-perry-twin-tipped-polo'),true,'Shopify-like JSON handle resolved'],
  [jsonUrls.some(url=>url.includes('other-brand')),false,'unrelated JSON product rejected'],
  [emptyUrls.length,0,'query URL alone cannot manufacture Fred Perry evidence'],
  [reflectedUrls.length,0,'reflected Fred Perry query text cannot manufacture evidence'],
  [targeted.hasDirectBrandEvidence([]),false,'empty URL set cannot activate brand evidence'],
  [targeted.hasDirectBrandEvidence(htmlUrls),true,'captured internal product URL activates brand evidence'],
  [closedCandidate.fredPerryEvidence,false,'assessor inference is overridden without direct URL'],
  [closedCandidate.status,'EVIDENCE_INCOMPLETE','non-direct candidate is fail-closed'],
  [closedCandidate.supplierEvidence,'INCOMPLETE','non-direct supplier evidence is incomplete'],
  [closedCandidate.productEvidence,'SUPPLIER_EVIDENCE_ONLY','non-direct product evidence is removed'],
  [closedCandidate.score,35,'non-direct score is capped'],
  [closedCandidate.uniqueProductPathSignal,false,'non-direct unique path signal is cleared'],
  [closedCandidate.availableProductSignals,0,'non-direct availability signal is cleared'],
  [directCandidate.fredPerryEvidence,true,'direct URL preserves brand evidence'],
  [directCandidate.status,'QUALIFIED_PROVISIONAL','direct gate does not manufacture a rejection'],
  [provenance.sameRegistrableDomain('https://shop.example.cz/a','https://www.example.cz/b'),true,'subdomains share operator provenance'],
  [provenance.sameRegistrableDomain('https://example.cz','https://marketplace.cz'),false,'different operators rejected'],
];
for(const[actual,expected,label]of checks)assert(actual===expected,`Targeted regression failed for ${label}: expected ${expected}, got ${actual}`);
console.log(`targeted verification regression fixtures passed: ${checks.length}`);
