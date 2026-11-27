---
type: Reference
title: "Repository bootstrap"
description: "Organization repository onboarding guidance and the opt-in ignore-file scaffold."
sources:
  - resource: "https://github.com/haichi-co/.github/blob/main/README.md"
    x-haichi-git-blob: "4e21fee7075c806d899fdcead097d82923864bf2"
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
