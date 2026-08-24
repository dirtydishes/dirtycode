import { expect, it } from "@effect/vitest";
import {
  OwnerResultId,
  ProgramAttemptId,
  ProgramAttemptRequestId,
  ProgramEffectId,
  ProgramId,
  ProgramPhaseId,
  ProgramReceiptId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ProgramAttemptSnapshot,
  type ProgramEffect,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { CommandReceiptStoreV2Shape } from "../CommandReceiptStore.ts";
import type { ProgramEffectExecutorContext } from "../ProgramEffectExecutor.ts";
import * as ProgramAttemptService from "../ProgramAttemptService.ts";
import type { ThreadManagementServiceShape } from "../ThreadManagementService.ts";
import { makeT3ProgramEffectExecutor } from "./T3ProgramEffectExecutor.ts";

const programId = ProgramId.make("program:t3-effect-review");
const phaseId = ProgramPhaseId.make("phase:t3-effect-review");
const phaseCoordinatorThreadId = ThreadId.make("thread:t3-effect-review-coordinator");
const projectId = ProjectId.make("project:t3-effect-review");
const providerInstanceId = ProviderInstanceId.make("codex");
const context: ProgramEffectExecutorContext = {
  programId,
  programRevision: 1,
  requestId: ProgramRequestId.make("request:t3-effect-review"),
  receiptId: ProgramReceiptId.make("receipt:t3-effect-review"),
  now: "2026-08-22T12:00:00.000Z",
};

it.effect(
  "launches and recovers one read-only review ProgramAttempt bound to the immutable candidate",
  () =>
    Effect.gen(function* () {
      const attemptId = ProgramAttemptId.make("attempt:t3-effect-review:1");
      const reviewOwnerThreadId = ThreadId.make("thread:t3-effect-review:1");
      const candidateCommit = "2".repeat(40);
      const checkout = {
        repositoryRoot: "/repo",
        gitCommonDir: "/repo/.git",
        worktreePath: "/repo-worktrees/program-phase",
        branch: "dirtyloops/program/phase/attempt-1",
        startingCommit: "1".repeat(40),
      } as const;
      const preparedWorktree = {
        programId,
        requestId: ProgramRequestId.make("request:review-worktree"),
        phaseId,
        phaseCoordinatorThreadId,
        ownerThreadId: ThreadId.make("thread:t3-effect-review-source-owner"),
        projectId,
        ownerThreadTitle: "Immutable candidate implementation owner",
        modelSelection: { instanceId: providerInstanceId, model: "gpt-5.6-sol" },
        runtimeMode: "full-access",
        interactionMode: "default",
        leaseId: "lease:phase:review:1",
        leaseEpoch: 1,
        repositoryIdentity: "dirtydishes/dirtycode",
        repositoryRoot: checkout.repositoryRoot,
        gitCommonDir: checkout.gitCommonDir,
        realPath: checkout.worktreePath,
        expectedIntegrationHead: checkout.startingCommit,
        integrationRef: "refs/heads/main",
        budgetIdentity: "sha256:1273f2d2a5ade9dc619c7e9b86bd855f5a0981ecffaec5b9e3a0d80abf12b672",
        symbolicBranch: checkout.branch,
        startingCommit: checkout.startingCommit,
        clean: true,
        declaredPaths: ["apps/server"],
        expiresAt: "2099-08-22T12:30:00.000Z",
      } as const;
      const reviewEffect = {
        kind: "launch_review_owner",
        effectId: ProgramEffectId.make("effect:launch-review-owner"),
        identity: {
          programId,
          requestId: ProgramRequestId.make("request:launch-review-owner"),
          phaseId,
          phaseCoordinatorThreadId,
          implementationOwnerResultId: OwnerResultId.make(
            "owner-result:t3-effect-review:implementation",
          ),
          attemptId,
          reviewOwnerThreadId,
          candidateId: `candidate:${candidateCommit}`,
          reviewId: `review:${candidateCommit}:broad`,
          candidateCommit,
          reviewKind: "broad",
          preparedWorktree,
          projectId,
          title: "Immutable candidate review",
          prompt: "Review the immutable candidate without editing it.",
          providerPolicy: {
            modelSelection: preparedWorktree.modelSelection,
            runtimeMode: "read-only",
            interactionMode: "default",
          },
        },
      } satisfies ProgramEffect;
      let retained: ProgramAttemptSnapshot | null = null;
      const launches: Array<
        Parameters<ProgramAttemptService.ProgramAttemptService["Service"]["launch"]>[0]
      > = [];
      const attempts = {
        launch: (input) =>
          Effect.sync(() => {
            launches.push(input);
            retained ??= {
              attemptId,
              programId,
              taskId: phaseId,
              attemptKind: "review",
              candidateId: reviewEffect.identity.candidateId,
              reviewId: reviewEffect.identity.reviewId,
              reviewKind: "broad",
              title: reviewEffect.identity.title,
              checkout,
              projectId,
              threadId: reviewOwnerThreadId,
              runId: RunId.make("run:t3-effect-review:1"),
              state: "active",
              runStatus: "running",
              terminalResult: null,
              terminalAcknowledged: false,
            };
            return retained;
          }),
        observe: () =>
          Effect.suspend(() =>
            retained === null
              ? Effect.fail(new ProgramAttemptService.ProgramAttemptNotFoundError({ attemptId }))
              : Effect.succeed(retained),
          ),
        cancel: () => Effect.die("must not cancel"),
        acknowledge: () => Effect.die("must not acknowledge"),
      } satisfies Pick<
        ProgramAttemptService.ProgramAttemptService["Service"],
        "launch" | "observe" | "cancel" | "acknowledge"
      >;
      const threads = {
        dispatch: () => Effect.die("must not dispatch"),
        getThreadProjection: () => Effect.die("must not project"),
        sendToThread: () => Effect.die("must not send"),
        waitForThread: () => Effect.die("must not wait"),
      } satisfies Pick<
        ThreadManagementServiceShape,
        "dispatch" | "getThreadProjection" | "sendToThread" | "waitForThread"
      >;
      const noReceipts = {
        getByCommandId: () => Effect.succeed(Option.none()),
      } satisfies Pick<CommandReceiptStoreV2Shape, "getByCommandId">;
      const mutable = {
        preparedWorktrees: { verify: () => Effect.die("must not verify") },
        launches: { launch: () => Effect.die("must not bind") },
        attempts,
      };

      const first = makeT3ProgramEffectExecutor(threads, noReceipts, mutable);
      const receipt = yield* first.execute(reviewEffect, context);
      expect(receipt.kind).toBe("launch_review_owner");
      expect(launches).toEqual([
        {
          attemptId,
          requestId: ProgramAttemptRequestId.make(`program-effect:${reviewEffect.effectId}:launch`),
          threadId: reviewOwnerThreadId,
          programId,
          taskId: phaseId,
          attemptKind: "review",
          candidateId: reviewEffect.identity.candidateId,
          reviewId: reviewEffect.identity.reviewId,
          reviewKind: "broad",
          projectId,
          title: reviewEffect.identity.title,
          prompt: reviewEffect.identity.prompt,
          checkout,
          providerPolicy: reviewEffect.identity.providerPolicy,
        },
      ]);

      const restarted = makeT3ProgramEffectExecutor(threads, noReceipts, mutable);
      const observed = yield* restarted.observe(reviewEffect, context);
      expect(Option.isSome(observed)).toBe(true);
      expect(launches).toHaveLength(1);
    }),
);
