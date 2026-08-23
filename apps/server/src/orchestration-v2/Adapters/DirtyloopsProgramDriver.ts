import {
  DirtyloopsDecision,
  type DirtyloopsCertificationFailure,
  ProgramEventId,
  ProgramPhaseId,
  ThreadId,
  type ModelSelection,
  type ProgramBudgetDimension,
  type ProgramBudgetLimits,
  type ProgramBudgetProjection,
  type ProgramDriverDecision,
  type ProjectId,
  type ProviderInteractionMode,
  type ReconcileProgramInput,
  ReconcileProgramInput as ReconcileProgramInputSchema,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ProgramDriverError, type DirtyloopsProgramDriver } from "../ProgramDriver.ts";
import {
  allowedProgramCommands,
  appendProgramActivity,
  isTerminalProgramState,
} from "../ProgramProjection.ts";
import { dirtyloopsEffectForAction } from "./DirtyloopsProgramEffects.ts";

const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MILLIS = 30 * 60 * 1_000;
const isProgramDriverError = Schema.is(ProgramDriverError);
const decodeDirtyloopsDecision = Schema.decodeUnknownEffect(DirtyloopsDecision);

export type DirtyloopsProgramInvoker = (
  input: ReconcileProgramInput,
) => Effect.Effect<unknown, ProgramDriverError>;

export interface DirtyloopsProgramDriverOptions {
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly invoke: DirtyloopsProgramInvoker;
}

export interface DirtyloopsProcessInvokerOptions {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly timeoutMillis?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly environment?: NodeJS.ProcessEnv;
}

export function resolveDirtyloopsDriverClosure(installedSkillRoot: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const installedRoot = yield* fileSystem.realPath(installedSkillRoot);
    const expectedPath = path.join(installedRoot, "scripts", "program-driver.mjs");
    const [driverInfo, driverPath] = yield* Effect.all([
      fileSystem.stat(expectedPath),
      fileSystem.realPath(expectedPath),
    ]);
    const relative = path.relative(installedRoot, driverPath);
    if (
      driverInfo.type !== "File" ||
      driverPath !== expectedPath ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return yield* new ProgramDriverError({
        reason:
          "The dirtyloops executable is not the exact regular driver inside the installed dirtyloops closure.",
      });
    }
    return { installedSkillRoot: installedRoot, driverPath } as const;
  }).pipe(
    Effect.mapError((cause) =>
      isProgramDriverError(cause)
        ? cause
        : new ProgramDriverError({
            reason:
              "The dirtyloops executable is not the exact regular driver inside the installed dirtyloops closure.",
            cause,
          }),
    ),
  );
}

