/**
 * StudyCapital Cloudflare Worker — v5.6
 * ─────────────────────────────────────────────────────────────────────────────
 * v5.6 (2026-10-29): student WhatsApp variables are configurable via WHATSAPP_STUDENT_FIELDS
 *   (default "name,topic"; e.g. "name,topic,id" for a template that also shows a reference number).
 * v5.5 (2026-10-29): student side
 *   ✅ The student's EmailJS auto-reply now writes a log line (sent OK / skipped
 *      and why / failed) — before, it was silent, so failures were invisible.
 *   ✅ OPTIONAL WhatsApp confirmation to the student. OFF by default; switched on
 *      by setting WHATSAPP_STUDENT_TEMPLATE to an approved template name. The
 *      template takes 2 variables: {{1}} student name, {{2}} what they asked about.
 *      Only the template is tried — plain text is never used for students.
 * v5.4 (2026-10-25): WhatsApp now matches the existing approved template "new_lead_alert"
 *   (image header + 11 variables) — see WHATSAPP_LEAD_FIELDS / WHATSAPP_LEAD_HEADER_IMAGE below.
 * v5.3 (2026-10-22):
 *   ✅ WhatsApp now sends an APPROVED TEMPLATE message (falls back to plain
 *      text if the template fails). Meta blocks plain "text" messages unless
 *      the recipient messaged your business number in the last 24 hours, which
 *      is why lead alerts never arrived. Templates are not subject to that rule.
 *   ✅ Every lead is now also pushed to the new CRM (crm.studycapital.in)
 *      through /api/webhooks/website-leads, in the background (waitUntil), so a
 *      CRM problem can never slow down or break the visitor's form.
 *   ✅ Telegram alert is built on the server (not taken from the browser) and
 *      is re-sent as plain text if Telegram rejects the Markdown formatting
 *      (a lead typing * or _ in the message used to make Telegram fail).
 *   ✅ The API response no longer includes your WhatsApp numbers or raw
 *      provider error details — long digit strings are masked.
 *   ✅ GET requests no longer crash when the Worker has no ASSETS binding.
 *   ✅ Cron follow-up reminders use a template too.
 *   ✅ Matches your EXISTING approved template "new_lead_alert" (image header +
 *      11 variables: name, phone, email, loan type, amount, course, destination,
 *      message, time, source, lead ID). The variable list/order can be changed
 *      without code via WHATSAPP_LEAD_FIELDS, and the header image via
 *      WHATSAPP_LEAD_HEADER_IMAGE (must be a public PNG/JPG URL).
 *   New settings:  WHATSAPP_LEAD_TEMPLATE (default new_lead_alert),
 *                  WHATSAPP_REMINDER_TEMPLATE (default lead_reminder),
 *                  WHATSAPP_TEMPLATE_LANG (default en),
 *                  CRM_URL (default https://crm.studycapital.in),
 *                  CRM_LEADS_KEY (secret — same value as WEBSITE_LEADS_KEY on the CRM)
 *
 * FIX v5.2 (2026-08-18) — WhatsApp/Telegram notifications not arriving:
 *   ✅ Telegram was previously wired as a FALLBACK that only ran when
 *      WhatsApp's send failed — it could never fire as its own channel.
 *      If WhatsApp and Telegram were both misconfigured (or WhatsApp failed
 *      for any reason), NEITHER notification went out, while EmailJS kept
 *      working because it was never gated on the other two. WhatsApp and
 *      Telegram now send independently, in parallel, every time.
 *   ✅ WhatsApp/Telegram/EmailJS failures were pushed into an `errors` array
 *      in the API response but were NEVER printed to console — so nothing
 *      showed up in Cloudflare's real-time logs. Added console.error/log for
 *      every channel (including partial WhatsApp failures across recipients,
 *      which were previously dropped entirely if at least one number worked).
 *   ℹ️  `ok: true` in the response is intentionally left as-is — it reflects
 *      "the lead was captured," not "every notification channel succeeded."
 *      A WhatsApp/Telegram outage on our end must never show a real customer
 *      a false "submission failed" error. Check `errors` / the Worker logs
 *      to monitor channel health instead.
 *   → Most likely root cause of the original outage: WHATSAPP_TOKEN /
 *     TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing or invalid in the
 *     Worker's Settings → Variables, OR WhatsApp hit Meta's 24-hour
 *     session-messaging window (this sends a free-form `type: 'text'`
 *     message, which Meta blocks outside an open customer conversation —
 *     see notes near sendWhatsApp()). Check the Worker logs after a test
 *     submission to confirm which it is.
 *
 * FIX v5.1 (2026-06-01):
 *   ✅ CRITICAL: Fixed GET routing — now serves ALL static assets via env.ASSETS,
 *      not just '/' and '*.html'. Previously all directory-based page paths
 *      (e.g. /education-loan-delhi/) returned a JSON 404, causing 35+ redirect
 *      errors and 404s in Google Search Console.
 *   ✅ Google Maps API key injection now applies to ALL HTML responses (not just '/')
 *   ✅ leads_v3.html access restricted via worker (returns 403 to bots)
 *
 * Changes from v5.0: only the fetch() router is modified. All other logic is unchanged.
 *
 * Environment Variables (Cloudflare Dashboard → Worker → Settings → Variables):
 *   WHATSAPP_TOKEN          — Meta permanent system user token
 *   WHATSAPP_PHONE_ID       — Meta Phone ID (e.g. 1146151658573233)
 *   WHATSAPP_RECIPIENTS     — Comma-separated numbers e.g. "919811419910,919654097708"
 *   TELEGRAM_BOT_TOKEN      — Telegram bot token
 *   TELEGRAM_CHAT_ID        — Telegram chat/group ID
 *   EMAILJS_SERVICE_ID      — EmailJS service ID
 *   EMAILJS_TEMPLATE_ID     — EmailJS admin notification template ID
 *   EMAILJS_AUTOREPLY_TEMPLATE_ID — EmailJS student auto-reply template ID
 *   EMAILJS_PUBLIC_KEY      — EmailJS public key
 *   EMAILJS_PRIVATE_KEY     — EmailJS private key
 *   CRM_SECRET              — Secret token for CRM endpoints (min 16 chars)
 *   TURNSTILE_SECRET        — Cloudflare Turnstile secret key
 *   INDEXNOW_KEY            — IndexNow key
 *   GOOGLE_PLACES_KEY       — Google Maps / Places API key (injected into HTML)
 */

