// ==== BLOQUE 1/3 — IMPORTS, HELPERS, API, CONFIG & PERSISTENCIA ====
// (reemplaza desde la línea 1 de tu App.jsx)

import React, { useEffect, useMemo, useState } from "react";
import { deepClone } from "./safeClone.js";

/** Formateos básicos */
const bs = (n) => `Bs ${Number(n || 0).toFixed(2)}`;
const to2 = (n) => Number(n || 0).toFixed(2);
const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtTimeSec = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDate = (d) => new Date(d).toLocaleDateString();
const fmtISODate = (d) => new Date(d).toISOString().slice(0, 10);
const nowTs = () => Date.now();

/** Cobro por tiempo (fraccionado) */
function computeCharge({ start, end, ratePerHour, minMinutes, fractionMinutes, pausedMs = 0 }) {
  const effectiveMs = Math.max(0, end - start - Math.max(0, pausedMs));
  const minutes = Math.max(0, Math.ceil(effectiveMs / 60000));
  const rounded = Math.max(minMinutes, Math.ceil(minutes / fractionMinutes) * fractionMinutes);
  const perMinute = ratePerHour / 60;
  const amount = perMinute * rounded;
  return { minutes, rounded, amount };
}

/** Id simple */
function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** CSV robusto */
function toCSV(rows, delimiter = ";") {
  const escape = (v) => {
    const s = String(v ?? "");
    const needsQuote =
      s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delimiter);
    const escaped = s.replace(/"/g, '""');
    return needsQuote ? `"${escaped}"` : escaped;
  };
  return rows.map((r) => r.map(escape).join(delimiter)).join("\n");
}

/** Regla de redondeo global 0.49/0.50 */
function roundBs(amount) {
  const n = Number(amount || 0);
  const dec = n - Math.floor(n);
  if (dec === 0) return Math.floor(n);
  if (dec < 0.49) return Math.floor(n);
  if (dec < 0.50) return Math.floor(n);
  return Math.ceil(n);
}

/* =============================
   API client (mismo origen)
   ============================= */
const API = import.meta.env.VITE_API_URL || ""; // vacío = mismo dominio

