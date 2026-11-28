// Deliberately separate from skill-sync: an Administration-capable App is never
// trusted with arbitrary runtime targets. Only reviewed deployment configuration.
import { createPrivateKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type ObjectValue = Record<string, unknown>;
type Identity = { login: string; id: number };
type AppIdentity = { client_id: string; id: number; installation_id: number };
export type Config = {
  enabled: boolean; apply_enabled: boolean;
  organization: Identity; central_repository: { name: string; id: number };
  owner: Identity; machine: Identity; expected_base_permission: 'none' | 'read' | 'write';
  app: AppIdentity | { client_id: null; id: null; installation_id: null };
};
type Repo = { id: number; name: string; archived: boolean; disabled: boolean; private: boolean };
type Role = 'none' | 'read' | 'triage' | 'write' | 'maintain' | 'admin';
type Permissions = Record<string, 'read' | 'write'>;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type Reply = { status: number; data?: unknown };
export type Request = (token: string, method: Method, path: string, body?: unknown) => Promise<Reply>;
const APP_PERMISSIONS: Permissions = { administration: 'write', metadata: 'read', members: 'read' };
const INVENTORY_PERMISSIONS: Permissions = { metadata: 'read', members: 'read' };
const WRITER_PERMISSIONS: Permissions = { administration: 'write', metadata: 'read' };
const WORKFLOW = '.github/workflows/reconcile-repo-admin.yml';
const MAIN = 'refs/heads/main';
const MAX_REPOS = 10_000;
const loginPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;
const repoPattern = /^[a-zA-Z0-9_.-]{1,100}$/;

class Failure extends Error {}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Failure(message);
}
function object(value: unknown, message: string): ObjectValue {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), message);
  return value as ObjectValue;
}
function exact(obj: ObjectValue, keys: readonly string[], message: string) {
  check(Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k)), message);
}
function id(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_REPOS;
}
function equalLogin(a: unknown, b: string) {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}
function identity(value: unknown): Identity {
  const v = object(value, 'Invalid identity');
  exact(v, ['login', 'id'], 'Invalid identity fields');
  check(typeof v.login === 'string' && loginPattern.test(v.login) && id(v.id), 'Invalid identity values');
  return { login: v.login, id: v.id };
}
export function parseConfig(text: string): Config {
  const v = object(JSON.parse(text), 'Invalid configuration');
  exact(v, ['enabled','apply_enabled','organization','central_repository','owner','machine','expected_base_permission','app'], 'Invalid config fields');
  check(typeof v.enabled === 'boolean' && typeof v.apply_enabled === 'boolean' &&
    (!v.apply_enabled || v.enabled), 'Invalid mode configuration');
  const org = identity(v.organization), owner = identity(v.owner), machine = identity(v.machine);
  check(owner.id !== machine.id && !equalLogin(owner.login, machine.login), 'Owner and machine must differ');
  const central = object(v.central_repository, 'Invalid central repository');
  exact(central, ['name','id'], 'Invalid central repository fields');
  check(central.name === '.github' && id(central.id), 'Invalid central repository identity');
  const base = v.expected_base_permission;
  check(base === 'none' || base === 'read' || base === 'write', 'Invalid expected non-admin base permission');
  const a = object(v.app, 'Invalid App binding');
  exact(a, ['client_id','id','installation_id'], 'Invalid App fields');
  let app: Config['app'];
  if (a.client_id === null && a.id === null && a.installation_id === null) {
    check(!v.enabled, 'Unbound App must remain disabled');
    app = { client_id: null, id: null, installation_id: null };
  } else {
    check(typeof a.client_id === 'string' && /^Iv[0-9A-Za-z.]+$/.test(a.client_id) &&
      id(a.id) && id(a.installation_id), 'Invalid or incomplete App binding');
    app = { client_id: a.client_id, id: a.id, installation_id: a.installation_id };
  }
  const config: Config = { enabled: v.enabled, apply_enabled: v.apply_enabled, organization: org,
    central_repository: { name: central.name, id: central.id }, owner, machine, expected_base_permission: base, app };
  check(text === JSON.stringify(config, null, 2) + '\n', 'Non-canonical config');
  return config;
}

