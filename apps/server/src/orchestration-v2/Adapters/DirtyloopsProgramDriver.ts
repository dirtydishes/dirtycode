import {
  DirtyloopsDecision,
  type DirtyloopsCertificationFailure,
  type DirtyloopsProgramAction,
  ProgramEventId,
  ProgramEffectId,
  ProgramPhaseId,
  ThreadId,
  type ModelSelection,
  type ProgramDriverDecision,
  type ProgramEffect,
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
import { sha256Digest } from "../ProgramIdentity.ts";
import {
  allowedProgramCommands,
  appendProgramActivity,
  isTerminalProgramState,
} from "../ProgramProjection.ts";

const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MILLIS = 15_000;
const isProgramDriverError = Schema.is(ProgramDriverError);
const decodeDirtyloopsDecision = Schema.decodeUnknownEffect(DirtyloopsDecision);

const budgetIdentity = sha256Digest;

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

function permitMatches(
  action: Extract<
    DirtyloopsProgramAction,
    {
      readonly kind: "bind_prepared_worktree" | "launch_owner_attempt" | "cancel_owner_attempt";
    }
  >,
  phase: ReconcileProgramInput["observedProjection"]["phases"][number],
  input: ReconcileProgramInput,
): boolean {
  const permit = action.permit;
  return (
    permit.programId === input.attachment.programId &&
    permit.phaseId === phase.phaseId &&
    permit.phaseCoordinatorThreadId === phase.phaseCoordinatorThreadId &&
    permit.repositoryIdentity === input.attachment.repositoryId &&
    permit.expectedIntegrationHead === input.observedProjection.repositorySnapshot?.head &&
    permit.integrationRef === input.attachment.integrationRef &&
    phase.budgets !== null &&
    permit.budgetIdentity === budgetIdentity(phase.budgets)
  );
}

function effectForAction(
  action: Exclude<DirtyloopsProgramAction, { readonly kind: "wait" }>,
  input: ReconcileProgramInput,
  projection: ReconcileProgramInput["observedProjection"],
  revision: number,
): ProgramEffect | ProgramDriverError {
  const phase = projection.phases.find((candidate) => candidate.phaseId === action.phaseId);
  if (phase === undefined) {
    return new ProgramDriverError({ reason: "driver action names an unknown Phase" });
  }
  const effectId = ProgramEffectId.make(
    `effect:${input.attachment.programId}:${phase.phaseId}:${revision}:${action.kind}`,
  );
  if (action.kind === "launch_phase_coordinator") {
    if (phase.phaseCoordinatorThreadId !== null) {
      return new ProgramDriverError({
        reason: "driver tried to relaunch a bound Phase coordinator",
      });
    }
    return {
      kind: action.kind,
      effectId,
      identity: {
        programId: input.attachment.programId,
        phaseId: phase.phaseId,
        programCoordinatorThreadId: input.attachment.programCoordinatorThreadId,
        phaseCoordinatorThreadId: phase.phaseCoordinatorTargetThreadId,
        projectId: phase.projectId,
        threadTitle: phase.threadTitle,
        modelSelection: phase.modelSelection,
        runtimeMode: phase.runtimeMode,
        interactionMode: phase.interactionMode,
        branch: phase.branch,
        worktreePath: phase.worktreePath,
        requestId: input.requestId,
      },
    };
  }
  if (action.kind === "acknowledge_owner_result") {
    const observed = input.ownerResults.find(
      (candidate) => candidate.ownerResultId === action.ownerResult.ownerResultId,
    );
    if (
      observed === undefined ||
      phase.preparedWorktree === null ||
      phase.preparedWorktree.leaseId !== action.leaseId ||
      phase.preparedWorktree.leaseEpoch !== action.leaseEpoch ||
      phase.preparedWorktree.expiresAt !== action.expiresAt ||
      observed.programId !== input.attachment.programId ||
      observed.phaseId !== phase.phaseId ||
      observed.phaseCoordinatorThreadId !== phase.phaseCoordinatorThreadId ||
      observed.ownerThreadId !== phase.ownerThreadId ||
      observed.attemptId !== phase.activeAttemptId ||
      observed.resultDigest !== action.ownerResult.resultDigest
    ) {
      return new ProgramDriverError({
        reason: "driver OwnerResult identity does not match T3 observation",
      });
    }
    return {
      kind: action.kind,
      effectId,
      identity: {
        requestId: input.requestId,
        ...observed,
        leaseId: action.leaseId,
        leaseEpoch: action.leaseEpoch,
        expiresAt: action.expiresAt,
      },
    };
  }
  if (!permitMatches(action, phase, input)) {
    return new ProgramDriverError({
      reason: "driver worktree permit does not match the Program hierarchy",
    });
  }
  if (action.kind === "bind_prepared_worktree") {
    if (phase.phaseCoordinatorThreadId === null || phase.ownerThreadId !== null) {
      return new ProgramDriverError({
        reason: "driver proposed an owner bind outside its Phase boundary",
      });
    }
    return {
      kind: action.kind,
      effectId,
      identity: {
        requestId: input.requestId,
        ...action.permit,
        ownerThreadId: action.ownerThreadId,
        projectId: phase.projectId,
        ownerThreadTitle: `Dirtyloops Phase ${phase.phaseId} implementation owner`,
        modelSelection: phase.modelSelection,
        runtimeMode: phase.runtimeMode,
        interactionMode: phase.interactionMode,
      },
    };
  }
  if (
    phase.preparedWorktree === null ||
    phase.ownerThreadId !== action.ownerThreadId ||
    phase.preparedWorktree.leaseId !== action.permit.leaseId ||
    phase.preparedWorktree.leaseEpoch !== action.permit.leaseEpoch ||
    phase.preparedWorktree.expiresAt !== action.permit.expiresAt
  ) {
    return new ProgramDriverError({
      reason: "driver Attempt does not match the bound worktree lease",
    });
  }
  return {
    kind: action.kind,
    effectId,
    identity: {
      programId: input.attachment.programId,
      requestId: input.requestId,
      phaseId: phase.phaseId,
      phaseCoordinatorThreadId: phase.phaseCoordinatorThreadId!,
      attemptId: action.attemptId,
      ownerThreadId: action.ownerThreadId,
      preparedWorktree: phase.preparedWorktree,
      prompt: action.prompt,
      providerPolicy: {
        modelSelection: phase.modelSelection,
        runtimeMode: phase.runtimeMode,
        interactionMode: phase.interactionMode,
      },
    },
  };
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
            !["graph_snapshot", "mutable_phase"].includes(decision.decisionCode)) ||
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
        const projection = {
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
          statusRail: [
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
        const effect = effectForAction(action, input, projection, revision);
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
