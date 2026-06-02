// ═══════════════════════════════════════════════════════════════════════
//  StudyCapital – Google Apps Script  (Code.gs)
//  VERSION 3 – Image compression + robust single-POST upload
// ═══════════════════════════════════════════════════════════════════════
//
//  ★ AFTER PASTING THIS CODE:
//  1. Project Settings (⚙️) → Script Properties → WA_TOKEN = <permanent token>
//  2. Deploy → NEW Deployment (not edit existing) → Web App
//     Execute as: Me | Access: Anyone → copy new URL to index.html
//  3. Run testOTP()    to confirm WhatsApp works
//  4. Run testUpload() to confirm Drive works
//
// ═══════════════════════════════════════════════════════════════════════

const DRIVE_FOLDER_NAME = "StudyCapital \u2013 Loan Documents";
const NOTIFY_EMAIL      = "studycapitaldelhi@gmail.com";

// ─── WHATSAPP CONFIG ──────────────────────────────────────────────────
const WA_PHONE_ID = '1146151658573233';   // ✅ correct Phone ID
const WA_TEMPLATE = 'studycapital_otp2';   // ✅ correct template name
// ─────────────────────────────────────────────────────────────────────

// ─── doGet — OTP requests from browser ───────────────────────────────
function doGet(e) {
  try {
    const p = e.parameter || {};
    Logger.log('doGet action: ' + p.action);

    if (p.action === 'sendOTP') {
      return jsonOut(handleSendOTP({ phone: p.phone, otp: p.otp }));
    }

    if (p.action === 'sendSummary') {
      return jsonOut(handleSendSummary({
        studentInfo: {
          name: p.studentName, phone: p.studentPhone,
          email: p.studentEmail, course: p.studentCourse,
          college: p.studentCollege, amount: p.loanAmount
        },
        docsUploaded: (p.docsUploaded || '').split(',')
      }));
    }

    return jsonOut({ status: 'StudyCapital API v3 running' });

  } catch(err) {
    Logger.log('doGet ERROR: ' + err.message);
    return jsonOut({ ok: false, error: err.message });
  }
}

// ─── doPost — file uploads from browser ──────────────────────────────
function doPost(e) {
  try {
    const ct = (e.postData && e.postData.type) || '';
    Logger.log('doPost content-type: ' + ct);

    let data;

    // Form POST from browser: e.parameter.data contains JSON string
    if (e.parameter && e.parameter.data) {
      data = JSON.parse(e.parameter.data);

    // Raw JSON body (application/json or text/plain)
    } else if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);

    } else {
      data = e.parameter || {};
    }

    Logger.log('doPost action: ' + data.action);

    let result;
    if      (data.action === 'uploadFile')  result = handleUploadFile(data);
    else if (data.action === 'sendOTP')     result = handleSendOTP(data);
    else if (data.action === 'sendSummary') result = handleSendSummary(data);
    else throw new Error('Unknown action: ' + data.action);

    return jsonOut(result);

  } catch(err) {
    Logger.log('doPost ERROR: ' + err.message);
    return jsonOut({ ok: false, error: err.message });
  }
}

