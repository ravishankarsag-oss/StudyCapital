// ══════════════════════════════════════════
//  ✅ Secure Form Handler
//  All credentials live in the Cloudflare
//  Worker as encrypted secrets — nothing
//  secret is present in this file.
// ══════════════════════════════════════════
const WORKER_URL = 'https://studycapital-form-handler.studycapital2026.workers.dev';

// ── GA4 Form Funnel Tracking ──────────────────────────────────────────────
function gaEvent(name, params = {}) {
  if (typeof gtag === 'function') gtag('event', name, params);
}

// Fire form_start once when user first interacts with either form
let heroFormStarted = false, contactFormStarted = false;
function onHeroFormStart() {
  if (heroFormStarted) return;
  heroFormStarted = true;
  gaEvent('form_start', { form_id: 'hero_inquiry', form_name: 'Hero Quick Inquiry' });
}
function onContactFormStart() {
  if (contactFormStarted) return;
  contactFormStarted = true;
  gaEvent('form_start', { form_id: 'contact_form', form_name: 'Contact Form' });
}
// Attach start listeners once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  ['h-name','h-phone','h-email','h-type','h-amount','h-course','h-city','h-msg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('focus', onHeroFormStart, { once: true });
  });
  ['c-name','c-phone','c-email','c-type','c-amount','c-course','c-city','c-msg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('focus', onContactFormStart, { once: true });
  });
});
const WA_FALLBACK = 'https://wa.me/919811419910?text=';

// ── Input Sanitizer (prevents XSS in DOM injection) ──
function sanitize(str) {
  const el = document.createElement('div');
  el.textContent = str || '';
  return el.innerHTML;
}

// ── Inline form error helper (replaces alert() for better UX) ──
function showFieldError(inputId, message) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.style.borderColor = '#dc2626';
  el.style.boxShadow = '0 0 0 3px rgba(220,38,38,0.1)';
  let errEl = el.parentNode.querySelector('.field-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.className = 'field-error';
    errEl.style.cssText = 'color:#dc2626;font-size:0.75rem;margin-top:4px;font-weight:500;';
    el.parentNode.appendChild(errEl);
  }
  errEl.textContent = message;
  el.addEventListener('input', function clearErr() {
    el.style.borderColor = '';
    el.style.boxShadow = '';
    if (errEl) errEl.textContent = '';
    el.removeEventListener('input', clearErr);
  }, { once: true });
}


// ── Toast Notification ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const ppOverlay = document.getElementById('pp-modal-overlay');
    if (ppOverlay && ppOverlay.classList.contains('pp-open')) {
      ppOverlay.classList.remove('pp-open');
      document.body.style.overflow = '';
    }
  }
});
function showToast(name, phone) {
  const overlay = document.getElementById('sc-toast-overlay');
  const details = document.getElementById('sc-toast-details');
  const waLink  = overlay.querySelector('.sc-toast-btn-wa');
  const waText  = encodeURIComponent(`Hello StudyCapital! I just submitted a loan inquiry.\nName: ${name}\nPhone: ${phone}`);
  waLink.href = `https://wa.me/919811419910?text=${waText}`;
  details.innerHTML =
    `📞 Expect a call within <strong>2 business hours</strong><br>` +
    `📧 Confirmation sent to your email<br>` +
    `🕐 Working hours: Mon–Sat, 9 AM – 7 PM IST`;
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
  // Auto-close after 12 seconds
  setTimeout(closeToast, 12000);
}
function closeToast() {
  const overlay = document.getElementById('sc-toast-overlay');
  overlay.classList.remove('show');
  document.body.style.overflow = '';
}
// Close on Escape key
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeToast(); });

