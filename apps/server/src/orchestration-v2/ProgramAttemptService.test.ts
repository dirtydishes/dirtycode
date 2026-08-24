import { assert, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Command,
  ProgramAttemptId,
  ProgramAttemptRequestId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  type ServerProvider,
  ThreadId,
  TurnItemId,
  type OrchestrationV2RunStatus,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import * as UsageService from "../usage/UsageService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ProgramAttemptService from "./ProgramAttemptService.ts";
import * as ThreadLaunchService from "./ThreadLaunchService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const attemptId = ProgramAttemptId.make("attempt:s1");
const projectId = ProjectId.make("project:s1");
const threadId = ThreadId.make("thread:s1");
const runId = RunId.make("run:s1");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "gpt-5.6-sol" } as const;
const now = DateTime.makeUnsafe("2026-08-19T00:00:00.000Z");

it.effect("retries the launch receipt gap without remounting the thread panel", () =>
  Effect.gen(function* () {
    let requests = 0;
    const result = yield* ProgramAttemptService.retryProgramAttemptReceipt(
      () => Effect.sync(() => (++requests === 1 ? null : "snapshot")),
      { attempts: 3, delay: Effect.void },
    );
    assert.strictEqual(result, "snapshot");
    assert.strictEqual(requests, 2);
  }),
);

it.effect("reports a nonterminal result through the typed error channel", () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      ProgramAttemptService.terminalResult(attemptId, makeProjection("running"), runId),
    );

    assert.instanceOf(failure, ProgramAttemptService.ProgramAttemptStateError);
    assert.equal(failure.state, "run_not_terminal");
    assert.equal(failure.runId, runId);
  }),
);