// ─── SEND OTP ─────────────────────────────────────────────────────────
function handleSendOTP(data) {
  const phone = String(data.phone || '').trim();
  const otp   = String(data.otp   || '').trim();
  if (phone.length < 10) throw new Error('Invalid phone: ' + phone);
  if (otp.length   <  4) throw new Error('Invalid OTP: '   + otp);

  Logger.log('Sending OTP ' + otp + ' to ' + phone);

  // Backup email
  try {
    GmailApp.sendEmail(NOTIFY_EMAIL, 'StudyCapital OTP for ' + phone,
      'OTP: ' + otp + '\nPhone: +91 ' + phone +
      '\nTime: ' + new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  } catch(e) { Logger.log('Backup email failed: ' + e.message); }

  // WhatsApp
  const waToken = PropertiesService.getScriptProperties().getProperty('WA_TOKEN');
  if (!waToken) return { sent: true, channel: 'email-only', reason: 'WA_TOKEN not set' };

  const res = UrlFetchApp.fetch(
    'https://graph.facebook.com/v19.0/' + WA_PHONE_ID + '/messages',
    {
      method: 'post',
      headers: { Authorization: 'Bearer ' + waToken, 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        messaging_product: 'whatsapp',
        to: '91' + phone,
        type: 'template',
        template: {
          name: WA_TEMPLATE,
          language: { code: 'en' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: otp }] },
            { type: 'button', sub_type: 'COPY_CODE', index: '0',
              parameters: [{ type: 'coupon_code', coupon_code: otp }] }
          ]
        }
      }),
      muteHttpExceptions: true
    }
  );

  const body = JSON.parse(res.getContentText());
  Logger.log('WA response: ' + JSON.stringify(body));

  if (body.messages && body.messages[0] && body.messages[0].id) {
    Logger.log('\u2705 WA OTP sent, ID: ' + body.messages[0].id);
    return { sent: true, channel: 'whatsapp', msgId: body.messages[0].id };
  }

  const code = (body.error && body.error.code) || 'unknown';
  const msg  = (body.error && body.error.message) || JSON.stringify(body);
  Logger.log('WA FAILED — code ' + code + ': ' + msg);
  if (code === 190)   Logger.log('ACTION: Regenerate WA_TOKEN in Meta console.');
  if (code === 131030) Logger.log('ACTION: Add +91' + phone + ' as test recipient in Meta.');
  return { sent: true, channel: 'email-fallback', waError: { code, msg } };
}

// ─── UPLOAD FILE TO GOOGLE DRIVE ──────────────────────────────────────
function handleUploadFile(data) {
  if (!data.data)        throw new Error('No file data in request');
  if (!data.studentInfo) throw new Error('No studentInfo in request');

  const si = data.studentInfo;
  Logger.log('handleUploadFile: ' + data.docKey + ' | ' + data.fileName +
             ' | ' + data.mimeType + ' | student: ' + si.name);

  const folder = getOrCreateFolder(si);
  const bytes  = Utilities.base64Decode(data.data);
  const blob   = Utilities.newBlob(bytes, data.mimeType, data.docKey + '_' + data.fileName);
  const file   = folder.createFile(blob);

  Logger.log('\u2705 File saved: ' + file.getName() + ' (' + file.getId() + ')');
  Logger.log('Drive folder: ' + folder.getUrl());

  return { ok: true, fileId: file.getId(), url: file.getUrl(), folder: folder.getUrl() };
}

