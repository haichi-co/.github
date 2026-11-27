import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Api, isIdentical, loadConfig, syncRepository, validateManifest } from './skill-sync.ts';

const manifest = validateManifest({
  schema: 'haichi-skill-sync/v1', owner: 'haichi-co', skill: 'issue-lifecycle',
  source: 'skills/issue-lifecycle', destination: '.agents/skills/issue-lifecycle',
  managed_files: ['SKILL.md', 'references/task-readiness.md'], repositories: ['haichi-co/gharp'],
});
const wanted = new Map([
  ['.agents/skills/issue-lifecycle/SKILL.md', 'skill v1\n'],
  ['.agents/skills/issue-lifecycle/references/task-readiness.md', 'readiness v1\n'],
]);

function fakeRepository(baseContent: Map<string, string> = new Map()) {
  const baseSha = 'a'.repeat(40), branchSHA = 'b'.repeat(40), nextSHA = 'c'.repeat(40), treeSha = 'd'.repeat(40);
  const state: {
    main: Map<string, string>; branch: Map<string, string> | null; branchSha: string | null;
    prs: any[]; writes: any[]; tampered: boolean; staged: Map<string, string> | null;
    unrelated?: boolean;
  } = { main: new Map(baseContent), branch: null, branchSha: null, prs: [], writes: [], tampered: false, staged: null };
  const api = {
    async call(method: string, path: string, body?: any): Promise<any> {
      if (method !== 'GET') state.writes.push({ method, path, body });
      if (method === 'GET' && path === '/repos/haichi-co/gharp')
        return { full_name: 'haichi-co/gharp', owner: { login: 'haichi-co' }, archived: false, default_branch: 'main' };
      if (method === 'GET' && path === '/repos/haichi-co/gharp/git/ref/heads/main') return { object: { sha: baseSha } };
      if (method === 'GET' && path === '/repos/haichi-co/gharp/git/ref/heads/haichi-skill-sync/issue-lifecycle')
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
        return { tree: { sha: treeSha }, message: sha === baseSha ? 'main commit' : (state.tampered ? 'manual edit' : 'chore(skill-sync): update issue-lifecycle') };
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
        assert.equal(body.ref, 'refs/heads/haichi-skill-sync/issue-lifecycle');
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
        const pr = { number: state.prs.length + 1, head: { sha: state.branchSha, ref: 'haichi-skill-sync/issue-lifecycle', repo: { owner: { login: 'haichi-co' } } }, base: { ref: 'main' } };
        state.prs.push(pr);
        return pr;
      }
      throw Error(`Unexpected operation ${method} ${path}`);
    },
  };
  return { api, state };
}

test('manifest enforces same-owner explicit opt-in and safe file paths', () => {
  assert.equal(manifest.repositories[0], 'haichi-co/gharp');
  assert.throws(() => validateManifest({ ...manifest, repositories: ['attention-spa/newsq'] }), /Out-of-scope/);
  assert.throws(() => validateManifest({ ...manifest, repositories: ['haichi-co/gharp', 'haichi-co/gharp'] }), /Duplicate repository/);
  assert.throws(() => validateManifest({ ...manifest, managed_files: ['SKILL.md', '../AGENTS.md'] }), /Invalid file/);
  assert.throws(() => validateManifest({ ...manifest, destination: 'AGENTS.md' }), /destination/);
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
  assert.equal(result.manifest.repositories[0], 'haichi-co/gharp');
  // Source skill files are staged separately by the preflight setup.
  assert.ok(result.content.get('.agents/skills/issue-lifecycle/SKILL.md')?.includes('name: issue-lifecycle'));
});

test('API returns missing resources as null without swallowing other errors', async () => {
  const api = new Api('test', (async () => ({ status: 404, ok: false, text: async () => 'not found' })) as unknown as typeof fetch);
  assert.equal(await api.call('GET', '/nothing', undefined, true), null);
  await assert.rejects(api.call('GET', '/nothing'), /HTTP 404/);
});