function makeProjection(status: OrchestrationV2RunStatus): OrchestrationV2ThreadProjection {
  const terminal = ThreadManagementService.isTerminalRunStatus(status);
  return {
    thread: {
      createdBy: "system",
      creationSource: "server",
      id: threadId,
      projectId,
      title: "S1 disposable task",
      providerInstanceId,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "prepared",
      worktreePath: "/repo-worktrees/prepared",
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: terminal ? now : null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    runs: [
      {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("message:s1:user"),
        rootNodeId: null,
        activeAttemptId: null,
        status,
        requestedAt: now,
        startedAt: status === "preparing" ? null : now,
        completedAt: terminal ? now : null,
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems:
      status === "completed"
        ? [
            {
              id: TurnItemId.make("turn-item:s1:assistant"),
              threadId,
              runId,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 1,
              status: "completed",
              title: null,
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              type: "assistant_message",
              messageId: MessageId.make("message:s1:assistant"),
              text: "Disposable task finished.",
              streaming: false,
            },
          ]
        : [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: now,
  };
}

const launchInput = {
  attemptId,
  requestId: ProgramAttemptRequestId.make("request:s1:launch"),
  threadId,
  programId: "agents-dlr",
  taskId: "agents-dlr.2",
  projectId,
  title: "S1 disposable task",
  prompt: "Reply once, then stop.",
  checkout: {
    repositoryRoot: "/repo",
    gitCommonDir: "/repo/.git",
    worktreePath: "/repo-worktrees/prepared",
    branch: "prepared",
    startingCommit: "abc123",
  },
  providerPolicy: {
    modelSelection,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
  },
};

const completedNativeHelper = {
  id: NodeId.make("node:s1:helper"),
  threadId,
  runId,
  parentNodeId: NodeId.make("node:s1:root"),
  origin: "provider_native" as const,
  createdBy: "agent" as const,
  driver: ProviderDriverKind.make("codex"),
  providerInstanceId,
  providerThreadId: null,
  childThreadId: ThreadId.make("thread:s1:helper"),
  nativeTaskRef: null,
  prompt: "Inspect one bounded question.",
  title: "Helper",
  model: "gpt-5.6-sol",
  status: "completed" as const,
  result: "Done.",
  startedAt: now,
  completedAt: now,
  updatedAt: now,
};

function makeHarness(
  domainEvents: Stream.Stream<OrchestrationV2DomainEvent> = Stream.empty,
  settleCancellation = true,
  metering: {
    readonly sessionUsage?: { readonly tokens: number; readonly costMilliUsd: number };
    readonly processes?: ReadonlyArray<Record<string, unknown>>;
    readonly providers?: ReadonlyArray<Record<string, unknown>>;
  } = {},
) {
  return Effect.gen(function* () {
    const projection = yield* Ref.make(makeProjection("preparing"));
    const launch = vi.fn((_input: ThreadLaunchService.ThreadLaunchInput) =>
      Ref.get(projection).pipe(
        Effect.map((current) => ({ threadId, runId, projection: current, resumed: false })),
      ),
    );
    const interruptThread = vi.fn(
      (_input: ThreadManagementService.ThreadManagementInterruptInput) =>
        Effect.succeed({ type: "no_active_run" as const }),
    );
    const dispatch = vi.fn((_command: OrchestrationV2Command) =>
      Effect.succeed({ sequence: 1, storedEvents: [] }),
    );
    const waitForThread = vi.fn((_input: ThreadManagementService.ThreadManagementWaitInput) =>
      Effect.gen(function* () {
        const observed = settleCancellation
          ? makeProjection("cancelled")
          : yield* Ref.get(projection);
        if (settleCancellation) yield* Ref.set(projection, observed);
        return { threadId, run: observed.runs[0]!, timedOut: !settleCancellation };
      }),
    );
    const services = Layer.mergeAll(
      Layer.succeed(ThreadLaunchService.ThreadLaunchService, { launch }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        dispatch,
        getThreadProjection: (requestedThreadId) =>
          requestedThreadId === threadId ? Ref.get(projection) : Effect.die("missing test thread"),
        interruptThread,
        waitForThread,
        streamDomainEvents: domainEvents,
      }),
      Layer.succeed(ResourceTelemetry.ResourceTelemetry, {
        latest: Effect.succeed({ processes: metering.processes ?? [] }),
      } as unknown as ResourceTelemetry.ResourceTelemetry["Service"]),
      Layer.succeed(UsageService.UsageService, {
        readSummary: () => Effect.die("summary usage is not part of this fixture"),
        readSessionUsage: () => Effect.succeed(metering.sessionUsage ?? null),
      } as unknown as UsageService.UsageService["Service"]),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed(
          (metering.providers ?? []) as unknown as ReadonlyArray<ServerProvider>,
        ),
      }),
    );
    const layer = ProgramAttemptService.layer.pipe(
      Layer.provide(services),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(NodeServices.layer),
    );
    return { layer, projection, launch, dispatch, interruptThread, waitForThread };
  });
}

it.effect("emits the retained Program Attempt when its bound T3 run becomes terminal", () =>
  Effect.gen(function* () {
    const completed = makeProjection("completed");
    const terminalEvent = {
      id: EventId.make("event:s1:completed"),
      type: "run.updated",
      threadId,
      runId,
      providerInstanceId,
      occurredAt: now,
      payload: completed.runs[0]!,
    } satisfies OrchestrationV2DomainEvent;
    const harness = yield* makeHarness(Stream.make(terminalEvent));
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, completed);

      const observed = Option.getOrThrow(yield* Stream.runHead(attempts.terminalAttempts));

      assert.equal(observed.attemptId, attemptId);
      assert.equal(observed.programId, "agents-dlr");
      assert.equal(observed.state, "terminal");
      assert.equal(observed.terminalResult?.output, "Disposable task finished.");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("stops an over-limit active Attempt on the helper update event", () =>
  Effect.gen(function* () {
    const activeHelper = {
      ...completedNativeHelper,
      origin: "app_owned" as const,
      status: "running" as const,
      completedAt: null,
    };
    const helperEvent = {
      id: EventId.make("event:s1:helper-over-limit"),
      type: "subagent.updated",
      threadId,
      runId,
      nodeId: activeHelper.id,
      driver: activeHelper.driver,
      providerInstanceId,
      occurredAt: now,
      payload: activeHelper,
    } satisfies OrchestrationV2DomainEvent;
    const completed = makeProjection("completed");
    const terminalEvent = {
      id: EventId.make("event:s1:terminal-after-helper"),
      type: "run.updated",
      threadId,
      runId,
      providerInstanceId,
      occurredAt: now,
      payload: completed.runs[0]!,
    } satisfies OrchestrationV2DomainEvent;
    let terminalEventPulled = false;
    const domainEvents = Stream.make(helperEvent).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.sync(() => {
            terminalEventPulled = true;
            return terminalEvent;
          }),
        ),
      ),
    );
    const harness = yield* makeHarness(domainEvents);
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "delegated", maxHelpers: 1, maxConcurrent: 1, maxDepth: 1 },
      });
      const running = makeProjection("running");
      yield* Ref.set(harness.projection, {
        ...running,
        subagents: [
          activeHelper,
          {
            ...activeHelper,
            id: NodeId.make("node:s1:event-helper:2"),
            childThreadId: ThreadId.make("thread:s1:event-helper:2"),
          },
        ],
      });

      const stopped = Option.getOrThrow(yield* Stream.runHead(attempts.terminalAttempts));

      assert.isFalse(terminalEventPulled);
      assert.equal(harness.interruptThread.mock.calls.length, 1);
      assert.equal(stopped.state, "terminal");
      assert.equal(stopped.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("replays a retained unacknowledged terminal result without a new domain event", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness(Stream.empty);
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("completed"));
      const retained = yield* attempts.observe(attemptId);

      const replayed = Option.getOrThrow(yield* Stream.runHead(attempts.terminalAttempts));

      assert.equal(replayed.attemptId, retained.attemptId);
      assert.deepEqual(replayed.terminalResult, retained.terminalResult);
      assert.isFalse(replayed.terminalAcknowledged);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.live("continues replaying terminal Attempts after a transient durable scan failure", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness(Stream.empty);
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      const sql = yield* SqlClient.SqlClient;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("completed"));
      const retained = yield* attempts.observe(attemptId);
      const retainedRows = yield* sql<{ readonly terminal_result_json: string }>`
        SELECT terminal_result_json FROM program_attempts WHERE attempt_id = ${attemptId}
      `;
      const terminalResultJson = retainedRows[0]!.terminal_result_json;

      yield* sql`
        UPDATE program_attempts
        SET terminal_result_json = ${"{invalid-terminal-result"}
        WHERE attempt_id = ${attemptId}
      `;
      const replay = yield* Stream.runHead(attempts.terminalAttempts).pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Effect.sleep("50 millis");
      yield* sql`
        UPDATE program_attempts
        SET terminal_result_json = ${terminalResultJson}
        WHERE attempt_id = ${attemptId}
      `;

      const observed = Option.getOrThrow(
        yield* Fiber.join(replay).pipe(Effect.timeout("2 seconds")),
      );
      assert.equal(observed.attemptId, retained.attemptId);
      assert.deepEqual(observed.terminalResult, retained.terminalResult);
      assert.isFalse(observed.terminalAcknowledged);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("replays one launch and retains one terminal result until acknowledgement", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      const first = yield* attempts.launch(launchInput);
      const replay = yield* attempts.launch(launchInput);
      const observedByThread = yield* attempts.observeThread(threadId);
      const unrelatedThread = yield* attempts.observeThread(ThreadId.make("thread:unrelated"));
      assert.equal(first.threadId, threadId);
      assert.equal(first.runId, runId);
      assert.equal(first.programId, "agents-dlr");
      assert.equal(first.taskId, "agents-dlr.2");
      assert.equal(first.checkout.startingCommit, "abc123");
      assert.equal(replay.threadId, threadId);
      assert.equal(observedByThread?.attemptId, attemptId);
      assert.isNull(unrelatedThread);
      assert.equal(harness.launch.mock.calls.length, 2);
      assert.equal(harness.launch.mock.calls[0]?.[0].threadId, threadId);
      assert.isTrue(harness.launch.mock.calls[0]?.[0].reuseExistingThread);

      yield* Ref.set(harness.projection, makeProjection("completed"));
      const terminal = yield* attempts.observe(attemptId);
      const terminalReplay = yield* attempts.observe(attemptId);
      assert.deepEqual(terminal.terminalResult, terminalReplay.terminalResult);
      assert.equal(terminal.terminalResult?.output, "Disposable task finished.");

      const acknowledged = yield* attempts.acknowledge({
        attemptId,
        requestId: ProgramAttemptRequestId.make("request:s1:ack"),
      });
      const acknowledgementReplay = yield* attempts.acknowledge({
        attemptId,
        requestId: ProgramAttemptRequestId.make("request:s1:ack"),
      });
      assert.isTrue(acknowledged.terminalAcknowledged);
      assert.isNull(acknowledged.terminalResult);
      assert.deepEqual(acknowledgementReplay, acknowledged);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("keeps an idempotent launch bound to its own run after a later follow-up", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      const first = yield* attempts.launch(launchInput);
      const firstProjection = makeProjection("running");
      const originalRun = firstProjection.runs[0]!;
      yield* Ref.set(harness.projection, {
        ...firstProjection,
        runs: [
          originalRun,
          {
            ...originalRun,
            id: RunId.make("run:s1:follow-up"),
            ordinal: 2,
            userMessageId: MessageId.make("message:s1:follow-up"),
          },
        ],
      });

      const replay = yield* attempts.launch(launchInput);

      assert.equal(first.runId, runId);
      assert.equal(replay.runId, runId);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("retains live Program Attempts as restart interruptions before runtime recovery", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("running"));

      assert.equal(yield* attempts.retainProcessInterruptions, 1);
      yield* Ref.set(harness.projection, makeProjection("cancelled"));

      const recovered = yield* attempts.observe(attemptId);
      assert.equal(recovered.state, "terminal");
      assert.equal(recovered.terminalResult?.status, "interrupted");
      assert.equal(recovered.terminalResult?.failure?.code, "t3_restart_interrupted");
      assert.isTrue(recovered.terminalResult?.failure?.retryable);
      assert.equal(yield* attempts.retainProcessInterruptions, 0);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("makes repeated cancellation harmless", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("running"));
      const cancel = {
        attemptId,
        requestId: ProgramAttemptRequestId.make("request:s1:cancel"),
        reason: "operator stop",
      };
      yield* attempts.cancel(cancel);
      yield* attempts.cancel(cancel);
      assert.equal(harness.interruptThread.mock.calls.length, 2);
      assert.equal(
        harness.interruptThread.mock.calls[0]?.[0].commandId,
        `program-attempt:${attemptId}:cancel`,
      );
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("waits for T3's terminal cancellation acknowledgement before returning", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("running"));

      const cancelled = yield* attempts.cancel({
        attemptId,
        requestId: ProgramAttemptRequestId.make("request:s1:cancel:terminal"),
      });

      assert.equal(harness.waitForThread.mock.calls.length, 1);
      assert.equal(harness.waitForThread.mock.calls[0]?.[0].threadId, threadId);
      assert.equal(harness.waitForThread.mock.calls[0]?.[0].runId, runId);
      assert.equal(cancelled.state, "terminal");
      assert.equal(cancelled.terminalResult?.status, "cancelled");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("rejects a cancellation acknowledgement while the exact run is still active", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness(Stream.empty, false);
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("running"));

      const failure = yield* Effect.flip(
        attempts.cancel({
          attemptId,
          requestId: ProgramAttemptRequestId.make("request:s1:cancel:timed-out"),
        }),
      );

      assert.instanceOf(failure, ProgramAttemptService.ProgramAttemptStateError);
      assert.equal(failure.state, "cancel_not_terminal");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("rejects cancellation request or payload mismatches", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("running"));
      const cancel = {
        attemptId,
        requestId: ProgramAttemptRequestId.make("request:s1:cancel:bound"),
        reason: "operator stop",
      };
      yield* attempts.cancel(cancel);

      const requestConflict = yield* Effect.flip(
        attempts.cancel({
          ...cancel,
          requestId: ProgramAttemptRequestId.make("request:s1:cancel:other"),
        }),
      );
      const payloadConflict = yield* Effect.flip(
        attempts.cancel({ ...cancel, reason: "different reason" }),
      );

      assert.instanceOf(requestConflict, ProgramAttemptService.ProgramAttemptRequestConflictError);
      assert.instanceOf(payloadConflict, ProgramAttemptService.ProgramAttemptRequestConflictError);
      assert.equal(requestConflict.request, "cancel");
      assert.equal(payloadConflict.request, "cancel");
      assert.equal(harness.interruptThread.mock.calls.length, 1);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("allows only one of two concurrent cancellation requests to take effect", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("running"));

      const results = yield* Effect.all(
        [
          Effect.exit(
            attempts.cancel({
              attemptId,
              requestId: ProgramAttemptRequestId.make("request:s1:cancel:concurrent:a"),
              reason: "first request",
            }),
          ),
          Effect.exit(
            attempts.cancel({
              attemptId,
              requestId: ProgramAttemptRequestId.make("request:s1:cancel:concurrent:b"),
              reason: "second request",
            }),
          ),
        ],
        { concurrency: 2 },
      );

      assert.equal(results.filter(Exit.isSuccess).length, 1);
      assert.equal(harness.interruptThread.mock.calls.length, 1);
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("rejects a different acknowledgement request after binding the first", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      yield* Ref.set(harness.projection, makeProjection("completed"));
      yield* attempts.acknowledge({
        attemptId,
        requestId: ProgramAttemptRequestId.make("request:s1:ack:bound"),
      });

      const conflict = yield* Effect.flip(
        attempts.acknowledge({
          attemptId,
          requestId: ProgramAttemptRequestId.make("request:s1:ack:other"),
        }),
      );

      assert.instanceOf(conflict, ProgramAttemptService.ProgramAttemptRequestConflictError);
      assert.equal(conflict.request, "acknowledge");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a solo Program Attempt that returns with a native helper", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({ ...launchInput, teamPolicy: { mode: "solo" } });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [completedNativeHelper],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.class, "validation_error");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a delegated Program Attempt that exceeds maxHelpers", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "delegated", maxHelpers: 1, maxConcurrent: 1, maxDepth: 1 },
      });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [
          completedNativeHelper,
          {
            ...completedNativeHelper,
            id: NodeId.make("node:s1:helper:2"),
            childThreadId: ThreadId.make("thread:s1:helper:2"),
          },
        ],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
      assert.equal(terminal.terminalResult?.output, "Disposable task finished.");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("interrupts an active Program Attempt as soon as its helper ceiling is exceeded", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "delegated", maxHelpers: 1, maxConcurrent: 1, maxDepth: 1 },
      });
      const running = makeProjection("running");
      yield* Ref.set(harness.projection, {
        ...running,
        subagents: [
          { ...completedNativeHelper, origin: "app_owned", completedAt: null, status: "running" },
          {
            ...completedNativeHelper,
            id: NodeId.make("node:s1:active-helper:2"),
            childThreadId: ThreadId.make("thread:s1:active-helper:2"),
            origin: "app_owned",
            completedAt: null,
            status: "running",
          },
        ],
      });

      const stopped = yield* attempts.observe(attemptId);

      assert.equal(harness.interruptThread.mock.calls.length, 1);
      assert.equal(harness.waitForThread.mock.calls.length, 1);
      assert.equal(stopped.state, "terminal");
      assert.equal(stopped.terminalResult?.status, "failed");
      assert.equal(stopped.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("provisions the required app-owned helper for a delegated Program Attempt", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "delegated", maxHelpers: 1, maxConcurrent: 1, maxDepth: 1 },
      });
      const running = makeProjection("running");
      const rootNodeId = NodeId.make("node:s1:root");
      yield* Ref.set(harness.projection, {
        ...running,
        runs: [{ ...running.runs[0]!, rootNodeId }],
      });

      yield* attempts.observe(attemptId);

      assert.equal(harness.dispatch.mock.calls.length, 1);
      assert.deepInclude(harness.dispatch.mock.calls[0]?.[0], {
        type: "delegated_task.request",
        parentThreadId: threadId,
        parentRunId: runId,
        parentNodeId: rootNodeId,
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "system",
        creationSource: "server",
      });
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("provisions a cross-provider helper on a different ready provider", () =>
  Effect.gen(function* () {
    const alternateProviderId = ProviderInstanceId.make("claude");
    const provider = (instanceId: ProviderInstanceId, model: string) => ({
      instanceId,
      driver: ProviderDriverKind.make(String(instanceId)),
      enabled: true,
      installed: true,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: now,
      version: "1.0.0",
      models: [{ slug: model, name: model, isCustom: false, isDefault: true, capabilities: null }],
      slashCommands: [],
      skills: [],
    });
    const harness = yield* makeHarness(Stream.empty, true, {
      providers: [
        provider(providerInstanceId, "gpt-5.6-sol"),
        provider(alternateProviderId, "claude-sonnet"),
      ],
    });
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "cross_provider", maxHelpers: 1, maxConcurrent: 1, maxDepth: 1 },
      });
      const running = makeProjection("running");
      const rootNodeId = NodeId.make("node:s1:root");
      yield* Ref.set(harness.projection, {
        ...running,
        runs: [{ ...running.runs[0]!, rootNodeId }],
      });

      yield* attempts.observe(attemptId);

      assert.equal(harness.dispatch.mock.calls.length, 1);
      assert.deepInclude(harness.dispatch.mock.calls[0]?.[0], {
        type: "delegated_task.request",
        parentThreadId: threadId,
        parentRunId: runId,
        parentNodeId: rootNodeId,
        modelSelection: { instanceId: alternateProviderId, model: "claude-sonnet" },
      });
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect(
  "instructs a native-collaborative owner to create its required provider-native helper",
  () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const attempts = yield* ProgramAttemptService.ProgramAttemptService;

        yield* attempts.launch({
          ...launchInput,
          teamPolicy: {
            mode: "native_collaborative",
            maxHelpers: 1,
            maxConcurrent: 1,
            maxDepth: 1,
          },
        });

        assert.match(
          harness.launch.mock.calls[0]?.[0].initialMessage?.text ?? "",
          /create at least one provider-native helper.*do not finish.*helper has settled/is,
        );
      }).pipe(Effect.provide(harness.layer));
    }),
);