// ─── SEND SUMMARY EMAIL ───────────────────────────────────────────────
function handleSendSummary(data) {
  const si   = data.studentInfo;
  const docs = Array.isArray(data.docsUploaded)
    ? data.docsUploaded.join(', ') : String(data.docsUploaded || '');

  const rootFolder = getOrCreateRootFolder();
  const folderUrl  = rootFolder.getUrl();

  // ── Team notification email (detailed) ──
  GmailApp.sendEmail(NOTIFY_EMAIL,
    '📄 New Docs – ' + si.name + ' | ' + si.phone,
    'New document submission!\n\n' +
    '── STUDENT ──\n' +
    'Name:         ' + (si.name    || '') + '\n' +
    'Phone:        +91 ' + (si.phone || '') + '\n' +
    'Email:        ' + (si.email   || '') + '\n' +
    'Course:       ' + (si.course  || '') + '\n' +
    'College:      ' + (si.college || '') + '\n' +
    'Start Date:   ' + (si.courseStartDate || 'Not provided') + '\n' +
    'Loan Amount:  ' + (si.amount  || '') + '\n' +
    'Pref. Bank:   ' + (si.bank    || 'Any') + '\n\n' +
    '── CO-APPLICANT ──\n' +
    'Name:         ' + (si.coName       || 'Not provided') + '\n' +
    'Relation:     ' + (si.coRelation   || 'Not provided') + '\n' +
    'Occupation:   ' + (si.coOccupation || 'Not provided') + '\n' +
    'Annual Income:' + (si.coIncome     || 'Not provided') + '\n\n' +
    '── DOCUMENTS UPLOADED ──\n' +
    docs + '\n\n' +
    'View in Drive: ' + folderUrl
  );

  // ── Confirmation email to student (HTML) ──
  if (si.email) {
    try {
      const docLabels = {
        aadhaar: 'Aadhaar Card', pan: 'PAN Card',
        tenth:   '10th Marksheet', twelfth: '12th Marksheet',
        admit:   'Admission Letter', income: 'Income Proof'
      };
      const docList = (Array.isArray(data.docsUploaded) ? data.docsUploaded : [])
        .map(k => '<li style="margin:4px 0;">✅ ' + (docLabels[k] || k) + '</li>')
        .join('');

      const refId  = 'SC-' + Date.now().toString(36).toUpperCase() + '-' + (si.phone || '').slice(-4);
      const submittedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      const htmlBody =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body ' +
        'style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">' +

        // Wrapper
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">' +
        '<tr><td align="center">' +
        '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;' +
        'overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);max-width:600px;">' +

        // Header
        '<tr><td style="background:linear-gradient(135deg,#1a56db 0%,#0e3fa6 100%);padding:36px 40px;text-align:center;">' +
        '<h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">StudyCapital</h1>' +
        '<p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">Education Loan Assistance</p>' +
        '</td></tr>' +

        // Success badge
        '<tr><td style="padding:36px 40px 0;text-align:center;">' +
        '<div style="display:inline-block;background:#f0fdf4;border:2px solid #22c55e;border-radius:50px;' +
        'padding:10px 24px;margin-bottom:20px;">' +
        '<span style="color:#16a34a;font-weight:700;font-size:15px;">✅ Documents Successfully Received</span>' +
        '</div>' +
        '<h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Hi ' + (si.name || 'Applicant') + '!</h2>' +
        '<p style="margin:0;color:#64748b;font-size:15px;line-height:1.6;">' +
        'We have received your loan application documents. Our team will review them and get back to you within <strong>24–48 hours</strong>.' +
        '</p>' +
        '</td></tr>' +

        // Reference ID
        '<tr><td style="padding:24px 40px 0;">' +
        '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;text-align:center;">' +
        '<p style="margin:0;color:#64748b;font-size:13px;">Your Reference ID</p>' +
        '<p style="margin:4px 0 0;color:#1a56db;font-size:20px;font-weight:700;letter-spacing:1px;">' + refId + '</p>' +
        '<p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Submitted on ' + submittedAt + '</p>' +
        '</div>' +
        '</td></tr>' +

        // Application details
        '<tr><td style="padding:24px 40px 0;">' +
        '<h3 style="margin:0 0 14px;color:#1e293b;font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">Application Summary</h3>' +
        '<table width="100%" cellpadding="0" cellspacing="0">' +
        '<tr><td style="padding:6px 0;color:#64748b;font-size:14px;width:45%;">Course</td>' +
        '<td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:600;">' + (si.course || '—') + '</td></tr>' +
        '<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">College / Country</td>' +
        '<td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:600;">' + (si.college || '—') + '</td></tr>' +
        '<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Loan Amount</td>' +
        '<td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:600;">' + (si.amount || '—') + '</td></tr>' +
        '<tr><td style="padding:6px 0;color:#64748b;font-size:14px;">Phone</td>' +
        '<td style="padding:6px 0;color:#1e293b;font-size:14px;font-weight:600;">+91 ' + (si.phone || '—') + '</td></tr>' +
        '</table>' +
        '</td></tr>' +

        // Documents submitted
        '<tr><td style="padding:24px 40px 0;">' +
        '<h3 style="margin:0 0 14px;color:#1e293b;font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">Documents Submitted</h3>' +
        '<ul style="margin:0;padding:0 0 0 4px;list-style:none;color:#1e293b;font-size:14px;">' +
        docList +
        '</ul>' +
        '</td></tr>' +

        // What happens next
        '<tr><td style="padding:24px 40px 0;">' +
        '<h3 style="margin:0 0 14px;color:#1e293b;font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">What Happens Next?</h3>' +
        '<table width="100%" cellpadding="0" cellspacing="0">' +
        '<tr><td style="padding:8px 0;vertical-align:top;width:32px;font-size:18px;">🔍</td>' +
        '<td style="padding:8px 0;color:#475569;font-size:14px;line-height:1.5;"><strong style="color:#1e293b;">Document Review</strong><br>Our team reviews your documents for completeness and eligibility.</td></tr>' +
        '<tr><td style="padding:8px 0;vertical-align:top;font-size:18px;">📞</td>' +
        '<td style="padding:8px 0;color:#475569;font-size:14px;line-height:1.5;"><strong style="color:#1e293b;">Counsellor Call</strong><br>A loan counsellor will call you within 24–48 hours to discuss the best options.</td></tr>' +
        '<tr><td style="padding:8px 0;vertical-align:top;font-size:18px;">🏦</td>' +
        '<td style="padding:8px 0;color:#475569;font-size:14px;line-height:1.5;"><strong style="color:#1e293b;">Bank Matching</strong><br>We match your profile with the best-fit lenders for fast disbursement.</td></tr>' +
        '</table>' +
        '</td></tr>' +

        // CTA button
        '<tr><td style="padding:28px 40px 0;text-align:center;">' +
        '<a href="https://wa.me/919811419910?text=Hi%2C%20my%20reference%20ID%20is%20' + refId + '" ' +
        'style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;' +
        'padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;">💬 WhatsApp Us for Quick Help</a>' +
        '</td></tr>' +

        // Footer
        '<tr><td style="padding:32px 40px;text-align:center;border-top:1px solid #e2e8f0;margin-top:28px;">' +
        '<p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">' +
        'StudyCapital | Education Loan Specialists<br>' +
        '<a href="https://www.studycapital.in" style="color:#1a56db;text-decoration:none;">www.studycapital.in</a> | ' +
        '<a href="mailto:studycapitaldelhi@gmail.com" style="color:#1a56db;text-decoration:none;">studycapitaldelhi@gmail.com</a>' +
        '</p>' +
        '</td></tr>' +

        '</table></td></tr></table></body></html>';

      GmailApp.sendEmail(si.email,
        '✅ Documents Received – StudyCapital [Ref: ' + refId + ']',
        // Plain-text fallback
        'Dear ' + (si.name || 'Applicant') + ',\n\n' +
        'We have received your loan documents (Ref: ' + refId + ').\n\n' +
        'Docs submitted: ' + docs + '\n' +
        'Course: ' + (si.course || '') + ' | College: ' + (si.college || '') + '\n' +
        'Loan Amount: ' + (si.amount || '') + '\n\n' +
        'Our team will contact you within 24-48 hours.\n\n' +
        'WhatsApp: +91 98114 19910\n' +
        'Team StudyCapital | www.studycapital.in',
        { htmlBody: htmlBody }
      );
      Logger.log('✅ HTML confirmation email sent to student: ' + si.email + ' | Ref: ' + refId);
    } catch(e) {
      Logger.log('Student confirmation email failed: ' + e.message);
    }
  }

  Logger.log('Summary email sent for ' + si.name);
  return { ok: true, notified: true };
}

