import 'dotenv/config';

export const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
  // Strict freshness window: only items published within this many days are kept.
  freshnessDays: Number(process.env.FRESHNESS_DAYS ?? 7),
  // Extended rolling cache window (days) — backs the "background/older updates"
  // fallback section when the current week is unusually quiet.
  extendedWindowDays: Number(process.env.EXTENDED_WINDOW_DAYS ?? 30),
  // Minimum weekly item count before the fallback section kicks in.
  minWeeklyItems: Number(process.env.MIN_WEEKLY_ITEMS ?? 5),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
  },
  email: {
    from: process.env.EMAIL_FROM ?? '',
    to: process.env.EMAIL_TO ?? '',
    // Safety: only ever send real mail when this is exactly "true".
    send: (process.env.SEND_EMAIL ?? 'false').toLowerCase() === 'true',
  },
};
