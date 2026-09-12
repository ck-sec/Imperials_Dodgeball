const { Resend } = require('resend');

let _resend;
function getResend() {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('Missing RESEND_API_KEY environment variable');
    _resend = new Resend(key);
  }
  return _resend;
}

const APPROVED_FROM = 'Vienna Imperials <noreply@imperialsdodgeball.com>';
const CLUB_EMAIL = 'imperialsdodgeball@gmail.com';
const FROM_EMAIL = process.env.EMAIL_FROM || APPROVED_FROM;

async function deliverEmail(message) {
  try {
    const { data, error } = await getResend().emails.send(message);
    if (error || typeof data?.id !== 'string' || !data.id.trim()) {
      throw new Error('Email was not accepted');
    }
    return { data };
  } catch {
    // Provider exceptions can contain recipients, message content, or credentials.
    console.error('Email delivery unavailable');
    throw new Error('Email delivery unavailable');
  }
}

async function sendEmail({ to, subject, html, text, headers, replyTo, cc }) {
  const defaultHeaders = {
    'List-Unsubscribe': `<mailto:imperialsdodgeball@gmail.com?subject=unsubscribe>`,
    ...headers
  };
  return deliverEmail({
    from: FROM_EMAIL,
    to,
    ...(cc === false ? {} : { cc: cc !== undefined ? cc : CLUB_EMAIL }),
    subject,
    html,
    text,
    replyTo: replyTo || CLUB_EMAIL,
    headers: defaultHeaders
  });
}

function sendPasswordResetEmail({ to, subject, html, text }) {
  // Deliberately independent of bulk-mail defaults: never forward a one-time link.
  return deliverEmail({
    from: APPROVED_FROM,
    to,
    subject,
    html,
    text,
    replyTo: CLUB_EMAIL,
  });
}

module.exports = { sendEmail, sendPasswordResetEmail, getResend };
