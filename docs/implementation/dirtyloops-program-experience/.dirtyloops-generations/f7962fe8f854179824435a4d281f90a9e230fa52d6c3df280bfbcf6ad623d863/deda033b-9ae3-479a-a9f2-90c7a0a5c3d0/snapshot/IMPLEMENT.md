# Dirtyloops Program experience implementation loop

Dirtyloop version: `2`

Execution profile: `adaptive`

Canonical tracker: Beads epic `dirtycode-dpx`

Accepted plan: `docs/plans/dirtyloops-program-experience/plan.md` at Dirtycode commit `64fe8fa66`

Beads owns execution state. The accepted plan and Phase docs preserve intent.

## Goal

Build a conversation-fed Program creator and plain-language Program runner that takes a real request through reviewed Dirtyloops work while keeping every T3 task reachable without sidebar clutter.

## Scope and non-goals

Scope includes Program authoring, accepted Start, a human runner, Program task placement, durable controls, bounded multi-Phase work, and supported-client parity. It excludes a second conversation store, client-owned canonical state, model-owned status or attention, upstream synchronization, deployment, and live-service cutover.

## Settled decisions

- The execution profile is adaptive and bound to Codex.
- This Dirtycode workspace stores the canonical Beads graph on DI. Dirtyloops owns execution policy, review, checks, Admission, integration, and Beads closure. Dirtycode owns T3 implementation.
- This stream changes Dirtycode only. The installed Dirtyloops skill and matching Agents source are frozen inputs.
- A verified Dirtyloops defect stops the active Phase for a separate Beads issue and plan amendment. Replacing the installed skill requires explicit user approval.
- One mutable owner controls each checkout or branch.
- One active external implementation PR is allowed.
- Luna at medium is limited to optional titles and short summaries.
- Merge, release, deployment, and service changes require separate authority.

## Stream acceptance evidence

- Each Phase passes its linked acceptance evidence and independent review.
- Phase 1 proves plain intent through one real admitted and integrated result.
- Program tasks remain ordinary T3 tasks and stay out of normal recents unless pinned.
- Control and reconnect tests prove durable single effects.
- Multi-Phase work proves dependency order and non-overlapping mutation.
- Supported clients derive matching factual state, controls, attention, and task placement.

## Sources of truth

- Beads epic: `dirtycode-dpx`
- Accepted plan: `docs/plans/dirtyloops-program-experience/plan.md`
- Roadmap: `docs/implementation/dirtyloops-program-experience/00-roadmap.md`
- Phase docs and turn docs under this directory
- Runtime generation and Codex binding under `runtime/`

## Control-plane invariants

- Select from live Beads readiness and read the linked Phase contract.
- Require execution-readiness and launch-readiness before mutation.
- Verify exact repository, worktree, symbolic branch, HEAD, and ownership.
- Keep one mutable owner per checkout and use independent review.
- Record one orchestration brief per Phase.
- Use evidence-driven helpers only when they have distinct work.
- Keep one active external implementation PR.
- Resolve CI before Phase completion.
- File follow-ups instead of widening scope.
- Stop on any accepted replanning trigger.
- Treat a requested Dirtyloops source or installed-skill change as a blocker, not an in-Phase repair.

## Phase ledger

| Beads issue       | Phase | Outcome                                           | Phase doc                        | Depends on        | Status               |
| ----------------- | ----- | ------------------------------------------------- | -------------------------------- | ----------------- | -------------------- |
| `dirtycode-dpx.1` | 1     | One real Program reaches an admitted result       | `01-one-real-program.md`         | none              | ready after creation |
| `dirtycode-dpx.2` | 2     | Program work is understandable and reachable      | `02-understandable-reachable.md` | `dirtycode-dpx.1` | blocked              |
| `dirtycode-dpx.3` | 3     | Controls and recovery converge durably            | `03-control-recovery.md`         | `dirtycode-dpx.2` | blocked              |
| `dirtycode-dpx.4` | 4     | Multi-Phase work stays ordered and ownership-safe | `04-multi-phase.md`              | `dirtycode-dpx.3` | blocked              |
| `dirtycode-dpx.5` | 5     | Supported clients operate the same Program        | `05-client-parity.md`            | `dirtycode-dpx.4` | blocked              |

## Quality gates

- Phase-specific focused tests
- one real-provider integrated proof in Phase 1
- `git diff --check`
- independent correctness and UI review
- maintainability review where named by the Phase
- terminal CI evidence or unavailable-with-evidence

## Branch and PR constraints

Work starts from `lavender/dirtyloops-program-experience` in `dirtydishes/dirtycode`. Internal prepared branches may feed one integration branch and one active external implementation PR. No push, PR, merge, release, deployment, or service restart occurs without separate authority.

## Storyboard

After the epic closes, create `docs/implementation/dirtyloops-program-experience/storyboard-post-run-mm-dd-yyyy.html` through the Dirtyloops closeout contract.
