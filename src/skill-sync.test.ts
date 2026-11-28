import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Api, discoverTargets, isIdentical, loadConfig, parseDiscoveredTargets, syncRepository, syncTargets, targetRepositories, validateManifest } from './skill-sync.ts';

const rawEntry = {
  skill: 'issue-lifecycle',
  source: 'skills/issue-lifecycle', destination: '.agents/skills/issue-lifecycle',
  managed_files: ['SKILL.md', 'references/decisions.md', 'references/task-readiness.md'], opt_in_topic: 'haichi-skill-issue-lifecycle',
};
const secondEntry = {
  skill: 'review-helper', source: 'skills/review-helper', destination: '.agents/skills/review-helper',
  managed_files: ['SKILL.md'], opt_in_topic: 'haichi-skill-review-helper',
};
const config = (skills = [rawEntry]) => ({ schema: 'haichi-skill-sync/v3', owner: 'haichi-co', skills });
const fullManifest = validateManifest(config());
const manifest = fullManifest.skills[0];
const multiManifest = validateManifest(config([rawEntry, secondEntry]));
const wanted = new Map([
  ['.agents/skills/issue-lifecycle/SKILL.md', 'skill v1\n'],
  ['.agents/skills/issue-lifecycle/references/decisions.md', 'decisions v1\n'],
  ['.agents/skills/issue-lifecycle/references/task-readiness.md', 'readiness v1\n'],
]);

function fakeRepository(baseContent: Map<string, string> = new Map(), entry = manifest, name = 'gharp', topics = [entry.opt_in_topic]) {
  const baseSha = 'a'.repeat(40), nextSHA = 'c'.repeat(40), treeSha = 'd'.repeat(40);
  const repo = `haichi-co/${name}`, branch = `haichi-skill-sync/${entry.skill}`;
  const state: {
    main: Map<string, string>; branch: Map<string, string> | null; branchSha: string | null;
    prs: any[]; writes: any[]; tampered: boolean; staged: Map<string, string> | null;
    unrelated?: boolean; optedOut?: boolean;
  } = { main: new Map(baseContent), branch: null, branchSha: null, prs: [], writes: [], tampered: false, staged: null };
  const api = {
    async call(method: string, path: string, body?: any): Promise<any> {
      if (method !== 'GET') state.writes.push({ method, path, body });
      if (method === 'GET' && path === `/repos/${repo}`)
        return { full_name: repo, owner: { login: 'haichi-co' }, archived: false, default_branch: 'main',
          topics: state.optedOut ? [] : topics };
      if (method === 'GET' && path === `/repos/${repo}/git/ref/heads/main`) return { object: { sha: baseSha } };
      if (method === 'GET' && path === `/repos/${repo}/git/ref/heads/${branch}`)
        return state.branchSha ? { object: { sha: state.branchSha, type: 'commit' } } : null;
      if (method === 'GET' && path.includes('/contents/')) {
        const [, loc] = path.split('/contents/');
        const [file, ref] = loc.split('?ref=');
        const items = decodeURIComponent(ref) === baseSha ? state.main : state.branch;
        const contents = items?.get(file);
        return contents === undefined ? null : { type: 'file', encoding: 'base64', content: Buffer.from(contents).toString('base64') };
      }
      if (method === 'GET' && path.includes('/pulls?')) return state.prs;
      if (method === 'GET' && path.includes('/git/commits/')) {
        const sha = path.split('/').at(-1);
        return { tree: { sha: treeSha }, message: sha === baseSha ? 'main commit' : (state.tampered ? 'manual edit' : `chore(skill-sync): update ${entry.skill}`) };
      }
      if (method === 'GET' && path.includes('/compare/')) {
        const files = [...state.branch!.keys()].filter(k => state.main.get(k) !== state.branch!.get(k))
          .map(filename => ({ filename, status: 'modified' }));
        if (state.unrelated) files.push({ filename: 'AGENTS.md', status: 'modified' });
        return { files };
      }
      if (method === 'POST' && path.endsWith('/git/trees')) {
        state.staged = new Map(state.branch ?? state.main);
        for (const entry of body.tree) state.staged.set(entry.path, entry.content);
        return { sha: treeSha };
      }
      if (method === 'POST' && path.endsWith('/git/commits')) return { sha: nextSHA };
      if (method === 'POST' && path.endsWith('/git/refs')) {
        assert.equal(body.ref, `refs/heads/${branch}`);
        state.branch = state.staged;
        state.branchSha = nextSHA;
        return { object: { sha: nextSHA } };
      }
      if (method === 'PATCH' && path.includes('/git/refs/')) {
        assert.equal(body.force, false);
        state.branch = state.staged;
        state.branchSha = nextSHA;
        for (const pr of state.prs) pr.head.sha = nextSHA;
        return { object: { sha: nextSHA } };
      }
      if (method === 'POST' && path.endsWith('/pulls')) {
        assert.equal(body.base, 'main');
        const pr = { number: state.prs.length + 1, head: { sha: state.branchSha, ref: branch, repo: { owner: { login: 'haichi-co' } } }, base: { ref: 'main' } };
        state.prs.push(pr);
        return pr;
      }
      throw Error(`Unexpected operation ${method} ${path}`);
    },
  };
  return { api, state };
}

