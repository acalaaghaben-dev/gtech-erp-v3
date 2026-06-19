// ============================================================
// Tenant Middleware v3 — Kill-Switch Data Freeze
// Freezes ACCESS only. NEVER touches data.
// ============================================================
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../db/client');
const { logger }        = require('../utils/logger');

// In-memory cache: 3 min TTL (short → kill-switch takes effect fast)
const cache  = new Map();
const TTL_MS = 3 * 60 * 1000;

const cacheGet = (id) => {
  const e = cache.get(id);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) { cache.delete(id); return null; }
  return e.v;
};
const cacheSet   = (id, v) => cache.set(id, { v, ts: Date.now() });
const cacheFlush = (id)    => cache.delete(id);
const cacheFlushAll = ()   => cache.clear();

const tenantMiddleware = async (req, res, next) => {
  try {
    let tenantId = null;
    const auth   = req.headers.authorization;

    if (auth?.startsWith('Bearer ')) {
      try {
        const p  = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
        req.user = p;
        tenantId = p.tenantId || null;
      } catch (_) { /* authMiddleware handles invalid JWT */ }
    }

    // Super-admin cross-tenant override header
    if (req.headers['x-tenant-id'] && req.user?.role === 'super_admin') {
      tenantId = req.headers['x-tenant-id'];
    }

    if (!tenantId) return next();

    // Check cache
    let tenant = cacheGet(tenantId);

    if (!tenant) {
      const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('id,code,name_ar,status,suspension_message,suspension_logo_url,plan,theme_config,locale,currency,timezone,locked_periods,alert_days_before,alert_bar_enabled,alert_bar_position,logo_url')
        .eq('id', tenantId)
        .single();

      if (error || !data) {
        logger.warn(`Invalid tenant_id: ${tenantId}`);
        return res.status(401).json({ error: 'مستأجر غير صالح' });
      }
      tenant = data;
      cacheSet(tenantId, tenant);
    }

    // ── KILL-SWITCH: data freeze — access blocked, zero data loss ──
    if (tenant.status === 'suspended' || tenant.status === 'terminated') {
      return res.status(403).json({
        error:          tenant.status,
        message:        tenant.suspension_message ||
                        'النسخة متوقفة مؤقتاً، يرجى مراجعة المطور أ. علاء غبن على 01014868778',
        developer:      'أ. علاء غبن',
        contact:        '01014868778',
        logo_url:       tenant.suspension_logo_url || null,
        data_intact:    true,  // All data preserved — no deletion occurred
        reactivatable:  true,
      });
    }

    req.tenant   = tenant;
    req.tenantId = tenantId;
    next();

  } catch (err) {
    logger.error('tenantMiddleware error:', err.message);
    res.status(500).json({ error: 'خطأ داخلي في التحقق من المستأجر' });
  }
};

module.exports = { tenantMiddleware, flushTenantCache: cacheFlush, flushAllCache: cacheFlushAll };
