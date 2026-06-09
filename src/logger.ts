/** Minimal timestamped logger so the agent's activity is easy to follow. */
function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info: (msg: string, ...rest: unknown[]) => console.log(`[${ts()}] ${msg}`, ...rest),
  warn: (msg: string, ...rest: unknown[]) => console.warn(`[${ts()}] ⚠ ${msg}`, ...rest),
  error: (msg: string, ...rest: unknown[]) => console.error(`[${ts()}] ✖ ${msg}`, ...rest),
  step: (msg: string) => console.log(`\n[${ts()}] === ${msg} ===`),
};
