#!/usr/bin/env python3
import hashlib,json,re
from pathlib import Path
import requests
from curl_cffi import requests as cfre

URL='https://www.fredperry.com/media/catalog/product/cache/ea6aa50a170819132a9e04137b7ef1b6/M/3/M3600_04C_V2_Q226_MOD1_FRONT.JPG'
REF='https://www.fredperry.com/m3600-m3600-04c.html'
OUT=Path('fp-image-access-diagnostic');OUT.mkdir(exist_ok=True)
variants=[('cached',URL),('uncached',re.sub(r'/cache/[a-f0-9]+/','/',URL))]
rows=[]

def save(label,resp):
 ct=resp.headers.get('content-type',''); data=resp.content
 row={'label':label,'status_code':resp.status_code,'content_type':ct,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'url':resp.url}
 if resp.status_code==200 and ct.lower().startswith('image/'):
  ext='.jpg' if 'jpeg' in ct.lower() else '.bin';(OUT/f'{label}{ext}').write_bytes(data);row['saved']=True
 else: row['saved']=False; (OUT/f'{label}.txt').write_bytes(data[:10000])
 rows.append(row)

for name,url in variants:
 for label,headers in [
  ('basic',{'User-Agent':'Mozilla/5.0'}),
  ('referer',{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36','Referer':REF,'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'}),
 ]:
  try: save(f'requests_{name}_{label}',requests.get(url,headers=headers,timeout=40))
  except Exception as e: rows.append({'label':f'requests_{name}_{label}','error':repr(e)})
 for imp in ['chrome','chrome124','chrome131','safari']:
  try: save(f'curlcffi_{name}_{imp}',cfre.get(url,headers={'Referer':REF},impersonate=imp,timeout=40))
  except Exception as e: rows.append({'label':f'curlcffi_{name}_{imp}','error':repr(e)})
(OUT/'diagnostic.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
print(json.dumps(rows))
