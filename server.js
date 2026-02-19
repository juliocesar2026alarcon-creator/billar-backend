// server.js — BACKEND REAL (ESM)

import express from 'express';
import cors from 'cors';
import pkg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(express.json());

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
app.use(
  cors({
    origin: ALLOW_ORIGIN === '*' ? true : ALLOW_ORIGIN.split(','),
    credentials: true,
  })
);

// Servir el frontend desde la carpeta /public (ESTO VA FUERA DE CORS)
app.use(express.static(path.join(__dirname, 'public')));

// === Import del SEED (versión ESM) ===

// Pool a PostgreSQL (Render necesita SSL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function runInit() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS __init_marker (id INT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS roles(id SERIAL PRIMARY KEY,name VARCHAR(50) UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS sucursales(id SERIAL PRIMARY KEY,nombre VARCHAR(100) UNIQUE NOT NULL,direccion VARCHAR(150));
CREATE TABLE IF NOT EXISTS usuarios(id SERIAL PRIMARY KEY,nombre VARCHAR(100),email VARCHAR(120) UNIQUE NOT NULL,password_hash TEXT NOT NULL,rol_id INT REFERENCES roles(id),sucursal_id INT REFERENCES sucursales(id),must_reset BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS mesas(id SERIAL PRIMARY KEY,nombre VARCHAR(40),sucursal_id INT REFERENCES sucursales(id),estado VARCHAR(20) DEFAULT 'libre');
CREATE TABLE IF NOT EXISTS tarifas_sucursal(id SERIAL PRIMARY KEY,sucursal_id INT REFERENCES sucursales(id),precio_hora NUMERIC(10,2) NOT NULL,fraccion_minutos INT NOT NULL DEFAULT 5,minimo_minutos INT NOT NULL DEFAULT 30,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS productos(id SERIAL PRIMARY KEY,sucursal_id INT REFERENCES sucursales(id),nombre VARCHAR(120) NOT NULL,precio NUMERIC(10,2) NOT NULL,categoria VARCHAR(50));
CREATE TABLE IF NOT EXISTS tickets(id SERIAL PRIMARY KEY,sucursal_id INT REFERENCES sucursales(id),mesa_id INT REFERENCES mesas(id),total NUMERIC(12,2) NOT NULL,metodo_pago VARCHAR(20) NOT NULL,efectivo_recibido NUMERIC(12,2) DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS consumos(id SERIAL PRIMARY KEY,ticket_id INT REFERENCES tickets(id) ON DELETE CASCADE,mesa_id INT REFERENCES mesas(id),producto_id INT REFERENCES productos(id),cantidad NUMERIC(10,2) NOT NULL,precio NUMERIC(10,2) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
    const mark = await client
      .query('SELECT 1 FROM __init_marker LIMIT 1')
      .catch(() => null);

    if (!mark || !mark.rows || !mark.rows.length) {
      await client.query(`
INSERT INTO roles(name) VALUES ('admin') ON CONFLICT(name) DO NOTHING;
INSERT INTO roles(name) VALUES ('cajero') ON CONFLICT(name) DO NOTHING;

INSERT INTO sucursales(nombre) VALUES ('BILLAR JADE') ON CONFLICT(nombre) DO NOTHING;
INSERT INTO sucursales(nombre) VALUES ('BILLAR JADE ANEXO') ON CONFLICT(nombre) DO NOTHING;

INSERT INTO usuarios(nombre,email,password_hash,rol_id,sucursal_id,must_reset)
SELECT 'Administrador Principal','flakita_94erg@hotmail.com', crypt('Cambiar.123', gen_salt('bf')), r.id, s.id, TRUE
FROM roles r, sucursales s WHERE r.name='admin' AND s.nombre='BILLAR JADE'
ON CONFLICT(email) DO NOTHING;

DO $$
DECLARE sid INT; c INT; i INT;
BEGIN
  FOR sid IN SELECT id FROM sucursales LOOP
    SELECT COUNT(*) INTO c FROM mesas WHERE sucursal_id=sid;
    IF c < 10 THEN
      FOR i IN (c+1)..10 LOOP
        INSERT INTO mesas(nombre,sucursal_id,estado) VALUES ('Mesa '||i, sid, 'libre');
      END LOOP;
    END IF;
  END LOOP;
END $$;

INSERT INTO tarifas_sucursal(sucursal_id,precio_hora,fraccion_minutos,minimo_minutos)
SELECT id, 15.00, 5, 30 FROM sucursales s
WHERE NOT EXISTS (SELECT 1 FROM tarifas_sucursal t WHERE t.sucursal_id=s.id);

INSERT INTO productos(sucursal_id,nombre,precio,categoria)
SELECT s.id, p.nombre, p.precio, p.categoria FROM sucursales s, (
  VALUES
    ('Cerveza Paceña 1 Lts',25.00,'Bebidas'),
    ('Cerveza Golden Lata',12.00,'Bebidas'),
    ('Papas Picantes',3.50,'Snacks'),
    ('Papas Churrasco',3.50,'Snacks'),
    ('Cigarro Hills',0.67,'Cigarrillos'),
    ('Cigarro Bohem',0.70,'Cigarrillos'),
    ('Soda Mini',2.50,'Bebidas'),
    ('Soda Popular',6.00,'Bebidas'),
    ('Soda 1 1/2',10.00,'Bebidas'),
    ('Coca Machucada',20.00,'Bebidas')
) AS p(nombre,precio,categoria);
`);
      await client.query('INSERT INTO __init_marker(id) VALUES (1)');
      console.log('DB initialized with schema + seed.');
    } else {
      console.log('DB already initialized.');
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Init error:', e.message);
  } finally {
    client.release();
  }
}

// Salud
app.get('/health', async (req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Endpoints
app.get('/tarifas', async (req, res) => {
  const { sucursal_id = 1 } = req.query;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM tarifas_sucursal WHERE sucursal_id=$1 LIMIT 1',
      [sucursal_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No hay tarifa' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/mesas', async (req, res) => {
  const { sucursal_id = 1 } = req.query;
  try {
    const { rows } = await pool.query(
      'SELECT id,nombre,estado FROM mesas WHERE sucursal_id=$1 ORDER BY id',
      [sucursal_id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/productos', async (req, res) => {
  const { sucursal_id = 1 } = req.query;
  try {
    const { rows } = await pool.query(
      'SELECT id,nombre,precio,categoria FROM productos WHERE sucursal_id=$1 ORDER BY nombre',
      [sucursal_id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/consumos', async (req, res) => {
  const { ticket_id, mesa_id, producto_id, cantidad } = req.body;
  try {
    const pr = await pool.query('SELECT precio FROM productos WHERE id=$1', [
      producto_id,
    ]);
    const precio = pr.rows[0]?.precio || 0;
    await pool.query(
      'INSERT INTO consumos(ticket_id,mesa_id,producto_id,cantidad,precio) VALUES($1,$2,$3,$4,$5)',
      [ticket_id, mesa_id, producto_id, cantidad, precio]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/tickets/cerrar', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      sucursal_id,
      mesa_id,
      minutos_fact,
      importe_tiempo,
      consumo_total,
      metodo_pago,
      efectivo_recibido,
    } = req.body;

    await client.query('BEGIN');

    const total =
      (Number(importe_tiempo) || 0) + (Number(consumo_total) || 0);

    const t = await client.query(
      'INSERT INTO tickets(sucursal_id, mesa_id, total, metodo_pago, efectivo_recibido) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at',
      [sucursal_id, mesa_id, total, metodo_pago, efectivo_recibido || 0]
    );

    await client.query('UPDATE mesas SET estado=$1 WHERE id=$2', [
      'libre',
      mesa_id,
    ]);

    await client.query('COMMIT');

    res.json({ ok: true, ticket: t.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
  console.log('API Billar iniciando en', PORT);
  await runInit();
});
