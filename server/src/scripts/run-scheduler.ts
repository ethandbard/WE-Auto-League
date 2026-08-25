// Standalone scheduler process. Run alongside the API (`npm run scheduler`,
// or as a second container in production). Every job is wrapped in a
// Postgres advisory lock, so running this more than once is safe — see
// CLAUDE.md and src/scheduler/lock.ts.
import cron from 'node-cron';
import { runScheduledJobs } from '../scheduler/jobs.js';

console.log('[scheduler] starting — checking every 15 minutes');

cron.schedule('*/15 * * * *', () => {
  runScheduledJobs().catch((err) => console.error('[scheduler] run failed', err));
});

// Run once immediately on boot rather than waiting for the first tick.
runScheduledJobs().catch((err) => console.error('[scheduler] initial run failed', err));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[scheduler] ${signal} received, shutting down`);
    process.exit(0);
  });
}
