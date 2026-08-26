#!/usr/bin/env python3
from __future__ import annotations

import csv, hashlib, html, io, json, re, sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests
from PIL import Image, ImageDraw

OUT = Path('w003e-jp-resale-physical')
IMG = OUT / 'images'
SHEETS = OUT / 'contact_sheets'
OUT.mkdir(exist_ok=True); IMG.mkdir(exist_ok=True); SHEETS.mkdir(exist_ok=True)

@dataclass(frozen=True)
class Target:
    scope_key: str
    full_code: str
    url: str
    host_allow: tuple[str, ...]

TARGETS = [
    Target('M3600::U98', 'M3600/U98/1950/418', 'https://vector-park.jp/item/081-102608070402/', ('vector-park.jp','vector-park.s3.ap-northeast-1.amazonaws.com','amazonaws.com')),
    Target('M3600::350', 'M3600/350/1950/419', 'https://www.trefac.jp/store/3083001182033315/c3319816/', ('trefac.jp','trefac-image.s3.ap-northeast-1.amazonaws.com','amazonaws.com')),
    Target('M3600::350', 'M3600/350/1950/396', 'https://www.trefac.jp/store/1019008976582418/c3224779/', ('trefac.jp','trefac-image.s3.ap-northeast-1.amazonaws.com','amazonaws.com')),
    Target('M3600::350', 'M3600/350/1950/396', 'https://ec.bazzstore.com/products/1132871260593', ('bazzstore.com','cdn.shopify.com','shopify.com')),
]

SESSION = requests.Session(impersonate='chrome')
HEADERS = {'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36','accept-language':'ja,en;q=0.8'}
IMAGE_RE = re.compile(r'https?://[^\"\'<>\\s]+?\.(?:jpe?g|png|webp)(?:\?[^\"\'<>\\s]*)?', re.I)

def now(): return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
def sha(data: bytes): return hashlib.sha256(data).hexdigest()

def norm(value: str, base: str):
    return urljoin(base, html.unescape(value).replace('\\/','/').replace('\\u0026','&'))

def extract_images(raw: str, soup: BeautifulSoup, final_url: str, allowed: tuple[str,...]):
    values=[]
    for tag in soup.find_all(['img','source','meta','a']):
        for attr in ('src','srcset','data-src','data-original','data-lazy','href','content'):
            value=tag.get(attr)
            if not value: continue
            if attr=='srcset': values += [x.strip().split(' ')[0] for x in value.split(',')]
            else: values.append(value)
    values += IMAGE_RE.findall(raw)
    out=[]; seen=set()
    for value in values:
        u=norm(value, final_url)
        host=urlparse(u).netloc.lower()
        low=u.lower()
        if not u.startswith('http') or not any(a in host for a in allowed): continue
        if any(x in low for x in ('logo','icon','sprite','favicon','loading','payment','banner','common/','header','footer')): continue
        if u in seen: continue
        seen.add(u); out.append(u)
    return out[:80]

