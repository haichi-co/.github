// GitHub-native, PR-only synchronization of explicitly managed skill files.
// Works on Node.js 24 with no third-party packages.
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type SkillSyncEntry = {
  owner: string;
  skill: string;
  source: string;
  destination: string;
  managed_files: string[];
  opt_in_topic: string;
};

export type SkillSyncManifest = {
  schema: 'haichi-skill-sync/v3';
  owner: string;
  skills: SkillSyncEntry[];
};

export type Target = { repository: string; skill: string };

export type SyncStatus =
  | 'up_to_date' | 'pr_current' | 'pr_created' | 'pr_updated'
  | 'would_open_pr' | 'would_update_pr' | 'would_create_pr';

export type SyncResult = { repo: string; status: SyncStatus; number?: number };

const BRANCH_PREFIX = 'haichi-skill-sync/';
const MESSAGE_PREFIX = 'chore(skill-sync): update ';
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function object(raw: unknown): Record<string, unknown> {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'Invalid manifest object');
  return raw as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  assert(Object.keys(value).every(key => keys.includes(key)), 'Unexpected manifest property');
}

export function validateManifest(raw: unknown): SkillSyncManifest {
  const value = object(raw);
  assert(value.schema === 'haichi-skill-sync/v3', 'Unsupported manifest schema');
  exactKeys(value, ['schema', 'owner', 'skills']);
  assert(typeof value.owner === 'string' && SAFE_NAME.test(value.owner), 'Invalid owner');
  const owner = value.owner;
  assert(Array.isArray(value.skills) && value.skills.length > 0, 'No skills configured');
  const identifiers = new Set<string>(), topics = new Set<string>();
  const skills = value.skills.map((raw: unknown): SkillSyncEntry => {
    const entry = object(raw);
    exactKeys(entry, ['skill', 'source', 'destination', 'managed_files', 'opt_in_topic']);
    assert(typeof entry.skill === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.skill), 'Invalid skill');
    assert(!identifiers.has(entry.skill), 'Duplicate skill');
    identifiers.add(entry.skill);
    assert(entry.source === `skills/${entry.skill}`, 'Unexpected skill source');
    assert(entry.destination === `.agents/skills/${entry.skill}`, 'Unexpected skill destination');
    assert(Array.isArray(entry.managed_files) && entry.managed_files.length > 0, 'No managed files');
    const files = new Set<string>();
    for (const path of entry.managed_files) {
      assert(typeof path === 'string' && path.split('/').every(part => SAFE_SEGMENT.test(part)), `Invalid file: ${path}`);
      const normalized = path.toLowerCase();
      assert(![...files].some(previous => previous === normalized || previous.startsWith(normalized + '/') || normalized.startsWith(previous + '/')), `Duplicate or overlapping managed file: ${path}`);
      files.add(normalized);
    }
    assert(entry.managed_files.includes('SKILL.md'), 'SKILL.md must be managed');
    assert(typeof entry.opt_in_topic === 'string' && /^haichi-skill-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.opt_in_topic), 'Invalid opt-in topic');
    assert(!topics.has(entry.opt_in_topic), 'Duplicate opt-in topic');
    topics.add(entry.opt_in_topic);
    return { owner, skill: entry.skill, source: entry.source as string, destination: entry.destination as string, managed_files: entry.managed_files as string[], opt_in_topic: entry.opt_in_topic };
  });
  // The exact destination convention and unique lowercase skill keys ensure disjoint directories.
  return { schema: 'haichi-skill-sync/v3', owner, skills };
}

export async function loadConfig(root = process.cwd()): Promise<{ manifest: SkillSyncManifest; contents: Map<string, Map<string, string>> }> {
  const value = JSON.parse(await readFile(resolve(root, '.github/skill-sync.json'), 'utf8'));
  const manifest = validateManifest(value);
  const rootPath = await realpath(root);
  const contents = new Map<string, Map<string, string>>();
  for (const skill of manifest.skills) {
    const content = new Map<string, string>();
    for (const file of skill.managed_files) {
      const path = resolve(rootPath, skill.source, file);
      assert(await realpath(path) === path, `Canonical file must not traverse symlinks: ${file}`);
      const body = await readFile(path, 'utf8');
      assert(body.length > 0, `Empty canonical file: ${file}`);
      content.set(`${skill.destination}/${file}`, body);
    }
    contents.set(skill.skill, content);
  }
  return { manifest, contents };
}

