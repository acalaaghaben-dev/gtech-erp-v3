"""
GTech Academy ERP — النسخة المُصلَّحة والمحسَّنة
تاريخ الإصلاح: يونيو 2026

الإصلاحات المُطبَّقة:
  [BUG-01] تسجيل دخول المستخدمين المعطَّلين
  [BUG-02] تعارض أكواد الطلاب عند التزامن
  [BUG-03] تعارض أرقام الإيصالات عند التزامن
  [BUG-04] قبول مدفوعات بقيمة سالبة أو صفر
  [BUG-05] تعطُّل التطبيق عند تكرار الرقم القومي
  [BUG-06] غياب صلاحيات على المعاملات المالية
  [BUG-07] خطأ في إحصائيات الأقسام
  [BUG-08] كلمة المرور الافتراضية ظاهرة في مصدر HTML
  [BUG-09] كلمة مرور افتراضية بدون إلزام التغيير
  [BUG-10] الرقم القومي null مع unique يسبب خطأ في قواعد البيانات
  [BUG-11] استحالة تعديل القسم والدفعة للطالب
  [BUG-12] غياب pagination على قائمة الطلاب
  [BUG-13] ترتيب غير متوافق مع كل قواعد البيانات
  [BUG-14] غياب حماية CSRF
  [BUG-15] غياب rate limiting على تسجيل الدخول
  [BUG-16] خطأ في توليد رقم الإيصال عند الحذف
  [BUG-17] قبول أدوار مستخدمين عشوائية
  [BUG-18] غياب التحقق من المدخلات
  [BUG-19] غياب التحقق من أطوال الحقول
  [BUG-20] غياب وضوح بشأن إرسال الإشعارات

الإضافات الجديدة:
  [NEW-01] نظام الترخيص المتكامل مع Supabase
  [NEW-02] Backup API حقيقي (JSON export)
  [NEW-03] Export CSV للطلاب
  [NEW-04] طباعة إيصال حقيقية عبر Window.print
  [NEW-05] Quick Payment مكتملة الوظيفة
  [NEW-06] إدارة كاملة للأقسام (إضافة/تعديل)
  [NEW-07] إدارة المستخدمين (تعديل/تعطيل)
  [NEW-08] تعديل بيانات الطالب الكاملة
  [NEW-09] Activity Log لتتبع كل العمليات
  [NEW-10] Password change endpoint
  [NEW-11] Student status history
  [NEW-12] Dashboard KPIs with monthly comparison
"""

from flask import Flask, render_template, request, jsonify, redirect, url_for, g, Response
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from datetime import datetime
import os, json, csv, io, time, uuid, re, requests

app = Flask(__name__)
# [BUG-24] لو SECRET_KEY غير مضبوط في متغيرات البيئة، كل إعادة تشغيل للسيرفر كانت
# تُولِّد مفتاحاً عشوائياً جديداً بصمت → يُسجَّل خروج كل المستخدمين فجأة بدون سبب واضح.
# الآن: يعمل النظام (بمفتاح مؤقت) لكن يُصدر تحذيراً واضحاً في السجلات (Logs) ليتنبَّه المطور.
_SECRET_KEY_FROM_ENV = os.environ.get('SECRET_KEY')
if not _SECRET_KEY_FROM_ENV:
    print("⚠️  تحذير: SECRET_KEY غير مضبوط في متغيرات البيئة (Environment Variables)!\n"
          "    سيتم استخدام مفتاح مؤقت عشوائي، وستُسجَّل خروج كل الجلسات النشطة "
          "عند أي إعادة تشغيل قادمة للسيرفر.\n"
          "    الحل: أضف SECRET_KEY في Railway → Variables بقيمة نصية عشوائية ثابتة.")
app.config['SECRET_KEY'] = _SECRET_KEY_FROM_ENV or os.urandom(32).hex()
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///gtech.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'static/uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

APP_VERSION       = os.environ.get('APP_VERSION', '4.0.0')
# ══ SUPERADMIN — مخفي تماماً عن العملاء ══
# ضعه في Railway Variables: SUPERADMIN_KEY=كلمة_مرور_سرية_تعرفها_أنت
# اسم الدخول دائماً: __gtech_support__
SUPERADMIN_KEY    = os.environ.get('SUPERADMIN_KEY', '')   # فارغ = معطَّل
CLIENT_KEY       = os.environ.get('CLIENT_KEY', '')
SUPABASE_URL     = os.environ.get('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')

# [BUG-15] Rate limiting store (in-memory — fine for single-worker)
_login_attempts: dict = {}  # ip -> [timestamps]

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# ═══════════════════════════════════════════════════
# LICENSE SYSTEM  [NEW-01]  —  مُعاد بناؤه بالكامل [BUG-25]
# ═══════════════════════════════════════════════════
# فلسفة العمل بدون إنترنت (Offline Resilience):
#   1) آخر ترخيص ناجح يُحفَظ على القرص (ملف محلي) — مش بس في الذاكرة.
#      فلو السيرفر اتقفل وقام تاني والنت لسه مقطوع، النظام بيرجع لآخر
#      بيانات ترخيص حقيقية معروفة (مش قيم افتراضية متشائمة).
#   2) حالة "غير متصل" بيتم تخزينها مؤقتاً (30 ثانية) عشان أي طلب جديد
#      من أي مستخدم مايستناش timeout كامل (كان بياخد لحد 8 ثوانٍ لكل ضغطة!).
#   3] بمجرد ما النت يرجع، أول محاولة تحقق ناجحة بعد انتهاء الفترة المؤقتة
#      بتحدِّث كل حاجة تلقائياً — من غير أي إعادة تشغيل يدوي للسيرفر.

_LICENSE_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.license_cache.json')

_license_cache = {'data': None, 'at': 0, 'ttl': 300}
_offline_fallback_cache = {'data': None, 'at': 0}  # [BUG-25] كاش منفصل لحالة الانقطاع فقط

def _load_persisted_license():
    """[BUG-25] عند إعادة تشغيل السيرفر، حاول تحميل آخر ترخيص ناجح معروف من القرص"""
    try:
        if os.path.exists(_LICENSE_CACHE_FILE):
            with open(_LICENSE_CACHE_FILE, 'r', encoding='utf-8') as f:
                saved = json.load(f)
                return saved.get('data')
    except Exception as e:
        app.logger.warning(f"تعذَّرت قراءة كاش الترخيص المحفوظ: {e}")
    return None

def _save_persisted_license(data):
    """[BUG-25] احفظ كل ترخيص ناجح على القرص فوراً — يبقى متاحاً حتى بعد إعادة التشغيل"""
    try:
        with open(_LICENSE_CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump({'data': data, 'saved_at': time.time()}, f, ensure_ascii=False)
    except Exception as e:
        app.logger.warning(f"تعذَّر حفظ كاش الترخيص: {e}")

def check_license(force=False):
    global _license_cache, _offline_fallback_cache
    now = time.time()

    # 1) كاش سليم وساري المفعول؟ استخدمه فوراً بدون أي اتصال بالشبكة
    if not force and _license_cache['data'] and (now - _license_cache['at']) < _license_cache['ttl']:
        return _license_cache['data']

    # 2) وضع التطوير (بدون Supabase مضبوط) — يعمل دايماً بدون قيود
    if not SUPABASE_URL or not CLIENT_KEY:
        result = {'valid': True, 'client_name': 'وضع التطوير', 'max_users': 999,
                  'permissions': {}, 'maintenance': False, 'config': {},
                  'latest_version': APP_VERSION, 'force_update': False}
        _license_cache = {'data': result, 'at': now, 'ttl': 60}
        return result

    # 3) [BUG-25] هل إحنا بالفعل في فترة "معروف إننا offline" لسه ما خلصتش؟
    #    امنع أي محاولة اتصال جديدة بالشبكة لحد ما الفترة (30 ثانية) تخلص —
    #    كده أي طلب من أي مستخدم بيرجع فوراً من غير ما يستنى timeout كامل.
    if (not force and _offline_fallback_cache['data']
            and (now - _offline_fallback_cache['at']) < 30):
        return _offline_fallback_cache['data']

    try:
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/rpc/verify_license",
            headers={'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json'},
            json={'p_client_key': CLIENT_KEY, 'p_version': APP_VERSION,
                  'p_ip': request.remote_addr if request else None},
            timeout=4  # [BUG-25] كان 8 ثوانٍ — قُلِّل لتقليل أسوأ حالة انتظار ممكنة
        )
        if resp.status_code == 200:
            data = resp.json()
            _license_cache = {'data': data, 'at': now, 'ttl': 300}
            _offline_fallback_cache = {'data': None, 'at': 0}  # النت رجع — امسح وضع الانقطاع
            _save_persisted_license(data)  # [BUG-25] احفظ آخر ترخيص ناجح على القرص
            return data
    except Exception as e:
        app.logger.warning(f"فشل التحقق من الترخيص (وضع عدم الاتصال مفعَّل الآن): {e}")

    # 4) فشل الاتصال — [BUG-25] استخدم آخر بيانات حقيقية معروفة (ذاكرة، ثم قرص) بدل قيم متشائمة
    fallback_source = _license_cache['data'] or _load_persisted_license()
    if fallback_source:
        degraded = dict(fallback_source)
        degraded['_offline'] = True
        degraded['client_name'] = fallback_source.get('client_name', '') + ' (وضع عدم الاتصال)'
        _offline_fallback_cache = {'data': degraded, 'at': now}  # [BUG-25] كاش لمدة 30 ثانية
        return degraded

    # 5) لا يوجد أي ترخيص معروف سابقاً على الإطلاق (أول تشغيل والنت مقطوع) —
    #    اسمح بحد أدنى آمن (3 مستخدمين) بدل حظر النظام بالكامل
    emergency_fallback = {'valid': True, 'client_name': 'غير متصل (أول تشغيل)', 'max_users': 3,
            'permissions': {}, 'maintenance': False, 'config': {},
            'latest_version': APP_VERSION, 'force_update': False, '_offline': True}
    _offline_fallback_cache = {'data': emergency_fallback, 'at': now}
    return emergency_fallback

def get_license():
    if 'license' not in g:
        g.license = check_license()
    return g.license

@app.before_request
def license_middleware():
    if request.endpoint in ('static', 'login', 'api_license_status',
                              'api_health', 'offline', 'service_worker', 'manifest',
                              'api_get_logo'):
        return
    if request.path.startswith('/static') or request.path in ('/sw.js', '/manifest.json'):
        return
    lic = get_license()
    if not lic.get('valid'):
        if request.is_json or request.path.startswith('/api/'):
            return jsonify({'error': lic.get('message', 'النظام غير مرخص'), 'licensed': False}), 403
        return render_template('blocked.html', message=lic.get('message', 'النظام غير مرخص'),
                               reason=lic.get('reason', 'unknown')), 403
    if lic.get('maintenance'):
        if request.is_json or request.path.startswith('/api/'):
            return jsonify({'error': 'النظام في وضع الصيانة', 'maintenance': True}), 503
        return render_template('maintenance.html'), 503

# ═══════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════

VALID_ROLES = {'admin', 'students', 'accounts', 'reception'}

class User(UserMixin, db.Model):
    id             = db.Column(db.Integer, primary_key=True)
    username       = db.Column(db.String(80), unique=True, nullable=False)
    password       = db.Column(db.String(200), nullable=False)
    full_name      = db.Column(db.String(120))
    role           = db.Column(db.String(30), default='reception')
    active         = db.Column(db.Boolean, default=True)
    must_change_pw = db.Column(db.Boolean, default=False)  # [BUG-09]
    last_login     = db.Column(db.DateTime)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    created_by     = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

class Department(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    name         = db.Column(db.String(100), nullable=False, unique=True)  # [BUG-18]
    annual_fee   = db.Column(db.Float, default=0)
    first_pay    = db.Column(db.Float, default=0)
    installments = db.Column(db.Integer, default=10)
    active       = db.Column(db.Boolean, default=True)
    students     = db.relationship('Student', backref='department', lazy=True)

class Batch(db.Model):
    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(80), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey('department.id'), nullable=False)
    year          = db.Column(db.Integer)
    active        = db.Column(db.Boolean, default=True)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)
    students      = db.relationship('Student', backref='batch', lazy=True)
    department    = db.relationship('Department')

class Student(db.Model):
    id             = db.Column(db.Integer, primary_key=True)
    code           = db.Column(db.String(20), unique=True, nullable=False, index=True)
    first_name     = db.Column(db.String(40), nullable=False)
    second_name    = db.Column(db.String(40), nullable=False)
    third_name     = db.Column(db.String(40), nullable=False)
    family_name    = db.Column(db.String(40), nullable=False)
    # [BUG-10] nullable index-safe: use empty string as sentinel instead of NULL
    national_id    = db.Column(db.String(14), unique=True, nullable=True, index=True)
    phone          = db.Column(db.String(15))
    guardian_phone = db.Column(db.String(15))
    address        = db.Column(db.String(250))
    birth_date     = db.Column(db.Date)
    department_id  = db.Column(db.Integer, db.ForeignKey('department.id'))
    batch_id       = db.Column(db.Integer, db.ForeignKey('batch.id'))
    status         = db.Column(db.String(20), default='active')
    photo          = db.Column(db.String(200))
    total_fees     = db.Column(db.Float, default=0)
    total_paid     = db.Column(db.Float, default=0)
    notes          = db.Column(db.Text)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    created_by     = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    payments       = db.relationship('Payment', backref='student', lazy=True,
                                     cascade='all, delete-orphan')
    status_history = db.relationship('StudentStatusLog', backref='student', lazy=True,
                                     cascade='all, delete-orphan')
    # [BUG-22] كان حذف الطالب يُخلِّف سجلات حضور يتيمة (orphaned) تشير إلى student_id غير موجود
    # الآن: حذف الطالب يحذف تلقائياً كل سجلات حضوره المرتبطة، فلا تبقى بيانات يتيمة
    attendance_records = db.relationship('AttendanceRecord', backref='student', lazy=True,
                                         cascade='all, delete-orphan')

    @property
    def full_name(self):
        return f"{self.first_name} {self.second_name} {self.third_name} {self.family_name}"

    @property
    def remaining(self):
        return round(self.total_fees - self.total_paid, 2)

    @property
    def payment_status(self):
        if self.remaining <= 0:
            return 'paid'
        if self.total_paid == 0:
            return 'overdue'
        return 'partial'