test('manifest enforces topic-based opt-in and safe file paths', () => {
  assert.equal(manifest.opt_in_topic, 'haichi-skill-issue-lifecycle');
  assert.throws(() => validateManifest({ ...config(), schema: 'haichi-skill-sync/v2' }), /Unsupported manifest/);
  assert.throws(() => validateManifest({ ...config(), repositories: ['haichi-co/gharp'] }), /Unexpected manifest property/);
  for (const [entry, message] of [
    [{ ...rawEntry, opt_in_topic: '*' }, /Invalid opt-in topic/],
    [{ ...rawEntry, managed_files: ['SKILL.md', '../AGENTS.md'] }, /Invalid file/],
    [{ ...rawEntry, destination: 'AGENTS.md' }, /destination/],
    [{ ...rawEntry, managed_files: ['SKILL.md', 'skill.md'] }, /Duplicate or overlapping/],
    [{ ...rawEntry, managed_files: ['SKILL.md', 'references', 'references/file.md'] }, /Duplicate or overlapping/],
  ] as const) {
    assert.throws(() => validateManifest({ ...config(), skills: [entry] }), message);
  }
  assert.throws(() => validateManifest(config([rawEntry, rawEntry])), /Duplicate skill/);
  assert.throws(() => validateManifest(config([rawEntry, { ...secondEntry, opt_in_topic: rawEntry.opt_in_topic }])), /Duplicate opt-in topic/);
  assert.throws(() => validateManifest(config([rawEntry, { ...secondEntry, destination: rawEntry.destination }])), /destination/);
});

const repository = (name: string, topics: string[] = [], extra: Record<string, unknown> = {}) => ({
  full_name: `haichi-co/${name}`, owner: { login: 'haichi-co' }, archived: false, disabled: false, topics, ...extra,
});

test('topic discovery excludes untagged, disabled, archived, and source repositories', async () => {
  const paths: string[] = [];
  const api = { async call(method: string, path: string): Promise<any> {
    assert.equal(method, 'GET'); paths.push(path);
    return [repository('runtime'), repository('gharp', [manifest.opt_in_topic]),
      repository('disabled', [manifest.opt_in_topic], { disabled: true }),
      repository('archived', [manifest.opt_in_topic], { archived: true }),
      repository('.github', [manifest.opt_in_topic])];
  } };
  assert.deepEqual(await discoverTargets(api as Api, fullManifest), [{ repository: 'gharp', skill: manifest.skill }]);
  assert.deepEqual(paths, ['/orgs/haichi-co/repos?type=all&per_page=100&page=1']);
});

test('topic discovery paginates without silently truncating organization repositories', async () => {
  const paths: string[] = [];
  const first = Array.from({ length: 100 }, (_, i) => repository(`repo-${i}`));
  const api = { async call(method: string, path: string): Promise<any> {
    paths.push(path);
    return path.endsWith('page=1') ? first : [repository('gharp', [manifest.opt_in_topic])];
  } };
  assert.deepEqual(await discoverTargets(api as Api, fullManifest), [{ repository: 'gharp', skill: manifest.skill }]);
  assert.equal(paths.length, 2);
});

test('discovery fails closed on malformed API responses', async () => {
  const bad = { async call() { return [repository('gharp', [], { topics: undefined })]; } };
  await assert.rejects(discoverTargets(bad as unknown as Api, fullManifest), /missing topic metadata/);
  const wrongOwner = { async call() { return [repository('gharp', [manifest.opt_in_topic], { owner: { login: 'other' } })]; } };
  await assert.rejects(discoverTargets(wrongOwner as unknown as Api, fullManifest), /Invalid repository identity/);
  const wrongPage = { async call() { return { incomplete: true }; } };
  await assert.rejects(discoverTargets(wrongPage as unknown as Api, fullManifest), /Incomplete or invalid/);
});

