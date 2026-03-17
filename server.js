// server.js — BILLAR Jade (API + Front SPA) con Supabase (ES Modules)
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

// --- Paths para servir el front compilado
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DIST       = path.join(__dirname, 'dist');

const app  = express();
const PORT = process.env.PORT || 3000;

// --- CORS (si sirves front y back en el mismo dominio, no es estrictamente necesario)
app.use(cors({ origin: ['*'] }));
app.use(express.json());

// --- Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;       // <-- pega en Render
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en variables de entorno.');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ====== Helpers ======
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

// Salud
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'billar-backend', time: new Date().toISOString() });
});

// Login (lee de tabla "usuarios" y permite admin/cajero demo)
app.post('/login', async (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || '').trim();
  password = String(password || '').trim();
  // Primero BD
  const { data: users, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('username', username)
    .eq('password', password)
    .eq('active', true)
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  let u = users?.[0];

  // Fallback demo por si no encontrara
  if (!u && (['admin','cajero'].includes(username)) && password === '123456') {
    u = { username, role: username === 'admin' ? 'Administrador' : 'Cajero', branch_id: 'jade', active: true };
  }

  if (!u) return res.status(401).json({ error: 'Credenciales inválidas' });

  res.json({ token: 'demo-token', user: { username: u.username, role: u.role, branchId: u.branch_id } });
});

// ===== MESAS =====

// Listar
app.get('/mesas', async (req, res) => {
  const { branchId } = req.query || {};
  let q = supabase.from('mesas').select('*').order('name', { ascending: true });
  if (branchId) q = q.eq('branch_id', branchId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// Crear (+ Mesa)
app.post('/mesas', async (req, res) => {
  const { branchId = 'jade', name } = req.body || {};
  // Buscar siguiente número
  const { data: list } = await supabase.from('mesas').select('name').eq('branch_id', branchId);
  const re = /^mesa\s+(\d+)$/i;
  let next = 1;
  (list || []).forEach(m => {
    const mm = re.exec((m.name||'').trim());
    if (mm) next = Math.max(next, Number(mm[1])+1);
  });
  const finalName = (name && String(name).trim()) || `Mesa ${next}`;
  const mesa = { id: uid('m'), branch_id: branchId, name: finalName, status: 'libre', session: null };
  const { error } = await supabase.from('mesas').insert(mesa);
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true, mesa });
});

// Eliminar (solo si está libre)
app.delete('/mesas/:id', async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.from('mesas').select('*').eq('id', id).single();
  if (error) return res.status(404).json({ error: 'No existe' });
  if (data.status !== 'libre' || data.session) return res.status(409).json({ error: 'Solo mesa libre' });
  const { error: delErr } = await supabase.from('mesas').delete().eq('id', id);
  if (delErr) return res.status(500).json({ error: delErr.message });
  res.json({ ok: true });
});

// Actualizar (name / customerName / discountTotal)
app.patch('/mesas/:id', async (req, res) => {
  const id = req.params.id;
  const { name, customerName, discountTotal } = req.body || {};
  const { data: m, error } = await supabase.from('mesas').select('*').eq('id', id).single();
  if (error || !m) return res.status(404).json({ error: 'No existe' });
  let session = m.session || null;
  if (customerName != null) {
    if (!session) return res.status(409).json({ error: 'Mesa sin sesión' });
    session = { ...session, customerName: String(customerName) };
  }
  if (discountTotal != null) {
    if (!session) return res.status(409).json({ error: 'Mesa sin sesión' });
    session = { ...session, discountTotal: Math.max(0, Number(discountTotal) || 0) };
  }
  const updates = {};
  if (name != null) updates.name = String(name);
  if (customerName != null || discountTotal != null) updates.session = session;
  const { error: upErr, data: updated } = await supabase.from('mesas').update(updates).eq('id', id).select().single();
  if (upErr) return res.status(500).json({ error: upErr.message });
  res.json({ ok: true, mesa: updated });
});

// Abrir
app.patch('/mesas/:id/abrir', async (req, res) => {
  const id = req.params.id;
  const { data: m, error } = await supabase.from('mesas').select('*').eq('id', id).single();
  if (error || !m) return res.status(404).json({ error: 'Mesa no existe' });
  if (m.status === 'ocupada') return res.status(409).json({ error: 'Ya ocupada' });
  const session = {
    id: uid('ses'), start: nowTs(), pausedMs: 0, isPaused: false, pausedAt: null,
    customerName: '', items: [], discountTotal: 0, createdBy: 'demo'
  };
  const { error: upErr } = await supabase.from('mesas').update({ status: 'ocupada', session }).eq('id', id);
  if (upErr) return res.status(500).json({ error: upErr.message });
  res.json({ ok: true });
});