// ── Show a styled error banner with WhatsApp fallback ──
function showFormError(containerId, name, phone) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const existing = container.querySelector('.sc-error-banner');
  if (existing) existing.remove();
  // Sanitize user input before DOM injection
  const safeName  = sanitize(name);
  const safePhone = sanitize(phone);
  name  = safeName;
  phone = safePhone;

  const banner = document.createElement('div');
  banner.className = 'sc-error-banner';
  banner.style.cssText = `
    background:#fff3cd; border:1px solid #ffc107; border-radius:10px;
    padding:14px 18px; margin-top:14px; font-size:14px; line-height:1.6;
    color:#333; display:flex; align-items:flex-start; gap:12px;
  `;
  const waText = encodeURIComponent(
    `Hello StudyCapital! I'd like a free consultation.\nName: ${name}\nPhone: ${phone}`
  );
  banner.innerHTML = `
    <span style="font-size:22px;flex-shrink:0;">⚠️</span>
    <div>
      <strong>Submission failed — our server is temporarily unreachable.</strong><br>
      Please reach us directly:
      <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap;">
        <a href="${WA_FALLBACK}${waText}" target="_blank" rel="noopener"
          style="background:#25D366;color:#fff;padding:7px 14px;border-radius:6px;
                 text-decoration:none;font-weight:600;font-size:13px;">
          💬 WhatsApp Us
        </a>
        <a href="tel:+919811419910"
          style="background:#1A56DB;color:#fff;padding:7px 14px;border-radius:6px;
                 text-decoration:none;font-weight:600;font-size:13px;">
          📞 Call Now
        </a>
      </div>
      <div style="margin-top:6px;font-size:12px;color:#666;">
        Or email us at <a href="mailto:info@studycapital.in">info@studycapital.in</a>
      </div>
    </div>`;
  container.appendChild(banner);
  setTimeout(() => banner.remove(), 20000);
}

// ── Single call: sends Email + Telegram + saves to D1 ──
async function submitToWorker(emailParams, telegramMessage, turnstileToken = '') {
  let res;
  try {
    const hpVal = (document.getElementById('h-website') || document.getElementById('c-website') || {}).value || '';
    res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailParams, telegramMessage, honeypot: hpVal, turnstileToken }),
      signal: AbortSignal.timeout(10000)   // 10-second timeout
    });
  } catch (networkErr) {
    // Network error (DNS failure, no internet, CORS, timeout)
    const err = new Error('network_error');
    err.isNetworkError = true;
    throw err;
  }
  const data = await res.json();
  if (!data.ok) {
    // D1 errors are non-fatal (logged in data.errors), Telegram/Email errors are reported
    const fatal = (data.errors || []).filter(e => !e.startsWith('db_error'));
    if (fatal.length) {
      console.error('Worker errors:', data.errors);
      throw new Error(data.errors.join(', '));
    }
    if (data.errors?.length) console.warn('Non-fatal worker errors:', data.errors);
  }
  return data;
}

// ── Navbar scroll effect + back-to-top ──
window.addEventListener('scroll', () => {
  document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 20);
  });

