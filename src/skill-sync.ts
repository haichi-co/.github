// GitHub-native, PR-only synchronization of explicitly managed skill files.
// Works on Node.js 24 with no third-party packages.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type SkillSyncManifest = {
  schema: 'haichi-skill-sync/v2';
  owner: string;
  skill: string;
  source: string;
  destination: string;
  managed_files: string[];
  opt_in_topic: string;
};

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

export function validateManifest(raw: unknown): SkillSyncManifest {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), 'Invalid manifest');
  const value = raw as Record<string, unknown>;
  assert(value.schema === 'haichi-skill-sync/v2', 'Unsupported manifest schema');
  assert(typeof value.owner === 'string' && SAFE_NAME.test(value.owner), 'Invalid owner');
  assert(typeof value.skill === 'string' && SAFE_NAME.test(value.skill), 'Invalid skill');
  assert(value.source === `skills/${value.skill}`, 'Unexpected skill source');
  assert(value.destination === `.agents/skills/${value.skill}`, 'Unexpected skill destination');
  assert(Array.isArray(value.managed_files) && value.managed_files.length > 0, 'No managed files');
  const files = new Set<string>();
  for (const path of value.managed_files) {
    assert(typeof path === 'string' && path.split('/').every(part => SAFE_SEGMENT.test(part) && part !== '..'), `Invalid file: ${path}`);
    assert(!files.has(path), `Duplicate managed file: ${path}`);
    files.add(path);
  }
  assert(files.has('SKILL.md'), 'SKILL.md must be managed');
  assert(typeof value.opt_in_topic === 'string' &&
    /^haichi-skill-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.opt_in_topic),
    'Invalid opt-in topic');
  assert(!Object.hasOwn(value, 'repositories'), 'Legacy repository list is not supported');
  return value as SkillSyncManifest;
}

