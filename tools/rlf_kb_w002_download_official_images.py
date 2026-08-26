#!/usr/bin/env python3
from __future__ import annotations
import csv, hashlib, json, mimetypes, os, re, sys, time, urllib.parse, xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from curl_cffi import requests

SITEMAP='https://www.fredperry.com/sitemap.xml'
MAX_BYTES=25*1024*1024
TIMEOUT=60

def now():return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
def norm_url(u):
 p=urllib.parse.urlsplit((u or '').strip());return urllib.parse.urlunsplit(('https',p.netloc.lower(),p.path.rstrip('/'),'',''))
def localname(t):return t.rsplit('}',1)[-1].lower()
def write_csv(p,rows,fields=None):
 p.parent.mkdir(parents=True,exist_ok=True)
 if fields is None:
  fields=[]
  for r in rows:
   for k in r:
    if k not in fields:fields.append(k)
 with p.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
def uncached(url):return re.sub(r'/cache/[a-f0-9]+/','/',url,flags=re.I)
def filename_tokens(url):
 fn=os.path.basename(urllib.parse.urlsplit(url).path);stem=fn.rsplit('.',1)[0]
 m=re.search(r'_V2_([^_]+)_(.+)$',stem,re.I)
 return (m.group(1).upper(),m.group(2).upper()) if m else ('','')
def role_for(token):
 if 'MOD1_FRONT' in token:return 'GEN_FRONT_FULL'
 if 'MOD2_SIDE' in token:return 'GEN_SIDE_OR_INTERIOR'
 if 'MOD3_BACK' in token:return 'GEN_BACK_FULL'
 if token=='FLATBACK' or token.endswith('_FLATBACK'):return 'GEN_BACK_FULL_ALT'
 if token=='FLATFRONT' or token.endswith('_FLATFRONT'):return 'GEN_FRONT_FULL_ALT'
 if token=='SWATCH' or token.endswith('_SWATCH'):return 'COLOUR_SWATCH_REFERENCE'
 if re.fullmatch(r'ED\d+',token):return 'EDITORIAL_CONTEXT_CANDIDATE'
 if token.startswith('FLAT'):return 'GENERIC_FLAT_CANDIDATE'
 return 'UNCLASSIFIED_OFFICIAL_IMAGE'
def extension(ct,url):
 ext=mimetypes.guess_extension((ct or '').split(';')[0].lower()) or Path(urllib.parse.urlsplit(url).path).suffix
 if ext=='.jpe':ext='.jpg'
 return ext if ext.lower() in {'.jpg','.jpeg','.png','.webp','.avif'} else '.bin'
def fetch_image(session,url,referer,dest):
 row={'cached_image_url':url,'original_image_url':uncached(url),'download_status':'','http_status':'','mime_type':'','bytes':'','sha256':'','local_path':''}
 for attempt in range(1,4):
  try:
   resp=session.get(url,headers={'Referer':referer,'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'},impersonate='chrome',timeout=TIMEOUT)
   row['http_status']=str(resp.status_code);row['mime_type']=resp.headers.get('content-type','')[:120]
   if resp.status_code==200 and row['mime_type'].lower().startswith('image/'):
    data=resp.content
    if len(data)>MAX_BYTES:row['download_status']='TOO_LARGE';return row
    ext=extension(row['mime_type'],resp.url);path=dest.with_suffix(ext);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    row.update(download_status='DOWNLOADED',bytes=str(len(data)),sha256=hashlib.sha256(data).hexdigest(),local_path=path.as_posix());return row
   row['download_status']=f'HTTP_{resp.status_code}'
  except Exception as e:row['download_status']='REQUEST_ERROR';row['error']=f'{type(e).__name__}: {e}'[:400]
  time.sleep(0.5*attempt)
 return row