export class Api {
  readonly token: string;
  readonly fetcher: typeof fetch;
  constructor(token: string, fetcher: typeof fetch = fetch) {
    assert(typeof token === 'string' && token.length > 0, 'GH_TOKEN is required');
    this.token = token;
    this.fetcher = fetcher;
  }
  async call(method: string, path: string, body?: unknown, allow404 = false): Promise<any> {
    const resp = await this.fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10',
        'user-agent': 'haichi-skill-sync/1',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allow404 && resp.status === 404) return null;
    if (!resp.ok) throw new Error(`${method} ${path}: HTTP ${resp.status} ${String(await resp.text()).slice(0, 400)}`);
    if (resp.status === 204) return null;
    return await resp.json();
  }
}

/**
 * A read-only installation token enumerates private and public org repositories.
 * Repository topics are the explicit opt-in. Missing topic metadata fails closed.
 */
export async function discoverTargets(api: Api, manifest: SkillSyncManifest): Promise<Target[]> {
  const found: Target[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 1000; page++) {
    const rows = await api.call('GET', `/orgs/${manifest.owner}/repos?type=all&per_page=100&page=${page}`);
    assert(Array.isArray(rows) && rows.length <= 100, 'Incomplete or invalid organization repository listing');
    for (const row of rows) {
      assert(typeof row?.full_name === 'string' &&
        row.owner?.login === manifest.owner &&
        Array.isArray(row.topics) && row.topics.every((topic: unknown) => typeof topic === 'string'),
        'Invalid repository identity or missing topic metadata');
      const [owner, name, extra] = row.full_name.split('/');
      assert(!extra && owner === manifest.owner && (name === '.github' || SAFE_NAME.test(name)),
        `Invalid repository name: ${row.full_name}`);
      assert(!seen.has(name.toLowerCase()), `Duplicate discovered repository: ${name}`);
      seen.add(name.toLowerCase());
      if (name === '.github' || row.archived || row.disabled) continue;
      for (const entry of manifest.skills) {
        if (row.topics.includes(entry.opt_in_topic)) found.push({ repository: name, skill: entry.skill });
      }
    }
    if (rows.length < 100) return found.sort((a, b) => a.repository.localeCompare(b.repository) || a.skill.localeCompare(b.skill));
  }
  throw new Error('Organization repository discovery exceeded the page limit');
}

/** Validate the exact per-skill discovery plan before deriving scoped token targets or writing. */
export function parseDiscoveredTargets(json: string | undefined, manifest: SkillSyncManifest): Target[] {
  assert(typeof json === 'string' && json.length > 0, 'Missing discovered repository targets');
  const raw: unknown = JSON.parse(json);
  assert(Array.isArray(raw), 'Invalid discovered targets');
  const seen = new Set<string>(), names = new Map<string, string>();
  return raw.map((item: unknown) => {
    const value = object(item);
    exactKeys(value, ['repository', 'skill']);
    assert(typeof value.repository === 'string' && SAFE_NAME.test(value.repository) &&
      value.repository.toLowerCase() !== '.github', 'Invalid discovered repository');
    assert(typeof value.skill === 'string' && manifest.skills.some(s => s.skill === value.skill), 'Invalid discovered skill');
    const name = value.repository.toLowerCase();
    assert(!names.has(name) || names.get(name) === value.repository, 'Conflicting discovered repository casing');
    names.set(name, value.repository);
    const key = name + '/' + value.skill;
    assert(!seen.has(key), 'Duplicate discovered target');
    seen.add(key);
    return { repository: value.repository, skill: value.skill };
  });
}

export function targetRepositories(targets: Target[]): string[] {
  return [...new Set(targets.map(target => target.repository))].sort();
}

function assertSafeBranch(branch: string) {
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch) && !branch.includes('..'), 'Unsafe branch name');
}