def make_sheet(scope: str, paths: list[Path]):
    thumbs=[]
    for p in paths[:32]:
        try:
            im=Image.open(p).convert('RGB'); im.thumbnail((250,210)); thumbs.append((p,im.copy()))
        except Exception: pass
    if not thumbs: return
    cols=4; rows=(len(thumbs)+cols-1)//cols
    canvas=Image.new('RGB',(cols*270,rows*245+45),'white'); draw=ImageDraw.Draw(canvas); draw.text((8,8),scope,fill='black')
    for i,(p,im) in enumerate(thumbs):
        x=(i%cols)*270+8; y=(i//cols)*245+35; canvas.paste(im,(x,y)); draw.text((x,y+212),f'{i+1:02d} {p.name[:28]}',fill='black')
    canvas.save(SHEETS/f'{scope.replace("::","_")}.jpg',quality=88)

def main():
    pages=[]; assets=[]; all_paths={}; global_sha={}
    for ti,t in enumerate(TARGETS,1):
        try:
            r=SESSION.get(t.url,headers=HEADERS,timeout=35,allow_redirects=True)
            status=r.status_code; final=str(r.url); raw=r.text
        except Exception as exc:
            status=0; final=t.url; raw=f'ERROR {type(exc).__name__}: {exc}'
        soup=BeautifulSoup(raw,'html.parser')
        title=soup.title.get_text(' ',strip=True) if soup.title else ''
        text='\n'.join(x.strip() for x in soup.get_text('\n').splitlines() if x.strip())
        full_present=t.full_code.lower() in (title+'\n'+text).lower()
        urls=extract_images(raw,soup,final,t.host_allow)
        pages.append({'scope_key':t.scope_key,'full_code':t.full_code,'source_url':t.url,'final_url':final,'http_status':status,'title':title,'full_code_present':str(full_present).upper(),'candidate_image_urls':len(urls),'page_sha256':sha(raw.encode('utf-8',errors='ignore')),'captured_at_utc':now()})
        key=t.scope_key.replace('::','__')+'__'+str(ti)
        d=IMG/key; d.mkdir(exist_ok=True); all_paths.setdefault(key,[])
        for oi,u in enumerate(urls,1):
            rec={'scope_key':t.scope_key,'full_code':t.full_code,'source_url':t.url,'ordinal':oi,'image_url':u,'status':'','mime':'','bytes':0,'width':'','height':'','sha256':'','local_path':'','duplicate_of':'','captured_at_utc':now()}
            try:
                ir=SESSION.get(u,headers={**HEADERS,'referer':final},timeout=30)
                rec['mime']=ir.headers.get('content-type','').split(';')[0]
                if ir.status_code!=200: rec['status']=f'HTTP_{ir.status_code}'; assets.append(rec); continue
                data=ir.content; rec['bytes']=len(data); digest=sha(data); rec['sha256']=digest
                if digest in global_sha: rec['status']='BINARY_DUPLICATE'; rec['duplicate_of']=global_sha[digest]; assets.append(rec); continue
                image=Image.open(io.BytesIO(data)); rec['width'],rec['height']=image.size; image.verify()
                if rec['width']<250 or rec['height']<250: rec['status']='TOO_SMALL'; assets.append(rec); continue
                ext='.jpg' if 'jpeg' in rec['mime'] or 'jpg' in rec['mime'] else ('.png' if 'png' in rec['mime'] else '.webp')
                p=d/f'{ti:02d}_{oi:02d}_{digest[:12]}{ext}'; p.write_bytes(data); rec['local_path']=p.as_posix(); rec['status']='DOWNLOADED_PENDING_REVIEW'; global_sha[digest]=p.as_posix(); all_paths[key].append(p)
            except Exception as exc: rec['status']=f'ERROR_{type(exc).__name__}'
            assets.append(rec)
    for key,paths in all_paths.items(): make_sheet(key,paths)
    def wcsv(name,rows):
        headers=sorted({k for r in rows for k in r}) if rows else []
        with (OUT/name).open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=headers); w.writeheader(); w.writerows(rows)
    wcsv('page_capture.csv',pages); wcsv('image_assets_pending_review.csv',assets)
    manifest={'created_at_utc':now(),'policy':'APPEND_ONLY_FAIL_CLOSED','targets':len(TARGETS),'pages_http_200':sum(1 for p in pages if p['http_status']==200),'pages_with_full_code':sum(1 for p in pages if p['full_code_present']=='TRUE'),'asset_rows':len(assets),'downloaded_pending_review':sum(1 for a in assets if a['status']=='DOWNLOADED_PENDING_REVIEW'),'automatic_role_promotions':0,'automatic_canonical_promotions':0}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    (OUT/'README.md').write_text('# W003E Japanese resale physical capture\n\nNo automatic role or canonical promotion.\n',encoding='utf-8')
    lines=[]
    for p in sorted(x for x in OUT.rglob('*') if x.is_file() and x.name!='SHA256SUMS.txt'): lines.append(f'{sha(p.read_bytes())}  {p.relative_to(OUT).as_posix()}')
    (OUT/'SHA256SUMS.txt').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps(manifest,indent=2)); return 0

if __name__=='__main__': sys.exit(main())