export type RunContext = { repository?: string; repositoryId?: string; ownerId?: string; ref?: string;
  event?: string; sha?: string; checkedOutSha?: string; workflowRef?: string; dryRun?: string };
export function authorize(config: Config, run: RunContext): boolean {
  if (!config.enabled) return false;
  const full = `${config.organization.login}/${config.central_repository.name}`;
  check(run.repository === full && run.repositoryId === String(config.central_repository.id) &&
    run.ownerId === String(config.organization.id) && run.ref === MAIN &&
    run.workflowRef === `${full}/${WORKFLOW}@${MAIN}`, 'Untrusted deployment context');
  check(run.event === 'workflow_dispatch' || run.event === 'schedule', 'Untrusted trigger');
  check(typeof run.sha === 'string' && /^[0-9a-f]{40}$/.test(run.sha) && run.sha === run.checkedOutSha, 'Unexpected checkout');
  check(run.dryRun === 'true' || run.dryRun === 'false', 'Invalid dry run choice');
  check(run.event === 'workflow_dispatch' || run.dryRun === 'false', 'Unexpected scheduled mode');
  return config.apply_enabled || (run.event === 'workflow_dispatch' && run.dryRun === 'true');
}

async function expect(request: Request, token: string, method: Method, path: string,
  status: number, body?: unknown): Promise<unknown> {
  const reply = await request(token, method, path, body);
  check(reply.status === status, `Unexpected API status ${reply.status} (expected ${status})`);
  return reply.data;
}
const get = (request: Request, token: string, path: string) => expect(request, token, 'GET', path, 200);
function assertIdentity(raw: unknown, expected: Identity, message: string) {
  const v = object(raw, message);
  check(v.id === expected.id && equalLogin(v.login, expected.login), message);
}
function assertPermissions(raw: unknown, expected: Permissions) {
  const p = object(raw, 'Missing token permissions');
  exact(p, Object.keys(expected), 'Unexpected permission set');
  check(Object.entries(expected).every(([k, v]) => p[k] === v), 'Unexpected permission level');
}
async function assertApp(config: Config, auth: () => string, request: Request): Promise<AppIdentity> {
  check(config.app.id !== null && config.app.client_id !== null && config.app.installation_id !== null, 'Missing App binding');
  const expected = config.app;
  const app = object(await get(request, auth(), '/app'), 'Invalid App identity response');
  check(app.id === expected.id && app.client_id === expected.client_id && app.public === false &&
    Array.isArray(app.events) && app.events.length === 0, 'Unexpected App registration');
  assertIdentity(app.owner, config.organization, 'Unexpected App owner');
  assertPermissions(app.permissions, APP_PERMISSIONS);
  const installation = object(await get(request, auth(), `/app/installations/${expected.installation_id}`), 'Invalid installation');
  check(installation.id === expected.installation_id && installation.app_id === expected.id &&
    installation.target_id === config.organization.id && installation.target_type === 'Organization' &&
    installation.repository_selection === 'all' && installation.suspended_at === null, 'Unexpected installation');
  assertIdentity(installation.account, config.organization, 'Unexpected installation owner');
  assertPermissions(installation.permissions, APP_PERMISSIONS);
  return expected;
}
function parseRepo(raw: unknown, config: Config): Repo {
  const v = object(raw, 'Invalid repository result');
  check(id(v.id) && typeof v.name === 'string' && repoPattern.test(v.name) &&
    v.name !== '.' && v.name !== '..' && typeof v.archived === 'boolean' &&
    typeof v.disabled === 'boolean' && typeof v.private === 'boolean', 'Missing or invalid repository metadata');
  assertIdentity(v.owner, config.organization, 'Repository owner mismatch');
  check(equalLogin(v.full_name, `${config.organization.login}/${v.name}`), 'Unexpected repository full name');
  return { id: v.id, name: v.name, archived: v.archived, disabled: v.disabled, private: v.private };
}
export function excluded(config: Config, repo: { id: number; name: string }): boolean {
  return repo.id === config.central_repository.id || repo.name.toLowerCase() === '.github';
}
function sameRepo(a: Repo, b: Repo) {
  return a.id === b.id && a.name === b.name && a.archived === b.archived && a.disabled === b.disabled && a.private === b.private;
}
async function listRepositories(config: Config, request: Request, token: string): Promise<Repo[]> {
  let total: number | undefined;
  const repos: Repo[] = [], ids = new Set<number>(), names = new Set<string>();
  for (let page = 1; page <= MAX_REPOS / 100 + 1; page++) {
    const v = object(await get(request, token, `/installation/repositories?per_page=100&page=${page}`), 'Invalid installation inventory');
    check(count(v.total_count) && Array.isArray(v.repositories), 'Incomplete installation inventory');
    total ??= v.total_count;
    check(v.total_count === total && v.repositories.length === Math.min(100, total - repos.length), 'Unstable or incomplete pagination');
    for (const raw of v.repositories) {
      const repo = parseRepo(raw, config);
      check(!ids.has(repo.id) && !names.has(repo.name.toLowerCase()), 'Duplicate repository inventory');
      ids.add(repo.id); names.add(repo.name.toLowerCase()); repos.push(repo);
    }
    if (repos.length === total) return repos.sort((a, b) => a.id - b.id);
  }
  throw new Failure('Inventory exceeds safe pagination bound');
}