async function getContents(api: Api, repo: string, path: string, ref: string): Promise<string | null> {
  const result = await api.call('GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, undefined, true);
  if (!result) return null;
  assert(result.type === 'file' && result.encoding === 'base64' && typeof result.content === 'string', `Unmanaged or unreadable file: ${repo}/${path}`);
  return Buffer.from(result.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

async function readManaged(api: Api, repo: string, paths: Set<string>, ref: string): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  for (const path of paths) result.set(path, await getContents(api, repo, path, ref));
  return result;
}

export function isIdentical(expected: ReadonlyMap<string, string>, observed: ReadonlyMap<string, string | null>) {
  return [...expected].every(([name, body]) => observed.get(name) === body);
}

function pullHead(pr: any, branch: string, owner: string) {
  return pr.head?.ref === branch && pr.head?.repo?.owner?.login?.toLowerCase() === owner.toLowerCase();
}

// Refuse to overwrite any branch with unrelated changes or an unknown last commit.
async function verifyManagedBranch(api: Api, repo: string, base: string, branch: string, sha: string, managed: ReadonlySet<string>, skill: string) {
  const commit = await api.call('GET', `/repos/${repo}/git/commits/${sha}`);
  assert(commit.message === MESSAGE_PREFIX + skill, `${repo}: branch has a non-sync commit; manual review required`);
  const compare = await api.call('GET', `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`);
  assert(Array.isArray(compare.files) && compare.files.length < 300, `${repo}: incomplete branch comparison`);
  for (const file of compare.files) {
    assert(managed.has(file.filename) && ['added', 'modified'].includes(file.status), `${repo}: unexpected branch change: ${file.filename}`);
  }
}

export async function syncRepository(api: Api, repo: string, manifest: SkillSyncEntry, expected: ReadonlyMap<string, string>, dryRun = false): Promise<SyncResult> {
  async function checkEnrollment(): Promise<string> {
    const meta = await api.call('GET', `/repos/${repo}`);
    assert(meta.full_name === repo && meta.owner?.login === manifest.owner && !meta.archived && !meta.disabled, `${repo}: repository identity or state mismatch`);
    assert(Array.isArray(meta.topics) && meta.topics.every((topic: unknown) => typeof topic === 'string') && meta.topics.includes(manifest.opt_in_topic), `${repo}: repository is no longer opted in`);
    assert(typeof meta.default_branch === 'string' && meta.default_branch.length, `${repo}: missing default branch`);
    return meta.default_branch;
  }
  const base = await checkEnrollment();
  async function write(method: 'POST' | 'PATCH', path: string, body: unknown) {
    assert(await checkEnrollment() === base, `${repo}: default branch changed`);
    return api.call(method, path, body);
  }
  assertSafeBranch(base);
  const root = `/repos/${repo}`;
  const branch = `${BRANCH_PREFIX}${manifest.skill}`;
  const managed = new Set(expected.keys());
  const baseRef = await api.call('GET', `${root}/git/ref/heads/${base}`);
  const baseSHA = baseRef.object?.sha;
  assert(/^[0-9a-f]{40}$/.test(baseSHA ?? ''), `${repo}: invalid base SHA`);
  const baseFiles = await readManaged(api, repo, managed, baseSHA);
  if (isIdentical(expected, baseFiles)) return { repo, status: 'up_to_date' };

  const existingRef = await api.call('GET', `${root}/git/ref/heads/${branch}`, undefined, true);
  const prs = await api.call('GET', `${root}/pulls?state=open&head=${encodeURIComponent(manifest.owner + ':' + branch)}&per_page=100`);
  assert(Array.isArray(prs) && prs.length <= 1, `${repo}: ambiguous sync PR`);
  const pr = prs[0];
  assert(!pr || (pullHead(pr, branch, manifest.owner) && pr.base?.ref === base), `${repo}: unexpected sync PR identity`);
  assert(!pr || existingRef, `${repo}: sync PR branch is missing`);

  if (existingRef) {
    assert(existingRef.object?.type === 'commit' && /^[0-9a-f]{40}$/.test(existingRef.object.sha), `${repo}: invalid sync branch`);
    await verifyManagedBranch(api, repo, base, branch, existingRef.object.sha, managed, manifest.skill);
    assert(!pr || pr.head.sha === existingRef.object.sha, `${repo}: PR head differs from current branch`);
    const branchFiles = await readManaged(api, repo, managed, existingRef.object.sha);
    if (isIdentical(expected, branchFiles)) {
      if (pr) return { repo, status: 'pr_current', number: pr.number };
      if (dryRun) return { repo, status: 'would_open_pr' };
      const created = await write('POST', `${root}/pulls`, {
        title: `chore(skills): sync ${manifest.skill}`,
        head: branch, base,
        body: `Sync managed \`${manifest.skill}\` skill files from [haichi-co/.github](https://github.com/haichi-co/.github/tree/main/${manifest.source}).\n\nOnly the manifest-listed skill files are managed; review local repository-specific instructions separately.`,
      });
      return { repo, status: 'pr_created', number: created.number };
    }
  }
  if (dryRun) return { repo, status: pr ? 'would_update_pr' : 'would_create_pr' };

  const parent = existingRef?.object.sha ?? baseSHA;
  const parentCommit = await api.call('GET', `${root}/git/commits/${parent}`);
  assert(/^[0-9a-f]{40}$/.test(parentCommit.tree?.sha ?? ''), `${repo}: invalid parent tree`);
  const tree = await write('POST', `${root}/git/trees`, {
    base_tree: parentCommit.tree.sha,
    tree: [...expected].map(([path, body]) => ({ path, mode: '100644', type: 'blob', content: body })),
  });
  assert(/^[0-9a-f]{40}$/.test(tree.sha ?? ''), `${repo}: tree creation failed`);
  const commit = await write('POST', `${root}/git/commits`, {
    message: `${MESSAGE_PREFIX}${manifest.skill}`,
    tree: tree.sha, parents: [parent],
  });
  assert(/^[0-9a-f]{40}$/.test(commit.sha ?? ''), `${repo}: commit creation failed`);
  if (existingRef) {
    await write('PATCH', `${root}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  } else {
    await write('POST', `${root}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  }
  // Read back branch head and managed contents before opening/reusing a PR.
  const confirmed = await api.call('GET', `${root}/git/ref/heads/${branch}`);
  assert(confirmed.object?.sha === commit.sha, `${repo}: branch moved after update`);
  const checked = await readManaged(api, repo, managed, commit.sha);
  assert(isIdentical(expected, checked), `${repo}: managed content read-back mismatch`);

  if (pr) return { repo, status: 'pr_updated', number: pr.number };
  const created = await write('POST', `${root}/pulls`, {
    title: `chore(skills): sync ${manifest.skill}`,
    head: branch, base,
    body: `Sync managed \`${manifest.skill}\` skill files from [haichi-co/.github](https://github.com/haichi-co/.github/tree/main/${manifest.source}).\n\nOnly the manifest-listed skill files are managed; review local repository-specific instructions separately.`,
  });
  return { repo, status: 'pr_created', number: created.number };
}

export async function syncTargets(api: Api, manifest: SkillSyncManifest, contents: Map<string, Map<string, string>>, targets: Target[], dryRun = false): Promise<Array<SyncResult & { skill: string }>> {
  const results: Array<SyncResult & { skill: string }> = [];
  for (const target of targets) {
    const entry = manifest.skills.find(s => s.skill === target.skill);
    const expected = contents.get(target.skill);
    assert(entry && expected, 'Unknown target skill');
    results.push({ ...await syncRepository(api, `${manifest.owner}/${target.repository}`, entry, expected, dryRun), skill: entry.skill });
  }
  return results;
}

async function main(): Promise<void> {
  const { manifest, contents } = await loadConfig();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--validate-config') {
    process.stdout.write('manifest_valid\n');
    return;
  }
  if (args.length === 1 && args[0] === '--discover-targets') {
    const api = new Api(process.env.GH_TOKEN ?? '');
    process.stdout.write(JSON.stringify(await discoverTargets(api, manifest)) + '\n');
    return;
  }
  const targets = parseDiscoveredTargets(process.env.SKILL_SYNC_TARGETS, manifest);
  if (args.length === 1 && args[0] === '--target-repositories') {
    process.stdout.write(targetRepositories(targets).join(',') + '\n');
    return;
  }
  assert(args.length === 0 || (args.length === 1 && args[0] === '--dry-run'), 'Unknown argument');
  if (targets.length === 0) return;
  const api = new Api(process.env.GH_TOKEN ?? '');
  for (const result of await syncTargets(api, manifest, contents, targets, args.includes('--dry-run'))) {
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
