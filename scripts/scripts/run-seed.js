// scripts/run-seed.js  (versión ESM)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';

const { Client } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runSeed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL no está definida');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // necesario en Render
  });

  await client.connect();

  const sqlPath = path.join(__dirname, 'seed.sql');
  let sql = fs.readFileSync(sqlPath, 'utf8');
  const adminEmail = process.env.ADMIN_EMAIL || 'julio2026alarconflores@gmail.com';
  sql = sql.replaceAll('{{ADMIN_EMAIL}}', adminEmail);

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ SEED ejecutado correctamente');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error ejecutando SEED:', err);
    throw err;
  } finally {
    await client.end();
  }
}
