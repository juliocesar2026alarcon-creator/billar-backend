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
  consumoPorMesa: {},         // { [mesaId]: total Bs }
  itemsPorMesa: {},           // { [mesaId]: cantidad de ítems }
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
  <div class="mesa-estado ${m.estado || 'libre'}">${m.estado || 'libre'}</div>

  <div class="mesa-actions" style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
    <button class="btn small"  data-action="iniciar"   data-mesa="${m.id}">▶ Iniciar</button>
    <button class="btn small"  data-action="consumo"   data-mesa="${m.id}">➕ Consumo</button>
    <button class="btn small"  data-action="finalizar" data-mesa="${m.id}">⏹ Finalizar</button>
  </div>
`;
grid.appendChild(card);
    updateBtnConsumo(m.id);
  });
}
// Delegación de clics para acciones de mesa: iniciar / consumo / finalizar
document.addEventListener('click', async (ev) => {
  const el  = ev.target;
  const btn = el?.closest && el.closest('[data-action][data-mesa]');
  if (!btn) return;

  ev.preventDefault();

  const action = btn.getAttribute('data-action');
  const mesaId = Number(btn.getAttribute('data-mesa'));

  // 1) Buscar la mesa en el estado
  const mesa = (state.mesas || []).find(x => Number(x.id) === mesaId);
  if (!mesa) return;

  // 2) INICIAR: marca inicio y cambia estado a ocupada
  if (action === 'iniciar') {
    if (!mesa.inicio) mesa.inicio = new Date().toISOString();
    mesa.estado = 'ocupada';
    renderMesasFromState();                 // repinta UI
    return;
  }

  // 3) CONSUMO (DEMO): usa prompt; luego lo cambiamos por modal con /productos
  if (action === 'consumo') {
  return abrirModalConsumo(mesaId);
}

  // 4) FINALIZAR: calcula minutos (con fracción y mínimo) y cierra ticket real
  if (action === 'finalizar') {
    try {
      // a) minutos transcurridos desde 'inicio'
      const inicioMs = mesa.inicio ? new Date(mesa.inicio).getTime() : Date.now();
      const minutos  = Math.max(0, Math.round((Date.now() - inicioMs) / 60000));

      // b) redondeo por fracción y mínimo usando la tarifa cargada de la API
      const { tarifaPorHora, fraccionMinutos, minimoMinutos } = state.config || {};
      const tarifaMinuto = Number(tarifaPorHora || 15) / 60;
      const redondeado   = Math.max(minutos, Number(minimoMinutos || 0));
      const bloques      = Math.ceil(redondeado / Number(fraccionMinutos || 1));
      const minutosFact  = bloques * Number(fraccionMinutos || 1);

      const importeTiempo = Math.round((tarifaMinuto * minutosFact) * 100) / 100;
// NUEVO: consumo acumulado local para esta mesa (redondeado a 2 decimales)
const consumoTotal = Math.round(Number(state.consumoPorMesa?.[mesaId] || 0) * 100) / 100;
      // c) cierre real (ticket) en backend
      await confirmarCierreReal({
        sucursal_id: Number(state?.sucursalId) || 1,
          mesa_id: mesaId,
        minutos_fact: minutosFact,
        importe_tiempo: importeTiempo,
        consumo_total: consumoTotal,
        efectivo_recibido: importeTiempo + consumoTotal,
        metodo_pago: 'efectivo'
      });

      // d) limpiar local y repintar
      delete state.consumoPorMesa[mesaId];
      delete state.itemsPorMesa[mesaId];
      updateBtnConsumo(mesaId);
      mesa.inicio = null;
      mesa.estado = 'libre';
      renderMesasFromState();
    } catch (e) {
      console.error(e);
      alert('No se pudo finalizar: ' + e.message);
    }
    return;
  }
});
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
// --- Actualiza el texto del botón "Consumo" mostrando el contador (n) ---
function updateBtnConsumo(mesaId){
  const selector = `button[data-action="consumo"][data-mesa="${mesaId}"]`;
  const btn = document.querySelector(selector);
  if (!btn) return;
  const items = Number(state.itemsPorMesa?.[mesaId] || 0);
  btn.textContent = items > 0 ? `Consumo (${items})` : '➕ Consumo';
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

// 12) Enganche robusto del botón "Cerrar caja" (id="btnCerrarCaja")
const btnC = document.getElementById('btnCerrarCaja');
if (btnC && !btnC.getAttribute('type')) btnC.setAttribute('type', 'button');
document.addEventListener('click', (ev) => {
  const el = ev.target;
  const btn = el?.closest ? el.closest('#btnCerrarCaja') : null;
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
// ---- Consumo con modal (reemplaza al prompt) ----
const productosModal   = document.getElementById('productosModal');
const prodSearch       = document.getElementById('prodSearch');
const prodCant         = document.getElementById('prodCant');
const prodLista        = document.getElementById('prodLista');
const btnProdAgregar   = document.getElementById('btnProdAgregar');
const btnProdCancelar  = document.getElementById('btnProdCancelar');

let _productos = [];
let _mesaParaConsumo = null;
let _productoSeleccionado = null;

async function abrirModalConsumo(mesaId){
  _mesaParaConsumo = mesaId;
  _productoSeleccionado = null;
  if (prodCant)  prodCant.value = 1;
  if (prodSearch) prodSearch.value = '';

  const sucursalId = Number(state?.sucursalId) || 1;
  try{
    _productos = await apiGet(`/productos?sucursal_id=${sucursalId}`);
    renderListaProductos();
    productosModal?.showModal();
    prodSearch?.focus();
  }catch(e){
    console.error(e);
    alert('No se pudieron cargar productos');
  }
}

function renderListaProductos(){
  const q = (prodSearch?.value || '').trim().toLowerCase();
  const data = _productos.filter(p =>
    !q || String(p.nombre).toLowerCase().includes(q) || String(p.id).includes(q)
  );

  
prodLista.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th style="width:70px">ID</th>
          <th>Producto</th>
          <th style="width:120px">Precio (Bs)</th>
          <th style="width:110px"></th>
        </tr>
      </thead>
      <tbody>
        ${data.map(p => `
          <tr>
            <td>${p.id}</td>
            <td>${p.nombre}</td>
            <td>Bs ${Number(p.precio).toFixed(2)}</td>
            <td>
              <button type="button" class="btn small" data-producto="${p.id}">Seleccionar</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}


