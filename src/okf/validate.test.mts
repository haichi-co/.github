import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { validate } from './validate.mts';

const cli = fileURLToPath(new URL('./validate.mts', import.meta.url));
const prefix = 'https://github.com/haichi-co/.github/blob/main/';
const doc = (meta = 'type: Reference', body = 'Content.') => '---\n' + meta + '\n---\n\n' + body + '\n';
const index = (body = '# Concepts\n\n- [Example](example.md) - Example') => doc('okf_version: "0.3"', body);
function write(root: string, name: string, data: string): void {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}
function temp<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'haichi-okf-'));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
type Result = ReturnType<typeof validate>;
function expectResult(result: Result, exit: number, expected: readonly [string, string][] = []): void {
  assert.equal(result.exit, exit, JSON.stringify(result.diagnostics, null, 2));
  for (const [code, kind] of expected)
    assert.ok(result.diagnostics.some(d => d.code === code && d.class === kind), 'Missing ' + kind + ':' + code + ' ' + JSON.stringify(result.diagnostics));
}
function run(mode: '--bundle' | '--repo', root: string, exit: number, expected: readonly [string, string][] = []): Result {
  const result = validate([mode, root]);
  expectResult(result, exit, expected);
  // Every fixture also exercises the public process exit contract and sorted diagnostics.
  const proc = spawnSync(process.execPath, [cli, mode, root], {
    encoding: 'utf8', env: mode === '--bundle' ? { ...process.env, PATH: '' } : process.env,
  });
  assert.ifError(proc.error);
  assert.equal(proc.status, exit, proc.stdout + proc.stderr);
  assert.equal(proc.stderr, '');
  const output = proc.stdout.trim() ? proc.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
  assert.deepEqual(output, result.diagnostics);
  return result;
}
type Generic = { name: string; files: Record<string, string>; exit: number; expected?: [string, string][] };
const generic: Generic[] = [
  { name: 'type-only with absent optional index', files: { 'example.md': doc() }, exit: 0, expected: [['optional-index', 'warning']] },
  { name: 'ordinary Markdown and empty optional values', files: {
    'README.md': '# Ordinary readme\n[Not scanned](bad%XX.md)',
    'AGENTS.md': '# Instructions',
    'SKILL.md': doc('name: skill'),
    'empty.md': doc('type: null\nsources: []\ntitle: ""'), 'unknown.md': doc('type: Unknown\nx-custom: true'),
  }, exit: 0, expected: [['not-concept', 'warning']] },
  { name: 'invalid YAML mapping', files: { 'example.md': doc('type: [') }, exit: 1, expected: [['frontmatter-mapping', 'spec']] },
  { name: 'YAML sequence rather than map', files: { 'example.md': doc('- type: Reference') }, exit: 1, expected: [['frontmatter-mapping', 'spec']] },
  { name: 'duplicate YAML key at any depth', files: { 'example.md': doc('type: Reference\nsources:\n  - resource: a\n    resource: b') }, exit: 1, expected: [['frontmatter-mapping', 'spec']] },
  { name: 'unterminated frontmatter', files: { 'example.md': '---\ntype: Reference\n--- \n' }, exit: 1, expected: [['frontmatter-delimiter', 'spec']] },
  { name: 'YAML 1.2 type on', files: { 'example.md': doc('type: on') }, exit: 0 },
  { name: 'literal boolean is not a concept', files: { 'example.md': doc('type: true') }, exit: 0, expected: [['type-format', 'warning']] },
  { name: 'nested reserved frontmatter and invalid log date', files: {
    'sub/index.md': index(), 'log.md': '# Log\n\n## Yesterday\n- Change',
  }, exit: 1, expected: [['reserved-frontmatter', 'spec'], ['log-date', 'spec']] },
  { name: 'log frontmatter', files: { 'log.md': doc('type: Reference', '# Log\n\n## 2026-11-27\n- Change') }, exit: 1, expected: [['reserved-frontmatter', 'spec']] },
  { name: 'prose-only index', files: { 'index.md': index('Plain prose only.') }, exit: 1, expected: [['index-shape', 'spec']] },
  { name: 'index with invalid entry', files: { 'index.md': index('# Concepts\n\n- Not a Markdown link.') }, exit: 1, expected: [['index-entry', 'spec']] },
  { name: 'missing inline and reference links remain conformant', files: {
    'example.md': doc('type: Reference', '[Inline](missing-inline.md)\n\n[Reference][missing]\n\n[missing]: missing-reference.md'),
  }, exit: 0, expected: [['broken-link', 'warning']] },
  { name: 'date-only generation and historical verification accepted', files: {
    'example.md': doc('type: Reference\ngenerated: { by: agent/1, at: 2026-11-10 }\nverified: { by: human:reviewer, at: 2026-11-01 }\nstale_after: 2026-11-20'),
  }, exit: 0 },
  { name: 'invalid stale_after is diagnosed without time-dependent results', files: {
    'example.md': doc('type: Reference\nstale_after: nonsense'),
  }, exit: 0, expected: [['timestamp-format', 'warning']] },
  { name: 'invalid calendar date and offsetless time', files: {
    'example.md': doc('type: Reference\nstale_after: 2026-02-30\ngenerated: { by: agent/1, at: "2026-11-27T12:00:00" }'),
  }, exit: 0, expected: [['timestamp-format', 'warning']] },
  { name: 'incomplete optional family/attestation metadata', files: {
    'example.md': doc('type: Attested Computation\nsources: [{id: missing}]\nverified: {by: human:a}\nparameters: [{name: x}]'),
  }, exit: 0, expected: [['source-resource', 'warning'], ['verified-entry', 'warning'], ['parameter-entry', 'warning'], ['computation-runtime', 'warning'], ['computation-body', 'warning']] },
  { name: 'valid links, encoded asset name, source singleton and GFM reference', files: {
    'index.md': index(),
    'example.md': doc('type: Unknown\nx-example-foo: bar'),
    'sub/nested.md': doc('type: Unknown\nresource: ../example.md\nsources: {resource: "all queries in BigQuery project X"}',
      '[Relative](../example.md)\n[Root](/example.md#fragment)\n[Encoded](/my%20asset.txt)\n[Ref][key]\n\n[key]: ../example.md\n\n| A | B |\n|---|---|\n| x | y |'),
    'my asset.txt': 'asset',
    'sub/index.md': '# Contents\n\n- [Nested](nested.md)\n',
    'log.md': '# Log\n\n## 2026-11-27\n- Change\n\n## 2026-11-26\n- Initial',
  }, exit: 0 },
  { name: 'incorrect log chronology', files: {
    'log.md': '# Log\n\n## 2026-11-26\n- Change\n\n## 2026-11-27\n- Initial',
  }, exit: 1, expected: [['log-order', 'spec']] },
  { name: 'malformed URI escapes', files: {
    'example.md': doc('type: Reference\nresource: bad%XX.md', '[Invalid](bad%2Ffile.md)'),
  }, exit: 1, expected: [['malformed-path', 'spec']] },
  { name: 'dot paths omitted, case-sensitive resolution', files: {
    'example.md': doc('type: Reference', '[Hidden](.hidden/secret.md)\n[Case](B.md)'),
    '.hidden/secret.md': '---\ninvalid YAML', 'b.md': doc(),
  }, exit: 0, expected: [['broken-link', 'warning']] },
  { name: 'case-only collisions warned', files: { 'a.md': doc(), 'A.md': doc() }, exit: 0, expected: [['case-collision', 'warning']] },
  { name: 'untrusted computation fixture is never executed', files: {
    'example.md': doc('type: Attested Computation\nruntime: node\ncomputation: run.mjs\nattester: {resource: run.mjs}'),
    'run.mjs': 'throw new Error("Must never execute");',
  }, exit: 0 },
];
for (const fixture of generic) test('bundle: ' + fixture.name, () => temp(root => {
  for (const [path, data] of Object.entries(fixture.files)) write(root, path, data);
  const result = run('--bundle', root, fixture.exit, fixture.expected);
  if (fixture.name === 'YAML 1.2 type on') assert.ok(!result.diagnostics.some(d => d.code === 'not-concept'));
  if (fixture.name.startsWith('missing inline')) assert.equal(result.diagnostics.filter(d => d.code === 'broken-link').length, 2);
  if (fixture.name.startsWith('valid links')) assert.deepEqual(result.diagnostics, []);
  if (fixture.name.startsWith('date-only')) assert.ok(!result.diagnostics.some(d => d.code === 'timestamp-format'));
  for (const [path, data] of Object.entries(fixture.files)) assert.equal(readFileSync(join(root, path), 'utf8'), data);
}));

