# Haichi · GitHub

Repository for Haichi's organization-wide GitHub resources and public profile.

See the [organization profile](profile/README.md) for information about Haichi.

## Workflow templates

[Node 24 CI](workflow-templates/node24-ci.yml) is a GitHub Actions starter workflow for npm projects. From a repository's **Actions → New workflow** page, select **Node 24 CI with self-hosted fallback** to copy it into `.github/workflows/`. This is a template, not a workflow that runs in this repository or automatically applies to other repositories.

- **Shared CI implementation:** The template calls [`.github/workflows/node-ci.yml`](.github/workflows/node-ci.yml) using `@main`. That reusable workflow handles checkout, Node 24 setup, npm's seven-day release-age guard, installation, checks, and tests. Updating the shared workflow changes CI for all template consumers that still reference `@main`; use an exact reviewed commit SHA for stricter reproducibility.
- **Default runners:** `[self-hosted, linux]` (labels are case-insensitive, no architecture restriction).
- **Override:** Set the repository variable `CI_RUNNERS` to JSON, for example `"ubuntu-latest"` or `["self-hosted","linux"]`.
- **Fork pull requests:** Use GitHub-hosted runners regardless of the override, to avoid running fork code on persistent self-hosted machines.
- **Fallback:** A GitHub-hosted watchdog checks every five minutes and cancels a qualifying self-hosted CI run whose check job has remained queued for at least 30 minutes. It then dispatches a GitHub-hosted run against the original commit SHA. Scheduling is best-effort, not an exact 30-minute guarantee.
- **npm:** Node 24, `npm ci`, optional `check` and `test` scripts, and a verified seven-day `min-release-age` policy during CI.

**Limitations:** A `workflow_dispatch` replacement does **not** satisfy a required `pull_request` status check for the canceled run. Do not select this template unchanged where the CI check is mandatory for merging PRs; that needs a separately validated status-reporting solution. The watchdog also consumes GitHub-hosted Actions minutes and depends on scheduled workflows remaining enabled. Runner dispatch/cancellation has small unavoidable races and requires repository Actions write permission for the scheduled watchdog.

For security, do not give persistent privileged self-hosted runners access to untrusted same-repository PR code merely because the workflow excludes forks.

## Dependency maintenance and versioning

Managed workflows pin external Actions to full 40-character upstream commit SHAs, with the exact published version in a comment. The hosted validation check inspects the parsed workflow and template `uses` references for these pins and comments; the starter's shared reusable-workflow `@main` call is the deliberate exception. This check does not establish upstream authenticity by itself.

Update dependencies in a reviewed PR: inspect the upstream release, its changes and compatibility/security implications; resolve its exact tag (peel annotated tags to the commit) in the canonical upstream repository and verify the full SHA. Change the reference and version comment together in every affected managed workflow. Run pin validation, relevant workflow and disposable-consumer checks, and OKF validation; review affected concept summaries and refresh their exact committed source blob pins. For the skill-sync workflow, verify the currently enrolled managed files and pending PRs are already reconciled before merging changes that trigger synchronization. Roll back a bad update with a reviewed revert or replacement using the previous verified SHA and matching comment, refreshing related knowledge pins and re-running checks. Do not substitute a mutable upstream tag.

The repository does not have a unified release version. Copied workflow templates are snapshots in the consumer's own commit history; synced skills and necessary relative dependencies are versioned by their merged consumer sync PRs; shared informational OKF knowledge links to current `main` by default, with exact commit snapshots optional. Reusable workflow compatibility version tags are deferred until an actual external caller, imminent incompatible interface change or consumer rollback need warrants them. Any future compatibility promise applies only to that executable workflow surface: use a moving plain major tag for compatible fixes and immutable exact releases only if separately authorized. Do not publish releases for routine changes to knowledge, skills or templates.

## Agent workflow

[Issue lifecycle](skills/issue-lifecycle/SKILL.md) is a portable, GitHub-native skill for research, Decision sub-issues, hierarchical planning, and independently verifiable implementation. Its [task-readiness reference](skills/issue-lifecycle/references/task-readiness.md) helps produce actionable leaves for less-capable agents.

Execution stops after one verified unit by default, or continues sequentially within an explicitly authorized issue scope (and beyond it only when expressly requested). This skill is **opt-in**: files under `skills/` are not inherited automatically by other GitHub repositories or agent hosts.

## Central main protection