const ALLOWED_ORIGINS = [
  'https://www.studycapital.in',
  'https://studycapital.in',
];

// Fallback recipients if WHATSAPP_RECIPIENTS env var not set
const WA_FALLBACK_NUMBERS = ['919811419910', '919654097708'];

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

// ── D1-backed Rate Limiter — per-IP sliding window (5 req / 10 min) ──────────
async function isRateLimited(ip, db) {
  const WINDOW = 10 * 60 * 1000;
  const MAX    = 5;
  const now    = Date.now();
  const cutoff = new Date(now - WINDOW).toISOString();

  try {
    const row = await db
      .prepare('SELECT timestamps FROM rate_limits WHERE ip = ?')
      .bind(ip).first();

    const timestamps = row ? JSON.parse(row.timestamps || '[]') : [];
    const recent = timestamps.filter(t => now - t < WINDOW);
    if (recent.length >= MAX) return true;

    const updated = [...recent, now];
    await db.prepare(`
      INSERT INTO rate_limits (ip, timestamps, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET
        timestamps = excluded.timestamps,
        updatedAt  = excluded.updatedAt
    `).bind(ip, JSON.stringify(updated), new Date().toISOString()).run();

    db.prepare('DELETE FROM rate_limits WHERE updatedAt < ?').bind(cutoff).run()
      .catch(e => console.warn('Rate limit cleanup error:', e.message));

    return false;
  } catch (err) {
    console.error('D1 rate limit error:', err.message);
    return false; // fail open
  }
}

