#!/usr/bin/env python3
from __future__ import annotations

import csv, hashlib, io, json, re, urllib.parse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi import requests
from PIL import Image, ImageDraw

OUT=Path('w003b-exact-source-gallery-v2'); IMG=OUT/'images'; SHEETS=OUT/'contact_sheets'
for p in (OUT,IMG,SHEETS): p.mkdir(exist_ok=True)

SEEDS=[
('M3600::04C','EXACT_SKU','https://www.suitable.es/fred-perry/polo-shirts/fred-perry-polo-twin-tipped-m3600-pink-04c.html'),
('M3600::85B','EXACT_SKU','https://www.suitable.es/fred-perry/polo-shirts/fred-perry-polo-twin-tipped-m3600-grey-85b.html'),
('M3600::87B','EXACT_SKU','https://www.eqvvs.co.uk/products/fred-perry-twin-tipped-fred-perry-polo-shirt-87b-laurel-wreath-green-ecru-dusky-blue-m3600'),
('M3600::T50','EXACT_SKU_JP','https://www.fredperry.jp/shop/g/gM3600-4550392324483/'),
('M3600::T60','EXACT_SKU_JP','https://www.fredperry.jp/shop/g/gM3600-4550392325091/'),
('M3600::U98','EXACT_SKU_JP','https://www.fredperry.jp/shop/g/gM3600-4550392381868/'),
('M3600::U98','EXACT_SKU','https://calif.cc/products/191242014026'),
('M3600::350','EXACT_SKU_JP','https://www.fredperry.jp/shop/g/gM3600-4550392113759'),
('M3600::350','EXACT_SKU','https://www.suitable.sk/fred-perry/polo-shirts/fred-perry-polo-shirt-black-350.html'),
('L7255::81A','EXACT_SKU','https://www.hhv.de/en-US/clothing/item/fred-perry-classic-barrel-bag-grassroots-ecru-1299369')]
DIRECT=[('MODEL::M3600','MODEL_LEVEL_ONLY','M3600-S07','https://i.ebayimg.com/images/g/SNUAAOSw7z9mgCl3/s-l1200.jpg')]
IMG_RE=re.compile(r'\.(?:jpe?g|png|webp)(?:$|[?&#])',re.I)
NEG=re.compile(r'(?:logo|icon|sprite|payment|flag|trust|avatar|badge|placeholder|loading|spinner)',re.I)


def fetch(url,timeout=18):
    return requests.get(url,impersonate='chrome',timeout=timeout,allow_redirects=True,headers={'Accept-Language':'en-GB,en;q=0.9,ja;q=0.7'})

def canon(raw,base):
    if not raw:return None
    raw=raw.replace('\\/','/').strip().strip('"\'')
    if raw.startswith('//'):raw='https:'+raw
    u=urllib.parse.urljoin(base,raw); p=urllib.parse.urlsplit(u)
    if p.scheme not in ('http','https'):return None
    return urllib.parse.urlunsplit((p.scheme,p.netloc.lower(),p.path,p.query,''))

def extract(html,base):
    soup=BeautifulSoup(html,'html.parser'); vals=[]
    for tag in soup.find_all(['img','source','a']):
        for a in ('src','data-src','data-original','data-zoom-image','data-image','href'):
            if tag.get(a): vals.append(tag.get(a))
        for a in ('srcset','data-srcset'):
            if tag.get(a): vals += [x.strip().split()[0] for x in tag.get(a).split(',') if x.strip()]
    vals += re.findall(r'https?:\\?/\\?/[^"\'<> ]+',html)
    out=[]; seen=set()
    for v in vals:
        u=canon(v,base)
        if not u or u in seen:continue
        seen.add(u); path=urllib.parse.urlsplit(u).path
        if NEG.search(path):continue
        if IMG_RE.search(u) or any(k in u.lower() for k in ('cdn','image','media')):out.append(u)
    return out[:20]

