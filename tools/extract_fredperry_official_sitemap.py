#!/usr/bin/env python3
from __future__ import annotations
# Dedicated full-sitemap pass: no candidate cap and no fabricated URLs.
import csv, hashlib, json, re, urllib.parse, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
import requests

OUT=Path('official-sitemap-artifact'); OUT.mkdir(exist_ok=True)
URL='https://www.fredperry.com/sitemap.xml'
PAT=re.compile(r'/[^/]*-[a-z]{1,6}\d{1,6}[a-z]?-[a-z0-9]{2,8}\.html$',re.I)
NEG=re.compile(r'/(?:media|images?|aboutus|subculture|help|services|campaign|collaborations?)/|\.(?:jpg|jpeg|png|webp|gif)$',re.I)
r=requests.get(URL,timeout=60,headers={'User-Agent':'Mozilla/5.0','Accept':'application/xml,text/xml,*/*'})
r.raise_for_status()
root=ET.fromstring(r.content)
locs=[n.text.strip() for n in root.iter() if n.tag.lower().endswith('loc') and n.text]
rows=[]
for u in locs:
    p=urllib.parse.urlsplit(u)
    canonical=urllib.parse.urlunsplit(('https',p.netloc.lower(),re.sub('/+','/',p.path),'',''))
    if PAT.search(p.path) and not NEG.search(p.path):
        rows.append({'store_rank':1,'store':'Fred Perry official','domain':'www.fredperry.com','product_url':canonical,
                     'canonical_url':canonical,'product_name':'','product_identity_key':'1:'+p.path.lower(),
                     'capture_mode':'OFFICIAL_FULL_SITEMAP','current_sale_confidence':'REVIEW','active_source':'FALSE',
                     'availability':'unknown','verification_status':'sitemap_product_pattern','http_status':r.status_code,
                     'source':'official_sitemap','source_url':URL,'sha256_url':hashlib.sha256(canonical.encode()).hexdigest(),
                     'captured_at_utc':datetime.now(timezone.utc).replace(microsecond=0).isoformat()})
rows=list({x['canonical_url']:x for x in rows}.values())
rows.sort(key=lambda x:x['product_url'])
fields=list(rows[0].keys()) if rows else []
with (OUT/'official_fred_perry_product_urls.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
(OUT/'official_fred_perry_product_urls.txt').write_text(''.join(x['product_url']+'\n' for x in rows),encoding='utf-8')
(OUT/'manifest.json').write_text(json.dumps({'source_url':URL,'sitemap_entries':len(locs),'strict_product_urls':len(rows),'captured_at_utc':datetime.now(timezone.utc).replace(microsecond=0).isoformat()},indent=2),encoding='utf-8')
print(json.dumps({'sitemap_entries':len(locs),'strict_product_urls':len(rows)}))
