# Implementation task readiness

Use this reference from [issue-lifecycle](../SKILL.md) when decomposing work. The target is a **smallest independently meaningful, verifiable unit**, not the maximum possible number of issues. A less-capable agent should be able to implement an eligible leaf from its issue and linked sources without having to invent architecture or infer decisions.

## Ready-to-execute checklist

Before marking an implementation Task ready, confirm:

- **Outcome:** One observable change and why it is needed; not a bundle of unrelated deliverables.
- **Inputs:** Links to the owning issue, approved Decisions, relevant code/configuration/docs, existing tests, and any source evidence needed. Distinguish required facts from assumptions.
- **Scope:** Expected files, modules, interfaces, or data surfaces where reasonably known; protected state and explicit non-goals. Allow ordinary local implementation choices rather than prescribing every line.
- **Contract:** Defined inputs/outputs, invariants, errors, compatibility, and integration expectations. No unresolved consequential design choice delegated implicitly to the implementer.
- **Prerequisites:** Native `blocked by` relationships for genuine dependencies, all satisfied before execution. Native sub-issues indicate ownership, not sequence.
- **Acceptance:** Concrete, falsifiable conditions that an independent reviewer can assess.
- **Verification:** Exact existing test commands or reproducible checks when known; otherwise explicit observable/manual validation. Include relevant regression checks and CI requirements.
- **Completion:** How to reconcile the PR, issue state, parent acceptance and durable documentation. Include rollback or safe recovery when modifying irreversible or production state.

If any indispensable item is missing, research the unknown, raise a Decision for a consequential choice, or split the Task. Do not mask an unclear architecture behind a broad instruction such as "implement the backend."

## When to split a Task

Split when it requires two or more independently reviewable outcomes, involves competing owners or incompatible validation surfaces, requires choosing an unapproved interface or storage model, has no feasible bounded verification, or is likely to force the implementer to discover substantial unspecified dependencies.

Keep work together when separation would create a meaningless intermediate state, duplicated setup, or additional integration risk. Prefer one coherent change with its focused tests over separate "write code" and "write tests" issues unless test infrastructure is itself an independent unit.

A task can be substantial yet ready if its interface is stable, scope is bounded, and its implementation and acceptance are explicit. Do not use estimates, arbitrary file counts, or model-specific token budgets as hard readiness thresholds.

## Suggested leaf issue structure

Use headings as needed; repository issue forms may already supply them. Avoid copying unchanged parent specifications into every child.

```markdown
## Outcome
<Single observable result.>

## Inputs and approved constraints
<Links to owner issue, decisions, baseline code/tests, and immutable assumptions.>

## Scope
<Expected change surfaces and explicit exclusions.>

## Implementation contract
<Behavior, interfaces, error cases, compatibility, and integration handoff.>

## Acceptance
- [ ] <Observable condition>
- [ ] <Regression or safety invariant>

## Verification
<Commands or reproducible steps and expected outcomes.>

## Dependencies
<Native blocked-by links, if genuinely required; no ordering by issue number.>

## Completion
<PR/issue reconciliation and any documentation or rollback requirement.>
```

## Plan review

Before creating or assigning a batch of leaves, verify that:

1. Each actionable leaf passes the checklist and has one owning parent.
2. Native dependencies form a coherent, non-circular prerequisite graph; independent tasks remain unblocked.
3. Integration/testing ownership is explicit and the parent acceptance criteria are covered without duplicate tasks.
4. Unresolved decisions block only the affected leaves.
5. Near-term work is detailed enough to execute; distant speculative work remains at outcome level until more evidence exists.

When execution uncovers a missing design constraint, stop that leaf, update its issue and dependencies, and refine the plan rather than silently making a high-impact decision.
