import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DirtyloopsDecision,
  OwnerResultId,
  PhaseCallbackId,
  ProgramAttemptId,
  ProgramEffectId,
  ProgramId,
  ProgramPhaseId,
  ProgramReceiptId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ProgramProjection,
  type ReconcileProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { makeDeterministicProgramDriver } from "./DeterministicProgramDriver.ts";
import {
  makeDirtyloopsProcessInvoker,
  makeDirtyloopsProgramDriver,
  resolveDirtyloopsDriverClosure,
} from "./DirtyloopsProgramDriver.ts";

import {
  encodeDirtyloopsDecisionJson,
  input,
  options,
  phaseId,
  programBudgetLimits,
  raw,
  rawPhase,
} from "./DirtyloopsProgramDriver.testkit.ts";

describe("DirtyloopsProgramDriver certification", () => {
  it.effect("runs the same Phase graph contract through fake and real driver seams", () =>
    Effect.gen(function* () {
      const targetThreadId = ThreadId.make(`thread:dirtyloops-phase:${phaseId}`);
      const fixtureProjection: ProgramProjection = {
        ...input.observedProjection,
        phases: [
          {
            phaseId,
            title: rawPhase.title,
            state: "blocked",
            beadsStatus: null,
            dependencyIds: rawPhase.dependencyIds,
            blockedBy: [],
            blockerPath: [],
            budgets: null,
            policy: null,
            activeAttemptId: null,
            phaseCoordinatorTargetThreadId: targetThreadId,
            projectId: options.projectId,
            threadTitle: `Dirtyloops Phase ${phaseId} coordinator`,
            modelSelection: options.modelSelection,
            runtimeMode: options.runtimeMode,
            interactionMode: options.interactionMode,
            branch: null,
            worktreePath: null,
            phaseCoordinatorThreadId: null,
            ownerThreadId: null,
            preparedWorktree: null,
            lastLeaseEpoch: 0,
            leaseHeartbeatAt: null,
            receiptIds: [],
          },
        ],
      };
      const fake = yield* makeDeterministicProgramDriver().reconcile({
        ...input,
        observedProjection: fixtureProjection,
      });
      const real = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(raw),
      }).reconcile(input);

      expect(
        real.projection.phases.map(({ phaseId, title, dependencyIds }) => ({
          phaseId,
          title,
          dependencyIds,
        })),
      ).toEqual(
        fake.projection.phases.map(({ phaseId, title, dependencyIds }) => ({
          phaseId,
          title,
          dependencyIds,
        })),
      );
      expect(real.kind).toBe("wait");
      expect(fake.kind).toBe("effects");
    }),
  );

  it.effect("rejects a successful decision whose certified attachment identity differs", () =>
    Effect.gen(function* () {
      const mismatches: ReadonlyArray<DirtyloopsDecision> = [
        {
          ...raw,
          graph: {
            ...raw.graph,
            repository: { ...raw.graph.repository, repositoryId: "wrong/repository" },
          },
        },
        {
          ...raw,
          graph: {
            ...raw.graph,
            repository: { ...raw.graph.repository, symbolicRef: "refs/heads/wrong" },
          },
        },
        {
          ...raw,
          graph: {
            ...raw.graph,
            sourceIdentity: {
              ...raw.graph.sourceIdentity,
              generationId: `dirtyloops:${"9".repeat(64)}`,
            },
          },
        },
        {
          ...raw,
          graph: {
            ...raw.graph,
            sourceIdentity: {
              ...raw.graph.sourceIdentity,
              adapterDigest: `sha256:${"8".repeat(64)}`,
            },
          },
        },
      ];

      for (const mismatch of mismatches) {
        const error = yield* makeDirtyloopsProgramDriver({
          ...options,
          invoke: () => Effect.succeed(mismatch),
        })
          .reconcile(input)
          .pipe(Effect.flip);
        expect(error.reason).toContain("certification failures do not match");
      }
    }),
  );

  it.effect(
    "rejects a prepared-worktree permit with a foreign integration ref or budget identity",
    () =>
      Effect.gen(function* () {
        const phaseCoordinatorThreadId = ThreadId.make("thread:phase:agents-0ur.4");
        const observedProjection: ProgramProjection = {
          ...input.observedProjection,
          repositorySnapshot: raw.graph.repository,
          phases: [
            {
              phaseId,
              title: rawPhase.title,
              state: "running",
              beadsStatus: rawPhase.beadsStatus,
              dependencyIds: [],
              blockedBy: [],
              blockerPath: [],
              budgets: rawPhase.budgets,
              policy: rawPhase.policy,
              activeAttemptId: null,
              phaseCoordinatorTargetThreadId: phaseCoordinatorThreadId,
              projectId: options.projectId,
              threadTitle: `Dirtyloops Phase ${phaseId} coordinator`,
              modelSelection: options.modelSelection,
              runtimeMode: options.runtimeMode,
              interactionMode: options.interactionMode,
              branch: null,
              worktreePath: null,
              phaseCoordinatorThreadId,
              ownerThreadId: null,
              preparedWorktree: null,
              lastLeaseEpoch: 0,
              leaseHeartbeatAt: null,
              receiptIds: [],
            },
          ],
        };
        const permit = {
          programId: input.attachment.programId,
          phaseId,
          phaseCoordinatorThreadId,
          leaseId: "lease:agents-0ur:agents-0ur.4:1",
          leaseEpoch: 1,
          repositoryIdentity: input.attachment.repositoryId,
          repositoryRoot: "/repo",
          gitCommonDir: "/repo/.git",
          realPath: "/repo-worktrees/agents-0ur.4",
          expectedIntegrationHead: raw.graph.repository.head,
          integrationRef: input.attachment.integrationRef,
          budgetIdentity: "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
          symbolicBranch: "dirtyloops/agents-0ur/agents-0ur.4/attempt-1",
          startingCommit: raw.graph.repository.head,
          clean: true,
          declaredPaths: [],
          expiresAt: "2026-08-22T13:05:00.000Z",
        } as const;
        const mutableDecision = {
          ...raw,
          kind: "effects",
          decisionCode: "mutable_phase",
          action: {
            kind: "bind_prepared_worktree",
            phaseId,
            ownerThreadId: ThreadId.make("thread:owner:agents-0ur.4"),
            permit,
          },
          graph: {
            ...raw.graph,
            phases: [
              {
                ...rawPhase,
                state: "ready",
                dependencyIds: [],
                blockedBy: [],
                blockerPath: [],
              },
            ],
          },
        } satisfies DirtyloopsDecision;

        for (const mismatchedPermit of [
          { ...permit, integrationRef: "refs/heads/foreign" as const },
          { ...permit, budgetIdentity: `sha256:${"9".repeat(64)}` as const },
        ]) {
          const failure = yield* makeDirtyloopsProgramDriver({
            ...options,
            invoke: () =>
              Effect.succeed({
                ...mutableDecision,
                action: { ...mutableDecision.action, permit: mismatchedPermit },
              }),
          })
            .reconcile({ ...input, observedProjection })
            .pipe(Effect.flip);
          expect(failure.reason).toContain("worktree permit does not match");
        }
      }),
  );

  it.effect("persists a typed stale-parity process decision as attention-required state", () =>
    Effect.gen(function* () {
      const stale: DirtyloopsDecision = {
        ...raw,
        decisionCode: "recertification_required",
        certificationFailures: ["source_parity_stale"],
        programState: "attention_required",
        reason: "installed dirtyloops skill does not match source. Mutable work is blocked.",
        wakeConditions: ["source_parity_restored", "operator_intent"],
        graph: {
          ...raw.graph,
          sourceIdentity: {
            ...raw.graph.sourceIdentity,
            sourceDigest: `sha256:${"7".repeat(64)}`,
            parity: "stale",
          },
        },
      };
      const output = yield* encodeDirtyloopsDecisionJson(stale);
      const outputBase64 = Buffer.from(output).toString("base64");
      const invoke = yield* makeDirtyloopsProcessInvoker({
        executable: process.execPath,
        args: [
          "-e",
          `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(Buffer.from("${outputBase64}", "base64")))`,
        ],
        cwd: process.cwd(),
      });
      const decision = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke,
      }).reconcile(input);

      expect(decision.projection.state).toBe("attention_required");
      expect(decision.projection.attentionReason).toContain("does not match source");
      expect(decision.projection.certificationFailures).toEqual(["source_parity_stale"]);
      expect(decision.projection.sourceIdentity?.parity).toBe("stale");
      expect(decision.projection.attempts).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("persists a typed repository mismatch instead of treating it as a process error", () =>
    Effect.gen(function* () {
      const mismatch: DirtyloopsDecision = {
        ...raw,
        decisionCode: "recertification_required",
        certificationFailures: ["repository_identity_mismatch"],
        programState: "attention_required",
        reason:
          "repository identity does not match the Program attachment. Mutable work is blocked.",
        wakeConditions: ["attachment_changed", "operator_intent"],
        graph: {
          ...raw.graph,
          repository: { ...raw.graph.repository, repositoryId: "wrong/repository" },
        },
      };
      const decision = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed(mismatch),
      }).reconcile(input);

      expect(decision.projection.state).toBe("attention_required");
      expect(decision.projection.attentionReason).toContain("repository identity");
      expect(decision.projection.repositorySnapshot?.repositoryId).toBe("wrong/repository");
      expect(decision.projection.allowedCommands).toEqual(["stop"]);

      const illegalStop = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed({ ...mismatch, programState: "stopped" }),
      })
        .reconcile(input)
        .pipe(Effect.flip);
      expect(illegalStop.reason).toContain("failed certification transition");

      const stoppedProjection: ProgramProjection = {
        ...input.observedProjection,
        state: "stopped",
        terminal: true,
        allowedCommands: [],
      };
      const retainedStop = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () => Effect.succeed({ ...mismatch, programState: "stopped" }),
      }).reconcile({ ...input, observedProjection: stoppedProjection });
      expect(retainedStop.projection.state).toBe("stopped");

      const acceptedStop = yield* makeDirtyloopsProgramDriver({
        ...options,
        invoke: () =>
          Effect.succeed({
            ...mismatch,
            programState: "stopped",
            operatorDecision: {
              status: "accepted",
              code: "accepted",
              message: "Program stopped.",
            },
          }),
      }).reconcile({
        ...input,
        operatorIntent: { kind: "stop" },
      });
      expect(acceptedStop.projection.state).toBe("stopped");
      expect(acceptedStop.projection.certificationFailures).toEqual([
        "repository_identity_mismatch",
      ]);
    }),
  );
});
