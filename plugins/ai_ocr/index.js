// ============================================================
// Plugin: AI OCR Scanner v3 (ماسح الفواتير الذكي)
// Camera + Drag-Drop | Multi-image | GPT-4o | Auto-Draft
// ============================================================
'use strict';
const express = require('express');
const multer  = require('multer');
const { supabaseAdmin } = require('../../core/src/db/client');
const { authMiddleware } = require('../../core/src/middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware(['tenant_admin','accountant']));

const meta = {
  key: 'ai_ocr', version: '3.0.0',
  name_ar: 'ماسح الفواتير الذكي', name_en: 'AI OCR Document Scanner',
  tables: ['ocr_scan_jobs'],
  permissions: ['read','write'],
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20*1024*1024, files: 20 },
  fileFilter: (_, f, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|heic)$/.test(f.mimetype) || f.originalname.toLowerCase().endsWith('.pdf');
    cb(null, ok);
  },
});

// ── OCR Engine — GPT-4o Vision (primary) ───────────────────
const extractWithGPT4o = async (buffer, mimeType) => {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const base64 = buffer.toString('base64');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract invoice data from this image. Return ONLY valid JSON with these fields:
{
  "vendor_name": string or null,
  "vendor_phone": string or null,
  "invoice_number": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "due_date": "YYYY-MM-DD" or null,
  "payment_method": "cash"|"check"|"credit"|"bank_transfer"|"other" or null,
  "subtotal": number or null,
  "tax_amount": number or null,
  "total_amount": number or null,
  "currency": "EGP"|"USD"|"EUR" or null,
  "items": [{"description":string,"quantity":number,"unit_price":number,"total":number}] or [],
  "notes": string or null
}
If a field is unclear or absent, use null. Numbers without commas or currency symbols.`
          },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
        ],
      }],
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'GPT-4o error');

  const text = json.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text.replace(/```json|```/g,'').trim());
};

// ── OCR Engine — Google Vision (fallback) ──────────────────
const extractWithVision = async (buffer, mimeType) => {
  if (!process.env.GOOGLE_VISION_API_KEY) return { raw_text:'', engine:'none' };
  const base64 = buffer.toString('base64');
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ requests:[{ image:{content:base64}, features:[{type:'DOCUMENT_TEXT_DETECTION'}] }] }),
  });
  const j = await res.json();
  return { raw_text: j.responses?.[0]?.fullTextAnnotation?.text||'', engine:'google_vision' };
};

// ── POST /scan — upload multiple images ────────────────────
router.post('/scan', upload.array('invoices', 20), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error:'لم يتم رفع أي ملفات' });

  // Create job
  const { data: job } = await supabaseAdmin.from('ocr_scan_jobs').insert({
    tenant_id:   req.tenantId,
    file_urls:   req.files.map(f=>f.originalname),
    total_files: req.files.length,
    status:      'processing',
    created_by:  req.user?.id,
  }).select().single();

  // Respond immediately
  res.status(202).json({ job_id: job.id, total_files: req.files.length, message: 'جاري المسح الضوئي الآن...' });

  // ── Background OCR ─────────────────────────────────────
  setImmediate(async () => {
    const extracted = [];
    const draftIds  = [];
    let doneCnt     = 0;

    for (const file of req.files) {
      try {
        let data;
        try {
          data = await extractWithGPT4o(file.buffer, file.mimetype);
          data._engine = 'gpt-4o';
        } catch {
          data = await extractWithVision(file.buffer, file.mimetype);
          data._engine = 'google_vision';
        }

        // Auto-create draft purchase invoice if we have enough data
        if (data.total_amount || data.subtotal) {
          const total = parseFloat(data.total_amount || data.subtotal) || 0;
          const { count } = await supabaseAdmin.from('invoices').select('*',{count:'exact',head:true}).eq('tenant_id',req.tenantId).eq('invoice_type','purchase');
          const num = `OCR-PUR-${new Date().getFullYear()}-${String((count||0)+1).padStart(5,'0')}`;

          const { data: draft } = await supabaseAdmin.from('invoices').insert({
            tenant_id:      req.tenantId,
            invoice_type:   'purchase',
            invoice_number: num,
            invoice_date:   data.invoice_date || new Date().toISOString().split('T')[0],
            due_date:       data.due_date || null,
            payment_method: data.payment_method || 'cash',
            subtotal:       parseFloat(data.subtotal)||total,
            tax_amount:     parseFloat(data.tax_amount)||0,
            total,
            balance_due:    total,
            status:         'draft',
            notes:          `مستخرج بالذكاء الاصطناعي (${data._engine}) من: ${file.originalname}\nالمورد: ${data.vendor_name||'غير محدد'}`,
            created_by:     req.user?.id,
          }).select().single();

          if (draft) {
            // Insert lines
            if (data.items?.length) {
              await supabaseAdmin.from('invoice_lines').insert(
                data.items.map((item,j) => ({
                  tenant_id:   req.tenantId,
                  invoice_id:  draft.id,
                  description: item.description,
                  quantity:    item.quantity||1,
                  unit_price:  item.unit_price||item.total||0,
                  line_total:  item.total||0,
                  line_order:  j,
                }))
              );
            }
            draftIds.push(draft.id);
          }
        }

        extracted.push({ file: file.originalname, data, success: true });
      } catch (err) {
        extracted.push({ file: file.originalname, error: err.message, success: false });
      }

      doneCnt++;
      await supabaseAdmin.from('ocr_scan_jobs').update({ done_files: doneCnt }).eq('id', job.id);
    }

    await supabaseAdmin.from('ocr_scan_jobs').update({
      status:    'done',
      extracted,
      draft_ids: draftIds,
      done_files: doneCnt,
    }).eq('id', job.id);
  });
});

// ── GET /jobs — job history ────────────────────────────────
router.get('/jobs', async (req, res) => {
  const { data } = await supabaseAdmin.from('ocr_scan_jobs')
    .select('id,status,total_files,done_files,created_at')
    .eq('tenant_id',req.tenantId).order('created_at',{ascending:false}).limit(30);
  res.json(data);
});

router.get('/jobs/:id', async (req, res) => {
  const { data } = await supabaseAdmin.from('ocr_scan_jobs').select('*').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  if (!data) return res.status(404).json({ error:'مهمة غير موجودة' });
  res.json(data);
});

// ── GET /jobs/:id/drafts — fetch created draft invoices ────
router.get('/jobs/:id/drafts', async (req, res) => {
  const { data: job } = await supabaseAdmin.from('ocr_scan_jobs').select('draft_ids').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  if (!job?.draft_ids?.length) return res.json([]);
  const { data } = await supabaseAdmin.from('invoices').select('*,invoice_lines(*)').in('id',job.draft_ids).eq('tenant_id',req.tenantId);
  res.json(data);
});

module.exports = { router, meta };
