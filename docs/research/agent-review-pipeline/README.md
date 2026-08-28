# Agent review pipeline research

The combined, designed record is [The Review Loop](./review-loop-field-report.html).

## Recommendation

Keep Thermonuclear as the only dedicated review skill for now. Build the larger quality system from four parts:

- **Thermonuclear:** read-only judgment over an exact diff, spec, repo rules, and raw proof.
- **Dirtyloops:** checkpoint identity, reviewer selection, finding ledger, repair owner, pass budget, and terminal state.
- **Scripts and tests:** objective facts such as type errors, line thresholds, forbidden patterns, test output, traces, and replay.
- **AGENTS.md:** stable product facts, safety rules, ownership, architecture, short commands, and a short review doctrine.

The governing rule is: **the reviewer judges; the controller converges; scripts prove; AGENTS.md orients.**

## Proposed loop

1. Select one accepted behavior or structural move.
2. Freeze base, head, spec, repo rules, and scope.
3. Run the smallest relevant baseline.
4. Implement one unit with one mutable owner.
5. Produce a raw proof packet.
6. Review from fresh, read-only context.
7. Verify and deduplicate each finding.
8. Accept or assign the whole set to one repair owner.
9. Rerun the affected proof.
10. Recheck the same finding IDs and stop at the recorded pass limit.

Allowed terminal states: `accepted`, `rejected`, `blocked`, and `repair-budget-exhausted`.

## Mandatory review lenses

- **Correctness and invariants:** invariant, reachability, oracle sensitivity, replay, minimized counterexample.
- **Spec and scope:** right behavior, missing requirements, scope creep, and explicit non-goals.
- **Test truth:** proof that can fail for the feared defect, plus raw and replayable evidence.
- **Simplification:** concepts, branches, policy owners, caller knowledge, and change surfaces removed.

Conditional lenses load only when the diff earns them: security, concurrency and recovery, migrations, measured performance, accessibility, and T3’s provider/client/contract/connection-mode matrix.

## Thermonuclear changes

- Shrink the core skill to a compact review contract with optional references.
- Keep it read-only. Remove repair, pass-count, CI, and loop ownership.
- Treat 1,000 lines as a cohesion tripwire, not a verdict.
- Require a stable finding record: ID, lens, severity, confidence, exact location, fact, evidence, impact, smallest repair, proof, and status.
- Put correctness before simplification and require behavior proof before and after structural work.

## Skill admission gate

Do not add a skill unless it has a distinct trigger, recurring procedure, and checkable result; cannot fit as a conditional lens; cannot be done more reliably by a script; improves measured review outcomes; and removes a proven capability if deleted.

The research did not find a present case for permanent “correctness critic,” “simplicity critic,” or “test critic” skills beside Thermonuclear.

## AGENTS.md audit

Current local snapshot:

- Global AGENTS.md: 7,901 bytes.
- Dirtycode AGENTS.md: 16,753 bytes.
- Combined: 24,654 bytes before nested guidance.
- Dirtycode’s file contains two generated `Beads Issue Tracker` sections.

Codex’s default combined project-instruction limit is 32 KiB. Its initial skill list uses at most 2% of context, or 8,000 characters when the window is unknown. Keep stable product and safety rules in AGENTS.md; route long procedures, conditional checklists, and drifting inventories behind focused skills and references.

## Evaluation

Run the current and proposed pipelines over 20–30 closed changes with fixed diffs, specs, proof packets, and models. Label findings blind. Compare known-defect recall, valid finding rate, false blockers, duplicates, repair regressions, convergence, tokens, wall time, and human review time.

The HTML report contains the full practitioner synthesis, selected short quotes, source notes, detailed architecture, and direct reading list.
