/**
 * Bounded OKF 0.3 validator (haichi-co/.github#17).
 * The generic scan never resolves a reference against the filesystem.
 * Repo mode adds local policy using Git metadata, not source-file reads.
 * Assumes a trusted checkout without concurrent untrusted writers.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, parse, resolve, sep } from 'node:path';
import { devNull } from 'node:os';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { Root, Nodes, ListItem } from 'mdast';

type Class = 'spec' | 'safety' | 'policy' | 'warning' | 'setup';
type Diagnostic = { path: string; code: string; class: Class; message: string };
type Emit = (path: string, code: string, kind: Class, message: string) => void;
type Meta = Record<string, unknown>;
type Markdown = {
  path: string;
  metadata: Meta;
  yaml: ReturnType<typeof parseDocument> | undefined;
  ast: Root;
  concept: boolean;
};
type Entry = { href: string; description: string };
type Inventory = Map<string, 'file' | 'directory'>;
type Target = { kind: 'internal' | 'missing' | 'external' | 'invalid'; path?: string };
type Blob = { mode: string; oid: string };
const PREFIX = 'https://github.com/haichi-co/.github/blob/main/';
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const absent = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const mapping = (v: unknown): v is Meta => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const items = (v: unknown): unknown[] => absent(v) ? [] : Array.isArray(v) ? v : [v];
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function children(node: Nodes): Nodes[] {
  return 'children' in node ? node.children : [];
}
function walk(node: Nodes, visit: (n: Nodes) => void): void {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}
function plain(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('alt' in node && typeof node.alt === 'string') return node.alt;
  return children(node).map(plain).join('');
}
function definitions(ast: Root): Map<string, string> {
  const result = new Map<string, string>();
  walk(ast, n => { if (n.type === 'definition' && !result.has(n.identifier)) result.set(n.identifier, n.url); });
  return result;
}
function link(node: Nodes, defs: Map<string, string>): string | undefined {
  if (node.type === 'link' || node.type === 'image') return node.url;
  if (node.type === 'linkReference' || node.type === 'imageReference') return defs.get(node.identifier);
  return undefined;
}
function listEntry(item: ListItem, defs: Map<string, string>): Entry | undefined {
  const first = item.children[0];
  if (first?.type !== 'paragraph') return;
  const head = first.children[0];
  if (!head || !['link', 'linkReference'].includes(head.type)) return;
  const href = link(head, defs);
  if (href === undefined) return;
  const description = first.children.slice(1).map(plain).join('').trim().replace(/^[-–—]\s*/, '');
  return { href, description };
}

// Check every component before realpath or traversal; reject even in-root symlinks.
function safeRoot(input: string, label: string, emit: Emit): string | undefined {
  const root = resolve(input);
  let current = parse(root).root;
  try {
    for (const part of root.slice(current.length).split(sep).filter(Boolean)) {
      current = join(current, part);
      const st = lstatSync(current);
      if (st.isSymbolicLink()) {
        emit(label, 'symlink-root', 'safety', 'Root or an ancestor is a symbolic link; use a real directory.');
        return;
      }
      if (!st.isDirectory()) {
        emit(label, 'root-directory', 'setup', 'Root is not a directory.');
        return;
      }
    }
    if (realpathSync(root) !== root) {
      emit(label, 'root-realpath', 'safety', 'Root differs from its verified real path.');
      return;
    }
    return root;
  } catch {
    emit(label, 'root-directory', 'setup', 'Root directory does not exist or cannot be inspected.');
    return;
  }
}