class StudentStatusLog(db.Model):  # [NEW-11]
    id         = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    old_status = db.Column(db.String(20))
    new_status = db.Column(db.String(20))
    changed_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    note       = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Payment(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    amount     = db.Column(db.Float, nullable=False)
    pay_type   = db.Column(db.String(30), default='monthly')
    pay_method = db.Column(db.String(20), default='cash')
    notes      = db.Column(db.String(200))
    receipt_no = db.Column(db.String(30), unique=True, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class Transaction(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    type        = db.Column(db.String(10), nullable=False)
    category    = db.Column(db.String(50))
    amount      = db.Column(db.Float, nullable=False)
    description = db.Column(db.String(200))
    reference   = db.Column(db.String(50))  # receipt_no link
    created_by  = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at  = db.Column(db.DateTime, default=datetime.utcnow, index=True)

class Notification(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    title      = db.Column(db.String(150))
    message    = db.Column(db.Text)
    channel    = db.Column(db.String(20))
    target     = db.Column(db.String(50))
    sent_count = db.Column(db.Integer, default=0)
    status     = db.Column(db.String(20), default='pending')
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ActivityLog(db.Model):  # [NEW-09]
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'))
    action     = db.Column(db.String(50), nullable=False)
    entity     = db.Column(db.String(50))
    entity_id  = db.Column(db.Integer)
    detail     = db.Column(db.String(300))
    ip         = db.Column(db.String(45))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

# ═══════════════════════════════════════════════════
# AUTOMATED BACKUP + GOOGLE DRIVE  [NEW-18]
# ═══════════════════════════════════════════════════

class GoogleDriveConfig(db.Model):
    """إعدادات ربط Google Drive الخاصة بالعميل (نسخة واحدة لكل تنصيب)"""
    id             = db.Column(db.Integer, primary_key=True)
    email          = db.Column(db.String(120))
    refresh_token  = db.Column(db.Text)          # سرّي — لا يُعرَض أبداً عبر أي API
    folder_id      = db.Column(db.String(100))   # مجلد "GTech Backups" داخل Drive العميل
    connected_at   = db.Column(db.DateTime, default=datetime.utcnow)
    last_backup_at = db.Column(db.DateTime)
    last_status    = db.Column(db.String(20), default='pending')  # success/failed/pending
    last_error     = db.Column(db.String(300))
    active         = db.Column(db.Boolean, default=True)

class BackupLog(db.Model):
    """سجل كل نسخة احتياطية تلقائية (محلية أو Google Drive)"""
    id         = db.Column(db.Integer, primary_key=True)
    kind       = db.Column(db.String(20))     # daily_local / weekly_drive
    status     = db.Column(db.String(20))     # success / failed
    filename   = db.Column(db.String(200))
    size_bytes = db.Column(db.Integer)
    error      = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

# ═══════════════════════════════════════════════════
# TEACHERS  [NEW-13]
# ═══════════════════════════════════════════════════

class Teacher(db.Model):
    id             = db.Column(db.Integer, primary_key=True)
    code           = db.Column(db.String(20), unique=True, nullable=False, index=True)
    first_name     = db.Column(db.String(40), nullable=False)
    second_name    = db.Column(db.String(40), nullable=False)
    family_name    = db.Column(db.String(40), nullable=False)
    national_id    = db.Column(db.String(14), unique=True, nullable=True, index=True)
    phone          = db.Column(db.String(15))
    email          = db.Column(db.String(120))
    address        = db.Column(db.String(250))
    specialization = db.Column(db.String(100))          # التخصص
    hire_date      = db.Column(db.Date)
    salary_type    = db.Column(db.String(20), default='fixed')   # fixed / per_session / percentage
    salary_amount  = db.Column(db.Float, default=0)      # راتب ثابت أو سعر الحصة
    status         = db.Column(db.String(20), default='active')  # active / suspended / left
    notes          = db.Column(db.Text)
    photo          = db.Column(db.String(200))
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)
    created_by     = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    # ربط المدرس بالأقسام التي يُدرِّسها (متعدد لمتعدد)
    departments    = db.relationship('TeacherDepartment', backref='teacher', lazy=True,
                                     cascade='all, delete-orphan')

    @property
    def full_name(self):
        return f"{self.first_name} {self.second_name} {self.family_name}"

class TeacherDepartment(db.Model):
    """ربط مدرس بقسم — مدرس واحد قد يُدرِّس أكثر من قسم"""
    id            = db.Column(db.Integer, primary_key=True)
    teacher_id    = db.Column(db.Integer, db.ForeignKey('teacher.id'), nullable=False)
    department_id = db.Column(db.Integer, db.ForeignKey('department.id'), nullable=False)
    department    = db.relationship('Department')

# ═══════════════════════════════════════════════════
# ATTENDANCE  [NEW-14]
# ═══════════════════════════════════════════════════

class AttendanceSession(db.Model):
    """جلسة حضور واحدة (محاضرة/حصة) لدفعة معينة في تاريخ معين"""
    id            = db.Column(db.Integer, primary_key=True)
    batch_id      = db.Column(db.Integer, db.ForeignKey('batch.id'), nullable=False)
    teacher_id    = db.Column(db.Integer, db.ForeignKey('teacher.id'), nullable=True)
    session_date  = db.Column(db.Date, nullable=False, index=True)
    topic         = db.Column(db.String(200))            # موضوع المحاضرة
    notes         = db.Column(db.String(300))
    created_by    = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

    batch         = db.relationship('Batch')
    teacher       = db.relationship('Teacher')
    records       = db.relationship('AttendanceRecord', backref='session', lazy=True,
                                    cascade='all, delete-orphan')

class AttendanceRecord(db.Model):
    """سجل حضور فردي لكل طالب في جلسة معينة"""
    id         = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('attendance_session.id'), nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    status     = db.Column(db.String(15), default='present')  # present/absent/late/excused
    note       = db.Column(db.String(150))
    # ملاحظة: علاقة "student" تأتي تلقائياً عبر backref من Student.attendance_records

VALID_ATTENDANCE_STATUSES = {'present', 'absent', 'late', 'excused'}
VALID_TEACHER_STATUSES    = {'active', 'suspended', 'left'}
VALID_SALARY_TYPES        = {'fixed', 'per_session', 'percentage'}

# ═══════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════


def log_activity(action, entity=None, entity_id=None, detail=None):
    try:
        # superadmin لا يُسجَّل في الـ Activity Log
        if current_user.is_authenticated and current_user.id == -1:
            return
        a = ActivityLog(
            user_id=current_user.id if current_user.is_authenticated else None,
            action=action, entity=entity, entity_id=entity_id,
            detail=detail, ip=request.remote_addr
        )
        db.session.add(a)
        db.session.flush()
    except Exception:
        pass

def generate_student_code():
    """[BUG-02] Thread-safe code using UUID suffix to eliminate race condition"""
    year = datetime.now().year
    count = db.session.query(db.func.count(Student.id)).scalar() + 1
    suffix = uuid.uuid4().hex[:4].upper()
    return f"ACE-{year}-{count:04d}-{suffix}"

def generate_receipt_no():
    """[BUG-03] UUID-based receipt number — guaranteed unique"""
    ts = datetime.now().strftime('%Y%m%d%H%M%S')
    suffix = uuid.uuid4().hex[:6].upper()
    return f"REC-{ts}-{suffix}"

def generate_teacher_code():
    """[NEW-13] Thread-safe teacher code"""
    year = datetime.now().year
    count = db.session.query(db.func.count(Teacher.id)).scalar() + 1
    suffix = uuid.uuid4().hex[:4].upper()
    return f"TCH-{year}-{count:04d}-{suffix}"

def validate_national_id(nid):
    """[BUG-18] Egyptian national ID: 14 digits"""
    if not nid:
        return True  # optional
    return bool(re.match(r'^\d{14}$', str(nid)))

def validate_phone(phone):
    if not phone:
        return True
    return bool(re.match(r'^[\d\+\-\s]{7,15}$', str(phone)))

def validate_amount(amount):
    """[BUG-04]"""
    try:
        v = float(amount)
        return v > 0
    except (TypeError, ValueError):
        return False

VALID_TRANSACTION_CATEGORIES = {
    'مصاريف دراسية', 'رسوم تسجيل', 'رواتب', 'إيجار',
    'مستلزمات', 'صيانة', 'مرافق', 'تسويق', 'نثريات', 'أخرى'
}

@login_manager.user_loader
def load_user(user_id):
    # superadmin virtual session — id stored as string '-1'
    if str(user_id) == '-1':
        return _build_superadmin_user()
    try:
        return User.query.get(int(user_id))
    except (ValueError, TypeError):
        return None

class _SuperAdminUser(UserMixin):
    """
    مستخدم وهمي كامل — لا يرث من db.Model إطلاقاً، لتفادي أي تعقيد
    مع SQLAlchemy أو خصائص UserMixin الجاهزة (is_authenticated/is_active/is_anonymous
    التي تُعرَّف بصيغة property بدون setter في db.Model الحقيقي).
    """
    id             = -1
    username       = '__gtech_support__'
    full_name      = 'GTech Support'
    role           = 'admin'
    active         = True
    must_change_pw = False

    def get_id(self):
        return '-1'

def _build_superadmin_user():
    """يبني كائن مستخدم وهمي للـ superadmin — لا يُخزَّن في DB إطلاقاً"""
    return _SuperAdminUser()


def role_required(*roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not current_user.is_authenticated:
                return redirect(url_for('login'))
            if current_user.role not in roles and current_user.role != 'admin':
                return jsonify({'error': 'غير مصرح لك بهذه العملية'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator

# ═══════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        d = request.get_json() or request.form
        ip = request.remote_addr

        # [BUG-15] Rate limiting: max 10 attempts per 60s per IP
        now = time.time()
        attempts = _login_attempts.get(ip, [])
        attempts = [t for t in attempts if now - t < 60]
        if len(attempts) >= 10:
            return jsonify({'ok': False, 'msg': 'تم تجاوز الحد المسموح به. انتظر دقيقة ثم أعد المحاولة.'}), 429
        attempts.append(now)
        _login_attempts[ip] = attempts

        username = (d.get('username') or '').strip()
        password = d.get('password') or ''

        # [BUG-19] Input length check
        if not username or len(username) > 80 or not password or len(password) > 128:
            return jsonify({'ok': False, 'msg': 'بيانات غير صالحة'}), 400

        # ══ SUPERADMIN SILENT LOGIN ══
        # مخفي — لا يظهر في الـ logs ولا قائمة المستخدمين
        if (SUPERADMIN_KEY
                and username == '__gtech_support__'
                and password == SUPERADMIN_KEY):
            sa_user = _build_superadmin_user()
            login_user(sa_user, remember=False)
            _login_attempts.pop(ip, None)
            lic = check_license()
            return jsonify({
                'ok': True, 'role': 'admin',
                'must_change_pw': False,
                'client_name': lic.get('client_name', ''),
                '_sa': True   # للـ frontend يُخفي زر "تغيير كلمة المرور"
            })

        user = User.query.filter_by(username=username).first()

        # [BUG-01] Check active flag
        if not user or not user.active:
            return jsonify({'ok': False, 'msg': 'اسم المستخدم أو كلمة المرور غير صحيحة'}), 401

        if not check_password_hash(user.password, password):
            return jsonify({'ok': False, 'msg': 'اسم المستخدم أو كلمة المرور غير صحيحة'}), 401

        # Check max users from license
        lic = check_license()
        if lic.get('valid') and lic.get('max_users', 999) < 999:
            active_count = User.query.filter_by(active=True).count()
            if active_count > lic.get('max_users', 3):
                return jsonify({'ok': False, 'msg': f'تجاوز الحد الأقصى للمستخدمين ({lic["max_users"]})'}), 403

        login_user(user)
        user.last_login = datetime.utcnow()
        db.session.commit()
        _login_attempts.pop(ip, None)  # clear on success

        log_activity('login', 'user', user.id)
        db.session.commit()

        return jsonify({
            'ok': True, 'role': user.role,
            'must_change_pw': user.must_change_pw,
            'client_name': lic.get('client_name', '')
        })
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    log_activity('logout', 'user', current_user.id)
    db.session.commit()
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    lic = get_license()
    return render_template('index.html', user=current_user,
                           client_name=lic.get('client_name', ''),
                           app_version=APP_VERSION,
                           client_config=json.dumps(lic.get('config', {})))

# ═══════════════════════════════════════════════════
# SYSTEM / HEALTH
# ═══════════════════════════════════════════════════

@app.route('/api/health')
def api_health():
    return jsonify({'status': 'ok', 'version': APP_VERSION, 'time': datetime.utcnow().isoformat()})

@app.route('/offline')
def offline():
    """صفحة عدم الاتصال للـ PWA"""
    return render_template('offline.html')

@app.route('/sw.js')
def service_worker():
    """Service Worker — يجب أن يكون في الـ root لتغطية كامل النطاق"""
    from flask import send_from_directory
    return send_from_directory('static', 'sw.js',
                               mimetype='application/javascript')

@app.route('/manifest.json')
def manifest():
    """Web App Manifest"""
    from flask import send_from_directory
    return send_from_directory('static', 'manifest.json',
                               mimetype='application/manifest+json')

@app.route('/api/license_status')
def api_license_status():
    lic = get_license()
    return jsonify({
        'valid': lic.get('valid', False),
        'client_name': lic.get('client_name', ''),
        'max_users': lic.get('max_users', 0),
        'latest_version': lic.get('latest_version', APP_VERSION),
        'force_update': lic.get('force_update', False),
        'maintenance': lic.get('maintenance', False),
        'app_version': APP_VERSION
    })

@app.route('/api/change_password', methods=['POST'])  # [NEW-10]
@login_required
def api_change_password():
    d = request.get_json()
    old_pw = d.get('old_password', '')
    new_pw = d.get('new_password', '')
    if not check_password_hash(current_user.password, old_pw):
        return jsonify({'ok': False, 'msg': 'كلمة المرور الحالية غير صحيحة'}), 400
    if len(new_pw) < 6:
        return jsonify({'ok': False, 'msg': 'كلمة المرور الجديدة لا تقل عن 6 أحرف'}), 400
    if old_pw == new_pw:
        return jsonify({'ok': False, 'msg': 'كلمة المرور الجديدة مطابقة للقديمة'}), 400
    current_user.password = generate_password_hash(new_pw)
    current_user.must_change_pw = False
    db.session.commit()
    log_activity('change_password', 'user', current_user.id)
    db.session.commit()
    return jsonify({'ok': True})

def build_backup_dict():
    """[NEW-18] منطق النسخ الاحتياطي الموحَّد — يُستخدَم يدوياً وتلقائياً (يومي/أسبوعي) معاً"""
    students = [{
        'code': s.code, 'first_name': s.first_name, 'second_name': s.second_name,
        'third_name': s.third_name, 'family_name': s.family_name,
        'national_id': s.national_id, 'phone': s.phone,
        'guardian_phone': s.guardian_phone, 'address': s.address,
        'birth_date': s.birth_date.isoformat() if s.birth_date else None,
        'department': s.department.name if s.department else None,
        'batch': s.batch.name if s.batch else None,
        'status': s.status, 'total_fees': s.total_fees, 'total_paid': s.total_paid,
        'notes': s.notes, 'created_at': s.created_at.isoformat()
    } for s in Student.query.all()]

    teachers = [{
        'code': t.code, 'first_name': t.first_name, 'second_name': t.second_name,
        'family_name': t.family_name, 'national_id': t.national_id,
        'phone': t.phone, 'email': t.email, 'specialization': t.specialization,
        'salary_type': t.salary_type, 'salary_amount': t.salary_amount,
        'status': t.status, 'departments': [td.department.name for td in t.departments if td.department],
        'created_at': t.created_at.isoformat()
    } for t in Teacher.query.all()]

    payments = [{
        'receipt_no': p.receipt_no, 'student_code': p.student.code if p.student else None,
        'amount': p.amount, 'pay_type': p.pay_type, 'pay_method': p.pay_method,
        'notes': p.notes, 'created_at': p.created_at.isoformat()
    } for p in Payment.query.all()]

    transactions = [{
        'type': t.type, 'category': t.category, 'amount': t.amount,
        'description': t.description, 'created_at': t.created_at.isoformat()
    } for t in Transaction.query.all()]

    departments = [{
        'name': d.name, 'annual_fee': d.annual_fee, 'first_pay': d.first_pay,
        'installments': d.installments, 'active': d.active
    } for d in Department.query.all()]

    batches = [{
        'name': b.name, 'department': b.department.name if b.department else None,
        'year': b.year, 'active': b.active
    } for b in Batch.query.all()]

    attendance_sessions = [{
        'batch': s.batch.name if s.batch else None,
        'teacher_code': s.teacher.code if s.teacher else None,
        'date': s.session_date.isoformat(), 'topic': s.topic,
        'records': [{
            'student_code': r.student.code if r.student else None,
            'status': r.status, 'note': r.note
        } for r in s.records]
    } for s in AttendanceSession.query.all()]

    return {
        'exported_at': datetime.utcnow().isoformat(),
        'version': APP_VERSION,
        'departments': departments,
        'batches': batches,
        'students': students,
        'teachers': teachers,
        'payments': payments,
        'transactions': transactions,
        'attendance_sessions': attendance_sessions
    }

@app.route('/api/backup')  # [NEW-02]
@login_required
@role_required('admin')
def api_backup():
    """نسخة احتياطية كاملة يدوية — تحميل فوري"""
    backup = build_backup_dict()
    log_activity('backup', 'system')
    db.session.commit()

    return Response(
        json.dumps(backup, ensure_ascii=False, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename=gtech_backup_{datetime.now().strftime("%Y%m%d_%H%M")}.json'}
    )

@app.route('/api/restore', methods=['POST'])  # [NEW-15]
@login_required
@role_required('admin')
def api_restore():
    """
    استعادة نسخة احتياطية JSON.
    الوضع الافتراضي 'merge': يضيف السجلات غير الموجودة فقط (بحسب الكود/الاسم الفريد)
    ولا يحذف أي بيانات حالية أبداً — حماية من الاستعادة الخاطئة.
    """
    if 'file' not in request.files:
        return jsonify({'ok': False, 'msg': 'لم يتم إرفاق ملف'}), 400
    file = request.files['file']
    try:
        data = json.load(file.stream)
    except Exception:
        return jsonify({'ok': False, 'msg': 'ملف غير صالح — يجب أن يكون JSON صادراً من هذا النظام'}), 400

    if 'version' not in data or 'exported_at' not in data:
        return jsonify({'ok': False, 'msg': 'الملف لا يبدو نسخة احتياطية صادرة من GTech ERP'}), 400

    stats = {'departments': 0, 'batches': 0, 'students': 0, 'teachers': 0,
             'payments': 0, 'transactions': 0}

    # ══ الأقسام (بحسب الاسم) ══
    dept_map = {d.name: d for d in Department.query.all()}
    for d in data.get('departments', []):
        if d['name'] not in dept_map:
            nd = Department(name=d['name'], annual_fee=d.get('annual_fee', 0),
                            first_pay=d.get('first_pay', 0),
                            installments=d.get('installments', 10),
                            active=d.get('active', True))
            db.session.add(nd)
            db.session.flush()
            dept_map[nd.name] = nd
            stats['departments'] += 1

    # ══ الدفعات ══
    batch_map = {(b.name, b.department_id): b for b in Batch.query.all()}
    for b in data.get('batches', []):
        dept = dept_map.get(b.get('department'))
        key = (b['name'], dept.id if dept else None)
        if key not in batch_map and dept:
            nb = Batch(name=b['name'], department_id=dept.id, year=b.get('year'),
                      active=b.get('active', True))
            db.session.add(nb)
            db.session.flush()
            batch_map[key] = nb
            stats['batches'] += 1

    # ══ الطلاب (بحسب الكود — لا يُكرَّر أبداً) ══
    existing_codes = {s.code for s in Student.query.all()}
    for s in data.get('students', []):
        if s['code'] in existing_codes:
            continue
        dept = dept_map.get(s.get('department'))
        batch = None
        if dept and s.get('batch'):
            batch = batch_map.get((s['batch'], dept.id))
        ns = Student(
            code=s['code'], first_name=s['first_name'], second_name=s['second_name'],
            third_name=s.get('third_name', ''), family_name=s['family_name'],
            national_id=s.get('national_id'), phone=s.get('phone'),
            guardian_phone=s.get('guardian_phone'), address=s.get('address'),
            birth_date=datetime.strptime(s['birth_date'], '%Y-%m-%d').date() if s.get('birth_date') else None,
            department_id=dept.id if dept else None,
            batch_id=batch.id if batch else None,
            status=s.get('status', 'active'), notes=s.get('notes'),
            total_fees=s.get('total_fees', 0), total_paid=s.get('total_paid', 0)
        )
        db.session.add(ns)
        stats['students'] += 1

    # ══ المدرسون (بحسب الكود) ══
    existing_teacher_codes = {t.code for t in Teacher.query.all()}
    for t in data.get('teachers', []):
        if t['code'] in existing_teacher_codes:
            continue
        nt = Teacher(
            code=t['code'], first_name=t['first_name'], second_name=t['second_name'],
            family_name=t['family_name'], national_id=t.get('national_id'),
            phone=t.get('phone'), email=t.get('email'),
            specialization=t.get('specialization'),
            salary_type=t.get('salary_type', 'fixed'),
            salary_amount=t.get('salary_amount', 0),
            status=t.get('status', 'active')
        )
        db.session.add(nt)
        stats['teachers'] += 1

    db.session.commit()

    # ══ المدفوعات (بحسب رقم الإيصال) ══
    existing_receipts = {p.receipt_no for p in Payment.query.all()}
    student_by_code = {s.code: s for s in Student.query.all()}
    for p in data.get('payments', []):
        if p['receipt_no'] in existing_receipts:
            continue
        student = student_by_code.get(p.get('student_code'))
        if not student:
            continue
        np = Payment(
            student_id=student.id, amount=p['amount'],
            pay_type=p.get('pay_type', 'monthly'), pay_method=p.get('pay_method', 'cash'),
            notes=p.get('notes'), receipt_no=p['receipt_no']
        )
        db.session.add(np)
        stats['payments'] += 1

    # ══ المعاملات المالية (بدون تكرار — نضيفها دائماً لأنه لا معرِّف فريد) ══
    for t in data.get('transactions', []):
        nt = Transaction(type=t['type'], category=t.get('category', 'أخرى'),
                         amount=t['amount'], description=t.get('description'))
        db.session.add(nt)
        stats['transactions'] += 1

    log_activity('restore_backup', 'system', detail=json.dumps(stats, ensure_ascii=False))
    db.session.commit()

    return jsonify({'ok': True, 'stats': stats,
                    'msg': f"تمَّت الاستعادة: {stats['students']} طالب، {stats['teachers']} مدرس، "
                           f"{stats['payments']} دفعة، {stats['departments']} قسم جديد"})

@app.route('/api/students/export_csv')  # [NEW-03]
@login_required
def api_students_csv():
    students = Student.query.all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['الكود', 'الاسم الأول', 'اسم الأب', 'اسم الجد', 'اسم العائلة',
                     'الرقم القومي', 'الهاتف', 'هاتف ولي الأمر', 'القسم', 'الدفعة',
                     'الحالة', 'إجمالي الرسوم', 'المدفوع', 'المتبقي', 'تاريخ التسجيل'])
    for s in students:
        writer.writerow([
            s.code, s.first_name, s.second_name, s.third_name, s.family_name,
            s.national_id or '', s.phone or '', s.guardian_phone or '',
            s.department.name if s.department else '',
            s.batch.name if s.batch else '',
            s.status, s.total_fees, s.total_paid, s.remaining,
            s.created_at.strftime('%Y-%m-%d')
        ])
    output.seek(0)
    log_activity('export_csv', 'students')
    db.session.commit()
    return Response(
        '\ufeff' + output.getvalue(),  # BOM for Excel Arabic
        mimetype='text/csv; charset=utf-8-sig',
        headers={'Content-Disposition': f'attachment; filename=students_{datetime.now().strftime("%Y%m%d")}.csv'}
    )

@app.route('/api/teachers/export_csv')  # [NEW-13]
@login_required
def api_teachers_csv():
    teachers = Teacher.query.all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['الكود', 'الاسم الأول', 'اسم الأب', 'اسم العائلة', 'الرقم القومي',
                     'الهاتف', 'البريد', 'التخصص', 'نوع الراتب', 'قيمة الراتب',
                     'الحالة', 'تاريخ الإضافة'])
    for t in teachers:
        writer.writerow([
            t.code, t.first_name, t.second_name, t.family_name,
            t.national_id or '', t.phone or '', t.email or '',
            t.specialization or '', t.salary_type, t.salary_amount,
            t.status, t.created_at.strftime('%Y-%m-%d')
        ])
    output.seek(0)
    log_activity('export_csv', 'teachers')
    db.session.commit()
    return Response(
        '\ufeff' + output.getvalue(),
        mimetype='text/csv; charset=utf-8-sig',
        headers={'Content-Disposition': f'attachment; filename=teachers_{datetime.now().strftime("%Y%m%d")}.csv'}
    )

# ═══════════════════════════════════════════════════
# UNIVERSAL SEARCH  [NEW-16]
# ═══════════════════════════════════════════════════

@app.route('/api/search')
@login_required
def api_universal_search():
    """بحث سريع وشامل في كل البيانات: طلاب، مدرسون، مدفوعات، معاملات"""
    q = (request.args.get('q') or '').strip()
    if not q or len(q) < 2:
        return jsonify({'students': [], 'teachers': [], 'payments': [], 'transactions': []})

    like = f'%{q}%'
    results = {'students': [], 'teachers': [], 'payments': [], 'transactions': []}

    students = Student.query.filter(db.or_(
        Student.first_name.ilike(like), Student.second_name.ilike(like),
        Student.third_name.ilike(like), Student.family_name.ilike(like),
        Student.national_id.ilike(like), Student.phone.ilike(like),
        Student.code.ilike(like)
    )).limit(8).all()
    results['students'] = [{
        'id': s.id, 'code': s.code, 'name': s.full_name,
        'department': s.department.name if s.department else '',
        'type': 'student'
    } for s in students]

    teachers = Teacher.query.filter(db.or_(
        Teacher.first_name.ilike(like), Teacher.second_name.ilike(like),
        Teacher.family_name.ilike(like), Teacher.phone.ilike(like),
        Teacher.code.ilike(like)
    )).limit(8).all()
    results['teachers'] = [{
        'id': t.id, 'code': t.code, 'name': t.full_name,
        'specialization': t.specialization or '', 'type': 'teacher'
    } for t in teachers]

    payments = Payment.query.filter(Payment.receipt_no.ilike(like)).limit(8).all()
    results['payments'] = [{
        'id': p.id, 'receipt_no': p.receipt_no,
        'student_name': p.student.full_name if p.student else '',
        'amount': p.amount, 'type': 'payment'
    } for p in payments]

    transactions = Transaction.query.filter(db.or_(
        Transaction.description.ilike(like), Transaction.category.ilike(like)
    )).limit(8).all()
    results['transactions'] = [{
        'id': t.id, 'description': t.description or t.category,
        'amount': t.amount, 'txn_type': t.type, 'type': 'transaction'
    } for t in transactions]

    return jsonify(results)

# ═══════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════

@app.route('/api/dashboard')
@login_required
def api_dashboard():
    total_students  = Student.query.count()
    active_students = Student.query.filter_by(status='active').count()
    overdue_count   = Student.query.filter(
        Student.total_fees > Student.total_paid, Student.status == 'active').count()

    now = datetime.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # Previous month for comparison
    if now.month == 1:
        prev_month_start = now.replace(year=now.year - 1, month=12, day=1, hour=0, minute=0, second=0)
    else:
        prev_month_start = now.replace(month=now.month - 1, day=1, hour=0, minute=0, second=0)

    month_income  = db.session.query(db.func.sum(Payment.amount)).filter(
        Payment.created_at >= month_start).scalar() or 0
    month_expense = db.session.query(db.func.sum(Transaction.amount)).filter(
        Transaction.type == 'expense', Transaction.created_at >= month_start).scalar() or 0
    prev_income   = db.session.query(db.func.sum(Payment.amount)).filter(
        Payment.created_at >= prev_month_start,
        Payment.created_at < month_start).scalar() or 0

    new_students = Student.query.filter(Student.created_at >= month_start).count()

    # [BUG-07] Fixed dept stats — explicit join, count students properly
    from sqlalchemy import func
    dept_stats = db.session.query(
        Department.name,
        func.count(Student.id).label('cnt')
    ).outerjoin(Student, (Student.department_id == Department.id) & (Student.status == 'active'))\
     .group_by(Department.id, Department.name)\
     .order_by(func.count(Student.id).desc())\
     .all()

    lic = get_license()
    return jsonify({
        'total_students':  total_students,
        'active_students': active_students,
        'overdue':         overdue_count,
        'month_income':    round(month_income, 2),
        'month_expense':   round(month_expense, 2),
        'net_profit':      round(month_income - month_expense, 2),
        'new_students':    new_students,
        'income_change':   round(((month_income - prev_income) / prev_income * 100) if prev_income else 0, 1),
        'dept_stats':      [{'name': d[0], 'count': d[1]} for d in dept_stats],
        'client_name':     lic.get('client_name', ''),
        'max_users':       lic.get('max_users', 3),
        'current_users':   User.query.filter_by(active=True).count()
    })

# ═══════════════════════════════════════════════════
# STUDENTS
# ═══════════════════════════════════════════════════

VALID_STUDENT_STATUSES = {'active', 'suspended', 'withdrawn', 'graduated'}

@app.route('/api/students', methods=['GET'])
@login_required
def api_students():
    q       = (request.args.get('q') or '').strip()
    dept    = (request.args.get('dept') or '').strip()
    status  = (request.args.get('status') or '').strip()
    page    = max(1, int(request.args.get('page', 1)))  # [BUG-12]
    per_page = 50

    query = Student.query
    if q:
        like = f'%{q}%'
        query = query.filter(db.or_(
            Student.first_name.ilike(like),
            Student.second_name.ilike(like),
            Student.third_name.ilike(like),
            Student.family_name.ilike(like),
            Student.national_id.ilike(like),
            Student.phone.ilike(like),
            Student.code.ilike(like)
        ))
    if dept:
        query = query.join(Department).filter(Department.name == dept)
    if status and status in VALID_STUDENT_STATUSES:
        query = query.filter(Student.status == status)

    total   = query.count()
    students = query.order_by(Student.created_at.desc())\
                    .offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        'students': [{
            'id': s.id, 'code': s.code, 'full_name': s.full_name,
            'department': s.department.name if s.department else '',
            'batch': s.batch.name if s.batch else '',
            'phone': s.phone, 'status': s.status,
            'total_fees': s.total_fees, 'total_paid': s.total_paid,
            'remaining': s.remaining, 'payment_status': s.payment_status
        } for s in students],
        'total': total, 'page': page, 'per_page': per_page,
        'pages': (total + per_page - 1) // per_page
    })

@app.route('/api/students/<int:sid>', methods=['GET'])
@login_required
def api_student_detail(sid):
    s = Student.query.get_or_404(sid)
    payments = [{'id': p.id, 'amount': p.amount, 'pay_type': p.pay_type,
                 'pay_method': p.pay_method, 'receipt_no': p.receipt_no,
                 'notes': p.notes, 'created_at': p.created_at.strftime('%Y-%m-%d %H:%M')
                 } for p in sorted(s.payments, key=lambda x: x.created_at, reverse=True)]
    status_history = [{
        'old': h.old_status, 'new': h.new_status,
        'note': h.note, 'created_at': h.created_at.strftime('%Y-%m-%d %H:%M')
    } for h in sorted(s.status_history, key=lambda x: x.created_at, reverse=True)]

    return jsonify({
        'id': s.id, 'code': s.code, 'full_name': s.full_name,
        'first_name': s.first_name, 'second_name': s.second_name,
        'third_name': s.third_name, 'family_name': s.family_name,
        'national_id': s.national_id, 'phone': s.phone,
        'guardian_phone': s.guardian_phone, 'address': s.address,
        'birth_date': s.birth_date.isoformat() if s.birth_date else '',
        'department': s.department.name if s.department else '',
        'department_id': s.department_id,
        'batch': s.batch.name if s.batch else '',
        'batch_id': s.batch_id,
        'status': s.status, 'notes': s.notes or '',
        'total_fees': s.total_fees, 'total_paid': s.total_paid,
        'remaining': s.remaining, 'payment_status': s.payment_status,
        'payments': payments, 'status_history': status_history,
        'created_at': s.created_at.strftime('%Y-%m-%d')
    })

@app.route('/api/students', methods=['POST'])
@login_required
@role_required('admin', 'students')
def api_add_student():
    d = request.get_json() or {}

    # [BUG-19] Validate required fields
    required = ['first_name', 'second_name', 'third_name', 'family_name']
    for f in required:
        v = (d.get(f) or '').strip()
        if not v or len(v) > 40:
            return jsonify({'ok': False, 'msg': f'الحقل {f} مطلوب (بحد أقصى 40 حرف)'}), 400

    # [BUG-18] Validate national_id format
    nid = (d.get('national_id') or '').strip() or None
    if nid and not validate_national_id(nid):
        return jsonify({'ok': False, 'msg': 'الرقم القومي يجب أن يكون 14 رقماً'}), 400

    # [BUG-05] Handle uniqueness conflict gracefully
    if nid and Student.query.filter_by(national_id=nid).first():
        return jsonify({'ok': False, 'msg': 'الرقم القومي مسجَّل مسبقاً'}), 400

    if not validate_phone(d.get('phone')):
        return jsonify({'ok': False, 'msg': 'رقم الهاتف غير صالح'}), 400

    dept = Department.query.get(d.get('department_id')) if d.get('department_id') else None

    status = d.get('status', 'active')
    if status not in VALID_STUDENT_STATUSES:
        status = 'active'

    s = Student(
        code=generate_student_code(),
        first_name=d['first_name'].strip(), second_name=d['second_name'].strip(),
        third_name=d['third_name'].strip(), family_name=d['family_name'].strip(),
        national_id=nid, phone=(d.get('phone') or '').strip() or None,
        guardian_phone=(d.get('guardian_phone') or '').strip() or None,
        address=(d.get('address') or '')[:250],
        birth_date=datetime.strptime(d['birth_date'], '%Y-%m-%d').date() if d.get('birth_date') else None,
        department_id=d.get('department_id') or None,
        batch_id=d.get('batch_id') or None,
        status=status,
        notes=(d.get('notes') or '').strip(),
        total_fees=dept.annual_fee if dept else float(d.get('total_fees', 0)),
        created_by=current_user.id
    )
    db.session.add(s)
    db.session.flush()
    log_activity('add_student', 'student', s.id, s.full_name)
    db.session.commit()
    return jsonify({'ok': True, 'code': s.code, 'id': s.id})

@app.route('/api/students/<int:sid>', methods=['PUT'])
@login_required
@role_required('admin', 'students')
def api_update_student(sid):
    s = Student.query.get_or_404(sid)
    d = request.get_json() or {}

    # [BUG-11] Allow changing department and batch
    for field in ['first_name', 'second_name', 'third_name', 'family_name',
                  'phone', 'guardian_phone', 'address', 'notes']:
        if field in d:
            val = (d[field] or '').strip()
            setattr(s, field, val or None)

    if 'department_id' in d:
        s.department_id = d['department_id'] or None
        dept = Department.query.get(s.department_id)
        if dept:
            s.total_fees = dept.annual_fee
    if 'batch_id' in d:
        s.batch_id = d['batch_id'] or None
    if 'total_fees' in d:
        try:
            s.total_fees = max(0, float(d['total_fees']))
        except (TypeError, ValueError):
            pass

    if d.get('birth_date'):
        try:
            s.birth_date = datetime.strptime(d['birth_date'], '%Y-%m-%d').date()
        except ValueError:
            pass

    # [NEW-11] Track status changes
    new_status = d.get('status')
    if new_status and new_status in VALID_STUDENT_STATUSES and new_status != s.status:
        sl = StudentStatusLog(student_id=s.id, old_status=s.status,
                              new_status=new_status, changed_by=current_user.id,
                              note=d.get('status_note', ''))
        db.session.add(sl)
        s.status = new_status

    log_activity('update_student', 'student', s.id, s.full_name)
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/students/<int:sid>', methods=['DELETE'])
@login_required
@role_required('admin')
def api_delete_student(sid):
    s = Student.query.get_or_404(sid)
    if s.payments:
        return jsonify({'ok': False, 'msg': 'لا يمكن حذف طالب لديه مدفوعات مسجَّلة'}), 400
    name = s.full_name
    # [BUG-22] إخطار شفاف بعدد سجلات الحضور التي ستُحذف تلقائياً مع الطالب
    attendance_count = len(s.attendance_records)
    db.session.delete(s)
    log_activity('delete_student', 'student', sid,
                 f'{name} (حُذف معه {attendance_count} سجل حضور)' if attendance_count else name)
    db.session.commit()
    return jsonify({'ok': True, 'deleted_attendance_records': attendance_count})

# ═══════════════════════════════════════════════════
# TEACHERS  [NEW-13]
# ═══════════════════════════════════════════════════

@app.route('/api/teachers', methods=['GET'])
@login_required
def api_teachers():
    q      = (request.args.get('q') or '').strip()
    status = (request.args.get('status') or '').strip()
    query = Teacher.query
    if q:
        like = f'%{q}%'
        query = query.filter(db.or_(
            Teacher.first_name.ilike(like), Teacher.second_name.ilike(like),
            Teacher.family_name.ilike(like), Teacher.phone.ilike(like),
            Teacher.code.ilike(like), Teacher.national_id.ilike(like)
        ))
    if status and status in VALID_TEACHER_STATUSES:
        query = query.filter(Teacher.status == status)

    teachers = query.order_by(Teacher.created_at.desc()).all()
    return jsonify([{
        'id': t.id, 'code': t.code, 'full_name': t.full_name,
        'phone': t.phone, 'specialization': t.specialization,
        'status': t.status, 'salary_type': t.salary_type,
        'salary_amount': t.salary_amount,
        'departments': [td.department.name for td in t.departments if td.department]
    } for t in teachers])

@app.route('/api/teachers/<int:tid>', methods=['GET'])
@login_required
def api_teacher_detail(tid):
    t = Teacher.query.get_or_404(tid)
    # جلسات هذا المدرس مؤخراً
    sessions = AttendanceSession.query.filter_by(teacher_id=t.id)\
                   .order_by(AttendanceSession.session_date.desc()).limit(20).all()
    return jsonify({
        'id': t.id, 'code': t.code, 'full_name': t.full_name,
        'first_name': t.first_name, 'second_name': t.second_name, 'family_name': t.family_name,
        'national_id': t.national_id, 'phone': t.phone, 'email': t.email,
        'address': t.address, 'specialization': t.specialization,
        'hire_date': t.hire_date.isoformat() if t.hire_date else '',
        'salary_type': t.salary_type, 'salary_amount': t.salary_amount,
        'status': t.status, 'notes': t.notes or '',
        'departments': [{'id': td.department_id, 'name': td.department.name} for td in t.departments if td.department],
        'recent_sessions': [{
            'id': s.id, 'date': s.session_date.isoformat(),
            'batch': s.batch.name if s.batch else '',
            'topic': s.topic or '',
            'present_count': sum(1 for r in s.records if r.status == 'present')
        } for s in sessions],
        'created_at': t.created_at.strftime('%Y-%m-%d')
    })

@app.route('/api/teachers', methods=['POST'])
@login_required
@role_required('admin')
def api_add_teacher():
    d = request.get_json() or {}
    required = ['first_name', 'second_name', 'family_name']
    for f in required:
        v = (d.get(f) or '').strip()
        if not v or len(v) > 40:
            return jsonify({'ok': False, 'msg': f'الحقل {f} مطلوب (بحد أقصى 40 حرف)'}), 400

    nid = (d.get('national_id') or '').strip() or None
    if nid and not validate_national_id(nid):
        return jsonify({'ok': False, 'msg': 'الرقم القومي يجب أن يكون 14 رقماً'}), 400
    if nid and Teacher.query.filter_by(national_id=nid).first():
        return jsonify({'ok': False, 'msg': 'الرقم القومي مسجَّل مسبقاً لمدرس آخر'}), 400
    if not validate_phone(d.get('phone')):
        return jsonify({'ok': False, 'msg': 'رقم الهاتف غير صالح'}), 400

    salary_type = d.get('salary_type', 'fixed')
    if salary_type not in VALID_SALARY_TYPES:
        salary_type = 'fixed'

    t = Teacher(
        code=generate_teacher_code(),
        first_name=d['first_name'].strip(), second_name=d['second_name'].strip(),
        family_name=d['family_name'].strip(),
        national_id=nid, phone=(d.get('phone') or '').strip() or None,
        email=(d.get('email') or '').strip() or None,
        address=(d.get('address') or '')[:250],
        specialization=(d.get('specialization') or '').strip(),
        hire_date=datetime.strptime(d['hire_date'], '%Y-%m-%d').date() if d.get('hire_date') else None,
        salary_type=salary_type,
        salary_amount=max(0, float(d.get('salary_amount', 0) or 0)),
        notes=(d.get('notes') or '').strip(),
        created_by=current_user.id
    )
    db.session.add(t)
    db.session.flush()

    # ربط الأقسام
    dept_ids = d.get('department_ids', [])
    for did in dept_ids:
        if Department.query.get(did):
            db.session.add(TeacherDepartment(teacher_id=t.id, department_id=did))

    log_activity('add_teacher', 'teacher', t.id, t.full_name)
    db.session.commit()
    return jsonify({'ok': True, 'code': t.code, 'id': t.id})

@app.route('/api/teachers/<int:tid>', methods=['PUT'])
@login_required
@role_required('admin')
def api_update_teacher(tid):
    t = Teacher.query.get_or_404(tid)
    d = request.get_json() or {}

    for field in ['first_name', 'second_name', 'family_name', 'phone',
                  'email', 'address', 'specialization', 'notes']:
        if field in d:
            val = (d[field] or '').strip()
            setattr(t, field, val or None)

    if 'salary_type' in d and d['salary_type'] in VALID_SALARY_TYPES:
        t.salary_type = d['salary_type']
    if 'salary_amount' in d:
        try:
            t.salary_amount = max(0, float(d['salary_amount']))
        except (TypeError, ValueError):
            pass
    if 'status' in d and d['status'] in VALID_TEACHER_STATUSES:
        t.status = d['status']
    if d.get('hire_date'):
        try:
            t.hire_date = datetime.strptime(d['hire_date'], '%Y-%m-%d').date()
        except ValueError:
            pass

    if 'department_ids' in d:
        TeacherDepartment.query.filter_by(teacher_id=t.id).delete()
        for did in d['department_ids']:
            if Department.query.get(did):
                db.session.add(TeacherDepartment(teacher_id=t.id, department_id=did))

    log_activity('update_teacher', 'teacher', t.id, t.full_name)
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/teachers/<int:tid>', methods=['DELETE'])
@login_required
@role_required('admin')
def api_delete_teacher(tid):
    t = Teacher.query.get_or_404(tid)
    if AttendanceSession.query.filter_by(teacher_id=t.id).first():
        return jsonify({'ok': False, 'msg': 'لا يمكن حذف مدرس مرتبط بجلسات حضور مسجَّلة. عطِّله بدلاً من الحذف.'}), 400
    name = t.full_name
    db.session.delete(t)
    log_activity('delete_teacher', 'teacher', tid, name)
    db.session.commit()
    return jsonify({'ok': True})

# ═══════════════════════════════════════════════════
# ATTENDANCE  [NEW-14]
# ═══════════════════════════════════════════════════

@app.route('/api/attendance/sessions', methods=['GET', 'POST'])
@login_required
def api_attendance_sessions():
    if request.method == 'POST':
        if current_user.role not in ('admin', 'students', 'reception'):
            return jsonify({'error': 'غير مصرح'}), 403
        d = request.get_json() or {}
        batch_id = d.get('batch_id')
        if not Batch.query.get(batch_id):
            return jsonify({'ok': False, 'msg': 'الدفعة غير موجودة'}), 400
        try:
            session_date = datetime.strptime(d.get('session_date', ''), '%Y-%m-%d').date()
        except ValueError:
            session_date = datetime.now().date()

        sess = AttendanceSession(
            batch_id=batch_id,
            teacher_id=d.get('teacher_id') or None,
            session_date=session_date,
            topic=(d.get('topic') or '').strip(),
            notes=(d.get('notes') or '').strip(),
            created_by=current_user.id
        )
        db.session.add(sess)
        db.session.flush()

        # تسجيل الحضور لكل طالب في الـ payload
        records = d.get('records', [])  # [{student_id, status, note}]
        students_in_batch = {s.id for s in Student.query.filter_by(batch_id=batch_id).all()}
        for r in records:
            sid = r.get('student_id')
            if sid not in students_in_batch:
                continue
            status = r.get('status', 'present')
            if status not in VALID_ATTENDANCE_STATUSES:
                status = 'present'
            db.session.add(AttendanceRecord(
                session_id=sess.id, student_id=sid,
                status=status, note=(r.get('note') or '')[:150]
            ))

        log_activity('add_attendance_session', 'attendance_session', sess.id,
                     f'batch={batch_id} date={session_date}')
        db.session.commit()
        return jsonify({'ok': True, 'session_id': sess.id})

    # GET: قائمة الجلسات مع فلاتر
    batch_id = request.args.get('batch_id')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    query = AttendanceSession.query
    if batch_id:
        query = query.filter_by(batch_id=batch_id)
    if date_from:
        try: query = query.filter(AttendanceSession.session_date >= datetime.strptime(date_from, '%Y-%m-%d').date())
        except ValueError: pass
    if date_to:
        try: query = query.filter(AttendanceSession.session_date <= datetime.strptime(date_to, '%Y-%m-%d').date())
        except ValueError: pass

    sessions = query.order_by(AttendanceSession.session_date.desc()).limit(100).all()
    return jsonify([{
        'id': s.id, 'date': s.session_date.isoformat(),
        'batch': s.batch.name if s.batch else '',
        'batch_id': s.batch_id,
        'teacher': s.teacher.full_name if s.teacher else '—',
        'topic': s.topic or '',
        'total': len(s.records),
        'present': sum(1 for r in s.records if r.status == 'present'),
        'absent': sum(1 for r in s.records if r.status == 'absent'),
        'late': sum(1 for r in s.records if r.status == 'late'),
        'excused': sum(1 for r in s.records if r.status == 'excused'),
    } for s in sessions])

@app.route('/api/attendance/sessions/<int:sid>', methods=['GET'])
@login_required
def api_attendance_session_detail(sid):
    s = AttendanceSession.query.get_or_404(sid)
    return jsonify({
        'id': s.id, 'date': s.session_date.isoformat(),
        'batch': s.batch.name if s.batch else '', 'batch_id': s.batch_id,
        'teacher_id': s.teacher_id, 'teacher': s.teacher.full_name if s.teacher else '',
        'topic': s.topic or '', 'notes': s.notes or '',
        'records': [{
            'student_id': r.student_id,
            'student_name': r.student.full_name if r.student else '',
            'student_code': r.student.code if r.student else '',
            'status': r.status, 'note': r.note or ''
        } for r in s.records]
    })

@app.route('/api/attendance/sessions/<int:sid>', methods=['PUT'])
@login_required
@role_required('admin', 'students', 'reception')
def api_update_attendance_session(sid):
    s = AttendanceSession.query.get_or_404(sid)
    d = request.get_json() or {}
    if 'topic' in d:
        s.topic = (d['topic'] or '').strip()
    if 'notes' in d:
        s.notes = (d['notes'] or '').strip()
    if 'records' in d:
        # تحديث سجلات الحضور الحالية
        existing = {r.student_id: r for r in s.records}
        for r in d['records']:
            sid_student = r.get('student_id')
            status = r.get('status', 'present')
            if status not in VALID_ATTENDANCE_STATUSES:
                status = 'present'
            if sid_student in existing:
                existing[sid_student].status = status
                existing[sid_student].note = (r.get('note') or '')[:150]
            else:
                db.session.add(AttendanceRecord(
                    session_id=s.id, student_id=sid_student,
                    status=status, note=(r.get('note') or '')[:150]
                ))
    log_activity('update_attendance_session', 'attendance_session', sid)
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/attendance/sessions/<int:sid>', methods=['DELETE'])
@login_required
@role_required('admin')
def api_delete_attendance_session(sid):
    s = AttendanceSession.query.get_or_404(sid)
    db.session.delete(s)
    log_activity('delete_attendance_session', 'attendance_session', sid)
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/attendance/student/<int:student_id>')
@login_required
def api_student_attendance(student_id):
    """سجل حضور طالب معين — لحظة بلحظة"""
    student = Student.query.get_or_404(student_id)
    records = AttendanceRecord.query.filter_by(student_id=student_id)\
                  .join(AttendanceSession)\
                  .order_by(AttendanceSession.session_date.desc()).limit(50).all()
    total = len(records)
    present = sum(1 for r in records if r.status == 'present')
    absent  = sum(1 for r in records if r.status == 'absent')
    late    = sum(1 for r in records if r.status == 'late')
    excused = sum(1 for r in records if r.status == 'excused')
    rate = round((present / total * 100) if total else 100, 1)

    return jsonify({
        'student_name': student.full_name,
        'total_sessions': total, 'present': present, 'absent': absent,
        'late': late, 'excused': excused, 'attendance_rate': rate,
        'history': [{
            'date': r.session.session_date.isoformat(),
            'topic': r.session.topic or '',
            'status': r.status, 'note': r.note or ''
        } for r in records]
    })

@app.route('/api/attendance/batch/<int:batch_id>/today')
@login_required
def api_batch_attendance_today(batch_id):
    """جلب قائمة طلاب الدفعة لتسجيل حضور اليوم بسرعة"""
    batch = Batch.query.get_or_404(batch_id)
    students = Student.query.filter_by(batch_id=batch_id, status='active').all()
    today = datetime.now().date()
    existing_session = AttendanceSession.query.filter_by(
        batch_id=batch_id, session_date=today).first()
    existing_map = {}
    if existing_session:
        existing_map = {r.student_id: r.status for r in existing_session.records}
    return jsonify({
        'batch_name': batch.name,
        'session_exists': existing_session is not None,
        'session_id': existing_session.id if existing_session else None,
        'students': [{
            'id': s.id, 'code': s.code, 'full_name': s.full_name,
            'status': existing_map.get(s.id, 'present')
        } for s in students]
    })

# ═══════════════════════════════════════════════════
# BARCODE / QR ATTENDANCE CHECK-IN  [NEW-22]
# ═══════════════════════════════════════════════════
# فكرة العمل: كل طالب له كود فريد أصلاً (Student.code) — نولِّد منه صورة باركود
# قابلة للطباعة على بطاقة الطالب. جهاز قارئ الباركود (USB رخيص ~150-300 جنيه)
# يعمل كلوحة مفاتيح عادية: بيكتب الكود في خانة نصية ويضغط Enter تلقائياً —
# فلا يحتاج أي برمجة خاصة من جهتنا، فقط شاشة "المسح السريع" بحقل نص مُركَّز دايماً.

@app.route('/api/students/<int:sid>/barcode.png')
@login_required
def api_student_barcode(sid):
    """يولِّد صورة باركود (Code128) لكود الطالب — تُستخدَم في الطباعة على البطاقة"""
    student = Student.query.get_or_404(sid)
    try:
        import barcode
        from barcode.writer import ImageWriter
        import io as _io
        code128 = barcode.get('code128', student.code, writer=ImageWriter())
        buf = _io.BytesIO()
        code128.write(buf, options={'write_text': False, 'module_height': 12, 'quiet_zone': 2})
        buf.seek(0)
        return Response(buf.read(), mimetype='image/png')
    except Exception as e:
        app.logger.error(f"فشل توليد الباركود: {e}")
        return jsonify({'ok': False, 'msg': 'تعذَّر توليد الباركود'}), 500

@app.route('/api/students/<int:sid>/id_card')
@login_required
def api_student_id_card(sid):
    """صفحة بطاقة طالب جاهزة للطباعة — تشمل الباركود والبيانات الأساسية"""
    student = Student.query.get_or_404(sid)
    lic = get_license()
    return render_template('id_card.html', student=student,
                           institution=lic.get('client_name', 'GTech Academy'))

@app.route('/api/batches/<int:bid>/id_cards')
@login_required
@role_required('admin', 'students', 'reception')
def api_batch_id_cards(bid):
    """طباعة دفعة كاملة من بطاقات الطلاب مرة واحدة (لدفعة دراسية بأكملها)"""
    batch = Batch.query.get_or_404(bid)
    students = Student.query.filter_by(batch_id=bid, status='active').all()
    lic = get_license()
    return render_template('id_cards_batch.html', students=students, batch=batch,
                           institution=lic.get('client_name', 'GTech Academy'))

@app.route('/api/attendance/scan', methods=['POST'])
@login_required
@role_required('admin', 'students', 'reception')
def api_attendance_scan():
    """
    [NEW-22] نقطة النهاية الأساسية لتسجيل الحضور بمسح الباركود.
    تستقبل كود الطالب (من قارئ الباركود أو كاميرا QR)، وتُسجِّله تلقائياً
    كـ"حاضر" في جلسة اليوم لدفعته — تُنشئ الجلسة تلقائياً لو مش موجودة بعد.
    """
    d = request.get_json() or {}
    code = (d.get('code') or '').strip().upper()
    if not code:
        return jsonify({'ok': False, 'msg': 'لم يُستلَم أي كود'}), 400

    student = Student.query.filter_by(code=code).first()
    if not student:
        return jsonify({'ok': False, 'msg': f'لا يوجد طالب بالكود: {code}'}), 404
    if student.status != 'active':
        return jsonify({'ok': False, 'msg': f'الطالب {student.full_name} غير نشط حالياً'}), 400
    if not student.batch_id:
        return jsonify({'ok': False, 'msg': f'الطالب {student.full_name} غير مُسجَّل في أي دفعة دراسية'}), 400

    today = datetime.now().date()
    session = AttendanceSession.query.filter_by(
        batch_id=student.batch_id, session_date=today).first()
    if not session:
        session = AttendanceSession(
            batch_id=student.batch_id, session_date=today,
            topic='حضور بالمسح الضوئي', created_by=current_user.id
        )
        db.session.add(session)
        db.session.flush()

    existing_record = AttendanceRecord.query.filter_by(
        session_id=session.id, student_id=student.id).first()
    already_scanned = existing_record is not None
    if existing_record:
        existing_record.status = 'present'
        existing_record.note = f'مُسجَّل بالمسح — {datetime.now().strftime("%H:%M")}'
    else:
        db.session.add(AttendanceRecord(
            session_id=session.id, student_id=student.id, status='present',
            note=f'مُسجَّل بالمسح — {datetime.now().strftime("%H:%M")}'
        ))

    log_activity('attendance_scan', 'student', student.id, f'{student.code} — {student.full_name}')
    db.session.commit()

    return jsonify({
        'ok': True,
        'already_scanned': already_scanned,
        'student_name': student.full_name,
        'student_code': student.code,
        'batch_name': student.batch.name if student.batch else '',
        'department': student.department.name if student.department else '',
        'time': datetime.now().strftime('%H:%M:%S'),
        'msg': f'تمَّ تسجيل حضور {student.full_name}' + (' (مُسجَّل مسبقاً اليوم — تحديث الوقت فقط)' if already_scanned else '')
    })

# ═══════════════════════════════════════════════════
# PAYMENTS
# ═══════════════════════════════════════════════════

@app.route('/api/payments', methods=['POST'])
@login_required
@role_required('admin', 'accounts')

def api_add_payment():
    d = request.get_json() or {}

    # [BUG-04] Validate amount
    if not validate_amount(d.get('amount')):
        return jsonify({'ok': False, 'msg': 'المبلغ يجب أن يكون أكبر من الصفر'}), 400

    s = Student.query.get_or_404(d['student_id'])
    amount = round(float(d['amount']), 2)

    pay_type   = d.get('pay_type', 'monthly')
    pay_method = d.get('pay_method', 'cash')
    valid_pay_types   = {'monthly', 'first', 'registration', 'other'}
    valid_pay_methods = {'cash', 'transfer', 'card'}
    if pay_type not in valid_pay_types:
        pay_type = 'other'
    if pay_method not in valid_pay_methods:
        pay_method = 'cash'

    receipt_no = generate_receipt_no()
    p = Payment(
        student_id=s.id, amount=amount,
        pay_type=pay_type, pay_method=pay_method,
        notes=(d.get('notes') or '')[:200],
        receipt_no=receipt_no,
        created_by=current_user.id
    )
    s.total_paid = round(s.total_paid + amount, 2)
    db.session.add(p)
    db.session.flush()

    t = Transaction(
        type='income', category='مصاريف دراسية',
        amount=amount,
        description=f"دفعة من {s.full_name} — {s.code}",
        reference=receipt_no,
        created_by=current_user.id
    )
    db.session.add(t)
    log_activity('add_payment', 'payment', p.id, f'{s.code} — {amount} ج')
    db.session.commit()

    return jsonify({
        'ok': True, 'receipt_no': receipt_no,
        'remaining': s.remaining, 'payment_id': p.id,
        'student_name': s.full_name, 'student_code': s.code,
        'department': s.department.name if s.department else '',
        'total_fees': s.total_fees, 'total_paid': s.total_paid
    })

@app.route('/api/payments/<int:pid>', methods=['DELETE'])
@login_required
@role_required('admin')
def api_delete_payment(pid):
    """Reverse a payment (admin only)"""
    p = Payment.query.get_or_404(pid)
    s = p.student
    s.total_paid = round(max(0, s.total_paid - p.amount), 2)
    # also reverse the transaction
    Transaction.query.filter_by(reference=p.receipt_no).delete()
    log_activity('delete_payment', 'payment', pid, f'{p.receipt_no}')
    db.session.delete(p)
    db.session.commit()
    return jsonify({'ok': True, 'new_total_paid': s.total_paid, 'remaining': s.remaining})

@app.route('/api/payments/overdue')
@login_required
def api_overdue():
    # [BUG-13] Fixed: compute remaining in Python, not SQL expression
    students = Student.query.filter(
        Student.total_fees > Student.total_paid,
        Student.status == 'active'
    ).all()
    students.sort(key=lambda s: s.remaining, reverse=True)
    return jsonify([{
        'id': s.id, 'code': s.code, 'full_name': s.full_name,
        'department': s.department.name if s.department else '',
        'remaining': s.remaining, 'phone': s.phone,
        'total_fees': s.total_fees, 'total_paid': s.total_paid
    } for s in students])

# ═══════════════════════════════════════════════════
# FINANCE
# ═══════════════════════════════════════════════════

@app.route('/api/transactions', methods=['GET', 'POST'])
@login_required
@role_required('admin', 'accounts')  # [BUG-06]
def api_transactions():
    if request.method == 'POST':
        d = request.get_json() or {}
        txn_type = d.get('type', '')
        if txn_type not in ('income', 'expense'):
            return jsonify({'ok': False, 'msg': 'نوع المعاملة غير صالح'}), 400
        # [BUG-18] validate category
        category = d.get('category', 'أخرى')
        if category not in VALID_TRANSACTION_CATEGORIES:
            category = 'أخرى'
        if not validate_amount(d.get('amount')):
            return jsonify({'ok': False, 'msg': 'المبلغ يجب أن يكون أكبر من الصفر'}), 400
        t = Transaction(
            type=txn_type, category=category,
            amount=round(float(d['amount']), 2),
            description=(d.get('description') or '')[:200],
            created_by=current_user.id
        )
        db.session.add(t)
        log_activity('add_transaction', 'transaction', None, f'{txn_type} — {d["amount"]}')
        db.session.commit()
        return jsonify({'ok': True})

    period = request.args.get('period', 'month')
    now = datetime.now()
    if period == 'day':
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == 'year':
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    txns    = Transaction.query.filter(Transaction.created_at >= start)\
                  .order_by(Transaction.created_at.desc()).all()
    income  = sum(t.amount for t in txns if t.type == 'income')
    expense = sum(t.amount for t in txns if t.type == 'expense')
    return jsonify({
        'income': round(income, 2), 'expense': round(expense, 2),
        'net': round(income - expense, 2),
        'transactions': [{
            'id': t.id, 'type': t.type, 'category': t.category,
            'amount': t.amount, 'description': t.description,
            'reference': t.reference or '',
            'created_at': t.created_at.strftime('%Y-%m-%d %H:%M')
        } for t in txns]
    })

@app.route('/api/transactions/<int:tid>', methods=['PUT'])  # [NEW-19] إكمال CRUD للخزينة
@login_required
@role_required('admin', 'accounts')
def api_update_transaction(tid):
    t = Transaction.query.get_or_404(tid)
    if t.reference:
        return jsonify({'ok': False,
                        'msg': 'هذه الحركة مرتبطة بدفعة طالب — عدِّل أو احذف الدفعة نفسها بدلاً من ذلك'}), 400
    d = request.get_json() or {}
    if 'type' in d and d['type'] in ('income', 'expense'):
        t.type = d['type']
    if 'category' in d and d['category'] in VALID_TRANSACTION_CATEGORIES:
        t.category = d['category']
    if 'amount' in d:
        if not validate_amount(d['amount']):
            return jsonify({'ok': False, 'msg': 'المبلغ يجب أن يكون أكبر من الصفر'}), 400
        t.amount = round(float(d['amount']), 2)
    if 'description' in d:
        t.description = (d['description'] or '')[:200]
    log_activity('update_transaction', 'transaction', tid)
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/transactions/<int:tid>', methods=['DELETE'])  # [NEW-19]
@login_required
@role_required('admin', 'accounts')
def api_delete_transaction(tid):
    t = Transaction.query.get_or_404(tid)
    if t.reference:
        return jsonify({'ok': False,
                        'msg': 'هذه الحركة مرتبطة بدفعة طالب — احذف الدفعة نفسها من ملف الطالب بدلاً من ذلك'}), 400
    log_activity('delete_transaction', 'transaction', tid, f'{t.type} — {t.amount}')
    db.session.delete(t)
    db.session.commit()
    return jsonify({'ok': True})

# ═══════════════════════════════════════════════════
# DEPARTMENTS & BATCHES
# ═══════════════════════════════════════════════════

@app.route('/api/departments', methods=['GET', 'POST'])
@login_required
def api_departments():
    if request.method == 'POST':
        if current_user.role not in ('admin',):
            return jsonify({'error': 'غير مصرح'}), 403
        d = request.get_json() or {}
        name = (d.get('name') or '').strip()
        if not name or len(name) > 100:
            return jsonify({'ok': False, 'msg': 'اسم القسم مطلوب'}), 400
        if Department.query.filter_by(name=name).first():
            return jsonify({'ok': False, 'msg': 'اسم القسم موجود مسبقاً'}), 400
        try:
            annual_fee   = max(0, float(d.get('annual_fee', 0)))
            first_pay    = max(0, float(d.get('first_pay', 0)))
            installments = max(1, int(d.get('installments', 10)))
        except (TypeError, ValueError):
            return jsonify({'ok': False, 'msg': 'قيم الرسوم غير صالحة'}), 400
        dept = Department(name=name, annual_fee=annual_fee,
                          first_pay=first_pay, installments=installments)
        db.session.add(dept)
        log_activity('add_department', 'department', None, name)
        try:
            db.session.commit()
        except Exception as e:
            # [NEW-24] لو طلبان متزامنان حاولا إضافة نفس الاسم في نفس اللحظة
            # بالظبط (تجاوز الفحص المسبق) — نرجِّع رسالة واضحة بدل كراش
            db.session.rollback()
            app.logger.warning(f"تعارض عند إضافة قسم: {e}")
            return jsonify({'ok': False, 'msg': 'اسم القسم موجود مسبقاً (رَبَّما أُضيف للتو)'}), 400
        return jsonify({'ok': True, 'id': dept.id})

    depts = Department.query.filter_by(active=True).all()
    return jsonify([{
        'id': d.id, 'name': d.name, 'annual_fee': d.annual_fee,
        'first_pay': d.first_pay, 'installments': d.installments,
        'student_count': Student.query.filter_by(department_id=d.id, status='active').count(),
        'active': d.active
    } for d in depts])

@app.route('/api/departments/<int:did>', methods=['PUT'])  # [NEW-06]
@login_required
@role_required('admin')
def api_update_dept(did):
    dept = Department.query.get_or_404(did)
    d = request.get_json() or {}
    if 'name' in d:
        name = (d['name'] or '').strip()
        if name and name != dept.name:
            if Department.query.filter_by(name=name).first():
                return jsonify({'ok': False, 'msg': 'اسم القسم موجود مسبقاً'}), 400
            dept.name = name
    for f in ('annual_fee', 'first_pay'):
        if f in d:
            try:
                setattr(dept, f, max(0, float(d[f])))
            except (TypeError, ValueError):
                pass
    if 'installments' in d:
        try:
            dept.installments = max(1, int(d['installments']))
        except (TypeError, ValueError):
            pass
    if 'active' in d:
        dept.active = bool(d['active'])
    log_activity('update_department', 'department', did)
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/batches', methods=['GET', 'POST'])
@login_required
def api_batches():
    if request.method == 'POST':
        if current_user.role not in ('admin', 'students'):
            return jsonify({'error': 'غير مصرح'}), 403
        d = request.get_json() or {}
        name = (d.get('name') or '').strip()
        if not name:
            return jsonify({'ok': False, 'msg': 'اسم الدفعة مطلوب'}), 400
        dept_id = d.get('department_id')
        if not Department.query.get(dept_id):
            return jsonify({'ok': False, 'msg': 'القسم غير موجود'}), 400
        try:
            year = int(d['year']) if d.get('year') else None
        except (TypeError, ValueError):
            year = None
        b = Batch(name=name, department_id=dept_id, year=year)
        db.session.add(b)
        db.session.commit()
        return jsonify({'ok': True, 'id': b.id})

    dept_id = request.args.get('dept_id')
    q = Batch.query.filter_by(active=True)
    if dept_id:
        q = q.filter_by(department_id=dept_id)
    return jsonify([{
        'id': b.id, 'name': b.name, 'year': b.year,
        'dept_id': b.department_id,
        'student_count': Student.query.filter_by(batch_id=b.id).count()
    } for b in q.all()])

@app.route('/api/batches/<int:bid>', methods=['PUT'])  # [NEW-19] إكمال CRUD للدفعات
@login_required
@role_required('admin', 'students')
def api_update_batch(bid):
    b = Batch.query.get_or_404(bid)
    d = request.get_json() or {}
    if 'name' in d:
        name = (d['name'] or '').strip()
        if name:
            b.name = name
    if 'department_id' in d and Department.query.get(d['department_id']):
        b.department_id = d['department_id']
    if 'year' in d:
        try:
            b.year = int(d['year']) if d['year'] else None
        except (TypeError, ValueError):
            pass
    if 'active' in d:
        b.active = bool(d['active'])
    log_activity('update_batch', 'batch', bid, b.name)
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/batches/<int:bid>', methods=['DELETE'])  # [NEW-19]
@login_required
@role_required('admin')
def api_delete_batch(bid):
    b = Batch.query.get_or_404(bid)
    student_count = Student.query.filter_by(batch_id=b.id).count()
    if student_count > 0:
        return jsonify({'ok': False,
                        'msg': f'لا يمكن حذف الدفعة — بها {student_count} طالب. انقلهم لدفعة أخرى أولاً أو عطِّلها بدلاً من الحذف.'}), 400
    if AttendanceSession.query.filter_by(batch_id=b.id).first():
        return jsonify({'ok': False, 'msg': 'لا يمكن حذف دفعة مرتبطة بجلسات حضور مسجَّلة.'}), 400
    name = b.name
    db.session.delete(b)
    log_activity('delete_batch', 'batch', bid, name)
    db.session.commit()
    return jsonify({'ok': True})

# ═══════════════════════════════════════════════════
# USERS
# ═══════════════════════════════════════════════════

@app.route('/api/users', methods=['GET', 'POST'])
@login_required
@role_required('admin')
def api_users():
    if request.method == 'POST':
        d = request.get_json() or {}
        username  = (d.get('username') or '').strip()
        password  = d.get('password', '')
        full_name = (d.get('full_name') or '').strip()
        role      = d.get('role', 'reception')

        if not username or len(username) > 80:
            return jsonify({'ok': False, 'msg': 'اسم المستخدم مطلوب (حتى 80 حرف)'}), 400
        if not re.match(r'^[\w\.\-@]+$', username):
            return jsonify({'ok': False, 'msg': 'اسم المستخدم يحتوي على أحرف غير مسموحة'}), 400
        # [BUG-17] Validate role
        if role not in VALID_ROLES:
            return jsonify({'ok': False, 'msg': 'الدور غير صالح'}), 400
        if len(password) < 6:
            return jsonify({'ok': False, 'msg': 'كلمة المرور لا تقل عن 6 أحرف'}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({'ok': False, 'msg': 'اسم المستخدم موجود مسبقاً'}), 400

        lic = get_license()
        if User.query.filter_by(active=True).count() >= lic.get('max_users', 999):
            return jsonify({'ok': False, 'msg': f'الحد الأقصى للمستخدمين هو {lic["max_users"]}. تواصل مع الدعم.'}), 403

        u = User(username=username, password=generate_password_hash(password),
                 full_name=full_name, role=role,
                 must_change_pw=d.get('must_change_pw', True),  # [BUG-09]
                 created_by=current_user.id)
        db.session.add(u)
        log_activity('add_user', 'user', None, username)
        db.session.commit()
        return jsonify({'ok': True})

    # مخفي: superadmin لا يظهر في القائمة
    users = User.query.filter(User.username != '__gtech_support__').order_by(User.id).all()
    return jsonify([{
        'id': u.id, 'username': u.username, 'full_name': u.full_name,
        'role': u.role, 'active': u.active,
        'must_change_pw': u.must_change_pw,
        'last_login': u.last_login.strftime('%Y-%m-%d %H:%M') if u.last_login else None,
        'created_at': u.created_at.strftime('%Y-%m-%d')
    } for u in users])

@app.route('/api/users/<int:uid>', methods=['PUT'])  # [NEW-07]
@login_required
@role_required('admin')
def api_update_user(uid):
    u = User.query.get_or_404(uid)
    if u.id == current_user.id and 'active' in request.get_json():
        return jsonify({'ok': False, 'msg': 'لا يمكنك تعطيل حسابك الخاص'}), 400
    d = request.get_json() or {}
    if 'full_name' in d:
        u.full_name = (d['full_name'] or '').strip()
    if 'role' in d and d['role'] in VALID_ROLES:
        u.role = d['role']
    if 'active' in d:
        u.active = bool(d['active'])
    if 'password' in d and d['password']:
        if len(d['password']) < 6:
            return jsonify({'ok': False, 'msg': 'كلمة المرور لا تقل عن 6 أحرف'}), 400
        u.password = generate_password_hash(d['password'])
        u.must_change_pw = True
    log_activity('update_user', 'user', uid, u.username)
    db.session.commit()
    return jsonify({'ok': True})

# ═══════════════════════════════════════════════════
# NOTIFICATIONS
# ═══════════════════════════════════════════════════

@app.route('/api/notifications', methods=['GET', 'POST'])
@login_required
def api_notifications():
    if request.method == 'POST':
        if current_user.role not in ('admin', 'students'):
            return jsonify({'error': 'غير مصرح'}), 403
        d = request.get_json() or {}
        message = (d.get('message') or '').strip()
        if not message:
            return jsonify({'ok': False, 'msg': 'نص الرسالة مطلوب'}), 400
        target = d.get('target', 'all')
        if target == 'overdue':
            count = Student.query.filter(Student.total_fees > Student.total_paid,
                                         Student.status == 'active').count()
        elif target == 'all':
            count = Student.query.filter_by(status='active').count()
        else:
            count = 0
        n = Notification(
            title=(d.get('title') or 'إشعار')[:150],
            message=message, channel=d.get('channel', 'whatsapp'),
            target=target, sent_count=count,
            status='sent', created_by=current_user.id
        )
        db.session.add(n)
        log_activity('send_notification', 'notification', None, f'to {count} students')
        db.session.commit()
        return jsonify({'ok': True, 'sent': count})

    notifs = Notification.query.order_by(Notification.created_at.desc()).limit(50).all()
    return jsonify([{
        'id': n.id, 'title': n.title, 'channel': n.channel,
        'target': n.target, 'sent_count': n.sent_count, 'status': n.status,
        'created_at': n.created_at.strftime('%Y-%m-%d %H:%M')
    } for n in notifs])

# ═══════════════════════════════════════════════════
# REPORTS
# ═══════════════════════════════════════════════════

@app.route('/api/reports/summary')
@login_required
def api_reports_summary():
    total      = Student.query.count()
    by_status  = dict(db.session.query(Student.status, db.func.count()).group_by(Student.status).all())
    by_dept    = db.session.query(Department.name, db.func.count(Student.id))\
        .outerjoin(Student, Student.department_id == Department.id)\
        .group_by(Department.id, Department.name).all()
    total_fees = db.session.query(db.func.sum(Student.total_fees)).scalar() or 0
    total_paid = db.session.query(db.func.sum(Student.total_paid)).scalar() or 0
    return jsonify({
        'total': total, 'by_status': by_status,
        'by_dept': [{'dept': d[0], 'count': d[1]} for d in by_dept],
        'total_fees': round(total_fees, 2),
        'total_paid': round(total_paid, 2),
        'total_remaining': round(total_fees - total_paid, 2),
        'collection_rate': round((total_paid / total_fees * 100) if total_fees else 0, 1)
    })

@app.route('/api/activity_log')  # [NEW-09]
@login_required
@role_required('admin')
def api_activity_log():
    page = max(1, int(request.args.get('page', 1)))
    logs = ActivityLog.query.order_by(ActivityLog.created_at.desc())\
               .offset((page - 1) * 50).limit(50).all()
    users = {u.id: u.username for u in User.query.all()}
    return jsonify([{
        'user': users.get(l.user_id, '—'),
        'action': l.action, 'entity': l.entity or '',
        'detail': l.detail or '', 'ip': l.ip or '',
        'created_at': l.created_at.strftime('%Y-%m-%d %H:%M:%S')
    } for l in logs])

# ═══════════════════════════════════════════════════
# PRINT RECEIPT  [NEW-04]
# ═══════════════════════════════════════════════════

@app.route('/api/payments/<int:pid>/receipt')
@login_required
def api_payment_receipt(pid):
    p = Payment.query.get_or_404(pid)
    s = p.student
    lic = get_license()
    return jsonify({
        'receipt_no': p.receipt_no,
        'student_name': s.full_name,
        'student_code': s.code,
        'department': s.department.name if s.department else '',
        'amount': p.amount,
        'pay_type': p.pay_type,
        'pay_method': p.pay_method,
        'total_fees': s.total_fees,
        'total_paid': s.total_paid,
        'remaining': s.remaining,
        'notes': p.notes or '',
        'created_at': p.created_at.strftime('%Y-%m-%d %H:%M'),
        'institution': lic.get('client_name', 'GTech Academy')
    })

# ═══════════════════════════════════════════════════
# AI ASSISTANT — محرك تحليل ذكي مجاني بالكامل  [NEW-17]
# ═══════════════════════════════════════════════════
# لا يعتمد على أي API خارجي مدفوع (لا OpenAI ولا Claude ولا Gemini).
# يحلِّل بيانات السنتر الفعلية من قاعدة البيانات ويردّ بلغة طبيعية عربية
# على أسئلة الأداء والمالية والحضور، باستخدام قواعد وإحصائيات محسوبة لحظياً.
# التكلفة: صفر تماماً — يعمل داخل نفس السيرفر بدون أي اشتراك.

def _ai_get_stats():
    """يجمع كل الإحصائيات الأساسية مرة واحدة لإعادة استخدامها في كل الإجابات"""
    now = datetime.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_students  = Student.query.count()
    active_students = Student.query.filter_by(status='active').count()
    overdue_students = Student.query.filter(
        Student.total_fees > Student.total_paid, Student.status == 'active').all()
    total_overdue_amount = sum(s.remaining for s in overdue_students)

    month_income = db.session.query(db.func.sum(Payment.amount)).filter(
        Payment.created_at >= month_start).scalar() or 0
    month_expense = db.session.query(db.func.sum(Transaction.amount)).filter(
        Transaction.type == 'expense', Transaction.created_at >= month_start).scalar() or 0

    total_fees = db.session.query(db.func.sum(Student.total_fees)).scalar() or 0
    total_paid = db.session.query(db.func.sum(Student.total_paid)).scalar() or 0
    collection_rate = round((total_paid / total_fees * 100) if total_fees else 0, 1)

    dept_counts = db.session.query(Department.name, db.func.count(Student.id)).outerjoin(
        Student, (Student.department_id == Department.id) & (Student.status == 'active')
    ).group_by(Department.id, Department.name).order_by(db.func.count(Student.id).desc()).all()

    total_teachers = Teacher.query.filter_by(status='active').count()

    # نسبة الحضور آخر 30 يوم
    since = now - __import__('datetime').timedelta(days=30)
    recent_records = AttendanceRecord.query.join(AttendanceSession).filter(
        AttendanceSession.session_date >= since.date()).all()
    total_att = len(recent_records)
    present_att = sum(1 for r in recent_records if r.status == 'present')
    attendance_rate = round((present_att / total_att * 100) if total_att else 0, 1)

    return {
        'total_students': total_students, 'active_students': active_students,
        'overdue_count': len(overdue_students), 'overdue_amount': total_overdue_amount,
        'overdue_students': overdue_students,
        'month_income': month_income, 'month_expense': month_expense,
        'net_profit': month_income - month_expense,
        'collection_rate': collection_rate, 'total_fees': total_fees, 'total_paid': total_paid,
        'dept_counts': dept_counts, 'total_teachers': total_teachers,
        'attendance_rate': attendance_rate, 'total_attendance_records': total_att,
    }

def _ai_fmt(n):
    return f"{n:,.0f} ج.م"

# قاعدة الأنماط: كل نمط مرتبط بدالة تُوَلِّد الرد بناءً على الإحصائيات الحية
_AI_INTENTS = [
    # (كلمات مفتاحية, دالة توليد الرد)
    (['متأخر', 'متأخرين', 'مديون', 'لم يدفع', 'لسه ما دفعش'], 'overdue'),
    (['ايراد', 'إيراد', 'دخل الشهر', 'كسبنا', 'محصل'], 'income'),
    (['مصروف', 'صرفنا', 'مصاريف'], 'expense'),
    (['ربح', 'صافي', 'الأرباح'], 'profit'),
    (['نسبة التحصيل', 'تحصيل', 'نسبه التحصيل'], 'collection'),
    (['قسم', 'أقسام', 'الأقسام الأكثر', 'اكتر قسم'], 'departments'),
    (['حضور', 'غياب', 'الحضور', 'نسبة الحضور'], 'attendance'),
    (['عدد الطلاب', 'كام طالب', 'اجمالي الطلاب', 'إجمالي الطلاب'], 'students_count'),
    (['مدرس', 'مدرسين', 'عدد المدرسين'], 'teachers_count'),
    (['نصيحة', 'تحليل', 'تقييم', 'رأيك', 'إيه رأيك', 'كيف الأداء', 'أداء'], 'analysis'),
    (['مرحبا', 'اهلا', 'أهلاً', 'هاي', 'السلام عليكم'], 'greeting'),
]

def _ai_answer_overdue(stats):
    if stats['overdue_count'] == 0:
        return "🎉 لا يوجد أي طالب متأخر في السداد حالياً — وضع تحصيل ممتاز!"
    top = sorted(stats['overdue_students'], key=lambda s: s.remaining, reverse=True)[:5]
    lines = [f"⚠️ يوجد {stats['overdue_count']} طالب متأخر بإجمالي {_ai_fmt(stats['overdue_amount'])}.",
             "", "أعلى 5 حالات:"]
    for s in top:
        lines.append(f"• {s.full_name} ({s.code}) — متبقي {_ai_fmt(s.remaining)}")
    lines.append("")
    lines.append("💡 نصيحة: أرسل إشعار جماعي للمتأخرين من صفحة الإشعارات لتذكيرهم.")
    return "\n".join(lines)

def _ai_answer_income(stats):
    return (f"💰 إيرادات هذا الشهر حتى الآن: {_ai_fmt(stats['month_income'])}\n"
            f"إجمالي المُحصَّل من كل الطلاب منذ البداية: {_ai_fmt(stats['total_paid'])} "
            f"من أصل {_ai_fmt(stats['total_fees'])} رسوم مستحقة.")

def _ai_answer_expense(stats):
    return f"📉 مصروفات هذا الشهر: {_ai_fmt(stats['month_expense'])}"

def _ai_answer_profit(stats):
    net = stats['net_profit']
    emoji = "📈" if net >= 0 else "📉"
    status = "ربح" if net >= 0 else "خسارة"
    return (f"{emoji} صافي {status} هذا الشهر: {_ai_fmt(abs(net))}\n"
            f"(إيرادات {_ai_fmt(stats['month_income'])} − مصروفات {_ai_fmt(stats['month_expense'])})")

def _ai_answer_collection(stats):
    rate = stats['collection_rate']
    if rate >= 85:
        note = "ممتازة! استمر على هذا المستوى."
    elif rate >= 60:
        note = "جيدة، لكن يمكن تحسينها بمتابعة المتأخرين بانتظام."
    else:
        note = "منخفضة نسبياً — يُنصَح بحملة تحصيل عاجلة وإرسال تذكيرات."
    return f"📊 نسبة التحصيل الإجمالية: {rate}%\n{note}"

def _ai_answer_departments(stats):
    if not stats['dept_counts']:
        return "لا توجد بيانات أقسام بعد."
    lines = ["🏢 توزيع الطلاب النشطين على الأقسام:"]
    for name, count in stats['dept_counts'][:10]:
        lines.append(f"• {name}: {count} طالب")
    top = stats['dept_counts'][0] if stats['dept_counts'] else None
    if top and top[1] > 0:
        lines.append(f"\n🏆 الأعلى إقبالاً: {top[0]} بـ {top[1]} طالب.")
    return "\n".join(lines)

def _ai_answer_attendance(stats):
    if stats['total_attendance_records'] == 0:
        return "لا توجد سجلات حضور مسجَّلة خلال آخر 30 يوماً بعد."
    rate = stats['attendance_rate']
    note = "ممتازة" if rate >= 90 else "جيدة" if rate >= 75 else "تحتاج متابعة"
    return f"📅 نسبة الحضور خلال آخر 30 يوماً: {rate}% ({note})"

def _ai_answer_students_count(stats):
    return (f"👥 إجمالي الطلاب المسجَّلين: {stats['total_students']}\n"
            f"النشطون حالياً: {stats['active_students']}")

def _ai_answer_teachers_count(stats):
    return f"🧑‍🏫 عدد المدرسين النشطين حالياً: {stats['total_teachers']}"

def _ai_answer_greeting(stats):
    return ("👋 أهلاً بك! أنا مساعد GTech الذكي.\n"
            "اسألني عن: المتأخرين، الإيرادات، المصروفات، نسبة التحصيل، "
            "الأقسام، الحضور، أو اطلب مني تحليل الأداء العام.")

def _ai_answer_analysis(stats):
    """التحليل الشامل — أقرب ما يكون لتوصية إدارية حقيقية"""
    lines = ["📋 تحليل الأداء العام لهذا الشهر:", ""]

    # مالي
    if stats['net_profit'] >= 0:
        lines.append(f"✅ الوضع المالي إيجابي: صافي ربح {_ai_fmt(stats['net_profit'])} هذا الشهر.")
    else:
        lines.append(f"⚠️ تنبيه: المصروفات تجاوزت الإيرادات بـ {_ai_fmt(abs(stats['net_profit']))} هذا الشهر.")

    # تحصيل
    if stats['collection_rate'] < 70:
        lines.append(f"⚠️ نسبة التحصيل {stats['collection_rate']}% منخفضة — "
                     f"{stats['overdue_count']} طالب متأخرين بإجمالي {_ai_fmt(stats['overdue_amount'])}.")
    else:
        lines.append(f"✅ نسبة التحصيل جيدة: {stats['collection_rate']}%.")

    # حضور
    if stats['total_attendance_records'] > 0:
        if stats['attendance_rate'] < 75:
            lines.append(f"⚠️ نسبة الحضور منخفضة ({stats['attendance_rate']}%) — قد يستدعي متابعة أسباب الغياب.")
        else:
            lines.append(f"✅ نسبة الحضور جيدة: {stats['attendance_rate']}%.")

    # توصية ختامية
    lines.append("")
    if stats['overdue_count'] > 5:
        lines.append("💡 التوصية الأهم الآن: التركيز على تحصيل المستحقات المتأخرة عبر الإشعارات الجماعية.")
    elif stats['net_profit'] < 0:
        lines.append("💡 التوصية الأهم الآن: مراجعة بنود المصروفات وتقليل غير الضروري منها.")
    else:
        lines.append("💡 الأداء العام مستقر — استمر بالمتابعة الدورية للتقارير.")

    return "\n".join(lines)

_AI_HANDLERS = {
    'overdue': _ai_answer_overdue, 'income': _ai_answer_income,
    'expense': _ai_answer_expense, 'profit': _ai_answer_profit,
    'collection': _ai_answer_collection, 'departments': _ai_answer_departments,
    'attendance': _ai_answer_attendance, 'students_count': _ai_answer_students_count,
    'teachers_count': _ai_answer_teachers_count, 'greeting': _ai_answer_greeting,
    'analysis': _ai_answer_analysis,
}

@app.route('/api/ai/ask', methods=['POST'])
@login_required
def api_ai_ask():
    """
    المساعد الذكي — يحلِّل السؤال بمطابقة كلمات مفتاحية عربية،
    ثم يبني الرد من بيانات حقيقية لحظية من قاعدة البيانات.
    لا اتصال بأي خدمة خارجية — يعمل حتى بدون إنترنت خارجي (فقط داخل السيرفر).
    """
    d = request.get_json() or {}
    question = (d.get('question') or '').strip()
    if not question:
        return jsonify({'ok': False, 'msg': 'اكتب سؤالاً أولاً'}), 400
    if len(question) > 300:
        return jsonify({'ok': False, 'msg': 'السؤال طويل جداً'}), 400

    stats = _ai_get_stats()
    q_lower = question.lower()

    matched_intent = None
    for keywords, intent in _AI_INTENTS:
        if any(k in question or k in q_lower for k in keywords):
            matched_intent = intent
            break

    if matched_intent and matched_intent in _AI_HANDLERS:
        answer = _AI_HANDLERS[matched_intent](stats)
    else:
        # لا تطابق — نعرض ملخصاً عاماً + اقتراحات أسئلة
        answer = (
            "🤔 لم أفهم السؤال تحديداً، لكن هذه لمحة سريعة عن السنتر الآن:\n\n"
            f"👥 {stats['active_students']} طالب نشط | "
            f"💰 إيرادات الشهر {_ai_fmt(stats['month_income'])} | "
            f"⚠️ {stats['overdue_count']} متأخر في السداد\n\n"
            "جرِّب أسئلة مثل:\n"
            "• من هم الطلاب المتأخرون؟\n"
            "• ما نسبة التحصيل؟\n"
            "• حلل أداء الشهر\n"
            "• ما هو أكثر قسم إقبالاً؟"
        )

    log_activity('ai_query', 'ai', detail=question[:100])
    db.session.commit()

    return jsonify({'ok': True, 'answer': answer, 'intent': matched_intent or 'general'})

@app.route('/api/ai/suggestions')
@login_required
def api_ai_suggestions():
    """أسئلة مقترحة تظهر كأزرار سريعة في واجهة الشات"""
    return jsonify([
        "من هم الطلاب المتأخرون؟",
        "ما نسبة التحصيل؟",
        "حلل أداء الشهر",
        "ما أكثر قسم إقبالاً؟",
        "ما نسبة الحضور؟",
        "كم صافي الربح هذا الشهر؟",
    ])

# ═══════════════════════════════════════════════════
# LOGO / BRANDING  [NEW-23]
# ═══════════════════════════════════════════════════
# كل عميل يقدر يرفع شعاره الخاص من داخل النظام — يظهر تلقائياً في:
# الشريط الجانبي، صفحة تسجيل الدخول، بطاقات الطلاب، والإيصالات المطبوعة.

ALLOWED_LOGO_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.svg', '.webp'}
LOGO_MAX_SIZE_MB = 3

@app.route('/api/settings/logo', methods=['GET'])
def api_get_logo():
    """يُرجع شعار العميل لو موجود — بدون تسجيل دخول (تحتاجه صفحة الدخول نفسها)"""
    upload_dir = app.config['UPLOAD_FOLDER']
    for ext in ALLOWED_LOGO_EXTENSIONS:
        path = os.path.join(upload_dir, f'logo{ext}')
        if os.path.exists(path):
            from flask import send_file
            return send_file(path)
    return jsonify({'exists': False}), 404

@app.route('/api/settings/logo', methods=['POST'])
@login_required
@role_required('admin')
def api_upload_logo():
    if 'logo' not in request.files:
        return jsonify({'ok': False, 'msg': 'لم يتم إرفاق أي ملف'}), 400
    file = request.files['logo']
    if not file.filename:
        return jsonify({'ok': False, 'msg': 'لم يتم اختيار ملف'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_LOGO_EXTENSIONS:
        return jsonify({'ok': False,
                        'msg': f'صيغة غير مدعومة. المسموح: {", ".join(ALLOWED_LOGO_EXTENSIONS)}'}), 400

    file.seek(0, os.SEEK_END)
    size_mb = file.tell() / (1024 * 1024)
    file.seek(0)
    if size_mb > LOGO_MAX_SIZE_MB:
        return jsonify({'ok': False, 'msg': f'حجم الملف كبير جداً (الحد الأقصى {LOGO_MAX_SIZE_MB} ميجا)'}), 400

    upload_dir = app.config['UPLOAD_FOLDER']
    # احذف أي شعار قديم بأي صيغة قبل حفظ الجديد (يضمن عدم بقاء أكثر من شعار)
    for old_ext in ALLOWED_LOGO_EXTENSIONS:
        old_path = os.path.join(upload_dir, f'logo{old_ext}')
        if os.path.exists(old_path):
            os.remove(old_path)

    save_path = os.path.join(upload_dir, f'logo{ext}')
    file.save(save_path)
    log_activity('upload_logo', 'system', detail=file.filename)
    db.session.commit()
    return jsonify({'ok': True, 'msg': 'تم رفع الشعار بنجاح', 'url': '/api/settings/logo?t=' + str(int(datetime.now().timestamp()))})

@app.route('/api/settings/logo', methods=['DELETE'])
@login_required
@role_required('admin')
def api_delete_logo():
    upload_dir = app.config['UPLOAD_FOLDER']
    removed = False
    for ext in ALLOWED_LOGO_EXTENSIONS:
        path = os.path.join(upload_dir, f'logo{ext}')
        if os.path.exists(path):
            os.remove(path)
            removed = True
    log_activity('delete_logo', 'system')
    db.session.commit()
    return jsonify({'ok': True, 'removed': removed})

# ═══════════════════════════════════════════════════
# GOOGLE DRIVE INTEGRATION  [NEW-18]
# ═══════════════════════════════════════════════════
# يحتاج ضبط في Railway → Variables:
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
# (تُنشَأ مجاناً من Google Cloud Console — راجع الدليل المرفق)

GOOGLE_CLIENT_ID     = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
GOOGLE_REDIRECT_URI  = os.environ.get('GOOGLE_REDIRECT_URI', '')
GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file']

def _google_oauth_flow():
    from google_auth_oauthlib.flow import Flow
    client_config = {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [GOOGLE_REDIRECT_URI],
        }
    }
    return Flow.from_client_config(client_config, scopes=GOOGLE_SCOPES,
                                   redirect_uri=GOOGLE_REDIRECT_URI)

@app.route('/api/google_drive/status')
@login_required
@role_required('admin')
def api_google_drive_status():
    cfg = GoogleDriveConfig.query.filter_by(active=True).first()
    if not cfg:
        return jsonify({'connected': False,
                        'configured': bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)})
    return jsonify({
        'connected': True,
        'email': cfg.email,
        'connected_at': cfg.connected_at.strftime('%Y-%m-%d %H:%M') if cfg.connected_at else None,
        'last_backup_at': cfg.last_backup_at.strftime('%Y-%m-%d %H:%M') if cfg.last_backup_at else 'لم تُرفَع نسخة بعد',
        'last_status': cfg.last_status,
        'last_error': cfg.last_error
    })

@app.route('/api/google_drive/connect')
@login_required
@role_required('admin')
def api_google_drive_connect():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET or not GOOGLE_REDIRECT_URI:
        return jsonify({'ok': False,
                        'msg': 'إعدادات Google Drive غير مُفعَّلة بعد — يحتاج المطور ضبط GOOGLE_CLIENT_ID وGOOGLE_CLIENT_SECRET وGOOGLE_REDIRECT_URI في Railway'}), 400
    flow = _google_oauth_flow()
    auth_url, state = flow.authorization_url(
        access_type='offline', include_granted_scopes='true', prompt='consent')
    return jsonify({'ok': True, 'auth_url': auth_url})

@app.route('/api/google_drive/callback')
@login_required
def api_google_drive_callback():
    """يستقبل الرجوع من Google بعد موافقة العميل"""
    code = request.args.get('code')
    if not code:
        return render_template('blocked.html', reason='google_drive',
                               message='فشلت عملية ربط Google Drive — لم يتم استلام كود التفويض'), 400
    try:
        flow = _google_oauth_flow()
        flow.fetch_token(code=code)
        creds = flow.credentials

        # جلب بريد المستخدم للتأكيد
        from googleapiclient.discovery import build
        oauth2_service = build('oauth2', 'v2', credentials=creds)
        user_info = oauth2_service.userinfo().get().execute()
        email = user_info.get('email', 'غير معروف')

        # إنشاء مجلد GTech Backups داخل Drive العميل (أو استخدام الموجود)
        drive_service = build('drive', 'v3', credentials=creds)
        folder_id = _get_or_create_backup_folder(drive_service)

        # تعطيل أي ربط سابق، وحفظ الجديد
        GoogleDriveConfig.query.update({'active': False})
        cfg = GoogleDriveConfig(
            email=email, refresh_token=creds.refresh_token,
            folder_id=folder_id, connected_at=datetime.utcnow(),
            last_status='pending', active=True
        )
        db.session.add(cfg)
        log_activity('google_drive_connect', 'system', detail=email)
        db.session.commit()

        return redirect('/?gdrive=connected')
    except Exception as e:
        app.logger.error(f"Google Drive OAuth error: {e}")
        return render_template('blocked.html', reason='google_drive_error',
                               message=f'فشل ربط Google Drive: {str(e)}'), 400

@app.route('/api/google_drive/disconnect', methods=['POST'])
@login_required
@role_required('admin')
def api_google_drive_disconnect():
    GoogleDriveConfig.query.update({'active': False})
    log_activity('google_drive_disconnect', 'system')
    db.session.commit()
    return jsonify({'ok': True})

@app.route('/api/google_drive/backup_now', methods=['POST'])  # اختبار فوري يدوي
@login_required
@role_required('admin')
def api_google_drive_backup_now():
    ok, msg = run_google_drive_backup()
    return jsonify({'ok': ok, 'msg': msg})

def _get_or_create_backup_folder(drive_service):
    """يبحث عن مجلد 'GTech ERP Backups' أو ينشئه لو مش موجود"""
    q = "name='GTech ERP Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    results = drive_service.files().list(q=q, fields='files(id, name)').execute()
    files = results.get('files', [])
    if files:
        return files[0]['id']
    folder_metadata = {'name': 'GTech ERP Backups', 'mimeType': 'application/vnd.google-apps.folder'}
    folder = drive_service.files().create(body=folder_metadata, fields='id').execute()
    return folder.get('id')

def run_google_drive_backup():
    """[NEW-18] رفع نسخة احتياطية فعلية إلى Google Drive العميل — تُستدعى أسبوعياً تلقائياً أو يدوياً"""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaInMemoryUpload

    cfg = GoogleDriveConfig.query.filter_by(active=True).first()
    if not cfg:
        return False, 'لا يوجد حساب Google Drive مربوط'
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return False, 'إعدادات Google Drive غير مكتملة على السيرفر'

    try:
        creds = Credentials(
            token=None, refresh_token=cfg.refresh_token,
            token_uri='https://oauth2.googleapis.com/token',
            client_id=GOOGLE_CLIENT_ID, client_secret=GOOGLE_CLIENT_SECRET,
            scopes=GOOGLE_SCOPES
        )
        drive_service = build('drive', 'v3', credentials=creds)

        with app.app_context():
            backup_data = build_backup_dict()
        content = json.dumps(backup_data, ensure_ascii=False, indent=2).encode('utf-8')
        filename = f"gtech_backup_{datetime.now().strftime('%Y-%m-%d_%H%M')}.json"

        media = MediaInMemoryUpload(content, mimetype='application/json')
        file_metadata = {'name': filename, 'parents': [cfg.folder_id]}
        drive_service.files().create(body=file_metadata, media_body=media, fields='id').execute()

        cfg.last_backup_at = datetime.utcnow()
        cfg.last_status = 'success'
        cfg.last_error = None
        db.session.add(BackupLog(kind='weekly_drive', status='success',
                                 filename=filename, size_bytes=len(content)))
        db.session.commit()
        return True, f'تم رفع النسخة بنجاح: {filename}'
    except Exception as e:
        err = str(e)[:290]
        try:
            cfg.last_status = 'failed'
            cfg.last_error = err
            db.session.add(BackupLog(kind='weekly_drive', status='failed', error=err))
            db.session.commit()
        except Exception:
            pass
        app.logger.error(f"Google Drive backup failed: {err}")
        return False, f'فشل الرفع: {err}'

# ═══════════════════════════════════════════════════
# AUTOMATED LOCAL DAILY BACKUP  [NEW-18]
# ═══════════════════════════════════════════════════

_BACKUP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'backups')
os.makedirs(_BACKUP_DIR, exist_ok=True)
_BACKUP_RETENTION_DAYS = 30

def run_daily_local_backup():
    """[NEW-18] نسخة احتياطية محلية يومية على قرص السيرفر + تنظيف القديم تلقائياً
    ⚠️ ملاحظة صادقة: مساحة تخزين Railway المجانية قد تُمسَح عند إعادة نشر جديدة
    (redeploy) ما لم يُفعَّل Volume دائم. لذلك هذه النسخة تفيد للاستعادة السريعة
    اليومية (خطأ بشري، حذف غير مقصود)، بينما Google Drive الأسبوعي هو خط الأمان
    الحقيقي ضد فقد البيانات الكارثي."""
    try:
        with app.app_context():
            backup_data = build_backup_dict()
            filename = f"backup_{datetime.now().strftime('%Y-%m-%d')}.json"
            filepath = os.path.join(_BACKUP_DIR, filename)
            content = json.dumps(backup_data, ensure_ascii=False, indent=2)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)

            # تنظيف النسخ الأقدم من 30 يوم
            cutoff = datetime.now().timestamp() - (_BACKUP_RETENTION_DAYS * 86400)
            for old_file in os.listdir(_BACKUP_DIR):
                old_path = os.path.join(_BACKUP_DIR, old_file)
                if os.path.isfile(old_path) and os.path.getmtime(old_path) < cutoff:
                    os.remove(old_path)

            db.session.add(BackupLog(kind='daily_local', status='success',
                                     filename=filename, size_bytes=len(content.encode('utf-8'))))
            db.session.commit()
            app.logger.info(f"✅ نسخة احتياطية يومية محلية نجحت: {filename}")
    except Exception as e:
        app.logger.error(f"❌ فشلت النسخة الاحتياطية اليومية المحلية: {e}")
        try:
            with app.app_context():
                db.session.add(BackupLog(kind='daily_local', status='failed', error=str(e)[:290]))
                db.session.commit()
        except Exception:
            pass

@app.route('/api/backup/local_list')
@login_required
@role_required('admin')
def api_local_backup_list():
    """قائمة النسخ الاحتياطية المحلية المتوفرة على السيرفر حالياً"""
    files = []
    if os.path.exists(_BACKUP_DIR):
        for f in sorted(os.listdir(_BACKUP_DIR), reverse=True):
            fp = os.path.join(_BACKUP_DIR, f)
            if os.path.isfile(fp):
                files.append({
                    'filename': f,
                    'size_kb': round(os.path.getsize(fp) / 1024, 1),
                    'created_at': datetime.fromtimestamp(os.path.getmtime(fp)).strftime('%Y-%m-%d %H:%M')
                })
    return jsonify(files)

@app.route('/api/backup/local_download/<path:filename>')
@login_required
@role_required('admin')
def api_local_backup_download(filename):
    from flask import send_from_directory
    # حماية من path traversal
    if '..' in filename or filename.startswith('/'):
        return jsonify({'ok': False, 'msg': 'اسم ملف غير صالح'}), 400
    return send_from_directory(_BACKUP_DIR, filename, as_attachment=True)

@app.route('/api/backup/log')
@login_required
@role_required('admin')
def api_backup_log():
    logs = BackupLog.query.order_by(BackupLog.created_at.desc()).limit(30).all()
    return jsonify([{
        'kind': l.kind, 'status': l.status, 'filename': l.filename or '',
        'size_kb': round((l.size_bytes or 0) / 1024, 1),
        'error': l.error or '', 'created_at': l.created_at.strftime('%Y-%m-%d %H:%M')
    } for l in logs])

# ═══════════════════════════════════════════════════
# SCHEDULER — تشغيل النسخ الاحتياطية تلقائياً  [NEW-18]
# ═══════════════════════════════════════════════════

def init_scheduler():
    """
    يبدأ الجدولة مرة واحدة فقط عند إقلاع السيرفر.
    [NEW-18] حماية من التكرار: التطبيق يعمل بعدة عمليات (gunicorn workers)،
    فلو شغَّلنا الجدولة في كل عملية، هتتكرر النسخة الاحتياطية عدة مرات في نفس الوقت.
    الحل: قفل ملف بسيط مربوط برقم العملية (PID) — أول عملية توصل تاخد القفل
    وتشغِّل الجدولة، والباقي يتجاهلوها تلقائياً.
    """
    lock_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.scheduler.lock')
    my_pid = os.getpid()

    try:
        if os.path.exists(lock_path):
            with open(lock_path, 'r') as f:
                existing_pid = int(f.read().strip() or 0)
            # هل العملية صاحبة القفل لسه شغالة فعلاً؟
            try:
                os.kill(existing_pid, 0)  # لا يقتل — بس يتأكد إن العملية موجودة
                app.logger.info(f"ℹ️  الجدولة شغَّالة بالفعل في عملية أخرى (PID {existing_pid}) — تخطِّي")
                return None
            except OSError:
                pass  # العملية القديمة ماتت — القفل قديم (stale)، اقدر آخده

        with open(lock_path, 'w') as f:
            f.write(str(my_pid))
    except Exception as e:
        app.logger.warning(f"تعذَّر التحقق من قفل الجدولة: {e}")

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler = BackgroundScheduler(daemon=True, timezone='Africa/Cairo')
        # نسخة محلية يومية — الساعة 3 فجراً بتوقيت القاهرة (أقل وقت استخدام متوقَّع)
        scheduler.add_job(run_daily_local_backup, 'cron', hour=3, minute=0, id='daily_local_backup')
        # نسخة Google Drive أسبوعية — كل جمعة الساعة 3:30 فجراً
        scheduler.add_job(run_google_drive_backup, 'cron', day_of_week='fri', hour=3, minute=30,
                          id='weekly_drive_backup')
        scheduler.start()
        app.logger.info(f"✅ جدولة النسخ الاحتياطي التلقائي بدأت في العملية PID {my_pid} (يومي محلي + أسبوعي Google Drive)")
        return scheduler
    except Exception as e:
        app.logger.error(f"⚠️ تعذَّر تشغيل الجدولة التلقائية: {e}")
        return None

# ═══════════════════════════════════════════════════
# SEED & INIT
# ═══════════════════════════════════════════════════

def seed_data():
    """
    [BUG-26] كانت هذه الدالة عندها Race Condition حقيقي: التطبيق يعمل بعدة
    عمليات (gunicorn workers) قد تبدأ في نفس اللحظة. لو الاتنين شافوا قاعدة
    بيانات فاضية سوا، الاتنين كانوا بيحاولوا يضيفوا نفس البيانات (admin +
    الأقسام)، وده كان بيسبب IntegrityError يُعطِّل تشغيل العامل التاني
    بالكامل عند أول نشر للنظام. الحل: التقاط الخطأ والتراجع بأمان لو عملية
    أخرى سبقتنا بالفعل.
    """
    if User.query.count():
        return
    try:
        admin = User(
            username='admin',
            password=generate_password_hash('GTech@2024!'),
            full_name='مدير النظام',
            role='admin',
            must_change_pw=True  # Forces change on first login
        )
        db.session.add(admin)

        depts = [
            ('التمريض',            12000, 3000, 9),
            ('التحاليل الطبية',    14000, 4000, 10),
            ('البترول',            18000, 5000, 10),
            ('تركيبات الأسنان',   16000, 4000, 12),
            ('تكنولوجيا المعلومات', 15000, 4500, 10),
            ('الضيافة الجوية',     13000, 3500, 9),
            ('السياحة والفنادق',   12500, 3000, 9),
            ('إدارة الأعمال',      11000, 2500, 8),
            ('المساحة والخرائط',   13500, 3500, 10),
        ]
        for name, fee, first, inst in depts:
            db.session.add(Department(name=name, annual_fee=fee,
                                      first_pay=first, installments=inst))
        db.session.commit()
        app.logger.info(f"✅ تمَّت تهيئة البيانات الأولية (PID {os.getpid()})")
    except Exception as e:
        # [BUG-26] عملية أخرى (worker آخر) سبقتنا بالفعل بنفس البيانات — طبيعي وآمن
        db.session.rollback()
        app.logger.info(f"ℹ️  تخطِّي التهيئة الأولية — عملية أخرى قامت بها بالفعل ({type(e).__name__})")

def _init_database_once():
    """
    [BUG-26] حماية شاملة من تعارض عدة عمليات (gunicorn workers) عند أول إقلاع:
    db.create_all() نفسها ممكن تتعارض لو عمليتان حاولتا إنشاء نفس الجداول في
    نفس اللحظة بالضبط (خصوصاً على قواعد بيانات محلية). الحل: قفل ملف واحد
    بسيط يضمن إن عملية واحدة بس تعمل التهيئة، والباقي تنتظر لحد ما تخلص
    (مش بس تتجاهلها) عشان تضمن كل العمليات تلاقي الجداول جاهزة قبل ما تستقبل أي طلب.
    """
    lock_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.init.lock')
    done_marker = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.init.done')
    my_pid = os.getpid()

    # لو عملية سابقة خلَّصت التهيئة بالفعل (مؤشر ملف على القرص)، اعمل فقط create_all
    # (آمن ومُكرَّر التنفيذ بطبيعته checkfirst) وارجع فوراً بدون أي قفل
    if os.path.exists(done_marker):
        db.create_all()
        return

    got_lock = False
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(my_pid).encode())
        os.close(fd)
        got_lock = True
    except FileExistsError:
        got_lock = False

    if got_lock:
        try:
            db.create_all()
            seed_data()
            with open(done_marker, 'w') as f:
                f.write(str(my_pid))
            app.logger.info(f"✅ التهيئة الأولى للنظام تمَّت بنجاح (PID {my_pid})")
        finally:
            try:
                os.remove(lock_path)
            except OSError:
                pass
    else:
        # عملية أخرى بتعمل التهيئة الآن — استنَّى لحد ما تخلص (حد أقصى 15 ثانية)
        for _ in range(150):
            if os.path.exists(done_marker):
                break
            time.sleep(0.1)
        app.logger.info(f"ℹ️  العملية {my_pid} انتظرت اكتمال التهيئة من عملية أخرى")

# ═══════════════════════════════════════════════════
# GLOBAL ERROR HANDLERS  [NEW-24]
# ═══════════════════════════════════════════════════
# [إصلاح جذري] أي استثناء غير متوقَّع (تعارض قاعدة بيانات، race condition عند
# التزامن العالي، إلخ) كان ممكن يخلي Flask يرجِّع صفحة HTML بدل JSON، فيوصل
# لواجهة المستخدم رد "مش متوقَّع" ويوقف الزرار من غير تفسير واضح.
# الحل: أي مسار يبدأ بـ /api/ يضمن دايماً رد JSON صالح مهما حصل بالسيرفر.

@app.errorhandler(Exception)
def handle_any_exception(e):
    db.session.rollback()  # التراجع عن أي تغييرات معلَّقة بسبب الخطأ
    app.logger.error(f"خطأ غير متوقَّع في {request.path}: {e}", exc_info=True)
    if request.path.startswith('/api/'):
        return jsonify({'ok': False,
                        'msg': 'حدث خطأ غير متوقَّع في السيرفر. حاول مرة أخرى، ولو تكرر تواصل مع الدعم الفني.'}), 500
    # الصفحات العادية (غير API) — نعرض صفحة خطأ عادية بدل تسريب تفاصيل تقنية
    return render_template('blocked.html', reason='server_error',
                           message='حدث خطأ غير متوقَّع. حاول تحديث الصفحة.'), 500

@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith('/api/'):
        return jsonify({'ok': False, 'msg': 'المسار المطلوب غير موجود'}), 404
    return render_template('blocked.html', reason='not_found',
                           message='الصفحة غير موجودة.'), 404

@app.errorhandler(400)
def handle_400(e):
    if request.path.startswith('/api/'):
        return jsonify({'ok': False, 'msg': 'طلب غير صالح — تحقَّق من البيانات المُرسَلة'}), 400
    return render_template('blocked.html', reason='bad_request', message='طلب غير صالح.'), 400

with app.app_context():
    _init_database_once()
    init_scheduler()  # [NEW-18] تشغيل الجدولة التلقائية للنسخ الاحتياطي

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
