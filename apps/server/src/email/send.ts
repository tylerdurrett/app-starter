import { Resend } from 'resend';

let resend: Resend | null = null;

// Lazy init: throwing at module load breaks tests that don't exercise email.
// We only need these vars to be set when we actually try to send.
function getClient(): { resend: Resend; from: string } {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not set');
  }
  if (!process.env.EMAIL_FROM) {
    throw new Error('EMAIL_FROM environment variable is not set');
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return { resend, from: process.env.EMAIL_FROM };
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<void> {
  try {
    const { resend, from } = getClient();
    const { data, error } = await resend.emails.send({ from, to, subject, html, text });
    if (error) {
      console.error('[email] send failed', { to, subject, error });
      return;
    }
    console.log('[email] sent', { to, subject, id: data?.id });
  } catch (err) {
    console.error('[email] send threw', { to, subject, err });
  }
}