function scan(root: string, emit: Emit): { inventory: Inventory; documents: Map<string, Markdown> } {
  const inventory: Inventory = new Map([['', 'directory']]);
  const documents = new Map<string, Markdown>();
  const folded = new Map<string, string>();
  function visit(relative: string): void {
    const directory = join(root, relative);
    let names: string[];
    try { names = readdirSync(directory).sort(cmp); }
    catch { emit(relative || '.', 'read-directory', 'setup', 'Cannot enumerate bundle directory.'); return; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const path = relative ? relative + '/' + name : name;
      const full = join(root, path);
      try {
        const st = lstatSync(full);
        if (st.isSymbolicLink()) {
          emit(path, 'symlink', 'safety', 'Symbolic links are not traversed or read.');
          continue;
        }
        if (!st.isFile() && !st.isDirectory()) {
          emit(path, 'nonregular', 'safety', 'Only regular files and directories are supported.');
          continue;
        }
        if (realpathSync(full) !== full) {
          emit(path, 'realpath', 'safety', 'Path differs from its verified real path.');
          continue;
        }
        const lower = path.toLowerCase();
        if (folded.has(lower)) emit(path, 'case-collision', 'warning', 'Case-only collision with ' + folded.get(lower) + '.');
        else folded.set(lower, path);
        inventory.set(path, st.isDirectory() ? 'directory' : 'file');
        if (st.isDirectory()) visit(path);
        else if (path.endsWith('.md')) {
          let source: string;
          try { source = decoder.decode(readFileSync(full)); }
          catch { emit(path, 'utf8-or-read', 'spec', 'Markdown must be readable UTF-8.'); continue; }
          const doc = parseMarkdown(path, source, emit);
          if (doc) documents.set(path, doc);
        }
      } catch {
        emit(path, 'read-entry', 'setup', 'Cannot inspect bundle entry.');
      }
    }
  }
  visit('');
  return { inventory, documents };
}

function parseMarkdown(path: string, text: string, emit: Emit): Markdown | undefined {
  let body = text;
  let metadata: Meta = {};
  let yaml: Markdown['yaml'];
  if (/^---(?:\r?\n|$)/.test(text)) {
    const lines = text.split(/\r?\n/);
    const end = lines.indexOf('---', 1);
    if (end < 0) {
      emit(path, 'frontmatter-delimiter', 'spec', 'Missing closing exact --- frontmatter delimiter.');
      return;
    }
    body = lines.slice(end + 1).join('\n');
    // Explicit core schema even if the document tries to declare YAML 1.1.
    yaml = parseDocument(lines.slice(1, end).join('\n'), {
      version: '1.2', schema: 'core', uniqueKeys: true, strict: true, prettyErrors: false,
    });
    if (yaml.errors.length || !isMap(yaml.contents)) {
      emit(path, 'frontmatter-mapping', 'spec', 'Frontmatter must be a unique-key YAML 1.2 core mapping: ' +
        (yaml.errors.map(e => e.code).join(', ') || 'not a mapping'));
      return;
    }
    if (yaml.directives?.yaml.version !== '1.2') {
      emit(path, 'frontmatter-version', 'spec', 'Use YAML 1.2 core frontmatter.');
      return;
    }
    for (const w of yaml.warnings) emit(path, 'yaml-warning', 'warning', w.code);
    try {
      metadata = yaml.toJS({ maxAliasCount: 100 }) as Meta;
    } catch {
      emit(path, 'frontmatter-alias', 'spec', 'Unresolvable or excessive YAML aliases.');
      return;
    }
  }
  const ast = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const filename = basename(path);
  const reserved = filename === 'index.md' || filename === 'log.md';
  const concept = !reserved && nonempty(metadata.type);
  if (!reserved && !concept) {
    if (!absent(metadata.type)) emit(path, 'type-format', 'warning', 'Nonempty type must be a string; file is not a concept.');
    else emit(path, 'not-concept', 'warning', 'Ordinary Markdown without a type; not a concept.');
  }
  if ((filename === 'log.md' || (filename === 'index.md' && path !== 'index.md')) && yaml) {
    emit(path, 'reserved-frontmatter', 'spec', 'Only the root index may contain frontmatter.');
  }
  return { path, metadata, yaml, ast, concept };
}

// Resolve URI references exclusively against the already-safe inventory. Dot files are absent.
// Split encoded path components before decoding to prevent encoded separators from changing meaning.
function resolveTarget(from: string, raw: string, inventory: Inventory): Target {
  if (/[\u0000-\u0020\u007f\\]/u.test(raw) || /%(?![0-9a-f]{2})/i.test(raw)) return { kind: 'invalid' };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return { kind: 'external' };
  const target = raw.split(/[?#]/, 1)[0]!;
  if (!target) return { kind: 'internal', path: from };
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  try {
    for (const encoded of target.split('/')) {
      const part = decodeURIComponent(encoded);
      if (/[\/\\\u0000-\u001f\u007f]/u.test(part)) return { kind: 'invalid' };
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) return { kind: 'external' };
        parts.pop();
      } else parts.push(part);
    }
  } catch { return { kind: 'invalid' }; }
  const path = parts.join('/');
  // Do not re-interpret dot paths or access a target using a different case.
  return { kind: inventory.has(path) ? 'internal' : 'missing', path };
}

