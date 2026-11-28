# Central bootstrap repository

- Follow the [issue lifecycle](skills/issue-lifecycle/SKILL.md) and finish one independently verifiable unit at a time unless the owner expressly authorizes a longer sequence.
- Use topic/branch-scoped PRs to change this repository; no direct pushes to `main`. The human owner `dddominikk` personally reviews and approves the exact current PR head. Agents may review as themselves for evidence but must never submit approvals as the owner, merge or bypass with owner credentials, or circumvent the gate. `agent-hachi` may merge as itself only after personal owner approval and both required checks (`verify`, `validate-okf`) succeed on the current head and base.
- For an owner-authored PR only, the owner personally may use the documented PR-only review bypass after checks pass; agents must not use it. The no-bypass main-integrity ruleset still applies.
- Preserve the owner's Admin and the machine user's non-admin central role. Ruleset, role, environment, and credential changes (including disabling or rollback) require separate explicit owner authorization; never change them to work around a blocked PR. See [main protection](README.md#central-main-protection).
- Keep external Actions pinned and review affected OKF source concepts and committed blob pins in the same PR; run the checks described in [README](README.md).
