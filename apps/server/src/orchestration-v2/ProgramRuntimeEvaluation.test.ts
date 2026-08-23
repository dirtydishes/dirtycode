import { describe, expect, it } from "@effect/vitest";
import { ProgramId, ProgramRequestId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeDeterministicProgramDriver } from "./Adapters/DeterministicProgramDriver.ts";
import { makeProgramRuntime, type DirtyloopsProgramDriver } from "./ProgramRuntime.ts";
import { makeProgramStore } from "./ProgramStore.ts";

import {
  makeTrackingExecutor,
  programId,
  runtimeOptions,
  startInput,
} from "./ProgramRuntime.testkit.ts";

const evaluationRepositorySnapshot = {
  repositoryId: "dirtydishes/dirtycode",
  head: "1".repeat(40),
  gitCommonDir: "/repo/.git",
  symbolicRef: "refs/heads/main",
  integrationRef: "refs/heads/main",
} as const;
const evaluationGraphDigest = `sha256:${"b".repeat(64)}` as const;

function makeEvaluationIdentityDriver(): DirtyloopsProgramDriver {
  const deterministic = makeDeterministicProgramDriver();
  return {
    reconcile: (input) =>
      deterministic.reconcile(input).pipe(
        Effect.map((decision) => ({
          ...decision,
          projection: {
            ...decision.projection,
            repositorySnapshot: evaluationRepositorySnapshot,
            graphDigest: evaluationGraphDigest,
          },
        })),
      ),
  };
}