// ── Cloudflare Turnstile verification ─────────────────────────────────────
async function verifyTurnstile(token, secret, remoteip) {
  if (!secret) {
    console.warn('TURNSTILE_SECRET not set — skipping (dev mode)');
    return { success: true, skipped: true };
  }
  if (!token || token.trim() === '') {
    return { success: false, error: 'missing-input-response' };
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip }),
      signal: AbortSignal.timeout(5000),
    });
    return await res.json();
  } catch (err) {
    console.error('Turnstile verify error:', err.message);
    return { success: true, error: 'verify_fetch_failed' }; // fail open
  }
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
    `🕐 *Time:* ${new Date(lead.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    `🔗 *Source:* ${lead.source}`,
    `🆔 *Lead ID:* ${lead.id}`,
  ].filter(Boolean).join('\n');
}

// Student's phone as a WhatsApp number (digits, with country code), or null.
function studentWhatsAppNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);          // 09811419926
  if (d.length === 10 && /^[6-9]/.test(d)) return '91' + d;          // plain Indian mobile
  if (d.length >= 11 && d.length <= 15) return d;                    // already has a country code
  return null;
}

// Template variables must be single-line text and can never be empty.
function waParam(s, max = 200) {
  const cleaned = String(s ?? '').replace(/[\r\n\t]+/g, ' | ').replace(/ {2,}/g, ' ').trim().slice(0, max);
  return cleaned || '-';
}

// Hide long digit runs (phone numbers) before anything is returned to the browser.
function redactNumbers(s) {
  return String(s).replace(/\d{10,}/g, '••••');
}

// ── Variables for the approved "new_lead_alert" template ───────────────────
// The template has an image header and these variables, in this order:
//   {{1}} Name  {{2}} Phone  {{3}} Email  {{4}} Loan Type  {{5}} Amount
//   {{6}} Course  {{7}} Destination  {{8}} Message  {{9}} Time  {{10}} Source  {{11}} Lead ID
// If Meta ever answers "(#132000) number of parameters does not match", set the
// Worker variable WHATSAPP_LEAD_FIELDS to the right comma-separated list. Allowed
// names: name, phone, email, city, loanType, loanAmount, course, destination,
// message, time, source, id, details.
const DEFAULT_LEAD_FIELDS = 'name,phone,email,loanType,loanAmount,course,destination,message,time,source,id';
const DEFAULT_LEAD_HEADER_IMAGE = 'https://www.studycapital.in/logo.png';

function leadFieldValue(lead, key) {
  const clean = (v, fallback) => {
    const s = String(v ?? '').trim();
    return !s || s === 'No additional message' || s === 'Not provided' ? fallback : s;
  };
  switch (key) {
    case 'name':        return lead.name;
    case 'phone':       return lead.phone;
    case 'email':       return clean(lead.email, 'Not provided');
    case 'city':        return clean(lead.city, 'Not specified');
    case 'loanType':    return clean(lead.loanType, 'Not specified');
    case 'loanAmount':  return clean(lead.loanAmount, 'Not specified');
    case 'course':      return clean(lead.course, 'Not specified');
    case 'destination': return clean(lead.destination, 'Not specified');
    case 'message':     return clean(lead.message, 'No message provided');
    case 'time':        return new Date(lead.createdAt).toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata', day: 'numeric', month: 'numeric', year: 'numeric',
                          hour: 'numeric', minute: '2-digit', hour12: true });
    case 'source':      return lead.source || 'Website';
    case 'id':          return lead.id;
    case 'topic':       return clean(lead.loanType, 'education loan');
    case 'details':     return [lead.loanType, lead.loanAmount, lead.city, lead.course, lead.message]
                          .filter(v => v && !['Not specified', 'No additional message'].includes(String(v).trim())).join(' · ');
    default:            return '';
  }
}

function leadTemplateParams(lead, env) {
  const keys = String((env && env.WHATSAPP_LEAD_FIELDS) || DEFAULT_LEAD_FIELDS)
    .split(',').map(s => s.trim()).filter(Boolean);
  return keys.map(k => leadFieldValue(lead, k));
}

/**
 * Sends a WhatsApp message to every recipient.
 *
 * Meta only lets a business START a conversation with an APPROVED TEMPLATE.
 * Free-form text works only if the recipient messaged your business number
 * within the last 24 hours (otherwise error 131047). So:
 *   • if `tpl` is given, the template is tried first;
 *   • if that fails (e.g. template not approved yet), plain text is tried as a
 *     fallback — it succeeds whenever the 24-hour window happens to be open.
 */
async function sendWhatsApp(env, text, tpl = null, toNumbers = null) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID)
    return { ok: false, error: 'WhatsApp env vars not set' };

  // Use env var if set, otherwise fall back to hardcoded numbers
  const numbers = (toNumbers && toNumbers.length)
    ? toNumbers
    : env.WHATSAPP_RECIPIENTS
      ? env.WHATSAPP_RECIPIENTS.split(',').map(n => n.trim()).filter(Boolean)
      : WA_FALLBACK_NUMBERS;

  const url = `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_ID}/messages`;

  async function post(payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) return { ok: false, error: `(#${data.error.code}) ${data.error.message}` };
    if (!res.ok)    return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, message_id: data.messages?.[0]?.id };
  }

  const results = await Promise.all(numbers.map(async (to) => {
    try {
      if (tpl && tpl.name) {
        const viaTemplate = await post({
          to,
          type: 'template',
          template: {
            name: tpl.name,
            language: { code: tpl.lang || 'en' },
            components: [
              // A template with an image header must be sent WITH an image.
              ...(tpl.headerImage ? [{ type: 'header', parameters: [{ type: 'image', image: { link: tpl.headerImage } }] }] : []),
              { type: 'body', parameters: tpl.params.map(p => ({ type: 'text', text: waParam(p) })) },
            ],
          },
        });
        if (viaTemplate.ok) return { to, ok: true, via: 'template', message_id: viaTemplate.message_id };

        if (!text) {
          // No plain-text fallback requested (used for messages to students).
          console.error(`WhatsApp template "${tpl.name}" to ${to} failed: ${viaTemplate.error}`);
          return { to, ok: false, error: `template: ${viaTemplate.error}` };
        }
        console.error(`WhatsApp template "${tpl.name}" to ${to} failed: ${viaTemplate.error} — trying plain text`);
        const viaText = await post({ to, type: 'text', text: { preview_url: false, body: text } });
        if (viaText.ok) return { to, ok: true, via: 'text', message_id: viaText.message_id };
        return { to, ok: false, error: `template: ${viaTemplate.error} | text: ${viaText.error}` };
      }

      const r = await post({ to, type: 'text', text: { preview_url: false, body: text } });
      return r.ok ? { to, ok: true, via: 'text', message_id: r.message_id } : { to, ok: false, error: r.error };
    } catch (err) {
      return { to, ok: false, error: err.message };
    }
  }));

  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    // Log every failure, even partial ones (e.g. 1 of 2 numbers rejected).
    console.error('WhatsApp send failures:', failed.map(r => `${r.to}: ${r.error}`).join(' | '));
  }
  if (failed.length === numbers.length)
    return { ok: false, error: failed.map(r => `${r.to}: ${r.error}`).join(' | ') };

  return { ok: true, results };
}

