# Dirtyloops Program experience roadmap

Canonical tracker: Beads epic `dirtycode-dpx`

## Plan source

`docs/plans/dirtyloops-program-experience/plan.md` at accepted and amended Dirtycode commit `64fe8fa66`.

## Outcome

Build a conversation-fed Program creator and plain-language Program runner that carries one accepted request through real Dirtyloops work, keeps its T3 tasks reachable without sidebar clutter, and grows through controlled recovery, multi-Phase execution, and client parity.

## Phase sequence

`dirtycode-dpx.1` -> `dirtycode-dpx.2` -> `dirtycode-dpx.3` -> `dirtycode-dpx.4` -> `dirtycode-dpx.5`

Each issue is one qualified tracer-bullet execution unit. Only explicit `blocks` edges control readiness. The epic groups the stream without a readiness-blocking parent relationship.

## Dependencies

Phase 1 begins from the accepted Dirtycode branch based on the fork's current `origin/main`. Each later Phase depends on acceptance of the prior Phase. No Phase depends on upstream T3 unless the user accepts a later plan amendment.

## Settled decisions

- The loop uses the adaptive execution profile and Codex binding.
- Beads records execution state. The accepted plan and Phase docs record intent.
- This Dirtycode workspace stores the canonical Beads graph on DI. Dirtyloops owns execution policy, review, checks, Admission, integration, and phase closure.
- Dirtycode owns T3 contracts, runtime integration, tasks, clients, and product UI.
- The installed Dirtyloops skill and its matching Agents source are frozen inputs. This stream changes Dirtycode only.
- A verified Dirtyloops defect becomes a separate blocker and plan amendment; this stream never replaces the installed skill without explicit user approval.
- One mutable owner controls each checkout or branch.
- One active external implementation PR is allowed.
- Independent correctness and UI review are required for user-visible Phases.
- Every implementation slice uses the `tdd` skill at a user-approved public seam and records red-before-green evidence.
- Formal review runs once per completed Phase candidate, not per commit or TDD slice.
- Checkpoint roles are Phase 1 thermonuclear, adversarial, and Impeccable manual-product; Phase 2 adversarial and Impeccable manual-product; Phase 3 adversarial and Impeccable manual-product; Phase 4 thermonuclear, adversarial, and Impeccable manual-product; Phase 5 adversarial and Impeccable manual-product.
- Every role reviews the same candidate. Findings become one deduplicated repair batch owned by one repair owner.
- At most three review passes are allowed. A third rejection stops before another repair and requires user authorization.
- Only the thermonuclear role may use `thermo-nuclear-code-quality-review`; every other reviewer is forbidden from invoking or consulting it.
- Luna at medium may generate titles and short summaries only after deterministic facts exist.
- Deployment, live-service cutover, merge, release, and publication require separate authority.

## Open questions

None block implementation.

## Risks

- The existing runtime entrance may expose more construction detail than the new authoring seam can hide without a contract migration.
- Program task placement may touch shared sidebar logic used by ordinary and delegated tasks.
- A real provider test may expose gaps hidden by deterministic fixtures.
- Cross-client presentation may reveal web-only state assumptions.
- The DI-hosted Dirtycode tracker is dedicated to this repository. This stream still uses exact IDs and changes only its own issue graph.

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
- TDD red-before-green evidence at the accepted public seams
- the Phase-specific checkpoint roles approve the same candidate within three review passes
- terminal CI evidence or unavailable-with-evidence

## Closeout

The final closeout artifact is:

`docs/implementation/dirtyloops-program-experience/storyboard-post-run-mm-dd-yyyy.html`