async function http(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${txt}`);
  }
  return res.json().catch(() => ({}));
}

const api = {
  // Auth
  login: (username, password) =>
    http("/login", { method: "POST", body: { username, password } }),

  // Mesas
  getMesas: (branchId, { signal } = {}) =>
    http(`/mesas${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ""}`, { signal }),
  abrirMesa: (id) => http(`/mesas/${id}/abrir`, { method: "PATCH" }),
  pausarMesa: (id) => http(`/mesas/${id}/pausar`, { method: "PATCH" }),
  retomarMesa: (id) => http(`/mesas/${id}/retomar`, { method: "PATCH" }),
  cerrarMesa: (id) => http(`/mesas/${id}/cerrar`, { method: "PATCH" }),

  // Reportes
  getReportes: ({ from, to, branchId }) => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (branchId) p.set("branchId", branchId);
    return http(`/reportes?${p.toString()}`);
  },
};

/* =============================
   Datos iniciales & Config
   ============================= */
const defaultBranches = [
  { id: "jade", name: "BILLAR JADE" },
  { id: "anexo", name: "BILLAR JADE ANEXO" },
];

function makeDefaultTables(n = 10) {
  return Array.from({ length: n }, (_, i) => ({
    id: uid("mesa"),
    name: `Mesa ${i + 1}`,
    status: "libre",
    session: null,
  }));
}

const defaultInventory = [
  { id: uid("item"), name: "Tiza", stock: 50, price: 2.0, cost: 0.8, unit: "u" },
  { id: uid("item"), name: "Bebida", stock: 40, price: 10.0, cost: 6.0, unit: "bot" },
  { id: uid("item"), name: "Snack", stock: 30, price: 8.0, cost: 4.0, unit: "u" },
];

/** Config global (visual/local) */
const defaultConfig = {
  ratePerHour: 15,
  fractionMinutes: 5,
  minMinutes: 30,
  currency: "Bs",
  tablesPerBranch: 10,
  roundingEnabled: true,
  ticketHeader: "",
  ticketLogo: "",
  agentPrintEnabled: false,
  supervisorPin: "4321",
  requirePinForDiscounts: true, // Cajero pide PIN; Admin nunca
};

// Persistencia local (para módulos locales: inventario, caja, usuarios)
const LS_KEY = "billiards_app_state_v4";
const AUTH_KEY = "billiards_app_auth_v4";
const USERS_KEY = "billiards_app_users_v4";

const DEFAULT_USERS = [
  { id: uid("usr"), username: "admin",  password: "123456", role: "Administrador", branchId: "jade", active: true },
  { id: uid("usr"), username: "cajero", password: "123456", role: "Cajero",       branchId: "jade", active: true },
];

function loadState() {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveState(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  catch {}
}
function loadAuth() {
  try { const raw = localStorage.getItem(AUTH_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveAuth(auth) {
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); }
  catch {}
}
function loadUsers() {
  try { const raw = localStorage.getItem(USERS_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function saveUsers(users) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); }
  catch {}
}
// ==== FIN BLOQUE 1/3 ====
// ==== BLOQUE 2/3 — APP: AUTH, MESAS BACKEND, CAJA/INVENTARIO LOCALES, LAYOUT & MODALES ====
export default function App() {
  // --- Auth & usuarios (local fallback para módulo Usuarios)
  const [authUser, setAuthUser] = useState(() => loadAuth());
  const [users, setUsers] = useState(() => loadUsers() || DEFAULT_USERS);
  useEffect(() => saveUsers(users), [users]);
  useEffect(() => saveAuth(authUser), [authUser]);

  // --- Estado global local (Inventario, Caja, Reportes locales)
  const [branches, setBranches] = useState(defaultBranches);
  const [selectedBranchId, setSelectedBranchId] = useState(() =>
    authUser?.role === "Cajero" ? (authUser.branchId || defaultBranches[0].id) : defaultBranches[0].id
  );
  const [config, setConfig] = useState(defaultConfig);
  const [byBranch, setByBranch] = useState(() => {
    const init = {};
    for (const b of defaultBranches) {
      init[b.id] = {
        tables: makeDefaultTables(defaultConfig.tablesPerBranch), // (no se usa para backend, se deja para UI legacy)
        inventory: [...defaultInventory],
        kardex: [],
        cash: { currentShift: null, shifts: [], closures: [] },
        sessions: [],
      };
    }
    return init;
  });

  // Carga/guarda estado local (no afecta a Mesas backend)
  useEffect(() => {
    const stored = loadState();
    if (stored && typeof stored === "object") {
      try {
        if (stored.branches) setBranches(stored.branches);
        if (stored.selectedBranchId) setSelectedBranchId(stored.selectedBranchId);
        if (stored.config) setConfig(stored.config);
        if (stored.byBranch) setByBranch(stored.byBranch);
      } catch (_) {
        console.warn("Estado previo inválido, se ignora.");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    saveState({ authUser, branches, selectedBranchId, config, byBranch });
  }, [authUser, branches, selectedBranchId, config, byBranch]);

  // Derivados
  const selectedBranch =
    branches.find((b) => b.id === selectedBranchId) || branches[0] || { id: "jade", name: "BILLAR JADE" };
  const branchState =
    byBranch[selectedBranchId] || {
      tables: [],
      inventory: [...defaultInventory],
      kardex: [],
      cash: { currentShift: null, shifts: [], closures: [] },
      sessions: [],
    };

  // Reloj global
  const [tick, setTick] = useState(nowTs());
  useEffect(() => {
    const t = setInterval(() => setTick(nowTs()), 1000);
    return () => clearInterval(t);
  }, []);

  // Mutación segura (para módulos locales)
  const updateByBranch = (updater) => {
    setByBranch((prev) => {
      const base = deepClone(prev || {});
      const res = updater(base) || base;
      return res;
    });
  };

  // ===== Inventario / Kardex (local)
  const pushKardex = (st, { itemId, name, type, qty, unitCost, ref }) => {
    st.kardex.push({
      id: uid("kx"),
      itemId,
      name,
      at: nowTs(),
      type,
      qty,
      unitCost: Number(unitCost || 0),
      ref,
    });
  };
  const ingresoStock = (item, qty, unitCost) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const inv = st.inventory.find((x) => x.id === item.id);
      if (!inv) return copy;
      const curVal = inv.cost * inv.stock;
      const newStock = inv.stock + qty;
      const newCost = newStock > 0 ? (curVal + qty * unitCost) / newStock : inv.cost;
      inv.stock = newStock;
      inv.cost = Number(newCost.toFixed(4));
      pushKardex(st, { itemId: inv.id, name: inv.name, type: "Ingreso", qty, unitCost, ref: null });
      return copy;
    });
  };
  const egresoStockManual = (item, qty, note = "Ajuste") => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      const inv = st.inventory.find((x) => x.id === item.id);
      if (!inv) return copy;
      inv.stock = Math.max(0, inv.stock - qty);
      pushKardex(st, { itemId: inv.id, name: inv.name, type: note, qty: -qty, unitCost: inv.cost, ref: null });
      return copy;
    });
  };

  // ===== MESAS (SINCRONIZADAS CON BACKEND) =====
  const [mesas, setMesas] = useState([]);
  const [syncing, setSyncing] = useState(false);      // spinner solo en acciones
  const [lastSyncAt, setLastSyncAt] = useState(null); // hora último sync
  const [ctrl, setCtrl] = useState(null);             // AbortController

  async function fetchMesas({ showBusy = false } = {}) {
    try {
      if (ctrl) ctrl.abort();
      const controller = new AbortController();
      setCtrl(controller);
      if (showBusy) setSyncing(true);
      const list = await api.getMesas(selectedBranchId, { signal: controller.signal });
      setMesas(list);
      setLastSyncAt(Date.now());
    } catch (e) {
      if (e.name !== "AbortError") console.error("fetchMesas:", e.message);
    } finally {
      if (showBusy) setSyncing(false);
    }
  }

  useEffect(() => {
    if (!authUser) return;
    fetchMesas({ showBusy: false });                    // primera carga
    const t = setInterval(() => fetchMesas({ showBusy: false }), 3000); // refresco suave cada 3s
    return () => clearInterval(t);
  }, [authUser, selectedBranchId]);

  async function handleAbrirMesa(id) {
    try {
      setSyncing(true);
      await api.abrirMesa(id);
      await fetchMesas({ showBusy: false });
    } catch (e) {
      alert("No se pudo abrir: " + e.message);
    } finally {
      setSyncing(false);
    }
  }
  async function handlePausarRetomar(mesa) {
    try {
      if (mesa?.status !== "ocupada" || !mesa?.session) {
        alert("La mesa no está ocupada.");
        return;
      }
      setSyncing(true);
      if (!mesa.session.isPaused) await api.pausarMesa(mesa.id);
      else await api.retomarMesa(mesa.id);
      await fetchMesas({ showBusy: false });
    } catch (e) {
      alert("No se pudo pausar/retomar: " + e.message);
    } finally {
      setSyncing(false);
    }
  }
  async function handleCerrarMesa(id, { imprimir }) {
    try {
      setSyncing(true);
      const r = await api.cerrarMesa(id);
      await fetchMesas({ showBusy: false });
      if (imprimir && r?.session) {
        // Puedes cambiar por openTicket(r.session, nombreSucursal) si usas impresión real
        window.print();
      }
    } catch (e) {
      alert("No se pudo cerrar: " + e.message);
    } finally {
      setSyncing(false);
    }
  }

  // ===== Descuentos (UI legacy) — quedan con aviso hasta tener endpoints =====
  const needPin = () => config.requirePinForDiscounts && authUser?.role !== "Administrador";
  const applyItemDiscount = () => alert("Descuento de Ítem: pendiente de endpoint en backend.");
  const applyMesaDiscount = () => {
    if (needPin()) {
      const pin = prompt("PIN Administrador:") || "";
      if (pin !== config.supervisorPin) { alert("PIN incorrecto"); return; }
    }
    alert("Descuento de Mesa: pendiente de endpoint en backend.");
  };
  const moveSessionToTable = () => alert("Mover consumo: pendiente de endpoint en backend.");
  const addItemToTable    = () => alert("Agregar producto: pendiente de endpoint en backend.");
  const removeItemFromTable = () => alert("Quitar producto: pendiente de endpoint en backend.");
  const removeLastFreeTable = () => alert("− Mesa: requiere endpoint DELETE /mesas/:id (pendiente).");

  // ===== Cerrar mesa LOCAL (legacy) — NO usar: queda para imprimir históricos si hiciera falta
  const stopTable = () => alert("Usa el botón Cerrar & Imprimir (con backend).");

  // ===== Caja (local)
  const abrirCaja = (initialCash) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      if (st.cash.currentShift) return copy;
      st.cash.currentShift = {
        id: uid("turno"),
        openedAt: nowTs(),
        openedBy: authUser?.username || "",
        initialCash: Number(initialCash) || 0,
        movements: [],
      };
      return copy;
    });
  };
  const movimientoCaja = (type, concept, amount) => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      if (!st.cash.currentShift) return copy;
      st.cash.currentShift.movements.push({
        id: uid("mov"),
        type,
        at: nowTs(),
        concept,
        amount: Number(amount) || 0,
        by: authUser?.username || "",
      });
      return copy;
    });
  };
  const cerrarCaja = () => {
    updateByBranch((copy) => {
      const st = copy[selectedBranchId] || (copy[selectedBranchId] = deepClone(branchState));
      if (!st.cash.currentShift) return copy;
      const cur = st.cash.currentShift;
      cur.closedAt = nowTs();
      cur.closedBy = authUser?.username || "";
      const ingresos = cur.movements.filter((m) => m.type === "venta" || m.type === "ingreso").reduce((a, m) => a + m.amount, 0);
      const egresos  = cur.movements.filter((m) => m.type === "egreso").reduce((a, m) => a + m.amount, 0);
      const totalCaja = cur.initialCash + ingresos - egresos;
      const ventas = cur.movements.filter((m) => m.type === "venta");
      const cierre = {
        id: uid("cierre"),
        branchId: selectedBranchId,
        branchName: selectedBranch?.name || "",
        openedAt: cur.openedAt,
        closedAt: cur.closedAt,
        openedBy: cur.openedBy,
        closedBy: cur.closedBy,
        initialCash: cur.initialCash,
        ingresos, egresos, totalCaja,
        ventasCount: ventas.length,
        ventasTotal: ventas.reduce((a, m) => a + m.amount, 0),
      };
      st.cash.shifts.push(cur);
      st.cash.closures.push(cierre);
      st.cash.currentShift = null;
      return copy;
    });
  };
  const cajaResumen = useMemo(() => {
    const st = branchState;
    const turno = st?.cash?.currentShift;
    if (!turno) return null;
    const ingresos = (turno.movements || []).filter((m) => m.type === "venta" || m.type === "ingreso").reduce((a, m) => a + m.amount, 0);
    const egresos  = (turno.movements || []).filter((m) => m.type === "egreso").reduce((a, m) => a + m.amount, 0);
    return { ingresos, egresos, totalCaja: (turno.initialCash || 0) + ingresos - egresos };
  }, [branchState]);

  // ===== Impresión / Ticket (opcional)
  const [ticketData, setTicketData] = useState(null);
  function openTicket(data, branchName) {
    const withBranch = { ...data, branchName };
    setTicketData(withBranch);
    if (config.agentPrintEnabled) {
      tryAgentPrint(withBranch).catch(() => window.print());
    } else {
      setTimeout(() => window.print(), 80);
    }
  }
  async function tryAgentPrint(payload) {
    try {
      const res = await fetch("http://localhost:18401/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "billar_ticket_v1", payload }),
      });
      if (!res.ok) throw new Error("Agente no respondió");
    } catch (e) {
      throw e;
    }
  }

  // ===== Reportes (desde backend)
  const [showReports, setShowReports] = useState(false);
  const [reportFilter, setReportFilter] = useState(() => ({
    from: fmtISODate(Date.now()),
    to: fmtISODate(Date.now()),
    cashier: "",
    table: "",
    product: "",
  }));
  const [reportData, setReportData] = useState({ sessions: [], totals: { tiempo: 0, productos: 0, total: 0, margen: 0 }, prodAgg: [], byCashier: [], byTable: [] });
  async function loadReport() {
    try {
      const data = await api.getReportes({ from: reportFilter.from, to: reportFilter.to, branchId: selectedBranchId });
      // El backend ya trae sessions y totals; agregados locales si necesitas
      // Para mantener compatibilidad con tu ReportsCard, llenamos campos esperados:
      const sessions = (data.sessions || []).map((s) => ({
        ...s,
        productosBruto: s.productosBruto ?? 0,
        productosDesc:  s.productosDesc  ?? 0,
        productosNeto:  s.productosNeto  ?? 0,
        discountMesa:   s.discountMesa   ?? 0,
        tariff: s.tariff || { rounded: 0, amount: 0 },
      }));
      // Agregados simples:
      const prodMap = new Map();
      for (const s of sessions) {
        for (const it of (s.items || [])) {
          const key = it.name;
          const agg = prodMap.get(key) || { name: key, qty: 0, venta: 0, costo: 0, margen: 0 };
          agg.qty    += it.qty;
          agg.venta  += (it.price * it.qty) - (it.disc || 0);
          agg.costo  += (it.cost  * it.qty);
          agg.margen += ((it.price * it.qty) - (it.disc || 0) - (it.cost * it.qty));
          prodMap.set(key, agg);
        }
      }
      const prodAgg = Array.from(prodMap.values());
      const cashMap = new Map();
      for (const s of sessions) {
        const k = s.closedBy || "—";
        const a = cashMap.get(k) || { cajero: k, ventas: 0 };
        a.ventas += s.total || 0;
        cashMap.set(k, a);
      }
      const byCashier = Array.from(cashMap.values());
      const tbMap = new Map();
      for (const s of sessions) {
        const k = s.tableName || "—";
        const a = tbMap.get(k) || { mesa: k, ventas: 0 };
        a.ventas += s.total || 0;
        tbMap.set(k, a);
      }
      const byTable = Array.from(tbMap.values());
      setReportData({
        sessions,
        totals: data.totals || { tiempo: 0, productos: 0, total: 0, margen: 0 },
        prodAgg, byCashier, byTable,
      });
    } catch (e) {
      alert("Error reportes: " + e.message);
    }
  }

  // ===== Usuarios (local UI)
  const createUser = () => {
    const username = prompt("Usuario:"); if (!username) return;
    const password = prompt("Contraseña inicial:") || "123456";
    const role = prompt("Rol (Administrador/Cajero):", "Cajero") || "Cajero";
    const branchId = prompt("Sucursal (id):", selectedBranchId) || selectedBranchId;
    setUsers((prev) => [...(prev || []), { id: uid("usr"), username, password, role, branchId, active: true }]);
  };
  const changePassword = (u) => {
    const np = prompt(`Nueva contraseña para ${u.username}:`, ""); if (!np) return;
    setUsers((prev) => (prev || []).map((x) => (x.id === u.id ? { ...x, password: np } : x)));
  };
  const toggleUser = (u) => {
    setUsers((prev) => (prev || []).map((x) => (x.id === u.id ? { ...x, active: !x.active } : x)));
  };

  // Eliminar ticket (solo Admin) local (para histórico local)
  function deleteSessionPermanent(sessionId) {
    if (authUser?.role !== "Administrador") { alert("Solo Administrador."); return; }
    if (!confirm("¿Eliminar este ticket de forma permanente?")) return;
    updateByBranch((copy) => {
      const st = (copy[selectedBranchId] ||= deepClone(branchState));
      st.sessions = (st.sessions || []).filter((s) => s.id !== sessionId);
      if (st.cash?.currentShift) {
        st.cash.currentShift.movements =
          (st.cash.currentShift.movements || []).filter((m) => m?.data?.sessionId !== sessionId);
      }
      for (const sh of (st.cash?.shifts || [])) {
        sh.movements = (sh.movements || []).filter((m) => m?.data?.sessionId !== sessionId);
      }
      return copy;
    });
  }

  // ===== Modales & Layout =====
  const [showInventory, setShowInventory] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const isCajero = authUser?.role === "Cajero";

  // Gate de Login — ahora usa backend; si falla, puedes volver a fallback local si quieres
  if (!authUser) {
    return (
      <LoginScreen
        onLogin={async (username, password) => {
          try {
            const r = await api.login(username, password);
            setAuthUser({ username: r.user.username, role: r.user.role, branchId: r.user.branchId });
            setSelectedBranchId(r.user.role === "Cajero" ? r.user.branchId : selectedBranchId);
          } catch (e) {
            // Fallback local por si el backend no responde:
            const found = (users || []).find((x) => x.username === username && x.password === password && x.active);
            if (found) {
              setAuthUser({ username: found.username, role: found.role, branchId: found.branchId });
              setSelectedBranchId(found.role === "Cajero" ? found.branchId : selectedBranchId);
            } else {
              alert("Usuario o contraseña incorrectos");
            }
          }
        }}
        onInitAdmin={() => setUsers(DEFAULT_USERS)}
      />
    );
  }

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
      {/* Overlay oscuro ~30% para legibilidad */}
      <div className="min-h-screen" style={{ background: "rgba(0,0,0,0.30)" }}>
        {/* Top bar */}
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
                disabled={isCajero}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2 text-xs text-neutral-200 ml-2">
                {syncing && (
                  <span className="inline-flex items-center gap-1">
                    <svg className="animate-spin h-3 w-3 text-emerald-300" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"></path>
                    </svg>
                    Sincronizando…
                  </span>
                )}
                {!syncing && lastSyncAt && (
                  <span className="opacity-80">
                    Sincronizado {new Date(lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                )}
              </div>
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

        {/* Contenido */}
        <main className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Mesas */}
          <section className="lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-semibold drop-shadow">Mesas</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => alert("Para + Mesa crea endpoint POST /mesas y lo conectamos.")}
                  className="px-3 py-1.5 rounded-xl bg-white/20 border border-white/30 shadow-sm text-sm hover:bg-white/25"
                >
                  + Mesa
                </button>
                <button
                  onClick={removeLastFreeTable}
                  className="px-3 py-1.5 rounded-xl bg-white/20 border border-white/30 shadow-sm text-sm hover:bg-white/25"
                >
                  − Mesa
                </button>
              </div>
            </div>

            {/* Grilla de mesas (desde backend) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {(mesas || []).map((t) => (
                <MesaCard
                  key={t.id}
                  table={t}
                  // Acciones con backend
                  onStart={() => handleAbrirMesa(t.id)}
                  onPauseResume={() => handlePausarRetomar(t)}
                  onStop={(imprimir) => handleCerrarMesa(t.id, { imprimir })}
                  // Props legacy (UI visible, por ahora muestran aviso)
                  config={config}
                  onRename={() => alert("Renombrar mesa: requiere endpoint PATCH /mesas/:id (pendiente).")}
                  inventory={branchState.inventory}
                  onAddItem={() => addItemToTable()}
                  onRemoveItem={() => removeItemFromTable()}
                  onCustomerChange={() => alert("Cliente: requiere endpoint PATCH /mesas/:id (pendiente).")}
                  onMove={() => moveSessionToTable()}
                  onItemDiscount={() => applyItemDiscount()}
                  onMesaDiscount={() => applyMesaDiscount()}
                />
              ))}
            </div>
          </section>

          {/* Panel derecho: Accesos + Tarifas + Caja */}
          <section className="space-y-3">
            <div className="bg-white/15 backdrop-blur rounded-2xl shadow-sm border border-white/25 p-4">
              <h3 className="font-semibold mb-2 drop-shadow">Accesos rápidos</h3>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setShowReports(true)}
                  className="px-3 py-2 rounded-xl bg-white/15 border border-white/25 shadow-sm text-left hover:bg-white/25"
                >
                  📈 Reportes
                  <div className="text-xs text-neutral-200">Abrir como modal</div>
                </button>
                <button
                  onClick={() => setShowInventory(true)}
                  className="px-3 py-2 rounded-xl bg-white/15 border border-white/25 shadow-sm text-left hover:bg-white/25"
                >
                  📦 Inventario
                  <div className="text-xs text-neutral-200">Abrir como modal</div>
                </button>
                <button
                  onClick={() => setShowConfig(true)}
                  className="px-3 py-2 rounded-xl bg-white/15 border border-white/25 shadow-sm text-left hover:bg-white/25"
                >
                  ⚙️ Configuración
                  <div className="text-xs text-neutral-200">Abrir como modal</div>
                </button>
                {authUser.role === "Administrador" && (
                  <button
                    onClick={() => setShowUsers(true)}
                    className="px-3 py-2 rounded-xl bg-white/15 border border-white/25 shadow-sm text-left hover:bg-white/25"
                  >
                    👤 Usuarios
                    <div className="text-xs text-neutral-200">Abrir como modal</div>
                  </button>
                )}
              </div>
            </div>

            {/* Tarifas */}
            <div className="bg-white/15 backdrop-blur rounded-2xl shadow-sm border border-white/25 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold drop-shadow">Tarifas (referencia)</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="flex flex-col">
                  <span>Tarifa (Bs/h)</span>
                  <input
                    type="number"
                    className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
                    value={config.ratePerHour}
                    onChange={(e) => setConfig((c) => ({ ...c, ratePerHour: Number(e.target.value) }))}
                  />
                </label>
                <label className="flex flex-col">
                  <span>Fracción (min)</span>
                  <input
                    type="number"
                    className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
                    value={config.fractionMinutes}
                    onChange={(e) => setConfig((c) => ({ ...c, fractionMinutes: Number(e.target.value) }))}
                  />
                </label>
                <label className="flex flex-col">
                  <span>Mínimo (min)</span>
                  <input
                    type="number"
                    className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
                    value={config.minMinutes}
                    onChange={(e) => setConfig((c) => ({ ...c, minMinutes: Number(e.target.value) }))}
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Redondeo 0.49/0.50</span>
                  <input
                    type="checkbox"
                    checked={config.roundingEnabled}
                    onChange={(e) => setConfig((c) => ({ ...c, roundingEnabled: e.target.checked }))}
                  />
                </label>
              </div>
            </div>

            {/* Caja */}
            <div className="bg-white/15 backdrop-blur rounded-2xl shadow-sm border border-white/25 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold drop-shadow">Caja</h3>
              </div>
              {!branchState.cash.currentShift ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Saldo inicial"
                      className="border border-white/30 bg-black/30 rounded-lg px-2 py-1 text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter") abrirCaja(e.currentTarget.value); }}
                    />
                    <button
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700"
                      onClick={() => {
                        const v = prompt("Saldo inicial de caja:", "0");
                        if (v != null) abrirCaja(Number(v));
                      }}
                    >
                      Abrir
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <div className="flex justify-between"><span>Inicio:</span><span>{fmtTime(branchState.cash.currentShift.openedAt)}</span></div>
                  <div className="flex justify-between"><span>Inicial:</span><span>{bs(branchState.cash.currentShift.initialCash)}</span></div>
                  <div className="flex justify-between"><span>Ingresos:</span><span>{bs(cajaResumen?.ingresos || 0)}</span></div>
                  <div className="flex justify-between"><span>Egresos:</span><span>{bs(cajaResumen?.egresos || 0)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Total caja:</span><span>{bs(cajaResumen?.totalCaja || 0)}</span></div>
                  <div className="flex gap-2 mt-2">
                    <button
                      className="px-3 py-1.5 rounded-xl bg-white/15 border border-white/25 shadow-sm text-sm"
                      onClick={() => {
                        const c = prompt("Concepto del ingreso:"); if (!c) return;
                        const a = prompt("Monto (Bs):", "0"); if (a != null) movimientoCaja("ingreso", c, Number(a));
                      }}
                    >
                      + Ingreso
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-xl bg-white/15 border border-white/25 shadow-sm text-sm"
                      onClick={() => {
                        const c = prompt("Concepto del egreso:"); if (!c) return;
                        const a = prompt("Monto (Bs):", "0"); if (a != null) movimientoCaja("egreso", c, Number(a));
                      }}
                    >
                      - Egreso
                    </button>
                    <button className="ml-auto px-3 py-1.5 rounded-xl bg-rose-600 text-white text-sm" onClick={cerrarCaja}>
                      Cerrar turno
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>

        {/* MODALES ===================================================== */}
        {showInventory && (
          <Modal title="Inventario" onClose={() => setShowInventory(false)}>
            <InventoryCard
              branchState={branchState}
              setByBranch={setByBranch}
              selectedBranchId={selectedBranchId}
              ingresoStock={ingresoStock}
              egresoStockManual={egresoStockManual}
            />
          </Modal>
        )}

        {showReports && (
          <Modal title="Reportes" onClose={() => setShowReports(false)}>
            <ReportsCard
              branchState={branchState}
              selectedBranch={selectedBranch}
              reportFilter={reportFilter}
              setReportFilter={setReportFilter}
              reportData={reportData}
              onReprint={(s) => openTicket(s, s.branchName || selectedBranch?.name)}
              onDeleteSession={(sid) => deleteSessionPermanent(sid)}
            />
            <div className="mt-3 flex gap-2">
              <button
                className="px-3 py-1.5 rounded-xl bg-white text-neutral-900 border border-neutral-300 shadow-sm hover:bg-neutral-50"
                onClick={loadReport}
              >
                Actualizar
              </button>
              <button
                className="px-3 py-1.5 rounded-xl bg-white text-neutral-900 border border-neutral-300 shadow-sm hover:bg-neutral-50"
                onClick={() => exportReportCSV(branchState, reportData, reportFilter, selectedBranch?.name)}
              >
                Exportar CSV
              </button>
            </div>
          </Modal>
        )}

        {showConfig && (
          <Modal title="Configuración" onClose={() => setShowConfig(false)}>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <label className="flex items-center justify-between gap-2">
                <span>Impresión directa (agente ESC/POS)</span>
                <input
                  type="checkbox"
                  checked={config.agentPrintEnabled}
                  onChange={(e) => setConfig((c) => ({ ...c, agentPrintEnabled: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>Exigir PIN para descuentos</span>
                <input
                  type="checkbox"
                  checked={config.requirePinForDiscounts}
                  onChange={(e) => setConfig((c) => ({ ...c, requirePinForDiscounts: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>PIN de administrador</span>
                <input
                  type="password"
                  className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
                  value={config.supervisorPin}
                  onChange={(e) => setConfig((c) => ({ ...c, supervisorPin: e.target.value }))}
                />
              </label>
              <label className="flex flex-col">
                <span>Encabezado de ticket</span>
                <input
                  className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
                  value={config.ticketHeader}
                  onChange={(e) => setConfig((c) => ({ ...c, ticketHeader: e.target.value }))}
                  placeholder="Ej.: BILLAR JADE — Sucursal Centro"
                />
              </label>
              <label className="flex flex-col">
                <span>Logo del ticket (PNG/JPG)</span>
                <input type="file" accept="image/*" onChange={(e) => handleLogoUpload(e, setConfig)} />
              </label>
              {config.ticketLogo && (
                <img src={config.ticketLogo} alt="Logo" className="h-16 object-contain border border-white/25 rounded p-1" />
              )}
            </div>
          </Modal>
        )}

        {showUsers && (
          <Modal title="Usuarios" onClose={() => setShowUsers(false)}>
            {authUser.role !== "Administrador" ? (
              <div className="text-sm">Solo el Administrador puede gestionar usuarios.</div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <button
                    className="px-2 py-1 text-xs rounded-lg bg-sky-50/70 text-sky-700 border border-sky-200"
                    onClick={createUser}
                  >
                    + Usuario
                  </button>
                </div>
                <div className="space-y-1 max-h-[70vh] overflow-auto pr-1 text-sm">
                  {(users || []).map((u) => (
                    <div
                      key={u.id}
                      className="grid grid-cols-12 gap-2 items-center border border-white/20 rounded-xl p-2 bg-white/10"
                    >
                      <div className="col-span-3">{u.username}</div>
                      <div className="col-span-2">{u.role}</div>
                      <div className="col-span-3">
                        Sucursal: {branches.find((b) => b.id === u.branchId)?.name || u.branchId}
                      </div>
                      <div className="col-span-2">{u.active ? "Activo" : "Inactivo"}</div>
                      <div className="col-span-2 flex gap-1 justify-end">
                        <button
                          className="px-2 py-1 text-xs rounded-lg bg-white/20 border border-white/30"
                          onClick={() => changePassword(u)}
                        >
                          Cambiar clave
                        </button>
                        <button
                          className="px-2 py-1 text-xs rounded-lg bg-white/20 border border-white/30"
                          onClick={() => toggleUser(u)}
                        >
                          {u.active ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Modal>
        )}
        {/* ============================================================ */}

        {/* Impresión 80mm (área oculta) */}
        <div aria-hidden className="print:block hidden">
          <div id="ticket" className="ticket w-[80mm] p-3 text-sm font-mono bg-white text-black">
            {ticketData && <Ticket80mm data={ticketData} config={config} />}
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
// ==== FIN BLOQUE 2/3 ====
// ==== BLOQUE 3/3 — CLOCK, MESACARD, MODAL, INVENTARIO, REPORTES, TICKET, HELPERS ====

// Reloj de cabecera
function Clock({ tick }) {
  return (
    <div className="text-right">
      <div className="text-xl font-mono leading-tight drop-shadow">{fmtTimeSec(tick)}</div>
      <div className="text-xs text-neutral-200/90 -mt-1">{fmtDate(tick)}</div>
    </div>
  );
}

// Tarjeta de mesa (UI compatible con tu diseño anterior)
function MesaCard({
  table, config,
  onStart, onStop,
  onRename,
  inventory, onAddItem, onRemoveItem, onCustomerChange,
  onPauseResume, onMove, onItemDiscount, onMesaDiscount
}) {
  const start    = table?.session?.start;
  const pausedMs = table?.session?.pausedMs;
  const isPaused = table?.session?.isPaused;
  const pausedAt = table?.session?.pausedAt;

  const [t, setT] = useState(0);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);

  const tarifa = useMemo(() => {
    if (!table.session) return null;
    const extraPause = isPaused ? (Date.now() - (pausedAt || Date.now())) : 0;
    return computeCharge({
      start, end: Date.now(),
      ratePerHour: config.ratePerHour, minMinutes: config.minMinutes, fractionMinutes: config.fractionMinutes,
      pausedMs: (pausedMs || 0) + extraPause
    });
  }, [table.session, config, t, isPaused, pausedAt, pausedMs, start]);

  return (
    <div className={`rounded-2xl border border-white/25 shadow-sm p-3 backdrop-blur
                     ${table.status === "ocupada" ? "bg-emerald-500/15" : "bg-white/12"}`}>
      <div className="flex items-center justify-between mb-2">
        <input
          className="font-semibold bg-transparent focus:outline-none rounded px-1 hover:bg-white/10"
          value={table.name}
          onChange={(e) => onRename?.(e.target.value)}
        />
        <span className={`text-xs px-2 py-0.5 rounded-full border
                         ${table.status === "ocupada"
                           ? "bg-emerald-300/20 text-emerald-100 border-emerald-300/30"
                           : "bg-white/15 text-neutral-100 border-white/25"}`}>
          {table.status}
        </span>
      </div>

      {table.status === "libre" && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-200/90">Lista para usar</span>
          <button className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-sm" onClick={onStart}>
            Iniciar
          </button>
        </div>
      )}

      {table.status === "ocupada" && table.session && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {/* Izquierda */}
            <div className="bg-white/12 rounded-xl p-2 border border-white/20">
              <div className="flex justify-between"><span>Inicio</span><b>{fmtTime(table.session.start)}</b></div>
              <div className="flex justify-between">
                <span>Cronómetro</span>
                <b>{(() => {
                  const ms = Math.max(0, (Date.now() - start - (pausedMs || 0) - (isPaused ? (Date.now() - (pausedAt || Date.now())) : 0)));
                  const sec = Math.floor(ms/1000);
                  const mm = String(Math.floor(sec/60)).padStart(2,'0');
                  const ss = String(sec%60).padStart(2,'0');
                  return `${mm}:${ss}`;
                })()}</b>
              </div>
              <div className="flex justify-between"><span>Facturable</span><b>{tarifa?.rounded ?? 0} min</b></div>
              <div className="flex justify-between"><span>Importe</span><b>{bs(tarifa?.amount ?? 0)}</b></div>
              <div className="flex gap-2 mt-2">
                <button className="px-2 py-1 rounded-lg bg-white/15 border border-white/25 text-xs" onClick={onPauseResume}>
                  {table.session.isPaused ? 'Retomar' : 'Pausar'}
                </button>
                <button className="px-2 py-1 rounded-lg bg-white/15 border border-white/25 text-xs" onClick={onMove}>
                  Mover consumo
                </button>
              </div>
              <div className="flex gap-2 mt-2">
                <button className="px-2 py-1 rounded-lg bg-white/15 border border-white/25 text-xs" onClick={onMesaDiscount}>
                  Desc. mesa
                </button>
              </div>
            </div>

            {/* Derecha */}
            <div className="bg-white/12 rounded-xl p-2 border border-white/20">
              <div className="font-medium mb-1">Cliente</div>
              <input
                className="w-full border border-white/30 bg-black/30 rounded-lg px-2 py-1 text-sm mb-2"
                placeholder="Nombre del cliente (opcional)"
                value={table.session.customerName || ""}
                onChange={(e) => onCustomerChange?.(e.target.value)}
              />

              <div className="font-medium mb-1">Productos</div>
              <button
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm mb-2"
                onClick={() => setShowPicker(true)}
              >
                + Producto
              </button>

              <div className="space-y-1 max-h-28 overflow-auto pr-1">
                {(table.session.items || []).length === 0 && (
                  <div className="text-xs text-neutral-200/80">Sin productos</div>
                )}
                {(table.session.items || []).map((it) => (
                  <div key={it.itemId || it.name} className="grid grid-cols-12 items-center text-xs gap-1">
                    <span className="col-span-6 truncate">{it.name} × {it.qty}</span>
                    <span className="col-span-3 text-right text-neutral-200/80">{bs((it.price || 0) * (it.qty || 0))}</span>
                    <div className="col-span-3 flex gap-1 justify-end">
                      <button className="px-2 py-0.5 rounded-lg bg-white/15 border border-white/25" onClick={() => onRemoveItem?.(it.itemId)}>-</button>
                      <button className="px-2 py-0.5 rounded-lg bg-white/15 border border-white/25" onClick={() => onItemDiscount?.(it.itemId)}>Desc</button>
                    </div>
                    {it.disc > 0 && (
                      <div className="col-span-12 text-[10px] text-rose-200">Descuento ítem: {bs(it.disc)}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button className="px-3 py-1.5 rounded-xl bg-white/15 border border-white/25 shadow-sm text-sm" onClick={() => onStop(false)}>
              Cerrar (sin imprimir)
            </button>
            <button className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-sm" onClick={() => onStop(true)}>
              Cerrar & imprimir
            </button>
          </div>

          {/* Modal agregar consumo (UI vigente, acción pendiente de endpoint) */}
          {showPicker && (
            <Modal title="Agregar consumo" onClose={() => setShowPicker(false)}>
              <ProductPicker inventory={inventory} onPick={(it) => onAddItem?.(it.id)} />
              <div className="mt-3 flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded-lg border" onClick={() => setShowPicker(false)}>
                  Cerrar
                </button>
              </div>
            </Modal>
          )}
        </div>
      )}
    </div>
  );
}

// Modal básico
function Modal({ title = "", onClose, children }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white text-neutral-900 rounded-2xl shadow-2xl ring-1 ring-black/10 w-[min(92vw,900px)] max-h-[88vh] overflow-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="px-2 py-1 rounded-lg border" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Buscador/selector de productos (local UI)
function ProductPicker({ inventory = [], onPick }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    const arr = Array.isArray(inventory) ? inventory : [];
    return k ? arr.filter((it) => (it?.name || "").toLowerCase().includes(k)) : arr;
  }, [q, inventory]);

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Buscar producto..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="border rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 bg-neutral-50 border-b px-3 py-2 text-xs font-medium">
          <div className="col-span-7">Producto</div>
          <div className="col-span-2 text-right">Precio</div>
          <div className="col-span-1 text-right">Stock</div>
          <div className="col-span-2 text-right">&nbsp;</div>
        </div>
        <div className="max-h-[50vh] overflow-auto">
          {list.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-neutral-500">Sin resultados</div>
          )}
          {list.map((it) => (
            <div key={it.id} className="grid grid-cols-12 items-center px-3 py-2 border-b text-sm">
              <div className="col-span-7 truncate" title={it.name}>
                {it.name}
              </div>
              <div className="col-span-2 text-right">Bs {Number(it.price || 0).toFixed(2)}</div>
              <div className="col-span-1 text-right">{it.stock}</div>
              <div className="col-span-2 flex justify-end">
                <button
                  disabled={it.stock <= 0}
                  className={`px-2 py-1 rounded-lg border text-sm ${
                    it.stock <= 0
                      ? "opacity-60 cursor-not-allowed"
                      : "bg-emerald-600 text-white border-emerald-600"
                  }`}
                  onClick={() => onPick && onPick(it)}
                >
                  Agregar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Inventario con kardex (local)
function InventoryCard({ branchState, setByBranch, selectedBranchId, ingresoStock, egresoStockManual }) {
  const [viewKardexFor, setViewKardexFor] = useState("");
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Inventario</h3>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs rounded-lg bg-sky-50 text-sky-700 border"
            onClick={() => {
              const name = prompt("Producto:"); if (!name) return;
              const price = Number(prompt("Precio venta (Bs):", "0") || 0);
              const cost = Number(prompt("Precio real/costo (Bs):", "0") || 0);
              const stock = Number(prompt("Stock inicial:", "0") || 0);
              const unit = prompt("Unidad (u, bot, etc):", "u") || "u";
              setByBranch((prev) => {
                const copy = deepClone(prev || {});
                (copy[selectedBranchId] ||= deepClone(branchState)).inventory.push({
                  id: uid("item"), name, price, cost, stock, unit,
                });
                return copy;
              });
            }}
          >
            + Producto
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-60 overflow-auto pr-1">
        {(branchState.inventory || []).map((it) => (
          <div key={it.id} className="grid grid-cols-12 gap-2 items-center text-sm p-2 rounded-xl border hover:bg-neutral-50">
            <div className="col-span-3 font-medium truncate" title={it.name}>{it.name}</div>
            <div className="col-span-2 text-right">Costo: {bs(it.cost)}</div>
            <div className="col-span-2 text-right">Venta: {bs(it.price)}</div>
            <div className="col-span-2 text-right">Ganancia: {bs(it.price - it.cost)}</div>
            <div className="col-span-1 text-right">{it.stock} {it.unit}</div>
            <div className="col-span-2 flex gap-1 justify-end">
              <button
                className="px-2 py-1 text-xs rounded-lg bg-white border"
                onClick={() => {
                  const name = prompt("Nombre del producto:", it.name) ?? it.name;
                  const cost = Number(prompt("Nuevo costo (Bs):", String(it.cost)) ?? it.cost);
                  const price = Number(prompt("Nuevo precio venta (Bs):", String(it.price)) ?? it.price);
                  const stock = Number(prompt("Ajustar stock (suma/resta):", "0") || 0);
                  setByBranch((prev) => {
                    const copy = deepClone(prev || {});
                    const inv = (copy[selectedBranchId] ||= deepClone(branchState)).inventory.find((x) => x.id === it.id);
                    if (!inv) return prev;
                    inv.name = name; inv.cost = cost; inv.price = price; inv.stock = inv.stock + stock;
                    return copy;
                  });
                }}
              >
                Editar
              </button>
              <button className="px-2 py-1 text-xs rounded-lg bg-white border" onClick={() => setViewKardexFor(viewKardexFor === it.id ? "" : it.id)}>
                Kardex
              </button>
              <button
                className="px-2 py-1 text-xs rounded-lg bg-white border"
                onClick={() => {
                  const qty = Number(prompt("Ingreso cantidad:", "0") || 0);
                  const ucost = Number(prompt("Costo unitario (Bs):", String(it.cost)) || it.cost);
                  if (qty > 0) ingresoStock(it, qty, ucost);
                }}
              >
                Ingreso
              </button>
              <button
                className="px-2 py-1 text-xs rounded-lg bg-white border"
                onClick={() => {
                  const qty = Number(prompt("Egreso/Ajuste cantidad:", "0") || 0);
                  if (qty > 0) egresoStockManual(it, qty, "Ajuste");
                }}
              >
                Egreso
              </button>
            </div>

            {viewKardexFor === it.id && (
              <div className="col-span-12 text-xs border rounded-lg p-2 bg-white">
                <div className="font-medium mb-1">Kardex: {it.name}</div>
                <div className="max-h-40 overflow-auto pr-1 space-y-1">
                  {branchState.kardex
                    .filter((k) => k.itemId === it.id)
                    .slice()
                    .reverse()
                    .map((k) => (
                      <div key={k.id} className="grid grid-cols-5 gap-2 border rounded p-1">
                        <div>{new Date(k.at).toLocaleString()}</div>
                        <div>{k.type}</div>
                        <div>Qty: {k.qty}</div>
                        <div>U$ {bs(k.unitCost)}</div>
                        <div>Ref: {k.ref || "—"}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Reportes (usa reportData ya armado en App)
function ReportsCard({ branchState, selectedBranch, reportFilter, setReportFilter, reportData, onReprint, onDeleteSession }) {
  const isEmpty = (reportData.sessions || []).length === 0;

  return (
    <div className="bg-white text-neutral-900 rounded-2xl shadow-sm border p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Reportes</h3>
      </div>

      {/* Filtros (controlados desde App) */}
      <div className="flex flex-wrap gap-2 items-center text-sm mb-2">
        <label className="flex items-center gap-1">
          Desde
          <input
            type="date"
            className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
            value={reportFilter.from}
            onChange={(e) => setReportFilter((f) => ({ ...f, from: e.target.value }))}
          />
        </label>
        <label className="flex items-center gap-1">
          Hasta
          <input
            type="date"
            className="border border-neutral-300 bg-white rounded-lg px-2 py-1 text-neutral-900"
            value={reportFilter.to}
            onChange={(e) => setReportFilter((f) => ({ ...f, to: e.target.value }))}
          />
        </label>
      </div>

      {/* Totales */}
      <div className="text-sm space-y-1">
        <div className="flex justify-between"><span>Tiempo facturado:</span><span>{reportData?.totals?.tiempo || 0} min</span></div>
        <div className="flex justify-between"><span>Total productos (neto):</span><span>{bs(reportData?.totals?.productos || 0)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total cobrado:</span><span>{bs(reportData?.totals?.total || 0)}</span></div>
      </div>

      {/* Sesiones */}
      <details className="mt-2" open>
        <summary className="text-sm text-neutral-600 cursor-pointer">Sesiones (detallado)</summary>
        <div className="mt-2 max-h-64 overflow-auto pr-1 space-y-1">
          {isEmpty && <div className="text-xs text-neutral-500">Sin sesiones en el rango.</div>}

          {(reportData.sessions || []).map((s) => (
            <div key={s.id} className="text-xs border rounded-lg p-2">
              <div className="grid grid-cols-2 gap-1">
                <div><b>Mesa:</b> {s.tableName}</div>
                <div><b>Cliente:</b> {s.customerName || "—"}</div>
                <div><b>Inicio:</b> {fmtTime(s.start)}</div>
                <div><b>Fin:</b> {fmtTime(s.end)}</div>
                <div><b>Tiempo (min):</b> {s.tariff?.rounded || 0}</div>
                <div><b>Tarifa:</b> {bs(s.tariff?.amount || 0)}</div>
                <div><b>Prod. neto:</b> {bs(s.productosNeto || 0)}</div>
                <div className="font-semibold"><b>Total cobrado:</b> {bs(s.total || 0)}</div>
              </div>

              <div className="mt-1 flex gap-2 justify-end">
                <button className="px-2 py-1 text-xs rounded-lg bg-white border" onClick={() => onReprint && onReprint(s)}>
                  Reimprimir
                </button>
                <button className="px-2 py-1 text-xs rounded-lg bg-rose-50 text-rose-700 border border-rose-300" onClick={() => onDeleteSession && onDeleteSession(s.id)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// Ticket 80mm (opcional)
function Ticket80mm({ data, config }) {
  return (
    <div className="text-xs leading-5">
      <div className="text-center">
        {config.ticketLogo && (<img src={config.ticketLogo} alt="logo" className="mx-auto h-14 object-contain" />)}
        <div className="text-base font-bold">{config.ticketHeader || data.branchName}</div>
        <div>Ticket #{data.id?.slice(-6) || ""}</div>
        <div>{new Date(data.end).toLocaleString()}</div>
        <div className="mt-1">{data.tableName}{data.customerName ? ` — ${data.customerName}` : ""}</div>
      </div>

      <div className="mt-2 border-t border-dashed pt-2">
        <div className="flex justify-between"><span>Inicio</span><span>{fmtTime(data.start)}</span></div>
        <div className="flex justify-between"><span>Fin</span><span>{fmtTime(data.end)}</span></div>
        <div className="flex justify-between"><span>Tiempo (min)</span><span>{data.tariff?.rounded || 0}</span></div>
        <div className="flex justify-between"><span>Tarifa</span><span>{bs(data.tariff?.amount || 0)}</span></div>
      </div>

      <div className="mt-2">
        <div className="font-medium">Productos</div>
        {data.items.length === 0 ? (
          <div className="text-neutral-700">—</div>
        ) : (
          <div className="space-y-1">
            {data.items.map((it) => (
              <div key={it.itemId} className="flex justify-between">
                <span>{it.name} × {it.qty}{it.disc ? ` (desc ${bs(it.disc)})` : ""}</span>
                <span>{bs(it.price * it.qty - (it.disc || 0))}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between mt-1"><span>Desc. mesa</span><span>{bs(data.discountMesa || 0)}</span></div>
        <div className="flex justify-between mt-1"><span>Subtotal prod.</span><span>{bs(data.productosNeto || 0)}</span></div>
      </div>

      <div className="mt-2 border-t border-dashed pt-2 text-sm font-semibold flex justify-between">
        <span>Total</span>
        <span>{bs(data.total || 0)}</span>
      </div>

      {data.roundingApplied && (
        <div className="text-center text-[10px] text-neutral-600">
          * Total redondeado por regla 0.49/0.50
        </div>
      )}
      <div className="mt-2 text-center">Gracias por su preferencia</div>
    </div>
  );
}

// Pantalla de Login (igual a tu diseño, ahora intenta backend primero)
function LoginScreen({ onLogin, onInitAdmin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  return (
    <div className="min-h-screen grid place-items-center bg-neutral-50">
      <div className="w-full max-w-sm bg-white border rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-semibold text-center">Ingreso al Sistema</h1>
        <p className="text-xs text-neutral-500 text-center mb-4">Use sus credenciales para continuar</p>
        <label className="text-sm flex flex-col mb-2">
          <span>Usuario</span>
          <input className="border rounded-lg px-3 py-2" value={u} onChange={(e) => setU(e.target.value)} />
        </label>
        <label className="text-sm flex flex-col mb-3">
          <span>Contraseña</span>
          <input
            type="password"
            className="border rounded-lg px-3 py-2"
            value={p}
            onChange={(e) => setP(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onLogin(u, p); }}
          />
        </label>
        <button className="w-full px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700" onClick={() => onLogin(u, p)}>
          Ingresar
        </button>
        <div className="text-[11px] text-neutral-500 mt-3">
          <div><b>Demo:</b> admin/123456 (Administrador) — cajero/123456 (Cajero)</div>
          {onInitAdmin && (<button className="mt-2 underline" onClick={onInitAdmin}>Restablecer usuarios demo</button>)}
        </div>
      </div>
    </div>
  );
}

// Cargar logo del ticket
function handleLogoUpload(e, setConfig) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) =>
    setConfig((c) => ({ ...c, ticketLogo: String(ev.target?.result || "") }));
  reader.readAsDataURL(file);
}

/* ==== EXPORTAR CSV CORREGIDO PARA EXCEL (sep=;, BOM, coma decimal) ==== */
function exportReportCSV(branchState, reportData, filter, branchName) {
  const SEP = ";";
  const dec = (n) => String(Number(n ?? 0).toFixed(2)).replace(".", ",");

  const header = [
    "Desde", "Hasta", "Sucursal", "Mesa", "Cliente", "Cajero",
    "Inicio", "Fin", "Tiempo (min)", "Tarifa (Bs)",
    "Prod. bruto", "Desc. ítems", "Desc. mesa",
    "Prod. neto", "Costo prod.", "Margen", "Total cobrado",
  ];

  const rows = (reportData.sessions || []).map((s) => [
    filter.from,
    filter.to,
    branchName || "",
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
    dec(s.costoProductos || 0),
    dec(s.margin || 0),
    dec(s.total || 0),
  ]);

  const csvCore = toCSV([header, ...rows], SEP);
  const content = "\uFEFF" + `sep=${SEP}\n` + csvCore;

  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reporte_${filter.from}_a_${filter.to}_${(branchName || "").replace(/\s+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportClosureCSV(c) {
  const SEP = ";";
  const dec = (n) => String(Number(n ?? 0).toFixed(2)).replace(".", ",");

  const header = [
    "Sucursal", "Apertura", "Cierre", "Abrió", "Cerró",
    "Inicial", "Ingresos", "Egresos", "Total caja", "Ventas (cant)", "Ventas (Bs)",
  ];

  const row = [
    c.branchName || "",
    new Date(c.openedAt).toLocaleString(),
    new Date(c.closedAt).toLocaleString(),
    c.openedBy || "",
    c.closedBy || "",
    dec(c.initialCash),
    dec(c.ingresos),
    dec(c.egresos),
    dec(c.totalCaja),
    c.ventasCount || 0,
    dec(c.ventasTotal || 0),
  ];

  const csvCore = toCSV([header, row], SEP);
  const content = "\uFEFF" + `sep=${SEP}\n` + csvCore;

  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cierre_${(c.closedAt && new Date(c.closedAt).toISOString().slice(0,19).replace(/[:T]/g,'-')) || "turno"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
// ==== FIN BLOQUE 3/3 ====
