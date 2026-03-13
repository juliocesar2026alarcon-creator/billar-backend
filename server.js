import express from 'express';
import cors from 'cors';

const app = express();

// Render asigna el puerto en process.env.PORT
const PORT = process.env.PORT || 3000;

// CORS: permití tu frontend (o '*' durante pruebas)
app.use(cors({
  origin: ['https://TU-FRONT.onrender.com', 'http://localhost:5173', '*']
}));

app.use(express.json());

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'billar-backend', time: new Date().toISOString() });
});

// RUTAS DEMO (cámbialas por tus reales)
app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  // DEMO: admin/cajero
  if ((username === 'admin' && password === '123456') ||
      (username === 'cajero' && password === '123456')) {
    return res.json({
      token: 'demo-token',
      user: {
        username,
        role: username === 'admin' ? 'Administrador' : 'Cajero',
        branchId: 'jade'
      }
    });
  }
  res.status(401).json({ error: 'Credenciales inválidas' });
});

app.get('/mesas', (req, res) => {
  // DEMO: 3 mesas libres
  res.json([
    { id: 'm1', name: 'Mesa 1', status: 'libre', session: null },
    { id: 'm2', name: 'Mesa 2', status: 'libre', session: null },
    { id: 'm3', name: 'Mesa 3', status: 'libre', session: null }
  ]);
});

app.listen(PORT, () => {
  console.log(`billar-backend escuchando en puerto ${PORT}`);
});
