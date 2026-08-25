# Dirtyloops Program experience roadmap

Canonical tracker: Beads epic `agents-dpx`

## Plan source

`docs/plans/dirtyloops-program-experience/plan.md` at accepted and amended Dirtycode commit `64fe8fa66`.

## Outcome

Build a conversation-fed Program creator and plain-language Program runner that carries one accepted request through real Dirtyloops work, keeps its T3 tasks reachable without sidebar clutter, and grows through controlled recovery, multi-Phase execution, and client parity.

## Phase sequence

`agents-dpx.1` -> `agents-dpx.2` -> `agents-dpx.3` -> `agents-dpx.4` -> `agents-dpx.5`

Each issue is one qualified tracer-bullet execution unit. Only explicit `blocks` edges control readiness. The epic groups the stream without a readiness-blocking parent relationship.

## Dependencies

Phase 1 begins from the accepted Dirtycode branch based on the fork's current `origin/main`. Each later Phase depends on acceptance of the prior Phase. No Phase depends on upstream T3 unless the user accepts a later plan amendment.

## Settled decisions

- The loop uses the adaptive execution profile and Codex binding.
- Beads records execution state. The accepted plan and Phase docs record intent.
- Agents owns Beads, Dirtyloops execution, review, checks, Admission, and phase closure.
- Dirtycode owns T3 contracts, runtime integration, tasks, clients, and product UI.
- The installed Dirtyloops skill and its matching Agents source are frozen inputs. This stream changes Dirtycode only.
- A verified Dirtyloops defect becomes a separate blocker and plan amendment; this stream never replaces the installed skill without explicit user approval.
- One mutable owner controls each checkout or branch.
- One active external implementation PR is allowed.
- Independent correctness and UI review are required for user-visible Phases.
- Luna at medium may generate titles and short summaries only after deterministic facts exist.
- Deployment, live-service cutover, merge, release, and publication require separate authority.

## Open questions

None block implementation.

## Risks

- The existing runtime entrance may expose more construction detail than the new authoring seam can hide without a contract migration.
- Program task placement may touch shared sidebar logic used by ordinary and delegated tasks.
- A real provider test may expose gaps hidden by deterministic fixtures.
- Cross-client presentation may reveal web-only state assumptions.
- The Agents tracker already contains unrelated active work, so this stream must use exact IDs and never modify those issues.

## Replanning triggers

- An accepted authority or idempotency rule cannot hold.
- One real one-Phase Program cannot finish through the certified provider path.
- Task placement requires a second conversation store or different client rules.
- Control recovery requires guessed transport state or duplicate effects.
- Safe parallel work cannot prove non-overlapping ownership.
- A client needs different canonical state.
- A verified Dirtyloops defect requires a source or installed-skill change.
- A Phase exceeds its accepted scope or repair limit.

## Quality gates

- Phase-specific focused tests
- one real-provider integrated proof in Phase 1
- `git diff --check`
- independent correctness review
- independent UI review for user-visible work
- maintainability review for the multi-Phase and client-parity Phases
- terminal CI evidence or unavailable-with-evidence

## Closeout

The final closeout artifact is:

`docs/implementation/dirtyloops-program-experience/storyboard-post-run-mm-dd-yyyy.html`
