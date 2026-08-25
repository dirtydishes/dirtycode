# Loop state

Canonical tracker: Beads epic `agents-dpx`

This file is a resume aid. Beads wins if they disagree.

Status: active

Stream: `dirtyloops-program-experience`

Execution profile: `adaptive`

Harness: `codex`

Adapter contract: `dirtyloops-harness/1`

Current phase: none

Current Beads issue: none

Current PR: none

Current execution strategy: none

Last completed phase: none

Blocked: no

## Decisions

- The accepted plan is fixed at Dirtycode commit `64fe8fa66`.
- Agents owns Beads and Dirtyloops execution state. Dirtycode owns product implementation.
- The installed Dirtyloops skill and matching Agents source are frozen inputs for this Dirtycode-only stream.
- A verified Dirtyloops defect requires a separate issue and plan amendment; replacing the installed skill requires explicit user approval.
- Topology is adaptive. One mutable owner controls each checkout or branch.
- Independent review and terminal CI evidence are required.
- One active external implementation PR is allowed.
- Luna at medium is limited to optional presentation copy.
- Deployment and live-service cutover require separate authority.

## Context to keep

- The current branch began at the fork's `origin/main`, not upstream T3.
- Phase 1 must use a real provider and disposable test repository.
- Generated Program tasks remain ordinary T3 tasks but use Program-owned navigation.
- Accept and Start remain separate durable operations.
- The current T3 Program screen is not the build coordinator.

## Phase ledger

| Phase | Beads issue    | Status               | PR   | Turn doc                                   |
| ----- | -------------- | -------------------- | ---- | ------------------------------------------ |
| 1     | `agents-dpx.1` | ready after creation | none | `turn-docs/01-one-real-program.md`         |
| 2     | `agents-dpx.2` | blocked              | none | `turn-docs/02-understandable-reachable.md` |
| 3     | `agents-dpx.3` | blocked              | none | `turn-docs/03-control-recovery.md`         |
| 4     | `agents-dpx.4` | blocked              | none | `turn-docs/04-multi-phase.md`              |
| 5     | `agents-dpx.5` | blocked              | none | `turn-docs/05-client-parity.md`            |

## Last coordinator update

Loop created from the accepted plan. No implementation Phase has been claimed.
