import { assert } from "@effect/vitest";
import {
  ProgramAttemptId,
  type ProgramAttemptSnapshot,
  LEGACY_SERIAL_PROGRAM_BUDGET_LIMITS,
  type ProgramDriverDecision,
  ProgramEffectId,
  ProgramId,
  ProgramPhaseId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ProgramEffect,
  type RuntimeReceipt,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeDeterministicProgramDriver } from "./Adapters/DeterministicProgramDriver.ts";
import { makeUnsupportedGoalDriver } from "./Adapters/GoalDriver.ts";
import {
  makeProgramRuntime,
  ProgramReceiptMismatchError,
  ProgramRuntimeHookError,
  type DirtyloopsProgramDriver,
  type ProgramEffectExecutor,
} from "./ProgramRuntime.ts";
import {
  makeProgramStore,
  ProgramStoreLeaseError,
  type ProgramStoreShape,
} from "./ProgramStore.ts";

export const programId = ProgramId.make("program:slice-1");
export const phaseId = ProgramPhaseId.make("phase:unrelated-7");
export const phaseCoordinatorThreadId = ThreadId.make("thread:ordinary-t3-phase-coordinator");
export const attemptId = ProgramAttemptId.make("attempt:fixture-implementation-owner");
export const goalDriver = makeUnsupportedGoalDriver(
  "Codex goal methods have not passed the dirtyloops certification suite.",
);
export const TEST_CRASH_LEASE_SECONDS = 0.05;
export const awaitScheduledRecovery = TestClock.adjust("75 millis");

export const startInput = {
  requestId: ProgramRequestId.make("request:start"),
  attachment: {
    programId,
    repositoryId: "dirtydishes/dirtycode",
    integrationRef: "refs/heads/feat/program-runtime-shell",
    programCoordinatorThreadId: ThreadId.make("thread:program-owner"),
    integrationCoordinatorThreadId: ThreadId.make("thread:integration-owner"),
    dirtyloopsGenerationId: "dirtyloops:3.0:test",
    dirtyloopsAdapterDigest: "sha256:deterministic-fake",
    t3EnvironmentId: "environment:test",
    createdAt: "2026-08-22T12:00:00.000Z",
  },
  title: "Recoverable Program shell",
  outcome: "Retain one fake T3 receipt across restart.",
  phases: [
    {
      phaseId,
      title: "Fake Phase",
      dependencyIds: [],
      phaseCoordinatorThreadId,
      projectId: ProjectId.make("project:program-runtime"),
      threadTitle: "Fake phase coordinator",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-sol",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feat/program-runtime-shell",
      worktreePath: "/home/delta/dev/dirtycode",
    },
  ],
  attempts: [
    {
      attemptId,
      phaseId,
      ownerKind: "implementation",
      state: "launch_pending",
      threadId: null,
      terminalKind: null,
      ownerResultId: null,
      resultDigest: null,
    },
  ],
  driverKind: "deterministic_fake",
} satisfies StartProgramInput;

export function makeTrackingExecutor(options?: {
  readonly block?: Deferred.Deferred<void>;
  readonly mismatch?: boolean;
  readonly status?: RuntimeReceipt["status"];
}) {
  return Effect.gen(function* () {
    const calls = yield* Ref.make<Array<ProgramEffect>>([]);
    const retained = yield* Ref.make(new Map<string, RuntimeReceipt>());
    const executor: ProgramEffectExecutor = {
      observe: (effect) =>
        Ref.get(retained).pipe(
          Effect.map((receipts) => Option.fromNullishOr(receipts.get(effect.effectId))),
        ),
      execute: (effect, context) =>
        Ref.update(calls, (current) => [...current, effect]).pipe(
          Effect.andThen(
            options?.block === undefined ? Effect.void : Deferred.await(options.block),
          ),
          Effect.flatMap(() => {
            assert(effect.kind === "launch_phase_coordinator");
            const receipt: RuntimeReceipt = {
              receiptId: context.receiptId,
              programId: context.programId,
              programRevision: context.programRevision,
              effectId: effect.effectId,
              requestId: context.requestId,
              kind: "launch_phase_coordinator",
              status: options?.status ?? "succeeded",
              resultDigest: `sha256:${effect.effectId}`,
              evidence: [],
              createdAt: context.now,
              acknowledged: false,
              identity: effect.identity,
              result: {
                phaseCoordinatorThreadId:
                  options?.mismatch === true
                    ? ThreadId.make("thread:mismatched")
                    : effect.identity.phaseCoordinatorThreadId,
              },
            };
            return Ref.update(retained, (receipts) =>
              new Map(receipts).set(effect.effectId, receipt),
            ).pipe(Effect.as(receipt));
          }),
        ),
    };
    return { calls, executor };
  });
}

export function runtimeOptions(store: ProgramStoreShape, executor: ProgramEffectExecutor) {
  const driver = makeDeterministicProgramDriver();
  return {
    store,
    drivers: { deterministic_fake: driver, dirtyloops: driver },
    executor,
    goalDriver,
  } as const;
}
