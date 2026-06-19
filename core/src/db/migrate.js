// ============================================================
// G-Tech Developer ERP v3 — Database Migration Runner
// جيتك المطور | أ. علاء غبن | 01014868778
//
// Usage:
//   npm run db:migrate
//
// Requires DATABASE_URL (Supabase → Project Settings → Database
// → Connection string → URI, "Session" mode recommended).
// Falls back to SUPABASE_DB_URL if DATABASE_URL is not set.
// ============================================================
'use strict';
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');
const { logger } = require('../utils/logger');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

if (!connectionString) {
  logger.error('❌ DATABASE_URL (or SUPABASE_DB_URL) is not set in .env');
  logger.error('   Get it from: Supabase Dashboard → Project Settings → Database → Connection string');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
// __dirname = core/src/db  →  ../../.. = project root  →  /plugins
const PLUGINS_DIR    = path.resolve(__dirname, '..', '..', '..', 'plugins');

// ── Collect core migration files (numeric prefix order) ────
const coreMigrations = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b))
  .map(f => ({ name: f, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8') }));

// ── Collect plugin MIGRATION_SQL exports ───────────────────
const collectPluginMigrations = () => {
  const out = [];
  if (!fs.existsSync(PLUGINS_DIR)) return out;

  for (const pluginKey of fs.readdirSync(PLUGINS_DIR)) {
    if (pluginKey.startsWith('_')) continue; // skip _bundle, _uploads
    const indexPath = path.join(PLUGINS_DIR, pluginKey, 'index.js');
    if (!fs.existsSync(indexPath)) continue;

    try {
      const mod = require(indexPath);
      if (mod.MIGRATION_SQL && typeof mod.MIGRATION_SQL === 'string') {
        out.push({ name: `plugin:${pluginKey}`, sql: mod.MIGRATION_SQL });
      }
    } catch (err) {
      logger.warn(`⚠️  Could not load plugin "${pluginKey}" for migration: ${err.message}`);
    }
  }
  return out;
};

// ── Run all migrations sequentially in a single transaction-safe loop ──
const run = async () => {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  logger.info('✅ Connected to database');

  const allMigrations = [...coreMigrations, ...collectPluginMigrations()];

  for (const { name, sql } of allMigrations) {
    if (!sql.trim()) continue;
    logger.info(`▶️  Running migration: ${name}`);
    try {
      await client.query(sql);
      logger.info(`✅ Done: ${name}`);
    } catch (err) {
      logger.error(`❌ Migration failed: ${name}`);
      logger.error(`   ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  logger.info(`🎉 All ${allMigrations.length} migrations completed successfully`);
};

run().catch(err => {
  logger.error('❌ Migration runner crashed:', err.message);
  process.exit(1);
});
