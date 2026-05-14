/**
 * StudyCapital Cloudflare Worker — v2.1 (Security Hardened)
 * ─────────────────────────────────────────────────────────────────────────────
 * Changes from v2.0:
 *   ✅ Server-side honeypot field check (bot protection)
 *   ✅ Stricter Origin + Referer validation (CSRF protection)
 *   ✅ Input length caps (prevents oversized payloads)
 *   ✅ Improved rate limiter: per-IP sliding window (5 req / 10 min)
 *   ✅ WhatsApp + Telegram + Email notifications
 *   ✅ D1 insert error is non-fatal (notifications still send)
 *   ✅ PATCH supports all editable lead fields
 *
 * Environment Variables (Cloudflare Dashboard → Worker → Settings → Variables):
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY
 *   CRM_SECRET             — Secret token for CRM (min 16 chars)
 *   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_RECIPIENT
 */

const ALLOWED_ORIGINS = [
  'https://www.studycapital.in',
  'https://studycapital.in',
];

function isAllowedOrigin(o) { return ALLOWED_ORIGINS.includes(o); }

function getCorsHeaders(requestOrigin) {
  const origin = isAllowedOrigin(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CRM-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, requestOrigin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(requestOrigin), 'Content-Type': 'application/json' },
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Rate limiter ───────────────────────────────────────────────────────────
const ipSubmitMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const WINDOW = 10 * 60 * 1000;
  const entry  = ipSubmitMap.get(ip) || [];
  const recent = entry.filter(t => now - t < WINDOW);
  if (recent.length >= 5) return true;
  ipSubmitMap.set(ip, [...recent, now]);
  return false;
}

// ── Validation ─────────────────────────────────────────────────────────────
const PHONE_RE = /^[\+\d\s\-\(\)]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const XSS_RE   = /<script|javascript:|on\w+=/i;

function validateLead(p) {
  const errors = [];
  const name  = (p['Full Name'] || '').trim();
  const phone = (p['Phone']     || '').trim();
  const email = (p['Email']     || '').trim();
  if (!name || name.length < 2)        errors.push('Full name is required');
  if (name.length > 100)               errors.push('Full name too long');
  if (!phone)                          errors.push('Phone number is required');
  if (!PHONE_RE.test(phone))           errors.push('Invalid phone number');
  if (email && !EMAIL_RE.test(email))  errors.push('Invalid email format');
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string') {
      if (XSS_RE.test(v))  errors.push(`Invalid characters in ${k}`);
      if (v.length > 2000) errors.push(`${k} is too long`);
    }
  }
  return errors;
}

// ── WhatsApp ───────────────────────────────────────────────────────────────
function buildWhatsAppMessage(lead) {
  return [
    `🎓 *New Lead — StudyCapital*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `👤 *Name:* ${lead.name}`,
    `📱 *Phone:* ${lead.phone}`,
    lead.email       ? `📧 *Email:* ${lead.email}`             : null,
    lead.city        ? `🏙️ *City:* ${lead.city}`               : null,
    `💰 *Loan Type:* ${lead.loanType}`,
    lead.loanAmount  ? `💵 *Amount:* ${lead.loanAmount}`       : null,
    lead.course      ? `📚 *Course:* ${lead.course}`           : null,
    lead.destination ? `✈️ *Destination:* ${lead.destination}` : null,
    lead.message     ? `💬 *Message:* ${lead.message}`         : null,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🕐 *Time:* ${new Date(lead.createdAt).toLocaleString('en-IN', { timeZone:'Asia/Kolkata' })}`,
    `🔗 *Source:* ${lead.source}`,
    `🆔 *Lead ID:* ${lead.id}`,
  ].filter(Boolean).join('\n');
}

async function sendWhatsApp(env, message) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID || !env.WHATSAPP_RECIPIENT)
    return { ok: false, error: 'WhatsApp env vars not set' };
  const to = env.WHATSAPP_RECIPIENT.replace(/[^0-9]/g, '');
  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.WHATSAPP_TOKEN}` },
      body: JSON.stringify({ messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text:{ preview_url:false, body:message } }),
    });
    const data = await res.json();
    if (data.error) return { ok:false, error:`(#${data.error.code}) ${data.error.message}` };
    return { ok:true, message_id: data.messages?.[0]?.id };
  } catch (err) { return { ok:false, error:err.message }; }
}

// ── Router ─────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    if (method === 'OPTIONS') return new Response(null, { status:204, headers:getCorsHeaders(origin) });

    // CSRF guard for mutating public endpoint
    if (method === 'POST' && url.pathname === '/') {
      const referer = request.headers.get('Referer') || '';
      const ok = isAllowedOrigin(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
      if (!ok) return json({ ok:false, error:'Forbidden' }, 403, origin);
    }

    if (method === 'POST' && url.pathname === '/')               return handleFormSubmit(request, env, origin);
    if (method === 'GET'  && url.pathname === '/leads')          return handleGetLeads(request, env, origin);
    if (method === 'PATCH'  && url.pathname.startsWith('/leads/')) return handleUpdateLead(request, env, url.pathname.split('/')[2], origin);
    if (method === 'DELETE' && url.pathname.startsWith('/leads/')) return handleDeleteLead(request, env, url.pathname.split('/')[2], origin);

    return json({ error:'Not found' }, 404, origin);
  },
};