// ── Mobile menu ──
function toggleMenu(e) {
  if (e) e.stopPropagation();          /* prevent click from bubbling to document close handler */
  const nav = document.getElementById('mobileNav');
  const btn = document.getElementById('hamburger');
  const isOpen = nav.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

/* ── MEGA MENU JS ── */
(function () {
  var timers = {};
  var navbar = document.querySelector('.navbar');

  document.querySelectorAll('.nav-center > li.mega-wrap').forEach(function (wrap, i) {
    var panel = wrap.querySelector('.mega-panel');
    var btn   = wrap.querySelector('.mega-btn');

    function openWrap() {
      clearTimeout(timers[i]);
      document.querySelectorAll('.nav-center > li.mega-wrap').forEach(function (w) {
        if (w !== wrap) {
          w.classList.remove('is-open');
          var b = w.querySelector('.mega-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
      wrap.classList.add('is-open');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }
    function scheduleClose() {
      timers[i] = setTimeout(function () {
        wrap.classList.remove('is-open');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }, 180);
    }
    function cancelClose() { clearTimeout(timers[i]); }

    wrap.addEventListener('mouseenter', openWrap);
    wrap.addEventListener('mouseleave', scheduleClose);
    if (panel) {
      panel.addEventListener('mouseenter', cancelClose);
      panel.addEventListener('mouseleave', scheduleClose);
    }
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = wrap.classList.contains('is-open');
        document.querySelectorAll('.nav-center > li.mega-wrap').forEach(function (w) {
          w.classList.remove('is-open');
          var b = w.querySelector('.mega-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) {
          wrap.classList.add('is-open');
          if (btn) btn.setAttribute('aria-expanded', 'true');
        }
      });
    }
  });

  /* Close mega menus on outside click — but NOT when clicking inside the navbar */
  document.addEventListener('click', function (e) {
    if (navbar && navbar.contains(e.target)) return;   /* click inside navbar → do nothing */
    document.querySelectorAll('.nav-center > li.mega-wrap').forEach(function (w) {
      w.classList.remove('is-open');
      var b = w.querySelector('.mega-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  });

  /* Close mobile nav on outside click */
  document.addEventListener('click', function (e) {
    var mobileNav = document.getElementById('mobileNav');
    var hamburger = document.getElementById('hamburger');
    if (!mobileNav || !hamburger) return;
    if (mobileNav.classList.contains('open') &&
        !mobileNav.contains(e.target) &&
        !hamburger.contains(e.target)) {
      mobileNav.classList.remove('open');
      hamburger.classList.remove('active');
      hamburger.setAttribute('aria-expanded', 'false');
    }
  });
}());

function closeMenu() {
  var nav = document.getElementById('mobileNav');
  var btn = document.getElementById('hamburger');
  if (nav) nav.classList.remove('open');
  if (btn) { btn.classList.remove('active'); btn.setAttribute('aria-expanded', 'false'); }
}

// ── EMI Calculator (with correct moratorium interest accrual) ──
function calcEMI() {
  const P0   = parseFloat(document.getElementById('loanAmt').value);
  const rate = parseFloat(document.getElementById('interest').value);
  const years = parseFloat(document.getElementById('tenure').value);
  const mor  = parseFloat(document.getElementById('moratorium').value);

  // Simple interest accrues during moratorium and is capitalised into principal
  const morInterest = P0 * (rate / 100) * mor;
  const P = P0 + morInterest;

  const r = rate / 100 / 12;
  const n = years * 12;
  const emi = r === 0 ? P / n : P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  const totalPayable = emi * n;
  const totalInterest = totalPayable - P0;  // all interest including moratorium

  document.getElementById('loanAmtDisplay').textContent    = '₹' + P0.toLocaleString('en-IN');
  document.getElementById('interestDisplay').textContent   = rate + '%';
  document.getElementById('tenureDisplay').textContent     = years + ' Years';
  document.getElementById('moratoriumDisplay').textContent = mor === 0 ? 'None' : mor + (mor === 1 ? ' Year' : ' Years');

  document.getElementById('emiResult').textContent     = '₹' + Math.round(emi).toLocaleString('en-IN');
  document.getElementById('principalDisp').textContent = '₹' + P0.toLocaleString('en-IN');
  document.getElementById('interestDisp').textContent  = '₹' + Math.round(totalInterest).toLocaleString('en-IN');
  document.getElementById('totalDisp').textContent     = '₹' + Math.round(totalPayable + morInterest).toLocaleString('en-IN');
  document.getElementById('repayStart').textContent    = mor === 0 ? 'Immediately' : 'After ' + mor + (mor === 1 ? ' Year' : ' Years');
}
calcEMI();

// ── Hero Form Submit ──
async function submitHeroForm() {
  const name        = document.getElementById('h-name').value.trim();
  const countryCode = document.getElementById('h-country-code').value;
  const phone       = document.getElementById('h-phone').value.trim();
  const fullPhone   = countryCode.replace('-CA','') + ' ' + phone;
  const email  = document.getElementById('h-email').value.trim();
  const type   = document.getElementById('h-type').value;
  const amount = document.getElementById('h-amount').value;
  const course = document.getElementById('h-course').value.trim();
  const city   = document.getElementById('h-city').value.trim();
  const msg    = document.getElementById('h-msg').value.trim();

  if (!name) { showFieldError('h-name', 'Please enter your full name.'); return; }
  if (!phone) { showFieldError('h-phone', 'Please enter your mobile number.'); return; }
  // Validate based on country code
  const digitsOnly = phone.replace(/[\s\-]/g, '');
  if (countryCode === '+91') {
    if (!/^[6-9]\d{9}$/.test(digitsOnly)) { showFieldError('h-phone', 'Enter a valid 10-digit Indian mobile number.'); return; }
  } else {
    if (digitsOnly.length < 7 || digitsOnly.length > 15) { showFieldError('h-phone', 'Enter a valid phone number.'); return; }
  }
  if (!email) { showFieldError('h-email', 'Please enter your email address.'); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) { showFieldError('h-email', 'Enter a valid email address.'); return; }

  const btn = document.querySelector('.btn-submit');
  gaEvent('form_submit_attempt', { form_id: 'hero_inquiry' });
  btn.textContent = 'Sending...';
  btn.disabled = true;

  try {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const day = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });

  const emailParams = {
    'Full Name':    name,
    'Phone':        fullPhone,
    'Email':        email || 'Not provided',
    'Loan Type':    type,
    'Loan Amount':  amount,
    'Course':       course || 'Not specified',
    'City':         city || 'Not specified',
    'Message':      msg || 'No additional message',
    'Source':       'Hero Quick Inquiry Form',
    'Date':         day,
    'Submitted At': now,
  };

  const telegramMessage =
    `🎓 *NEW INQUIRY — StudyCapital*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Name:* ${name}\n` +
    `📞 *Mobile:* ${phone}\n` +
    `📧 *Email:* ${email || 'Not provided'}\n` +
    `📍 *City:* ${city || 'Not specified'}\n` +
    `🏦 *Loan Type:* ${type}\n` +
    `💰 *Amount Needed:* ${amount}\n` +
    `🎓 *Course/Destination:* ${course || 'Not specified'}\n` +
    `💬 *Message:* ${msg || 'No message'}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Source:* Hero Quick Form\n` +
    `🕐 *Date & Time:* ${now}`;

  // Honeypot check — bots fill hidden fields, humans don't
  if (document.getElementById('h-website') && document.getElementById('h-website').value) {
    showToast(name, fullPhone); // silent discard
    return;
  }

  // Cloudflare Turnstile token verification
  const hTsEl = document.querySelector('#h-turnstile [name="cf-turnstile-response"]');
  if (hTsEl && !hTsEl.value) {
    showFieldError('h-name', 'Please complete the security check.');
    btn.textContent = 'Get Free Consultation →';
    btn.disabled = false;
    return;
  }
  const hTurnstileToken = hTsEl ? hTsEl.value : '';

  await submitToWorker(emailParams, telegramMessage, hTurnstileToken);

  gaEvent('form_success', { form_id: 'hero_inquiry', loan_type: type, loan_amount: amount });
  showToast(name, fullPhone);
  // Reset form fields
  ['h-name','h-phone','h-email','h-course','h-city','h-msg'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  document.getElementById('h-country-code').value = '+91';
  } catch(e) {
    console.error('Form submission error:', e);
    gaEvent('form_error', { form_id: 'hero_inquiry', error: e.message });
    // ── Fallback: log submission failure (no PII stored in localStorage) ──
    console.warn('Form worker unreachable:', e.message);
    showFormError('hero-form-wrap', name, phone);
  } finally {
    btn.textContent = 'Get Free Consultation →';
    btn.disabled = false;
  }
}

// ── Contact Form Submit ──
async function submitContactForm() {
  const name        = document.getElementById('c-name').value.trim();
  const countryCode = document.getElementById('c-country-code').value;
  const phone       = document.getElementById('c-phone').value.trim();
  const fullPhone   = countryCode.replace('-CA','') + ' ' + phone;
  const email   = document.getElementById('c-email').value.trim();
  const course  = document.getElementById('c-course') ? document.getElementById('c-course').value.trim() : '';
  const dest    = document.getElementById('c-dest') ? document.getElementById('c-dest').value : '';
  const amount  = document.getElementById('c-amount') ? document.getElementById('c-amount').value : '';
  const msg     = document.getElementById('c-msg') ? document.getElementById('c-msg').value.trim() : '';

  if (!name) { showFieldError('c-name', 'Please enter your full name.'); return; }
  if (!phone) { showFieldError('c-phone', 'Please enter your phone number.'); return; }
  if (!email) { showFieldError('c-email', 'Please enter your email address.'); return; }
  const digitsOnly = phone.replace(/[\s\-]/g, '');
  if (countryCode === '+91') {
    if (!/^[6-9]\d{9}$/.test(digitsOnly)) { showFieldError('c-phone', 'Enter a valid 10-digit Indian mobile number.'); return; }
  } else {
    if (digitsOnly.length < 7 || digitsOnly.length > 15) { showFieldError('c-phone', 'Enter a valid phone number.'); return; }
  }

  const btn = document.querySelector('#contact .btn-green');
  btn.textContent = 'Sending...';
  btn.disabled = true;

  try {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const day = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' });

  const emailParams = {
    'Full Name':     name,
    'Phone':         fullPhone,
    'Email':         email,
    'Course':        course || 'Not specified',
    'Loan Type':     dest ? `Study in ${dest}` : 'Not specified',
    'Loan Amount':   amount || 'Not specified',
    'Message':       msg || 'No message provided',
    'Source':        'Contact Form',
    'Date':          day,
    'Submitted At':  now,
  };

  const telegramMessage =
    `📩 *NEW CONTACT FORM — StudyCapital*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Name:* ${name}\n` +
    `📞 *Mobile:* ${fullPhone}\n` +
    `📧 *Email:* ${email}\n` +
    `🎓 *Course/Program:* ${course || 'Not specified'}\n` +
    `🌍 *Study Destination:* ${dest || 'Not specified'}\n` +
    `💰 *Loan Amount:* ${amount || 'Not specified'}\n` +
    `💬 *Message:* ${msg || 'No message'}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📋 *Source:* Contact Form\n` +
    `📅 *Date:* ${day}\n` +
    `🕐 *Time:* ${now}`;

  // Honeypot check
  if (document.getElementById('c-website') && document.getElementById('c-website').value) {
    showToast(name, fullPhone); // silent discard
    return;
  }

  // Cloudflare Turnstile token verification
  const cTsEl = document.querySelector('#c-turnstile [name="cf-turnstile-response"]');
  if (cTsEl && !cTsEl.value) {
    showFieldError('c-name', 'Please complete the security check.');
    btn.textContent = '📤 Send Message & Request Callback';
    btn.disabled = false;
    return;
  }
  const cTurnstileToken = cTsEl ? cTsEl.value : '';

  await submitToWorker(emailParams, telegramMessage, cTurnstileToken);

  gaEvent('form_success', { form_id: 'contact_form', loan_type: dest || 'domestic' });
  showToast(name, fullPhone);
  // Reset form fields
  ['c-name','c-phone','c-email','c-course','c-msg'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  document.getElementById('c-country-code').value = '+91';
  } catch(e) {
    console.error('Contact form error:', e);
    gaEvent('form_error', { form_id: 'contact_form', error: e.message });
    console.warn('Form worker unreachable:', e.message);
    showFormError('contact-form-wrap', name, phone);
  } finally {
    btn.textContent = '📤 Send Message & Request Callback';
    btn.disabled = false;
  }
}


// ── FAQ Toggle (Content Optimization) ──
function toggleFAQ(btn) {
  const isOpen = btn.getAttribute('aria-expanded') === 'true';
  // Close all
  document.querySelectorAll('.faq-q').forEach(b => {
    b.setAttribute('aria-expanded', 'false');
    b.nextElementSibling.classList.remove('open');
  });
  if (!isOpen) {
    btn.setAttribute('aria-expanded', 'true');
    btn.nextElementSibling.classList.add('open');
  }
}

// ── TECHNICAL SEO: Performance – Intersection Observer for section animation ──
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.service-card, .testi-card, .faq-item').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

// ── SPEED OPTIMIZATION: Defer non-critical CSS ──
window.addEventListener('load', () => {
  // Mark page as fully loaded for analytics
  document.documentElement.setAttribute('data-loaded', 'true');
});

// ── Smooth anchor offset for fixed navbar ──
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (!href || href === '#') return; // skip bare # links
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      window.scrollTo({ top: target.offsetTop - 75, behavior: 'smooth' });
    }
  });
});