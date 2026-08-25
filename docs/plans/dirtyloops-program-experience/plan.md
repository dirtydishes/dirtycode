# Dirtyloops Program experience

Status: accepted

Created: 2026-08-24

Accepted: 2026-08-25

## Decision

Build a conversation-fed Program creator and a plain-language Program runner inside T3 Code.

The user describes the work in familiar T3 chat. T3 turns that intent into one structured, editable proposal. Dirtyloops validates the proposal. The user accepts and starts the exact revision. T3 then opens a calm runner where every Program thread is available without flooding normal project recents.

The product loop is:

```text
Describe the work
        |
        v
Review one structured Program proposal
        |
        v
Accept plan and start
        |
        v
Needs you / Now / Next / Done
        |
        v
Open only the T3 threads that matter
```

The Program workspace is an operator view, not a runtime dump. Receipts, thread IDs, leases, worktree paths, digests, and adapter details remain available under Diagnostics, but they do not own the first screen.

## Why this plan exists

The current Program implementation proves durable runtime contracts and projections, but it does not yet form a usable product flow.

The missing pieces are visible to the user:

- There is no UI for creating or starting a Program.
- Starting requires a low-level payload that includes identities the server should create.
- The default Program page leads with runtime terms and raw identifiers.
- Bound threads still enter the ordinary sidebar because T3 has no Program placement rule.
- The demo driver can look active without proving that a real provider is doing work.
- Controls can appear even when the current runtime state will reject them.
- Attached thread count can look like active agent count even when no provider run is active.

This plan keeps the verified runtime work. It adds the missing authoring, presentation, and navigation behavior around it.

## Product job

The primary user is a developer who wants T3 to carry out an accepted piece of work through Dirtyloops. They should not need to know how Program IDs, coordinator threads, leases, receipts, worktrees, or Admission are represented.

The experience must answer these questions quickly:

1. What are we building?
2. What is happening now?
3. Does anything need me?
4. What happens next?
5. Which conversation should I open?
6. What proves that finished work was accepted?

Success means a user can start with a plain request, inspect what will happen, start one real Program, leave it running, return later, understand its state, and open any relevant T3 thread without using a terminal or reading server logs.

## Product model

### Program creation is chat-first, not chat-only

The user starts from one of these entry points:

- `+` beside the `dirtyloops` sidebar heading.
- **New Program** in the project menu.
- **New Program** in the command palette.
- **Build as Program** from an existing planning thread or accepted plan.

All entry points open the same Program composer. Project context is filled in when known.

The first prompt asks:

> What do you want to build?

The planning conversation may ask focused questions when the request lacks a decision that changes scope, acceptance, mutation rights, integration target, review policy, or a hard budget. It must not ask the user for thread IDs, worktree paths, request IDs, adapter digests, or other runtime construction details.

Chat proposes changes. It never becomes executable truth.

### The proposal is the draft truth

The structured proposal contains:

- Program outcome and explicit non-goals.
- Phases and their dependency order.
- The result and acceptance evidence for each Phase.
- Repository and integration target.
- Review and check policy.
- Provider and model defaults.
- Concurrency, attempt, repair, time, token, and cost limits.
- Assumptions, warnings, unresolved decisions, and blockers.

Direct edits and chat edits change the same revisioned draft. A material chat edit appears as a visible patch before the user applies it. Cosmetic text may update with Undo.

The proposal uses four finding types:

- **Confirmed** came from Git, Beads, repository configuration, or direct user input.
- **Default** is a safe setting the user may change.
- **Needs decision** blocks acceptance until the user answers.
- **Warning** allows acceptance only after the user can see its effect.

Dirtyloops performs authoritative validation. T3 may catch simple input errors early, but the client does not decide whether a graph, provider choice, mutation scope, or budget is safe.

### Planning discussion and runtime coordination stay separate

An existing planning thread remains an ordinary T3 thread linked as source evidence.

A draft created from the Program composer may own a planning thread, but that thread still remains source discussion after Start. It does not become the Program coordinator. Planning may contain discarded ideas, use the wrong model, or carry unrelated history.

After Dirtyloops accepts the attachment, T3 creates a dedicated coordinator thread using the certified provider and runtime policy.

### One visible confirmation records two durable operations

The normal action is **Accept plan and start**.

The server records two separate operations:

1. **Accept plan** validates and materializes the exact revision into canonical Beads state. It returns an accepted revision, graph digest, and receipt.
2. **Start Program** verifies that accepted revision and digest, creates T3-owned attachment and coordinator identities, records launch intent, and wakes `ProgramRuntime`.

The UI shows both steps without asking the user to confirm twice.

If acceptance succeeds and Start fails, the Program remains **Ready** with a **Retry start** action. A retry uses the same accepted identity and cannot create a duplicate Program.