// ── Telegram ───────────────────────────────────────────────────────────────
async function sendTelegram(env, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)
    return { ok: false, error: 'Telegram env vars not set' };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    env.TELEGRAM_CHAT_ID,
          text:       message,
          parse_mode: 'Markdown',
        }),
      }
    );
    const data = await res.json();
    if (!data.ok) {
      // A lead who types * _ [ or ` in their message can make Telegram reject
      // the Markdown. Send it again as plain text rather than losing the alert.
      if (/parse entities/i.test(data.description || '')) {
        const retry = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
          }
        );
        const retryData = await retry.json();
        if (retryData.ok) return { ok: true, plain: true };
        return { ok: false, error: retryData.description };
      }
      return { ok: false, error: data.description };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Router ─────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method;
    const origin = request.headers.get('Origin') || '';

    // ── CORS preflight ────────────────────────────────────────────────────
    if (method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCorsHeaders(origin) });

    // ── API Routes — handle BEFORE static asset fallback ─────────────────

    // POST / — form submission (check CORS origin first)
    if (method === 'POST' && url.pathname === '/') {
      const referer = request.headers.get('Referer') || '';
      const ok = isAllowedOrigin(origin) || ALLOWED_ORIGINS.some(o => referer.startsWith(o));
      if (!ok) return json({ ok: false, error: 'Forbidden' }, 403, origin);
      return handleFormSubmit(request, env, origin, ctx);
    }

    if (method === 'POST'   && url.pathname === '/indexnow')       return handleIndexNow(request, env, origin);
    if (method === 'GET'    && url.pathname === '/leads')          return handleGetLeads(request, env, origin);
    if (method === 'PATCH'  && url.pathname.startsWith('/leads/')) return handleUpdateLead(request, env, url.pathname.split('/')[2], origin);
    if (method === 'DELETE' && url.pathname.startsWith('/leads/')) return handleDeleteLead(request, env, url.pathname.split('/')[2], origin);

    // ── Static Asset Serving ──────────────────────────────────────────────
    // FIX v5.1: Previously only served assets for '/' and '*.html' paths,
    // causing all directory-based pages (/education-loan-delhi/, /emi-calculator/,
    // /robots.txt, /sitemap.xml, etc.) to return a JSON 404. This was the root
    // cause of 35+ redirect errors and 404s in Google Search Console.
    //
    // Now ALL GET requests fall through to env.ASSETS, which correctly resolves
    // /path/ → /path/index.html, serves robots.txt, sitemap.xml, images, etc.
    // Google Maps API key is injected into every HTML response (not just '/').
    if (method === 'GET') {
      // No ASSETS binding => this Worker isn't serving the website files
      // (they're on Pages/cPanel). Answer cleanly instead of crashing.
      if (!env.ASSETS) return json({ error: 'Not found' }, 404, origin);
      const response = await env.ASSETS.fetch(request);
      const contentType = response.headers.get('content-type') || '';

      // Inject Google Maps API key into all HTML responses
      if (contentType.includes('text/html') && env.GOOGLE_PLACES_KEY) {
        let html = await response.text();
        html = html.replace("var API_KEY  = '';", `var API_KEY  = '${env.GOOGLE_PLACES_KEY}';`);
        return new Response(html, { status: response.status, headers: response.headers });
      }

      // Inject Google Maps API key into reviews.js (loaded as external script)
      if (url.pathname === '/reviews.js' && env.GOOGLE_PLACES_KEY) {
        let js = await response.text();
        js = js.replace("var API_KEY  = '';", `var API_KEY  = '${env.GOOGLE_PLACES_KEY}';`);
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Content-Type', 'application/javascript');
        return new Response(js, { status: response.status, headers: newHeaders });
      }

      return response;
    }

    return json({ error: 'Not found' }, 404, origin);
  },

  // ── Cron trigger — runs every 30 minutes ─────────────────────────────────
  // Add to wrangler.toml: [triggers]  crons = ["*/30 * * * *"]
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleFollowUpReminders(env));
  },
};

