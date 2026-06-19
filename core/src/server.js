// ============================================================
// G-Tech Developer ERP v3 — Core API Server
// جيتك المطور | أ. علاء غبن | 01014868778
// ============================================================
'use strict';
require('dotenv').config();
require('express-async-errors');

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { logger }  = require('./utils/logger');

const { errorHandler }     = require('./middleware/errorHandler');
const { tenantMiddleware }  = require('./middleware/tenantMiddleware');
const { authMiddleware }    = require('./middleware/authMiddleware');
const { pluginRouter }      = require('./services/pluginLoader');
const { startDueDateCron }  = require('./services/dueDateAlerts');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security & Compression ─────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors({
  origin:       (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  credentials:  true,
  methods:      ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization','X-Tenant-ID','X-Plugin-ID','X-Request-ID'],
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ── Rate Limiting ──────────────────────────────────────────
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 800, standardHeaders: true }));
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20 });

// ── Request ID ────────────────────────────────────────────
app.use((req, _, next) => {
  req.requestId = require('crypto').randomUUID();
  next();
});

// ── Health ─────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status: 'running', system: 'G-Tech Developer ERP v3 | جيتك المطور',
  version: process.env.APP_VERSION || '3.0.0',
  owner: 'أ. علاء غبن', contact: '01014868778',
  uptime: process.uptime(), timestamp: new Date().toISOString(),
}));

// ── Public Routes ──────────────────────────────────────────
app.use('/api/auth',    authLimiter, require('./api/auth'));
app.use('/api/updates',             require('./api/updates'));

// ── Tenant Context on ALL protected routes ─────────────────
app.use('/api', tenantMiddleware);

// ── Super Admin ────────────────────────────────────────────
app.use('/api/admin',   authMiddleware(['super_admin']), require('./api/admin'));
app.use('/api/tenants', authMiddleware(['super_admin']), require('./api/tenants'));

// ── Tenant Routes ──────────────────────────────────────────
const RA = (roles) => authMiddleware(roles);
app.use('/api/financials',    RA(['super_admin','tenant_admin','accountant']),             require('./api/financials'));
app.use('/api/invoices',      RA(['super_admin','tenant_admin','accountant','cashier']),   require('./api/invoices'));
app.use('/api/inventory',     RA(['super_admin','tenant_admin','warehouse','staff']),      require('./api/inventory'));
app.use('/api/hr',            RA(['super_admin','tenant_admin','hr_manager']),             require('./api/hr'));
app.use('/api/reports',       RA(['super_admin','tenant_admin','accountant']),             require('./api/reports'));
app.use('/api/notifications', RA(['super_admin','tenant_admin','accountant','staff','cashier','hr_manager']), require('./api/notifications'));
app.use('/api/broadcasts',    RA(['tenant_admin']),                                        require('./api/broadcasts'));
app.use('/api/plugins',       RA(['super_admin','tenant_admin']),                          require('./api/plugins'));
app.use('/api/settings',      RA(['tenant_admin']),                                        require('./api/settings'));

// ── Dynamic Hot-Plug Plugin Routes ─────────────────────────
app.use('/api/plugin', pluginRouter);

app.use((_, res) => res.status(404).json({ error: 'المسار غير موجود | Route not found' }));
app.use(errorHandler);

app.listen(PORT, async () => {
  logger.info(`🚀 G-Tech ERP v3 Core API → Port ${PORT}`);
  logger.info(`👤 أ. علاء غبن | 📞 01014868778`);
  logger.info(`🌍 Env: ${process.env.NODE_ENV || 'development'}`);
  startDueDateCron();
});

module.exports = app;