function repoPath(config: Config, repo: Repo) {
  return `/repos/${config.organization.login}/${repo.name}`;
}
async function readRepo(config: Config, request: Request, token: string, repo: Repo): Promise<Repo> {
  const actual = parseRepo(await get(request, token, repoPath(config, repo)), config);
  check(sameRepo(actual, repo), 'Repository changed since discovery');
  return actual;
}
async function role(config: Config, request: Request, token: string, repo: Repo): Promise<Role> {
  const p = object(await get(request, token, `${repoPath(config, repo)}/collaborators/${config.machine.login}/permission`), 'Invalid permission result');
  assertIdentity(p.user, config.machine, 'Collaborator identity mismatch');
  const base: Record<Role, string> = { none: 'none', read: 'read', triage: 'read', write: 'write', maintain: 'write', admin: 'admin' };
  check(typeof p.role_name === 'string' && Object.hasOwn(base, p.role_name), 'Unknown effective repository role');
  const name = p.role_name as Role;
  check(p.permission === base[name], 'Inconsistent effective permission');
  return name;
}
async function membership(config: Config, request: Request, token: string, person: Identity, expectedRole: string) {
  const result = object(await get(request, token, `/orgs/${config.organization.login}/memberships/${person.login}`), 'Invalid membership result');
  check(result.state === 'active' && result.role === expectedRole, 'Organization membership drift');
  assertIdentity(result.organization, config.organization, 'Membership organization mismatch');
  assertIdentity(result.user, person, 'Membership user mismatch');
}
async function orgCounts(config: Config, request: Request, token: string): Promise<{ public: number; private: number }> {
  const o = object(await get(request, token, `/orgs/${config.organization.login}`), 'Invalid organization');
  assertIdentity(o, config.organization, 'Organization identity mismatch');
  // Narrow tokens may not return the exact base role. Central effective Maintain
  // plus active non-owner membership excludes blanket Admin; owner verifies the
  // exact base separately. Any visible unexpected base role stops execution.
  check(o.default_repository_permission == null || o.default_repository_permission === config.expected_base_permission, 'Organization base role drift');
  check(count(o.public_repos) && count(o.owned_private_repos) &&
    o.public_repos + o.owned_private_repos <= MAX_REPOS, 'Unavailable or excessive organization inventory counts');
  return { public: o.public_repos, private: o.owned_private_repos };
}
async function boundary(config: Config, request: Request, token: string, central: Repo, repos: Repo[]) {
  const counts = await orgCounts(config, request, token);
  check(counts.public === repos.filter(r => !r.private).length &&
    counts.private === repos.filter(r => r.private).length, 'Organization and installation inventory disagree');
  await membership(config, request, token, config.owner, 'admin');
  await membership(config, request, token, config.machine, 'member');
  await readRepo(config, request, token, central);
  check(!central.archived && !central.disabled && !central.private && await role(config, request, token, central) === 'maintain', 'Central repository permission drift');
}
async function withToken<T>(config: Config, request: Request, auth: () => string, app: AppIdentity,
  permissions: Permissions, repo: Repo | null, action: (token: string) => Promise<T>): Promise<T> {
  if (repo !== null) check(!excluded(config, repo) && !repo.archived && !repo.disabled, 'Forbidden writer target');
  const tokenReply = object(await expect(request, auth(), 'POST', `/app/installations/${app.installation_id}/access_tokens`, 201,
    { permissions, ...(repo === null ? {} : { repository_ids: [repo.id] }) }), 'Invalid token response');
  check(typeof tokenReply.token === 'string' && tokenReply.token.length > 0, 'Missing installation token');
  const token = tokenReply.token;
  try {
    assertPermissions(tokenReply.permissions, permissions);
    if (repo !== null) {
      const scoped = await listRepositories(config, request, token);
      check(scoped.length === 1 && sameRepo(scoped[0], repo) && !excluded(config, scoped[0]), 'Writer token scope mismatch');
    }
    return await action(token);
  } finally {
    await expect(request, token, 'DELETE', '/installation/token', 204);
  }
}

