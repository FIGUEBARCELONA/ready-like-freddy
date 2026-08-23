import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Database, FileImage, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

function Tone({ value }: { value: string }) {
  const className = value.includes("OPERATIONAL") || value.includes("COMPLETE") || value.includes("CAPTURED")
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : value.includes("FAIL") || value.includes("BLOCK") || value.includes("NOT_CONNECTED")
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";
  return <Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] ${className}`}>{value.replaceAll("_", " ")}</Badge>;
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string | number; detail: string; icon: typeof Database }) {
  return <Card className="border-stone-200 bg-white"><CardContent className="flex items-start justify-between p-5"><div><p className="text-[10px] font-bold tracking-[0.18em] text-stone-500">{label}</p><p className="mt-2 font-serif text-3xl text-stone-900">{value}</p><p className="mt-1 text-xs text-stone-500">{detail}</p></div><span className="rounded-xl bg-stone-900 p-2.5 text-white"><Icon className="h-4 w-4" /></span></CardContent></Card>;
}

export default function ExecutionDashboard() {
  const status = trpc.execution.status.useQuery(undefined, { refetchInterval: 10_000 });
  const data = status.data;
  const counters = data?.counters ?? { productUrlCandidates: 0, productPagesCaptured: 0, imageReferences: 0, canonicalUniqueProducts: 0 };

  if (status.isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-stone-500" /></div>;
  if (status.error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">{status.error.message}</div>;
  if (!data) return null;

  return <div className="mx-auto max-w-[1540px] space-y-6 pb-10">
    <header className="relative overflow-hidden rounded-3xl border border-stone-200 bg-stone-950 px-6 py-7 text-white sm:px-8">
      <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-[#c6a15b]/30" />
      <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><p className="text-[10px] font-bold tracking-[0.26em] text-[#d9bc7a]">READY LIKE FREDDY · EXECUCIÓ REAL</p><h1 className="mt-3 font-serif text-3xl sm:text-4xl">Dashboard verificable de 50 paral·lelitzacions</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-stone-300">Cua oficial, descoberta per categories, frontera d’URLs de producte, captura de fitxes individuals i referències visuals. Cap candidat es converteix en producte únic canònic sense deduplicació i evidència.</p></div>
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><span className={`h-2.5 w-2.5 rounded-full ${data.backendStatus === "OPERATIONAL" ? "bg-emerald-300" : data.backendStatus === "DEGRADED" ? "bg-amber-300" : "bg-red-300"}`} /><div><p className="text-[10px] font-bold tracking-[0.18em] text-stone-400">BACKEND</p><p className="text-xs">{data.backendStatus.replaceAll("_", " ")}</p></div></div>
      </div>
    </header>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="DESCOBERTA" value={`${data.discovery?.completedWorkers ?? 0}/50`} detail="pistes amb font útil" icon={ShieldCheck} />
      <Metric label="URLS DE PRODUCTE" value={counters.productUrlCandidates} detail="candidates úniques, no canòniques" icon={Database} />
      <Metric label="FITXES CAPTURADES" value={counters.productPagesCaptured} detail={`${data.product?.completedWorkers ?? 0}/50 pistes de detall`} icon={CheckCircle2} />
      <Metric label="REFERÈNCIES D’IMATGE" value={counters.imageReferences} detail="drets UNKNOWN, no ingerides" icon={FileImage} />
    </div>

    <Card className="border-stone-200"><CardHeader className="border-b border-stone-100"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div className="space-y-2"><div className="flex flex-wrap gap-2"><Tone value={data.backendStatus} /><Tone value={data.discovery?.transportStatus ?? "DISCOVERY_PENDING"} /><Tone value={data.product?.transportStatus ?? "PRODUCT_STAGE_PENDING"} /></div><CardTitle className="font-serif text-2xl">Manifestos, procedència i bloquejos</CardTitle><CardDescription>Últim checkpoint persistit: run {data.latestRunId ?? "no disponible"}.</CardDescription></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => status.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Actualitzar</Button>{data.runUrl ? <Button variant="outline" size="sm" asChild><a href={data.runUrl} target="_blank" rel="noreferrer">Obrir run</a></Button> : null}</div></div></CardHeader><CardContent className="grid gap-5 p-5 xl:grid-cols-[1fr_1fr]"><div className="space-y-3"><div className="rounded-xl border border-stone-200 bg-stone-50 p-4"><p className="text-[10px] font-bold tracking-[0.16em] text-stone-500">SHA-256 DESCOBERTA</p><p className="mt-2 break-all font-mono text-[10px] leading-5">{data.discovery?.manifestSha256 ?? "pendent"}</p></div><div className="rounded-xl border border-stone-200 bg-stone-50 p-4"><p className="text-[10px] font-bold tracking-[0.16em] text-stone-500">SHA-256 PRODUCTE</p><p className="mt-2 break-all font-mono text-[10px] leading-5">{data.product?.manifestSha256 ?? "pendent"}</p></div><p className="text-sm text-stone-600"><b>Productes canònics validats:</b> {counters.canonicalUniqueProducts}. El valor roman a zero fins al gate de deduplicació transversal.</p></div><div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4"><p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.16em] text-amber-800"><TriangleAlert className="h-4 w-4" />BLOQUEJOS OBERTS</p><div className="mt-3 flex flex-wrap gap-2">{data.blockers.map((blocker: string) => <Tone key={blocker} value={blocker} />)}</div><p className="mt-4 text-xs leading-5 text-amber-900">Les fàbriques, dates, materials i imatges requereixen evidència específica. La regió de venda no s’utilitza mai per inferir lloc de fabricació.</p></div></CardContent></Card>

    <Card className="border-stone-200"><CardHeader className="border-b border-stone-100"><CardTitle className="font-serif text-2xl">F01–F50: descoberta i fitxa individual</CardTitle><CardDescription>Estat de cada pista llegit del manifest persistit, independent dels slots lògics de la base de dades.</CardDescription></CardHeader><CardContent className="p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{data.workers.map((worker: any) => <div key={worker.slot} className="rounded-2xl border border-stone-200 bg-white p-4"><div className="flex items-center justify-between"><span className="font-serif text-xl">{worker.slot}</span><Tone value={`DISCOVERY_${worker.discovery?.status ?? "PENDING"}`} /></div><div className="mt-2"><Tone value={`PRODUCT_${worker.product?.status ?? "PENDING"}`} /></div><div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-stone-500"><span>URLs <b className="text-stone-800">{worker.discovery?.productUrls ?? 0}</b></span><span>Imatges <b className="text-stone-800">{worker.product?.images ?? worker.discovery?.images ?? 0}</b></span><span>Desc. OK <b className="text-stone-800">{worker.discovery?.successful ?? 0}</b></span><span>Prod. OK <b className="text-stone-800">{worker.product?.successful ?? 0}</b></span></div></div>)}</div></CardContent></Card>
  </div>;
}
