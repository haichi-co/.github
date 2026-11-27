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

## Repository scaffolding

[Baseline `.gitignore`](templates/base.gitignore) excludes Node dependencies, local `.env` files (while allowing `.env.example` and `.env.sample`), and common operating-system files. Copy it into a new repository's root as `.gitignore`, or incorporate it into repository provisioning.

GitHub does **not** automatically inherit `.gitignore` files from the organization's `.github` repository; this file is an opt-in starter, not an organization-wide enforced default.