// Pausar
app.patch('/mesas/:id/pausar', async (req, res) => {
  const id = req.params.id;
  const { data: m, error } = await supabase.from('mesas').select('*').eq('id', id).single();
  if (error || !m || m.status !== 'ocupada' || !m.session) return res.status(409).json({ error: 'Mesa no ocupada' });
  if (!m.session.isPaused) m.session = { ...m.session, isPaused: true, pausedAt: nowTs() };
  const { error: upErr } = await supabase.from('mesas').update({ session: m.session }).eq('id', id);
  if (upErr) return res.status(500).json({ error: upErr.message });
  res.json({ ok: true });
});

// Retomar
app.patch('/mesas/:id/retomar', async (req, res) => {
  const id = req.params.id;
  const { data: m, error } = await supabase.from('mesas').select('*').eq('id', id).single();
  if (error || !m || m.status !== 'ocupada' || !m.session) return res.status(409).json({ error: 'Mesa no ocupada' });
  if (m.session.isPaused) {
    m.session = {
      ...m.session,
      isPaused: false,
      pausedMs: (m.session.pausedMs || 0) + (nowTs() - (m.session.pausedAt || nowTs())),
      pausedAt: null
    };
  }
  const { error: upErr } = await supabase.from('mesas').update({ session: m.session }).eq('id', id);
  if (upErr) return res.status(500).json({ error: upErr.message });
  res.json({ ok: true });
});

// Cerrar
app.patch('/mesas/:id/cerrar', async (req, res) => {
  const id = req.params.id;
  const { data: m, error } = await supabase.from('mesas').select('*').eq('id', id).single();
  if (error || !m || m.status !== 'ocupada' || !m.session) return res.status(409).json({ error: 'Mesa no ocupada' });

  const cfg = { ratePerHour: 15, minMinutes: 30, fractionMinutes: 5 };
  if (m.session.isPaused) {
    m.session.isPaused = false;
    m.session.pausedMs = (m.session.pausedMs || 0) + (nowTs() - (m.session.pausedAt || nowTs()));
    m.session.pausedAt = null;
  }
  const end = nowTs();
  const tariff = computeCharge({
    start: m.session.start, end,
    ratePerHour: cfg.ratePerHour, minMinutes: cfg.minMinutes, fractionMinutes: cfg.fractionMinutes,
    pausedMs: m.session.pausedMs || 0
  });
  const productosBruto = (m.session.items || []).reduce((a, it) => a + (it.price*it.qty), 0);
  const productosDesc  = (m.session.items || []).reduce((a, it) => a + Math.min(it.disc || 0, it.price*it.qty), 0);
  const productosNeto  = Math.max(0, productosBruto - productosDesc);
  const subtotal       = tariff.amount + productosNeto;
  const total          = Math.max(0, subtotal - (m.session.discountTotal || 0));

  // Guardar sesión cerrada
  const closed = {
    id: m.session.id,
    branch_id: m.branch_id,
    table_id:  m.id,
    table_name: m.name,
    start_ts: m.session.start,
    end_ts: end,
    paused_ms: m.session.pausedMs || 0,
    tariff,
    items: m.session.items || [],
    productos_bruto: productosBruto,
    productos_desc: productosDesc,
    productos_neto: productosNeto,
    discount_mesa: m.session.discountTotal || 0,
    total,
    customer_name: m.session.customerName || '',
    opened_by: m.session.createdBy || '',
    closed_by: 'demo'
  };
  const { error: insErr } = await supabase.from('sesiones').insert(closed);
  if (insErr) return res.status(500).json({ error: insErr.message });

  // Liberar mesa
  const { error: upErr } = await supabase.from('mesas').update({ status: 'libre', session: null }).eq('id', id);
  if (upErr) return res.status(500).json({ error: upErr.message });

  res.json({ ok: true, session: closed });
});

// Reportes
app.get('/reportes', async (req, res) => {
  const { from, to, branchId } = req.query || {};
  const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
  const toTs   = to   ? new Date(`${to}T23:59:59`).getTime()   : nowTs();

  let q = supabase.from('sesiones').select('*').gte('end_ts', fromTs).lte('end_ts', toTs);
  if (branchId) q = q.eq('branch_id', branchId);
  const { data: list, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const totals = {
    tiempo:    (list || []).reduce((a, s) => a + (s.tariff?.rounded || 0), 0),
    productos: (list || []).reduce((a, s) => a + (s.productos_neto || 0), 0),
    total:     (list || []).reduce((a, s) => a + (s.total || 0), 0),
    margen:    0
  };
  res.json({ sessions: list || [], totals });
});


// Start
app.listen(PORT, () => console.log(`billar-backend escuchando en puerto ${PORT}`));