export function makeDirtyloopsProcessInvoker(options: DirtyloopsProcessInvokerOptions) {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const encodeInput = Schema.encodeUnknownEffect(
      Schema.fromJsonString(ReconcileProgramInputSchema),
    );
    const decodeOutput = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
    const collect = <E>(
      streamName: "stdout" | "stderr",
      stream: Stream.Stream<Uint8Array, E>,
      limit: number,
    ) =>
      stream.pipe(
        Stream.runFoldEffect(
          () => ({ chunks: [] as Array<Uint8Array>, bytes: 0 }),
          (state, chunk) => {
            const bytes = state.bytes + chunk.byteLength;
            if (bytes > limit) {
              return Effect.fail(
                new ProgramDriverError({ reason: `${streamName} exceeded ${limit} bytes` }),
              );
            }
            state.chunks.push(chunk);
            return Effect.succeed({ chunks: state.chunks, bytes });
          },
        ),
        Effect.map((state) => Buffer.concat(state.chunks, state.bytes).toString("utf8")),
        Effect.mapError((cause) =>
          isProgramDriverError(cause)
            ? cause
            : new ProgramDriverError({ reason: "failed to collect process output", cause }),
        ),
      );
    return (input: ReconcileProgramInput) =>
      Effect.gen(function* () {
        const encoded = yield* encodeInput(input);
        const command = ChildProcess.make(options.executable, [...options.args], {
          cwd: options.cwd,
          env: options.environment ?? process.env,
          shell: false,
          stdin: { stream: Stream.encodeText(Stream.make(encoded)) },
        });
        const child = yield* spawner.spawn(command);
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collect("stdout", child.stdout, options.maxStdoutBytes ?? MAX_STDOUT_BYTES),
            collect("stderr", child.stderr, options.maxStderrBytes ?? MAX_STDERR_BYTES),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        if (exitCode !== 0) {
          return yield* new ProgramDriverError({
            reason: `dirtyloops process exited with ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
          });
        }
        return yield* decodeOutput(stdout);
      }).pipe(
        Effect.timeout(`${options.timeoutMillis ?? DEFAULT_TIMEOUT_MILLIS} millis`),
        Effect.mapError((cause) =>
          isProgramDriverError(cause)
            ? cause
            : new ProgramDriverError({ reason: "process invocation failed", cause }),
        ),
        Effect.scoped,
      );
  });
}

function phaseTargetId(phaseId: ProgramPhaseId): ThreadId {
  return ThreadId.make(`thread:dirtyloops-phase:${phaseId}`);
}

function observedCertificationFailures(
  decision: DirtyloopsDecision,
  input: ReconcileProgramInput,
): ReadonlyArray<DirtyloopsCertificationFailure> {
  const failures: Array<DirtyloopsCertificationFailure> = [];
  if (decision.graph.repository.repositoryId !== input.attachment.repositoryId) {
    failures.push("repository_identity_mismatch");
  }
  if (
    decision.graph.repository.symbolicRef !== input.attachment.integrationRef ||
    decision.graph.repository.integrationRef !== input.attachment.integrationRef
  ) {
    failures.push("integration_ref_mismatch");
  }
  if (decision.graph.sourceIdentity.generationId !== input.attachment.dirtyloopsGenerationId) {
    failures.push("dirtyloops_generation_mismatch");
  }
  if (decision.graph.sourceIdentity.adapterDigest !== input.attachment.dirtyloopsAdapterDigest) {
    failures.push("dirtyloops_adapter_mismatch");
  }
  if (decision.graph.sourceIdentity.parity === "stale") failures.push("source_parity_stale");
  return failures;
}

function isAllowedFailedCertificationTransition(
  decision: DirtyloopsDecision,
  input: ReconcileProgramInput,
): boolean {
  const currentState = input.observedProjection.state;
  if (isTerminalProgramState(currentState)) return decision.programState === currentState;
  if (input.operatorIntent?.kind === "stop" && decision.operatorDecision.status === "accepted") {
    return decision.programState === "stopped";
  }
  return decision.programState === "attention_required";
}

function mutablePhaseState(
  canonical: "blocked" | "ready" | "integrated",
  retained: ReconcileProgramInput["observedProjection"]["phases"][number] | undefined,
) {
  if (canonical === "integrated") return "integrated" as const;
  if (canonical === "blocked") return "blocked" as const;
  if (retained !== undefined && !["blocked", "ready", "integrated"].includes(retained.state)) {
    return retained.state;
  }
  return "ready" as const;
}

export function makeDirtyloopsProgramDriver(
  options: DirtyloopsProgramDriverOptions,
): DirtyloopsProgramDriver {
  return {
    reconcile: (input) =>
      Effect.gen(function* () {
        const value = yield* options.invoke(input);
        const decision = yield* decodeDirtyloopsDecision(value).pipe(
          Effect.mapError(
            (cause) =>
              new ProgramDriverError({
                reason: "driver output failed the typed decision contract",
                cause,
              }),
          ),
        );
        if (decision.graph.programId !== input.attachment.programId) {
          return yield* new ProgramDriverError({
            reason: "driver graph Program ID does not match the attachment",
          });
        }
        const failures = observedCertificationFailures(decision, input);
        if (
          decision.certificationFailures.length !== failures.length ||
          decision.certificationFailures.some((failure, index) => failure !== failures[index]) ||
          (failures.length === 0 &&
            ![
              "graph_snapshot",
              "mutable_phase",
              "admission_complete",
              "admission_blocked",
              "budget_exhausted",
            ].includes(decision.decisionCode)) ||
          (failures.length > 0 && decision.decisionCode !== "recertification_required")
        ) {
          return yield* new ProgramDriverError({
            reason: "driver certification failures do not match the observed attachment",
          });
        }
        if (failures.length > 0 && !isAllowedFailedCertificationTransition(decision, input)) {
          return yield* new ProgramDriverError({
            reason: "driver proposed an illegal failed certification transition",
          });
        }
        const previous = new Map(
          input.observedProjection.phases.map((phase) => [phase.phaseId, phase]),
        );
        const phases = decision.graph.phases.map((phase) => {
          const retained = previous.get(phase.phaseId);
          return {
            phaseId: phase.phaseId,
            title: phase.title,
            state: mutablePhaseState(phase.state, retained),
            beadsStatus: phase.beadsStatus,
            dependencyIds: phase.dependencyIds,
            blockedBy: phase.blockedBy,
            blockerPath: phase.blockerPath,
            budgets: phase.budgets,
            policy: phase.policy,
            activeAttemptId: retained?.activeAttemptId ?? null,
            phaseCoordinatorTargetThreadId:
              retained?.phaseCoordinatorTargetThreadId ?? phaseTargetId(phase.phaseId),
            projectId: retained?.projectId ?? options.projectId,
            threadTitle: retained?.threadTitle ?? `Dirtyloops Phase ${phase.phaseId} coordinator`,
            modelSelection: retained?.modelSelection ?? options.modelSelection,
            runtimeMode: retained?.runtimeMode ?? options.runtimeMode,
            interactionMode: retained?.interactionMode ?? options.interactionMode,
            branch: retained?.branch ?? null,
            worktreePath: retained?.worktreePath ?? null,
            phaseCoordinatorThreadId: retained?.phaseCoordinatorThreadId ?? null,
            ownerThreadId: retained?.ownerThreadId ?? null,
            preparedWorktree: retained?.preparedWorktree ?? null,
            lastLeaseEpoch: retained?.lastLeaseEpoch ?? 0,
            leaseHeartbeatAt: retained?.leaseHeartbeatAt ?? null,
            receiptIds: retained?.receiptIds ?? [],
          };
        });
        const state = decision.programState;
        const revision = decision.programRevision;
        const budgetEntries = Object.entries(decision.graph.budgets).map(([key, canonical]) => {
          const observed = input.observedProjection.budgets?.[key as keyof ProgramBudgetLimits];
          return [key, { used: observed?.used ?? canonical.used, limit: canonical.limit }] as const;
        });
        const exhausted = budgetEntries
          .filter(([, value]) => value.used >= value.limit)
          .map(([key]) => key) as Array<ProgramBudgetDimension>;
        const projectedBudgetUsage = Object.fromEntries(
          budgetEntries,
        ) as unknown as ProgramBudgetLimits;
        if (
          decision.decisionCode === "budget_exhausted" &&
          (decision.kind !== "wait" ||
            decision.programState !== "attention_required" ||
            exhausted.length === 0)
        ) {
          return yield* new ProgramDriverError({
            reason: "driver budget stop does not match canonical limits and observed usage",
          });
        }
        let projection = {
          ...input.observedProjection,
          programId: decision.graph.programId,
          revision,
          title: decision.graph.title,
          outcome: decision.graph.outcome,
          state,
          terminal: isTerminalProgramState(state),
          attentionReason: state === "attention_required" ? decision.reason : null,
          certificationFailures: decision.certificationFailures,
          allowedCommands:
            failures.length > 0 && !isTerminalProgramState(state)
              ? ["stop" as const]
              : allowedProgramCommands(state),
          sourceIdentity: decision.graph.sourceIdentity,
          repositorySnapshot: decision.graph.repository,
          beadsRevision: decision.graph.beadsRevision,
          graphDigest: decision.graph.graphDigest,
          budgets: {
            ...projectedBudgetUsage,
            exhausted,
            dispatchAllowed: exhausted.length === 0,
          } satisfies ProgramBudgetProjection,
          phases,
          activity: appendProgramActivity(input.observedProjection.activity, [
            {
              eventId: ProgramEventId.make(
                `program-event:${input.attachment.programId}:dirtyloops:${revision}`,
              ),
              kind: "decision_recorded" as const,
              message: decision.reason,
              receiptId: null,
              occurredAt: decision.graph.observedAt,
            },
          ]),
          statusRail:
            input.observedProjection.statusRail.length > 0
              ? input.observedProjection.statusRail
              : [
                  { stage: "plan" as const, state: "settled" as const, receiptId: null },
                  { stage: "ready" as const, state: "active" as const, receiptId: null },
                  { stage: "execute" as const, state: "pending" as const, receiptId: null },
                  { stage: "review" as const, state: "pending" as const, receiptId: null },
                  { stage: "ci" as const, state: "pending" as const, receiptId: null },
                  { stage: "admit" as const, state: "pending" as const, receiptId: null },
                  { stage: "advance" as const, state: "pending" as const, receiptId: null },
                ],
          lastEventAt: decision.graph.observedAt,
        };
        const action = decision.action ?? { kind: "wait" as const };
        if (
          action.kind === "deliver_phase_callback" ||
          action.kind === "acknowledge_phase_callback" ||
          action.kind === "deliver_integration_admission_request"
        ) {
          projection = {
            ...projection,
            phases: projection.phases.map((phase) =>
              phase.phaseId === action.phaseId ? { ...phase, state: "approved" as const } : phase,
            ),
            statusRail: projection.statusRail.map((item) =>
              item.stage === "review" || item.stage === "ci"
                ? { ...item, state: "settled" as const }
                : item,
            ),
          };
        }
        if (action.kind === "admission_blocked") {
          const retainedPhase = input.observedProjection.phases.find(
            (phase) => phase.phaseId === action.phaseId,
          );
          const callbackReceipt = input.observedProjection.receipts.find(
            (receipt) =>
              receipt.kind === "acknowledge_phase_callback" &&
              receipt.status === "succeeded" &&
              receipt.identity.phaseId === action.phaseId &&
              receipt.identity.candidateCommit === action.candidateCommit,
          );
          if (
            decision.kind !== "wait" ||
            decision.decisionCode !== "admission_blocked" ||
            decision.programState !== "attention_required" ||
            action.integrationCoordinatorThreadId !==
              input.attachment.integrationCoordinatorThreadId ||
            action.integrationRef !== input.attachment.integrationRef ||
            action.expectedParent !== input.observedProjection.repositorySnapshot?.head ||
            action.beadsTaskId !== action.phaseId ||
            retainedPhase?.state !== "approved" ||
            callbackReceipt === undefined
          ) {
            return yield* new ProgramDriverError({
              reason: "driver Admission block does not match the approved Program boundary",
            });
          }
          const blockedProjection = {
            ...projection,
            state: "attention_required" as const,
            terminal: false,
            attentionReason: decision.reason,
            allowedCommands: allowedProgramCommands("attention_required"),
            phases: projection.phases.map((phase) =>
              phase.phaseId === action.phaseId
                ? { ...phase, state: "attention_required" as const }
                : phase,
            ),
            statusRail: projection.statusRail.map((item) =>
              item.stage === "admit" || item.stage === "advance"
                ? { ...item, state: "failed" as const }
                : item,
            ),
          };
          return {
            kind: "wait" as const,
            programRevision: revision,
            projection: blockedProjection,
            operatorDecision: decision.operatorDecision,
            reason: decision.reason,
            wakeConditions: decision.wakeConditions,
          } satisfies ProgramDriverDecision;
        }
        if (action.kind === "admission_complete") {
          const retainedPhase = input.observedProjection.phases.find(
            (phase) => phase.phaseId === action.phaseId,
          );
          const callbackReceipt = input.observedProjection.receipts.find(
            (receipt) =>
              receipt.kind === "acknowledge_phase_callback" &&
              receipt.status === "succeeded" &&
              receipt.identity.phaseId === action.phaseId &&
              receipt.identity.candidateCommit === action.candidateCommit,
          );
          if (
            decision.kind !== "wait" ||
            decision.decisionCode !== "admission_complete" ||
            action.integrationCoordinatorThreadId !==
              input.attachment.integrationCoordinatorThreadId ||
            action.integrationRef !== input.attachment.integrationRef ||
            action.expectedParent !== input.observedProjection.repositorySnapshot?.head ||
            action.beadsTaskId !== action.phaseId ||
            retainedPhase?.state !== "approved" ||
            callbackReceipt === undefined
          ) {
            return yield* new ProgramDriverError({
              reason: "driver Admission completion does not match the approved Program boundary",
            });
          }
          return {
            kind: "wait" as const,
            programRevision: revision,
            projection,
            operatorDecision: decision.operatorDecision,
            reason: decision.reason,
            wakeConditions: decision.wakeConditions,
          } satisfies ProgramDriverDecision;
        }
        if (decision.kind === "wait" || action.kind === "wait") {
          if (decision.kind !== "wait" || action.kind !== "wait") {
            return yield* new ProgramDriverError({
              reason: "driver decision kind and action disagree",
            });
          }
          return {
            kind: "wait" as const,
            programRevision: revision,
            projection,
            operatorDecision: decision.operatorDecision,
            reason: decision.reason,
            wakeConditions: decision.wakeConditions,
          } satisfies ProgramDriverDecision;
        }
        const effect = dirtyloopsEffectForAction(action, input, projection, revision);
        if (!("effectId" in effect)) return yield* effect;
        return {
          kind: "effects" as const,
          programRevision: revision,
          projection,
          operatorDecision: decision.operatorDecision,
          proposalId: `proposal:${input.attachment.programId}:${revision}`,
          effects: [effect],
        } satisfies ProgramDriverDecision;
      }),
  };
}
