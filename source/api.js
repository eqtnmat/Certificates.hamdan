/**
 * مكتب الشهادات والتوصيات — Cloudflare Worker
 * Student portal + API. Needs one D1 binding named DB (database: certs-office).
 * Stores short text only: accounts, requests, approved wording. No files.
 */

const STUDENT_HTML = __STUDENT_HTML__;
const REMINDER_COOLDOWN_MS = 24 * 3600 * 1000;
const SESSION_DAYS = 30;
const PBKDF2_ITER = 10000;

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/' || p === '/index.html'))
        return new Response(STUDENT_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' } });
      if (req.method === 'GET' && p.startsWith('/v/')) return verifyPage(env, decodeURIComponent(p.slice(3)));
      if (req.method === 'GET' && p.startsWith('/brand/')) return brandImage(env, p.split('/')[2], p.split('/')[3]);
      if (req.method === 'GET' && p.startsWith('/doclogo/')) return docLogo(req, env, decodeURIComponent(p.split('/')[2]));
      if (p.startsWith('/api/')) return await routeApi(req, env, p.slice(5));
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return J({ ok: false, error: 'خطأ في الخادم، حاول مرة ثانية.' }, 500);
    }
  }
};

/* ---------------- helpers ---------------- */
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const now = () => Date.now();
const str = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 4000);
const normUser = u => String(u || '').trim().toLowerCase();
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const pj = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
function rid(n = 16) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function body(req) { try { return await req.json(); } catch (e) { return {}; } }
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITER }, k, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function safeEq(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function validPhoto(ph) { return typeof ph === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(ph) && ph.length < 80000; }

async function newSession(env, username) {
  const token = rid(24);
  await env.DB.prepare('INSERT INTO sessions (token, username, expires) VALUES (?, ?, ?)').bind(token, username, now() + SESSION_DAYS * 864e5).run();
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()).run();
  return token;
}
async function authUser(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const s = await env.DB.prepare('SELECT username, expires FROM sessions WHERE token = ?').bind(token).first();
  if (!s || s.expires < now()) return null;
  return env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(s.username).first();
}
const profile = u => ({ username: u.username, name: u.name, email: u.email, photo: u.photo || '' });

function publicItem(r) {
  const input = pj(r.input, {});
  delete input.cvText;
  const fin = pj(r.final, null);
  return {
    id: r.id, type: r.type, status: r.status, createdAt: r.created_at || 0, updatedAt: r.updated_at || 0,
    name: r.name, contactEmail: r.contact_email, gender: r.gender, lang: r.lang, input,
    advisorNote: r.advisor_note || '', studentNote: r.student_note || '',
    approvedAt: r.approved_at || 0, sentAt: r.sent_at || 0, sentTo: r.sent_to || '',
    title: fin && fin.fields ? fin.fields.title : '', program: fin && fin.fields ? fin.fields.program : '',
    reminders: r.reminders || 0, nextReminderAt: r.last_reminder_at ? r.last_reminder_at + REMINDER_COOLDOWN_MS : 0
  };
}
async function listMine(env, username) {
  const { results } = await env.DB.prepare('SELECT * FROM requests WHERE username = ? ORDER BY created_at DESC LIMIT 200').bind(username).all();
  return results.map(publicItem);
}
async function templates(env) {
  const { results } = await env.DB.prepare('SELECT id, label, description, lang, fields FROM templates WHERE active = 1 ORDER BY created_at DESC').all();
  return results.map(t => ({ id: t.id, label: t.label, description: t.description || '', lang: t.lang === 'ar' ? 'ar' : 'en', fields: pj(t.fields, {}) }));
}
function addLog(r, kind, text) {
  const log = pj(r.log, []);
  log.push({ t: now(), by: 'student', kind, text: text || '' });
  return JSON.stringify(log.slice(-40));
}