// ── Form submission ────────────────────────────────────────────────────────
async function handleFormSubmit(request, env, origin) {
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(clientIP))
    return json({ ok:false, errors:['Too many submissions. Try again in 10 minutes.'] }, 429, origin);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, errors:['Invalid JSON body'] }, 400, origin); }

  const { emailParams = {}, telegramMessage = '', honeypot = '' } = body;

  // Server-side honeypot
  if (honeypot && honeypot.trim().length > 0)
    return json({ ok:true, id:uid(), errors:[] }, 200, origin);

  const validationErrors = validateLead(emailParams);
  if (validationErrors.length) return json({ ok:false, errors:validationErrors }, 400, origin);

  const lead = {
    id:          uid(),
    name:        emailParams['Full Name'].trim().slice(0,100),
    phone:       emailParams['Phone'].trim().slice(0,20),
    email:       (emailParams['Email']       || '').trim().slice(0,200),
    city:        (emailParams['City']        || '').trim().slice(0,100),
    loanType:    (emailParams['Loan Type']   || 'International').slice(0,50),
    loanAmount:  (emailParams['Loan Amount'] || '').slice(0,50),
    course:      (emailParams['Course']      || '').slice(0,200),
    destination: emailParams['Loan Type']?.startsWith('Study in')
                   ? emailParams['Loan Type'].replace('Study in ','').slice(0,100)
                   : (emailParams['Destination'] || '').slice(0,100),
    source:      'Website',
    status:      'New',
    assignedTo:  '',
    followup:    '',
    message:     (emailParams['Message'] || '').slice(0,1000),
    notes:       '[]',
    createdAt:   new Date().toISOString(),
  };

  const errors = [];

  // 1. D1
  try {
    await env.DB.prepare(`
      INSERT INTO leads (id,name,phone,email,city,loanType,loanAmount,course,
        destination,source,status,assignedTo,followup,message,notes,createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      lead.id, lead.name, lead.phone, lead.email, lead.city,
      lead.loanType, lead.loanAmount, lead.course, lead.destination,
      lead.source, lead.status, lead.assignedTo, lead.followup,
      lead.message, lead.notes, lead.createdAt
    ).run();
  } catch (err) {
    console.error('D1 insert error:', err.message);
    errors.push('db_error: ' + err.message);
  }

  // 2. WhatsApp
  const waResult = await sendWhatsApp(env, buildWhatsAppMessage(lead));
  if (!waResult.ok) errors.push('whatsapp_error: ' + waResult.error);

  // 3. Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID && telegramMessage) {
    try {
      const tRes = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ chat_id:env.TELEGRAM_CHAT_ID, text:telegramMessage, parse_mode:'Markdown' }) }
      );
      const tData = await tRes.json();
      if (!tData.ok) errors.push('telegram_error: ' + tData.description);
    } catch (err) { errors.push('telegram_fetch_error: ' + err.message); }
  }

  // 4. EmailJS
  if (env.EMAILJS_SERVICE_ID && env.EMAILJS_TEMPLATE_ID && env.EMAILJS_PUBLIC_KEY) {
    try {
      const eRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          service_id: env.EMAILJS_SERVICE_ID,
          template_id: env.EMAILJS_TEMPLATE_ID,
          user_id: env.EMAILJS_PUBLIC_KEY,
          template_params: emailParams,
        }),
      });
      if (!eRes.ok) errors.push('emailjs_error: ' + await eRes.text());
    } catch (err) { errors.push('emailjs_fetch_error: ' + err.message); }
  }

  return json({ ok:true, id:lead.id, errors }, 200, origin);
}

// ── Get leads ──────────────────────────────────────────────────────────────
async function handleGetLeads(request, env, origin) {
  if (request.headers.get('X-CRM-Secret') !== env.CRM_SECRET)
    return json({ ok:false, error:'Unauthorized' }, 401, origin);
  try {
    const result = await env.DB.prepare('SELECT * FROM leads ORDER BY createdAt DESC').all();
    const leads = (result.results||[]).map(l => ({
      ...l,
      notes: (() => { try { return JSON.parse(l.notes||'[]'); } catch { return []; } })(),
    }));
    return json({ ok:true, leads }, 200, origin);
  } catch (err) { return json({ ok:false, error:err.message }, 500, origin); }
}

// ── Update lead ────────────────────────────────────────────────────────────
async function handleUpdateLead(request, env, id, origin) {
  if (request.headers.get('X-CRM-Secret') !== env.CRM_SECRET)
    return json({ ok:false, error:'Unauthorized' }, 401, origin);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok:false, error:'Invalid JSON' }, 400, origin); }

  if (body.notes && Array.isArray(body.notes)) body.notes = JSON.stringify(body.notes);

  const allowed = ['name','phone','email','city','loanType','loanAmount','course',
    'destination','source','status','assignedTo','followup','message','notes'];
  const fields = Object.keys(body).filter(k => allowed.includes(k));
  if (!fields.length) return json({ ok:false, error:'No valid fields' }, 400, origin);

  try {
    await env.DB.prepare(`UPDATE leads SET ${fields.map(f=>`${f} = ?`).join(', ')} WHERE id = ?`)
      .bind(...fields.map(f => body[f]), id).run();
    return json({ ok:true }, 200, origin);
  } catch (err) { return json({ ok:false, error:err.message }, 500, origin); }
}

// ── Delete lead ────────────────────────────────────────────────────────────
async function handleDeleteLead(request, env, id, origin) {
  if (request.headers.get('X-CRM-Secret') !== env.CRM_SECRET)
    return json({ ok:false, error:'Unauthorized' }, 401, origin);
  try {
    await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
    return json({ ok:true }, 200, origin);
  } catch (err) { return json({ ok:false, error:err.message }, 500, origin); }
}
