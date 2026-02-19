const API_BASE_URL = window.location.origin;
// ===============================
//  APP.JS — MODO API REAL
//  Billar JADE — Frontend
// ===============================

// 1) URL de tu backend real en Render

// 2) Config por defecto (si la API no responde)
const DEFAULT_CONFIG = {
  tarifaPorHora: 15,
  fraccionMinutos: 5,
  minimoMinutos: 30,
};

// 3) Estado global
const state = {
  sucursalId: 1,              // 1 = BILLAR JADE, 2 = BILLAR JADE ANEXO
  branch: 'BILLAR JADE',
  role: 'cajero',
  config: { ...DEFAULT_CONFIG },
  mesas: [],
  historial: [],
  mesaActual: null,           // opcional: la mesa en foco si tu UI la usa
  minutosFacturados: 0        // opcional: si tu UI lo calcula
};
window.state = state; // compatibilidad global

// 4) Helpers DOM
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// 5) Helper GET a la API
async function apiGet(path){
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url);
  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error(`Error API ${path}: ${res.status} ${txt}`);
  }
  return res.json();
}

// 6) Render de tarifas — usa tu función si existe; si no, etiquetas simples
function renderTarifasFromState(){
  if (typeof renderTarifas === 'function') {
    try { renderTarifas(); return; } catch(_) {}
  }
  const elTarifa = document.getElementById('lblTarifa')   || $('#lbl-tarifa')   || $('#tarifaValor');
  const elFrac   = document.getElementById('lblFraccion') || $('#lbl-fraccion') || $('#tarifaFraccion');
  const elMin    = document.getElementById('lblMinimo')   || $('#lbl-minimo')   || $('#tarifaMinimo');
  if (elTarifa) elTarifa.textContent = `${state.config.tarifaPorHora} Bs/h`;
  if (elFrac)   elFrac.textContent   = `${state.config.fraccionMinutos} min`;
  if (elMin)    elMin.textContent    = `${state.config.minimoMinutos} min`;
}

// 7) Render de mesas — intenta usar tu initMesas(); si no existe, fallback simple
function renderMesasFromState(){
  if (typeof initMesas === 'function') {
    try { initMesas(); return; } catch(_) {}
  }
  const grid = document.getElementById('mesasGrid') || $('#mesasGrid') || $('#mesas') || $('#gridMesas');
  if (!grid) return;
  grid.innerHTML = '';
  state.mesas.forEach(m => {
    const card = document.createElement('div');
    card.className = `mesa ${m.estado || 'libre'}`;
    card.innerHTML = `
      <div class="mesa-title">${m.nombre || `Mesa ${m.id}`}</div>
      <div class="mesa-time" id="time-${m.id}">00:00:00</div>
      <div class="mesa-estado">${m.estado || 'libre'}</div>
    `;
    grid.appendChild(card);
  });
}

// 8) Carga inicial (tarifas + mesas) desde la API real
async function load(){
  try{
    const sucursalId = Number(window.state?.sucursalId) || 1;

    // 8.1 Tarifas
    const t = await apiGet(`/tarifas?sucursal_id=${sucursalId}`);
    state.config = {
      ...DEFAULT_CONFIG,
      tarifaPorHora:   Number(t.price_per_hour_bs ?? DEFAULT_CONFIG.tarifaPorHora),
      fraccionMinutos: Number(t.fraction_minutes  ?? DEFAULT_CONFIG.fraccionMinutos),
      minimoMinutos:   Number(t.min_minutes       ?? DEFAULT_CONFIG.minimoMinutos),
    };
    renderTarifasFromState();

    // 8.2 Mesas
    const mesas = await apiGet(`/mesas?sucursal_id=${sucursalId}`);
    state.mesas = mesas.map(m => ({
      id: m.id,
      nombre: m.nombre || m.code || `Mesa ${m.id}`,
      estado: m.estado || 'libre',
      inicio: m.inicio || null,
      transcurrido: 0,
      consumo: m.consumo || []
    }));
    renderMesasFromState();

  }catch(e){
    console.error('Error cargando desde API:', e);
    // Si falla, mantén DEFAULT_CONFIG y sin mesas
  }
}