def download(task):
    scope,relation,page,url,ordn=task
    row={'scope_key':scope,'relation':relation,'source_page':page,'image_url':url,'ordinal':ordn}
    try:
        r=fetch(url); data=bytes(r.content); row.update(http_status=r.status_code,bytes=len(data),final_url=str(r.url))
        if r.status_code!=200 or len(data)<5000: row['status']='REJECT_HTTP_OR_SIZE'; return row
        try:
            im=Image.open(io.BytesIO(data)); im.load(); w,h=im.size; fmt=(im.format or 'JPEG').lower()
        except Exception: row['status']='REJECT_DECODE'; return row
        row.update(width=w,height=h)
        if w<250 or h<250: row['status']='REJECT_DIMENSIONS'; return row
        sha=hashlib.sha256(data).hexdigest(); ext='.jpg' if fmt in ('jpeg','jpg') else '.'+fmt
        d=IMG/re.sub(r'[^A-Za-z0-9._-]+','_',scope); d.mkdir(exist_ok=True)
        p=d/f'{ordn:03d}_{sha[:12]}{ext}'; p.write_bytes(data)
        row.update(sha256=sha,local_path=p.as_posix(),status='DOWNLOADED_PENDING_VISUAL_REVIEW')
    except Exception as e: row.update(status='ERROR',error=type(e).__name__+': '+str(e)[:160])
    return row

def sheet(scope,rows):
    valid=[r for r in rows if r.get('status')=='DOWNLOADED_PENDING_VISUAL_REVIEW'][:20]
    tiles=[]
    for r in valid:
        try:
            im=Image.open(r['local_path']).convert('RGB'); im.thumbnail((250,250)); t=Image.new('RGB',(270,305),'white'); t.paste(im,((270-im.width)//2,5));
            d=ImageDraw.Draw(t); d.text((6,262),Path(r['local_path']).name[:31],fill='black'); d.text((6,280),f"{r['width']}x{r['height']}",fill='black'); tiles.append(t)
        except:pass
    if not tiles:return
    cols=4; sh=Image.new('RGB',(cols*270,((len(tiles)+3)//4)*305),'#ddd')
    for i,t in enumerate(tiles):sh.paste(t,((i%4)*270,(i//4)*305))
    sh.save(SHEETS/(re.sub(r'[^A-Za-z0-9._-]+','_',scope)+'.jpg'),quality=88)

def main():
    captures=[]; tasks=[]; global_seen=set()
    for scope,rel,page in SEEDS:
        try:
            r=fetch(page); urls=extract(r.text,str(r.url)); captures.append({'scope_key':scope,'relation':rel,'source_page':page,'final_url':str(r.url),'http_status':r.status_code,'html_bytes':len(r.content),'candidate_image_urls':len(urls)})
            for i,u in enumerate(urls,1):
                key=(scope,u)
                if key not in global_seen:global_seen.add(key);tasks.append((scope,rel,page,u,i))
        except Exception as e:captures.append({'scope_key':scope,'relation':rel,'source_page':page,'http_status':0,'error':type(e).__name__+': '+str(e)[:160]})
    for scope,rel,page,u in DIRECT:tasks.append((scope,rel,page,u,1))
    assets=[]
    with ThreadPoolExecutor(max_workers=12) as ex:
        futures=[ex.submit(download,t) for t in tasks]
        for f in as_completed(futures):assets.append(f.result())
    by=defaultdict(list)
    for r in assets:by[r['scope_key']].append(r)
    for scope,rows in by.items():sheet(scope,sorted(rows,key=lambda x:x.get('ordinal',0)))
    for name,rows in [('source_capture.csv',captures),('image_assets_pending_review.csv',assets)]:
        fields=sorted({k for r in rows for k in r});
        with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
    m={'run':'RLF_KB_W003B_EXACT_SOURCE_GALLERY_V2','captured_at_utc':datetime.now(timezone.utc).replace(microsecond=0).isoformat(),'source_pages':len(SEEDS),'asset_rows':len(assets),'downloaded_pending_visual_review':sum(r.get('status')=='DOWNLOADED_PENDING_VISUAL_REVIEW' for r in assets),'unique_binary_sha256':len({r.get('sha256') for r in assets if r.get('sha256')}),'canonical_promotions':0,'supersedes':'RLF_KB_W003B_EXACT_SOURCE_GALLERY_V1'}
    (OUT/'manifest.json').write_text(json.dumps(m,indent=2),encoding='utf-8');print(json.dumps(m))
if __name__=='__main__':main()
