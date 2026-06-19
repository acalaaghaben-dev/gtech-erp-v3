// ============================================================
// Supabase DB Client v3 — Multi-Tenant RLS Engine
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const { logger }       = require('../utils/logger');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

// Service-role client (bypasses RLS — super_admin only)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Execute query within tenant RLS context
const withTenant = async (tenantId, queryFn) => {
  if (!tenantId) throw new Error('withTenant: tenantId is required');
  await supabaseAdmin.rpc('set_tenant_context', { p_tid: tenantId });
  try {
    return await queryFn(supabaseAdmin);
  } finally {
    await supabaseAdmin.rpc('clear_tenant_context').catch(() => {});
  }
};

// Auto-number generator per document type per tenant
const nextNumber = async (tenantId, table, prefix, field = 'created_at') => {
  const { count } = await supabaseAdmin
    .from(table).select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String((count || 0) + 1).padStart(5, '0')}`;
};

const checkDb = async () => {
  const { error } = await supabaseAdmin.from('tenants').select('id').limit(1);
  if (error) { logger.error('❌ DB connection failed', error); return false; }
  logger.info('✅ Supabase connected');
  return true;
};

module.exports = { supabaseAdmin, withTenant, nextNumber, checkDb };
