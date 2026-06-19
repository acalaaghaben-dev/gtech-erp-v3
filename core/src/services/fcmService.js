// ============================================================
// FCM Service v3 — Firebase Cloud Messaging
// ============================================================
const admin = require('firebase-admin');
const { supabaseAdmin } = require('../db/client');
const { logger }        = require('../utils/logger');

let messaging;
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  messaging = admin.messaging();
} catch (err) {
  logger.warn('Firebase not configured — push notifications disabled');
}

const sendBatch = async (tokens, payload) => {
  if (!messaging || !tokens?.length) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const r = await messaging.sendEachForMulticast({
      tokens: tokens.slice(i, i + 500),
      notification: { title: payload.title_ar, body: payload.body_ar },
      data: { type: payload.type || 'info', ...payload.data },
      android: { priority: 'high', notification: { sound: 'default', channelId: 'gtech_erp' } },
      apns:    { payload: { aps: { sound: 'default', badge: 1 } } },
    });
    sent   += r.successCount;
    failed += r.failureCount;
  }
  return { sent, failed };
};

const sendToUser = async (userId, payload) => {
  const { data: u } = await supabaseAdmin.from('users').select('fcm_token').eq('id', userId).single();
  if (!u?.fcm_token) return { sent: 0 };
  return sendBatch([u.fcm_token], payload);
};

const sendToTenant = async (tenantId, payload) => {
  const { data: users } = await supabaseAdmin
    .from('users').select('fcm_token').eq('tenant_id', tenantId).eq('is_active', true).not('fcm_token', 'is', null);
  const tokens = (users || []).map(u => u.fcm_token).filter(Boolean);
  const result = await sendBatch(tokens, payload);
  logger.info(`FCM → tenant [${tenantId?.slice(0,8)}...]: ${result.sent}/${tokens.length}`);
  return result;
};

const broadcastToAll = async (payload) => {
  const { data: users } = await supabaseAdmin
    .from('users').select('fcm_token').eq('is_active', true).not('fcm_token', 'is', null);
  const tokens = [...new Set((users || []).map(u => u.fcm_token).filter(Boolean))];
  const result = await sendBatch(tokens, payload);
  logger.info(`📢 FCM broadcast: ${result.sent}/${tokens.length}`);
  return { ...result, total: tokens.length };
};

const sendKillSwitch = (tenantId, message) =>
  sendToTenant(tenantId, {
    title_ar: '⚠️ إشعار من إدارة النظام',
    body_ar:  message || 'النسخة متوقفة مؤقتاً. يرجى مراجعة المطور أ. علاء غبن على 01014868778',
    type: 'system',
    data: { action: 'kill_switch', contact: '01014868778' },
  });

// ============================================================
// Due Date Alerts — Cron Service (runs every hour)
// ============================================================
const startDueDateCron = () => {
  const run = async () => {
    try {
      const { data: cnt } = await supabaseAdmin.rpc('fire_due_date_alerts');
      if (cnt > 0) {
        logger.info(`⏰ Due-date alerts fired: ${cnt}`);
        const { data: pending } = await supabaseAdmin
          .from('notifications').select('tenant_id,title_ar,body_ar')
          .eq('source', 'due_date').eq('fcm_sent', false).limit(200);
        for (const n of (pending || [])) {
          await sendToTenant(n.tenant_id, { title_ar: n.title_ar, body_ar: n.body_ar, type: 'due_date' });
          await supabaseAdmin.from('notifications')
            .update({ fcm_sent: true })
            .eq('source', 'due_date').eq('fcm_sent', false).eq('tenant_id', n.tenant_id);
        }
      }
    } catch (err) { logger.error('dueDateCron error:', err.message); }
  };
  run();
  setInterval(run, 60 * 60 * 1000);
  logger.info('⏰ Due-date alert cron started (1h interval)');
};

// Single clean export — all functions together
module.exports = { sendToUser, sendToTenant, broadcastToAll, sendKillSwitch, startDueDateCron };
