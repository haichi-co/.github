import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const decisionsPath = 'skills/issue-lifecycle/references/decisions.md';

function filesUnder(path: string): string[] {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap(entry => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

test('Decision issue rule is canonical, complete, and linked by the lifecycle skill', () => {
  const decisions = read(decisionsPath);
  const skill = read('skills/issue-lifecycle/SKILL.md');

  for (const phrase of [
    'Decision: <option>',
    'Every assignee must concur.',
    'Decidable by: @user[, @user]',
    'Each identity acts only as itself.',
    'Reversing a completed decision requires reopening',
  ]) assert.ok(decisions.includes(phrase), `missing canonical decision rule: ${phrase}`);
  assert.match(skill, /\[GitHub Decision issue mechanism\]\(references\/decisions\.md\)/);
});

test('Decision issue rule is not duplicated outside its canonical reference', () => {
  const signatures = ['Decision: <option>', 'Every assignee must concur.', 'Decidable by: @user[, @user]'];
  const paths = ['AGENTS.md', ...filesUnder('skills').filter(path => path !== decisionsPath), ...filesUnder('.github/ISSUE_TEMPLATE')];
  for (const path of paths) {
    const content = read(path);
    for (const signature of signatures)
      assert.equal(content.includes(signature), false, `${signature} must live only in ${decisionsPath}; found in ${path}`);
  }
});