The advanced creation flow may later offer **Create paused**, but it is not the default.

## Program runner

The default runner uses this hierarchy:

1. Outcome, factual state, progress, and allowed controls.
2. **Needs you**, only when an action is required.
3. **Now**, with every active Phase, current role, current work, last meaningful update, and thread link.
4. **Next**, with ready work and plain blocking reasons.
5. **Done**, collapsed by default.
6. **Threads**, the complete Program thread directory.
7. **Evidence** and **Activity**, available in an inspector on wide screens and sheets or tabs on small screens.
8. **Diagnostics**, containing raw runtime evidence.

The default view uses plain labels:

| Canonical stage      | Default wording         |
| -------------------- | ----------------------- |
| `execute`            | Building                |
| `review`             | Reviewing               |
| `ci`                 | Running checks          |
| `admit`              | Adding approved work    |
| `advance`            | Choosing the next Phase |
| `attention_required` | Needs you               |

The exact canonical stage remains visible in Diagnostics and exported evidence.

The original graph and Phase inspector remain useful, but they are secondary. Complex Programs may open a **Map** view. A linear Phase list stays available for accessibility and for cases where a graph adds no value.

## Thread navigation

A Program-bound thread is an ordinary T3 thread whose navigation home is its Program.

The rules are fixed:

1. An unbound thread appears in normal project recents.
2. A Program-bound thread appears in the Program's Threads view.
3. Creating or opening a Program thread does not add it to normal recents.
4. A Program thread that needs input, approval, or failure review appears beneath its Program row.
5. The currently open Program thread also appears beneath its Program row so its location remains clear.
6. Explicit pinning adds it to the normal pinned area with Program context.
7. Search and the command palette include every Program thread.
8. Builder and reviewer threads are visible by default.
9. Program, integration, and Phase coordinator threads sit under collapsed **System threads** unless they need attention.
10. Settled threads remain available through Program history and search.
11. A missing thread remains as a broken historical reference. The UI does not erase it from evidence.

Clicking a Program thread opens the standard T3 thread route. The thread page adds:

- `Program > Phase > Role` breadcrumb.
- **Back to Program**.
- Program and Phase state in the existing context panel.
- Related Program threads.
- **Pin to project sidebar**.

T3 does not build another chat renderer or copy messages into Program state.

## Attention rules

Attention comes from typed Program and thread state. A model cannot create, raise, lower, or clear it.

Attention includes:

- repository, source, identity, lease, or Admission conflicts;
- pending user input or approval;
- owner failure, review rejection, or failed checks;
- a required retry or replan;
- enforced budget or repair limits.

Routine receipts, heartbeats, and ordinary state changes belong in Activity or Diagnostics. They do not create attention items.

Viewing an item marks it seen but does not resolve it. Canonical state resolves it.

## Authority

The implementation must preserve these ownership rules:

| Concern                                                                                          | Owner                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Accepted work, dependencies, ordering, blockers, completion                                      | Beads                                       |
| Readiness, worktree permits, review, CI policy, Admission, integration, Beads closure            | Dirtyloops                                  |
| Draft UI, durable runtime, wakes, provider execution, recovery, threads, projections, navigation | T3                                          |
| Code and integration ref                                                                         | Git                                         |
| Optional titles and short summaries                                                              | Luna at medium, with deterministic fallback |

Models may propose a draft and explain persisted facts. They do not decide readiness, status, attention, allowed commands, Admission, integration, or completion.

Planning and Phase execution use the selected capable model. Luna at medium is reserved for low-risk presentation work such as:

- Program and thread titles;
- one-line milestone summaries;
- plain-language descriptions derived from deterministic state.

These calls run after the facts exist, cache by source revision and locale, and never block commands or rendering.

## Module design

### `ProgramAuthoring`

`ProgramAuthoring` is the deep module at the authoring seam.

```ts
interface ProgramAuthoring {
  create(input: CreateProgramDraft): ProgramDraftSnapshot;
  revise(input: ReviseProgramDraft): ProgramDraftSnapshot;
  accept(input: AcceptProgramDraft): AcceptedProgramSnapshot;
  read(draftId: ProgramDraftId): ProgramDraftSnapshot;
}
```

Its implementation hides:

- draft persistence and revisions;
- planning conversation references;
- proposal patches and direct edits;
- repository and Beads inspection;
- Dirtyloops validation;
- assumptions and validation evidence;
- idempotent Beads materialization;
- accepted revision and graph digest generation.

It does not start provider work. If Dirtyloops needs a plan compiler, that adapter remains internal to this module rather than expanding the runtime driver interface.

### Existing `ProgramRuntime`, deepened

Keep the existing runtime responsibilities for start, wake, pause, resume, stop, read, receipts, single-writer execution, and recovery.

