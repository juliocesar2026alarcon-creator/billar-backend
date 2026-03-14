// server.js — BILLAR: API + FRONT (SPA) en un solo servicio (Render)
// ES Modules (package.json: "type": "module")

import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// === Rutas de archivos
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DIST       = path.join(__dirname, 'dist');     // Vite build del front
const DATA_PATH  = path.join(__dirname, 'data.json');

const app  = express();
const PORT = process.env.PORT || 3000;

// === Middlewares
app.use(cors({
  origin: ['http://localhost:5173', 'https://localhost:5173', '*'],
  credentials: false
}));
app.use(express.json());

// === Estado + persistencia simple en archivo
const defaultState = () => ({
  users: [
    { id: 'u_admin',  username: 'admin',  password: '123456', role: 'Administrador', branchId: 'jade',  active: true },
    { id: 'u_cajero', username: 'cajero', password: '123456', role: 'Cajero',       branchId: 'jade',  active: true }
  ],
  branches: [
    { id: 'jade',  name: 'BILLAR JADE' },
    { id: 'anexo', name: 'BILLAR JADE ANEXO' }
  ],
  mesas: [
    { id: 'm1', name: 'Mesa 1', status: 'libre', session: null, branchId: 'jade'  },
    { id: 'm2', name: 'Mesa 2', status: 'libre', session: null, branchId: 'jade'  },
    { id: 'm3', name: 'Mesa 3', status: 'libre', session: null, branchId: 'anexo' }
  ],
  sessions: [], // cerradas (para reportes)
  version: 1
});

let state = defaultState();

async function loadState() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    state = JSON.parse(raw);
    console.log('[state] data.json cargado.');
  } catch {
    state = defaultState();
    await saveState();
    console.log('[state] data.json creado con valores por defecto.');
  }
}
async function saveState() {
  try { await fs.writeFile(DATA_PATH, JSON.stringify(state, null, 2), 'utf8'); }
  catch (e) { console.error('[state] error guardando:', e.message); }
}
await loadState();
setInterval(saveState, 10000);

