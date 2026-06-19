// ============================================================
// Plugin Loader v3 — Runtime Hot-Plug Engine
// Load / Reload / Deactivate without server restart
// ============================================================
const express          = require('express');
const path             = require('path');
const fs               = require('fs');
const { supabaseAdmin } = require('../db/client');
const { logger }        = require('../utils/logger');
const { authMiddleware } = require('../middleware/authMiddleware');

// registry[tenantId][pluginKey] = { router, meta, config, loadedAt, version }
const registry = new Map();

const pluginRouter = express.Router();
pluginRouter.use(authMiddleware(['super_admin','tenant_admin','accountant','cashier','hr_manager','sales','warehouse','staff']));

pluginRouter.use('/:pluginKey', async (req, res, next) => {
  const { pluginKey } = req.params;
  const tenantId = req.tenantId;
  if (!tenantId || !pluginKey) return res.status(400).json({ error: 'بيانات مفقودة' });

  let entry = registry.get(tenantId)?.get(pluginKey);
  if (!entry) entry = await loadPlugin(tenantId, pluginKey);

  if (!entry) {
    return res.status(403).json({
      error:    'plugin_not_activated',
      message:  `الإضافة "${pluginKey}" غير مفعّلة لهذا الحساب`,
      plugin:   pluginKey,
    });
  }

  // Express router.use('/:pluginKey') already strips the matched segment from req.url
  // so req.url here is already the sub-path (e.g. '/batches', '/dashboard')
  // Guard: ensure non-empty URL for the sub-router
  if (!req.url || req.url === '') req.url = '/';
  entry.router(req, res, next);
});

// ── Load a plugin for a specific tenant ────────────────────
const loadPlugin = async (tenantId, pluginKey) => {
  const { data: act } = await supabaseAdmin
    .from('tenant_plugin_activations')
    .select('config, plugins(version, is_published)')
    .eq('tenant_id', tenantId)
    .eq('plugin_key', pluginKey)
    .eq('is_active', true)
    .single();

  if (!act?.plugins?.is_published) return null;

  const pluginPath = path.resolve(
    __dirname, '..', '..', '..', 'plugins', pluginKey, 'index.js'
  );

  if (!fs.existsSync(pluginPath)) {
    logger.warn(`Plugin file missing: ${pluginPath}`);
    return null;
  }

  try {
    delete require.cache[require.resolve(pluginPath)];
    const mod = require(pluginPath);

    if (!mod.router || !mod.meta) {
      logger.error(`Plugin [${pluginKey}] missing router or meta export`);
      return null;
    }

    const entry = {
      router:   mod.router,
      meta:     mod.meta,
      config:   act.config || {},
      loadedAt: new Date().toISOString(),
      version:  act.plugins.version,
    };

    if (!registry.has(tenantId)) registry.set(tenantId, new Map());
    registry.get(tenantId).set(pluginKey, entry);
    logger.info(`✅ Plugin [${pluginKey}] v${entry.version} → tenant [${tenantId.slice(0,8)}...]`);
    return entry;
  } catch (err) {
    logger.error(`Plugin [${pluginKey}] load error:`, err.message);
    return null;
  }
};

// ── Hot-reload a plugin across all (or specific) tenants ───
const hotReloadPlugin = async (pluginKey, tenantIds = null) => {
  if (!tenantIds) {
    const { data } = await supabaseAdmin
      .from('tenant_plugin_activations')
      .select('tenant_id')
      .eq('plugin_key', pluginKey)
      .eq('is_active', true);
    tenantIds = (data || []).map(a => a.tenant_id);
  }

  let reloaded = 0;
  for (const tid of tenantIds) {
    registry.get(tid)?.delete(pluginKey);
    const e = await loadPlugin(tid, pluginKey);
    if (e) reloaded++;
  }
  logger.info(`🔄 Hot-reload [${pluginKey}]: ${reloaded}/${tenantIds.length} tenants`);
  return { reloaded, total: tenantIds.length };
};

const deactivatePlugin = (tenantId, pluginKey) => {
  registry.get(tenantId)?.delete(pluginKey);
  logger.info(`🔴 Plugin [${pluginKey}] unloaded for tenant [${tenantId?.slice(0,8)}...]`);
};

const getRegistryStatus = () => {
  const out = {};
  for (const [tid, plugins] of registry) {
    out[tid] = {};
    for (const [key, e] of plugins) {
      out[tid][key] = { version: e.version, loadedAt: e.loadedAt };
    }
  }
  return out;
};

module.exports = { pluginRouter, loadPlugin, hotReloadPlugin, deactivatePlugin, getRegistryStatus };
