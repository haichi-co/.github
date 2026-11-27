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

The canonical [issue-lifecycle skill](skills/issue-lifecycle/SKILL.md) and its task-readiness reference can be distributed through [Sync organization agent skills](.github/workflows/sync-skills.yml). Repositories opt in with the GitHub topic `haichi-skill-issue-lifecycle`; the topic is configured in [`.github/skill-sync.json`](.github/skill-sync.json). The initial enrolled target is `haichi-co/gharp`. Add the topic to an organization repository to enroll it; remove the topic to stop new updates. The synchronization preserves other skills and the target's `AGENTS.md`; only manifest-listed `.agents/skills/issue-lifecycle/` files are managed.

The workflow runs on a GitHub-hosted runner after relevant `main` updates, daily at **05:19 UTC**, or by manual dispatch (which defaults to **dry-run**). For each enrolled repository, it compares the canonical files with the default branch and existing sync PR. If current, it makes **no writes**. Otherwise it creates or updates the dedicated `haichi-skill-sync/issue-lifecycle` branch and **one reviewable PR**, with read-back verification. A pending matching PR is reused; reruns do not create duplicate commits or PRs. Unexpected edits on the managed branch fail closed rather than overwriting them. Approved PRs are merged by the repository's normal process; the workflow never auto-merges.

**Authentication:** The dedicated `haichi-skill-sync` GitHub App is installed organization-wide with **Contents: read/write** and **Pull requests: read/write**, and its credentials are configured in this repository:

- Actions variable `SKILL_SYNC_APP_CLIENT_ID`: the App's client ID.
- Actions secret `SKILL_SYNC_APP_PRIVATE_KEY`: the App's private key (PEM).
- Actions variable `SKILL_SYNC_ENABLED`: set to `true` **only after** the above are available.

With synchronization enabled, the workflow first mints an organization-wide **read-only** token to discover opted-in repositories (including private ones) from repository topics. It then mints a separate **read/write token restricted to those discovered repositories**; zero matches skips the writer token entirely. Before writing, each target's current topic is rechecked. Unexpected missing topic metadata or repository identity fails closed. Adding a repository to the organization-wide App installation alone does not enroll it. The workflow never executes target-repository code, and does not change repository-specific agent instructions or other workflows. Scheduled workflows in public repositories can be disabled by GitHub after extended inactivity; check their enabled status periodically.

## Repository scaffolding

[Baseline `.gitignore`](templates/base.gitignore) excludes Node dependencies, local `.env` files (while allowing `.env.example` and `.env.sample`), and common operating-system files. Copy it into a new repository's root as `.gitignore`, or incorporate it into repository provisioning.

GitHub does **not** automatically inherit `.gitignore` files from the organization's `.github` repository; this file is an opt-in starter, not an organization-wide enforced default.
