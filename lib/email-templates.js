/* ═══════════════════════════════════════
   EMAIL TEMPLATES — Vienna Imperials
   Bilingual (DE/EN) HTML email templates
═══════════════════════════════════════ */

const SITE_URL = 'https://www.imperialsdodgeball.com';
const { sanitizeHtml } = require('./validation');

function baseLayout(content) {
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <!-- Header -->
        <tr><td style="background:#0C1B3A;padding:24px 32px;text-align:center;border-radius:12px 12px 0 0;">
          <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr>
              <td style="vertical-align:middle;padding-right:12px;">
                <img src="${SITE_URL}/cropped-Vienna-Imperials-03-1.png" alt="Vienna Imperials" width="40" height="40" style="display:block;"/>
              </td>
              <td style="vertical-align:middle;">
                <div style="font-size:18px;font-weight:800;letter-spacing:2px;color:#F0B830;text-transform:uppercase;">Vienna Imperials</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Content -->
        <tr><td style="background:#ffffff;padding:32px;border-left:1px solid #e8e8eb;border-right:1px solid #e8e8eb;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#ffffff;padding:20px 32px;border-top:1px solid #e8e8eb;border-left:1px solid #e8e8eb;border-right:1px solid #e8e8eb;border-bottom:1px solid #e8e8eb;border-radius:0 0 12px 12px;text-align:center;">
          <p style="margin:0 0 6px;font-size:12px;color:#8c8c9a;">
            Vienna Imperials Dodgeball Club &middot; Vienna, Austria
          </p>
          <p style="margin:0;font-size:12px;">
            <a href="${SITE_URL}/datenschutz.html" style="color:#D4961A;text-decoration:none;">Datenschutz / Privacy</a>
            &nbsp;&middot;&nbsp;
            <a href="${SITE_URL}/impressum.html" style="color:#D4961A;text-decoration:none;">Impressum</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function signupConfirmation({ name }) {
  const subject = 'Willkommen bei den Vienna Imperials / Welcome to the Vienna Imperials';
  const safeName = name ? sanitizeHtml(name) : '';

  const content = `
      <h2 style="margin:0 0 8px;font-size:20px;color:#0C1B3A;font-weight:800;">Willkommen / Welcome</h2>
      <div style="width:40px;height:3px;background:#D4961A;border-radius:2px;margin-bottom:20px;"></div>
      <p style="margin:0 0 20px;font-size:15px;color:#3a3a4a;line-height:1.7;">
        ${safeName ? `Hallo <strong>${safeName}</strong>,` : 'Hallo,'}<br/><br/>
        Danke f\u00FCr dein Interesse an den Vienna Imperials! Wir haben deine Anmeldung erhalten und melden uns bald bei dir.<br/><br/>
        Thanks for your interest in the Vienna Imperials. We have received your signup and will be in touch soon.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr><td style="background:#0C1B3A;border-radius:6px;padding:12px 28px;">
          <a href="${SITE_URL}" style="color:#F0B830;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">Zur Website / Visit Website</a>
        </td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#8c8c9a;line-height:1.6;">
        Training findet regelm\u00E4\u00DFig in Wien statt. Details findest du auf unserer Website.<br/>
        Training takes place regularly in Vienna. Check our website for details.
      </p>`;

  const text = `Willkommen / Welcome\n\n${name ? `Hallo ${name},` : 'Hallo,'}\n\nDanke f\u00FCr dein Interesse an den Vienna Imperials! Wir melden uns bald.\nThanks for your interest! We'll be in touch soon.\n\nVienna Imperials - ${SITE_URL}`;

  return { subject, html: baseLayout(content), text };
}

function trainingReminder({ name, session }) {
  const { title, date, startTime, endTime, location } = session;

  // Format date for display
  const d = new Date(date + 'T00:00:00');
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['J\u00E4nner', 'Februar', 'M\u00E4rz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const dateStr = `${days[d.getDay()]}, ${d.getDate()}. ${months[d.getMonth()]}`;
  const dateStrEn = `${daysEn[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
  const fmtTime = t => t ? t.split(':').slice(0, 2).join(':') : '';

  const subject = `Training morgen: ${title} / Training tomorrow: ${title}`;

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#0C1B3A;font-weight:800;">Training Erinnerung / Reminder</h2>
    <div style="width:40px;height:3px;background:#D4961A;border-radius:2px;margin-bottom:20px;"></div>
    <p style="margin:0 0 20px;font-size:15px;color:#3a3a4a;line-height:1.7;">
      ${name ? `Hallo <strong>${name}</strong>,` : 'Hallo,'}<br/><br/>
      Morgen ist Training! / Training is tomorrow!
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8fb;border:1px solid #e8e8eb;border-radius:8px;margin:0 0 24px;">
      <tr><td style="padding:20px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#D4961A;text-transform:uppercase;margin-bottom:8px;">${dateStr}</div>
        <div style="font-size:18px;font-weight:800;color:#0C1B3A;margin-bottom:4px;">${title}</div>
        <div style="font-size:14px;color:#6b6b7a;">
          ${fmtTime(startTime)} \u2013 ${fmtTime(endTime)}${location ? ` &middot; ${location}` : ''}
        </div>
      </td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="background:#0C1B3A;border-radius:6px;padding:12px 28px;">
        <a href="${SITE_URL}/member#training" style="color:#F0B830;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">RSVP im Dashboard / RSVP in Dashboard</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:12px;color:#8c8c9a;line-height:1.6;">
      Du erh\u00E4ltst diese E-Mail als Mitglied der Vienna Imperials. Benachrichtigungen k\u00F6nnen im <a href="${SITE_URL}/member#settings" style="color:#D4961A;">Dashboard</a> deaktiviert werden.<br/>
      You receive this email as a Vienna Imperials member. Notifications can be disabled in your <a href="${SITE_URL}/member#settings" style="color:#D4961A;">dashboard</a>.
    </p>`;

  const text = `Training Erinnerung / Reminder\n\n${name ? `Hallo ${name},` : 'Hallo,'}\n\nMorgen ist Training! / Training is tomorrow!\n\n${title}\n${dateStr} (${dateStrEn})\n${fmtTime(startTime)} \u2013 ${fmtTime(endTime)}${location ? ` | ${location}` : ''}\n\nRSVP: ${SITE_URL}/member#training\n\nVienna Imperials - ${SITE_URL}`;

  return { subject, html: baseLayout(content), text };
}

function contactMessage({ name, email, message }) {
  const subject = `Neue Nachricht von ${name} / New message from ${name}`;

  const escapedMessage = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');

  const content = `
      <h2 style="margin:0 0 8px;font-size:20px;color:#0C1B3A;font-weight:800;">Neue Nachricht / New Message</h2>
      <div style="width:40px;height:3px;background:#D4961A;border-radius:2px;margin-bottom:20px;"></div>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8fb;border:1px solid #e8e8eb;border-radius:8px;margin:0 0 24px;">
        <tr><td style="padding:20px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#D4961A;text-transform:uppercase;margin-bottom:4px;">Von / From</div>
          <div style="font-size:16px;font-weight:700;color:#0C1B3A;margin-bottom:2px;">${name}</div>
          <div style="font-size:14px;color:#6b6b7a;margin-bottom:16px;">${email}</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#D4961A;text-transform:uppercase;margin-bottom:4px;">Nachricht / Message</div>
          <div style="font-size:15px;color:#3a3a4a;line-height:1.7;">${escapedMessage}</div>
        </td></tr>
      </table>
      <p style="margin:0;font-size:12px;color:#8c8c9a;line-height:1.6;">
        Diese Nachricht wurde \u00FCber das Kontaktformular auf imperialsdodgeball.com gesendet.<br/>
        This message was sent via the contact form on imperialsdodgeball.com.
      </p>`;

  const text = `Neue Nachricht / New Message\n\nVon / From: ${name} (${email})\n\nNachricht / Message:\n${message}\n\n---\nSent via imperialsdodgeball.com contact form`;

  return { subject, html: baseLayout(content), text };
}

function passwordReset({ name, token }) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    throw new Error('Invalid password reset token');
  }
  const subject = 'Passwort zur\u00FCcksetzen / Reset your password';
  const resetUrl = `${SITE_URL}/member#reset=${token}`;
  const safeName = name ? sanitizeHtml(name) : '';
  const content = `
      <h2 style="margin:0 0 16px;font-size:20px;color:#0C1B3A;">Passwort zur\u00FCcksetzen / Reset your password</h2>
      <p style="font-size:15px;color:#3a3a4a;line-height:1.7;">
        ${safeName ? `Hallo <strong>${safeName}</strong>,` : 'Hallo,'}<br/><br/>
        Du kannst hier ein neues Passwort festlegen. Dieser Link ist 30 Minuten lang und nur einmal g\u00FCltig.<br/><br/>
        Use this link to choose a new password. It expires in 30 minutes and can only be used once.
      </p>
      <p style="margin:24px 0;">
        <a href="${resetUrl}" style="color:#0C1B3A;font-weight:700;">Neues Passwort / Set a new password</a>
      </p>
      <p style="font-size:13px;color:#6b6b7a;line-height:1.7;">
        Falls du dies nicht angefordert hast, ignoriere diese E-Mail. Dein Passwort bleibt unver\u00E4ndert.<br/>
        If you did not request this, ignore this email. Your password will remain unchanged.<br/><br/>
        Die Freigabe deines Kontos durch den Verein bleibt unver\u00E4ndert.<br/>
        Resetting your password does not change your account's membership approval.
      </p>`;
  const text = `Passwort zur\u00FCcksetzen / Reset your password\n\n${name ? `Hallo ${name},` : 'Hallo,'}\n\nDieser Link ist 30 Minuten lang und nur einmal g\u00FCltig.\nThis link expires in 30 minutes and can only be used once.\n\n${resetUrl}\n\nFalls du dies nicht angefordert hast, ignoriere diese E-Mail. Dein Passwort bleibt unver\u00E4ndert.\nIf you did not request this, ignore this email. Your password will remain unchanged.\n\nDie Freigabe deines Kontos bleibt unver\u00E4ndert.\nYour account's membership approval remains unchanged.\n\nVienna Imperials - ${SITE_URL}`;
  return { subject, html: baseLayout(content), text };
}

module.exports = { signupConfirmation, trainingReminder, contactMessage, passwordReset };
