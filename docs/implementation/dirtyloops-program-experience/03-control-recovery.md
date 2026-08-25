# Phase 3: Make Program controls and recovery reliable

Canonical Beads issue: `dirtycode-dpx.3`

Epic: `dirtycode-dpx`

Status is tracked in Beads. This document preserves accepted intent and is decision-complete, implementation-open.

## Outcome

A developer can pause, resume, stop, retry, and replan while the interface reports the durable result of each command.

## Why This Phase Exists

Long-running Programs cross disconnects and process restarts. Controls must remain truthful during those failures.

## Scope

Allowed:

- durable pause, resume, stop, retry, and replan commands and receipts
- controls derived from server-returned allowed actions
- plain rejection and next-action text
- accepted replan revisions with visible change diff
- attention aggregation and Since you were away
- recovery after process restart, lost response, stale revision, and reconnect
- retained evidence from earlier revisions and attempts

Out of scope:

- parallel scheduling
- multiple active mutable owners
- mobile-specific layout
- silent mutation of admitted work

## Constraints

- The client never infers that a command succeeded.
- A disconnected client preserves last-known facts and marks them stale.
- Replan cannot alter admitted work or affect execution before acceptance.
- Duplicate delivery records one logical command result and one downstream effect.
- The installed Dirtyloops skill and its matching Agents source remain unchanged throughout this Dirtycode build.

## Settled Decisions

- The server projection supplies allowed controls.
- Viewing attention marks it seen but does not resolve it.
- Canonical state resolves attention.
- Earlier accepted revisions and attempts remain visible evidence.

## Open Questions

None block implementation.

## Dependencies

- Depends on Phase 2.

## Acceptance Evidence

- Tests interrupt each control between command, persistence, effect, and receipt.
- Server restart and replay produce one correct final state.
- Duplicate command delivery does not duplicate effects.
- A disconnected client never reports an unconfirmed paused, stopped, or completed state.
- Replan shows its diff and cannot alter admitted work.
- Earlier revision and attempt evidence remains reachable.

## Execution Boundary

- Acceptance boundary: each Program control and replan converges once across lost responses, restart, and reconnect
- Module surface: Program command interface, runtime recovery path, attention derivation, replan revision record, and runner controls
- Review boundary: Phase 3 implementation diff, command receipt tests, restart fault tests, client stale-state tests, and control accessibility tests

## Test-Driven Development

Required skill: `tdd`.

Proposed public seams, which require user agreement before the first test:

- pause, resume, stop, retry, and replan command results through the Program command interface
- restart, replay, and duplicate delivery through durable runtime receipts
- allowed actions, stale state, and attention through shared client presentation behavior
- runner controls and replan diff as operated by keyboard, pointer, and screen reader

Work one vertical slice at a time: one failing behavior test, the least code needed for green, then the next test. Use deterministic interruption at public effect and receipt edges; never use sleeps. Do not test private runtime methods or internal call order.

## Review Checkpoint

Required roles: adversarial without access to `thermo-nuclear-code-quality-review`; manual-product using `impeccable` in operate mode. No thermonuclear review runs at this checkpoint.

Both roles review the same completed Phase candidate after its TDD evidence and gates are green. Review does not run after individual commits or red-green slices. A rejection produces one combined, deduplicated repair batch owned by one repair owner, followed by all affected tests, all Phase gates, and both roles again. Review passes are capped at three: repair pass `0` is the initial review, and repair passes `1` and `2` are the only authorized repair batches. A third rejection stops before another repair and asks the user.

## Quality Gates

- focused command and recovery tests without sleeps
- client stale-state and allowed-control tests
- replan revision and evidence-retention tests
- `git diff --check`
- required adversarial and Impeccable manual-product checkpoint approval
- terminal CI evidence or unavailable-with-evidence

## Replanning Triggers

- A control cannot converge without guessing from transport state.
- Replan would mutate admitted work.
- Recovery requires duplicate provider or integration effects.
- Attention cannot be derived from typed state.
- A verified Dirtyloops defect requires changing its source or installed skill.

## Implementation Hypotheses

- Reuse the existing request and receipt idempotency path in `ProgramRuntime`.
- Add server-projected control reasons rather than client condition trees.
- Derive Since you were away from persisted activity cursors.

## Follow-Up Policy

Do not add parallel scheduling here. File follow-ups for transport defects that do not change the accepted control model.
