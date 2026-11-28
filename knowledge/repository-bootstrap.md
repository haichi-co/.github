---
type: Reference
title: "Repository bootstrap"
description: "Organization repository onboarding guidance and the opt-in ignore-file scaffold."
sources:
  - resource: "https://github.com/haichi-co/.github/blob/main/README.md"
    x-haichi-git-blob: "c14b1b369934e40f2eb7f983c589a0ca6edc8e44"
  - resource: "https://github.com/haichi-co/.github/blob/main/templates/base.gitignore"
    x-haichi-git-blob: "62c28e7f5586361047d5638a6c7f3882d28e6a37"
---

# Repository bootstrap

For adopting shared GitHub resources, consult the [canonical repository README](https://github.com/haichi-co/.github/blob/main/README.md) for onboarding guidance and the [baseline ignore-file scaffold](https://github.com/haichi-co/.github/blob/main/templates/base.gitignore) when relevant. Actual source artifacts govern executable behavior; active requirements and decisions remain in GitHub issues.

## Key facts and constraints

- Organization-level resources do not make every file an inherited default. The Node CI starter is copied into a consumer's workflows, skills are opt-in, and the baseline ignore-file scaffold must be copied or adopted explicitly; none of those resources applies automatically.
- The baseline ignore file excludes `node_modules/`, local environment files and common operating-system artifacts, while allowing `.env.example` and `.env.sample`. It is a starter, not an enforced organization-wide policy.
- The root README is the onboarding guide. Canonical workflow, skill and scaffold files govern their own behavior, and GitHub issues record active requirements and decisions.
- Shared OKF knowledge is centrally maintained and opt-in through a consumer-owned [index link](https://github.com/haichi-co/.github/blob/main/knowledge/index.md). Moving `main` is the default; an exact commit SHA is optional for a historical snapshot. Remove the pointer to opt out. Reading shared knowledge requires no consumer OKF layout, validator, enrollment, App credentials or copied concepts; actual skill files and required relative dependencies remain independently managed via skill sync. Consumer-local requirements and canonical source authority are unchanged.
- Managed external Action dependencies are pinned to verified full commit SHAs. The README documents deliberate review, updates, rollback and per-surface version policy: consumer commits for copied templates and merged skill sync PRs, current main or exact commit snapshots for knowledge, and conditional future reusable-workflow compatibility tags. No repository-wide semantic release is required.
- Central-main review and integrity policy is documented in the README and [Main protection](main-protection.md); it is specific to the shared repository and not an inherited consumer default.

- Central skill synchronization uses the owner-reviewed main policy and a separately configured main-only credential environment; refer to [Skill synchronization](skill-sync.md) for the authorization rationale, staged migration and recovery requirements. Source policy alone does not establish live credential isolation.
- [Machine-user repository Admin reconciliation](repository-admin-reconciliation.md) keeps the machine user Admin on eligible repos except central. Deployment binds local reviewed IDs and an owner-controlled environment/App; copied source is not live configuration. See that concept for the bootstrap portability and credential-isolation decisions.