// ─── TEST FUNCTIONS ───────────────────────────────────────────────────

// Run to confirm WhatsApp OTP delivery
function testOTP() {
  const result = handleSendOTP({ phone: '9811419926', otp: '123456' });
  Logger.log('testOTP result: ' + JSON.stringify(result));
  if (result.channel === 'whatsapp') Logger.log('\u2705 SUCCESS');
  else Logger.log('\u26a0\uFE0F  Check WA error above');
}

// Run to confirm Drive upload is working
function testUpload() {
  Logger.log('=== testUpload ===');
  const testData = {
    docKey:  'test',
    fileName: 'test_file.txt',
    mimeType: 'text/plain',
    // "Hello StudyCapital Test" in base64
    data:    'SGVsbG8gU3R1ZHlDYXBpdGFsIFRlc3Q=',
    studentInfo: { name: 'Test Student', phone: '9999999999',
                   email: 'test@test.com', course: 'Test',
                   college: 'Test College', amount: 'Test' }
  };
  const result = handleUploadFile(testData);
  Logger.log('testUpload result: ' + JSON.stringify(result));
  if (result.ok) {
    Logger.log('\u2705 Drive upload works! File at: ' + result.url);
    Logger.log('Folder: ' + result.folder);
  } else {
    Logger.log('\u274C Drive upload FAILED');
  }
}

// ─── DRIVE HELPERS ────────────────────────────────────────────────────
function getOrCreateFolder(si) {
  const root = getOrCreateRootFolder();
  const name = (si.name || 'Unknown') + ' \u2013 ' + (si.phone || '0000000000');
  const it   = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function getOrCreateRootFolder() {
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, ...obj }))
    .setMimeType(ContentService.MimeType.JSON);
}
