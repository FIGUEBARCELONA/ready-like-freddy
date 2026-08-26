#!/usr/bin/env python3
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,re,urllib.parse,xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime,timezone
from pathlib import Path
import requests

CFG={
6:("Frasers","www.frasers.com",[r'/fred-perry-[^/?#]+-\d{5,9}/?$']),
7:("Flannels","www.flannels.com",[r'/fred-perry-[^/?#]+-\d{5,9}/?$']),
12:("House of Fraser","www.houseoffraser.co.uk",[r'/fred-perry-[^/?#]+-\d{5,9}/?$']),
13:("Tessuti","www.tessuti.co.uk",[r'/product/[^/?#]+/\d+/?$']),
14:("The Cream Store","thecreamstore.com",[r'/product/[^/?#]+/?$']),
20:("Sports Direct","www.sportsdirect.com",[r'/fred-perry-[^/?#]+-\d{5,9}/?$']),
}
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

def norm(u):
 p=urllib.parse.urlsplit(u.strip());return urllib.parse.urlunsplit(('https',p.netloc.lower(),re.sub('/+','/',p.path),'',''))
def main(rank,outdir):
 store,domain,pats=CFG[rank]; out=Path(outdir);out.mkdir(parents=True,exist_ok=True)
 s=requests.Session();s.headers.update({'User-Agent':UA,'Accept':'application/xml,text/xml,text/html,*/*'})
 roots=[f'https://{domain}/robots.txt'];sm=[];logs=[]
 for ru in roots:
  try:
   r=s.get(ru,timeout=15);logs.append((ru,r.status_code,len(r.content)))
   if r.status_code<400:
    for ln in r.text.splitlines():
     if ln.lower().startswith('sitemap:'):sm.append(ln.split(':',1)[1].strip())
  except Exception as e:logs.append((ru,'error',type(e).__name__))
 sm += [f'https://{domain}/sitemap.xml',f'https://{domain}/sitemap_index.xml',f'https://{domain}/sitemap-index.xml']
 q=deque(dict.fromkeys(sm));seen=set();urls=set()
 while q and len(seen)<600:
  u=q.popleft()
  if u in seen:continue
  seen.add(u)
  try:r=s.get(u,timeout=25)
  except Exception as e:logs.append((u,'error',type(e).__name__));continue
  logs.append((u,r.status_code,len(r.content)))
  if r.status_code>=400:continue
  data=r.content
  if u.endswith('.gz'):
   try:data=gzip.decompress(data)
   except:pass
  try:root=ET.fromstring(data)
  except:continue
  locs=[n.text.strip() for n in root.iter() if n.tag.lower().endswith('loc') and n.text]
  if root.tag.lower().endswith('sitemapindex'):
   for x in locs:
    if x not in seen:q.append(x)
  else:
   for x in locs:
    nu=norm(x); path=urllib.parse.urlsplit(nu).path
    if any(re.search(p,path,re.I) for p in pats) and ('fred-perry' in nu.lower() or rank in {13,14}):urls.add(nu)
 # WooCommerce fallback for Cream Store
 if rank==14:
  for page in range(1,10):
   ep=f'https://{domain}/wp-json/wc/store/v1/products?search=Fred%20Perry&per_page=100&page={page}'
   try:r=s.get(ep,timeout=20);data=r.json() if r.status_code<400 else []
   except:break
   logs.append((ep,r.status_code,len(data) if isinstance(data,list) else 0))
   if not isinstance(data,list) or not data:break
   for p in data:
    name=str(p.get('name') or '');u=norm(str(p.get('permalink') or ''))
    if 'fred perry' in (name+' '+u).lower() and re.search(pats[0],urllib.parse.urlsplit(u).path,re.I):urls.add(u)
   if len(data)<100:break
 now=datetime.now(timezone.utc).replace(microsecond=0).isoformat();rows=[]
 for u in sorted(urls):
  rows.append({'rank':rank,'store':store,'domain':domain,'product_url':u,'canonical_url':u,'product_name':'','http_status':'','verification_status':'strict_sitemap_candidate','availability':'unknown','source':'fast_sitemap','source_url':'robots/sitemap','sha256_url':hashlib.sha256(u.encode()).hexdigest(),'captured_at_utc':now})
 fields=list(rows[0].keys()) if rows else ['rank','store','domain','product_url','canonical_url','product_name','http_status','verification_status','availability','source','source_url','sha256_url','captured_at_utc']
 with (out/'fred_perry_product_urls_all.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
 with (out/'fred_perry_product_url_summary.csv').open('w',encoding='utf-8-sig',newline='') as f:
  fields2=['rank','store','domain','product_urls_kept','verified_product','strong_candidate','blocked_unverified','request_error','availability_instock','availability_outofstock','candidate_count_before_validation','coverage_status','captured_at_utc'];w=csv.DictWriter(f,fieldnames=fields2);w.writeheader();w.writerow({'rank':rank,'store':store,'domain':domain,'product_urls_kept':len(rows),'verified_product':0,'strong_candidate':len(rows),'blocked_unverified':0,'request_error':0,'availability_instock':0,'availability_outofstock':0,'candidate_count_before_validation':len(rows),'coverage_status':'sitemap_fallback','captured_at_utc':now})
 (out/'manifest.json').write_text(json.dumps({'rank':rank,'store':store,'urls':len(rows),'sitemaps_scanned':len(seen),'logs':logs},indent=2),encoding='utf-8')
 print(json.dumps({'rank':rank,'store':store,'urls':len(rows),'sitemaps_scanned':len(seen)}))
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--rank',type=int,required=True);ap.add_argument('--out',required=True);a=ap.parse_args();main(a.rank,a.out)
