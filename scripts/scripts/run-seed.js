// scripts/run-seed.js
// Ejecuta scripts/seed.sql usando la DATABASE_URL (Render Postgres)

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function runSeed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL no está definida');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false } // necesario en Render Postgres gestionado
  });

  await client.connect();

  const sqlPath = path.join(__dirname, 'seed.sql');
  let sql = fs.readFileSync(sqlPath, 'utf8');

  // Reemplaza el placeholder por tu email admin real
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

// Permitir ejecutar como script con "node scripts/run-seed.js"
if (require.main === module) {
  runSeed().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { runSeed };