test('multi-skill discovery is independent and writer scope is the unique union', async () => {
  const api = { async call() {
    return [repository('only-review', [secondEntry.opt_in_topic]), repository('both', [manifest.opt_in_topic, secondEntry.opt_in_topic]),
      repository('only-issues', [manifest.opt_in_topic]), repository('neither')];
  } };
  const targets = await discoverTargets(api as unknown as Api, multiManifest);
  assert.deepEqual(targets, [
    { repository: 'both', skill: manifest.skill }, { repository: 'both', skill: secondEntry.skill },
    { repository: 'only-issues', skill: manifest.skill }, { repository: 'only-review', skill: secondEntry.skill },
  ]);
  assert.deepEqual(targetRepositories(targets), ['both', 'only-issues', 'only-review']);
  assert.deepEqual(parseDiscoveredTargets(JSON.stringify(targets), multiManifest), targets);
  assert.deepEqual(targetRepositories(parseDiscoveredTargets('[]', multiManifest)), []);
});

test('scoped targets require the exact validated discovery output', () => {
  const target = { repository: 'gharp', skill: manifest.skill };
  for (const invalid of [
    undefined, '', 'gharp', JSON.stringify([target, target]), JSON.stringify([{ ...target, repository: 'other/repo' }]),
    JSON.stringify([{ ...target, repository: '../repo' }]), JSON.stringify([{ ...target, repository: '.github' }]),
    JSON.stringify([{ ...target, skill: 'unknown' }]), JSON.stringify([target, { ...target, repository: 'GHARP', skill: secondEntry.skill }]),
    JSON.stringify([{ ...target, extra: true }]),
  ]) {
    assert.throws(() => parseDiscoveredTargets(invalid, multiManifest));
  }
});

test('content comparison uses exact managed file equality', () => {
  assert.equal(isIdentical(wanted, new Map(wanted)), true);
  assert.equal(isIdentical(wanted, new Map([[[...wanted.keys()][0], 'other']])), false);
});

test('already synchronized main is a read-only no-op', async () => {
  const { api, state } = fakeRepository(wanted);
  assert.deepEqual(await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted), { repo: 'haichi-co/gharp', status: 'up_to_date' });
  assert.equal(state.writes.length, 0);
});

test('first sync creates a single PR; a second run makes zero writes', async () => {
  const { api, state } = fakeRepository();
  const first = await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted);
  assert.equal(first.status, 'pr_created');
  assert.equal(state.prs.length, 1);
  assert.equal(state.branch!.get('.agents/skills/issue-lifecycle/SKILL.md'), 'skill v1\n');
  const before = state.writes.length;
  const second = await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted);
  assert.equal(second.status, 'pr_current');
  assert.equal(second.number, first.number);
  assert.equal(state.writes.length, before);
});

test('changed canonical content updates the same PR and then stabilizes', async () => {
  const { api, state } = fakeRepository();
  await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted);
  const revised = new Map(wanted); revised.set('.agents/skills/issue-lifecycle/SKILL.md', 'skill v2\n');
  const before = state.writes.length;
  const result = await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, revised);
  assert.equal(result.status, 'pr_updated');
  assert.equal(state.prs.length, 1);
  assert.equal(state.writes.slice(before).filter(x => x.method === 'POST' && x.path.endsWith('/pulls')).length, 0);
  const after = state.writes.length;
  assert.equal((await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, revised)).status, 'pr_current');
  assert.equal(state.writes.length, after);
});

test('orphaned owned branch can be converted into a PR without a new commit', async () => {
  const { api, state } = fakeRepository();
  await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted);
  state.prs = []; // Simulates a failure between pushing and creating the PR.
  const before = state.writes.length;
  const result = await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted);
  assert.equal(result.status, 'pr_created');
  assert.equal(state.writes.length, before + 1);
  assert.equal(state.prs.length, 1);
});

test('repository removed from topic enrollment fails before any writes', async () => {
  const { api, state } = fakeRepository();
  state.optedOut = true;
  await assert.rejects(syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted), /no longer opted in/);
  assert.equal(state.writes.length, 0);
});