export type Summary = { dry_run: boolean; inventory: number; excluded: number; archived: number;
  disabled: number; already_admin: number; planned: number; applied: number; converged_during_apply: number };
export async function reconcile(config: Config, dryRun: boolean, request: Request, auth: () => string,
  assertCurrent: () => Promise<void>): Promise<Summary> {
  check(config.enabled && (dryRun || config.apply_enabled), 'Reconcile mode not authorized');
  await assertCurrent();
  const app = await assertApp(config, auth, request);
  return withToken(config, request, auth, app, INVENTORY_PERMISSIONS, null, async (inventoryToken) => {
    const repos = await listRepositories(config, request, inventoryToken);
    const central = repos.find(r => r.id === config.central_repository.id);
    check(central && excluded(config, central), 'Central repository missing from hosted deployment');
    await boundary(config, request, inventoryToken, central, repos);
    const summary: Summary = { dry_run: dryRun, inventory: repos.length, excluded: 0, archived: 0, disabled: 0,
      already_admin: 0, planned: 0, applied: 0, converged_during_apply: 0 };
    const plan: Repo[] = [];
    for (const repo of repos) {
      if (excluded(config, repo)) { summary.excluded++; continue; }
      if (repo.archived) { summary.archived++; continue; }
      if (repo.disabled) { summary.disabled++; continue; }
      await readRepo(config, request, inventoryToken, repo);
      if (await role(config, request, inventoryToken, repo) === 'admin') summary.already_admin++;
      else plan.push(repo);
    }
    summary.planned = plan.length;
    // No mutation (including minting an Admin-capable token) before the complete
    // plan and invariant checks succeed, or ever on a dry run.
    try {
      if (!dryRun) for (const repo of plan) {
        await assertCurrent();
        await boundary(config, request, inventoryToken, central, repos);
        await readRepo(config, request, inventoryToken, repo);
        if (await role(config, request, inventoryToken, repo) === 'admin') {
          summary.converged_during_apply++; continue;
        }
        await assertCurrent();
        await withToken(config, request, auth, app, WRITER_PERMISSIONS, repo, async writer => {
          await assertCurrent();
          await boundary(config, request, inventoryToken, central, repos);
          await readRepo(config, request, writer, repo);
          if (await role(config, request, writer, repo) === 'admin') {
            summary.converged_during_apply++; return;
          }
          check(!excluded(config, repo), 'Forbidden mutation target');
          await assertCurrent();
          await expect(request, writer, 'PUT', `${repoPath(config, repo)}/collaborators/${config.machine.login}`, 204, { permission: 'admin' });
          await readRepo(config, request, writer, repo);
          check(await role(config, request, writer, repo) === 'admin', 'Grant read-back did not converge');
          summary.applied++;
        });
      }
    } finally {
      // Also verify boundary on partial failure, before revoking inventory token.
      await boundary(config, request, inventoryToken, central, repos);
      await assertCurrent();
    }
    return summary;
  });
}

