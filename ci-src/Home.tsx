import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDot, Database, LockKeyhole, ShieldCheck, TimerReset } from "lucide-react";

type ApparatusTask = {
  task_id: string;
  trading_name: string | null;
  candidate_country: string;
  domain: string | null;
  status: string;
  next_gate: string;
  position: number;
  priority_score: number;
  preflight_flags?: string[];
  attempt_count: number;
  lease_expires_at: string | null;
};

type ApparatusLane = {
  lane_id: string;
  status: string;
  active_lease_count: number;
  total: number;
  queued: number;
  leased: number;
  in_review: number;
  quarantine: number;
  blocked: number;
  verified: number;
  next_task_id: string | null;
  tasks: ApparatusTask[];
};

type ApparatusStatus = {
  apparatus_id: string;
  policy: string;
  wave_id: string;
  revision: number;
  updated_at: string;
  lane_count: number;
  counters: Record<string, number>;
  lanes: ApparatusLane[];
  invariants: Record<string, boolean>;
  lease_seconds: number;
  state_hash: string;
};

const statusLabel: Record<string, string> = {
  queued: "Cua",
  leased: "Reservada",
  in_review: "En revisió",
  verified: "Verificada",
  blocked: "Bloquejada",
  quarantine: "Quarantena",
  expired: "Expirada",
};

async function loadStatus(): Promise<ApparatusStatus> {
  const endpoints = ["/api/tracker/status", "/tracker/apparatus/status.json"];
  let lastError: unknown = null;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export default function Home() {
  const [status, setStatus] = useState<ApparatusStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => loadStatus()
      .then((value) => { if (active) { setStatus(value); setError(null); } })
      .catch((reason) => { if (active) setError(String(reason)); });
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const visibleLanes = useMemo(() => {
    if (!status || !filter.trim()) return status?.lanes ?? [];
    const needle = filter.trim().toLowerCase();
    return status.lanes
      .map((lane) => ({
        ...lane,
        tasks: lane.tasks.filter((task) =>
          [task.trading_name, task.domain, task.candidate_country, task.status, task.next_gate]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle)),
        ),
      }))
      .filter((lane) => lane.tasks.length > 0);
  }, [status, filter]);

  if (error && !status) {
    return <main className="min-h-screen bg-[#f3efe5] p-8 text-[#2c2b27]">Aparell de carrils no disponible: {error}</main>;
  }
  if (!status) {
    return <main className="min-h-screen bg-[#f3efe5] p-8 text-[#2c2b27]">Carregant aparell de 20 carrils…</main>;
  }

  const invariantsOk = Object.values(status.invariants).every(Boolean);
  const activeWork = (status.counters.leased || 0) + (status.counters.in_review || 0);

  return (
    <main className="min-h-screen bg-[#f3efe5] text-[#252521]">
      <header className="border-b border-black/20 px-6 py-6 lg:px-10">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-3 flex flex-wrap items-center gap-3 font-mono text-xs uppercase tracking-[0.2em] text-black/60">
            <span>RLF · Fase 1</span><span>•</span><span>{status.wave_id}</span><span>•</span><span>rev. {status.revision}</span>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="max-w-5xl text-4xl font-semibold leading-tight tracking-tight lg:text-6xl">Aparell fix de 20 carrils</h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-black/65">
                Cua persistent, propietat exclusiva per carril, leases temporals, historial append-only i promoció fail-closed. Cap tasca pot circular per dos carrils.
              </p>
            </div>
            <div className={`flex items-center gap-2 border px-4 py-3 text-sm ${invariantsOk ? "border-[#175B4A] bg-[#175B4A]/5 text-[#175B4A]" : "border-red-800 bg-red-800/5 text-red-800"}`}>
              <ShieldCheck className="h-5 w-5" />
              <span>{invariantsOk ? "Invariants confirmats" : "ERROR D’INVARIANTS"}</span>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1600px] gap-px border-b border-black/20 bg-black/20 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ["Tasques", status.counters.total || 0, Database],
          ["En cua", status.counters.queued || 0, CircleDot],
          ["Reservades", status.counters.leased || 0, LockKeyhole],
          ["En revisió", status.counters.in_review || 0, AlertTriangle],
          ["Quarantena", status.counters.quarantine || 0, TimerReset],
          ["Verificades", status.counters.verified || 0, CheckCircle2],
        ].map(([label, value, Icon]) => (
          <div key={String(label)} className="bg-[#f3efe5] px-6 py-5">
            <div className="mb-3 flex items-center justify-between text-black/45">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{String(label)}</span>
              <Icon className="h-4 w-4" />
            </div>
            <div className="text-3xl font-semibold tabular-nums">{Number(value).toLocaleString("ca-ES")}</div>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-[1600px] px-6 py-6 lg:px-10">
        <div className="mb-6 flex flex-col gap-3 border-b border-black/20 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Carrils persistents</h2>
            <p className="mt-1 text-sm text-black/55">
              {status.lane_count} carrils · {activeWork} tasques actives · lease {Math.round(status.lease_seconds / 60)} min · actualitzat {new Date(status.updated_at).toLocaleString("ca-ES")}
            </p>
          </div>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtra per botiga, domini, país o gate"
            className="w-full border border-black/25 bg-white/40 px-4 py-2.5 text-sm outline-none focus:border-[#175B4A] md:w-[360px]"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visibleLanes.map((lane) => (
            <article key={lane.lane_id} className="border border-black/20 bg-white/30">
              <div className="flex items-center justify-between border-b border-black/15 px-4 py-3">
                <div>
                  <div className="font-mono text-xs uppercase tracking-[0.18em] text-black/50">{lane.lane_id}</div>
                  <div className="mt-1 text-sm font-medium">{lane.total} tasques</div>
                </div>
                <div className="text-right font-mono text-[11px] uppercase text-black/50">
                  <div>{lane.leased} reservades</div>
                  <div>{lane.verified} verificades</div>
                </div>
              </div>
              <div className="divide-y divide-black/10">
                {lane.tasks.slice(0, filter ? lane.tasks.length : 5).map((task) => (
                  <div key={task.task_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{task.trading_name || "Sense nom comercial"}</div>
                        <div className="mt-1 truncate font-mono text-[11px] text-black/45">{task.domain || task.task_id}</div>
                      </div>
                      <span className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase ${task.status === "verified" ? "border-[#175B4A] text-[#175B4A]" : task.status === "leased" || task.status === "in_review" ? "border-amber-700 text-amber-800" : task.status === "blocked" ? "border-red-800 text-red-800" : "border-black/25 text-black/50"}`}>
                        {statusLabel[task.status] || task.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-black/50">
                      <span>{task.candidate_country} · intent {task.attempt_count}</span>
                      <span className="truncate pl-3">{String(task.next_gate || "").replaceAll("_", " ")}</span>
                    </div>
                    {task.lease_expires_at && <div className="mt-2 font-mono text-[10px] text-amber-800">lease fins {new Date(task.lease_expires_at).toLocaleTimeString("ca-ES")}</div>}
                    {task.preflight_flags && task.preflight_flags.length > 0 && <div className="mt-2 text-[10px] uppercase tracking-wide text-red-800">{task.preflight_flags.join(" · ")}</div>}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-[1600px] border-t border-black/20 px-6 py-4 font-mono text-[10px] uppercase tracking-wide text-black/45 lg:px-10">
        {status.apparatus_id} · {status.policy} · hash {status.state_hash?.slice(0, 20)}…
      </footer>
    </main>
  );
}
