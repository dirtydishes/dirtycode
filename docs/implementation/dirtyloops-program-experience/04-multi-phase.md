# Phase 4: Run bounded multi-Phase Programs

Canonical Beads issue: `dirtycode-dpx.4`

Epic: `dirtycode-dpx`

Status is tracked in Beads. This document preserves accepted intent and is decision-complete, implementation-open.

## Outcome

A developer can run dependent and bounded parallel Phases while the runner remains readable and mutation ownership stays safe.

## Why This Phase Exists

Real projects need dependency order, limited parallel work, independent review, and retained repair history.

## Scope

Allowed:

- multi-Phase proposal editing through an accessible linear form
- dependency validation and bounded parallel scheduling
- multiple implementation and review owners
- per-Phase model and team overrides
- Phase and Program budgets
- review-repair attempts and retained history
- optional Map view and selected-Phase inspector
- safe-boundary replanning for unsettled work

Out of scope:

- changing admitted results
- conflicting mutation scopes running together
- unbounded helpers or implicit model policy
- mobile-specific redesign

## Constraints

- Beads remains canonical for dependency order and completion.
- Dirtyloops owns readiness, worktree permits, review, checks, Admission, and integration.
- Each mutable owner receives a separately permitted worktree.
- Only admitted results reach the integration target.
- Parallel selection must reject overlapping mutation scope.
- The installed Dirtyloops skill and its matching Agents source remain unchanged throughout this Dirtycode build.

## Settled Decisions

- The linear Phase list remains the accessible primary editor.
- The graph is an optional view.
- Team deliberation cannot settle canonical work.
- Repair attempts retain prior candidate and review evidence.

## Open Questions

None block implementation.

## Dependencies

- Depends on Phase 3.

## Acceptance Evidence

- A real Program runs two dependent Phases in canonical order.
- A real Program runs two non-conflicting Phases in bounded parallel worktrees.
- Downstream work remains blocked until prerequisites settle.
- Conflicting mutation scopes never run together.
- Each mutable owner uses the exact permitted worktree.
- A review-repair cycle retains both attempts.
- Only admitted candidates integrate.
- Program tasks and evidence survive server restart.

## Execution Boundary

- Acceptance boundary: one dependency graph executes serial and bounded parallel Phases without overlapping mutable ownership
- Module surface: proposal dependency editor, Dirtyloops phase selection, worktree permit projection, team and budget policy, attempt history, and optional map
- Review boundary: Phase 4 implementation diff, dependency fixtures, conflict tests, worktree permit tests, repair history tests, budget tests, and map accessibility tests

## Test-Driven Development

Required skill: `tdd`.

Proposed public seams, which require user agreement before the first test:

- proposal dependency editing and graph validation behavior
- Dirtyloops phase selection and worktree-permit decisions through the driver interface
- multi-Phase wake, budget, and ownership behavior through `ProgramRuntime`
- shared multi-Phase presentation, attempt history, and optional map behavior

Work one vertical slice at a time: one failing behavior test, the least code needed for green, then the next test. Prefer property tests at graph and ownership interfaces. Mock only provider and process edges, not scheduling modules owned by T3.

## Review Checkpoint

Required roles: thermonuclear using `thermo-nuclear-code-quality-review`; adversarial without access to that skill; manual-product using `impeccable` in operate mode.

All roles review the same completed Phase candidate after its TDD evidence and gates are green. Review does not run after individual commits or red-green slices. A rejection produces one combined, deduplicated repair batch owned by one repair owner, followed by all affected tests, all Phase gates, and all required roles again. Review passes are capped at three: repair pass `0` is the initial review, and repair passes `1` and `2` are the only authorized repair batches. A third rejection stops before another repair and asks the user.

## Quality Gates

- dependency and conflict property tests
- real multi-Phase provider test
- budget and repair-attempt tests
- optional map accessibility checks
- `git diff --check`
- required thermonuclear, adversarial, and Impeccable manual-product checkpoint approval
- terminal CI evidence or unavailable-with-evidence

## Replanning Triggers

- Parallel work cannot prove non-overlapping ownership.
- Dependency state diverges from Beads.
- Team policy can bypass review, checks, or Admission.
- The map becomes required to operate the Program.
- A verified Dirtyloops defect requires changing its source or installed skill.

## Implementation Hypotheses

- Reuse the Dirtyloops graph and permit contracts already projected by T3.
- Extend the proposal form with a linear dependency editor before building the map.
- Keep parallel selection in Dirtyloops and presentation in client-runtime.

## Follow-Up Policy

Do not widen into client parity work. Record scale findings for Phase 5 unless they block safe scheduling.
