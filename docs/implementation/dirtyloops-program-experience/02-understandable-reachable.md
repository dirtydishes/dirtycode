# Phase 2: Make Program work understandable and reachable

Canonical Beads issue: `dirtycode-dpx.2`

Epic: `dirtycode-dpx`

Status is tracked in Beads. This document preserves accepted intent and is decision-complete, implementation-open.

## Outcome

A developer understands current Program work within seconds and can open any related T3 task without filling normal project recents.

## Why This Phase Exists

The first Phase proves execution. This Phase makes the resulting state useful during daily work.

## Scope

Allowed:

- complete Needs you, Now, Next, and Done presentation
- human role and stage labels derived from persisted facts
- a Phase-grouped Program task directory
- Program breadcrumbs, Back to Program, search, command-palette results, and explicit pinning
- collapsed system tasks
- Evidence, Activity, and Diagnostics views
- optional Luna-medium titles and summaries with deterministic fallback

Out of scope:

- new runtime commands
- multi-Phase scheduling and parallel execution
- mobile-specific composition
- model ownership of state, attention, commands, or completion

## Constraints

- Every displayed fact traces to persisted state, Git, Beads, or a durable receipt.
- Task placement is shared client logic, not separate web and mobile policy.
- Opening a Program task never promotes it into normal recents.
- Luna failure cannot change facts, controls, attention, or placement.
- The installed Dirtyloops skill and its matching Agents source remain unchanged throughout this Dirtycode build.

## Settled Decisions

- Builder and reviewer tasks are visible by default.
- Coordinator tasks stay under collapsed System tasks unless they need attention.
- Explicit pinning is the only path into the normal pinned area.
- Diagnostics retain canonical runtime terms while the main view uses plain language.

## Open Questions

None block implementation.

## Dependencies

- Depends on Phase 1.

## Acceptance Evidence

- Fixtures cover planning, preparing, working, waiting, blocked, reviewing, failed checks, Admission conflict, stale transport, stopped, and completed states.
- Each fixture produces the expected plain-language grouping and allowed controls.
- A 50-task Program adds one Program row and no generated rows to normal recents.
- Every Program task remains reachable through the Program and search.
- Opening a task does not promote it.
- Pin and unpin change placement exactly once.
- Forced Luna failure changes no fact, action, attention item, or placement.

## Execution Boundary

- Acceptance boundary: one factual Program projection becomes a plain runner and complete task directory without sidebar pollution
- Module surface: shared Program presentation interface, thread ownership summary, Program workspace, task directory, search metadata, and sidebar placement
- Review boundary: Phase 2 implementation diff, presentation fixtures, navigation tests, sidebar logic tests, accessibility checks, and focused UI review

## Test-Driven Development

Required skill: `tdd`.

Proposed public seams, which require user agreement before the first test:

- shared `deriveProgramWorkspace` presentation behavior from persisted facts
- task placement, search, pin, and unpin behavior through shared client-runtime interfaces
- Program workspace and ordinary task-route navigation as a user sees it
- accessible Needs you, Now, Next, Done, task directory, evidence, activity, and diagnostics behavior

Work one vertical slice at a time: one failing behavior test, the least code needed for green, then the next test. Mock only Luna and other system edges. Do not test component internals or private helpers.

## Review Checkpoint

Required roles: adversarial without access to `thermo-nuclear-code-quality-review`; manual-product using `impeccable` in operate mode. No thermonuclear review runs at this checkpoint.

Both roles review the same completed Phase candidate after its TDD evidence and gates are green. Review does not run after individual commits or red-green slices. A rejection produces one combined, deduplicated repair batch owned by one repair owner, followed by all affected tests, all Phase gates, and both roles again. Review passes are capped at three: repair pass `0` is the initial review, and repair passes `1` and `2` are the only authorized repair batches. A third rejection stops before another repair and asks the user.

## Quality Gates

- pure presentation tests
- web navigation and sidebar tests
- accessibility checks for runner and task directory
- `git diff --check`
- required adversarial and Impeccable manual-product checkpoint approval
- terminal CI evidence or unavailable-with-evidence

## Replanning Triggers

- Clients require different factual placement rules.
- Program task lookup requires hydrating conversation bodies.
- A plain label changes canonical state instead of explaining it.
- Search or pinning requires copied task records.
- A verified Dirtyloops defect requires changing its source or installed skill.

## Implementation Hypotheses

- Deepen the existing client-runtime Program presentation module.
- Project compact Program ownership into ordinary task shells.
- Keep raw evidence behind the existing inspector pattern.

## Follow-Up Policy

Do not add controls or scheduling here. Record adjacent work in later Phase issues.