it.effect("fails a delegated Program Attempt that exceeds maxConcurrent", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "delegated", maxHelpers: 2, maxConcurrent: 1, maxDepth: 1 },
      });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [
          {
            ...completedNativeHelper,
            completedAt: DateTime.makeUnsafe("2026-08-19T00:00:10.000Z"),
          },
          {
            ...completedNativeHelper,
            id: NodeId.make("node:s1:concurrent-helper:2"),
            childThreadId: ThreadId.make("thread:s1:concurrent-helper:2"),
            completedAt: DateTime.makeUnsafe("2026-08-19T00:00:10.000Z"),
          },
        ],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a delegated Program Attempt that exceeds maxDepth", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "delegated", maxHelpers: 2, maxConcurrent: 2, maxDepth: 1 },
      });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [
          completedNativeHelper,
          {
            ...completedNativeHelper,
            id: NodeId.make("node:s1:nested-helper"),
            parentNodeId: completedNativeHelper.id,
            childThreadId: ThreadId.make("thread:s1:nested-helper"),
          },
        ],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a cross-provider Program Attempt that uses only one provider", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "cross_provider", maxHelpers: 1, maxConcurrent: 1, maxDepth: 1 },
      });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [completedNativeHelper],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a native-collaborative Program Attempt that uses an app-owned helper", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: {
          mode: "native_collaborative",
          maxHelpers: 1,
          maxConcurrent: 1,
          maxDepth: 1,
        },
      });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [{ ...completedNativeHelper, origin: "app_owned" }],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a delegated Program Attempt that uses a provider-native helper", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: { mode: "delegated", maxHelpers: 1, maxConcurrent: 1, maxDepth: 1 },
      });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [completedNativeHelper],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("fails a layered-hybrid Program Attempt that uses only one helper layer", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: {
          mode: "layered_hybrid",
          maxHelpers: 2,
          maxConcurrent: 2,
          maxDepth: 2,
          maxRounds: 2,
          criteria: ["correctness"],
        },
      });
      const completed = makeProjection("completed");
      yield* Ref.set(harness.projection, {
        ...completed,
        subagents: [completedNativeHelper],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.equal(terminal.terminalResult?.status, "failed");
      assert.equal(terminal.terminalResult?.failure?.code, "program_team_policy_violation");
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("reports measured runtime usage from the bound T3 Attempt", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness();
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch({
        ...launchInput,
        teamPolicy: {
          mode: "native_collaborative",
          maxHelpers: 1,
          maxConcurrent: 1,
          maxDepth: 1,
        },
      });
      const completed = makeProjection("completed");
      const completedAt = DateTime.makeUnsafe("2026-08-19T00:02:00.000Z");
      const providerThreadId = ProviderThreadId.make("provider-thread:s1");
      const providerTurnId = ProviderTurnId.make("provider-turn:s1");
      const runAttemptId = RunAttemptId.make("run-attempt:s1");
      const rootNodeId = NodeId.make("node:s1:root");
      yield* Ref.set(harness.projection, {
        ...completed,
        thread: { ...completed.thread, updatedAt: completedAt, settledAt: completedAt },
        runs: [{ ...completed.runs[0]!, completedAt }],
        attempts: [
          {
            id: runAttemptId,
            runId,
            attemptOrdinal: 1,
            rootNodeId,
            providerInstanceId,
            providerThreadId,
            providerTurnId,
            reason: "initial",
            status: "completed",
            startedAt: now,
            completedAt,
          },
        ],
        providerTurns: [
          {
            id: providerTurnId,
            providerThreadId,
            nodeId: rootNodeId,
            runAttemptId,
            nativeTurnRef: null,
            ordinal: 1,
            status: "completed",
            startedAt: now,
            completedAt,
          },
        ],
        subagents: [{ ...completedNativeHelper, completedAt }],
        updatedAt: completedAt,
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.deepEqual(terminal.runtimeUsage, {
        activeThreads: 2,
        nativeHelpers: 1,
        helperDepth: 1,
        providerTurns: 1,
        wallClockMinutes: 2,
        tokens: null,
        costMilliUsd: null,
      });
    }).pipe(Effect.provide(harness.layer));
  }),
);

