import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProgramId,
  type ProgramProjection,
  type ProgramSummary,
} from "@t3tools/contracts";

import {
  buildMobileProgramIndexPresentation,
  buildMobileProgramPresentation,
} from "./programPresentation.ts";

describe("mobile Program presentation", () => {
  it("keeps a large Program bounded and exposes only allowed operator controls", () => {
    const projection = {
      programId: "program:mobile-large",
      revision: 17,
      title: "Mobile coordination",
      outcome: "Coordinate several conflict-safe Phases.",
      state: "running",
      allowedCommands: ["pause", "stop"],
      phases: Array.from({ length: 200 }, (_, index) => ({
        phaseId: `phase:${index}`,
        title: `Phase ${index}`,
        state: "running",
      })),
      attempts: Array.from({ length: 50 }, (_, index) => ({
        attemptId: `attempt:${index}`,
        phaseId: `phase:${index}`,
        ownerKind: "implementation",
        state: "running",
        threadId: `thread:${index}`,
        teamPolicy:
          index === 0
            ? {
                mode: "layered_hybrid",
                maxHelpers: 4,
                maxConcurrent: 2,
                maxDepth: 1,
                maxRounds: 3,
                criteria: ["accepted tests pass"],
              }
            : { mode: "solo" },
      })),
      receipts: Array.from({ length: 3_000 }, (_, index) => ({
        receiptId: `receipt:${index}`,
      })),
      activity: Array.from({ length: 120 }, (_, index) => ({
        eventId: `activity:${index}`,
      })),
      deliberations: [],
      budgets: {
        activeThreads: { used: 5, limit: 16 },
        nativeHelpers: { used: 4, limit: 8 },
        helperDepth: { used: 1, limit: 1 },
        providerTurns: { used: 18, limit: 200 },
        tokens: { used: 80_000, limit: 1_000_000 },
        costMilliUsd: { used: 2_500, limit: 100_000 },
        wallClockMinutes: { used: 42, limit: 480 },
        actions: { used: 12, limit: 1_000 },
        concurrentWorktrees: { used: 2, limit: 2 },
        cpuMillis: { used: 100, limit: 3_600_000 },
        memoryMiB: { used: 1_024, limit: 16_384 },
        diskMiB: { used: 200, limit: 102_400 },
        repairs: { used: 0, limit: 1 },
        retries: { used: 1, limit: 6 },
        exhausted: [],
        dispatchAllowed: true,
      },
    } as unknown as ProgramProjection;

    const presentation = buildMobileProgramPresentation(projection);

    expect(presentation.window.phases.items).toHaveLength(20);
    expect(presentation.window.attempts.items).toHaveLength(20);
    expect(presentation.window.receipts.items).toHaveLength(20);
    expect(presentation.window.receipts.items[0]?.receiptId).toBe("receipt:2980");
    expect(presentation.window.receipts.items.at(-1)?.receiptId).toBe("receipt:2999");
    expect(presentation.window.activity.items).toHaveLength(8);
    expect(presentation.window.activity.items[0]?.eventId).toBe("activity:119");
    expect({
      phases: presentation.window.phases.total,
      attempts: presentation.window.attempts.total,
      receipts: presentation.window.receipts.total,
      activity: presentation.window.activity.total,
    }).toEqual({ phases: 200, attempts: 50, receipts: 3_000, activity: 120 });
    expect(presentation.teamRows[0]).toMatchObject({
      modeLabel: "Layered hybrid",
      boundsLabel: "4 helpers, 2 concurrent, depth 1, 3 rounds",
    });
    expect(presentation.budgetRows.find((row) => row.key === "actions")?.valueLabel).toBe(
      "12 / 1,000",
    );
    expect(presentation.controls.map((control) => control.accessibilityLabel)).toEqual([
      "Pause Program",
      "Stop Program",
    ]);
    expect(presentation.controls.map((control) => String(control.command))).not.toContain("admit");
  });

  it("orders a discoverable Program index with accessible route targets", () => {
    const environmentId = EnvironmentId.make("environment:mobile");
    const summaries = new Map(
      [
        {
          programId: "program:settled",
          title: "Settled Program",
          state: "completed",
          terminal: true,
          phaseCount: 8,
          activeAgentCount: 0,
          lastEventAt: "2026-08-22T14:00:00.000Z",
        },
        {
          programId: "program:active-old",
          title: "Earlier active",
          state: "paused",
          terminal: false,
          phaseCount: 2,
          activeAgentCount: 0,
          lastEventAt: "2026-08-22T13:00:00.000Z",
        },
        {
          programId: "program:active-new",
          title: "Newest active",
          state: "running",
          terminal: false,
          phaseCount: 3,
          activeAgentCount: 2,
          lastEventAt: "2026-08-22T15:00:00.000Z",
        },
      ].map(
        (summary) =>
          [ProgramId.make(summary.programId), summary as unknown as ProgramSummary] as const,
      ),
    );

    const presentation = buildMobileProgramIndexPresentation(environmentId, summaries);

    expect(presentation.sections.map((section) => section.title)).toEqual([
      "Active Programs",
      "Settled Programs",
    ]);
    expect(presentation.sections[0]?.rows.map((row) => row.title)).toEqual([
      "Newest active",
      "Earlier active",
    ]);
    expect(presentation.sections[0]?.rows[0]).toMatchObject({
      stateLabel: "Running",
      accessibilityLabel: "Newest active, Running, 3 phases, 2 active agents",
      route: {
        environmentId: "environment:mobile",
        programId: "program:active-new",
      },
    });
    expect(presentation.sections[1]?.rows[0]?.title).toBe("Settled Program");
  });

  it("pages through every bounded mobile Program record", () => {
    const projection = {
      programId: "program:mobile-paging",
      revision: 4,
      allowedCommands: [],
      phases: Array.from({ length: 45 }, (_, index) => ({
        phaseId: `phase:${index}`,
        title: `Phase ${index}`,
        state: "running",
      })),
      attempts: Array.from({ length: 45 }, (_, index) => ({
        attemptId: `attempt:${index}`,
        phaseId: `phase:${index}`,
        ownerKind: "implementation",
        state: "running",
        threadId: `thread:${index}`,
        teamPolicy: { mode: "solo" },
      })),
      receipts: Array.from({ length: 3_000 }, (_, index) => ({
        receiptId: `receipt:${index}`,
      })),
      activity: Array.from({ length: 30 }, (_, index) => ({
        eventId: `activity:${index}`,
      })),
    } as unknown as ProgramProjection;

    const presentation = buildMobileProgramPresentation(projection, {
      phaseOffset: 20,
      attemptOffset: 20,
      receiptOffset: 2_960,
      activityOffset: 8,
    });

    expect(presentation.window.phases.items[0]?.phaseId).toBe("phase:20");
    expect(presentation.window.phases.items.at(-1)?.phaseId).toBe("phase:39");
    expect(presentation.window.attempts.items[0]?.attemptId).toBe("attempt:20");
    expect(presentation.teamRows[0]?.attemptId).toBe("attempt:20");
    expect(presentation.teamRows.at(-1)?.attemptId).toBe("attempt:39");
    expect(presentation.window.receipts.items[0]?.receiptId).toBe("receipt:2960");
    expect(presentation.window.receipts.items.at(-1)?.receiptId).toBe("receipt:2979");
    expect(presentation.window.activity.items[0]?.eventId).toBe("activity:21");
    expect(presentation.window.activity.items.at(-1)?.eventId).toBe("activity:14");
    expect(presentation.window.phases).toMatchObject({
      total: 45,
      hasPrevious: true,
      hasNext: true,
    });
    expect(presentation.window.receipts).toMatchObject({
      total: 3_000,
      hasPrevious: true,
      hasNext: true,
    });
    expect(presentation.paging.phases.controls).toEqual([
      {
        accessibilityLabel: "Previous phases",
        direction: "previous",
        disabled: false,
        targetOffset: 0,
      },
      {
        accessibilityLabel: "Next phases",
        direction: "next",
        disabled: false,
        targetOffset: 40,
      },
    ]);
    expect(presentation.paging.attempts.controls[1]).toMatchObject({
      accessibilityLabel: "Next owner teams",
      targetOffset: 40,
    });
    expect(presentation.paging.receipts.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accessibilityLabel: "Previous receipts", targetOffset: 2_940 }),
        expect.objectContaining({ accessibilityLabel: "Next receipts", targetOffset: 2_980 }),
      ]),
    );
    expect(presentation.paging.activity.controls[1]).toMatchObject({
      accessibilityLabel: "Next activity",
      targetOffset: 16,
    });
  });

  it("keeps the five-arm mobile comparison neutral and safety-complete", () => {
    const arms = [
      "solo",
      "explicit_delegates",
      "native_collaborative",
      "t3_cross_provider",
      "layered_dirtyloops_t3",
    ] as const;
    const projection = {
      programId: "program:mobile-evaluation",
      revision: 9,
      allowedCommands: [],
      phases: [],
      attempts: [],
      receipts: [],
      activity: [],
      evaluations: arms.map((arm, index) => ({
        evaluationId: `evaluation:mobile:${arm}`,
        cohortId: "cohort:mobile",
        arm,
        fixedInputsDigest: `sha256:${"a".repeat(64)}`,
        repositoryId: "dirtydishes/dirtycode",
        startingCommit: "1".repeat(40),
        taskSetDigest: `sha256:${"b".repeat(64)}`,
        metrics: {
          tasks: 12,
          acceptedTasks: 7 + index,
          elapsedMillis: 90_000 - index * 10_000,
          activeComputeMillis: 60_000 + index * 2_000,
          tokens: 50_000 + index * 1_000,
          costMilliUsd: 2_000 + index * 100,
          reviewRejections: index,
          ciFailures: 0,
          duplicateEffects: index === 4 ? 1 : 0,
          staleEffects: 0,
          injectedCrashes: 1,
          successfulRecoveries: 1,
          operatorInterventions: index,
          postAdmissionDefects: index === 4 ? 1 : 0,
          integratedPhases: 4,
          readyWorkLatencyMillis: 1_500 - index * 100,
        },
        evidence: [],
      })),
    } as unknown as ProgramProjection;

    const presentation = buildMobileProgramPresentation(projection);

    expect(presentation.evaluationRows.map((row) => row.armLabel)).toEqual([
      "Solo",
      "Explicit delegates",
      "Native collaborative",
      "T3 cross-provider",
      "Layered dirtyloops + T3",
    ]);
    expect(presentation.evaluationRows.at(-1)).toMatchObject({
      acceptedLabel: "11 / 12 accepted",
      safetyLabel: "1 duplicate effect · 0 stale effects · 1 post-Admission defect",
      recoveryLabel: "1 / 1 crash recoveries · 4 operator interventions",
    });
    expect(presentation.evaluationGuidance).toBe(
      "Speed alone does not rank these arms. Compare accepted outcomes, unsafe effects, recovery, and operator work together.",
    );
  });
});