// ── Follow-up Reminder Cron ────────────────────────────────────────────────
// Finds leads in "New" status for 2+ hours → sends WhatsApp alert → marks lead.
async function handleFollowUpReminders(env) {
  const REMIND_AFTER_MS  = 2 * 60 * 60 * 1000;  // 2 hours
  const REMIND_CUTOFF_MS = 48 * 60 * 60 * 1000; // ignore leads older than 48h
  const REMINDER_MARKER  = '🔔 auto_reminder_sent';

  const now     = Date.now();
  const twoHAgo = new Date(now - REMIND_AFTER_MS).toISOString();
  const cutoff  = new Date(now - REMIND_CUTOFF_MS).toISOString();

  let stuckLeads = [];
  try {
    const result = await env.DB.prepare(`
      SELECT id, name, phone, city, loanType, loanAmount, course,
             destination, source, message, notes, createdAt
      FROM leads
      WHERE status     = 'New'
        AND createdAt <= ?
        AND createdAt >= ?
      ORDER BY createdAt ASC
    `).bind(twoHAgo, cutoff).all();
    stuckLeads = result.results || [];
  } catch (err) {
    console.error('[Cron] D1 query error:', err.message);
    return;
  }

  if (!stuckLeads.length) {
    console.log('[Cron] No uncontacted leads found.');
    return;
  }

  const reminded = [];

  for (const lead of stuckLeads) {
    let notes = [];
    try { notes = JSON.parse(lead.notes || '[]'); } catch { notes = []; }
    if (notes.some(n => n.text?.includes(REMINDER_MARKER))) continue;

    const waitMins = Math.round((now - new Date(lead.createdAt).getTime()) / 60000);
    const waitStr  = waitMins >= 60
      ? `${Math.floor(waitMins / 60)}h ${waitMins % 60}m`
      : `${waitMins} minutes`;

    const waMsg = [
      `🔔 *Uncontacted Lead Alert — StudyCapital*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `⚠️ Waiting *${waitStr}* with no contact.`,
      ``,
      `👤 *Name:* ${lead.name}`,
      `📱 *Phone:* ${lead.phone}`,
      lead.city        ? `🏙️ *City:* ${lead.city}`               : null,
      `💰 *Loan Type:* ${lead.loanType || 'Not specified'}`,
      lead.loanAmount  ? `💵 *Amount:* ${lead.loanAmount}`       : null,
      lead.course      ? `📚 *Course:* ${lead.course}`           : null,
      lead.destination ? `✈️ *Destination:* ${lead.destination}` : null,
      lead.message     ? `💬 *Message:* ${lead.message}`         : null,
      `━━━━━━━━━━━━━━━━━━━━`,
      `📅 *Received:* ${new Date(lead.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      `🆔 *Lead ID:* ${lead.id}`,
      ``,
      `👉 Please contact them immediately!`,
    ].filter(Boolean).join('\n');

    // Approved template body:
    //   Reminder from StudyCapital: the lead {{1}} ({{2}}) has been waiting {{3}}
    //   with no contact. Details: {{4}}. Please follow up now.
    const waResult = await sendWhatsApp(env, waMsg, {
      name:   env.WHATSAPP_REMINDER_TEMPLATE || 'lead_reminder',
      lang:   env.WHATSAPP_TEMPLATE_LANG || 'en',
      params: [lead.name, lead.phone, waitStr, [lead.city, lead.course, lead.message].filter(Boolean).join(' · ')],
    });
    if (!waResult.ok) {
      console.error(`[Cron] WhatsApp failed for ${lead.id}:`, waResult.error);
      continue;
    }

    notes.push({
      text: `${REMINDER_MARKER} — WhatsApp alert sent after ${waitStr} (${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})`,
      date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    });

    try {
      await env.DB.prepare('UPDATE leads SET notes = ? WHERE id = ?')
        .bind(JSON.stringify(notes), lead.id).run();
    } catch (err) {
      console.error(`[Cron] Notes update failed for ${lead.id}:`, err.message);
    }

    reminded.push(lead.name);
    console.log(`[Cron] Reminded: ${lead.name} (${lead.id}) — waited ${waitStr}`);
  }

  // Telegram summary
  if (reminded.length) {
    const summary = [
      `🔔 *Follow-up Reminder Summary*`,
      `Sent *${reminded.length}* WhatsApp alert(s):`,
      ...reminded.map((n, i) => `${i + 1}. ${n}`),
      ``,
      `_Leads waiting 2+ hours in "New" status_`,
    ].join('\n');
    await sendTelegram(env, summary);
  }

  console.log(`[Cron] Done. Reminded: ${reminded.length}/${stuckLeads.length} leads.`);
}

// ── Form submission ────────────────────────────────────────────────────────
async function handleFormSubmit(request, env, origin, ctx) {
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (await isRateLimited(clientIP, env.DB))
    return json({ ok: false, errors: ['Too many submissions. Try again in 10 minutes.'] }, 429, origin);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, errors: ['Invalid JSON body'] }, 400, origin); }

  const {
    emailParams     = {},
    telegramMessage = '',
    honeypot        = '',
    turnstileToken  = '',
  } = body;

  // ── 1. Honeypot ───────────────────────────────────────────────────────────
  if (honeypot && honeypot.trim().length > 0)
    return json({ ok: true, id: uid(), errors: [] }, 200, origin);

  // ── 2. Turnstile ──────────────────────────────────────────────────────────
  const tsResult = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET, clientIP);
  if (!tsResult.success) {
    console.warn('Turnstile failed:', tsResult['error-codes'] || tsResult.error);
    return json({ ok: false, errors: ['Security check failed. Please refresh and try again.'] }, 403, origin);
  }

  // ── 3. Validation ─────────────────────────────────────────────────────────
  const validationErrors = validateLead(emailParams);
  if (validationErrors.length)
    return json({ ok: false, errors: validationErrors }, 400, origin);

  // ── 4. Build lead ─────────────────────────────────────────────────────────
  const lead = {
    id:          uid(),
    name:        emailParams['Full Name'].trim().slice(0, 100),
    phone:       emailParams['Phone'].trim().slice(0, 20),
    email:       (emailParams['Email']       || '').trim().slice(0, 200),
    city:        (emailParams['City']        || '').trim().slice(0, 100),
    loanType:    (emailParams['Loan Type']   || 'International').slice(0, 50),
    loanAmount:  (emailParams['Loan Amount'] || '').slice(0, 50),
    course:      (emailParams['Course']      || '').slice(0, 200),
    destination: emailParams['Loan Type']?.startsWith('Study in')
                   ? emailParams['Loan Type'].replace('Study in ', '').slice(0, 100)
                   : (emailParams['Destination'] || '').slice(0, 100),
    source:      'Website',
    status:      'New',
    assignedTo:  '',
    followup:    '',
    message:     (emailParams['Message'] || '').slice(0, 1000),
    notes:       '[]',
    createdAt:   new Date().toISOString(),
  };

  const errors = [];

  // ── 5. D1 insert ──────────────────────────────────────────────────────────
  try {
    await env.DB.prepare(`
      INSERT INTO leads
        (id, name, phone, email, city, loanType, loanAmount, course,
         destination, source, status, assignedTo, followup, message, notes, createdAt)
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

  // ── 6/7. WhatsApp + Telegram — sent independently, in parallel ───────────
  // CHANGED: Telegram used to fire ONLY when WhatsApp failed (a fallback,
  // not a second channel). That meant if WhatsApp was misconfigured, Telegram
  // was your only signal — and if Telegram was *also* misconfigured, both
  // silently produced nothing while EmailJS (below) kept working, since it
  // was never gated on the other two. Now both always fire, and both log
  // their result to Cloudflare's real-time logs (Worker → Logs) so a failure
  // is visible immediately instead of only inside this response's `errors`.
  const waMessage = buildWhatsAppMessage(lead);
  // Built here on the server (not taken from the browser's `telegramMessage`),
  // so nobody can post arbitrary text into your Telegram through this endpoint.
  const tgMessage = waMessage;

  // ── CRM — pushed in the background so the visitor never waits on it ──────
  const crmTask = pushToCrm(env, lead, emailParams, request.headers.get('Referer') || '');
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(crmTask);
  else await crmTask;

  const [waResult, tgResult] = await Promise.all([
    sendWhatsApp(env, waMessage, {
      name:   env.WHATSAPP_LEAD_TEMPLATE || 'new_lead_alert',
      lang:   env.WHATSAPP_TEMPLATE_LANG || 'en',
      params: leadTemplateParams(lead, env),
      headerImage: env.WHATSAPP_LEAD_HEADER_IMAGE || DEFAULT_LEAD_HEADER_IMAGE,
    }),
    sendTelegram(env, tgMessage),
  ]);

  if (!waResult.ok) {
    console.error(`[Lead ${lead.id}] WhatsApp FAILED:`, waResult.error);
    errors.push('whatsapp_error: ' + waResult.error);
  } else {
    console.log(`[Lead ${lead.id}] WhatsApp sent OK:`, JSON.stringify(waResult.results));
  }

  if (!tgResult.ok) {
    console.error(`[Lead ${lead.id}] Telegram FAILED:`, tgResult.error);
    errors.push('telegram_error: ' + tgResult.error);
  } else {
    console.log(`[Lead ${lead.id}] Telegram sent OK`);
  }

  // ── 8. EmailJS — admin notification ──────────────────────────────────────
  if (env.EMAILJS_SERVICE_ID && env.EMAILJS_TEMPLATE_ID && env.EMAILJS_PUBLIC_KEY) {
    try {
      const eRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:      env.EMAILJS_SERVICE_ID,
          template_id:     env.EMAILJS_TEMPLATE_ID,
          user_id:         env.EMAILJS_PUBLIC_KEY,
          accessToken:     env.EMAILJS_PRIVATE_KEY || undefined,
          template_params: emailParams,
        }),
      });
      if (!eRes.ok) {
        const errText = await eRes.text();
        console.error(`[Lead ${lead.id}] EmailJS admin notification FAILED:`, errText);
        errors.push("emailjs_error: " + errText);
      } else {
        console.log(`[Lead ${lead.id}] EmailJS admin notification sent OK`);
      }
    } catch (err) {
      console.error(`[Lead ${lead.id}] EmailJS admin fetch FAILED:`, err.message);
      errors.push('emailjs_fetch_error: ' + err.message);
    }
  } else {
    console.warn(`[Lead ${lead.id}] EmailJS admin notification SKIPPED — env vars not set`);
  }

  // ── 9. EmailJS — auto-reply to student ───────────────────────────────────
  const studentEmail = emailParams['Email'];
  if (
    env.EMAILJS_SERVICE_ID &&
    env.EMAILJS_AUTOREPLY_TEMPLATE_ID &&
    env.EMAILJS_PUBLIC_KEY &&
    studentEmail &&
    studentEmail !== 'Not provided' &&
    EMAIL_RE.test(studentEmail)
  ) {
    try {
      const arRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id:  env.EMAILJS_SERVICE_ID,
          template_id: env.EMAILJS_AUTOREPLY_TEMPLATE_ID,
          user_id:     env.EMAILJS_PUBLIC_KEY,
          accessToken: env.EMAILJS_PRIVATE_KEY || undefined,
          template_params: {
            student_name:  emailParams['Full Name'],
            student_email: studentEmail,
            loan_type:     emailParams['Loan Type']    || 'Education Loan',
            loan_amount:   emailParams['Loan Amount']  || 'As required',
            course:        emailParams['Course']       || 'Your course',
            submitted_at:  emailParams['Submitted At'] || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            reply_to:      'info@studycapital.in',
          },
        }),
      });
      if (!arRes.ok) {
        const why = await arRes.text();
        console.error(`[Lead ${lead.id}] EmailJS student auto-reply FAILED: ${why.slice(0, 200)}`);
        errors.push('autoreply_error: ' + why);
      } else {
        console.log(`[Lead ${lead.id}] EmailJS student auto-reply sent OK`);
      }
    } catch (err) {
      console.error(`[Lead ${lead.id}] EmailJS student auto-reply FAILED: ${err.message}`);
      errors.push('autoreply_fetch_error: ' + err.message);
    }
  } else {
    const reason = !env.EMAILJS_AUTOREPLY_TEMPLATE_ID ? 'EMAILJS_AUTOREPLY_TEMPLATE_ID not set'
      : (!studentEmail || studentEmail === 'Not provided') ? 'student gave no email'
      : !EMAIL_RE.test(studentEmail) ? 'email address not valid'
      : 'EmailJS env vars not set';
    console.warn(`[Lead ${lead.id}] EmailJS student auto-reply SKIPPED — ${reason}`);
  }

  // ── 10. WhatsApp confirmation to the STUDENT (optional — off unless a template is named) ──
  if (env.WHATSAPP_STUDENT_TEMPLATE) {
    const studentNumber = studentWhatsAppNumber(lead.phone);
    if (!studentNumber) {
      console.warn(`[Lead ${lead.id}] Student WhatsApp SKIPPED — phone number is not a valid mobile number`);
    } else {
      const sw = await sendWhatsApp(env, '', {
        name:   env.WHATSAPP_STUDENT_TEMPLATE,
        lang:   env.WHATSAPP_TEMPLATE_LANG || 'en',
        params: String(env.WHATSAPP_STUDENT_FIELDS || 'name,topic').split(',').map(s => s.trim()).filter(Boolean).map(k => leadFieldValue(lead, k)),
      }, [studentNumber]);
      if (sw.ok) console.log(`[Lead ${lead.id}] Student WhatsApp confirmation sent OK`);
      else { console.error(`[Lead ${lead.id}] Student WhatsApp FAILED: ${sw.error}`); errors.push('student_whatsapp_error: ' + sw.error); }
    }
  }

  // Errors are masked (no phone numbers) — full details are in the Worker logs.
  return json({ ok: true, id: lead.id, errors: errors.map(redactNumbers) }, 200, origin);
}

// ── Push the lead to the CRM ───────────────────────────────────────────────
// Runs in the background (ctx.waitUntil). Never throws: a CRM outage must not
// affect the visitor, the D1 save, or the WhatsApp/Telegram/email alerts.
async function pushToCrm(env, lead, emailParams, referer) {
  if (!env.CRM_LEADS_KEY) {
    console.warn(`[Lead ${lead.id}] CRM push SKIPPED — CRM_LEADS_KEY secret not set`);
    return;
  }
  const base = (env.CRM_URL || 'https://crm.studycapital.in').replace(/\/+$/, '');

  const facts = [
    lead.loanType   && `Loan type: ${lead.loanType}`,
    lead.loanAmount && `Amount: ${lead.loanAmount}`,
    lead.city       && lead.city !== 'Not specified' && `City: ${lead.city}`,
    emailParams['Source'] && `Form: ${emailParams['Source']}`,
  ].filter(Boolean).join(' · ');
  const said = lead.message && lead.message !== 'No additional message' ? `Message: ${lead.message}` : '';

  const payload = {
    leadId:  lead.id,                       // lets the CRM ignore an accidental repeat
    name:    lead.name,
    phone:   lead.phone,
    email:   EMAIL_RE.test(lead.email) ? lead.email : undefined,
    country: lead.destination || undefined,
    course:  lead.course && lead.course !== 'Not specified' ? lead.course : undefined,
    message: [facts, said].filter(Boolean).join('\n').slice(0, 2000),
    page:    referer ? referer.slice(0, 500) : undefined,
  };

  try {
    const res = await fetch(`${base}/api/webhooks/website-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.CRM_LEADS_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) console.log(`[Lead ${lead.id}] CRM push OK`);
    else console.error(`[Lead ${lead.id}] CRM push FAILED (${res.status}):`, (await res.text().catch(() => '')).slice(0, 300));
  } catch (err) {
    console.error(`[Lead ${lead.id}] CRM push FAILED:`, err.message);
  }
}

