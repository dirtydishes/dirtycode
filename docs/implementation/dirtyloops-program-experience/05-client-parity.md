# Phase 5: Finish mobile, remote, and accessibility support

Canonical Beads issue: `agents-dpx.5`

Epic: `agents-dpx`

Status is tracked in Beads. This document preserves accepted intent and is decision-complete, implementation-open.

## Outcome

A developer can create, monitor, control, and open the same Program through supported T3 clients and remote connections.

## Why This Phase Exists

T3 supports web, desktop, and mobile clients. Program state and navigation must mean the same thing on each client.

## Scope

Allowed:

- mobile composer, proposal review, runner, attention, task directory, and safe controls
- remote connection and reconnect behavior
- keyboard and screen-reader operation
- state that does not rely on color
- reduced motion without continuously repainting effects
- command-palette and settings entry parity
- settled Program history
- bounded queries, paging, and measured virtualization
- user documentation and obsolete demo cleanup

Out of scope:

- new Program authority or lifecycle states
- client-specific status or task-placement rules
- speculative transport replacement
- deployment or live-service cutover

## Constraints

- Clients consume shared contracts and presentation rules.
- Program lists do not load task messages.
- Performance work follows measurement.
- Remote reconnect cannot duplicate commands or lose attention.
- Deployment requires separate authority.
- The installed Dirtyloops skill and its matching Agents source remain unchanged throughout this Dirtycode build.

## Settled Decisions

- Mobile uses its own layout but the same factual hierarchy.
- Every client preserves ordinary T3 task routes.
- A 200-task fixture is the bounded client scale proof.
- Documentation uses shipped-product language.

## Open Questions

None block implementation.

## Dependencies

- Depends on Phase 4.

## Acceptance Evidence

- Integrated web, desktop, and mobile passes operate the same remote Program.
- Each client derives the same state, allowed controls, attention, and task placement.
- A 200-task fixture loads no message bodies until a task opens.
- Keyboard and screen-reader users can create, inspect, control, and navigate a Program.
- Reduced-motion mode has no continuously repainting Program effect.
- Reconnect produces no duplicate command and loses no attention item.
- User documentation explains creation, operation, recovery, and task navigation without runtime jargon.

## Execution Boundary

- Acceptance boundary: supported T3 clients operate one remote Program with matching factual state, controls, attention, and task navigation
- Module surface: mobile Program routes, shared client-runtime presentation and placement, remote reconnect handling, paged Program queries, accessibility behavior, and user docs
- Review boundary: Phase 5 implementation diff, cross-client contract fixtures, mobile tests, remote reconnect tests, accessibility checks, performance measurements, and documentation review

## Quality Gates

- focused shared client-runtime tests
- integrated web, desktop, and mobile passes
- remote reconnect and duplicate-command tests
- keyboard and screen-reader checks
- measured 200-task performance proof
- `git diff --check`
- independent correctness, maintainability, and UI review
- terminal CI evidence or unavailable-with-evidence

## Replanning Triggers

- A client needs different canonical state or task placement.
- The 200-task fixture requires loading conversation bodies.
- Remote operation cannot preserve command idempotency.
- Required performance needs a transport rewrite outside the accepted scope.
- A verified Dirtyloops defect requires changing its source or installed skill.

## Implementation Hypotheses

- Move any remaining web-only presentation logic into client-runtime before mobile work.
- Reuse mobile sheets and navigation patterns instead of compressing the desktop layout.
- Page task shells and evidence before adding virtualization.

## Follow-Up Policy

File deployment, live cutover, and unrelated performance work as separate Beads issues.
