import { Worker } from '@temporalio/worker';
import { Connection, Client } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import { historyFromJSON } from '@temporalio/common/lib/proto-utils';
import * as proto from '@temporalio/proto';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

// Workaround for proto3-json-serializer >= 2.0.2 throwing on `map<string, bytes>`
// fields like Payload.metadata (which holds Buffer values such as
// Buffer.from('json/plain')). @temporalio/common's historyToJSON routes
// through that serializer and dies before it can fix up buffers.
// We bypass it entirely with protobuf.js's own toObject, then post-walk to
// rewrite google.protobuf.Timestamp and google.protobuf.Duration nodes
// into the RFC3339 / "Ns" string forms that historyFromJSON expects.
function formatTimestamp(value: { seconds?: string | number; nanos?: number }): string {
  const secs = Number(value.seconds ?? 0);
  const nanos = Number(value.nanos ?? 0);
  const iso = new Date(secs * 1000).toISOString(); // .000Z suffix
  if (nanos === 0) return iso;
  const frac = String(nanos).padStart(9, '0').replace(/0+$/, '');
  return `${iso.slice(0, -5)}.${frac}Z`; // replace .000Z
}

function formatDuration(value: { seconds?: string | number; nanos?: number }): string {
  const secs = String(value.seconds ?? '0');
  const nanos = Number(value.nanos ?? 0);
  if (nanos === 0) return `${secs}s`;
  const frac = String(Math.abs(nanos)).padStart(9, '0').replace(/0+$/, '');
  return `${secs}.${frac}s`;
}

