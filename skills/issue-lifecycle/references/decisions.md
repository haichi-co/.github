# GitHub Decision issue mechanism

Use this mechanism only for native GitHub issues whose Type is **Decision**.

## Recording a decision

1. **Decision comment (primary).** A decider posts a comment whose first line is exactly `Decision: <option>`. For a multi-select decision, use `Decision: A, C`. Any following lines are notes and are part of the record.
2. **Recommended-option shorthand.** A 👍 reaction on the issue itself means “accept the recommended option, with no notes” only when the body names exactly one recommended option or option set.

For a decision that permits no options, present an explicit `None` option rather than combining reactions. Do not use checkboxes, reaction combinations, closure, or edits as a decision signal.

## Deciders and concurrence

- The issue’s current assignees are its deciders. A Decision with no assignees is not decidable. Self-assignment is allowed where GitHub permits it.
- Every assignee must concur. A decision is complete only when each current assignee has posted a matching `Decision:` comment or a valid 👍. Matching means the same option set; a valid 👍 matches the recommended set.
- Adding assignees deliberately raises the concurrence bar. An eligible user can also make themselves an instant veto by assigning themselves and withholding a decision. Both effects are intentional.
- `Decidable by: @user[, @user]` in the body limits the decider set to listed assignees. Other assignees neither satisfy nor block concurrence.
- Each identity acts only as itself. A machine user or App counts only when assigned and acting under its own credentials; no agent may decide through another identity.
- When a decider has several `Decision:` comments, use that decider’s latest one. If the current deciders disagree, no decision is complete; report the conflict and do nothing.

## Maintainer actions after concurrence

1. Re-read assignees and decision evidence immediately before recording; current assignments govern.
2. Add or update `## Decision record` in the issue body with selected, rejected, and deferred options; link each comment or reaction and transcribe notes faithfully.
3. When the outcome changes a repository rule, encode the rule and its contract test in the same independently verifiable unit.
4. Close the issue as completed. Reversing a completed decision requires reopening the issue and deciding again through this mechanism.

An optional Decisions Project view may aid discovery, but project fields are not a decision mechanism because writers can edit them.