/* ---------------- API ---------------- */
async function routeApi(req, env, path) {
  const m = req.method;
  if (m === 'POST' && path === 'register') return register(env, await body(req));
  if (m === 'POST' && path === 'login') return login(env, await body(req));
  if (m === 'POST' && path === 'reset') return reset(env, await body(req));

  const u = await authUser(req, env);
  if (!u) return J({ ok: false, error: 'سجّل الدخول من جديد.' }, 401);

  if (m === 'POST' && path === 'logout') {
    const t = (req.headers.get('authorization') || '').slice(7);
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(t).run();
    return J({ ok: true });
  }
  if (m === 'GET' && path === 'me') return J({ ok: true, profile: profile(u), items: await listMine(env, u.username), templates: await templates(env) });
  if (m === 'POST' && path === 'photo') {
    const b = await body(req);
    if (!validPhoto(b.photo)) return J({ ok: false, error: 'الصورة غير صالحة أو كبيرة.' });
    await env.DB.prepare('UPDATE users SET photo = ? WHERE username = ?').bind(b.photo, u.username).run();
    return J({ ok: true, profile: { ...profile(u), photo: b.photo } });
  }
  if (m === 'POST' && path === 'requests') return createRequest(env, u, await body(req));

  const mm = path.match(/^requests\/([A-Za-z0-9-]+)(?:\/(remind|message|document))?$/);
  if (mm) {
    const r = await env.DB.prepare('SELECT * FROM requests WHERE id = ? AND username = ?').bind(mm[1], u.username).first();
    if (!r) return J({ ok: false, error: 'الطلب غير موجود.' }, 404);
    const act = mm[2];
    if (!act && m === 'PUT') return updateRequest(env, u, r, await body(req));
    if (act === 'remind' && m === 'POST') return remind(env, u, r);
    if (act === 'message' && m === 'POST') return message(env, u, r, await body(req));
    if (act === 'document' && m === 'GET') return documentFor(env, r, new URL(req.url).origin);
  }
  return J({ ok: false, error: 'طلب غير معروف.' }, 404);
}

async function register(env, b) {
  const username = normUser(b.username);
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return J({ ok: false, error: 'اسم المستخدم من 3 إلى 30 حرف إنجليزي أو رقم (مسموح . _ -).' });
  const name = str(b.name, 160);
  if (!name) return J({ ok: false, error: 'اكتب اسمك الكامل.' });
  const email = normEmail(b.email);
  if (!validEmail(email)) return J({ ok: false, error: 'اكتب إيميل صحيح.' });
  if (String(b.password || '').length < 8) return J({ ok: false, error: 'كلمة المرور لازم تكون 8 أحرف أو أكثر.' });
  if (!validPhoto(b.photo)) return J({ ok: false, error: 'أرفق صورتك الشخصية عشان يتعرف عليك المرشد.' });
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) return J({ ok: false, error: 'اسم المستخدم مستخدم، اختر اسم ثاني.' });
  const salt = rid(12);
  await env.DB.prepare('INSERT INTO users (username, name, email, photo, pass_hash, salt, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(username, name, email, b.photo, await hashPw(String(b.password), salt), salt, now(), now()).run();
  return J({ ok: true, token: await newSession(env, username) });
}