prodSearch?.addEventListener('input', renderListaProductos);

// Capturar clic en “Seleccionar” dentro de la tabla del modal
// Capturar clic en “Seleccionar” dentro de la tabla del modal
prodLista?.addEventListener('click', (ev) => {
  const el = ev.target;

  // Traza para confirmar que el click llega (podés quitarla después de probar)
  console.log('[prodLista click]', el?.tagName, el?.textContent?.trim());

  // Buscar el botón “Seleccionar” más cercano que tenga data-producto
  const btn = el?.closest && el.closest('button[data-producto]');
  if (!btn) return; // clic fuera del botón

  const pid = Number(btn.getAttribute('data-producto'));
  const seleccionado = _productos.find(p => Number(p.id) === pid) || null;
  if (!seleccionado) {
    console.warn('Producto no encontrado en _productos:', pid, _productos);
    return;
  }

  _productoSeleccionado = seleccionado;

  // Marca visual en la fila
  prodLista.querySelectorAll('tr.selected').forEach(tr => tr.classList.remove('selected'));
  const tr = btn.closest('tr');
  if (tr) tr.classList.add('selected');

  // Feedback inmediato en el botón
  btn.textContent = '✓ Seleccionado';
  console.log('[producto seleccionado]', _productoSeleccionado);
});

btnProdCancelar?.addEventListener('click', ()=> productosModal?.close());

btnProdAgregar?.addEventListener('click', async ()=>{
  try{
    if(!_mesaParaConsumo)       return alert('Sin mesa seleccionada');
    if(!_productoSeleccionado)  return alert('Elegí un producto de la lista');
    const cantidad = Math.max(1, Number(prodCant?.value || 1));

    await fetch(`${API_BASE_URL}/consumos`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        ticket_id: null, // si luego manejas ticket en curso, pásalo aquí
        mesa_id: _mesaParaConsumo,
        producto_id: _productoSeleccionado.id,
        cantidad
      })
    });
// === NUEVO: acumular total Bs e ítems para esta mesa y refrescar contador ===
const totalItem = Number(_productoSeleccionado.precio) * Number(cantidad);
state.consumoPorMesa[_mesaParaConsumo] = (state.consumoPorMesa[_mesaParaConsumo] || 0) + totalItem;
state.itemsPorMesa[_mesaParaConsumo]   = (state.itemsPorMesa[_mesaParaConsumo]   || 0) + Number(cantidad);
updateBtnConsumo(_mesaParaConsumo);
    productosModal?.close();
    alert('Consumo agregado');
  }catch(e){
    console.error(e);
    alert('No se pudo guardar el consumo: ' + e.message);
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
