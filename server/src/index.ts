import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { env } from './env.js';
import { db, pool } from './db/client.js';
import { errorHandler, asyncHandler } from './http.js';
import { attachActor } from './middleware.js';
import { runScheduledJobs } from './scheduler/jobs.js';
import { authRouter } from './routes/auth.js';
import { periodsRouter } from './routes/periods.js';
import { dealershipsRouter } from './routes/dealerships.js';
import { employeesRouter } from './routes/employees.js';
import { categoriesRouter } from './routes/categories.js';
import { goalsRouter } from './routes/goals.js';
import { submissionsRouter } from './routes/submissions.js';
import { importRouter } from './routes/import.js';
import { exportRouter } from './routes/export.js';
import { scoresRouter } from './routes/scores.js';
import { penaltiesRouter } from './routes/penalties.js';
import { announcementsRouter } from './routes/announcements.js';
import { adminRouter } from './routes/admin.js';
import { apiKeysRouter } from './routes/apiKeys.js';
import { externalRouter } from './routes/external.js';
import { leaguesRouter } from './routes/leagues.js';
import { emailRecipientsRouter } from './routes/emailRecipients.js';
import { emailSettingsRouter, emailTemplatesRouter } from './routes/emailSettings.js';

const app = express();

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(attachActor());

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    await db.execute(sql`select 1`);
    res.json({ status: 'ok', time: new Date().toISOString() });
  }),
);

app.use('/api/auth', authRouter);
app.use('/api/periods', periodsRouter);
app.use('/api/dealerships', dealershipsRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/import', importRouter);
app.use('/api/export', exportRouter);
app.use('/api/scores', scoresRouter);
app.use('/api/penalties', penaltiesRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/api-keys', apiKeysRouter);
app.use('/api/leagues', leaguesRouter);
app.use('/api/email-recipients', emailRecipientsRouter);
app.use('/api/email-settings', emailSettingsRouter);
app.use('/api/email-templates', emailTemplatesRouter);
// The scoped-key REST surface — Phase 7's integration seam. Deliberately
// outside attachActor's session model; external.ts authenticates its own way.
app.use('/api/v1', externalRouter);

// In production the client is built into ../client/dist relative to this
// file's compiled location (server/dist/index.js). Serving it here keeps the
// app to a single container with no separate reverse proxy.
if (process.env.NODE_ENV === 'production') {
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(here, '../../client/dist');
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(resolve(clientDist, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port}`);
});

// Runs in-process rather than as a separate container: every job takes a
// Postgres advisory lock (src/scheduler/lock.ts), so this is safe even if
// `npm run scheduler` is also running standalone, or the app scales to
// multiple instances — only one wins the lock per tick. Disable with
// ENABLE_SCHEDULER=false (e.g. to run the scheduler as its own process instead).
if ((process.env.ENABLE_SCHEDULER ?? 'true').toLowerCase() !== 'false') {
  cron.schedule('*/15 * * * *', () => {
    runScheduledJobs().catch((err) => console.error('[scheduler] run failed', err));
  });
  console.log('[scheduler] running in-process, checking every 15 minutes');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
