---
name: issue-lifecycle
description: Research and plan GitHub-native Features, Bugs, Tasks, and Epics; resolve material Decisions as sub-issues; decompose implementation into independently verifiable tasks; execute one unit at a time or autonomously when explicitly requested.
---

# GitHub issue lifecycle

Use this skill when an operator asks to research, plan, decompose, implement, or continue a GitHub issue or a specified set of issues. Apply the repository's existing policies and approval gates first; this skill supplies a portable workflow, not replacement governance.

## Source of truth and scope

- Treat GitHub Issues as authoritative for active requirements, acceptance criteria, decisions, dependencies, and implementation status. Inspect the issue, discussion, native parent/sub-issues, native dependencies, related PRs, code, tests, and existing plans before writing new work.
- Use native GitHub Issue **Type**: Feature for new capabilities, Bug for defective behavior, Task for bounded research/planning/implementation/verification, and Decision for a consequential choice. Use Epic only where enabled and genuinely useful; a Feature can own children without becoming an Epic. Do not prefix titles with type names.
- Use native **sub-issues** to express ownership/decomposition and native **blocked by** relationships only for real prerequisites. Neither issue order, labels, milestone membership, nor parentage alone proves a dependency. Never misrepresent a textual link as a native relationship.
- Limit changes to the explicitly requested issue(s) and their relevant descendants. A request to complete an issue includes its eligible descendants, not unrelated siblings of the requested root or an unrelated backlog. The operator may **explicitly broaden scope** to additional roots, sibling issues, a milestone, a project, or a wider queue; do not broaden it by inference.
- Treat planning as distinct from implementation authorization. An explicit request to implement or work autonomously authorizes eligible work within its stated scope, subject to repository protections, approvals, credentials, and separately gated deployment/release/destructive actions. A proposed plan or closed Decision is not by itself permission for those actions.

## Select the smallest useful planning mode

**Lightweight:** For a bounded Bug/Feature or a few independent decisions, inspect and research only what matters, create Decision sub-issues directly under the affected owner if necessary, then create implementation Tasks only if decomposition materially helps. No mandatory phase-wrapper issues.

**Structured:** For a substantial or architecturally uncertain change, use focused research/evaluation Task(s), optionally a design/architecture Task with Decision children, a planning Task when useful, and independently verifiable implementation/integration Tasks. Avoid artificial containers, duplicative issue bodies, and speculative distant leaf tasks.

The operator can request either mode. Reuse existing issues before creating duplicates; preserve unrelated metadata and closed historical records.

## Research and decision phase

1. **Establish the baseline.** Inspect implemented behavior and repository conventions; identify concrete evidence, constraints, failure modes, ownership boundaries, current tests, and any prior approved decisions. Separate verified observations from assumptions.
2. **Research the unresolved questions.** Consider relevant technical alternatives, feasibility, operational cost, security, migration, and recovery where material. Research and independent decisions may proceed concurrently.
3. **Record material choices as native Decision sub-issues.** State the exact question, available options, benefits/costs, evidence, constraints, recommended choice if justified, approver or authorized decision mechanism, and what work depends on the outcome. Nest under the owning issue or relevant design Task. Do not manufacture decisions for ordinary implementation details.
4. **Resolve explicitly.** Record selected, rejected, and deferred outcomes with rationale and implementation consequences before closing the Decision. An operator's explicit instruction can resolve a choice within its scope; use the approved [GitHub Decision issue mechanism](references/decisions.md) when it applies. Outside that mechanism, do not infer approval from a recommendation, reaction, or closed issue. Never import another repository's voting rules or authorized-user list by default.
5. **Preserve progress where blocked.** Continue research or other work that is genuinely independent of an unresolved Decision; add native blocking links only for the affected units. Stop dependent design or implementation at the approval boundary.

## Hierarchical implementation planning

1. Translate approved requirements into observable outcomes and identify implementation surfaces, boundaries, integration points, and validation strategy.
2. Decompose each outcome into coherent Tasks until the executable leaves satisfy [task readiness](references/task-readiness.md). Prefer changes that can be reviewed and verified independently, including focused tests; do not split trivial edits merely to make more issues.
3. Build the hierarchy with native sub-issues; add native dependencies only for genuine precedence constraints. Identify any interface/integration owner when multiple leaves interact. Do not infer sequence from issue numbering.
4. Draft each near-term leaf with explicit inputs, scope, implementation contract, acceptance criteria, verification, risks or rollback when relevant, and applicable Decision references. Avoid tasks that force a less-capable agent to reconstruct architecture or choose a missing contract.
5. Recheck the plan for missing prerequisites, circular or unnecessary blockers, duplicated work, protected surfaces, and test coverage. If a leaf is not ready, refine or split it **before** assigning implementation.
6. Maintain the plan in the owning GitHub issue and native issue graph. Issue artifacts or separate documents may assist analysis, but must not replace the issue graph as the executable source of truth.

## Execution

Complete **one independently verifiable implementation unit at a time**, regardless of execution autonomy:

1. Re-read the selected Task, its prerequisites and relevant decisions; ensure the unit is ready and authorized.
2. Implement only its bounded outcome, following local code and review conventions.
3. Run focused tests plus required project validation/CI. Repair failures within scope; inspect unrelated/protected state for unintended changes.
4. Integrate and merge only when authorized and repository review/protection checks pass. Never bypass approvals or treat a green check as authority for deployment, publication, destructive operations, or other gated effects.
5. Reconcile the Task, PR links, actual verification evidence, native dependencies, relevant durable documentation, and parent progress. Close only when acceptance is evidenced. Report any remaining limitation.

### Execution autonomy modes

**Default — incremental:** After one verified unit, stop and report its result and the single next eligible action.

**Explicit opt-in — autonomous sequential:** When the operator asks to work independently until an issue is finished, to continue without interim approvals, or to execute multiple units, continue selecting and completing eligible units **sequentially** inside the authorized scope. Do not ask for routine confirmations between units. Continue until the requested scope is complete or no further work is safely possible because of a genuine blocker, necessary operator decision, missing access, failed mandatory gate, or authorized-scope boundary. Investigate and repair ordinary test or implementation failures before treating them as blockers. Report a consolidated result or the precise blocker, with completed units and the next required action.

- An operator may explicitly extend autonomous execution **beyond the original issue**, including named siblings, multiple roots, or a broader queue. Apply the same unit-by-unit verification and gating to the expanded scope.
- Autonomy does not imply parallelism. Launch subagents or overlapping implementation only when separately authorized and ownership/integration boundaries are explicit.
- Work only within the active session and available execution environment unless an actual authorized scheduler or runner is configured. Do not promise unattended work after the session ends.

## Completion and handoff

For the requested scope, verify that applicable Decisions are resolved or explicitly deferred, leaf Tasks are accepted, native blockers are reconciled, linked PRs and CI establish the actual implementation state, and the parent issue's acceptance criteria are met. Do not close a parent simply because a plan exists or its progress counter reaches 100%.

Report what changed, verification, remaining risks or blockers, and one concrete next step. If a blocker stops autonomous execution, preserve completed progress and state exactly what requires operator action.
