export interface ResetPasswordEmailInput {
  name: string | null | undefined;
  url: string;
}

export interface VerificationEmailInput {
  name: string | null | undefined;
  url: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function resetPasswordEmail({ name, url }: ResetPasswordEmailInput): RenderedEmail {
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const htmlGreeting = escapeHtml(greeting);
  const htmlUrl = escapeHtml(url);
  const subject = 'Reset your password';

  const text = [
    greeting,
    '',
    'We received a request to reset the password on your App Starter account.',
    'Click the link below to choose a new password. This link expires in 1 hour.',
    '',
    url,
    '',
    "If you didn't request this, you can safely ignore this email — your password will not change.",
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">Reset your password</h1>
      <p style="margin: 0 0 12px;">${htmlGreeting}</p>
      <p style="margin: 0 0 12px;">We received a request to reset the password on your App Starter account. Click the button below to choose a new password. This link expires in 1 hour.</p>
      <p style="margin: 24px 0;">
        <a href="${htmlUrl}" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px;">Reset password</a>
      </p>
      <p style="margin: 0 0 12px; font-size: 13px; color: #555;">Or paste this URL into your browser:<br/><a href="${htmlUrl}" style="color: #555; word-break: break-all;">${htmlUrl}</a></p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="margin: 0; font-size: 13px; color: #555;">If you didn't request this, you can safely ignore this email — your password will not change.</p>
    </div>
  `.trim();

  return { subject, html, text };
}

export function verificationEmail({ name, url }: VerificationEmailInput): RenderedEmail {
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  const htmlGreeting = escapeHtml(greeting);
  const htmlUrl = escapeHtml(url);
  const subject = 'Verify your email';

  const text = [
    greeting,
    '',
    'Welcome to App Starter. Click the link below to verify your email address.',
    '',
    url,
    '',
    "If you didn't create this account, you can safely ignore this email.",
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; color: #111;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">Verify your email</h1>
      <p style="margin: 0 0 12px;">${htmlGreeting}</p>
      <p style="margin: 0 0 12px;">Welcome to App Starter. Click the button below to verify your email address.</p>
      <p style="margin: 24px 0;">
        <a href="${htmlUrl}" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px;">Verify email</a>
      </p>
      <p style="margin: 0 0 12px; font-size: 13px; color: #555;">Or paste this URL into your browser:<br/><a href="${htmlUrl}" style="color: #555; word-break: break-all;">${htmlUrl}</a></p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="margin: 0; font-size: 13px; color: #555;">If you didn't create this account, you can safely ignore this email.</p>
    </div>
  `.trim();

  return { subject, html, text };
}
