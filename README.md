# Haichi · GitHub

Repository for Haichi's organization-wide GitHub resources and public profile.

See the [organization profile](profile/README.md) for information about Haichi.

## Workflow templates

[Node 24 CI](workflow-templates/node24-ci.yml) is a GitHub Actions starter workflow for npm projects. From a repository's **Actions → New workflow** page, select **Node 24 CI with self-hosted fallback** to copy it into `.github/workflows/`. This is a template, not a workflow that runs in this repository or automatically applies to other repositories.

- **Default runners:** `[self-hosted, linux]` (labels are case-insensitive, no architecture restriction).
- **Override:** Set the repository variable `CI_RUNNERS` to JSON, for example `"ubuntu-latest"` or `["self-hosted","linux"]`.
- **Fork pull requests:** Use GitHub-hosted runners regardless of the override, to avoid running fork code on persistent self-hosted machines.
- **Fallback:** A GitHub-hosted watchdog checks every five minutes and cancels a qualifying self-hosted CI run whose check job has remained queued for at least 30 minutes. It then dispatches a GitHub-hosted run against the original commit SHA. Scheduling is best-effort, not an exact 30-minute guarantee.
- **npm:** Node 24, `npm ci`, optional `check` and `test` scripts, and a verified seven-day `min-release-age` policy during CI.

**Limitations:** A `workflow_dispatch` replacement does **not** satisfy a required `pull_request` status check for the canceled run. Do not select this template unchanged where the CI check is mandatory for merging PRs; that needs a separately validated status-reporting solution. The watchdog also consumes GitHub-hosted Actions minutes and depends on scheduled workflows remaining enabled. Runner dispatch/cancellation has small unavoidable races and requires repository Actions write permission for the scheduled watchdog.

For security, do not give persistent privileged self-hosted runners access to untrusted same-repository PR code merely because the workflow excludes forks.
