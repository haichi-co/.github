---
type: Reference
title: "Node 24 CI"
description: "Shared Node 24 CI workflow and the opt-in starter template."
sources:
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/workflows/node-ci.yml"
    x-haichi-git-blob: "1f9b4846e1f0f4f1527a0a5e8ce6637413e51b99"
  - resource: "https://github.com/haichi-co/.github/blob/main/workflow-templates/node24-ci.yml"
    x-haichi-git-blob: "c51f99c0ec60beb8782af4fe264efa026af1ff35"
  - resource: "https://github.com/haichi-co/.github/blob/main/workflow-templates/node24-ci.properties.json"
    x-haichi-git-blob: "369a261dc1e9c9e82e18e01d7b985cbc6ac06c0e"
---

# Node 24 CI

For npm repository CI, consult the [Node 24 starter template](https://github.com/haichi-co/.github/blob/main/workflow-templates/node24-ci.yml) and its [reusable workflow](https://github.com/haichi-co/.github/blob/main/.github/workflows/node-ci.yml). The executable workflow files govern CI behavior; the [starter metadata](https://github.com/haichi-co/.github/blob/main/workflow-templates/node24-ci.properties.json) governs template discovery.

## Key facts and constraints

- CI defaults to self-hosted Linux runners (`["self-hosted","linux"]`); `CI_RUNNERS` can override that selection. Fork PRs and explicitly hosted manual runs use `ubuntu-latest` regardless of the override. This does not make untrusted same-repository PR code safe on persistent privileged runners.
- The starter calls the shared workflow at `@main`. It uses Node 24, `npm ci`, a verified seven-day npm release-age guard, and optional `check` and `test` scripts. Changes to the shared workflow affect consumers that still reference `@main`.
- Each adopted starter schedules a GitHub-hosted watchdog every five minutes. After a qualifying self-hosted push/PR check has queued for at least 30 minutes without starting, it can cancel the run and dispatch a hosted replacement for the original commit SHA. Scheduling is best-effort; the watchdog consumes hosted Actions minutes and needs Actions write permission.
- The replacement is a `workflow_dispatch` run, not a replacement for the canceled required `pull_request` status check. Do not rely on this starter unchanged for required PR checks. See the [README's documented limitations](https://github.com/haichi-co/.github/blob/main/README.md#workflow-templates).
- The reusable workflow pins checkout and setup-node to verified upstream release commits; the starter still calls the central workflow at `@main`. An exact commit SHA can pin the reusable workflow independently.
