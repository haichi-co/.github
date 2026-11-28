---
type: Reference
title: "Issue lifecycle"
description: "Canonical agent skill, decision and task-readiness references, issue forms, and contract test."
sources:
  - resource: "https://github.com/haichi-co/.github/blob/main/skills/issue-lifecycle/SKILL.md"
    x-haichi-git-blob: "0a0614cfc424781515e752f51158b85ebd43d535"
  - resource: "https://github.com/haichi-co/.github/blob/main/skills/issue-lifecycle/references/decisions.md"
    x-haichi-git-blob: "677cdab014bc322e5d8c53d6ecf306f2776fddb0"
  - resource: "https://github.com/haichi-co/.github/blob/main/skills/issue-lifecycle/references/task-readiness.md"
    x-haichi-git-blob: "dbbe2917c417188a64451b3dafdfdd2df6999d59"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/ISSUE_TEMPLATE/bug.yml"
    x-haichi-git-blob: "a00804c2b253c87019e9c01b7260f3fdd31755ad"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/ISSUE_TEMPLATE/decision.yml"
    x-haichi-git-blob: "146d973fd8b3e22a5ae6924eface3d9e90ffc9be"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/ISSUE_TEMPLATE/feature.yml"
    x-haichi-git-blob: "19587c4eebfd93dd2f1e0bf2fcaa8b70e196d87b"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/ISSUE_TEMPLATE/task.yml"
    x-haichi-git-blob: "db9dc165cde83b8cd26a5e73081a3f261285d857"
  - resource: "https://github.com/haichi-co/.github/blob/main/src/issue-lifecycle-contract.test.ts"
    x-haichi-git-blob: "34658f92269d0e5880f5514ce2488cc85a323a6e"
---

# Issue lifecycle

For GitHub-native research, decisions, planning, and implementation, consult the [canonical issue-lifecycle skill](https://github.com/haichi-co/.github/blob/main/skills/issue-lifecycle/SKILL.md). Its [Decision reference](https://github.com/haichi-co/.github/blob/main/skills/issue-lifecycle/references/decisions.md) defines the portable approval mechanism, while its [task-readiness reference](https://github.com/haichi-co/.github/blob/main/skills/issue-lifecycle/references/task-readiness.md) helps form executable leaves. The [contract test](https://github.com/haichi-co/.github/blob/main/src/issue-lifecycle-contract.test.ts) keeps the mechanism canonical. These files govern skill-driven execution; the issue forms define the corresponding GitHub input surfaces.