// 9) Reloj (usa el patrón time-${id})
let intervalId = null;
function startTicker(){
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(()=>{
    (state.mesas || []).forEach(m=>{
      const el = document.getElementById(`time-${m.id}`);
      if (el) el.textContent = msToHMS(getMs(m));
    });
  }, 1000);
}
function getMs(m){
  return m.inicio ? (Date.now() - new Date(m.inicio).getTime()) : 0;
}
function msToHMS(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const hh = String(Math.floor(s/3600)).padStart(2,'0');
  const mm = String(Math.floor((s%3600)/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${hh}:${mm}:${ss}`;
}

// 10) Utilidades de UI (neutras si no existen nodos)
function aplicarTema(){ /* opcional: tu implementación anterior */ }
const branchSelect = document.getElementById('branchSelect') || { value: state.branch, addEventListener: ()=>{} };
const roleSelect   = document.getElementById('roleSelect')   || { value: state.role };
const adminPin     = document.getElementById('adminPin')     || { classList:{ toggle:()=>{} } };
const lblFecha     = document.getElementById('lblFecha')     || { textContent: '' };
const ticketInfo   = document.getElementById('ticketInfo')   || null; // si agregas un contenedor en HTML

// 11) CIERRE REAL: crea ticket y recarga mesas
async function confirmarCierreReal(opciones = {}) {
  try {
    const sucursal_id       = opciones.sucursal_id       ?? (Number(window.state?.sucursalId) || 1);
    const mesa_id           = opciones.mesa_id           ?? (Number(window.state?.mesaActual?.id) || 1);
    const minutos_fact      = opciones.minutos_fact      ?? (Number(window.state?.minutosFacturados) || 0);
    const importe_tiempo    = Number(opciones.importe_tiempo ?? 0);
    const consumo_total     = Number(opciones.consumo_total  ?? 0);
    const metodo_pago       = opciones.metodo_pago       ?? 'efectivo';
    const efectivo_recibido = Number(opciones.efectivo_recibido ?? (importe_tiempo + consumo_total));

    const res = await fetch(`${API_BASE_URL}/tickets/cerrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sucursal_id,
        mesa_id,
        minutos_fact,
        importe_tiempo,
        consumo_total,
        metodo_pago,
        efectivo_recibido
      })
    });
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      throw new Error(`Error al cerrar ticket: ${res.status} ${txt}`);
    }
    const data = await res.json(); // { ok:true, ticket:{ id, created_at } }

    // Recarga mesas para ver "libre"
    await load();

    // Muestra el número de ticket en UI si existe ticketInfo
    if (ticketInfo && data?.ticket?.id) {
      ticketInfo.textContent = `Último Ticket: #${data.ticket.id}`;
    }

    alert(`Cierre realizado. Ticket #${data?.ticket?.id ?? ''}`);
  } catch(e) {
    console.error(e);
    alert('No se pudo cerrar el ticket: ' + e.message);
  }
}

// 12) Enganche robusto del botón "Cerrar caja" (id="btnCerrar")
const btnC = document.getElementById('btnCerrar');
if (btnC && !btnC.getAttribute('type')) btnC.setAttribute('type', 'button');
document.addEventListener('click', (ev) => {
  const el = ev.target;
  const btn = el?.closest ? el.closest('#btnCerrar') : null;
  if (!btn) return;
  ev.preventDefault();
  confirmarCierreReal({
    sucursal_id: Number(window.state?.sucursalId) || 1,
    mesa_id: Number(window.state?.mesaActual?.id) || 1,
    // Si luego conectas importes reales de tu UI, pásalos aquí:
    // importe_tiempo: totalPorTiempo,
    // consumo_total: totalPorConsumo,
    // efectivo_recibido: totalRecibido,
    metodo_pago: 'efectivo'
  });
});

// 13) Cambio de sucursal (selector) → refresca API
branchSelect.addEventListener('change', async () => {
  // Intenta leer numérico; si no, mapea por texto
  const v = branchSelect.value;
  const id = Number(v);
  if (!Number.isNaN(id) && id > 0) {
    state.sucursalId = id;
  } else {
    const txt = String(v || '').toUpperCase();
    state.sucursalId = txt.includes('ANEXO') ? 2 : 1;
  }
  state.branch = branchSelect.value || (state.sucursalId === 2 ? 'BILLAR JADE ANEXO' : 'BILLAR JADE');
  await load();
});
// === Arranque seguro: forzar la llamada a load() ===
console.log('[BOOT] registrando fallbacks de carga');

window.addEventListener('DOMContentLoaded', () => {
  console.log('[BOOT] DOMContentLoaded → load()');
  try { load(); } catch(e){ console.error('DOMContentLoaded load() error:', e); }
});

window.addEventListener('load', () => {
  if (!Array.isArray(state.mesas) || !state.mesas.length) {
    console.log('[BOOT] window.load fallback → load()');
    try { load(); } catch(e){ console.error('window.load load() error:', e); }
  }
});

// 14) INIT — asíncrono y usando la API real
(async function init(){
  try{
    aplicarTema();
    branchSelect.value = state.branch;
    roleSelect.value   = state.role;
    adminPin.classList.toggle('hidden', roleSelect.value !== 'admin');

    // 🔑 Cargar desde la API y pintar
    await load();

    // Reloj y fecha
    startTicker();
    lblFecha.textContent = new Date().toLocaleDateString('es-BO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }catch(e){
    console.error('Init error:', e);
  }
})();
