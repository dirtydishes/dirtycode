# Phase 1: Create and finish one real Program

Canonical Beads issue: `agents-dpx.1`

Epic: `agents-dpx`

Status is tracked in Beads. This document preserves accepted intent and is decision-complete, implementation-open.

## Outcome

A developer describes one repository task, accepts a one-Phase proposal, starts it, opens its T3 tasks, and receives one reviewed and integrated result.

## Why This Phase Exists

This proves the product path with a real provider before we add richer presentation or larger Program graphs.

## Scope

Allowed:

- versioned Program drafts and acceptance
- a one-Phase web and desktop composer
- a small accepted-Program Start command with server-owned runtime identities
- one real provider implementation attempt, independent review, declared checks, Admission, integration, and Beads closure
- a minimal Needs you, Now, Next, and Done runner
- Program-owned placement for generated T3 tasks

Out of scope:

- mobile authoring
- multiple Phases, parallel execution, team policies, and optional map views
- rich recovery controls beyond Stop and safe Start retry
- model-generated status or attention

## Constraints

- Accept and Start remain separate durable operations behind one user confirmation.
- Beads, Dirtyloops, T3, and Git keep the authority split in the accepted plan.
- The installed Dirtyloops skill and its matching Agents source remain unchanged throughout this Dirtycode build.
- The production path uses the certified Dirtyloops driver and a real provider.
- T3 creates runtime identities. Clients never construct them.
- Generated tasks remain ordinary T3 tasks without entering normal recents.

## Settled Decisions

- Creation uses chat plus one structured editable proposal.
- The planning task remains source discussion and never becomes the runtime coordinator.
- Phase 1 supports one repository, one Phase, and one mutable owner at a time.
- The default runner hides UUIDs, receipt names, leases, and worktree paths.

## Open Questions

None block implementation.

## Dependencies

- No earlier product Phase.
- Start from the accepted Dirtycode plan branch based on the fork's current main.

## Acceptance Evidence

- A browser test starts from plain intent and records separate acceptance and Start receipts.
- A real provider changes and commits one file in a disposable repository.
- Independent review and declared checks pass before Dirtyloops Admission.
- Dirtyloops integrates the candidate and closes its Beads task once.
- The Program survives reload and reaches Completed.
- Lost-response retry creates one Program and one effect set.
- Stale draft, Git, Beads, or graph identity blocks Start with changed facts.
- Generated tasks stay out of normal recents and remain reachable from the Program.
- Active agent count matches real provider work.
- The primary runner shows no UUID, receipt name, or worktree path.

## Execution Boundary

- Acceptance boundary: one plain request reaches one admitted and integrated one-Phase Program result
- Module surface: Program authoring interface, accepted-Program Start interface, one-Phase composer, minimal runner, and Program task placement rule
- Review boundary: Phase 1 implementation diff, contract tests, server receipt tests, client presentation tests, sidebar placement tests, and one real-provider browser test

## Quality Gates

- focused contract and server tests
- focused web and client-runtime tests
- one real-provider integrated browser test in disposable state
- `git diff --check`
- independent correctness and UI review
- terminal CI evidence or unavailable-with-evidence

## Replanning Triggers

- The certified provider path cannot produce the required result without weakening an acceptance rule.
- Accept and Start cannot remain separately recorded and idempotent.
- Server-owned runtime identity requires a client to know Dirtyloops construction details.
- Program task placement requires a second conversation store.
- A verified Dirtyloops defect requires changing its source or installed skill.
- The work no longer fits one repository, one Phase, and one mutable owner.

## Implementation Hypotheses

- Add a deep `ProgramAuthoring` module beside the existing `ProgramRuntime`.
- Keep ordinary T3 task storage and routes as the one conversation implementation.
- Derive the minimal runner through a shared pure presentation function.

## Follow-Up Policy

Do not widen this Phase. Record adjacent discoveries as Beads follow-ups or trigger replanning when they change accepted behavior.
