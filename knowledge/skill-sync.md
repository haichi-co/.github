---
type: Reference
title: "Skill synchronization"
description: "Canonical skill-sync manifest, workflow, implementation, and regression checks."
sources:
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/skill-sync.json"
    x-haichi-git-blob: "1022fc244b29fc3bdc29b72746d16094a597fec8"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/workflows/sync-skills.yml"
    x-haichi-git-blob: "903821b038d93d32fbcbbb0b3fb0cd2013151b71"
  - resource: "https://github.com/haichi-co/.github/blob/main/src/skill-sync.ts"
    x-haichi-git-blob: "60137a83a934dbc8d44e90f51405de3e4f8796a9"
  - resource: "https://github.com/haichi-co/.github/blob/main/src/skill-sync.test.ts"
    x-haichi-git-blob: "f7a33972efa1c85bd680d2565e91b2fca234711e"
  - resource: "https://github.com/haichi-co/.github/blob/main/tsconfig.json"
    x-haichi-git-blob: "dbd56b258297799bb598ed6ea861187cf5468e2b"
---

# Skill synchronization

For centrally managed, opt-in skill distribution, consult the [canonical manifest](https://github.com/haichi-co/.github/blob/main/.github/skill-sync.json) and [sync workflow](https://github.com/haichi-co/.github/blob/main/.github/workflows/sync-skills.yml). The [engine](https://github.com/haichi-co/.github/blob/main/src/skill-sync.ts) governs synchronization behavior; its tests and TypeScript configuration are verification resources.

## Key facts and constraints

- The v3 manifest defines each skill's source, destination, explicit managed files and unique enrollment topic. Repositories opt into each skill independently through that topic; installing the organization App alone does not enroll them.
- When synchronization is enabled, discovery uses an organization-scoped read-only token; the writer token is restricted to the unique union of discovered target repositories. No targets means no writer token. The engine rechecks repository identity, enrollment and default branch before each write.
- Synchronization creates or updates one reviewable PR per repository-skill pair, never auto-merges, and makes no writes when the default branch or pending PR already matches. Unexpected branch changes fail closed; only manifest-managed files are changed, without executing target code or modifying repository-specific agent instructions, unrelated skills or workflows.
- Removing a topic stops updates for that skill without deleting its existing files or affecting other enrollments. When enabled, the hosted workflow reconciles on relevant main updates, daily at 05:19 UTC, or on manual dispatch, which defaults to a dry run.
- All external Actions used by synchronization and verification, including the App-token action, are pinned to verified full upstream commit SHAs and release comments. Dependency updates follow the reviewed procedure in the root README; token scope and enrollment semantics are unchanged.
