import { strict as assert } from 'node:assert';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePolicy, authorize, assertCurrentMain, type RunContext } from './skill-sync-policy.ts';

const sha = 'a'.repeat(40);
const clientId = 'Iv1.test123';
const base = { enabled: true, dry_run_only: false, app_client_id: clientId };
const canonical = (raw: unknown) => JSON.stringify(raw, null, 2) + '\n';
const run: RunContext = {
  repository: 'haichi-co/.github', ref: 'refs/heads/main', event: 'push',
  sha, checkedOutSha: sha, dryRun: 'false', configuredClientId: clientId,
};

test('policy accepts only exact, canonical typed fields; rejects missing, malformed, duplicate and extra values', () => {
  assert.deepEqual(parsePolicy(canonical(base)), base);
  for (const raw of [
    null, [], {}, { ...base, enabled: 'true' }, { ...base, enabled: 1 },
    { ...base, dry_run_only: 'false' }, { ...base, app_client_id: '' },
    { ...base, app_client_id: 'x\nspoof' }, { ...base, app_client_id: 'Iv1.valid\n' }, { ...base, extra: true },
    { enabled: true, app_client_id: clientId },
  ]) assert.throws(() => parsePolicy(canonical(raw)));
  assert.throws(() => parsePolicy('{"enabled":true'));
  assert.throws(() => parsePolicy(canonical(base).replace('"enabled": true', '"enabled": false,\n  "enabled": true')));
});

test('disabled and dry-run-only policy cannot authorize scheduled or push writes', () => {
  assert.equal(authorize({ ...base, enabled: false }, run), false);
  assert.equal(authorize({ ...base, enabled: false }, { ...run, event: 'workflow_dispatch', dryRun: 'true' }), false);
  const migration = { ...base, dry_run_only: true };
  for (const event of ['push', 'schedule', 'workflow_dispatch']) {
    assert.equal(authorize(migration, { ...run, event }), false);
  }
  assert.equal(authorize(migration, { ...run, event: 'workflow_dispatch', dryRun: 'true' }), true);
  assert.equal(authorize(base, run), true);
  assert.equal(authorize(base, { ...run, event: 'schedule' }), true);
  assert.equal(authorize(base, { ...run, event: 'workflow_dispatch', dryRun: 'false' }), true);
});

test('reviewed flag ignores lower-scope enable values, and only reviewed App identity is accepted', () => {
  const old = process.env.SKILL_SYNC_ENABLED;
  try {
    process.env.SKILL_SYNC_ENABLED = 'true';
    assert.equal(authorize({ ...base, enabled: false }, run), false);
    process.env.SKILL_SYNC_ENABLED = 'false';
    assert.equal(authorize(base, run), true);
  } finally {
    if (old === undefined) delete process.env.SKILL_SYNC_ENABLED;
    else process.env.SKILL_SYNC_ENABLED = old;
  }
  for (const configuredClientId of [undefined, '', 'Iv1.other']) {
    assert.throws(() => authorize(base, { ...run, configuredClientId }), /client ID/);
  }
});

test('reject untrusted event, repo, ref and mismatched checkout', () => {
  for (const patch of [
    { event: 'pull_request' }, { event: 'pull_request_target' }, { event: 'workflow_call' },
    { repository: 'another/.github' }, { ref: 'refs/tags/main' }, { ref: 'refs/heads/unreviewed' },
    { sha: 'bad' }, { checkedOutSha: 'b'.repeat(40) }, { dryRun: 'TRUE' }, { dryRun: 'true' },
  ]) assert.throws(() => authorize(base, { ...run, ...patch }));
});

test('current-main check is read-only, bounded and fails closed on stale SHA or malformed response', async () => {
  const good = { ref: 'refs/heads/main', object: { type: 'commit', sha } };
  const reply = (body: unknown, status = 200) => async () => Response.json(body, { status });
  await assertCurrentMain(sha, 'dummy', async (url, opts) => {
    assert.equal(url, 'https://api.github.com/repos/haichi-co/.github/git/ref/heads/main');
    assert.equal(opts?.method, undefined); // GET
    assert.equal(opts?.redirect, 'error');
    assert.equal(opts?.cache, 'no-store');
    assert.ok(opts?.signal);
    return Response.json(good);
  });
  for (const body of [
    {}, { ...good, ref: 'refs/tags/main' }, { ...good, object: { type: 'commit', sha: 'b'.repeat(40) } },
    { ...good, object: { type: 'tag', sha } }, null,
  ]) await assert.rejects(assertCurrentMain(sha, 'dummy', reply(body)));
  await assert.rejects(assertCurrentMain(sha, 'dummy', reply(good, 403)));
  await assert.rejects(assertCurrentMain(sha, 'dummy', async () => { throw Error('timeout'); }));
  await assert.rejects(assertCurrentMain(sha, '', reply(good)));
});

test('CLI emits no positive authorization for disabled, missing, invalid or mismatched policies', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'haichi-policy-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-q');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture');
    const head = git('rev-parse', 'HEAD');
    mkdirSync(join(cwd, '.github'));
    const config = join(cwd, '.github', 'skill-sync-policy.json');
    const output = join(cwd, 'output');
    const script = fileURLToPath(new URL('./skill-sync-policy.ts', import.meta.url));
    const env = {
      ...process.env, GITHUB_REPOSITORY: 'haichi-co/.github', GITHUB_REF: 'refs/heads/main',
      GITHUB_EVENT_NAME: 'push', GITHUB_SHA: head, DRY_RUN: 'false',
      CONFIGURED_APP_CLIENT_ID: clientId, SKILL_SYNC_ENABLED: 'true',
      READ_TOKEN: '', GITHUB_OUTPUT: output,
    };
    const invoke = (cmd: string) => {
      writeFileSync(output, '');
      return spawnSync(process.execPath, [script, cmd], { cwd, env, encoding: 'utf8' });
    };
    assert.equal(invoke('--authorize').status, 1); // absent
    assert.equal(readFileSync(output, 'utf8'), '');
    writeFileSync(config, '{"enabled":"true"}');
    assert.equal(invoke('--authorize').status, 1);
    assert.equal(readFileSync(output, 'utf8'), '');
    writeFileSync(config, canonical({ ...base, enabled: false }));
    assert.equal(invoke('--authorize').status, 0);
    assert.equal(readFileSync(output, 'utf8'), 'enabled=false\n');
    assert.equal(invoke('--assert-authorized').status, 1);
    assert.equal(readFileSync(output, 'utf8'), '');
    writeFileSync(config, canonical({ ...base, dry_run_only: true }));
    assert.equal(invoke('--authorize').status, 0);
    assert.equal(readFileSync(output, 'utf8'), 'enabled=false\n');
    writeFileSync(config, canonical({ ...base, app_client_id: 'Iv1.wrong' }));
    assert.equal(invoke('--authorize').status, 1);
    assert.equal(readFileSync(output, 'utf8'), '');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
