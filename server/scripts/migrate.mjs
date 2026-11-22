// Phase 1 Migration Runner for Supabase PostgreSQL
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Client } = pg;

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const PROJECT_REF = 'ovkxuzstzgixjtvkhadf';
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || 'RLG9Kil00V85Y6kb';

async function run() {
  console.log('Connecting to Supabase PostgreSQL pooler...');
  const client = new Client({
    host: 'aws-0-ap-south-1.pooler.supabase.com',
    port: 5432,
    user: `postgres.${PROJECT_REF}`,
    password: DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected to database.');

  try {
    // 1. Get already applied migrations
    const res = await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
    const applied = new Set(res.rows.map(r => r.version));
    console.log(`Currently applied migrations in DB: ${[...applied].join(', ')}`);

    // 2. Read migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration file(s) in repository.`);

    for (const file of files) {
      const match = file.match(/^(\d{14})/);
      if (!match) continue;
      const version = match[1];

      if (applied.has(version)) {
        console.log(`SKIP: ${file} (already recorded in schema_migrations)`);
        continue;
      }

      console.log(`\nAPPLYING: ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO supabase_migrations.schema_migrations (version, statements) VALUES ($1, $2)',
          [version, [sql]]
        );
        await client.query('COMMIT');
        console.log(`SUCCESS: ${file} applied successfully.`);
        applied.add(version);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`ERROR applying ${file}:`, err.message);
        throw err;
      }
    }

    console.log('\nAll migrations are up to date!');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
