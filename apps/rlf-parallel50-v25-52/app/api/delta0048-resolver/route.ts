import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type FixedTarget = {
  domain: 'rostreetwear.com' | 'olesstore.com';
  url: string;
  discovery: string;
};

const UA = 'Mozilla/5.0 (compatible; RLF-Delta0048-Audit/1.0)';
const ALLOWED_HOSTS = new Set(['www.rostreetwear.com', 'rostreetwear.com', 'www.olesstore.com', 'olesstore.com']);

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalProductUrl(value: string, base: string) {
  const url = new URL(value, base);
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (!url.pathname.startsWith('/products/')) return null;
  url.hash = '';
  url.search = '';
  url.hostname = url.hostname.replace(/^www\./, 'www.');
  return url.toString().replace(/\/$/, '');
}

async function fetchBytes(url: string) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: '*/*' },
    redirect: 'follow',
    cache: 'no-store',
  });
  const buffer = new Uint8Array(await response.arrayBuffer());
  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

async function discoverSuggest(base: string) {
  const endpoint = new URL('/search/suggest.json', base);
  endpoint.searchParams.set('q', 'Fred Perry');
  endpoint.searchParams.set('resources[type]', 'product');
  endpoint.searchParams.set('resources[limit]', '20');
  const response = await fetch(endpoint, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    redirect: 'follow',
    cache: 'no-store',
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let data: any = null;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch {}
  const products = data?.resources?.results?.products ?? [];
  const urls = products
    .map((product: any) => canonicalProductUrl(product?.url ?? '', base))
    .filter(Boolean) as string[];
  return {
    endpoint: endpoint.toString(),
    status: response.status,
    finalUrl: response.url,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    urls,
  };
}

async function discoverCollection(base: string, path: string) {
  const url = new URL(path, base).toString();
  const response = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
    cache: 'no-store',
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const matches = [...text.matchAll(/href=["']([^"']*\/products\/[^"'?#]+)[^"']*["']/gi)];
  const urls = matches
    .map((match) => canonicalProductUrl(match[1], base))
    .filter(Boolean) as string[];
  return {
    url,
    status: response.status,
    finalUrl: response.url,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    urls: [...new Set(urls)],
  };
}

export async function GET() {
  const roBase = 'https://www.rostreetwear.com';
  const olBase = 'https://www.olesstore.com';

  const [roSuggest, roCollection, olSuggest, olCollection] = await Promise.all([
    discoverSuggest(roBase),
    discoverCollection(roBase, '/collections/produse-noi'),
    discoverSuggest(olBase),
    discoverCollection(olBase, '/collections/fred-perry'),
  ]);

  const targets = new Map<string, FixedTarget>();
  const add = (domain: FixedTarget['domain'], url: string, discovery: string) => {
    const canonical = canonicalProductUrl(url, `https://www.${domain}`);
    if (canonical) targets.set(canonical, { domain, url: canonical, discovery });
  };

  add('rostreetwear.com', 'https://www.rostreetwear.com/products/tricou-fred-perry-vintage-dama', 'sweep-fixed-url');
  for (const url of roSuggest.urls) add('rostreetwear.com', url, 'shopify-suggest');
  for (const url of roCollection.urls) {
    if (/fred[-_ ]?perry/i.test(url)) add('rostreetwear.com', url, 'collection-html');
  }
  for (const url of olSuggest.urls) add('olesstore.com', url, 'shopify-suggest');
  for (const url of olCollection.urls) add('olesstore.com', url, 'collection-html');

  const productEvidence = [];
  for (const target of [...targets.values()].sort((a, b) => a.url.localeCompare(b.url))) {
    const page = await fetchBytes(target.url);
    const machine = await fetchBytes(`${target.url}.js`);
    productEvidence.push({ ...target, page, machine });
  }

  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: ['rostreetwear.com', 'olesstore.com'],
    discovery: { roSuggest, roCollection, olSuggest, olCollection },
    products: productEvidence,
    counts: {
      total: productEvidence.length,
      rostreetwear: productEvidence.filter((x) => x.domain === 'rostreetwear.com').length,
      olesstore: productEvidence.filter((x) => x.domain === 'olesstore.com').length,
      pageHttp200: productEvidence.filter((x) => x.page.status === 200).length,
      machineHttp200: productEvidence.filter((x) => x.machine.status === 200).length,
    },
  }, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