export async function loadConfig(root = process.cwd()): Promise<{ manifest: SkillSyncManifest; content: Map<string, string> }> {
  const value = JSON.parse(await readFile(resolve(root, '.github/skill-sync.json'), 'utf8'));
  const manifest = validateManifest(value);
  const content = new Map<string, string>();
  for (const file of manifest.managed_files) {
    const body = await readFile(resolve(root, manifest.source, file), 'utf8');
    assert(body.length > 0, `Empty canonical file: ${file}`);
    content.set(`${manifest.destination}/${file}`, body);
  }
  return { manifest, content };
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
export async function discoverRepositories(api: Api, manifest: SkillSyncManifest): Promise<string[]> {
  const found = new Set<string>();
  for (let page = 1; page <= 1000; page++) {
    const rows = await api.call('GET', `/orgs/${manifest.owner}/repos?type=all&per_page=100&page=${page}`);
    assert(Array.isArray(rows) && rows.length <= 100, 'Incomplete or invalid organization repository listing');
    for (const row of rows) {
      assert(typeof row?.full_name === 'string' &&
        row.owner?.login === manifest.owner &&
        Array.isArray(row.topics) && row.topics.every((topic: unknown) => typeof topic === 'string'),
        'Invalid repository identity or missing topic metadata');
      const [owner, name, extra] = row.full_name.split('/');
      assert(!extra && owner === manifest.owner && SAFE_NAME.test(name),
        `Invalid repository name: ${row.full_name}`);
      if (name === '.github' || row.archived || row.disabled || !row.topics.includes(manifest.opt_in_topic)) continue;
      assert(!found.has(name), `Duplicate discovered repository: ${name}`);
      found.add(name);
    }
    if (rows.length < 100) return [...found].sort();
  }
  throw new Error('Organization repository discovery exceeded the page limit');
}

/** Validate the exact discovery output before using a scoped write token. */
export function parseDiscoveredTargets(csv: string | undefined, manifest: SkillSyncManifest): string[] {
  assert(typeof csv === 'string' && csv.length > 0, 'Missing discovered repository targets');
  const seen = new Set<string>();
  return csv.split(',').map(name => {
    assert(SAFE_NAME.test(name) && name !== '.github' && !seen.has(name), `Invalid discovered repository: ${name}`);
    seen.add(name);
    return `${manifest.owner}/${name}`;
  });
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
async function verifyManagedBranch(api: Api, repo: string, base: string, branch: string, sha: string, managed: ReadonlySet<string>) {
  const commit = await api.call('GET', `/repos/${repo}/git/commits/${sha}`);
  assert(commit.message?.startsWith(MESSAGE_PREFIX), `${repo}: branch has a non-sync commit; manual review required`);
  const compare = await api.call('GET', `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`);
  assert(Array.isArray(compare.files) && compare.files.length < 300, `${repo}: incomplete branch comparison`);
  for (const file of compare.files) {
    assert(managed.has(file.filename) && file.status !== 'removed', `${repo}: unexpected branch change: ${file.filename}`);
  }
}

export async function syncRepository(api: Api, repo: string, manifest: SkillSyncManifest, expected: ReadonlyMap<string, string>, dryRun = false): Promise<SyncResult> {
  const meta = await api.call('GET', `/repos/${repo}`);
  assert(meta.full_name === repo && meta.owner?.login === manifest.owner && !meta.archived && !meta.disabled, `${repo}: repository identity or state mismatch`);
  assert(Array.isArray(meta.topics) && meta.topics.includes(manifest.opt_in_topic), `${repo}: repository is no longer opted in`);
  assert(typeof meta.default_branch === 'string' && meta.default_branch.length, `${repo}: missing default branch`);
  const base = meta.default_branch;
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
    await verifyManagedBranch(api, repo, base, branch, existingRef.object.sha, managed);
    assert(!pr || pr.head.sha === existingRef.object.sha, `${repo}: PR head differs from current branch`);
    const branchFiles = await readManaged(api, repo, managed, existingRef.object.sha);
    if (isIdentical(expected, branchFiles)) {
      if (pr) return { repo, status: 'pr_current', number: pr.number };
      if (dryRun) return { repo, status: 'would_open_pr' };
      const created = await api.call('POST', `${root}/pulls`, {
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
  const tree = await api.call('POST', `${root}/git/trees`, {
    base_tree: parentCommit.tree.sha,
    tree: [...expected].map(([path, body]) => ({ path, mode: '100644', type: 'blob', content: body })),
  });
  assert(/^[0-9a-f]{40}$/.test(tree.sha ?? ''), `${repo}: tree creation failed`);
  const commit = await api.call('POST', `${root}/git/commits`, {
    message: `${MESSAGE_PREFIX}${manifest.skill}`,
    tree: tree.sha, parents: [parent],
  });
  assert(/^[0-9a-f]{40}$/.test(commit.sha ?? ''), `${repo}: commit creation failed`);
  if (existingRef) {
    await api.call('PATCH', `${root}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  } else {
    await api.call('POST', `${root}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  }
  // Read back branch head and managed contents before opening/reusing a PR.
  const confirmed = await api.call('GET', `${root}/git/ref/heads/${branch}`);
  assert(confirmed.object?.sha === commit.sha, `${repo}: branch moved after update`);
  const checked = await readManaged(api, repo, managed, commit.sha);
  assert(isIdentical(expected, checked), `${repo}: managed content read-back mismatch`);

  if (pr) return { repo, status: 'pr_updated', number: pr.number };
  const created = await api.call('POST', `${root}/pulls`, {
    title: `chore(skills): sync ${manifest.skill}`,
    head: branch, base,
    body: `Sync managed \`${manifest.skill}\` skill files from [haichi-co/.github](https://github.com/haichi-co/.github/tree/main/${manifest.source}).\n\nOnly the manifest-listed skill files are managed; review local repository-specific instructions separately.`,
  });
  return { repo, status: 'pr_created', number: created.number };
}

async function main(): Promise<void> {
  const { manifest, content } = await loadConfig();
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--validate-config') {
    process.stdout.write('manifest_valid\n');
    return;
  }
  if (args.length === 1 && args[0] === '--discover-repositories') {
    const api = new Api(process.env.GH_TOKEN ?? '');
    process.stdout.write((await discoverRepositories(api, manifest)).join(',') + '\n');
    return;
  }
  assert(args.length === 0 || (args.length === 1 && args[0] === '--dry-run'), 'Unknown argument');
  const repositories = parseDiscoveredTargets(process.env.SKILL_SYNC_TARGET_REPOSITORIES, manifest);
  const api = new Api(process.env.GH_TOKEN ?? '');
  const dryRun = args.includes('--dry-run');
  for (const repo of repositories) {
    const result = await syncRepository(api, repo, manifest, content, dryRun);
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