function isDate(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2})))?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, h, m, s, oh, om] = match;
  const y = Number(year), mo = Number(month), d = Number(day);
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]! &&
    (h === undefined || (Number(h) <= 23 && Number(m) <= 59 && Number(s) <= 60)) &&
    (oh === undefined || (Number(oh) <= 23 && Number(om) <= 59));
}

function inspectDocument(doc: Markdown, inventory: Inventory, emit: Emit): Entry[] {
  const { path, metadata: m, ast } = doc;
  if (!doc.concept && !['index.md', 'log.md'].includes(basename(path))) return [];
  const defs = definitions(ast);
  const warn = (code: string, message: string) => emit(path, code, 'warning', message);
  const fail = (code: string, message: string) => emit(path, code, 'spec', message);
  const checkRef = (raw: unknown, field: string, source = false) => {
    if (absent(raw)) return;
    if (!nonempty(raw)) { warn('path-field-format', field + ' must be a nonempty URI reference.'); return; }
    // Sources can be non-resolvable scope descriptors (§5.1).
    if (source && /\s/.test(raw) && !/^[a-z][a-z0-9+.-]*:|^\.{0,2}\/|\.md(?:$|[?#])/i.test(raw)) return;
    const target = resolveTarget(path, raw, inventory);
    if (target.kind === 'invalid') fail('malformed-path', field + ': malformed URI reference ' + JSON.stringify(raw));
    else if (target.kind === 'missing') warn('broken-link', field + ': unresolved ' + JSON.stringify(raw));
  };
  const timestamp = (value: unknown, field: string) => {
    if (!absent(value) && !isDate(value)) warn('timestamp-format', field + ' must be RFC 3339 full-date or offset date-time.');
  };
  const actor = (value: unknown, field: string) => {
    if (!absent(value) && (!nonempty(value) || !/^(?:[^\s/:]+\/[^\s]+|[A-Za-z][A-Za-z0-9+.-]*:.+)$/u.test(value))) warn('actor-format', field + ' must be producer/version or scheme:id.');
  };
  const window = (value: unknown, field: string) => {
    if (absent(value)) return;
    if (!mapping(value)) { warn('usage-window-format', field + ' must be a mapping.'); return; }
    timestamp(value.from, field + '.from'); timestamp(value.to, field + '.to');
  };
  walk(ast, n => { const href = link(n, defs); if (href !== undefined) checkRef(href, n.type); });

  const entries: Entry[] = [];
  if (basename(path) === 'index.md') {
    let heading = false, list = false;
    for (const block of ast.children) {
      if (block.type === 'definition') continue;
      if (block.type === 'heading') { heading = true; continue; }
      if (block.type === 'list' && heading) {
        list = true;
        for (const item of block.children) {
          const entry = listEntry(item, defs);
          if (!entry) fail('index-entry', 'Index list entries must begin with a Markdown link.');
          else entries.push(entry);
        }
      } else fail('index-shape', 'Index must group linked list entries under headings.');
    }
    if (!heading || !list || !entries.length) fail('index-shape', 'Index requires a heading and linked list entries.');
    if (path === 'index.md' && !absent(m.okf_version) && (!nonempty(m.okf_version) || !/^\d+\.\d+$/.test(m.okf_version))) {
      warn('version-format', 'Declare okf_version as a quoted major.minor string.');
    }
  } else if (basename(path) === 'log.md') {
    let previous: string | undefined, hadEntries = false, title = false;
    for (const block of ast.children) {
      if (block.type === 'definition') continue;
      if (block.type === 'heading') {
        const value = plain(block);
        if (!previous && !title && block.depth === 1 && !/^\d{4}-/.test(value)) { title = true; continue; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isDate(value)) fail('log-date', 'Log date headings must be valid YYYY-MM-DD dates.');
        if (previous && (!hadEntries || value >= previous)) fail('log-order', 'Log date groups must have entries and be newest first.');
        previous = value; hadEntries = false;
      } else if (block.type === 'list' && previous) {
        hadEntries = true;
        if (block.children.some(i => i.children.some(c => c.type === 'list'))) fail('log-list', 'Log entries must be a flat prose list.');
      } else fail('log-shape', 'Log must contain flat lists grouped by date.');
    }
    if (!previous || !hadEntries) fail('log-shape', 'Log requires a date group with entries.');
  } else if (doc.concept) {
    for (const field of ['resource', 'computation', 'superseded_by']) checkRef(m[field], field);
    for (const field of ['title', 'description', 'status']) {
      if (!absent(m[field]) && !nonempty(m[field])) warn('field-format', field + ' must be a string.');
    }
    if (!absent(m.status) && !['draft', 'stable', 'deprecated'].includes(String(m.status))) warn('status-value', 'Unknown status retained.');
    for (const tag of items(m.tags)) if (!nonempty(tag)) warn('tag-format', 'Tags should be nonempty strings.');
    timestamp(m.stale_after, 'stale_after');
    window(m.usage_window, 'usage_window');
    for (const [i, source] of items(m.sources).entries()) {
      const field = 'sources[' + i + ']';
      if (!mapping(source) || !nonempty(source.resource)) { warn('source-resource', field + ' requires resource.'); continue; }
      checkRef(source.resource, field + '.resource', true);
      timestamp(source.last_modified, field + '.last_modified');
      actor(source.author, field + '.author');
      window(source.usage_window, field + '.usage_window');
      if (!absent(source.usage_count) && (typeof source.usage_count !== 'number' || !Number.isInteger(source.usage_count) || source.usage_count < 0)) warn('usage-count', field + '.usage_count must be a nonnegative integer.');
    }
    if (!absent(m.generated)) {
      if (!mapping(m.generated) || !nonempty(m.generated.by)) warn('generated-by', 'generated requires by.');
      else { actor(m.generated.by, 'generated.by'); timestamp(m.generated.at, 'generated.at'); }
    }
    for (const [i, event] of items(m.verified).entries()) {
      if (!mapping(event) || !nonempty(event.by) || absent(event.at)) { warn('verified-entry', 'verified[' + i + '] requires by and at.'); continue; }
      actor(event.by, 'verified.by'); timestamp(event.at, 'verified.at');
    }
    if (m.type === 'Attested Computation') {
      if (!nonempty(m.runtime)) warn('computation-runtime', 'Attested Computation requires runtime; not attestable.');
      if (!nonempty(m.computation)) {
        let section: number | undefined, found = false;
        for (const block of ast.children) {
          if (block.type === 'heading') {
            if (plain(block) === 'Computation') section = block.depth;
            else if (section !== undefined && block.depth <= section) section = undefined;
          } else if (block.type === 'code' && section !== undefined) found = true;
        }
        if (!found) warn('computation-body', 'No computation path or code block in a Computation section; not attestable.');
      }
      for (const parameter of items(m.parameters)) if (!mapping(parameter) || !nonempty(parameter.name) || !nonempty(parameter.type)) warn('parameter-entry', 'Parameter requires name and type.');
      for (const field of ['executor', 'attester']) {
        if (mapping(m[field])) checkRef(m[field].resource, field + '.resource');
        else if (!absent(m[field])) warn('computation-field', field + ' must be a mapping.');
      }
    } else {
      for (const field of ['executor', 'attester']) if (mapping(m[field])) checkRef(m[field].resource, field + '.resource');
    }
  }
  return entries;
}

function excluded(path: string): boolean {
  return path.startsWith('profile/') || path.startsWith('knowledge/') ||
    path.startsWith('src/okf/') || path === '.github/workflows/validate-okf.yml';
}
function canonicalPath(url: unknown): string | undefined {
  if (!nonempty(url) || !url.startsWith(PREFIX)) return;
  const suffix = url.slice(PREFIX.length);
  try {
    const parts = suffix.split('/').map(decodeURIComponent);
    if (parts.some(part => !part || part === '.' || part === '..' || /[\/\\\u0000-\u001f\u007f]/u.test(part))) return;
    // Encode exactly once, preserving slash delimiters and RFC 3986 unreserved characters.
    const encoded = parts.map(part => encodeURIComponent(part).replace(/[!'()*]/g, ch =>
      '%' + ch.charCodeAt(0).toString(16).toUpperCase())).join('/');
    if (encoded !== suffix) return;
    return parts.join('/');
  } catch { return; }
}

function gitMetadata(root: string, emit: Emit): Map<string, Blob> | undefined {
  // Direct argv, no shell, no target code execution, no optional index writes.
  // The explicit Git checkout is trusted. Disable fsmonitor and ignore untracked dependencies.
  const git = (args: string[]) => execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false', '-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    // Do not inherit repository overrides, injected configuration, or credentials.
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_COUNT: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
    },
  });
  try {
    if (git(['rev-parse', '--show-toplevel']).trim() !== root ||
        git(['rev-parse', '--show-object-format']).trim() !== 'sha1') {
      emit('.', 'git-root', 'setup', 'Supply the root of a SHA-1 Git checkout.');
      return;
    }
    // Git may execute configured clean/process filters during dirty-state checks.
    // Refuse those checkouts rather than running source-controlled/external programs.
    const configKeys = git(['config', '--list', '--name-only', '--null']).split('\0');
    if (configKeys.some(key => /^filter\..+\.(?:clean|process)$/i.test(key))) {
      emit('.', 'git-filter', 'safety', 'Configured Git content filters are not supported; use an ordinary clean checkout.');
      return;
    }
    const obscured = git(['ls-files', '-v', '-z']).split('\0').some(entry => /^[a-zS] /.test(entry));
    if (obscured) {
      emit('.', 'hidden-tracked-state', 'policy', 'Tracked paths use assume-unchanged or skip-worktree; use a clean complete checkout.');
      return;
    }
    const dirty = git(['status', '--porcelain=v1', '-z', '--untracked-files=no', '--ignore-submodules=dirty']);
    if (dirty) {
      emit('.', 'dirty-checkout', 'policy', 'Tracked checkout must match HEAD; commit or restore tracked changes.');
      return;
    }
    const blobs = new Map<string, Blob>();
    for (const entry of git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).split('\0').filter(Boolean)) {
      const match = /^(\d+) \w+ ([a-f0-9]{40})\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error('Unexpected tree record');
      blobs.set(match[3]!, { mode: match[1]!, oid: match[2]! });
    }
    return blobs;
  } catch {
    emit('.', 'git-metadata', 'setup', 'Cannot obtain clean HEAD Git metadata.');
    return;
  }
}