def main():
 seeds=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 seedrows=list(csv.DictReader(seeds.open(encoding='utf-8-sig')));official={}
 for r in seedrows:
  for u in json.loads(r['source_urls_json']):
   if 'fredperry.com' in urllib.parse.urlsplit(u).netloc.lower():official[norm_url(u)]=r
 s=requests.Session();xml=s.get(SITEMAP,impersonate='chrome',timeout=TIMEOUT);xml.raise_for_status();root=ET.fromstring(xml.content)
 entries={}
 for node in root:
  if localname(node.tag)!='url':continue
  page='';lastmod='';images=[]
  for child in node:
   ln=localname(child.tag)
   if ln=='loc' and child.text:page=norm_url(child.text)
   elif ln=='lastmod' and child.text:lastmod=child.text.strip()
   elif ln=='image':
    d={localname(x.tag):(x.text or '').strip() for x in child if x.text}
    if d.get('loc'):images.append(d)
  if page:entries[page]={'lastmod':lastmod,'images':images}
 assets=[];missing=[];coverage=[]
 for page,seed in official.items():
  entry=entries.get(page); candidate_assets=[]
  if not entry:
   missing.append({'candidate_id':seed['candidate_id'],'style_code':seed['style_code'],'colour_code':seed['colour_code'],'official_product_url':page,'reason':'OFFICIAL_SITEMAP_ENTRY_NOT_FOUND'});continue
  for i,im in enumerate(entry['images'],1):
   batch,token=filename_tokens(im['loc']);role=role_for(token)
   d=fetch_image(s,im['loc'],page,out/'images'/seed['candidate_id']/f'{i:02d}_{token or "UNKNOWN"}')
   d.update({'candidate_id':seed['candidate_id'],'style_code':seed['style_code'],'colour_code':seed['colour_code'],'official_product_url':page,'image_index':str(i),'official_filename':os.path.basename(urllib.parse.urlsplit(im['loc']).path),'asset_batch_token':batch,'asset_batch_interpretation':'SOURCE_ASSET_TOKEN_NOT_PRODUCTION_SEASON','filename_role_token':token,'assigned_role':role,'role_basis':'OFFICIAL_FILENAME_TOKEN','image_title':im.get('title',''),'image_caption':im.get('caption',''),'sitemap_lastmod':entry['lastmod'],'captured_at_utc':now()})
   assets.append(d);candidate_assets.append(d)
  roles=defaultdict(int)
  for a in candidate_assets:
   if a['download_status']=='DOWNLOADED':roles[a['assigned_role']]+=1
  coverage.append({'candidate_id':seed['candidate_id'],'style_code':seed['style_code'],'colour_code':seed['colour_code'],'official_product_url':page,'images_listed':len(candidate_assets),'images_downloaded':sum(a['download_status']=='DOWNLOADED' for a in candidate_assets),'front_complete':int(roles['GEN_FRONT_FULL']>0),'side_complete':int(roles['GEN_SIDE_OR_INTERIOR']>0),'back_complete':int(roles['GEN_BACK_FULL']>0 or roles['GEN_BACK_FULL_ALT']>0),'context_detail_complete':0,'swatch_available':int(roles['COLOUR_SWATCH_REFERENCE']>0),'editorial_candidates':roles['EDITORIAL_CONTEXT_CANDIDATE'],'forensic_macros_complete':0,'sitemap_lastmod_not_production_date':entry['lastmod']})
 write_csv(out/'w002_official_image_assets_downloaded.csv',assets)
 write_csv(out/'w002_candidate_generic_role_coverage.csv',coverage)
 write_csv(out/'w002_missing_official_candidates.csv',missing)
 manifest={'schema':'RLF_KB_W002_OFFICIAL_IMAGE_BYTES_V2','generated_at_utc':now(),'policy':'APPEND_ONLY_FAIL_CLOSED','sitemap_url':SITEMAP,'sitemap_sha256':hashlib.sha256(xml.content).hexdigest(),'candidates':len(seedrows),'matched_candidates':len(coverage),'missing_candidates':len(missing),'image_records':len(assets),'images_downloaded':sum(a['download_status']=='DOWNLOADED' for a in assets),'bytes_downloaded':sum(int(a['bytes'] or 0) for a in assets),'candidates_front_complete':sum(int(c['front_complete']) for c in coverage),'candidates_side_complete':sum(int(c['side_complete']) for c in coverage),'candidates_back_complete':sum(int(c['back_complete']) for c in coverage),'candidates_context_detail_complete':0,'forensic_macros_complete':0,'guardrails':['Only explicit official filename tokens assign generic roles','FLATBACK may satisfy back role; editorial images do not satisfy context/detail automatically','Asset batch tokens such as Q226 are not treated as production dates or seasons','No macros inferred from standard product imagery','No canonical production variant promoted']}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 (out/'README.md').write_text('# RLF KB W002 official image bytes V2\n\nOfficial Fred Perry sitemap images downloaded with browser-compatible transport. Roles are assigned only from explicit official filename tokens.\n',encoding='utf-8')
 sums=[]
 for p in sorted(x for x in out.rglob('*') if x.is_file() and x.name!='SHA256SUMS.txt'):sums.append(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out).as_posix()}')
 (out/'SHA256SUMS.txt').write_text('\n'.join(sums)+'\n',encoding='utf-8')
 print(json.dumps(manifest))
if __name__=='__main__':main()
