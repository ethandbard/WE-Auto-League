// MCP server exposing the same write/read operations as the REST API and the
// web grid — see docs/build-plan.html §Integration seams. Authenticates with
// the same scoped API keys as /api/v1 (env var MCP_API_KEY), so a call here
// is indistinguishable downstream from one made over REST, except in its
// provenance field ("mcp" instead of "api").
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys, announcements } from '../db/schema.js';
import { hashApiKey } from '../routes/apiKeys.js';
import { recordSubmission } from '../routes/submissions.js';
import { currentScoresFor } from '../scoring/compute.js';

async function authenticate() {
  const raw = process.env.MCP_API_KEY;
  if (!raw) throw new Error('MCP_API_KEY is not set. Create a key via POST /api/api-keys and export it before starting this process.');
  const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hashApiKey(raw)), isNull(apiKeys.revokedAt))).limit(1);
  if (!row) throw new Error('MCP_API_KEY is invalid or has been revoked.');
  return row;
}

export async function buildMcpServer() {
  const apiKey = await authenticate();
  const scopes = apiKey.scopes as string[];

  const server = new McpServer({ name: 'we-auto-league', version: '0.1.0' });

  server.tool(
    'submit_metrics',
    "Files a store's numbers for a period — the same MetricSource.submit operation the web entry grid and CSV import use. Advisor category keys: csi100s, elr, cpDollars, hpro, totalDollars, wc, wcConv. Manager category keys: csiGoalPct, cpGoalPct, grossGoalPct.",
    {
      dealershipId: z.number().int().positive(),
      periodId: z.number().int().positive(),
      advisorValues: z.array(z.object({ employeeId: z.number().int().positive(), values: z.record(z.string(), z.number()) })).default([]),
      managerValues: z.record(z.string(), z.number()).default({}),
    },
    async ({ dealershipId, periodId, advisorValues, managerValues }) => {
      if (!scopes.includes('submit')) throw new Error('This API key does not have "submit" scope.');
      if (apiKey.dealershipId != null && apiKey.dealershipId !== dealershipId) throw new Error('This API key is scoped to a different store.');
      const result = await recordSubmission({ dealershipId, periodId, advisorValues, managerValues }, { submittedBy: apiKey.createdBy, provenance: 'mcp' });
      return { content: [{ type: 'text', text: JSON.stringify({ submissionId: result.submission!.id, onTime: result.submission!.onTime, valueCount: result.valueCount }) }] };
    },
  );

  server.tool(
    'get_standings',
    'Reads the current (highest-revision) scores for a period — advisor, manager, or team scope.',
    { periodId: z.number().int().positive(), scope: z.enum(['advisor', 'manager', 'team']).optional() },
    async ({ periodId, scope }) => {
      if (!scopes.includes('read')) throw new Error('This API key does not have "read" scope.');
      const rows = await currentScoresFor(periodId, scope);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  server.tool(
    'post_announcement',
    'Posts a message-board announcement, attributed to this key\'s creator.',
    {
      title: z.string().min(1),
      body: z.string().min(1),
      audience: z.enum(['all', 'managers', 'advisors', 'store']).default('all'),
      dealershipId: z.number().int().positive().optional(),
    },
    async ({ title, body, audience, dealershipId }) => {
      if (!scopes.includes('submit')) throw new Error('This API key does not have "submit" scope.');
      const [row] = await db
        .insert(announcements)
        .values({ leagueId: apiKey.leagueId, authorId: apiKey.createdBy, title, body, audience, dealershipId })
        .returning();
      return { content: [{ type: 'text', text: JSON.stringify({ announcementId: row!.id }) }] };
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = await buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp] WE Auto League MCP server ready on stdio');
}
