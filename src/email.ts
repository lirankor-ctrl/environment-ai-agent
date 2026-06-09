import nodemailer from 'nodemailer';
import { config } from './config.js';
import { log } from './logger.js';
import { REPORT_TITLE } from './report.js';

/**
 * Send the weekly report by email via SMTP (Gmail by default).
 * Honors the SEND_EMAIL safety switch: when not "true", it only previews.
 */
export async function sendReportEmail(html: string, markdown: string): Promise<void> {
  const subject = `${REPORT_TITLE} – ${new Date().toLocaleDateString('he-IL')}`;

  if (!config.email.send) {
    log.warn('SEND_EMAIL is not "true" — DRY RUN. No email will be sent.');
    log.info(`Would send to: ${config.email.to || '(EMAIL_TO not set)'}`);
    log.info(`Subject: ${subject}`);
    log.info('--- report preview (first 600 chars) ---');
    console.log(markdown.slice(0, 600));
    return;
  }

  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_TO'].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    throw new Error(`Cannot send email — missing env vars: ${missing.join(', ')}`);
  }

  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });

  log.info(`Sending email to ${config.email.to} via ${config.smtp.host}…`);
  const info = await transporter.sendMail({
    from: config.email.from,
    to: config.email.to,
    subject,
    text: markdown,
    html,
  });
  log.info(`Email sent ✓ messageId=${info.messageId}`);
}