async function login(env, b) {
  const username = normUser(b.username);
  const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (u && u.locked_until > now()) return J({ ok: false, error: 'محاولات كثيرة. حاول بعد 15 دقيقة.' });
  if (!u || !safeEq(await hashPw(String(b.password || ''), u.salt), u.pass_hash)) {
    if (u) {
      const fails = (u.fails || 0) + 1;
      await env.DB.prepare('UPDATE users SET fails = ?, locked_until = ? WHERE username = ?').bind(fails >= 8 ? 0 : fails, fails >= 8 ? now() + 15 * 60000 : 0, username).run();
    }
    return J({ ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
  }
  await env.DB.prepare('UPDATE users SET fails = 0, locked_until = 0, last_login = ? WHERE username = ?').bind(now(), username).run();
  return J({ ok: true, token: await newSession(env, username) });
}

/** The advisor creates a 6-digit reset code from the dashboard and gives it to the student. */
async function reset(env, b) {
  const username = normUser(b.username);
  const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!u || !u.reset_code || (u.reset_expires || 0) < now() || u.locked_until > now()) return J({ ok: false, error: 'الرمز غير صالح أو منتهي. اطلب رمز جديد من المرشد.' });
  if (!safeEq(String(b.code || '').trim(), u.reset_code)) {
    const fails = (u.fails || 0) + 1;
    await env.DB.prepare('UPDATE users SET fails = ?, locked_until = ? WHERE username = ?').bind(fails >= 8 ? 0 : fails, fails >= 8 ? now() + 15 * 60000 : 0, username).run();
    return J({ ok: false, error: 'الرمز غير صحيح.' });
  }
  if (String(b.password || '').length < 8) return J({ ok: false, error: 'كلمة المرور لازم تكون 8 أحرف أو أكثر.' });
  const salt = rid(12);
  await env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ?, reset_code = NULL, reset_expires = NULL, fails = 0, locked_until = 0, last_login = ? WHERE username = ?')
    .bind(await hashPw(String(b.password), salt), salt, now(), username).run();
  await env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(username).run();
  return J({ ok: true, token: await newSession(env, username) });
}

function common(b) {
  const name = str(b.name, 160);
  if (!name) throw new Error('اكتب اسمك مثل ما تبيه يطلع في الوثيقة.');
  const contact = normEmail(b.contactEmail);
  if (!validEmail(contact)) throw new Error('اكتب إيميل تواصل صحيح.');
  return { name, contact, gender: b.gender === 'f' ? 'f' : 'm', lang: b.lang === 'ar' ? 'ar' : 'en' };
}
async function cleanInput(env, type, b) {
  const i = {};
  if (type === 'cert' && b.templateId) {
    const t = await env.DB.prepare('SELECT * FROM templates WHERE id = ? AND active = 1').bind(String(b.templateId)).first();
    if (!t) throw new Error('هذا النموذج غير متاح الآن.');
    const f = pj(t.fields, {});
    Object.assign(i, { templateId: t.id, templateLabel: t.label, program: f.program || '', achievement: str(b.achievement, 1500),
      polished: { title: f.title || '', lead: f.lead || '', program: f.program || '', body: f.body || '' }, brand: t.brand || '', lang: t.lang === 'ar' ? 'ar' : 'en' });
    return i;
  }
  if (type === 'cert') {
    Object.assign(i, { program: str(b.program, 300), period: str(b.period, 120), achievement: str(b.achievement, 3000) });
    if (!i.achievement) throw new Error('اكتب الإنجاز اللي قدمته.');
    return i;
  }
  const d = b.delivery || {};
  const mode = ['self', 'email', 'platform'].includes(d.mode) ? d.mode : 'self';
  Object.assign(i, {
    target: str(b.target, 400), relationship: str(b.relationship, 1200), achievements: str(b.achievements, 5000), skills: str(b.skills, 2500),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : '', cvText: str(b.cvText, 15000), cvName: str(b.cvName, 200),
    delivery: { mode, email: normEmail(d.email), platform: str(d.platform, 200), link: str(d.link, 600), notes: str(d.notes, 1200) }
  });
  if (!i.target) throw new Error('اكتب البرنامج أو الوظيفة اللي تقدم عليها.');
  if (!i.cvText && !i.achievements) throw new Error('ارفع سيرتك الذاتية أو اكتب أهم إنجازاتك.');
  if (mode === 'email' && !validEmail(i.delivery.email)) throw new Error('اكتب إيميل الجهة اللي بتنرسل لها الرسالة.');
  if (mode === 'platform' && !i.delivery.platform) throw new Error('اكتب اسم المنصة.');
  return i;
}

async function createRequest(env, u, b) {
  try {
    const type = b.type === 'rec' ? 'rec' : 'cert';
    const c = common(b);
    const input = await cleanInput(env, type, b);
    if (input.lang) c.lang = input.lang;
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE username = ? AND status IN ('submitted','needs_info','edit_requested')").bind(u.username).first();
    if (open.n >= 10) throw new Error('عندك طلبات مفتوحة كثيرة. انتظر المرشد يراجعها.');
    const d = new Date(); const ymd = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
    const id = (type === 'cert' ? 'C' : 'R') + '-' + ymd + '-' + rid(2).toUpperCase();
    const t = now();
    await env.DB.prepare('INSERT INTO requests (id, username, type, status, created_at, updated_at, name, contact_email, gender, lang, input, reminders, log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .bind(id, u.username, type, 'submitted', t, t, c.name, c.contact, c.gender, c.lang, JSON.stringify(input), JSON.stringify([{ t, by: 'student', kind: 'submit' }])).run();
    return J({ ok: true, id, items: await listMine(env, u.username) });
  } catch (e) { return J({ ok: false, error: e.message }); }
}

async function updateRequest(env, u, r, b) {
  try {
    if (!['submitted', 'needs_info'].includes(r.status)) throw new Error('ما تقدر تعدل الطلب بعد ما انعتمد. استخدم "طلب تعديل".');
    const c = common(b);
    const input = await cleanInput(env, r.type, b);
    if (input.lang) c.lang = input.lang;
    const note = str(b.note, 1500) || 'عدّل الطالب بيانات الطلب.';
    await env.DB.prepare('UPDATE requests SET name = ?, contact_email = ?, gender = ?, lang = ?, input = ?, status = ?, student_note = ?, updated_at = ?, log = ? WHERE id = ?')
      .bind(c.name, c.contact, c.gender, c.lang, JSON.stringify(input), 'submitted', note, now(), addLog(r, 'update', note), r.id).run();
    return J({ ok: true, items: await listMine(env, u.username) });
  } catch (e) { return J({ ok: false, error: e.message }); }
}

async function remind(env, u, r) {
  if (['approved', 'rejected'].includes(r.status)) return J({ ok: false, error: 'الطلب منتهي، ما يحتاج تذكير.' });
  if (r.last_reminder_at && now() - r.last_reminder_at < REMINDER_COOLDOWN_MS) return J({ ok: false, error: 'أرسلت تذكير قريب. تقدر ترسل تذكير ثاني بعد 24 ساعة.' });
  await env.DB.prepare('UPDATE requests SET reminders = COALESCE(reminders,0) + 1, last_reminder_at = ?, updated_at = ?, log = ? WHERE id = ?').bind(now(), now(), addLog(r, 'reminder'), r.id).run();
  return J({ ok: true, items: await listMine(env, u.username) });
}

async function message(env, u, r, b) {
  const text = str(b.text, 1500);
  if (!text) return J({ ok: false, error: 'اكتب التعديل اللي تبيه.' });
  const status = ['approved', 'rejected'].includes(r.status) ? 'edit_requested' : r.status;
  await env.DB.prepare('UPDATE requests SET student_note = ?, status = ?, updated_at = ?, log = ? WHERE id = ?').bind(text, status, now(), addLog(r, 'edit_request', text), r.id).run();
  return J({ ok: true, items: await listMine(env, u.username) });
}

/** The approved wording + brand, so the student's browser can build the PDF. */
async function documentFor(env, r, origin) {
  if (r.status !== 'approved' || !r.final) return J({ ok: false, error: 'الوثيقة غير جاهزة بعد.' });
  const f = pj(r.final, {});
  const row = await env.DB.prepare('SELECT data FROM brands WHERE id = ?').bind(f.brandId || '').first();
  const b = pj(row && row.data, {});
  const brand = { ...b };
  for (const k of ['logoTop', 'logoBottom', 'signature']) brand[k] = b[k] ? origin + '/brand/' + encodeURIComponent(f.brandId) + '/' + k : '';
  return J({ ok: true, doc: {
    type: r.type, lang: r.lang, gender: r.gender, name: f.name || r.name, fields: f.fields || {}, letter: f.letter || '',
    brand, extraLogo: f.extraLogo ? origin + '/doclogo/' + encodeURIComponent(r.id) : '', date: r.approved_at, ref: r.id
  } });
}

function dataUriResponse(uri) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(String(uri || ''));
  if (!m) return new Response('Not found', { status: 404 });
  const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': m[1], 'cache-control': 'public, max-age=3600' } });
}
async function brandImage(env, id, key) {
  if (!['logoTop', 'logoBottom', 'signature'].includes(key)) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare('SELECT data FROM brands WHERE id = ?').bind(decodeURIComponent(id || '')).first();
  return dataUriResponse(pj(row && row.data, {})[key]);
}
async function docLogo(req, env, id) {
  const r = await env.DB.prepare("SELECT final FROM requests WHERE id = ? AND status = 'approved'").bind(id).first();
  return dataUriResponse(pj(r && r.final, {}).extraLogo);
}

/* ---------------- public verification page ---------------- */
async function verifyPage(env, id) {
  const r = /^[A-Za-z0-9-]{4,40}$/.test(id) ? await env.DB.prepare('SELECT id, type, status, name, final, approved_at FROM requests WHERE id = ?').bind(id).first() : null;
  const ok = r && r.status === 'approved';
  const f = ok ? pj(r.final, {}) : {};
  const row = ok ? await env.DB.prepare('SELECT data FROM brands WHERE id = ?').bind(f.brandId || '').first() : null;
  const b = pj(row && row.data, {});
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const d = ok ? new Date(r.approved_at) : null;
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>التحقق من وثيقة</title>
<style>:root{--bg:#F4F5F2;--s:#fff;--i:#2C2A21;--m:#6C6A5B;--ok:#1F7A4A;--okb:#E2F1E8;--bad:#A23A2E;--badb:#F7E2DE;--fr:#4B4733}
@media (prefers-color-scheme:dark){:root{--bg:#16160F;--s:#201F17;--i:#ECEADF;--m:#A6A392;--ok:#73D19D;--okb:#163223;--bad:#F0948A;--badb:#3A1C18;--fr:#BDB58E;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--i);font:16px/1.6 Tahoma,"Segoe UI",sans-serif}main{max-width:520px;margin:40px auto;padding:0 16px}
.c{background:var(--s);border:3px double var(--fr);padding:24px;display:flex;flex-direction:column;gap:12px}.b{padding:8px 12px;border-radius:8px;font-weight:700}
.ok{background:var(--okb);color:var(--ok)}.no{background:var(--badb);color:var(--bad)}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}dt{color:var(--m)}dd{margin:0}</style></head>
<body><main><div class="c"><h1 style="margin:0;font-size:20px">التحقق من وثيقة</h1>
${ok ? `<div class="b ok">وثيقة صحيحة ومعتمدة</div><dl><dt>الرقم</dt><dd>${e(r.id)}</dd><dt>النوع</dt><dd>${r.type === 'rec' ? 'رسالة توصية' : e((f.fields || {}).title || 'شهادة')}</dd>
<dt>باسم</dt><dd>${e(f.name || r.name)}</dd>${r.type !== 'rec' && f.fields && f.fields.program ? `<dt>البرنامج</dt><dd>${e(f.fields.program)}</dd>` : ''}
<dt>أصدرها</dt><dd>${e(b.signatory_en || '')}${b.role_en ? ' — ' + e(b.role_en) : ''}</dd><dt>تاريخ الاعتماد</dt><dd>${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}</dd></dl>`
      : `<div class="b no">ما لقينا وثيقة معتمدة بهذا الرقم</div><p style="margin:0;color:var(--m)">تأكد من الرقم المكتوب أسفل الوثيقة.</p>`}
</div></main></body></html>`;
  return new Response(html, { status: ok ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
