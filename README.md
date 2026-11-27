# Haichi · GitHub

Repository for Haichi's organization-wide GitHub resources and public profile.

See the [organization profile](profile/README.md) for information about Haichi.

## Workflow templates

[Node 24 CI](workflow-templates/node24-ci.yml) is a GitHub Actions starter workflow for npm projects. From a repository's **Actions → New workflow** page, select **Node 24 CI with self-hosted fallback** to copy it into `.github/workflows/`. This is a template, not a workflow that runs in this repository or automatically applies to other repositories.

- **Shared CI implementation:** The template calls [`.github/workflows/node-ci.yml`](.github/workflows/node-ci.yml) using `@main`. That reusable workflow handles checkout, Node 24 setup, npm's seven-day release-age guard, installation, checks, and tests. Updating the shared workflow changes CI for all template consumers that still reference `@main`; pin a tag or commit for stricter reproducibility.
- **Default runners:** `[self-hosted, linux]` (labels are case-insensitive, no architecture restriction).
- **Override:** Set the repository variable `CI_RUNNERS` to JSON, for example `"ubuntu-latest"` or `["self-hosted","linux"]`.
- **Fork pull requests:** Use GitHub-hosted runners regardless of the override, to avoid running fork code on persistent self-hosted machines.
- **Fallback:** A GitHub-hosted watchdog checks every five minutes and cancels a qualifying self-hosted CI run whose check job has remained queued for at least 30 minutes. It then dispatches a GitHub-hosted run against the original commit SHA. Scheduling is best-effort, not an exact 30-minute guarantee.
- **npm:** Node 24, `npm ci`, optional `check` and `test` scripts, and a verified seven-day `min-release-age` policy during CI.

**Limitations:** A `workflow_dispatch` replacement does **not** satisfy a required `pull_request` status check for the canceled run. Do not select this template unchanged where the CI check is mandatory for merging PRs; that needs a separately validated status-reporting solution. The watchdog also consumes GitHub-hosted Actions minutes and depends on scheduled workflows remaining enabled. Runner dispatch/cancellation has small unavoidable races and requires repository Actions write permission for the scheduled watchdog.

For security, do not give persistent privileged self-hosted runners access to untrusted same-repository PR code merely because the workflow excludes forks.

## Agent workflow

[Issue lifecycle](skills/issue-lifecycle/SKILL.md) is a portable, GitHub-native skill for research, Decision sub-issues, hierarchical planning, and independently verifiable implementation. Its [task-readiness reference](skills/issue-lifecycle/references/task-readiness.md) helps produce actionable leaves for less-capable agents.

Execution stops after one verified unit by default, or continues sequentially within an explicitly authorized issue scope (and beyond it only when expressly requested). This skill is **opt-in**: files under `skills/` are not inherited automatically by other GitHub repositories or agent hosts.

## Agent skill synchronization

The canonical [issue-lifecycle skill](skills/issue-lifecycle/SKILL.md) and its task-readiness reference can be distributed through [Sync organization agent skills](.github/workflows/sync-skills.yml). The [v3 manifest](.github/skill-sync.json) has an organization owner and a `skills` array. The existing issue-lifecycle enrollment topic (`haichi-skill-issue-lifecycle`), managed files, and branch are unchanged from v2.

To add another skill, place its canonical files under `skills/<skill>/` and append an entry to the manifest: a unique lowercase hyphenated `skill`, `source` of `skills/<skill>`, `destination` of `.agents/skills/<skill>`, an explicit `managed_files` list (including `SKILL.md`), and a unique `opt_in_topic` starting with `haichi-skill-`. Run `node src/skill-sync.ts --validate-config` before committing. Repositories enroll independently by adding each desired topic; the initial issue-lifecycle target is `haichi-co/gharp`. Removing one topic stops updates for that skill without deleting its files or affecting other enrollments. The sync never changes the target's `AGENTS.md` or other skills.

The workflow runs on a GitHub-hosted runner after relevant `main` updates (including changes under any `skills/` directory), daily at **05:19 UTC**, or by manual dispatch (defaults to **dry-run**). Each enrolled repository-skill pair is compared against the default branch and its dedicated `haichi-skill-sync/<skill>` branch and PR. A matching default branch or pending PR makes **no writes**; otherwise the workflow creates or updates one reviewable PR per skill, with read-back verification. Unexpected edits fail closed. Approved PRs are merged by the repository's normal process; the workflow never auto-merges.

**Authentication:** The dedicated `haichi-skill-sync` GitHub App is installed organization-wide with **Contents: read/write** and **Pull requests: read/write**, and its credentials are configured in this repository:

- Actions variable `SKILL_SYNC_APP_CLIENT_ID`: the App's client ID.
- Actions secret `SKILL_SYNC_APP_PRIVATE_KEY`: the App's private key (PEM).
- Actions variable `SKILL_SYNC_ENABLED`: set to `true` **only after** the above are available.

With synchronization enabled, the workflow first mints an organization-wide **read-only** token to discover opted-in repository-skill pairs (including private repositories) from topics. It derives the unique repository union from that validated plan and mints a separate **read/write token restricted to those discovered repositories**; zero matches skips the writer token entirely. Before every write, the specific skill enrollment and repository identity are rechecked. Unexpected missing topic metadata or repository identity fails closed. Adding a repository to the organization-wide App installation alone does not enroll it. The workflow never executes target-repository code, and does not change repository-specific agent instructions or other workflows. Scheduled workflows in public repositories can be disabled by GitHub after extended inactivity; check their enabled status periodically.

## Shared knowledge (OKF v0.3)

The public [Haichi shared GitHub knowledge](https://github.com/haichi-co/.github/blob/main/knowledge/index.md) bundle describes the shared skills, workflows, onboarding and security resources. Its concepts link to the canonical source files rather than duplicating their instructions.

To opt in, open the consuming repository's existing README or another owner-maintained documentation entry point and add this Markdown link once, through the repository's normal review process:

```markdown
[Haichi shared GitHub knowledge](https://github.com/haichi-co/.github/blob/main/knowledge/index.md)
```

Follow the index to the relevant concept and its canonical source. Reading it requires public GitHub access, not a GitHub App credential or an enrollment topic. This is deliberate human/agent discovery, not automatic discovery or installation by every agent host. If a link is unavailable, report that limitation and use a previously reviewed revision if available; do not invent guidance or implicitly execute fetched artifacts.

Link to moving `main` by default to receive centrally reviewed corrections without updating the consumer. When an exact snapshot is needed, replace `main` in the link with the full commit SHA; resolve linked canonical sources at that same reviewed revision for strict historical reproduction. GitHub Releases are not required. Central source mappings and blob pins are validated in CI; a consumer need not install the validator, adopt OKF or change its own specification layout. Consumer-local OKF is independently optional (the generic validator is separate from this repository's coverage policy).

Canonical executable or instruction sources govern their behavior; the consuming repository retains authority over its own requirements, instructions, knowledge and specifications. Skill sync remains independent: it copies actual opted-in skill files and necessary relative dependencies, not the shared knowledge bundle. To opt out of shared knowledge, remove only the link. No managed files, topics, workflows or unrelated local documentation need to change.

## Repository scaffolding

[Baseline `.gitignore`](templates/base.gitignore) excludes Node dependencies, local `.env` files (while allowing `.env.example` and `.env.sample`), and common operating-system files. Copy it into a new repository's root as `.gitignore`, or incorporate it into repository provisioning.

GitHub does **not** automatically inherit `.gitignore` files from the organization's `.github` repository; this file is an opt-in starter, not an organization-wide enforced default.