test('bundle: escaping references are external and not read, including percent-encoded traversal', () => temp(outside => {
  const root = join(outside, 'bundle');
  const sentinel = '---\ninvalid outside sentinel\n';
  write(outside, 'secret.md', sentinel);
  write(root, 'example.md', doc('type: Reference\nresource: ../secret.md\nsources: [{resource: "%2e%2e/secret.md"}]',
    '[External](../secret.md)\n[Encoded](%2E%2E/secret.md)\n[Root](/../secret.md)'));
  const result = run('--bundle', root, 0);
  assert.ok(!result.diagnostics.some(d => d.code === 'broken-link' || d.code === 'frontmatter-mapping'));
  assert.equal(readFileSync(join(outside, 'secret.md'), 'utf8'), sentinel);
}));
for (const kind of ['root', 'ancestor', 'index', 'directory', 'file', 'ref-target', 'in-root'] as const) {
  test('bundle: reject ' + kind + ' symlink before any target read', () => temp(outside => {
    const root = join(outside, 'bundle');
    const target = join(outside, 'outside');
    const sentinel = '---\ninvalid outside sentinel\n';
    write(target, 'secret.md', sentinel);
    mkdirSync(root);
    write(root, 'example.md', doc());
    let arg = root;
    if (kind === 'root') { arg = join(outside, 'root-link'); symlinkSync(target, arg, 'dir'); }
    else if (kind === 'ancestor') {
      mkdirSync(join(target, 'inner'));
      symlinkSync(target, join(outside, 'parent-link'), 'dir');
      arg = join(outside, 'parent-link', 'inner');
    } else if (kind === 'index') symlinkSync(join(target, 'secret.md'), join(root, 'index.md'));
    else if (kind === 'directory') symlinkSync(target, join(root, 'link'), 'dir');
    else if (kind === 'file') symlinkSync(join(target, 'secret.md'), join(root, 'link.md'));
    else if (kind === 'ref-target') {
      symlinkSync(join(target, 'secret.md'), join(root, 'asset.txt'));
      write(root, 'example.md', doc('type: Reference\nresource: asset.txt'));
    } else symlinkSync(join(root, 'example.md'), join(root, 'link.md'));
    const result = run('--bundle', arg, 1, [[kind === 'root' || kind === 'ancestor' ? 'symlink-root' : 'symlink', 'safety']]);
    assert.ok(!result.diagnostics.some(d => d.code === 'frontmatter-mapping'));
    assert.equal(readFileSync(join(target, 'secret.md'), 'utf8'), sentinel);
  }));
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit(root: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'fixture');
}
function oid(root: string, path: string): string { return git(root, 'rev-parse', 'HEAD:' + path); }
function concept(root: string, path = 'source.txt', flags: { url?: string; pin?: string; unquoted?: boolean; extra?: string } = {}): string {
  const url = flags.url ?? prefix + path.split('/').map(encodeURIComponent).join('/');
  const pin = flags.pin ?? oid(root, path);
  return doc('type: Reference\ndescription: Example\nsources:\n  - resource: ' + JSON.stringify(url) +
    '\n    x-haichi-git-blob: ' + (flags.unquoted ? pin : JSON.stringify(pin)) + (flags.extra ?? ''));
}
function initRepo(root: string): void {
  git(root, 'init', '-q', '--object-format=sha1');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'source.txt', 'canonical bytes\n');
  write(root, '.github/workflows/example.yml', 'test: true\n');
  write(root, 'profile/README.md', 'branding only\n');
  write(root, 'src/okf/test.mts', 'local validator only\n');
  write(root, '.github/workflows/validate-okf.yml', 'local gate only\n');
  commit(root);
  write(root, 'knowledge/example.md', concept(root, 'source.txt', {
    extra: '\n  - resource: ' + JSON.stringify(prefix + '.github/workflows/example.yml') +
      '\n    x-haichi-git-blob: ' + JSON.stringify(oid(root, '.github/workflows/example.yml')),
  }));
  write(root, 'knowledge/index.md', index());
  commit(root);
}
const original = (root: string) => readFileSync(join(root, 'knowledge/example.md'), 'utf8');
const modify = (root: string, fn: (s: string) => string) => write(root, 'knowledge/example.md', fn(original(root)));
type RepoFixture = { name: string; mutate: (root: string) => void; exit: number; expected?: [string, string][]; noCommit?: boolean };
const repoCases: RepoFixture[] = [
  { name: 'valid committed tree, exclusions and untracked dependencies', mutate: root => write(root, 'node_modules/untracked.js', 'never execute'), exit: 0, noCommit: true },
  { name: 'new tracked unmapped regular source', mutate: root => write(root, 'new.txt', 'new canonical file'), exit: 1, expected: [['coverage-missing', 'policy']] },
  { name: 'deleted source', mutate: root => rmSync(join(root, 'source.txt')), exit: 1, expected: [['unknown-source', 'policy']] },
  { name: 'renamed source', mutate: root => renameSync(join(root, 'source.txt'), join(root, 'renamed.txt')), exit: 1, expected: [['unknown-source', 'policy'], ['coverage-missing', 'policy']] },
  { name: 'duplicate canonical mapping', mutate: root => {
    write(root, 'knowledge/second.md', concept(root));
    write(root, 'knowledge/index.md', index('# Concepts\n\n- [Example](example.md) - Example\n- [Second](second.md) - Example'));
  }, exit: 1, expected: [['duplicate-source', 'policy']] },
  { name: 'changed canonical source without pin', mutate: root => write(root, 'source.txt', 'changed source'), exit: 1, expected: [['stale-blob', 'policy']] },
  { name: 'changed profile excluded', mutate: root => write(root, 'profile/README.md', 'new branding'), exit: 0 },
  { name: 'missing source mapping', mutate: root => modify(root, s => s.replace(/  - resource: "[^"]+source\.txt"\n    x-haichi-git-blob: "[^"]+"\n/, '')), exit: 1, expected: [['coverage-missing', 'policy']] },
  { name: 'excluded canonical source mapping', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', prefix + 'profile/README.md')), exit: 1, expected: [['excluded-source', 'policy']] },
  { name: 'incorrect URL prefix', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', 'https://example.invalid/source.txt')), exit: 1, expected: [['source-url', 'policy']] },
  { name: 'URL query', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', prefix + 'source.txt?x=1')), exit: 1, expected: [['source-url', 'policy']] },
  { name: 'URL fragment', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', prefix + 'source.txt#frag')), exit: 1, expected: [['source-url', 'policy']] },
  { name: 'URL encoded slash', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', prefix + 'sub%2Fsource.txt')), exit: 1, expected: [['source-url', 'policy']] },
  { name: 'URL encoded traversal', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', prefix + '%2E%2E/source.txt')), exit: 1, expected: [['source-url', 'policy']] },
  { name: 'URL noncanonical encoding', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', prefix + '%73ource.txt')), exit: 1, expected: [['source-url', 'policy']] },
  { name: 'URL case sensitivity', mutate: root => modify(root, s => s.replace(prefix + 'source.txt', prefix + 'Source.txt')), exit: 1, expected: [['unknown-source', 'policy']] },
  { name: 'malformed blob hash', mutate: root => modify(root, s => s.replace(oid(root, 'source.txt'), 'not-a-hash')), exit: 1, expected: [['blob-pin-format', 'policy']] },
  { name: 'unquoted blob hash', mutate: root => modify(root, s => s.replace('"' + oid(root, 'source.txt') + '"', oid(root, 'source.txt'))), exit: 1, expected: [['blob-pin-format', 'policy']] },
  { name: 'missing required pin', mutate: root => modify(root, s => s.replace(/    x-haichi-git-blob: "[^"]+"\n/, '')), exit: 1, expected: [['blob-pin-format', 'policy']] },
  { name: 'symlink tracked at canonical source', mutate: root => {
    rmSync(join(root, 'source.txt'));
    symlinkSync('profile/README.md', join(root, 'source.txt'));
  }, exit: 1, expected: [['nonregular-source', 'policy']] },
  { name: 'gitlink mapped as canonical source', mutate: root => {
    const head = git(root, 'rev-parse', 'HEAD');
    git(root, 'clone', '--quiet', '--no-hardlinks', root, join(root, 'submodule'));
    git(root, 'update-index', '--add', '--cacheinfo', '160000,' + head + ',submodule');
    git(root, 'commit', '-qm', 'add gitlink');
    modify(root, s => s.replace(prefix + 'source.txt', prefix + 'submodule'));
    git(root, 'add', 'knowledge/example.md');
    git(root, 'commit', '-qm', 'map gitlink');
  }, exit: 1, expected: [['nonregular-source', 'policy']], noCommit: true },
  { name: 'missing root index', mutate: root => rmSync(join(root, 'knowledge/index.md')), exit: 1, expected: [['index-missing', 'policy']] },
  { name: 'incomplete index', mutate: root => {
    write(root, 'knowledge/second.md', doc('type: Reference\ndescription: Second'));
  }, exit: 1, expected: [['index-incomplete', 'policy']] },
  { name: 'duplicate index entry', mutate: root => write(root, 'knowledge/index.md', index('# Concepts\n\n- [One](example.md) - Example\n- [Two](./example.md) - Example')), exit: 1, expected: [['index-duplicate', 'policy']] },
  { name: 'index description mismatch', mutate: root => write(root, 'knowledge/index.md', index('# Concepts\n\n- [One](example.md) - Different')), exit: 1, expected: [['index-description', 'policy']] },
  { name: 'dangling index canonical navigation', mutate: root => write(root, 'knowledge/index.md', index('# Concepts\n\n- [One][ref] - Example\n\n[ref]: absent.md')), exit: 1, expected: [['index-reference', 'policy']] },
  { name: 'absolute index link is local policy failure only', mutate: root => write(root, 'knowledge/index.md', index('# Concepts\n\n- [One](/example.md) - Example')), exit: 1, expected: [['index-reference', 'policy']] },
  { name: 'dirty tracked source', mutate: root => write(root, 'source.txt', 'uncommitted change'), exit: 1, expected: [['dirty-checkout', 'policy']], noCommit: true },
  { name: 'dirty index staging', mutate: root => { write(root, 'source.txt', 'staged change'); git(root, 'add', 'source.txt'); }, exit: 1, expected: [['dirty-checkout', 'policy']], noCommit: true },
  { name: 'assume-unchanged tracked source', mutate: root => git(root, 'update-index', '--assume-unchanged', 'source.txt'), exit: 1, expected: [['hidden-tracked-state', 'policy']], noCommit: true },
  { name: 'untracked knowledge must not substitute for committed index', mutate: root => {
    write(root, 'knowledge/new.md', doc('type: Reference\ndescription: Untracked'));
  }, exit: 1, expected: [['untracked-knowledge', 'policy']], noCommit: true },
];
for (const fixture of repoCases) test('repo: ' + fixture.name, () => temp(root => {
  initRepo(root);
  fixture.mutate(root);
  if (!fixture.noCommit) commit(root);
  const before = git(root, 'rev-parse', 'HEAD');
  const beforeStatus = git(root, 'status', '--porcelain=v1', '--untracked-files=all');
  const beforeIndex = readFileSync(join(root, '.git/index'));
  const path = join(root, 'knowledge/example.md');
  const beforeDoc = existsSync(path) ? readFileSync(path) : undefined;
  run('--repo', root, fixture.exit, fixture.expected);
  assert.deepEqual(readFileSync(join(root, '.git/index')), beforeIndex);
  assert.equal(git(root, 'rev-parse', 'HEAD'), before);
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), beforeStatus);
  if (beforeDoc) assert.deepEqual(readFileSync(path), beforeDoc);
}));

test('repo: committed source edit requires refreshed reviewed pin and supports encoded path', () => temp(root => {
  initRepo(root);
  write(root, 'source.txt', 'new bytes');
  write(root, 'with space.txt', 'new source');
  commit(root);
  run('--repo', root, 1, [['stale-blob', 'policy'], ['coverage-missing', 'policy']]);
  const newPin = oid(root, 'source.txt');
  modify(root, s => s.replace(/(source\.txt"\n    x-haichi-git-blob: )"[^"]+"/, '$1"' + newPin + '"')
    .replace('\n---', '\n  - resource: "' + prefix + 'with%20space.txt"\n    x-haichi-git-blob: "' + oid(root, 'with space.txt') + '"\n---')
    .replace('Content.', 'Reviewed updated source.'));
  commit(root);
  run('--repo', root, 0);
}));

test('repo: scope and malformed invocation', () => temp(root => {
  expectResult(validate([]), 2, [['usage', 'setup']]);
  run('--bundle', join(root, 'missing'), 2, [['root-directory', 'setup']]);
  write(root, 'knowledge/example.md', doc());
  run('--repo', root, 2, [['git-metadata', 'setup']]);
}));

test('repo: symlinked knowledge directory rejected without target read', () => temp(root => {
  initRepo(root);
  const outside = join(root, 'profile');
  rmSync(join(root, 'knowledge'), { recursive: true });
  symlinkSync(outside, join(root, 'knowledge'), 'dir');
  run('--repo', root, 1, [['symlink-root', 'safety']]);
}));

test('repo: Git content filter is rejected before execution', () => temp(root => {
  initRepo(root);
  const marker = join(root, 'filter-executed');
  git(root, 'config', 'filter.fixture.clean', 'touch ' + JSON.stringify(marker));
  write(root, '.gitattributes', 'source.txt filter=fixture\n');
  // Stage only attributes, then alter the filtered tracked file. The validator
  // must refuse the filter before Git gets a chance to invoke it.
  git(root, 'add', '.gitattributes');
  git(root, 'commit', '-qm', 'attributes');
  rmSync(marker, { force: true });
  write(root, 'source.txt', 'changed bytes');
  run('--repo', root, 1, [['git-filter', 'safety']]);
  assert.equal(existsSync(marker), false);
}));