// Fixed origin, bounded GET-only retries, no raw API payloads in diagnostics.
// Never blindly retry a token mint or mutation after an ambiguous outcome.
export const httpRequest: Request = async (token, method, path, body) => {
  check(token.length > 0 && /^\/(?!\/)/.test(path) && !path.includes('\\'), 'Invalid HTTP request');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28', 'cache-control': 'no-cache',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
    } catch {
      if (method !== 'GET' || attempt === 2) throw new Failure('GitHub request failed or timed out');
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    const retry = response.headers.get('retry-after');
    const retrySeconds = retry === null ? null : Number(retry);
    const transient = [429, 502, 503, 504].includes(response.status) || (response.status === 403 && retry !== null);
    if (method === 'GET' && transient && attempt < 2 && (retrySeconds === null || (Number.isFinite(retrySeconds) && retrySeconds >= 0 && retrySeconds <= 20))) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, retrySeconds === null ? 500 * (attempt + 1) : retrySeconds * 1000));
      continue;
    }
    if (!response.ok || response.status === 204) return { status: response.status };
    try { return { status: response.status, data: await response.json() }; }
    catch { throw new Failure('Invalid GitHub JSON response'); }
  }
  throw new Failure('GitHub retry bound exhausted');
};

export async function assertCurrentMain(config: Config, run: RunContext, request: Request, token: string) {
  check(token.length > 0 && typeof run.sha === 'string', 'Missing current-main check input');
  const base = `/repos/${config.organization.login}/${config.central_repository.name}`;
  const repo = parseRepo(await get(request, token, base), config);
  check(repo.id === config.central_repository.id && repo.name === config.central_repository.name &&
    !repo.private && !repo.archived && !repo.disabled, 'Unexpected central repository identity or visibility');
  const path = base + '/branches/main';
  const result = object(await get(request, token, path), 'Invalid main response');
  check(result.name === 'main' && result.protected === true &&
    object(result.commit, 'Invalid main commit').sha === run.sha, 'Stale or unprotected current main');
}
function signer(client: string, pem: string) {
  check(pem.length > 0, 'Missing protected App key');
  const key = createPrivateKey(pem);
  check(key.asymmetricKeyType === 'rsa', 'Invalid App key type');
  return () => {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: client })}`;
    return `${data}.${sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
  };
}
async function main() {
  const config = parseConfig(readFileSync('.github/repo-admin-reconcile.json', 'utf8'));
  check(process.argv.length === 3, 'Invalid command');
  const command = process.argv[2];
  if (command === '--validate-config') { console.log('Repository Admin configuration valid.'); return; }
  check(command === '--authorize' || command === '--run', 'Invalid command');
  const run: RunContext = {
    repository: process.env.GITHUB_REPOSITORY, repositoryId: process.env.GITHUB_REPOSITORY_ID,
    ownerId: process.env.GITHUB_REPOSITORY_OWNER_ID, ref: process.env.GITHUB_REF,
    event: process.env.GITHUB_EVENT_NAME, sha: process.env.GITHUB_SHA,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    checkedOutSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dryRun: process.env.RECONCILE_DRY_RUN,
  };
  const allowed = authorize(config, run);
  const current = () => assertCurrentMain(config, run, httpRequest, process.env.READ_TOKEN ?? '');
  if (command === '--authorize') {
    if (allowed) await current();
    check(process.env.GITHUB_OUTPUT, 'Missing runner output file');
    appendFileSync(process.env.GITHUB_OUTPUT, `authorized=${allowed}\n`);
    console.log(allowed ? 'Reviewed protected main authorizes reconciliation.' : 'Reconciliation disabled for this invocation.');
    return;
  }
  check(allowed && config.app.client_id !== null, 'Reconciliation not authorized');
  await current();
  const auth = signer(config.app.client_id, process.env.REPO_ADMIN_RECONCILE_PRIVATE_KEY ?? '');
  console.log(JSON.stringify(await reconcile(config, run.dryRun === 'true', httpRequest, auth, current)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Only fixed diagnostics; never output paths, JSON responses, private repo names, or secrets.
    console.error(error instanceof Failure ? error.message : 'Repository Admin reconciliation failed closed.');
    process.exitCode = 1;
  });
}
