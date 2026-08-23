'use client';

import {useEffect,useState} from 'react';

export default function Page() {
  const [status,setStatus]=useState<any>(null);
  useEffect(()=>{
    const load=()=>fetch('/api/status',{cache:'no-store'}).then(r=>r.json()).then(setStatus);
    load();
    const id=setInterval(load,15000);
    return()=>clearInterval(id);
  },[]);
  const deployment=status?.deployment??{};
  const funnel=status?.funnel??{};
  const sweep=status?.sweep?.summary??{};
  const cards:[string,unknown][]=[
    ['Canònics',funnel.qualifiedSuppliers],
    ['Projectats',funnel.projectedQualified],
    ['Dominis sweep',sweep.uniqueDomains],
    ['Provisionals',sweep.qualifiedProvisional],
    ['Producte directe',sweep.directProductProvisional],
    ['ACCEPTED_4K',funnel.acceptedPool],
  ];
  return (
    <main style={{width:'min(1280px,calc(100% - 32px))',margin:'auto',padding:'36px 0'}}>
      <small style={{color:'#d6ff45',letterSpacing:2}}>READY LIKE FREDDY · RLF_REAL_ONLY_V1</small>
      <h1 style={{fontSize:'clamp(52px,9vw,100px)',lineHeight:.85,margin:'14px 0'}}>PARALLEL50</h1>
      <h2>{String(deployment.activeWorkers??0)}/50 monitor durable · sweep {String(deployment.latestSweepStatus??'—')}</h2>
      <p>Workflow 4.4.0 pinat · UE-27 · zero simulacions</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
        {cards.map(([label,value])=><article key={label} style={{padding:18,border:'1px solid #2d343e',borderRadius:12,background:'#151a20'}}><small>{label}</small><strong style={{display:'block',fontSize:42}}>{String(value??0)}</strong></article>)}
      </div>
      <pre style={{marginTop:24,whiteSpace:'pre-wrap',color:'#9aa5b1'}}>{JSON.stringify(sweep.providerStats??{},null,2)}</pre>
    </main>
  );
}