// === Utilidades
const nowTs = () => Date.now();
const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2, 9)}`;
function computeCharge({ start, end, ratePerHour=15, minMinutes=30, fractionMinutes=5, pausedMs=0 }) {
  const eff = Math.max(0, (end-start) - Math.max(0, pausedMs));
  const mins = Math.max(0, Math.ceil(eff/60000));
  const rounded = Math.max(minMinutes, Math.ceil(mins/fractionMinutes)*fractionMinutes);
  const amount = (ratePerHour/60)*rounded;
  return { minutes: mins, rounded, amount };
}

// =================== API ===================

// Health
app.get('/health', (_req, res) => res.json({ ok: true, service: 'billar-backend', time: new Date().toISOString() }));

app.post('/login', (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || '').trim();
  password = String(password || '').trim();

  // Usuarios demo (se suman a los existentes)
  const demoUsers = [
    { username: 'admin',  password: '123456', role: 'Administrador', branchId: 'jade',  active: true },
    { username: 'cajero', password: '123456', role: 'Cajero',       branchId: 'jade',  active: true },
  ];

  const all = [...(state.users || []), ...demoUsers];
  const u = all.find(x =>
    x.username.toLowerCase() === username.toLowerCase() &&
    String(x.password) === password &&
    x.active !== false
  );
  if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

  res.json({ token: 'demo-token', user: { username: u.username, role: u.role, branchId: u.branchId } });
});

// ===== MESAS =====

// Listar
app.get('/mesas', (req, res) => {
  const { branchId } = req.query || {};
  const list = branchId ? state.mesas.filter(m => m.branchId === branchId) : state.mesas;
  res.json(list);
});

// Abrir
app.patch('/mesas/:id/abrir', (req, res) => {
  const m = state.mesas.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Mesa no existe' });
  if (m.status === 'ocupada') return res.status(409).json({ error: 'Ya ocupada' });
  m.status = 'ocupada';
  m.session = {
    id: uid('ses'),
    start: nowTs(),
    pausedMs: 0,
    isPaused: false,
    pausedAt: null,
    customerName: '',
    items: [],
    discountTotal: 0,
    createdBy: 'demo'
  };
  saveState();
  res.json({ ok: true, mesa: m });
});

// Pausar
app.patch('/mesas/:id/pausar', (req, res) => {
  const m = state.mesas.find(x => x.id === req.params.id);
  if (!m || m.status!=='ocupada' || !m.session) return res.status(409).json({ error: 'Mesa no ocupada' });
  if (!m.session.isPaused) { m.session.isPaused = true; m.session.pausedAt = nowTs(); }
  saveState(); res.json({ ok: true });
});

// Retomar
app.patch('/mesas/:id/retomar', (req, res) => {
  const m = state.mesas.find(x => x.id === req.params.id);
  if (!m || m.status!=='ocupada' || !m.session) return res.status(409).json({ error: 'Mesa no ocupada' });
  if (m.session.isPaused) { m.session.isPaused = false; m.session.pausedMs += (nowTs() - (m.session.pausedAt || nowTs())); m.session.pausedAt = null; }
  saveState(); res.json({ ok: true });
});

// Cerrar
app.patch('/mesas/:id/cerrar', (req, res) => {
  const m = state.mesas.find(x => x.id === req.params.id);
  if (!m || m.status!=='ocupada' || !m.session) return res.status(409).json({ error: 'Mesa no ocupada' });
  const cfg = { ratePerHour: 15, minMinutes: 30, fractionMinutes: 5 };
  if (m.session.isPaused) {
    m.session.isPaused = false;
    m.session.pausedMs += (nowTs() - (m.session.pausedAt || nowTs()));
    m.session.pausedAt = null;
  }
  const end = nowTs();
  const tariff = computeCharge({
    start: m.session.start, end,
    ratePerHour: cfg.ratePerHour, minMinutes: cfg.minMinutes, fractionMinutes: cfg.fractionMinutes,
    pausedMs: m.session.pausedMs
  });
  const productosBruto = (m.session.items || []).reduce((a, it) => a + it.price*it.qty, 0);
  const productosDesc  = (m.session.items || []).reduce((a, it) => a + Math.min(it.disc||0, it.price*it.qty), 0);
  const productosNeto  = Math.max(0, productosBruto - productosDesc);
  const subtotal       = tariff.amount + productosNeto;
  const total          = Math.max(0, subtotal - (m.session.discountTotal || 0));
  const closed = {
    id: m.session.id,
    branchId: m.branchId,
    tableId: m.id,
    tableName: m.name,
    start: m.session.start,
    end,
    pausedMs: m.session.pausedMs,
    tariff,
    items: m.session.items,
    productosBruto,
    productosDesc,
    productosNeto,
    discountMesa: m.session.discountTotal || 0,
    total,
    customerName: m.session.customerName || '',
    openedBy: m.session.createdBy || '',
    closedBy: 'demo'
  };
  state.sessions.push(closed);
  m.status = 'libre';
  m.session = null;
  saveState();
  res.json({ ok: true, session: closed });
});

// ===== NUEVOS: crear / eliminar libre / actualizar =====

// Crear mesa (auto-nombre "Mesa N" por sucursal)
app.post('/mesas', (req, res) => {
  const { branchId = 'jade', name } = req.body || {};
  const list = state.mesas.filter(m => m.branchId === branchId);
  let next = 1;
  const re = /^mesa\s+(\d+)$/i;
  for (const m of list) {
    const mt = (m.name || '').trim();
    const mm = re.exec(mt);
    if (mm) next = Math.max(next, Number(mm[1]) + 1);
  }
  const finalName = (name && String(name).trim()) || `Mesa ${next}`;
  const mesa = { id: uid('m'), name: finalName, status: 'libre', session: null, branchId };
  state.mesas.push(mesa);
  saveState();
  res.status(201).json({ ok: true, mesa });
});

// Eliminar mesa (solo si está libre)
app.delete('/mesas/:id', (req, res) => {
  const idx = state.mesas.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'No existe' });
  const m = state.mesas[idx];
  if (m.status !== 'libre' || m.session) {
    return res.status(409).json({ error: 'Solo se puede eliminar una mesa libre' });
  }
  state.mesas.splice(idx, 1);
  saveState();
  res.json({ ok: true });
});

// Actualizar mesa: name / customerName / discountTotal
app.patch('/mesas/:id', (req, res) => {
  const m = state.mesas.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'No existe' });
  const { name, customerName, discountTotal } = req.body || {};
  if (name != null) m.name = String(name);
  if (customerName != null) {
    if (!m.session) return res.status(409).json({ error: 'Mesa sin sesión' });
    m.session.customerName = String(customerName);
  }
  if (discountTotal != null) {
    if (!m.session) return res.status(409).json({ error: 'Mesa sin sesión' });
    m.session.discountTotal = Math.max(0, Number(discountTotal) || 0);
  }
  saveState();
  res.json({ ok: true, mesa: m });
});

// ===== Reportes =====
app.get('/reportes', (req, res) => {
  const { from, to, branchId } = req.query || {};
  const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
  const toTs   = to   ? new Date(`${to}T23:59:59`).getTime()   : nowTs();
  let list = state.sessions.filter(s => s.end >= fromTs && s.end <= toTs);
  if (branchId) list = list.filter(s => s.branchId === branchId);
  const totals = {
    tiempo:    list.reduce((a, s) => a + (s.tariff?.rounded || 0), 0),
    productos: list.reduce((a, s) => a + (s.productosNeto || 0), 0),
    total:     list.reduce((a, s) => a + (s.total || 0), 0),
    margen:    0
  };
  res.json({ sessions: list, totals });
});

// ===== FRONT (SPA) =====
app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

// ===== START =====
app.listen(PORT, () => console.log(`billar-backend escuchando en puerto ${PORT}`));