test('enrollment revoked during sync prevents subsequent writes', async () => {
  const { api, state } = fakeRepository();
  const wrapped = { async call(method: string, path: string, body?: any) {
    const result = await api.call(method, path, body);
    if (method === 'POST' && path.endsWith('/git/trees')) state.optedOut = true;
    return result;
  } };
  await assert.rejects(syncRepository(wrapped as unknown as Api, 'haichi-co/gharp', manifest, wanted), /no longer opted in/);
  assert.equal(state.writes.length, 1);
  assert.equal(state.branch, null);
  assert.equal(state.prs.length, 0);
});

test('independent skill branches preserve unrelated files in the same and different repositories', async () => {
  const local = new Map([['AGENTS.md', 'local'], ['.agents/skills/local/SKILL.md', 'local skill']]);
  const other = multiManifest.skills[1];
  const otherWanted = new Map([[other.destination + '/SKILL.md', 'review skill']]);
  const contents = new Map([[manifest.skill, wanted], [other.skill, otherWanted]]);
  const topics = [manifest.opt_in_topic, other.opt_in_topic];
  const issues = fakeRepository(local, manifest, 'both', topics);
  const review = fakeRepository(local, other, 'both', topics);
  const separate = fakeRepository(local, other, 'different');
  let active = issues.api;
  const multiplex = { async call(method: string, path: string, body?: any) {
    if (method === 'GET' && path === '/repos/haichi-co/different') active = separate.api;
    if (method === 'GET' && path === '/repos/haichi-co/both' && active === separate.api) active = issues.api;
    if (path.includes('/git/ref/heads/haichi-skill-sync/')) {
      active = path.includes('/different/') ? separate.api : path.endsWith(other.skill) ? review.api : issues.api;
    }
    return active.call(method, path, body);
  } };
  // Independent per-skill mock branches in the same repository plus one other repo.
  const targets = [{ repository: 'both', skill: manifest.skill }, { repository: 'both', skill: other.skill }, { repository: 'different', skill: other.skill }];
  const results = await syncTargets(multiplex as unknown as Api, multiManifest, contents, targets);
  assert.deepEqual(results.map(r => r.status), ['pr_created', 'pr_created', 'pr_created']);
  for (const [state, expected, forbidden] of [[issues.state, wanted, otherWanted], [review.state, otherWanted, wanted], [separate.state, otherWanted, wanted]] as const) {
    assert.equal(state.prs.length, 1);
    assert.deepEqual(state.branch, new Map([...local, ...expected]));
    assert.deepEqual(state.main, local);
    for (const key of forbidden.keys()) assert.equal(state.branch!.has(key), false);
  }
  const writes = [issues, review, separate].map(x => x.state.writes.length);
  const rerun = await syncTargets(multiplex as unknown as Api, multiManifest, contents, targets);
  assert.deepEqual(rerun.map(r => r.status), ['pr_current', 'pr_current', 'pr_current']);
  assert.deepEqual([issues, review, separate].map(x => x.state.writes.length), writes);
});

test('dry run never writes or creates PRs', async () => {
  const { api, state } = fakeRepository();
  const result = await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted, true);
  assert.equal(result.status, 'would_create_pr');
  assert.equal(state.writes.length, 0);
});

test('unrelated or hand-edited sync branches fail closed', async () => {
  const { api, state } = fakeRepository();
  await syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, wanted);
  const changed = new Map(wanted); changed.set('.agents/skills/issue-lifecycle/SKILL.md', 'new\n');
  state.unrelated = true;
  const before = state.writes.length;
  await assert.rejects(syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, changed), /unexpected branch change/);
  assert.equal(state.writes.length, before);
  state.unrelated = false;
  state.tampered = true;
  await assert.rejects(syncRepository(api as unknown as Api, 'haichi-co/gharp', manifest, changed), /non-sync commit/);
  assert.equal(state.writes.length, before);
});

test('loadConfig reads the canonical on-disk files', async () => {
  const result = await loadConfig();
  assert.equal(result.manifest.skills[0].opt_in_topic, 'haichi-skill-issue-lifecycle');
  // Source skill files are staged separately by the preflight setup.
  assert.ok(result.contents.get(manifest.skill)?.get('.agents/skills/issue-lifecycle/SKILL.md')?.includes('name: issue-lifecycle'));
});

test('API returns missing resources as null without swallowing other errors', async () => {
  const api = new Api('test', (async () => ({ status: 404, ok: false, text: async () => 'not found' })) as unknown as typeof fetch);
  assert.equal(await api.call('GET', '/nothing', undefined, true), null);
  await assert.rejects(api.call('GET', '/nothing'), /HTTP 404/);
});