describe("ProgramRuntime evaluation", () => {
  it.effect(
    "rejects the first evaluation when its fixed task identity differs from the Program snapshot",
    () =>
      Effect.gen(function* () {
        const variants = [
          {
            name: "repository",
            repositoryId: "unrelated/repository",
            startingCommit: "1".repeat(40),
            taskSetDigest: `sha256:${"b".repeat(64)}`,
          },
          {
            name: "starting-commit",
            repositoryId: "dirtydishes/dirtycode",
            startingCommit: "2".repeat(40),
            taskSetDigest: `sha256:${"b".repeat(64)}`,
          },
          {
            name: "task-set",
            repositoryId: "dirtydishes/dirtycode",
            startingCommit: "1".repeat(40),
            taskSetDigest: `sha256:${"c".repeat(64)}`,
          },
        ] as const;

        for (const variant of variants) {
          const variantProgramId = ProgramId.make(`program:evaluation-identity:${variant.name}`);
          const store = yield* makeProgramStore;
          const tracking = yield* makeTrackingExecutor();
          const identityDriver = makeEvaluationIdentityDriver();
          const runtime = yield* makeProgramRuntime({
            ...runtimeOptions(store, tracking.executor),
            drivers: { deterministic_fake: identityDriver, dirtyloops: identityDriver },
          });
          yield* runtime.start({
            ...startInput,
            requestId: ProgramRequestId.make(`request:start:evaluation-identity:${variant.name}`),
            attachment: { ...startInput.attachment, programId: variantProgramId },
          });

          const rejected = yield* runtime.recordEvaluation({
            programId: variantProgramId,
            requestId: ProgramRequestId.make(`request:evaluation-identity:${variant.name}`),
            report: {
              evaluationId: `evaluation:identity:${variant.name}`,
              cohortId: `cohort:identity:${variant.name}`,
              arm: "solo",
              fixedInputsDigest: `sha256:${"a".repeat(64)}`,
              repositoryId: variant.repositoryId,
              startingCommit: variant.startingCommit,
              taskSetDigest: variant.taskSetDigest,
              metrics: {
                tasks: 1,
                acceptedTasks: 1,
                elapsedMillis: 1_000,
                activeComputeMillis: 900,
                tokens: 100,
                costMilliUsd: 10,
                reviewRejections: 0,
                ciFailures: 0,
                duplicateEffects: 0,
                staleEffects: 0,
                injectedCrashes: 0,
                successfulRecoveries: 0,
                operatorInterventions: 0,
                postAdmissionDefects: 0,
                integratedPhases: 1,
                readyWorkLatencyMillis: 25,
              },
              evidence: [],
            },
          });
          const events = yield* store.events(variantProgramId);

          expect(rejected.decision).toMatchObject({ status: "rejected", code: "request_conflict" });
          expect(rejected.projection.evaluations).toEqual([]);
          expect(
            events.filter((event) => event.type === "program.evaluation-recorded"),
          ).toHaveLength(0);
        }
      }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("records all five evaluation arms once and replays them after restart", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const identityDriver = makeEvaluationIdentityDriver();
      const options = {
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: identityDriver, dirtyloops: identityDriver },
      };
      const runtime = yield* makeProgramRuntime(options);
      yield* runtime.start(startInput);
      const baseline = yield* runtime.read({ programId });
      const arms = [
        "solo",
        "explicit_delegates",
        "native_collaborative",
        "t3_cross_provider",
        "layered_dirtyloops_t3",
      ] as const;

      for (const [index, arm] of arms.entries()) {
        const input = {
          programId,
          requestId: ProgramRequestId.make(`request:evaluation:${arm}`),
          report: {
            evaluationId: `evaluation:bounded-task-set:${arm}`,
            cohortId: "cohort:bounded-task-set",
            arm,
            fixedInputsDigest: `sha256:${"a".repeat(64)}`,
            repositoryId: "dirtydishes/dirtycode",
            startingCommit: "1".repeat(40),
            taskSetDigest: `sha256:${"b".repeat(64)}`,
            metrics: {
              tasks: 12,
              acceptedTasks: 7 + index,
              elapsedMillis: 60_000 + index,
              activeComputeMillis: 45_000 + index,
              tokens: 50_000 + index,
              costMilliUsd: 2_000 + index,
              reviewRejections: index,
              ciFailures: index,
              duplicateEffects: 0,
              staleEffects: 0,
              injectedCrashes: 1,
              successfulRecoveries: 1,
              operatorInterventions: index,
              postAdmissionDefects: 0,
              integratedPhases: 4,
              readyWorkLatencyMillis: 1_500 + index,
            },
            evidence: [],
          },
        };
        yield* runtime.recordEvaluation(input);
        if (index === 0) yield* runtime.recordEvaluation(input);
      }

      const restarted = yield* makeProgramRuntime(options);
      const replayed = yield* restarted.read({ programId });
      const evaluations = replayed.projection.evaluations ?? [];
      const events = yield* store.events(programId);

      expect(evaluations.map((evaluation) => evaluation.arm)).toEqual(arms);
      expect(evaluations.map((evaluation) => evaluation.metrics.acceptedTasks)).toEqual([
        7, 8, 9, 10, 11,
      ]);
      expect(new Set(evaluations.map((evaluation) => evaluation.fixedInputsDigest)).size).toBe(1);
      expect(evaluations).toHaveLength(5);
      expect(events.filter((event) => event.type === "program.evaluation-recorded")).toHaveLength(
        5,
      );
      expect(replayed.projection.revision).toBe(baseline.projection.revision + 5);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects an evaluation that changes a retained cohort identity", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const identityDriver = makeEvaluationIdentityDriver();
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: identityDriver, dirtyloops: identityDriver },
      });
      yield* runtime.start(startInput);
      const baseline = yield* runtime.read({ programId });
      const metrics = {
        tasks: 4,
        acceptedTasks: 3,
        elapsedMillis: 10_000,
        activeComputeMillis: 8_000,
        tokens: 2_000,
        costMilliUsd: 300,
        reviewRejections: 0,
        ciFailures: 0,
        duplicateEffects: 0,
        staleEffects: 0,
        injectedCrashes: 1,
        successfulRecoveries: 1,
        operatorInterventions: 0,
        postAdmissionDefects: 0,
        integratedPhases: 2,
        readyWorkLatencyMillis: 100,
      };
      yield* runtime.recordEvaluation({
        programId,
        requestId: ProgramRequestId.make("request:evaluation:fixed:first"),
        report: {
          evaluationId: "evaluation:fixed:solo",
          cohortId: "cohort:fixed",
          arm: "solo",
          fixedInputsDigest: `sha256:${"a".repeat(64)}`,
          repositoryId: "dirtydishes/dirtycode",
          startingCommit: "1".repeat(40),
          taskSetDigest: `sha256:${"b".repeat(64)}`,
          metrics,
          evidence: [],
        },
      });

      const rejected = yield* runtime.recordEvaluation({
        programId,
        requestId: ProgramRequestId.make("request:evaluation:fixed:mismatch"),
        report: {
          evaluationId: "evaluation:fixed:delegates",
          cohortId: "cohort:fixed",
          arm: "explicit_delegates",
          fixedInputsDigest: `sha256:${"c".repeat(64)}`,
          repositoryId: "dirtydishes/dirtycode",
          startingCommit: "1".repeat(40),
          taskSetDigest: `sha256:${"b".repeat(64)}`,
          metrics,
          evidence: [],
        },
      });
      const events = yield* store.events(programId);

      expect(rejected.decision).toMatchObject({ status: "rejected", code: "request_conflict" });
      expect(rejected.projection.evaluations).toHaveLength(1);
      expect(events.filter((event) => event.type === "program.evaluation-recorded")).toHaveLength(
        1,
      );
      expect(rejected.projection.revision).toBe(baseline.projection.revision + 1);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );

  it.effect("rejects internally impossible evaluation metrics without retaining evidence", () =>
    Effect.gen(function* () {
      const store = yield* makeProgramStore;
      const tracking = yield* makeTrackingExecutor();
      const identityDriver = makeEvaluationIdentityDriver();
      const runtime = yield* makeProgramRuntime({
        ...runtimeOptions(store, tracking.executor),
        drivers: { deterministic_fake: identityDriver, dirtyloops: identityDriver },
      });
      yield* runtime.start(startInput);
      const baseline = yield* runtime.read({ programId });

      const rejected = yield* runtime.recordEvaluation({
        programId,
        requestId: ProgramRequestId.make("request:evaluation:impossible"),
        report: {
          evaluationId: "evaluation:impossible:solo",
          cohortId: "cohort:impossible",
          arm: "solo",
          fixedInputsDigest: `sha256:${"a".repeat(64)}`,
          repositoryId: "dirtydishes/dirtycode",
          startingCommit: "1".repeat(40),
          taskSetDigest: `sha256:${"b".repeat(64)}`,
          metrics: {
            tasks: 2,
            acceptedTasks: 3,
            elapsedMillis: 1_000,
            activeComputeMillis: 2_000,
            tokens: 100,
            costMilliUsd: 10,
            reviewRejections: 0,
            ciFailures: 0,
            duplicateEffects: 0,
            staleEffects: 0,
            injectedCrashes: 1,
            successfulRecoveries: 2,
            operatorInterventions: 0,
            postAdmissionDefects: 0,
            integratedPhases: 3,
            readyWorkLatencyMillis: 0,
          },
          evidence: [],
        },
      });
      const events = yield* store.events(programId);

      expect(rejected.decision).toMatchObject({ status: "rejected", code: "request_conflict" });
      expect(rejected.projection.evaluations).toEqual([]);
      expect(events.filter((event) => event.type === "program.evaluation-recorded")).toHaveLength(
        0,
      );
      expect(rejected.projection.revision).toBe(baseline.projection.revision);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
