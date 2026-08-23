import { describe, expect, it } from "@effect/vitest";
import {
  ProgramPhaseId,
  ProgramRequestId,
  ThreadId,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeProgramRuntime } from "./ProgramRuntime.ts";
import { makeProgramStore } from "./ProgramStore.ts";

import {
  makeTrackingExecutor,
  phaseCoordinatorThreadId,
  phaseId,
  programId,
  runtimeOptions,
  startInput,
} from "./ProgramRuntime.testkit.ts";

describe("ProgramRuntime deliberation", () => {
  it.effect("rejects layered deliberation that changes the accepted decision criteria", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const layeredStart = {
        ...startInput,
        requestId: ProgramRequestId.make("request:layered-criteria:start"),
        attempts: [
          {
            ...startInput.attempts[0]!,
            teamPolicy: {
              mode: "layered_hybrid" as const,
              maxHelpers: 4,
              maxConcurrent: 2,
              maxDepth: 1,
              maxRounds: 2,
              criteria: ["correctness", "recovery"],
            },
          },
        ],
      } satisfies StartProgramInput;
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(layeredStart);
      const baseline = yield* runtime.read({ programId });

      const result = yield* runtime.recordDeliberation({
        programId,
        requestId: ProgramRequestId.make("request:layered-criteria:mismatch"),
        payload: {
          deliberationId: "deliberation:layered-criteria",
          phaseId,
          question: "Which approach should the Phase owner retain?",
          criteria: ["speed"],
          participantThreadIds: [phaseCoordinatorThreadId],
          kind: "approach_proposed",
          state: "proposing",
          approachId: "approach:fastest",
          authorThreadId: phaseCoordinatorThreadId,
          summary: "Choose the fastest approach without the accepted criteria.",
          evidence: [],
        },
      });

      expect(result.decision).toMatchObject({ status: "rejected", code: "invalid_state" });
      expect(result.projection.revision).toBe(baseline.projection.revision);
      expect(result.projection.deliberations ?? []).toEqual([]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects a layered deliberation judgment beyond maxRounds", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const layeredStart = {
        ...startInput,
        requestId: ProgramRequestId.make("request:layered-rounds:start"),
        attempts: [
          {
            ...startInput.attempts[0]!,
            teamPolicy: {
              mode: "layered_hybrid" as const,
              maxHelpers: 4,
              maxConcurrent: 2,
              maxDepth: 1,
              maxRounds: 1,
              criteria: ["correctness", "recovery"],
            },
          },
        ],
      } satisfies StartProgramInput;
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(layeredStart);
      const baseline = yield* runtime.read({ programId });
      const sharedPayload = {
        deliberationId: "deliberation:layered-round-limit",
        phaseId,
        question: "Which bounded approach should the Phase owner retain?",
        criteria: ["correctness", "recovery"],
        participantThreadIds: [phaseCoordinatorThreadId],
        approachId: "approach:bounded",
        authorThreadId: phaseCoordinatorThreadId,
        evidence: [],
      };
      yield* runtime.recordDeliberation({
        programId,
        requestId: ProgramRequestId.make("request:layered-rounds:proposal"),
        payload: {
          ...sharedPayload,
          kind: "approach_proposed",
          state: "proposing",
          summary: "Propose the bounded approach for judgment.",
        },
      });
      const first = yield* runtime.recordDeliberation({
        programId,
        requestId: ProgramRequestId.make("request:layered-rounds:first-judgment"),
        payload: {
          ...sharedPayload,
          kind: "judgment_recorded",
          state: "judging",
          summary: "The first bounded judgment selects the retained approach.",
        },
      });
      const second = yield* runtime.recordDeliberation({
        programId,
        requestId: ProgramRequestId.make("request:layered-rounds:second-judgment"),
        payload: {
          ...sharedPayload,
          kind: "judgment_recorded",
          state: "judging",
          summary: "A second judgment exceeds the accepted one-round limit.",
        },
      });

      expect(first.decision).toMatchObject({ status: "accepted", code: "accepted" });
      expect(second.decision).toMatchObject({ status: "rejected", code: "invalid_state" });
      expect(second.projection.revision).toBe(baseline.projection.revision + 2);
      expect(second.projection.deliberations?.[0]?.entries).toHaveLength(2);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("records structured deliberation once and replays it after restart", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      yield* runtime.start(startInput);
      const baseline = yield* runtime.read({ programId });
      const proposal = {
        programId,
        requestId: ProgramRequestId.make("request:deliberation:proposal"),
        payload: {
          deliberationId: "deliberation:runtime-proof",
          phaseId,
          question: "Which bounded schedule preserves recovery?",
          criteria: ["correctness", "recovery"],
          participantThreadIds: [phaseCoordinatorThreadId],
          kind: "approach_proposed" as const,
          state: "proposing" as const,
          approachId: "approach:serial-admission",
          authorThreadId: phaseCoordinatorThreadId,
          summary: "Run conflict-free work in parallel and keep Admission serial.",
          evidence: [{ kind: "thread" as const, id: phaseCoordinatorThreadId }],
        },
      };
      yield* runtime.recordDeliberation(proposal);
      yield* runtime.recordDeliberation(proposal);
      yield* runtime.recordDeliberation({
        programId,
        requestId: ProgramRequestId.make("request:deliberation:synthesis"),
        payload: {
          ...proposal.payload,
          participantThreadIds: [
            phaseCoordinatorThreadId,
            startInput.attachment.programCoordinatorThreadId,
          ],
          kind: "synthesis_recorded",
          state: "decided",
          authorThreadId: startInput.attachment.programCoordinatorThreadId,
          summary: "Use bounded parallel execution with one serial Admission target.",
        },
      });

      const restarted = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
      const replayed = yield* restarted.read({ programId });
      const events = yield* store.events(programId);
      const deliberation = replayed.projection.deliberations?.[0];

      expect(deliberation).toMatchObject({
        deliberationId: "deliberation:runtime-proof",
        state: "decided",
        approachIds: ["approach:serial-admission"],
      });
      expect(deliberation?.entries.map((entry) => [entry.kind, entry.summary])).toEqual([
        ["approach_proposed", "Run conflict-free work in parallel and keep Admission serial."],
        ["synthesis_recorded", "Use bounded parallel execution with one serial Admission target."],
      ]);
      expect(events.filter((event) => event.type === "program.deliberation-recorded")).toHaveLength(
        2,
      );
      expect(replayed.projection.revision).toBe(baseline.projection.revision + 2);
      expect(replayed.projection.state).toBe(baseline.projection.state);
      expect(replayed.projection.allowedCommands).toEqual(baseline.projection.allowedCommands);
      expect(replayed.projection.statusRail).toEqual(baseline.projection.statusRail);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect(
    "rejects a deliberation with a foreign Phase, author, and terminal first transition",
    () =>
      Effect.gen(function* () {
        const store = yield* makeProgramStore;
        const tracking = yield* makeTrackingExecutor();
        const runtime = yield* makeProgramRuntime(runtimeOptions(store, tracking.executor));
        yield* runtime.start(startInput);
        const baseline = yield* runtime.read({ programId });

        const rejected = yield* runtime.recordDeliberation({
          programId,
          requestId: ProgramRequestId.make("request:deliberation:foreign-terminal"),
          payload: {
            deliberationId: "deliberation:foreign-terminal",
            phaseId: ProgramPhaseId.make("phase:not-in-program"),
            question: "Can an unrelated thread decide this Program?",
            criteria: ["authority"],
            participantThreadIds: [ThreadId.make("thread:not-in-program")],
            kind: "synthesis_recorded",
            state: "decided",
            approachId: null,
            authorThreadId: ThreadId.make("thread:not-in-program"),
            summary: "This must not become durable Program evidence.",
            evidence: [],
          },
        });
        const events = yield* store.events(programId);

        expect(rejected.decision).toMatchObject({ status: "rejected", code: "request_conflict" });
        expect(rejected.projection.deliberations).toEqual([]);
        expect(
          events.filter((event) => event.type === "program.deliberation-recorded"),
        ).toHaveLength(0);
        expect(rejected.projection.revision).toBe(baseline.projection.revision);
      }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