// ── IndexNow ping ─────────────────────────────────────────────────────────
async function handleIndexNow(request, env, origin) {
  if (request.headers.get('X-CRM-Secret') !== env.CRM_SECRET)
    return json({ ok: false, error: 'Unauthorized' }, 401, origin);

  if (!env.INDEXNOW_KEY)
    return json({ ok: false, error: 'INDEXNOW_KEY secret not configured' }, 500, origin);

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON body' }, 400, origin); }

  const urls = Array.isArray(body.urls) ? body.urls.slice(0, 10000) : [];
  if (!urls.length)
    return json({ ok: false, error: 'Provide at least one URL in the "urls" array' }, 400, origin);

  const invalidUrls = urls.filter(u => {
    try { return !ALLOWED_ORIGINS.some(o => u.startsWith(o)); }
    catch { return true; }
  });
  if (invalidUrls.length)
    return json({ ok: false, error: 'All URLs must be on studycapital.in', invalidUrls }, 400, origin);

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host:        'www.studycapital.in',
        key:         env.INDEXNOW_KEY,
        keyLocation: `https://www.studycapital.in/${env.INDEXNOW_KEY}.txt`,
        urlList:     urls,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 202)
      return json({ ok: true, submitted: urls.length, status: res.status }, 200, origin);
    const text = await res.text().catch(() => '');
    return json({ ok: false, error: `IndexNow responded ${res.status}`, detail: text }, 502, origin);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500, origin);
  }
}

