---
type: Reference
title: "Central main protection"
description: "Owner review and integrity policy for the central bootstrap repository."
sources:
  - resource: "https://github.com/haichi-co/.github/blob/main/AGENTS.md"
    x-haichi-git-blob: "d9455784317c79511fbf47098e7be6a06139474d"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/CODEOWNERS"
    x-haichi-git-blob: "03b16eceae3f26cb822ba0506609022ed68978d1"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/rulesets/main.json"
    x-haichi-git-blob: "ed239cd4b397fab097fcfddf0799590b8b534495"
  - resource: "https://github.com/haichi-co/.github/blob/main/.github/rulesets/main-integrity.json"
    x-haichi-git-blob: "d7bca83c05fe08c0789a81a780137daf8162ad6f"
---

# Central main protection

The [agent policy](https://github.com/haichi-co/.github/blob/main/AGENTS.md) and [CODEOWNERS](https://github.com/haichi-co/.github/blob/main/.github/CODEOWNERS) define the central review contract. The [owner-review ruleset](https://github.com/haichi-co/.github/blob/main/.github/rulesets/main.json) and [integrity ruleset](https://github.com/haichi-co/.github/blob/main/.github/rulesets/main-integrity.json) define the desired GitHub enforcement state. The root README documents application and verification; live GitHub settings must be read back rather than inferred from these files.

- The owner personally approves changes; the machine account is non-admin here and may merge as itself only after owner approval and the two native checks pass. Agent review is supporting evidence only.
- One owner-only PR bypass applies solely to the review ruleset for owner-authored PRs; the integrity ruleset has no bypass, requires a PR and strict successful GitHub Actions `verify` and `validate-okf` checks, and blocks main deletion and force pushes.
- Both rulesets target exactly `refs/heads/main`. Neither policy automatically applies to consumers, and rule administration requires separately authorized owner action.
- Main protection alone does not isolate repository Actions credentials; environment migration is independently tracked in #39.
