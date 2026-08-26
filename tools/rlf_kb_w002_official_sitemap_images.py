#!/usr/bin/env python3
from __future__ import annotations
import csv, hashlib, json, mimetypes, sys, urllib.parse, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
import requests

SITEMAP='https://www.fredperry.com/sitemap.xml'
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 RLF-KB/1.0'
TIMEOUT=60
MAX_IMAGES=16
MAX_BYTES=20*1024*1024

def now(): return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
def norm_url(u):
 p=urllib.parse.urlsplit((u or '').strip()); return urllib.parse.urlunsplit(('https',p.netloc.lower(),p.path.rstrip('/'),'',''))
def localname(tag): return tag.rsplit('}',1)[-1].lower()
def write_csv(path,rows,fields=None):
 path.parent.mkdir(parents=True,exist_ok=True)
 if fields is None:
  fields=[]
  for r in rows:
   for k in r:
    if k not in fields: fields.append(k)
 with path.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
def ext_for(ct,url):
 ext=mimetypes.guess_extension((ct or '').split(';')[0].lower()) or Path(urllib.parse.urlsplit(url).path).suffix
 if ext=='.jpe': ext='.jpg'
 return ext if ext in {'.jpg','.jpeg','.png','.webp','.avif','.gif'} else '.bin'
def download(session,url,base):
 r={'image_url':url,'status':'','http_status':'','mime_type':'','bytes':'','sha256':'','local_path':''}
 try:
  with session.get(url,timeout=TIMEOUT,stream=True) as resp:
   r['http_status']=str(resp.status_code);r['mime_type']=resp.headers.get('content-type','')[:120]
   if resp.status_code>=400:r['status']='HTTP_ERROR';return r
   chunks=[];n=0
   for c in resp.iter_content(65536):
    if not c:continue
    n+=len(c)
    if n>MAX_BYTES:r['status']='TOO_LARGE';return r
    chunks.append(c)
   data=b''.join(chunks)
   if not data:r['status']='EMPTY';return r
   digest=hashlib.sha256(data).hexdigest(); path=base.with_suffix(ext_for(r['mime_type'],resp.url));path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
   r.update(status='DOWNLOADED',bytes=str(len(data)),sha256=digest,local_path=path.as_posix());return r
 except Exception as e:r['status']='REQUEST_ERROR';r['error']=f'{type(e).__name__}: {e}'[:400];return r

def main():
 seeds=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 rows=list(csv.DictReader(seeds.open(encoding='utf-8-sig')))
 official={}
 for r in rows:
  for u in json.loads(r['source_urls_json']):
   if 'fredperry.com' in urllib.parse.urlsplit(u).netloc.lower(): official[norm_url(u)]=r
 session=requests.Session();session.headers.update({'User-Agent':UA,'Accept':'application/xml,text/xml,*/*'})
 resp=session.get(SITEMAP,timeout=TIMEOUT);resp.raise_for_status();root=ET.fromstring(resp.content)
 entries={}
 for node in root:
  if localname(node.tag)!='url':continue
  page='';lastmod='';images=[]
  for child in node:
   ln=localname(child.tag)
   if ln=='loc' and child.text: page=norm_url(child.text)
   elif ln=='lastmod' and child.text:lastmod=child.text.strip()
   elif ln=='image':
    d={}
    for x in child:
     if x.text:d[localname(x.tag)]=x.text.strip()
    if d.get('loc'):images.append(d)
  if page:entries[page]={'lastmod':lastmod,'images':images}
 observations=[];assets=[];missing=[]
 for page,seed in official.items():
  e=entries.get(page)
  observations.append({'candidate_id':seed['candidate_id'],'style_code':seed['style_code'],'colour_code':seed['colour_code'],'official_product_url':page,'sitemap_match':'1' if e else '0','sitemap_lastmod':e.get('lastmod','') if e else '','image_count':str(len(e.get('images',[]))) if e else '0','source_url':SITEMAP,'captured_at_utc':now()})
  if not e or not e.get('images'):
   missing.append({'candidate_id':seed['candidate_id'],'style_code':seed['style_code'],'colour_code':seed['colour_code'],'official_product_url':page,'reason':'NO_MATCH_OR_NO_IMAGE_METADATA','status':'OPEN'})
   continue
  for i,im in enumerate(e['images'][:MAX_IMAGES],1):
   d=download(session,im['loc'],out/'images'/seed['candidate_id']/f'official_{i:02d}')
   d.update({'candidate_id':seed['candidate_id'],'style_code':seed['style_code'],'colour_code':seed['colour_code'],'official_product_url':page,'image_index':str(i),'image_title':im.get('title',''),'image_caption':im.get('caption',''),'image_license':im.get('license',''),'proposed_role':f'OFFICIAL_SITEMAP_UNCLASSIFIED_{i:02d}','role_status':'VISUAL_REVIEW_REQUIRED','captured_at_utc':now()})
   assets.append(d)
 write_csv(out/'w002_official_sitemap_observations.csv',observations)
 write_csv(out/'w002_official_image_assets.csv',assets)
 write_csv(out/'w002_official_missing_queue.csv',missing)
 manifest={'schema':'RLF_KB_W002_OFFICIAL_SITEMAP_IMAGES_V1','generated_at_utc':now(),'sitemap_url':SITEMAP,'sitemap_http_status':resp.status_code,'sitemap_sha256':hashlib.sha256(resp.content).hexdigest(),'seed_candidates':len(rows),'official_urls':len(official),'matched_entries':sum(r['sitemap_match']=='1' for r in observations),'candidates_with_image_metadata':sum(int(r['image_count'])>0 for r in observations),'image_records':len(assets),'images_downloaded':sum(r['status']=='DOWNLOADED' for r in assets),'missing_candidates':len(missing),'guardrails':['Sitemap lastmod is not a production date','Image order is not treated as a role without visual review','No product identity is promoted automatically']}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 (out/'README.md').write_text('# RLF KB W002 official sitemap image recovery\n\nOfficial sitemap image metadata and original bytes for W001 candidates. Image roles remain unclassified pending visual review.\n',encoding='utf-8')
 sums=[]
 for p in sorted(x for x in out.rglob('*') if x.is_file() and x.name!='SHA256SUMS.txt'):sums.append(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out).as_posix()}')
 (out/'SHA256SUMS.txt').write_text('\n'.join(sums)+'\n',encoding='utf-8')
 print(json.dumps(manifest))
if __name__=='__main__':main()
