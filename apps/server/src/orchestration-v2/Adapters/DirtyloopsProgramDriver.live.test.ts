import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  ProgramId,
  ProgramRequestId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ReconcileProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  makeDirtyloopsProcessInvoker,
  makeDirtyloopsReadOnlyProgramDriver,
  resolveDirtyloopsDriverClosure,
} from "./DirtyloopsProgramDriver.ts";

const live = process.env.T3_DIRTYLOOPS_LIVE_READONLY === "1";

describe.runIf(live)("DirtyloopsProgramDriver live read-only boundary", () => {
  it.effect(
    "validates the installed driver and projects the real Beads graph without effects",
    () =>
      Effect.gen(function* () {
        const repoRoot = process.env.T3_DIRTYLOOPS_REPO_ROOT;
        const sourceSkillRoot = process.env.T3_DIRTYLOOPS_SOURCE_SKILL_ROOT;
        const installedSkillRoot = process.env.T3_DIRTYLOOPS_INSTALLED_SKILL_ROOT;
        const generationId = process.env.T3_DIRTYLOOPS_GENERATION_ID;
        const adapterDigest = process.env.T3_DIRTYLOOPS_ADAPTER_DIGEST;
        assert(repoRoot);
        assert(sourceSkillRoot);
        assert(installedSkillRoot);
        assert(generationId);
        assert(adapterDigest);
        const driverClosure = yield* resolveDirtyloopsDriverClosure(installedSkillRoot);

        const programId = ProgramId.make("agents-0ur");
        const input = {
          attachment: {
            programId,
            repositoryId: "dirtydishes/agents",
            integrationRef: "refs/heads/main",
            programCoordinatorThreadId: ThreadId.make("thread:program-coordinator"),
            integrationCoordinatorThreadId: ThreadId.make("thread:integration-coordinator"),
            dirtyloopsGenerationId: generationId,
            dirtyloopsAdapterDigest: adapterDigest,
            t3EnvironmentId: "environment:live-readonly-proof",
            createdAt: "2026-08-22T14:30:00.000Z",
          },
          requestId: ProgramRequestId.make("request:live-readonly-proof"),
          observedProgramRevision: 0,
          observedProjection: {
            programId,
            revision: 0,
            title: "Pending canonical title",
            outcome: "Pending canonical outcome",
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
                threadId: ThreadId.make("thread:program-coordinator"),
                role: "program_coordinator",
                phaseId: null,
                attemptId: null,
              },
              {
                threadId: ThreadId.make("thread:integration-coordinator"),
                role: "integration_coordinator",
                phaseId: null,
                attemptId: null,
              },
            ],
            statusRail: [],
            activity: [],
            activeAgentCount: 0,
            goalCapability: { available: false, adapter: "unsupported", reason: "Not certified." },
            lastEventAt: "2026-08-22T14:30:00.000Z",
          },
          wakeCause: "manual",
          operatorIntent: null,
          occurredAt: "2026-08-22T14:30:00.000Z",
          receipts: [],
        } satisfies ReconcileProgramInput;
        const invoke = yield* makeDirtyloopsProcessInvoker({
          executable: process.execPath,
          args: [
            driverClosure.driverPath,
            "reconcile",
            "--repo-root",
            repoRoot,
            "--source-skill-root",
            sourceSkillRoot,
            "--installed-skill-root",
            driverClosure.installedSkillRoot,
          ],
          cwd: repoRoot,
        });
        const driver = makeDirtyloopsReadOnlyProgramDriver({
          projectId: ProjectId.make("project:agents"),
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          invoke,
        });
        const decision = yield* driver.reconcile(input);

        expect(decision.kind).toBe("wait");
        expect(decision.projection.phases.map((phase) => phase.phaseId)).toEqual([
          "agents-0ur.1",
          "agents-0ur.2",
          "agents-0ur.3",
          "agents-0ur.4",
          "agents-0ur.5",
          "agents-0ur.6",
        ]);
        expect(decision.projection.phases[3]?.blockerPath).toEqual([
          "agents-0ur.4",
          "agents-0ur.3",
        ]);
        expect(decision.projection.sourceIdentity?.parity).toBe("current");
        expect(decision.projection.attempts).toEqual([]);
        expect(decision.projection.activeAgentCount).toBe(0);
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
