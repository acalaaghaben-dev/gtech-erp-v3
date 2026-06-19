// ── authMiddleware.js ──────────────────────────────────────
const jwt = require('jsonwebtoken');
const authMiddleware = (roles = []) => (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer '))
    return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
  try {
    const p = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    req.user = p;
    if (roles.length && !roles.includes(p.role))
      return res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
    next();
  } catch {
    res.status(401).json({ error: 'جلسة منتهية. يرجى تسجيل الدخول مجدداً' });
  }
};
module.exports = { authMiddleware };
