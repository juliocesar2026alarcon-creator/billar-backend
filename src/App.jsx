// src/App.jsx — BILLAR JADE (Front conectado al backend “todo en uno”)
// - Login via /login
// - Mesas via /mesas (GET) y /mesas/:id/(abrir|pausar|retomar|cerrar) (PATCH)
// - Refresco auto (3 s) + refresco tras cada acción
// - Exportar CSV de /reportes (sep=;, BOM, coma decimal)
// - Fondo /bg-billar-azul.jpg (en /public)

import React, { useEffect, useMemo, useState } from "react";

/* =============================
   API client (mismo origen)
   ============================= */
const API = import.meta.env.VITE_API_URL || ""; // vacío = mismo dominio

async function http(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${txt}`);
  }
  return res.json().catch(() => ({}));
}

const api = {
  login: (username, password) =>
    http("/login", { method: "POST", body: { username, password } }),
  getMesas: (branchId) =>
    http(`/mesas${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`),
  abrirMesa: (id) => http(`/mesas/${id}/abrir`, { method: "PATCH" }),
  pausarMesa: (id) => http(`/mesas/${id}/pausar`, { method: "PATCH" }),
  retomarMesa: (id) => http(`/mesas/${id}/retomar`, { method: "PATCH" }),
  cerrarMesa: (id) => http(`/mesas/${id}/cerrar`, { method: "PATCH" }),
  getReportes: ({ from, to, branchId }) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (branchId) p.set("branchId", branchId);
    return http(`/reportes?${p.toString()}`);
  },
};

/* =============================
   Helpers UI
   ============================= */
const fmtTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (d) => new Date(d).toLocaleDateString();
const fmtTimeSec = (d) =>
  new Date(d).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const bs = (n) => `Bs ${Number(n || 0).toFixed(2)}`;

function useClock() {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return tick;
}

/* =============================
   App principal
   ============================= */
export default function App() {
  const tick = useClock();

  // Auth
  const [authUser, setAuthUser] = useState(null);

  // Sucursales básicas (demo)
  const branches = [
    { id: "jade", name: "BILLAR JADE" },
    { id: "anexo", name: "BILLAR JADE ANEXO" },
  ];
  const [selectedBranchId, setSelectedBranchId] = useState("jade");

  // Mesas desde backend
  const [mesas, setMesas] = useState([]);
  const [loadingMesas, setLoadingMesas] = useState(false);

  // Reportes
  const [showReports, setShowReports] = useState(false);
  const [reportFilter, setReportFilter] = useState(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return { from: todayISO, to: todayISO };
  });
  const [reportData, setReportData] = useState({ sessions: [], totals: {} });

  // Cargar mesas (una vez haya auth)
  useEffect(() => {
    if (!authUser) return;
    const load = async () => {
      try {
        setLoadingMesas(true);
        const list = await api.getMesas(selectedBranchId);
        setMesas(list);
      } catch (e) {
        console.error("Error mesas:", e.message);
      } finally {
        setLoadingMesas(false);
      }
    };
    load();

    // refresco automático cada 3 s
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [authUser, selectedBranchId]);

  async function refreshMesas() {
    try {
      const list = await api.getMesas(selectedBranchId);
      setMesas(list);
    } catch (e) {
      console.error("refreshMesas:", e.message);
    }
  }

  // Acciones
  async function handleAbrirMesa(id) {
    try {
      await api.abrirMesa(id);
      await refreshMesas();
    } catch (e) {
      alert("No se pudo abrir: " + e.message);
    }
  }
  async function handlePausarRetomar(mesa) {
    try {
      if (mesa?.status !== "ocupada" || !mesa?.session) {
        alert("La mesa no está ocupada.");
        return;
      }
      if (!mesa.session.isPaused) await api.pausarMesa(mesa.id);
      else await api.retomarMesa(mesa.id);
      await refreshMesas();
    } catch (e) {
      alert("No se pudo pausar/retomar: " + e.message);
    }
  }
  async function handleCerrarMesa(id, { imprimir }) {
    try {
      const r = await api.cerrarMesa(id);
      await refreshMesas();
      if (imprimir && r?.session) {
        // Si usas impresión, aquí llamarías a openTicket(r.session, nombreSucursal)
        window.print(); // placeholder
      }
    } catch (e) {
      alert("No se pudo cerrar: " + e.message);
    }
  }

  // Reportes
  async function loadReport() {
    try {
      const data = await api.getReportes({
        from: reportFilter.from,
        to: reportFilter.to,
        branchId: selectedBranchId,
      });
      setReportData(data);
    } catch (e) {
      alert("Error reportes: " + e.message);
    }
  }

  // Exportar CSV Excel-ES
  function exportReportCSV() {
    const SEP = ";";
    const dec = (n) =>
      String(Number(n ?? 0).toFixed(2)).replace(".", ",");
    const header = [
      "Desde",
      "Hasta",
      "Sucursal",
      "Mesa",
      "Cliente",
      "Cerrado por",
      "Inicio",
      "Fin",
      "Tiempo (min)",
      "Tarifa (Bs)",
      "Prod. bruto",
      "Desc. ítems",
      "Desc. mesa",
      "Prod. neto",
      "Total cobrado",
    ];
    const rows = (reportData.sessions || []).map((s) => [
      reportFilter.from,
      reportFilter.to,
      branches.find((b) => b.id === s.branchId)?.name || s.branchId || "",
      s.tableName,
      s.customerName || "",
      s.closedBy || "",
      fmtTime(s.start),
      fmtTime(s.end),
      s.tariff?.rounded || 0,
      dec(s.tariff?.amount || 0),
      dec(s.productosBruto || 0),
      dec(s.productosDesc || 0),
      dec(s.discountMesa || 0),
      dec(s.productosNeto || 0),
      dec(s.total || 0),
    ]);
    const toCSV = (arr, delimiter = SEP) =>
      arr.map((r) =>
        r
          .map((v) => {
            const s = String(v ?? "");
            const needs =
              s.includes('"') ||
              s.includes("\n") ||
              s.includes("\r") ||
              s.includes(delimiter);
            const esc = s.replace(/"/g, '""');
            return needs ? `"${esc}"` : esc;
          })
          .join(delimiter)
      ).join("\n");

    const csvCore = toCSV([header, ...rows], SEP);
    const content = "\uFEFF" + `sep=${SEP}\n` + csvCore;

    const blob = new Blob([content], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte_${reportFilter.from}_a_${reportFilter.to}_${selectedBranchId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Gate de Login
  if (!authUser) {
    return (
      <LoginScreen
        onLogin={async (u, p) => {
          try {
            const r = await api.login(u, p);
            setAuthUser(r.user);
            setSelectedBranchId(
              r.user.role === "Cajero" ? r.user.branchId : "jade"
            );
          } catch (e) {
            alert("Login falló: " + e.message);
          }
        }}
      />
    );
  }

  const selectedBranch =
    branches.find((b) => b.id === selectedBranchId) || branches[0];

  return (
    <div
      className="min-h-screen text-neutral-100"
      style={{
        backgroundImage: "url('/bg-billar-azul.jpg')",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center center",
      }}
    >
      {/* Overlay 30% para legibilidad */}
      <div className="min-h-screen" style={{ background: "rgba(0,0,0,.30)" }}>
        <header className="sticky top-0 z-30 bg-black/30 backdrop-blur border-b border-white/10">
          <div className="max-w-7xl mx-auto p-3 flex flex-wrap gap-3 items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold drop-shadow">Control de Billar</h1>
              <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-200 text-xs border border-emerald-300/30">
                {selectedBranch?.name}
              </span>
              <select
                className="border border-white/20 bg-black/30 rounded-lg px-2 py-1 text-sm"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <Clock tick={tick} />
            <div className="flex items-center gap-2 ml-4">
              <span className="text-xs text-neutral-300">
                {authUser.username} ({authUser.role})
              </span>
              <button
                className="border border-white/30 bg-black/30 px-2 py-1 rounded-lg text-xs hover:bg-black/40"
                onClick={() => setAuthUser(null)}
              >
                Salir
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Mesas */}
          <section className="lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold drop-shadow">Mesas</h2>
              <div className="text-xs text-neutral-200">
                {loadingMesas ? "Actualizando…" : " "}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {(mesas || []).map((t) => (
                <MesaCard
                  key={t.id}
                  table={t}
                  onStart={() => handleAbrirMesa(t.id)}
                  onPauseResume={() => handlePausarRetomar(t)}
                  onStop={(imprimir) => handleCerrarMesa(t.id, { imprimir })}
                />
              ))}
            </div>
          </section>

          {/* Panel derecho */}
          <section className="space-y-3">
            <div className="bg-white/15 backdrop-blur rounded-2xl shadow-sm border border-white/25 p-4">
              <h3 className="font-semibold mb-2 drop-shadow">Accesos rápidos</h3>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => {
                    setShowReports(true);
                    setTimeout(loadReport, 50);
                  }}
                  className="px-3 py-2 rounded-xl bg-white/15 border border-white/25 shadow-sm text-left hover:bg-white/25"
                >
                  📈 Reportes
                  <div className="text-xs text-neutral-200">Abrir como modal</div>
                </button>
              </div>
            </div>

            {/* Caja / Tarifas (visual simple, no persistente aquí) */}
            <div className="bg-white/15 backdrop-blur rounded-2xl shadow-sm border border-white/25 p-4">
              <h3 className="font-semibold mb-2 drop-shadow">Tarifas (referencia)</h3>
              <div className="text-xs text-neutral-200">
                La tarifa real se calcula en el backend.
              </div>
            </div>
          </section>
        </main>

        {/* Modal Reportes */}
        {showReports && (
          <Modal title="Reportes" onClose={() => setShowReports(false)}>
            <div className="flex flex-wrap gap-2 items-center text-sm mb-3">
              <label className="flex items-center gap-1">
                Desde
                <input
                  type="date"
                  className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
                  value={reportFilter.from}
                  onChange={(e) =>
                    setReportFilter((f) => ({ ...f, from: e.target.value }))
                  }
                />
              </label>
              <label className="flex items-center gap-1">
                Hasta
                <input
                  type="date"
                  className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
                  value={reportFilter.to}
                  onChange={(e) =>
                    setReportFilter((f) => ({ ...f, to: e.target.value }))
                  }
                />
              </label>
              <button
                className="px-3 py-1.5 rounded-xl bg-white text-neutral-900 border border-neutral-300 shadow-sm hover:bg-neutral-50"
                onClick={loadReport}
              >
                Actualizar
              </button>
              <button
                className="px-3 py-1.5 rounded-xl bg-white text-neutral-900 border border-neutral-300 shadow-sm hover:bg-neutral-50"
                onClick={exportReportCSV}
              >
                Exportar CSV
              </button>
            </div>

            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span>Tiempo facturado:</span>
                <span>{reportData?.totals?.tiempo || 0} min</span>
              </div>
              <div className="flex justify-between">
                <span>Total productos (neto):</span>
                <span>{bs(reportData?.totals?.productos || 0)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Total cobrado:</span>
                <span>{bs(reportData?.totals?.total || 0)}</span>
              </div>
            </div>

            <details className="mt-3" open>
              <summary className="text-sm text-neutral-700 cursor-pointer">
                Sesiones (detallado)
              </summary>
              <div className="mt-2 max-h-72 overflow-auto pr-1 space-y-1">
                {(reportData.sessions || []).map((s) => (
                  <div key={s.id} className="text-xs border rounded-lg p-2">
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <b>Mesa:</b> {s.tableName}
                      </div>
                      <div>
                        <b>Cliente:</b> {s.customerName || "—"}
                      </div>
                      <div>
                        <b>Inicio:</b> {fmtTime(s.start)}
                      </div>
                      <div>
                        <b>Fin:</b> {fmtTime(s.end)}
                      </div>
                      <div>
                        <b>Tiempo (min):</b> {s.tariff?.rounded || 0}
                      </div>
                      <div>
                        <b>Tarifa:</b> {bs(s.tariff?.amount || 0)}
                      </div>
                      <div>
                        <b>Prod. neto:</b> {bs(s.productosNeto || 0)}
                      </div>
                      <div className="font-semibold">
                        <b>Total:</b> {bs(s.total || 0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </Modal>
        )}

        {/* Impresión (si la usas) */}
        <div aria-hidden className="print:block hidden">
          <div id="ticket" className="ticket w-[80mm] p-3 text-sm font-mono bg-white text-black">
            {/* Aquí podrías renderizar un Ticket80mm si lo necesitas */}
          </div>
        </div>

        <style>{`
          @media print {
            @page { size: 80mm auto; margin: 4mm; }
            body * { visibility: hidden; }
            #ticket, #ticket * { visibility: visible; }
            #ticket { position: absolute; left: 0; top: 0; }
          }
        `}</style>
      </div>
    </div>
  );
}

/* =============================
   Componentes UI
   ============================= */

function Clock({ tick }) {
  return (
    <div className="text-right">
      <div className="text-xl font-mono leading-tight drop-shadow">
        {fmtTimeSec(tick)}
      </div>
      <div className="text-xs text-neutral-200/90 -mt-1">{fmtDate(tick)}</div>
    </div>
  );
}

function MesaCard({ table, onStart, onPauseResume, onStop }) {
  // cronómetro en vivo (client-side) usando los datos de session
  const [t, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const cronometro = useMemo(() => {
    if (!table?.session) return "00:00";
    const start = table.session.start || Date.now();
    const pausedMs = table.session.pausedMs || 0;
    const isPaused = table.session.isPaused || false;
    const pausedAt = table.session.pausedAt || null;
    const extraPause = isPaused ? Date.now() - (pausedAt || Date.now()) : 0;
    const ms = Math.max(0, Date.now() - start - pausedMs - extraPause);
    const sec = Math.floor(ms / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }, [t, table]);

  return (
    <div
      className={`rounded-2xl border border-white/25 shadow-sm p-3 backdrop-blur ${
        table.status === "ocupada" ? "bg-emerald-500/15" : "bg-white/12"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{table.name}</div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${
            table.status === "ocupada"
              ? "bg-emerald-300/20 text-emerald-100 border-emerald-300/30"
              : "bg-white/15 text-neutral-100 border-white/25"
          }`}
        >
          {table.status}
        </span>
      </div>

      {table.status === "libre" && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-200/90">Lista para usar</span>
          <button
            className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-sm"
            onClick={onStart}
          >
            Iniciar
          </button>
        </div>
      )}

      {table.status === "ocupada" && table.session && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {/* Izquierda: tiempo */}
            <div className="bg-white/12 rounded-xl p-2 border border-white/20">
              <div className="flex justify-between">
                <span>Inicio</span>
                <b>{fmtTime(table.session.start)}</b>
              </div>
              <div className="flex justify-between">
                <span>Cronómetro</span>
                <b>{cronometro}</b>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  className="px-2 py-1 rounded-lg bg-white/15 border border-white/25 text-xs"
                  onClick={onPauseResume}
                >
                  {table.session.isPaused ? "Retomar" : "Pausar"}
                </button>
              </div>
            </div>

            {/* Derecha: acciones rápidas */}
            <div className="bg-white/12 rounded-xl p-2 border border-white/20">
              <div className="font-medium mb-1">Acciones</div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1.5 rounded-xl bg-white/15 border border-white/25 shadow-sm text-sm"
                  onClick={() => onStop(false)}
                >
                  Cerrar (sin imprimir)
                </button>
                <button
                  className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-sm"
                  onClick={() => onStop(true)}
                >
                  Cerrar & imprimir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({ title = "", onClose, children }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white text-neutral-900 rounded-2xl shadow-2xl ring-1 ring-black/10 w-[min(92vw,900px)] max-h-[88vh] overflow-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="px-2 py-1 rounded-lg border" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* =============================
   Login simple
   ============================= */
function LoginScreen({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  return (
    <div className="min-h-screen grid place-items-center bg-neutral-50">
      <div className="w-full max-w-sm bg-white border rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-semibold text-center">Ingreso al Sistema</h1>
        <p className="text-xs text-neutral-500 text-center mb-4">
          Use sus credenciales para continuar
        </p>
        <label className="text-sm flex flex-col mb-2">
          <span>Usuario</span>
          <input
            className="border rounded-lg px-3 py-2"
            value={u}
            onChange={(e) => setU(e.target.value)}
          />
        </label>
        <label className="text-sm flex flex-col mb-3">
          <span>Contraseña</span>
          <input
            type="password"
            className="border rounded-lg px-3 py-2"
            value={p}
            onChange={(e) => setP(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onLogin(u, p);
            }}
          />
        </label>
        <button
          className="w-full px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700"
          onClick={() => onLogin(u, p)}
        >
          Ingresar
        </button>
        <div className="text-[11px] text-neutral-500 mt-3">
          <div>
            <b>Demo:</b> admin/123456 (Administrador) — cajero/123456 (Cajero)
          </div>
        </div>
      </div>
    </div>
  );
}