Its public Start input becomes small:

```ts
type StartAcceptedProgram = {
  programId: ProgramId;
  requestId: ProgramRequestId;
  expectedAcceptedRevision: number;
  expectedGraphDigest: string;
};
```

The current `StartProgramInput` in `packages/contracts/src/program.ts` becomes an internal `ProgramBootstrap` assembled by the server. Web, desktop, mobile, tools, and future entry points must not construct attachment identities, coordinator thread IDs, worktrees, attempts, or driver kind.

### Shared `programPresentation`

`programPresentation` is a pure module in `packages/client-runtime`.

```ts
deriveProgramWorkspace(facts, optionalCopy): ProgramWorkspaceView
resolveThreadPlacement(threadSummary): ThreadPlacement
```

Its implementation owns:

- Needs you, Now, Next, and Done grouping;
- attention order and deduplication;
- human role and state labels;
- deterministic presentation fallbacks;
- thread placement and Program search metadata.

It derives presentation from facts. It does not define another Program state machine.

### Compact thread ownership

The server derives compact Program ownership from `ProgramThreadBinding` into each ordinary thread shell:

- Program ID;
- Phase ID;
- Attempt ID;
- role;
- lifecycle state;
- attention reason.

Clients can then place a thread without loading the complete Program projection or its conversation. The existing binding schema and ordinary thread routes remain canonical.

## Delivery phases

### Phase 1: create and finish one real Program

#### User outcome

From one project, the user can describe one task, review a one-Phase proposal, start it, watch it run, open its threads, and receive one integrated result.

#### Scope

- Web and desktop.
- One project and one repository.
- One sequential Phase.
- One implementation owner at a time.
- One certified provider adapter and selected capable model.
- Raw-intent composer with focused clarification.
- Structured proposal with outcome, scope, acceptance evidence, target, checks, and fixed conservative limits.
- Separate durable Accept and Start operations behind one confirmation.
- Minimal Needs you, Now, Next, and Done runner.
- Program-owned thread placement from the first generated thread.
- Real implementation, independent review, checks, Admission, integration, and Beads closure.
- Stop and only the controls the runtime can accept in this bounded mode.

#### Acceptance proof

In a disposable repository, an integrated browser test starts from raw intent and records both acceptance and Start receipts. A real provider thread changes and commits one file. The candidate passes declared checks and independent review. Dirtyloops admits and integrates it, then closes the Beads task once. The Program survives a page reload and finishes as **Completed**.

The test also proves:

- no deterministic or canned driver participates;
- retrying after a lost response creates one Program and one set of effects;
- a stale draft, Git ref, Beads revision, or graph digest blocks Start and shows the changed facts;
- generated threads do not enter normal recents;
- the active agent count matches real provider work;
- no UUID, receipt name, or worktree path appears in the default runner.

### Phase 2: make all work understandable and reachable

#### User outcome

The user can understand the Program within seconds and open any related conversation without sidebar clutter.

#### Scope

- Complete Needs you, Now, Next, and Done presentation.
- Human role names and factual milestone text.
- Phase-grouped Program thread directory.
- Program breadcrumbs and Back to Program.
- Search, command-palette results, and explicit pinning.
- Collapsed system threads.
- Evidence and Activity inspector.
- Diagnostics for raw runtime data.
- Optional Luna titles and summaries with immediate factual fallbacks.

#### Acceptance proof

Fixtures cover planning, preparing, working, waiting, blocked, reviewing, failed checks, Admission conflict, stale transport, stopped, and completed states. Each produces the correct plain-language view and allowed controls.

A Program with 50 threads adds one Program row and no generated rows to normal recents. Every thread remains reachable from the Program and search. Opening a thread does not promote it. Pinning and unpinning change placement exactly once. Forced Luna failure changes no fact, action, or placement.

### Phase 3: add reliable control and recovery

#### User outcome

The user can pause, resume, stop, retry, and replan without guessing whether a command worked.

#### Scope

- Durable pause, resume, stop, retry, and replan commands and receipts.
- Controls derived from server-returned allowed actions.
- Plain command rejection and next-action text.
- Accepted replan revisions with a visible change diff.
- Attention aggregation and **Since you were away**.
- Recovery after process restart, lost response, stale revision, and reconnect.
- Retained evidence from earlier revisions and attempts.

#### Acceptance proof

Integration tests interrupt each control between command and receipt, restart the server, replay safely, and produce one correct final state. A disconnected client preserves last-known facts and never calls the Program paused, stopped, or completed. Replan cannot alter admitted work or change execution before a new revision is accepted.

### Phase 4: scale to real multi-Phase Programs

#### User outcome

The user can run dependent and bounded parallel work while the default runner stays readable.