function rewriteSpecialTypes(value: unknown, type: unknown): unknown {
  if (value === null || value === undefined || !type) return value;
  const t = type as { fullName?: string; fields?: Record<string, unknown> };

  if (t.fullName === '.google.protobuf.Timestamp') {
    return formatTimestamp(value as { seconds?: string | number; nanos?: number });
  }
  if (t.fullName === '.google.protobuf.Duration') {
    return formatDuration(value as { seconds?: string | number; nanos?: number });
  }

  if (!t.fields || typeof value !== 'object' || Array.isArray(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const field = t.fields[key] as
      | { resolvedType?: unknown; repeated?: boolean; map?: boolean }
      | undefined;
    if (!field || !field.resolvedType) {
      out[key] = val;
      continue;
    }
    const resolved = field.resolvedType;
    if (field.repeated && Array.isArray(val)) {
      out[key] = val.map((item) => rewriteSpecialTypes(item, resolved));
    } else if (field.map && val && typeof val === 'object') {
      const m: Record<string, unknown> = {};
      for (const [mk, mv] of Object.entries(val as Record<string, unknown>)) {
        m[mk] = rewriteSpecialTypes(mv, resolved);
      }
      out[key] = m;
    } else {
      out[key] = rewriteSpecialTypes(val, resolved);
    }
  }
  return out;
}

function historyToJSON(history: proto.temporal.api.history.v1.IHistory): string {
  const HistoryType = proto.temporal.api.history.v1.History;
  // resolveAll is idempotent; ensures field.resolvedType is populated.
  (HistoryType as unknown as { resolveAll: () => void }).resolveAll();
  const message = HistoryType.fromObject(history as object);
  const obj = HistoryType.toObject(message, {
    bytes: String,
    enums: String,
    longs: String,
    defaults: false,
  });
  const rewritten = rewriteSpecialTypes(obj, HistoryType);
  return JSON.stringify(rewritten, null, 2);
}

// Resolved against the host repo's cwd, not __dirname, so the script works
// whether it's run in-tree or from a Claude Code plugin install dir
// (~/.claude/plugins/.../temporal-replay-guard/). Override either via env
// var if the host repo's layout differs from the defaults.
const HISTORIES_DIR = process.env.REPLAY_HISTORIES_DIR
  ? resolve(process.env.REPLAY_HISTORIES_DIR)
  : resolve(process.cwd(), 'histories');
const WORKFLOWS_PATH = require.resolve(
  resolve(process.cwd(), process.env.REPLAY_WORKFLOWS_PATH ?? 'src/workflows'),
);

const TARGET_COUNT = Number(process.env.REPLAY_HISTORIES_COUNT ?? '5');
const RUNNING_QUERY = process.env.REPLAY_RUNNING_QUERY ?? "ExecutionStatus='Running'";
const COMPLETED_QUERY = process.env.REPLAY_COMPLETED_QUERY ?? "ExecutionStatus='Completed'";
const FORCE_DOWNLOAD = process.env.REPLAY_FORCE_DOWNLOAD === '1';

function listHistoryFiles(): string[] {
  if (!existsSync(HISTORIES_DIR)) return [];
  return readdirSync(HISTORIES_DIR).filter((f) => f.endsWith('.json'));
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

async function downloadHistoriesForQuery(
  client: Client,
  query: string,
  target: number,
  existing: Set<string>,
): Promise<number> {
  let saved = 0;
  for await (const info of client.workflow.list({ query })) {
    if (saved >= target) break;
    const slug = sanitizeFilename(info.workflowId);
    if (existing.has(slug)) continue;

    try {
      const handle = client.workflow.getHandle(info.workflowId, info.runId);
      const history = await handle.fetchHistory();
      writeFileSync(join(HISTORIES_DIR, `${slug}.json`), historyToJSON(history));
      console.log(`  saved ${slug}.json`);
      existing.add(slug);
      saved++;
    } catch (err) {
      console.warn(`  skipped ${info.workflowId}: ${(err as Error).message}`);
    }
  }
  return saved;
}

async function ensureHistories(): Promise<string[]> {
  const files = listHistoryFiles();

  if (files.length > 0 && !FORCE_DOWNLOAD) {
    return files;
  }

  try {
    const config = loadClientConnectConfig();
    const connection = await Connection.connect(config.connectionOptions);
    try {
      const client = new Client({ connection, namespace: config.namespace });
      mkdirSync(HISTORIES_DIR, { recursive: true });

      const existing = FORCE_DOWNLOAD
        ? new Set<string>()
        : new Set(listHistoryFiles().map((f) => f.replace(/\.json$/, '')));

      console.log(`Fetching up to ${TARGET_COUNT} histories matching: ${RUNNING_QUERY}`);
      let saved = await downloadHistoriesForQuery(client, RUNNING_QUERY, TARGET_COUNT, existing);

      if (saved < TARGET_COUNT) {
        const remaining = TARGET_COUNT - saved;
        console.log(
          `Running yielded ${saved}. Falling back to ${COMPLETED_QUERY} for ${remaining} more.`,
        );
        saved += await downloadHistoriesForQuery(client, COMPLETED_QUERY, remaining, existing);
      }

      const total = listHistoryFiles().length;
      if (total === 0) {
        console.warn(
          `No running or completed workflows yielded usable histories. Replay test is a no-op.`,
        );
      } else if (saved < TARGET_COUNT) {
        console.warn(`Wanted ${TARGET_COUNT} histories, got ${total}.`);
      }
    } finally {
      await connection.close();
    }
  } catch (err) {
    console.warn(`Could not reach Temporal to download histories: ${(err as Error).message}`);
    if (files.length === 0) {
      console.warn('No cached histories available. Skipping replay test.');
    } else {
      console.warn(`Falling back to ${files.length} cached history file(s).`);
    }
  }

  return listHistoryFiles();
}

async function runReplays(files: string[]): Promise<number> {
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  for (const file of files) {
    const name = file.replace(/\.json$/, '');
    let history;
    try {
      const raw = JSON.parse(readFileSync(join(HISTORIES_DIR, file), 'utf8'));
      history = historyFromJSON(raw);
    } catch (err) {
      results.push({ name, ok: false, error: `Invalid history JSON: ${(err as Error).message}` });
      continue;
    }

    try {
      await Worker.runReplayHistory({ workflowsPath: WORKFLOWS_PATH }, history, name);
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: (err as Error).message });
    }
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`PASS  ${r.name}`);
    } else {
      console.error(`FAIL  ${r.name}`);
      console.error(`      ${r.error}`);
    }
  }

  return results.filter((r) => !r.ok).length;
}

async function main(): Promise<void> {
  const files = await ensureHistories();
  if (files.length === 0) {
    return;
  }

  const failed = await runReplays(files);
  if (failed > 0) {
    console.error(`\n${failed} of ${files.length} replay test(s) failed.`);
    console.error('Staged workflow code would cause non-determinism errors when');
    console.error('in-flight workflow executions resume. Fix with workflow.patched()');
    console.error('or revert the offending change before committing.');
    process.exit(1);
  }

  console.log(`\nAll ${files.length} replay test(s) passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
