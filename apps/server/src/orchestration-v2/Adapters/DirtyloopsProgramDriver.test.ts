import { assert, describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DirtyloopsReadOnlyDecision,
  ProgramId,
  ProgramPhaseId,
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
  makeDirtyloopsReadOnlyProgramDriver,
  resolveDirtyloopsDriverClosure,
} from "./DirtyloopsProgramDriver.ts";

const encodeDirtyloopsReadOnlyDecisionJson = Schema.encodeUnknownEffect(
  Schema.fromJsonString(DirtyloopsReadOnlyDecision),
);
const phaseId = ProgramPhaseId.make("agents-0ur.4");
const input = {
  attachment: {
    programId: ProgramId.make("agents-0ur"),
    repositoryId: "dirtydishes/agents",
    integrationRef: "refs/heads/main",
    programCoordinatorThreadId: ThreadId.make("thread:program"),
    integrationCoordinatorThreadId: ThreadId.make("thread:integration"),
    dirtyloopsGenerationId: `dirtyloops:${"a".repeat(64)}`,
    dirtyloopsAdapterDigest: `sha256:${"b".repeat(64)}`,
    t3EnvironmentId: "environment:test",
    createdAt: "2026-08-22T12:00:00.000Z",
  },
  requestId: ProgramRequestId.make("request:readonly"),
  observedProgramRevision: 2,
  observedProjection: {
    programId: ProgramId.make("agents-0ur"),
    revision: 2,
    title: "Dirtyloops 3.0",
    outcome: "Implement the accepted Program.",
    state: "running",
    terminal: false,
    attentionReason: null,
    certificationFailures: [],
    allowedCommands: ["pause", "stop"],
    sourceIdentity: null,
    repositorySnapshot: null,
    beadsRevision: null,
    graphDigest: null,
    phases: [],
    attempts: [],
    receipts: [],
    threadBindings: [
      {
        threadId: ThreadId.make("thread:program"),
        role: "program_coordinator",
        phaseId: null,
        attemptId: null,
      },
      {
        threadId: ThreadId.make("thread:integration"),
        role: "integration_coordinator",
        phaseId: null,
        attemptId: null,
      },
    ],
    statusRail: [],
    activity: [],
    activeAgentCount: 0,
    goalCapability: { available: false, adapter: "unsupported", reason: "Not certified." },
    lastEventAt: "2026-08-22T12:00:00.000Z",
  },
  wakeCause: "manual",
  operatorIntent: null,
  occurredAt: "2026-08-22T12:05:00.000Z",
  receipts: [],
  ownerResults: [],
} satisfies ReconcileProgramInput;

const raw = {
  schemaVersion: 1,
  kind: "wait",
  decisionCode: "readonly_snapshot",
  certificationFailures: [],
  programRevision: 3,
  programState: "running",
  operatorDecision: {
    status: "accepted",
    code: "accepted",
    message: "Program wake completed.",
  },
  reason: "Canonical graph compiled.",
  wakeConditions: ["beads_changed", "operator_intent"],
  graph: {
    programId: ProgramId.make("agents-0ur"),
    title: "Dirtyloops 3.0",
    outcome: "Implement the accepted Program.",
    beadsRevision: `sha256:${"c".repeat(64)}`,
    graphDigest: `sha256:${"d".repeat(64)}`,
    phases: [
      {
        phaseId,
        title: "Mutable Phase",
        beadsStatus: "open",
        state: "blocked",
        dependencyIds: [ProgramPhaseId.make("agents-0ur.3")],
        blockedBy: [ProgramPhaseId.make("agents-0ur.3")],
        blockerPath: [phaseId, ProgramPhaseId.make("agents-0ur.3")],
        policy: {
          declaredPaths: [],
          admissionChecks: [],
          providerPolicy: { kind: "program_default" },
          retryPolicy: { maxAttempts: 3 },
          reviewPolicy: { kind: "independent" },
          teamPolicy: { kind: "solo" },
        },
        budgets: {
          attempts: { used: 0, limit: 3 },
          wallClockMinutes: { used: 0, limit: 60 },
          tokens: { used: 0, limit: 120000 },
        },
      },
    ],
    sourceIdentity: {
      sourceCommit: "e".repeat(40),
      sourceDigest: `sha256:${"a".repeat(64)}`,
      installedDigest: `sha256:${"a".repeat(64)}`,
      schemaGeneration: `sha256:${"1".repeat(64)}`,
      adapterDigest: `sha256:${"b".repeat(64)}`,
      generationId: `dirtyloops:${"a".repeat(64)}`,
      parity: "current",
    },
    repository: {
      repositoryId: "dirtydishes/agents",
      head: "3".repeat(40),
      gitCommonDir: "/repo/.git",
      symbolicRef: "refs/heads/main",
      integrationRef: "refs/heads/main",
    },
    receipts: [],
    observedAt: "2026-08-22T12:05:00.000Z",
  },
} satisfies DirtyloopsReadOnlyDecision;

