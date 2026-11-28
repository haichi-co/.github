// Protected-main authorization for the hosted skill-sync workflow.
// No App credential is accepted or read by this guard.
import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type SyncPolicy = { enabled: boolean; dry_run_only: boolean; app_client_id: string };
const REPOSITORY = 'haichi-co/.github';
const MAIN_REF = 'refs/heads/main';
const MAIN_API = 'https://api.github.com/repos/haichi-co/.github/git/ref/heads/main';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function parsePolicy(text: string): SyncPolicy {
  const raw: unknown = JSON.parse(text);
  assert(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'Invalid sync policy object');
  const v = raw as Record<string, unknown>;
  assert(Object.keys(v).length === 3 && typeof v.enabled === 'boolean' && typeof v.dry_run_only === 'boolean' &&
    typeof v.app_client_id === 'string' && /^Iv[0-9A-Za-z.]+$/.test(v.app_client_id) && !/\s/.test(v.app_client_id), 'Invalid sync policy fields');
  const policy = { enabled: v.enabled, dry_run_only: v.dry_run_only, app_client_id: v.app_client_id };
  // One canonical representation prevents duplicate keys and ambiguous review diffs.
  assert(text === JSON.stringify(policy, null, 2) + '\n', 'Non-canonical sync policy JSON');
  return policy;
}

export type RunContext = {
  repository?: string; ref?: string; event?: string; sha?: string; checkedOutSha?: string;
  dryRun?: string; configuredClientId?: string;
};

export function assertTrustedRun(run: RunContext): asserts run is RunContext & { sha: string } {
  assert(run.repository === REPOSITORY && run.ref === MAIN_REF &&
    ['push', 'schedule', 'workflow_dispatch'].includes(run.event ?? ''), 'Untrusted sync workflow context');
  assert(typeof run.sha === 'string' && /^[0-9a-f]{40}$/.test(run.sha) &&
    run.checkedOutSha === run.sha, 'Unexpected sync checkout SHA');
  assert(run.dryRun === 'true' || run.dryRun === 'false', 'Invalid dry-run input');
  assert(run.event === 'workflow_dispatch' || run.dryRun === 'false', 'Unexpected dry-run trigger');
}

export function authorize(policy: SyncPolicy, run: RunContext): boolean {
  assertTrustedRun(run);
  if (!policy.enabled) return false;
  if (policy.dry_run_only && !(run.event === 'workflow_dispatch' && run.dryRun === 'true')) return false;
  assert(run.configuredClientId === policy.app_client_id, 'Configured App client ID does not match reviewed policy');
  return true;
}

export async function assertCurrentMain(sha: string, readToken: string, fetcher: typeof fetch = fetch): Promise<void> {
  assert(/^[0-9a-f]{40}$/.test(sha) && readToken.length > 0, 'Missing current-main check input');
  const response = await fetcher(MAIN_API, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${readToken}`,
      'Cache-Control': 'no-cache', 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, 'Unable to verify current main');
  const ref: unknown = await response.json();
  assert(ref !== null && typeof ref === 'object' && 'ref' in ref && ref.ref === MAIN_REF &&
    'object' in ref && ref.object !== null && typeof ref.object === 'object' &&
    'type' in ref.object && ref.object.type === 'commit' &&
    'sha' in ref.object && ref.object.sha === sha, 'Stale or invalid current main');
}

async function main() {
  const mode = process.argv[2];
  const policy = parsePolicy(readFileSync('.github/skill-sync-policy.json', 'utf8'));
  if (mode === '--validate-config') {
    console.log('Skill-sync policy valid.');
    return;
  }
  assert(mode === '--authorize' || mode === '--assert-authorized', 'Invalid skill-sync policy command');
  const run: RunContext = {
    repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF,
    event: process.env.GITHUB_EVENT_NAME, sha: process.env.GITHUB_SHA,
    checkedOutSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dryRun: process.env.DRY_RUN, configuredClientId: process.env.CONFIGURED_APP_CLIENT_ID,
  };
  const allowed = authorize(policy, run);
  if (!allowed) {
    assert(mode === '--authorize', 'Sync is no longer authorized');
    assert(process.env.GITHUB_OUTPUT, 'Missing runner output file');
    appendFileSync(process.env.GITHUB_OUTPUT, 'enabled=false\n');
    console.log('Sync not authorized by reviewed policy; skipping all App token steps.');
    return;
  }
  assertTrustedRun(run);
  await assertCurrentMain(run.sha, process.env.READ_TOKEN ?? '');
  if (mode === '--authorize') {
    assert(process.env.GITHUB_OUTPUT, 'Missing runner output file');
    appendFileSync(process.env.GITHUB_OUTPUT, `enabled=true\nclient-id=${policy.app_client_id}\n`);
  }
  console.log('Reviewed policy and current main authorize this sync invocation.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Fixed diagnostics only: never emit raw HTTP responses, token values or environment values.
    if (error instanceof SyntaxError) console.error('Skill-sync policy is not valid JSON.');
    else console.error('Skill-sync authorization failed closed.');
    process.exitCode = 1;
  });
}
