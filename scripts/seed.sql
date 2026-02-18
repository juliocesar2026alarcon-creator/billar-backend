-- scripts/seed.sql
-- Crea tablas + datos iniciales para Billar JADE
-- Ejecutable múltiples veces (idempotente)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tablas
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Usamos 'pool_tables' para evitar choques con palabras reservadas
CREATE TABLE IF NOT EXISTS pool_tables (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (branch_id, code)
);

CREATE TABLE IF NOT EXISTS tariffs (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  price_per_hour_bs NUMERIC(10,2) NOT NULL,
  min_minutes INT NOT NULL,
  fraction_minutes INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  table_id INT NOT NULL REFERENCES pool_tables(id) ON DELETE RESTRICT,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  total_minutes INT,
  total_bs NUMERIC(10,2),
  cashier_id INT REFERENCES users(id),
  CHECK (total_minutes IS NULL OR total_minutes >= 0)
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventory_moves (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  qty NUMERIC(12,3) NOT NULL,
  unit_cost_bs NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT
);

CREATE TABLE IF NOT EXISTS receipts (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  receipt_number TEXT,
  total_bs NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roles
INSERT INTO roles (name) VALUES ('admin') ON CONFLICT (name) DO NOTHING;
INSERT INTO roles (name) VALUES ('cajero') ON CONFLICT (name) DO NOTHING;

-- Admin (email parametrizable)
DO $$
DECLARE v_email TEXT := '{{ADMIN_EMAIL}}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = v_email) THEN
    INSERT INTO users (email, password_hash, full_name, is_active)
    VALUES (v_email, crypt('Cambiar_123', gen_salt('bf')), 'Administrador Billar JADE', TRUE);
  END IF;
END$$;

-- Vincular admin al rol admin
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u JOIN roles r ON r.name = 'admin'
WHERE u.email = '{{ADMIN_EMAIL}}'
ON CONFLICT DO NOTHING;

-- Sucursales
INSERT INTO branches (name, is_active) VALUES ('BILLAR JADE', TRUE)
ON CONFLICT (name) DO NOTHING;
INSERT INTO branches (name, is_active) VALUES ('BILLAR JADE ANEXO', TRUE)
ON CONFLICT (name) DO NOTHING;

-- Mesas 10 por sucursal
WITH b AS (SELECT id FROM branches WHERE name IN ('BILLAR JADE','BILLAR JADE ANEXO'))
INSERT INTO pool_tables (branch_id, code, is_active)
SELECT id, 'M' || LPAD(gs::text, 2, '0'), TRUE
FROM b CROSS JOIN generate_series(1,10) gs
ON CONFLICT (branch_id, code) DO NOTHING;

-- Tarifas
WITH b AS (SELECT id FROM branches WHERE name IN ('BILLAR JADE','BILLAR JADE ANEXO'))
INSERT INTO tariffs (branch_id, price_per_hour_bs, min_minutes, fraction_minutes, is_active)
SELECT id, 15, 30, 5, TRUE FROM b
ON CONFLICT DO NOTHING;

-- Inventario base
INSERT INTO items (sku, name, unit, is_active) VALUES
  ('BEB-001', 'Gaseosa 500ml', 'unidad', TRUE),
  ('BOT-001', 'Agua 2L', 'unidad', TRUE),
  ('SNA-001', 'Papas fritas 45g', 'unidad', TRUE)
ON CONFLICT (sku) DO NOTHING;