it.effect("reports provider tokens, cost, and host resources from the bound T3 Attempt", () =>
  Effect.gen(function* () {
    const mebibyte = 1_048_576;
    const harness = yield* makeHarness(Stream.empty, true, {
      sessionUsage: { tokens: 321, costMilliUsd: 45 },
      processes: [
        {
          identity: { pid: 42, startTimeMs: 1 },
          ppid: 1,
          childPids: [],
          depth: 1,
          name: "codex",
          command: "codex app-server --cwd /repo-worktrees/prepared",
          status: "running",
          category: "provider-root",
          cpuPercent: 2,
          cpuTimeMs: 750,
          residentBytes: 64 * mebibyte,
          peakResidentBytes: 128 * mebibyte,
          virtualBytes: 256 * mebibyte,
          ioReadBytes: 32 * mebibyte,
          ioWriteBytes: 32 * mebibyte,
          ioReadBytesPerSecond: 0,
          ioWriteBytesPerSecond: 0,
          ioSemantics: "storage",
          runTimeMs: 120_000,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      ],
    });
    yield* Effect.gen(function* () {
      const attempts = yield* ProgramAttemptService.ProgramAttemptService;
      yield* attempts.launch(launchInput);
      const completed = makeProjection("completed");
      const boundProviderThreadId = ProviderThreadId.make("provider-thread:metered");
      yield* Ref.set(harness.projection, {
        ...completed,
        runs: [{ ...completed.runs[0]!, providerThreadId: boundProviderThreadId }],
        providerThreads: [
          {
            id: boundProviderThreadId,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: {
              driver: ProviderDriverKind.make("codex"),
              nativeId: "session:s1",
              strength: "strong",
            },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            pendingBackgroundTasks: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });

      const terminal = yield* attempts.observe(attemptId);

      assert.deepInclude(terminal.runtimeUsage, {
        tokens: 321,
        costMilliUsd: 45,
        cpuMillis: 750,
        memoryMiB: 128,
        diskMiB: 64,
      });
    }).pipe(Effect.provide(harness.layer));
  }),
);
