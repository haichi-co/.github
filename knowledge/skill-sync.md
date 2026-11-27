---
type: Reference
title: "Skill synchronization"
description: "Canonical skill-sync manifest, workflow, implementation, and regression checks."
sources:
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/skill-sync.json"
    x-haichi-git-blob: "1022fc244b29fc3bdc29b72746d16094a597fec8"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/workflows/sync-skills.yml"
    x-haichi-git-blob: "8b77d0bb9bec4019f9d426931061bbd2027480ca"
  - resource: "https://github.com/haichi-co/.github/blob/main/src/skill-sync.ts"
    x-haichi-git-blob: "60137a83a934dbc8d44e90f51405de3e4f8796a9"
  - resource: "https://github.com/haichi-co/.github/blob/main/src/skill-sync.test.ts"
    x-haichi-git-blob: "f7a33972efa1c85bd680d2565e91b2fca234711e"
  - resource: "https://github.com/haichi-co/.github/blob/main/tsconfig.json"
    x-haichi-git-blob: "dbd56b258297799bb598ed6ea861187cf5468e2b"
---

# Skill synchronization

For centrally managed, opt-in skill distribution, consult the [canonical manifest](https://github.com/haichi-co/.github/blob/main/.github/skill-sync.json) and [sync workflow](https://github.com/haichi-co/.github/blob/main/.github/workflows/sync-skills.yml). The [engine](https://github.com/haichi-co/.github/blob/main/src/skill-sync.ts) governs synchronization behavior; its tests and TypeScript configuration are verification resources.
