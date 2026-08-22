import { assert, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  MessageId,
  type OrchestrationV2DomainEvent,
  ProgramAttemptId,
  ProgramAttemptRequestId,
  ProjectId,
  ProviderInstanceId,
  RunId,
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

function makeHarness(
  domainEvents: Stream.Stream<OrchestrationV2DomainEvent> = Stream.empty,
  settleCancellation = true,
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
        getThreadProjection: (requestedThreadId) =>
          requestedThreadId === threadId ? Ref.get(projection) : Effect.die("missing test thread"),
        interruptThread,
        waitForThread,
        streamDomainEvents: domainEvents,
      }),
    );
    const layer = ProgramAttemptService.layer.pipe(
      Layer.provide(services),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provideMerge(NodeServices.layer),
    );
    return { layer, projection, launch, interruptThread, waitForThread };
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