[Decision #38](https://github.com/haichi-co/.github/issues/38) requires personal owner review in this central repository. [CODEOWNERS](.github/CODEOWNERS) designates `dddominikk` for every path, and [AGENTS.md](AGENTS.md) defines the agent operating boundary. The owner retains Admin; `agent-hachi` has a non-admin repository role (Maintain) here, independently of its role in other repositories. Agents open PRs and may merge as themselves only after the owner personally approves the current head and the required checks pass. Agent reviews are evidence, not the owner's approval. Agents must not approve, merge or bypass using the owner's credentials.

The desired main protection is versioned as two independent branch rulesets:

- [main-owner-review](.github/rulesets/main.json): one approving code-owner review; new reviewable commits dismiss stale approvals. Only the exact owner account (user ID 47727604) has PR-only bypass, reserved for the owner's own PR when self-approval is unavailable. The owner uses that bypass personally, only after CI passes.
- [main-integrity](.github/rulesets/main-integrity.json): no bypass actors; requires a PR, passing `verify` and `validate-okf` from GitHub Actions (integration ID 15368) on the latest base, and blocks force pushes and branch deletion. Both rulesets match exactly `refs/heads/main`. The review bypass cannot bypass integrity.

Both checks report on every PR targeting `main`, including profile-only or documentation-only changes and PRs retargeted to main. `verify` checks the skill-sync code/manifest without minting App tokens in PRs; `validate-okf` checks the knowledge, source pins and workflow pins. The reusable `node-ci.yml` is not a native check in this repository. Read-only PR verification is isolated by PR from the existing shared writer queue, so one PR cannot cancel a pending sync or another PR check. Push/schedule/dispatch remain supported, but synchronization authorization is governed by the reviewed sync policy described below.

The JSON files describe desired state; committing them does not activate GitHub rulesets. After the governance PR is personally approved and merged, verify both check contexts on a benign profile-only PR. With separate owner authorization, an administrator applies the exact reviewed JSON from `.github/rulesets/` using the repository ruleset API or import UI (review rule **and** integrity rule). First inspect existing rulesets/roles, stop on unexpected configuration, and do not broaden the bypass if GitHub rejects the exact User actor. Read back both active definitions and effective rules for `main`, confirm the machine user has no bypass or rule administration, then verify an agent-authored green PR without personal owner review cannot merge. Do not attempt destructive push/deletion tests. Record evidence in [#37](https://github.com/haichi-co/.github/issues/37). Ruleset edits, disabling, or rollback require separately authorized owner action; never remove protection to unblock a PR.

Main protection alone does not isolate repository-level Actions secrets. Repository writers can invoke branch workflows; the separately authorized skill-sync environment migration in [#39](https://github.com/haichi-co/.github/issues/39) must remove the legacy repository-level key before the credential boundary can be considered established. Neither policy protects against a compromised owner or previously exposed credentials. Do not copy these owner-specific rulesets into other repositories unchanged.

## Agent skill synchronization

The canonical [issue-lifecycle skill](skills/issue-lifecycle/SKILL.md) and its task-readiness reference can be distributed through [Sync organization agent skills](.github/workflows/sync-skills.yml). The [v3 manifest](.github/skill-sync.json) has an organization owner and a `skills` array. The existing issue-lifecycle enrollment topic (`haichi-skill-issue-lifecycle`), managed files, and branch are unchanged from v2.

To add another skill, place its canonical files under `skills/<skill>/` and append an entry to the manifest: a unique lowercase hyphenated `skill`, `source` of `skills/<skill>`, `destination` of `.agents/skills/<skill>`, an explicit `managed_files` list (including `SKILL.md`), and a unique `opt_in_topic` starting with `haichi-skill-`. Run `node src/skill-sync.ts --validate-config` before committing. Repositories enroll independently by adding each desired topic; the initial issue-lifecycle target is `haichi-co/gharp`. Removing one topic stops updates for that skill without deleting its files or affecting other enrollments. The sync never changes the target's `AGENTS.md` or other skills.

The workflow runs on a GitHub-hosted runner after relevant `main` updates (including changes under any `skills/` directory), daily at **05:19 UTC**, or by manual dispatch (defaults to **dry-run**). Each enrolled repository-skill pair is compared against the default branch and its dedicated `haichi-skill-sync/<skill>` branch and PR. A matching default branch or pending PR makes **no writes**; otherwise the workflow creates or updates one reviewable PR per skill, with read-back verification. Unexpected edits fail closed. Approved PRs are merged by the repository's normal process; the workflow never auto-merges.

**Authentication and authorization:** The existing organization-wide `haichi-skill-sync` GitHub App has **Contents: read/write** and **Pull requests: read/write**. Its intended protected environment is `skill-sync`, configured by the owner in this public central repository:

- Selected deployment branches/tags: one rule of type **branch**, pattern `main`; no tag rules, wildcards, PR refs, or broad protected-branches mode. Disable administrator bypass where supported; do not require per-deployment reviewers for scheduled sync.
- Environment variable `SKILL_SYNC_APP_CLIENT_ID`: the public App client ID, checked against the exact reviewed identifier.
- Environment secret `SKILL_SYNC_APP_PRIVATE_KEY`: the existing App private key (PEM), provisioned securely by the owner. No duplicate key at repository or organization level.

**Provisioning:** Prefer Doppler's `haichi-co` integration synced only to repository `haichi-co/.github`, environment `skill-sync`, using the stable secret name above. If synchronization fails, the owner can manually restore the key into that same protected environment from a secure recovery source; never use an unprotected repository or organization secret as a fallback. See [the OKF credential decision and recovery rationale](knowledge/skill-sync.md#credential-provisioning-and-recovery-decision) for the rejected broad sync, configuration ownership, and safe recovery procedure.

[Decision #50](https://github.com/haichi-co/.github/issues/50) selects [reviewed policy JSON](.github/skill-sync-policy.json) as the sole enable switch. A literal Actions variable (or boolean secret) can fall back to another scope; `vars` does not establish scope provenance and the built-in workflow token cannot read environment variables directly through the API. No extra PAT or App permission is introduced. The committed file has exactly three fields in canonical two-space JSON with a final newline: `enabled` and `dry_run_only` must be JSON booleans; `app_client_id` is the expected nonsecret App identifier. The runner validates the configured client ID against this value; a matching lower-scope fallback cannot change App identity, but scope isolation of the **key** must be verified independently. The legacy `SKILL_SYNC_ENABLED` variable has no authority in the new workflow.

- `enabled: false`: no App tokens or synchronization, including manual dispatch. Verification continues on all PRs and schedules.
- `enabled: true, dry_run_only: true`: only explicit manual dispatch with `dry_run: true` can mint tokens and preview; pushes, schedules and non-dry-run dispatches cannot.
- `enabled: true, dry_run_only: false`: normal sync on reviewed main, including the existing manual dry-run default.

The `sync` job depends on credential-free `verify`, declares `environment: skill-sync`, and runs only in this repository on `refs/heads/main` for push, schedule or manual dispatch. [The guard](src/skill-sync-policy.ts) rejects malformed/missing/ambiguous policy, wrong App identity or checkout/ref/event; using only the read-only workflow token, it checks the current main SHA before producing an authorization output. All token/discovery/sync steps require this output; authorization and current main are checked again before writer token minting and synchronization. Historical reruns on an old main SHA cannot authorize. This is a freshness check, not an atomic lock on main: an in-flight run may have passed its last check before a change, and already minted tokens are not instantaneously revoked just by changing the flag.

**Staged migration (#39):** The initial policy is disabled. Do not merge the migration PR until the owner separately authorizes and configures the exact main-only environment and stages the key/client ID. Snapshot enrolled targets, pending PRs and active runs; pause/cancel active or queued runs only with owner authorization if needed. After the owner-approved merge, prove the disabled job skips every App token and target step, and verify the environment boundary using only a benign dummy/non-secret probe on non-main branch/tag refs. Remove the legacy repository key and both old repository variables only with separate explicit owner authorization and after verifying the protected replacement is ready; verify no repo/org duplicate by metadata, never extract or display secrets. If the original credential is unavailable, stop for owner-approved key rotation; do not export the existing secret. Then use a reviewed change to enable dry-run-only mode, explicitly dispatch the main dry run, verify token scope/results and unchanged target state, and only after successful evidence use another approved change to enable normal synchronization. Avoid enabling when the environment, role, visibility, or main protection is not as documented. This source change does not by itself activate any environment or migrate any credentials.

**Disable/recover:** Change `enabled` to false through a reviewed PR. For an urgent stop, separately authorized owner administration must cancel active/queued runs and restrict environment deployments (or remove access to the key with a secure recovery plan); canceling runs and stale-head checks are needed because the config change alone does not stop in-flight operations. Recover using a reviewed policy and the protected environment only; never restore a repository-level key, broaden branch/tag policies or bypass review. Recovery of a potentially exposed key requires separate rotation/revocation authorization. Keep #37 main rulesets and #38 owner/non-admin machine boundary intact. The public Free repo must remain public for these environment protections to apply.

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