// ── Get leads ──────────────────────────────────────────────────────────────
async function handleGetLeads(request, env, origin) {
  if (request.headers.get('X-CRM-Secret') !== env.CRM_SECRET)
    return json({ ok: false, error: 'Unauthorized' }, 401, origin);
  try {
    const result = await env.DB.prepare(
      'SELECT * FROM leads ORDER BY createdAt DESC'
    ).all();
    const leads = (result.results || []).map(l => ({
      ...l,
      notes: (() => { try { return JSON.parse(l.notes || '[]'); } catch { return []; } })(),
    }));
    return json({ ok: true, leads }, 200, origin);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500, origin);
  }
}

// ── Update lead ────────────────────────────────────────────────────────────
async function handleUpdateLead(request, env, id, origin) {
  if (request.headers.get('X-CRM-Secret') !== env.CRM_SECRET)
    return json({ ok: false, error: 'Unauthorized' }, 401, origin);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON' }, 400, origin); }

  if (body.notes && Array.isArray(body.notes))
    body.notes = JSON.stringify(body.notes);

  const allowed = [
    'name', 'phone', 'email', 'city', 'loanType', 'loanAmount',
    'course', 'destination', 'source', 'status', 'assignedTo',
    'followup', 'message', 'notes',
  ];
  const fields = Object.keys(body).filter(k => allowed.includes(k));
  if (!fields.length) return json({ ok: false, error: 'No valid fields' }, 400, origin);

  try {
    await env.DB.prepare(
      `UPDATE leads SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`
    ).bind(...fields.map(f => body[f]), id).run();
    return json({ ok: true }, 200, origin);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500, origin);
  }
}

// ── Delete lead ────────────────────────────────────────────────────────────
async function handleDeleteLead(request, env, id, origin) {
  if (request.headers.get('X-CRM-Secret') !== env.CRM_SECRET)
    return json({ ok: false, error: 'Unauthorized' }, 401, origin);
  try {
    await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
    return json({ ok: true }, 200, origin);
  } catch (err) {
    return json({ ok: false, error: err.message }, 500, origin);
  }
}