function inspectRepo(root: string, inventory: Inventory, docs: Map<string, Markdown>,
  index: Entry[], emit: Emit): void {
  const blobs = gitMetadata(root, emit);
  if (!blobs) return;
  const fail = (path: string, code: string, message: string) => emit(path, code, 'policy', message);
  const concepts = new Map([...docs].filter(([, doc]) => doc.concept));
  const listed = new Set<string>();
  if (!docs.has('index.md')) fail('index.md', 'index-missing', 'Repository knowledge requires a root index.');
  for (const entry of index) {
    const target = resolveTarget('index.md', entry.href, inventory);
    if (target.kind !== 'internal' || !target.path || /^[\/#?]|^[A-Za-z][A-Za-z0-9+.-]*:/.test(entry.href) || /[?#]/.test(entry.href)) {
      fail('index.md', 'index-reference', 'Index requires resolvable relative navigation: ' + JSON.stringify(entry.href));
      continue;
    }
    const prefix = 'knowledge/' + target.path;
    const tracked = blobs.get(prefix);
    if (!(tracked && ['100644', '100755'].includes(tracked.mode)) &&
        ![...blobs.keys()].some(p => p.startsWith(prefix + '/'))) {
      fail('index.md', 'index-untracked', 'Index navigation must target committed knowledge: ' + target.path);
      continue;
    }
    const concept = concepts.get(target.path);
    if (!concept) continue;
    if (listed.has(target.path)) fail('index.md', 'index-duplicate', 'Concept listed more than once: ' + target.path);
    listed.add(target.path);
    if (!nonempty(concept.metadata.description) || entry.description !== concept.metadata.description) {
      fail('index.md', 'index-description', 'Description must match ' + target.path + ' frontmatter.');
    }
  }
  for (const path of concepts.keys()) if (!listed.has(path)) fail('index.md', 'index-incomplete', 'List concept ' + path + ' exactly once.');
  const seen = new Map<string, string>();
  for (const [path, doc] of concepts) {
    // Check actual scalar style so a numeric-looking blob cannot silently lose its string identity.
    const srcNode = doc.yaml?.get('sources', true);
    const yamlEntries = isSeq(srcNode) ? srcNode.items : [srcNode];
    for (const [i, source] of items(doc.metadata.sources).entries()) {
      const where = 'sources[' + i + ']';
      const sourcePath = mapping(source) ? canonicalPath(source.resource) : undefined;
      if (!sourcePath) { fail(path, 'source-url', where + ' requires exact canonical GitHub blob/main URL.'); continue; }
      if (seen.has(sourcePath)) fail(path, 'duplicate-source', sourcePath + ' also mapped by ' + seen.get(sourcePath) + '.');
      else seen.set(sourcePath, path);
      const blob = blobs.get(sourcePath);
      if (excluded(sourcePath)) fail(path, 'excluded-source', sourcePath + ' is outside approved coverage.');
      else if (!blob) fail(path, 'unknown-source', sourcePath + ' is not tracked at HEAD.');
      else if (!['100644', '100755'].includes(blob.mode)) fail(path, 'nonregular-source', sourcePath + ' is not a regular tracked blob.');
      const rawPin = mapping(source) ? source['x-haichi-git-blob'] : undefined;
      const node = yamlEntries[i];
      const pin = isMap(node) ? node.get('x-haichi-git-blob', true) : undefined;
      if (typeof rawPin !== 'string' || !/^[a-f0-9]{40}$/.test(rawPin) ||
          !isScalar(pin) || !['QUOTE_DOUBLE', 'QUOTE_SINGLE'].includes(pin.type ?? '')) {
        fail(path, 'blob-pin-format', where + ' requires quoted 40-hex x-haichi-git-blob.');
      } else if (blob && rawPin !== blob.oid) fail(path, 'stale-blob', sourcePath + ' changed; review concept and pin ' + blob.oid + '.');
    }
  }
  for (const [path, blob] of blobs) {
    if (!excluded(path) && ['100644', '100755'].includes(blob.mode) && !seen.has(path))
      fail(path, 'coverage-missing', 'Tracked regular source must be mapped by exactly one concept.');
  }
  // Policy applies to the committed knowledge, not untracked substitutes.
  for (const path of docs.keys()) {
    const blob = blobs.get('knowledge/' + path);
    if (!blob || !['100644', '100755'].includes(blob.mode)) fail(path, 'untracked-knowledge', 'Markdown must be a regular file tracked at HEAD.');
  }
}

export function validate(args: string[]): { exit: number; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const emit: Emit = (path, code, kind, message) => diagnostics.push({ path, code, class: kind, message });
  const [mode, supplied] = args;
  if (args.length !== 2 || !supplied || (mode !== '--bundle' && mode !== '--repo')) {
    emit('.', 'usage', 'setup', 'Usage: node src/okf/validate.mts --bundle <root> | --repo <root>');
  } else {
    const explicit = safeRoot(supplied, '.', emit);
    if (explicit) {
      const root = mode === '--repo' ? safeRoot(join(explicit, 'knowledge'), 'knowledge', emit) : explicit;
      if (root) {
        const { inventory, documents } = scan(root, emit);
        if (!documents.has('index.md')) emit('index.md', 'optional-index', 'warning', 'Optional root index is absent.');
        let index: Entry[] = [];
        for (const doc of documents.values()) {
          const entries = inspectDocument(doc, inventory, emit);
          if (doc.path === 'index.md') index = entries;
        }
        if (mode === '--repo') inspectRepo(explicit, inventory, documents, index, emit);
      } else if (mode === '--repo' && diagnostics.some(d => d.code === 'root-directory')) {
        // Missing knowledge is explicit local policy, not invalid invocation.
        const d = diagnostics.find(d => d.path === 'knowledge' && d.code === 'root-directory');
        if (d) { d.class = 'policy'; d.code = 'bundle-missing'; }
      }
    }
  }
  diagnostics.sort((a, b) => cmp(a.path, b.path) || cmp(a.code, b.code) || cmp(a.class, b.class) || cmp(a.message, b.message));
  const exit = diagnostics.some(d => d.class === 'setup') ? 2 : diagnostics.some(d => d.class !== 'warning') ? 1 : 0;
  return { exit, diagnostics };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validate(process.argv.slice(2));
  for (const d of result.diagnostics) console.log(JSON.stringify(d));
  process.exitCode = result.exit;
}