const options = {
  projectId: ProjectId.make("project:agents"),
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
  },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};
const rawPhase = raw.graph.phases[0]!;

describe("DirtyloopsProgramDriver", () => {
  it.effect("binds the executable to one regular file inside the installed skill closure", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-dirtyloops-closure-",
      });
      const installedRoot = path.join(fixtureRoot, "installed");
      const driverPath = path.join(installedRoot, "scripts", "program-driver.mjs");
      const outsidePath = path.join(fixtureRoot, "outside-driver.mjs");
      yield* fileSystem.makeDirectory(path.dirname(driverPath), { recursive: true });
      yield* fileSystem.writeFileString(driverPath, "export {};\n");
      yield* fileSystem.writeFileString(outsidePath, "export {};\n");

      const resolved = yield* resolveDirtyloopsDriverClosure(installedRoot);
      expect(resolved).toEqual({ installedSkillRoot: installedRoot, driverPath });

      yield* fileSystem.remove(driverPath);
      yield* fileSystem.symlink(outsidePath, driverPath);
      const result = yield* Effect.result(resolveDirtyloopsDriverClosure(installedRoot));
      assert(Result.isFailure(result));
      expect(result.failure.reason).toContain("installed dirtyloops closure");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("pins a canonical installed root when a configured alias is retargeted", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-dirtyloops-root-alias-",
      });
      const firstRoot = path.join(fixtureRoot, "first");
      const secondRoot = path.join(fixtureRoot, "second");
      const aliasRoot = path.join(fixtureRoot, "installed");
      for (const root of [firstRoot, secondRoot]) {
        yield* fileSystem.makeDirectory(path.join(root, "scripts"), { recursive: true });
        yield* fileSystem.writeFileString(
          path.join(root, "scripts", "program-driver.mjs"),
          "export {};\n",
        );
      }
      yield* fileSystem.symlink(firstRoot, aliasRoot);

      const resolved = yield* resolveDirtyloopsDriverClosure(aliasRoot);
      yield* fileSystem.remove(aliasRoot);
      yield* fileSystem.symlink(secondRoot, aliasRoot);

      expect(resolved).toEqual({
        installedSkillRoot: firstRoot,
        driverPath: path.join(firstRoot, "scripts", "program-driver.mjs"),
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("maps a validated canonical graph without proposing a T3 effect", () =>
    Effect.gen(function* () {
      const driver = makeDirtyloopsReadOnlyProgramDriver({
        ...options,
        invoke: () => Effect.succeed(raw),
      });
      const decision = yield* driver.reconcile(input);

      expect(decision.kind).toBe("wait");
      expect(decision.projection.phases).toHaveLength(1);
      expect(decision.projection.phases[0]).toMatchObject({
        phaseId,
        blockedBy: ["agents-0ur.3"],
        blockerPath: ["agents-0ur.4", "agents-0ur.3"],
        phaseCoordinatorThreadId: null,
        ownerThreadId: null,
      });
      expect(decision.projection.attempts).toEqual([]);
      expect(decision.projection.threadBindings).toEqual(input.observedProjection.threadBindings);
      expect(decision.projection.sourceIdentity?.parity).toBe("current");
    }),
  );

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
            leaseHeartbeatAt: null,
            receiptIds: [],
          },
        ],
      };
      const fake = yield* makeDeterministicProgramDriver().reconcile({
        ...input,
        observedProjection: fixtureProjection,
      });
      const real = yield* makeDirtyloopsReadOnlyProgramDriver({
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
      const mismatches: ReadonlyArray<DirtyloopsReadOnlyDecision> = [
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
        const error = yield* makeDirtyloopsReadOnlyProgramDriver({
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
        } satisfies DirtyloopsReadOnlyDecision;

        for (const mismatchedPermit of [
          { ...permit, integrationRef: "refs/heads/foreign" as const },
          { ...permit, budgetIdentity: `sha256:${"9".repeat(64)}` as const },
        ]) {
          const failure = yield* makeDirtyloopsReadOnlyProgramDriver({
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
      const stale: DirtyloopsReadOnlyDecision = {
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
      const output = yield* encodeDirtyloopsReadOnlyDecisionJson(stale);
      const outputBase64 = Buffer.from(output).toString("base64");
      const invoke = yield* makeDirtyloopsProcessInvoker({
        executable: process.execPath,
        args: [
          "-e",
          `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(Buffer.from("${outputBase64}", "base64")))`,
        ],
        cwd: process.cwd(),
      });
      const decision = yield* makeDirtyloopsReadOnlyProgramDriver({
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
      const mismatch: DirtyloopsReadOnlyDecision = {
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
      const decision = yield* makeDirtyloopsReadOnlyProgramDriver({
        ...options,
        invoke: () => Effect.succeed(mismatch),
      }).reconcile(input);

      expect(decision.projection.state).toBe("attention_required");
      expect(decision.projection.attentionReason).toContain("repository identity");
      expect(decision.projection.repositorySnapshot?.repositoryId).toBe("wrong/repository");
      expect(decision.projection.allowedCommands).toEqual(["stop"]);

      const illegalStop = yield* makeDirtyloopsReadOnlyProgramDriver({
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
      const retainedStop = yield* makeDirtyloopsReadOnlyProgramDriver({
        ...options,
        invoke: () => Effect.succeed({ ...mismatch, programState: "stopped" }),
      }).reconcile({ ...input, observedProjection: stoppedProjection });
      expect(retainedStop.projection.state).toBe("stopped");

      const acceptedStop = yield* makeDirtyloopsReadOnlyProgramDriver({
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

  it.effect("bounds repeated read-only decision activity", () =>
    Effect.gen(function* () {
      const driver = makeDirtyloopsReadOnlyProgramDriver({
        ...options,
        invoke: (current) =>
          Effect.succeed({
            ...raw,
            programRevision: current.observedProgramRevision + 1,
            graph: { ...raw.graph, observedAt: current.occurredAt },
          }),
      });
      let projection: ProgramProjection = input.observedProjection;
      for (let revision = 0; revision < 150; revision += 1) {
        const decision = yield* driver.reconcile({
          ...input,
          observedProgramRevision: projection.revision,
          observedProjection: projection,
          occurredAt: `2026-08-22T12:${String(revision % 60).padStart(2, "0")}:00.000Z`,
        });
        projection = decision.projection;
      }

      expect(projection.activity).toHaveLength(100);
      expect(projection.activity.at(-1)?.message).toBe("Canonical graph compiled.");
    }),
  );

  it.effect("bounds child output in bytes and classifies process failures", () =>
    Effect.gen(function* () {
      const invoke = (
        source: string,
        extra: {
          readonly maxStdoutBytes?: number;
          readonly maxStderrBytes?: number;
          readonly timeoutMillis?: number;
        } = {},
      ) =>
        makeDirtyloopsProcessInvoker({
          executable: process.execPath,
          args: ["-e", source],
          cwd: process.cwd(),
          maxStdoutBytes: 5,
          maxStderrBytes: 5,
          ...extra,
        }).pipe(
          Effect.flatMap((run) => run(input)),
          Effect.result,
          Effect.map((result) => {
            assert(Result.isFailure(result));
            return result.failure;
          }),
        );

      expect((yield* invoke('process.stdout.write("123456")')).reason).toContain(
        "stdout exceeded 5 bytes",
      );
      expect((yield* invoke('process.stderr.write("123456")')).reason).toContain(
        "stderr exceeded 5 bytes",
      );
      expect((yield* invoke('process.stdout.write("ééé")')).reason).toContain(
        "stdout exceeded 5 bytes",
      );
      expect(
        (yield* invoke('process.stdout.write("not-json")', { maxStdoutBytes: 64 })).reason,
      ).toContain("process invocation failed");
      expect(
        (yield* invoke('process.stderr.write("nope"); process.exit(7)', {
          maxStderrBytes: 64,
        })).reason,
      ).toContain("exited with 7: nope");
      expect(
        (yield* invoke("setTimeout(() => undefined, 1000)", { timeoutMillis: 20 })).reason,
      ).toContain("process invocation failed");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