#### Scope

- Multi-Phase proposals and dependency editing through an accessible linear form.
- Bounded parallel scheduling.
- Multiple implementation and review owners.
- Per-Phase model and team overrides.
- Phase and Program budgets.
- Review-repair attempts and retained history.
- Optional Map view and selected-Phase inspector.
- Safe-boundary replanning for unsettled work.

#### Acceptance proof

A real Program runs two dependent Phases and two bounded parallel Phases. Downstream work remains blocked until canonical prerequisites settle. Conflicting mutation scopes never run together. Every mutable owner uses a separately permitted worktree. A review-repair cycle retains both attempts. Only admitted results integrate, and all threads and evidence survive restart.

### Phase 5: finish the product across clients

#### User outcome

The same Program can be created, monitored, controlled, and opened from web, desktop, mobile, and remote connections.

#### Scope

- Mobile composer, proposal review, runner, attention, threads, and safe controls.
- Remote and reconnect behavior.
- Keyboard and screen-reader paths.
- State that does not rely on color.
- Reduced motion and no continuously repainting effects.
- Command-palette and settings entry-point parity.
- Settled Program history.
- Bounded queries, paging, and virtualization where measurement proves the need.
- User documentation and cleanup of obsolete demo paths.

#### Acceptance proof

Integrated web, desktop, and mobile passes operate the same remote Program and derive the same state, controls, attention, and thread placement. A 200-thread fixture loads no message bodies until a thread opens, remains usable with keyboard and screen reader, and reconnects without duplicated commands or missing attention.

## Non-negotiable acceptance rules

- Every displayed fact traces to a persisted projection, Git or Beads fact, or durable receipt.
- Accept and Start remain separate recorded operations.
- Beads closes only after review, checks, Admission, and integration succeed.
- `ci-unavailable-with-evidence` never appears as passing CI.
- A Program survives refresh, server restart, and remote reconnect without changing meaning.
- Program threads remain standard T3 threads with one canonical history.
- Every client uses the same thread placement rule.
- Program lists never hydrate full message history.
- Model enrichment always has a deterministic fallback.
- The product renders only commands returned as allowed by the current runtime state.
- Phase 1 does not ship until raw user intent completes through the real Dirtyloops path.

## Current implementation disposition

Keep and deepen:

- `ProgramRuntime` and its persistence, receipts, wake, control, and recovery behavior.
- `DirtyloopsProgramDriver` and certification checks.
- Existing Program projections and allowed-command data.
- `ProgramThreadBinding`.
- Existing Program list subscriptions, sidebar group, route, and workspace shell.
- Normal T3 thread storage and routes.

Remove from the product path:

- `deterministic_fake` as a client-selectable or production driver.
- Retrofitted demo records as acceptance evidence.
- Raw receipt, thread ID, callback, lease, and worktree text from the primary runner.
- Active agent counts derived from attached threads.
- Controls that the current Dirtyloops decision cannot accept.

Keep only for tests and clearly labeled design evidence:

- `DeterministicProgramDriver`.
- Seeded Program fixtures.
- Simulated storyboards and screenshots.

## Anti-goals

- No CLI or raw JSON in the creation flow.
- No graph editor as the primary creation experience.
- No client-owned canonical graph.
- No automatic planning-thread promotion into runtime coordination.
- No second Program chat store or transcript renderer.
- No generated-thread flood in project recents.
- No direct T3 command for Admission, integration, or Beads closure.
- No model-generated lifecycle fact, success claim, attention priority, or allowed action.
- No blocking title or summary generation.
- No speculative large-scale transport rewrite before the one-Phase path works.
- No desktop graph squeezed into the mobile interface.

## Open questions

None block implementation. Repository evidence may still change implementation details behind the accepted module interfaces.

## Replanning triggers

Stop the active Phase and return to planning if evidence shows that:

- the accepted T3, Dirtyloops, Beads, and Git authority split cannot support the required behavior;
- one real one-Phase Program cannot complete through the certified provider path without weakening an acceptance rule;
- Program thread placement would require a second conversation store or inconsistent client behavior;
- the server cannot keep Accept and Start separate and idempotent;
- a supported client cannot derive the same factual state or allowed controls;
- a required change would alter an admitted result, bypass review, weaken Admission, or treat unavailable CI as passing;
- a Phase exhausts its accepted repair limit or needs wider scope than this plan allows.

Implementation may change internal file placement, helper functions, and test fixtures without replanning when the product behavior, authority, interfaces, and acceptance evidence remain intact.

## Plan completion

This plan is complete when a user can start with a plain request, approve the exact work, run it through real Dirtyloops authority, understand the current state without runtime vocabulary, open any Program thread without sidebar pollution, recover after interruption, and operate the same Program across supported T3 clients.
