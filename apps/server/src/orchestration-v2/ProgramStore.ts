import {
  ProgramAttachment,
  type ProgramEffect,
  ProgramEffectId,
  ProgramEvent,
  ProgramId,
  type ProgramListSnapshot,
  ProgramProjection,
  ProgramReceiptId,
  ProgramRequestId,
  type ProgramSnapshot,
  type ProgramSummary,
  type ProgramWakeCause,
  ProgramWakeId,
  RuntimeReceipt,
  type StartProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

interface ProgramRow {
  readonly program_id: string;
  readonly attachment_json: string;
  readonly driver_kind: string;
  readonly projection_json: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface RequestRow {
  readonly request_id: string;
  readonly program_id: string;
  readonly operation: string;
  readonly input_json: string;
  readonly result_json: string | null;
}

interface WakeRow {
  readonly wake_id: string;
  readonly program_id: string;
  readonly request_id: string;
  readonly cause: string;
  readonly status: "pending" | "running" | "completed";
  readonly epoch: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
}

interface ReceiptRow {
  readonly receipt_json: string;
}

interface EventRow {
  readonly event_json: string;
}

interface EventSequenceRow {
  readonly next_sequence: number;
}

export class ProgramStoreError extends Schema.TaggedErrorClass<ProgramStoreError>()(
  "ProgramStoreError",
  {
    operation: Schema.String,
    programId: Schema.optional(ProgramId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Program persistence failed during ${this.operation}.`;
  }
}

export class ProgramStoreLeaseError extends Schema.TaggedErrorClass<ProgramStoreLeaseError>()(
  "ProgramStoreLeaseError",
  {
    programId: ProgramId,
    wakeId: ProgramWakeId,
    epoch: Schema.Number,
  },
) {
  override get message(): string {
    return `Program ${this.programId} wake lease ${this.wakeId}@${this.epoch} is stale.`;
  }
}

export interface ProgramRecord {
  readonly attachment: ProgramAttachment;
  readonly driverKind: StartProgramInput["driverKind"];
  readonly projection: ProgramProjection;
}

export interface ClaimedProgramWake {
  readonly wakeId: ProgramWakeId;
  readonly programId: ProgramId;
  readonly requestId: ProgramRequestId;
  readonly cause: ProgramWakeCause;
  readonly epoch: number;
  readonly workerId: string;
}

export type ProgramRequestLookup =
  | { readonly kind: "new" }
  | { readonly kind: "pending" }
  | { readonly kind: "completed"; readonly snapshot: ProgramSnapshot }
  | { readonly kind: "conflict" };

export interface ProgramStoreShape {
  readonly create: (
    input: StartProgramInput,
    projection: ProgramProjection,
  ) => Effect.Effect<void, ProgramStoreError>;
  readonly load: (
    programId: ProgramId,
  ) => Effect.Effect<Option.Option<ProgramRecord>, ProgramStoreError>;
  readonly list: Effect.Effect<ProgramListSnapshot, ProgramStoreError>;
  readonly beginRequest: (input: {
    readonly programId: ProgramId;
    readonly requestId: ProgramRequestId;
    readonly operation: string;
    readonly inputJson: string;
    readonly now: string;
  }) => Effect.Effect<ProgramRequestLookup, ProgramStoreError>;
  readonly completeRequest: (input: {
    readonly requestId: ProgramRequestId;
    readonly snapshot: ProgramSnapshot;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError>;
  readonly enqueueWake: (input: {
    readonly wakeId: ProgramWakeId;
    readonly programId: ProgramId;
    readonly requestId: ProgramRequestId;
    readonly cause: ProgramWakeCause;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError>;
  readonly claimWake: (input: {
    readonly programId: ProgramId;
    readonly workerId: string;
    readonly now: string;
    readonly leaseExpiresAt: string;
    readonly allowTakeover?: boolean;
  }) => Effect.Effect<Option.Option<ClaimedProgramWake>, ProgramStoreError>;
  readonly saveProjection: (input: {
    readonly lease: ClaimedProgramWake;
    readonly projection: ProgramProjection;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
  readonly saveEffect: (input: {
    readonly lease: ClaimedProgramWake;
    readonly effect: ProgramEffect;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
  readonly receiptByEffect: (
    effectId: ProgramEffectId,
  ) => Effect.Effect<Option.Option<RuntimeReceipt>, ProgramStoreError>;
  readonly saveReceipt: (input: {
    readonly lease: ClaimedProgramWake;
    readonly receipt: RuntimeReceipt;
  }) => Effect.Effect<RuntimeReceipt, ProgramStoreError | ProgramStoreLeaseError>;
  readonly unacknowledgedReceipts: (
    programId: ProgramId,
  ) => Effect.Effect<ReadonlyArray<RuntimeReceipt>, ProgramStoreError>;
  readonly acknowledgeReceipts: (input: {
    readonly lease: ClaimedProgramWake;
    readonly receiptIds: ReadonlyArray<ProgramReceiptId>;
    readonly now: string;
  }) => Effect.Effect<ReadonlyArray<RuntimeReceipt>, ProgramStoreError | ProgramStoreLeaseError>;
  readonly appendEvent: (input: {
    readonly lease?: ClaimedProgramWake;
    readonly event: ProgramEvent;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
  readonly nextEventSequence: (programId: ProgramId) => Effect.Effect<number, ProgramStoreError>;
  readonly events: (
    programId: ProgramId,
  ) => Effect.Effect<ReadonlyArray<ProgramEvent>, ProgramStoreError>;
  readonly finishWake: (input: {
    readonly lease: ClaimedProgramWake;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
}

const decodeProjectionJson = Schema.decodeUnknownSync(Schema.fromJsonString(ProgramProjection));
const decodeAttachmentJson = Schema.decodeUnknownSync(Schema.fromJsonString(ProgramAttachment));
const decodeSnapshotJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      requestId: ProgramRequestId,
      decision: Schema.Struct({
        status: Schema.String,
        code: Schema.String,
        message: Schema.String,
      }),
      projection: ProgramProjection,
    }),
  ),
);
const decodeReceiptJson = Schema.decodeUnknownSync(Schema.fromJsonString(RuntimeReceipt));
const decodeEventJson = Schema.decodeUnknownSync(Schema.fromJsonString(ProgramEvent));

const asStoreError = (operation: string, programId?: ProgramId) => (cause: unknown) =>
  new ProgramStoreError({ operation, ...(programId === undefined ? {} : { programId }), cause });
const isProgramStoreLeaseError = Schema.is(ProgramStoreLeaseError);

function summary(projection: ProgramProjection): ProgramSummary {
  return {
    programId: projection.programId,
    title: projection.title,
    state: projection.state,
    terminal: projection.terminal,
    phaseCount: projection.phases.length,
    activeAgentCount: projection.activeAgentCount,
    lastEventAt: projection.lastEventAt,
  };
}

export const makeProgramStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const verifyLease = (lease: ClaimedProgramWake) =>
    sql<WakeRow>`
      SELECT * FROM program_wakes
      WHERE wake_id = ${lease.wakeId}
        AND status = 'running'
        AND epoch = ${lease.epoch}
        AND lease_owner = ${lease.workerId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(
              new ProgramStoreLeaseError({
                programId: lease.programId,
                wakeId: lease.wakeId,
                epoch: lease.epoch,
              }),
            )
          : Effect.void,
      ),
      Effect.mapError((cause) =>
        isProgramStoreLeaseError(cause)
          ? cause
          : asStoreError("verify_lease", lease.programId)(cause),
      ),
    );

  const load: ProgramStoreShape["load"] = (programId) =>
    sql<ProgramRow>`SELECT * FROM programs WHERE program_id = ${programId}`.pipe(
      Effect.map((rows) => {
        const row = rows[0];
        return row === undefined
          ? Option.none()
          : Option.some({
              attachment: decodeAttachmentJson(row.attachment_json),
              driverKind: row.driver_kind as StartProgramInput["driverKind"],
              projection: decodeProjectionJson(row.projection_json),
            });
      }),
      Effect.mapError(asStoreError("load", programId)),
    );

  const store: ProgramStoreShape = {
    create: (input, projection) =>
      sql`
        INSERT INTO programs (
          program_id, attachment_json, driver_kind, projection_json,
          revision, created_at, updated_at
        ) VALUES (
          ${input.attachment.programId}, ${JSON.stringify(input.attachment)}, ${input.driverKind},
          ${JSON.stringify(projection)}, ${projection.revision},
          ${input.attachment.createdAt}, ${input.attachment.createdAt}
        ) ON CONFLICT(program_id) DO NOTHING
      `.pipe(Effect.asVoid, Effect.mapError(asStoreError("create", input.attachment.programId))),
    load,
    list: sql<ProgramRow>`SELECT * FROM programs ORDER BY updated_at DESC`.pipe(
      Effect.map((rows) => ({
        schemaVersion: 1,
        programs: rows.map((row) => summary(decodeProjectionJson(row.projection_json))),
      })),
      Effect.mapError(asStoreError("list")),
    ),
    beginRequest: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<RequestRow>`
            SELECT * FROM program_requests WHERE request_id = ${input.requestId}
          `;
            const row = rows[0];
            if (row !== undefined) {
              if (
                row.program_id !== input.programId ||
                row.operation !== input.operation ||
                row.input_json !== input.inputJson
              ) {
                return { kind: "conflict" } as const;
              }
              return row.result_json === null
                ? ({ kind: "pending" } as const)
                : ({
                    kind: "completed",
                    snapshot: decodeSnapshotJson(row.result_json) as ProgramSnapshot,
                  } as const);
            }
            yield* sql`
            INSERT INTO program_requests (
              request_id, program_id, operation, input_json, result_json, created_at, updated_at
            ) VALUES (
              ${input.requestId}, ${input.programId}, ${input.operation}, ${input.inputJson},
              NULL, ${input.now}, ${input.now}
            )
          `;
            return { kind: "new" } as const;
          }),
        )
        .pipe(Effect.mapError(asStoreError("begin_request", input.programId))),
    completeRequest: (input) =>
      sql`
        UPDATE program_requests
        SET result_json = COALESCE(result_json, ${JSON.stringify(input.snapshot)}),
            updated_at = ${input.now}
        WHERE request_id = ${input.requestId}
      `.pipe(Effect.asVoid, Effect.mapError(asStoreError("complete_request"))),
    enqueueWake: (input) =>
      sql`
        INSERT INTO program_wakes (
          wake_id, program_id, request_id, cause, status, epoch,
          lease_owner, lease_expires_at, created_at, updated_at
        ) VALUES (
          ${input.wakeId}, ${input.programId}, ${input.requestId}, ${input.cause}, 'pending', 0,
          NULL, NULL, ${input.now}, ${input.now}
        ) ON CONFLICT(wake_id) DO NOTHING
      `.pipe(Effect.asVoid, Effect.mapError(asStoreError("enqueue_wake", input.programId))),
    claimWake: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            if (input.allowTakeover !== true) {
              const active = yield* sql<WakeRow>`
                SELECT * FROM program_wakes
                WHERE program_id = ${input.programId}
                  AND status = 'running'
                  AND lease_expires_at > ${input.now}
                ORDER BY created_at ASC
                LIMIT 1
              `;
              if (active[0] !== undefined) return Option.none<ClaimedProgramWake>();
            }
            const rows = yield* sql<WakeRow>`
              SELECT * FROM program_wakes
              WHERE program_id = ${input.programId}
                AND (
                  status = 'pending'
                  OR (
                    status = 'running'
                    AND (${input.allowTakeover === true ? 1 : 0} = 1 OR lease_expires_at <= ${input.now})
                  )
                )
              ORDER BY created_at ASC
              LIMIT 1
            `;
            const wake = rows[0];
            if (wake === undefined) return Option.none<ClaimedProgramWake>();
            const epoch = wake.epoch + 1;
            yield* sql`
            UPDATE program_wakes
            SET status = 'running', epoch = ${epoch}, lease_owner = ${input.workerId},
                lease_expires_at = ${input.leaseExpiresAt}, updated_at = ${input.now}
            WHERE wake_id = ${wake.wake_id}
          `;
            return Option.some({
              wakeId: ProgramWakeId.make(wake.wake_id),
              programId: ProgramId.make(wake.program_id),
              requestId: ProgramRequestId.make(wake.request_id),
              cause: wake.cause as ProgramWakeCause,
              epoch,
              workerId: input.workerId,
            });
          }),
        )
        .pipe(Effect.mapError(asStoreError("claim_wake", input.programId))),
    saveProjection: (input) =>
      sql
        .withTransaction(
          verifyLease(input.lease).pipe(
            Effect.andThen(
              sql`
              UPDATE programs
              SET projection_json = ${JSON.stringify(input.projection)},
                  revision = ${input.projection.revision}, updated_at = ${input.now}
              WHERE program_id = ${input.lease.programId}
            `,
            ),
            Effect.andThen(
              Effect.forEach(
                input.projection.threadBindings,
                (binding) => sql`
                INSERT INTO program_thread_bindings (
                  program_id, thread_id, role, phase_id, attempt_id, created_at
                ) VALUES (
                  ${input.lease.programId}, ${binding.threadId}, ${binding.role},
                  ${binding.phaseId}, ${binding.attemptId}, ${input.now}
                ) ON CONFLICT(program_id, thread_id, role) DO NOTHING
              `,
                { discard: true },
              ),
            ),
          ),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("save_projection", input.lease.programId)(cause),
          ),
        ),
    saveEffect: (input) =>
      sql
        .withTransaction(
          verifyLease(input.lease).pipe(
            Effect.andThen(sql`
            INSERT INTO program_effects (effect_id, program_id, wake_id, effect_json, created_at)
            VALUES (
              ${input.effect.effectId}, ${input.lease.programId}, ${input.lease.wakeId},
              ${JSON.stringify(input.effect)}, ${input.now}
            ) ON CONFLICT(effect_id) DO NOTHING
          `),
          ),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("save_effect", input.lease.programId)(cause),
          ),
        ),
    receiptByEffect: (effectId) =>
      sql<ReceiptRow>`SELECT receipt_json FROM program_receipts WHERE effect_id = ${effectId}`.pipe(
        Effect.map((rows) =>
          rows[0] === undefined
            ? Option.none()
            : Option.some(decodeReceiptJson(rows[0].receipt_json)),
        ),
        Effect.mapError(asStoreError("receipt_by_effect")),
      ),
    saveReceipt: (input) =>
      sql
        .withTransaction(
          verifyLease(input.lease).pipe(
            Effect.andThen(sql`
            INSERT INTO program_receipts (
              receipt_id, effect_id, program_id, receipt_json, acknowledged_at, created_at
            ) VALUES (
              ${input.receipt.receiptId}, ${input.receipt.effectId}, ${input.receipt.programId},
              ${JSON.stringify(input.receipt)}, NULL, ${input.receipt.createdAt}
            ) ON CONFLICT(effect_id) DO NOTHING
          `),
            Effect.andThen(sql<ReceiptRow>`
            SELECT receipt_json FROM program_receipts WHERE effect_id = ${input.receipt.effectId}
          `),
            Effect.map((rows) => decodeReceiptJson(rows[0]!.receipt_json)),
          ),
        )
        .pipe(
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("save_receipt", input.lease.programId)(cause),
          ),
        ),
    unacknowledgedReceipts: (programId) =>
      sql<ReceiptRow>`
        SELECT receipt_json FROM program_receipts
        WHERE program_id = ${programId} AND acknowledged_at IS NULL
        ORDER BY created_at ASC
      `.pipe(
        Effect.map((rows) => rows.map((row) => decodeReceiptJson(row.receipt_json))),
        Effect.mapError(asStoreError("unacknowledged_receipts", programId)),
      ),
    acknowledgeReceipts: (input) =>
      sql
        .withTransaction(
          verifyLease(input.lease).pipe(
            Effect.andThen(
              Effect.forEach(input.receiptIds, (receiptId) =>
                sql<ReceiptRow>`
                SELECT receipt_json FROM program_receipts WHERE receipt_id = ${receiptId}
              `.pipe(
                  Effect.flatMap((rows) => {
                    const retained = decodeReceiptJson(rows[0]!.receipt_json);
                    const acknowledged = { ...retained, acknowledged: true } as RuntimeReceipt;
                    return sql`
                    UPDATE program_receipts
                    SET receipt_json = ${JSON.stringify(acknowledged)},
                        acknowledged_at = ${input.now}
                    WHERE receipt_id = ${receiptId}
                  `.pipe(Effect.as(acknowledged));
                  }),
                ),
              ),
            ),
          ),
        )
        .pipe(
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("acknowledge_receipts", input.lease.programId)(cause),
          ),
        ),
    appendEvent: (input) => {
      const append = sql`
        INSERT INTO program_events (
          event_id, program_id, sequence, revision, request_id,
          event_type, event_json, occurred_at
        ) VALUES (
          ${input.event.eventId}, ${input.event.programId}, ${input.event.sequence},
          ${input.event.revision}, ${input.event.requestId}, ${input.event.type},
          ${JSON.stringify(input.event)}, ${input.event.occurredAt}
        ) ON CONFLICT(event_id) DO NOTHING
      `;
      const effect =
        input.lease === undefined
          ? append
          : sql.withTransaction(verifyLease(input.lease).pipe(Effect.andThen(append)));
      return effect.pipe(
        Effect.asVoid,
        Effect.mapError((cause) =>
          isProgramStoreLeaseError(cause)
            ? cause
            : asStoreError("append_event", input.event.programId)(cause),
        ),
      );
    },
    nextEventSequence: (programId) =>
      sql<EventSequenceRow>`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
        FROM program_events
        WHERE program_id = ${programId}
      `.pipe(
        Effect.map((rows) => rows[0]?.next_sequence ?? 1),
        Effect.mapError(asStoreError("next_event_sequence", programId)),
      ),
    events: (programId) =>
      sql<EventRow>`
        SELECT event_json
        FROM program_events
        WHERE program_id = ${programId}
        ORDER BY sequence ASC
      `.pipe(
        Effect.map((rows) => rows.map((row) => decodeEventJson(row.event_json))),
        Effect.mapError(asStoreError("list_events", programId)),
      ),
    finishWake: (input) =>
      sql
        .withTransaction(
          verifyLease(input.lease).pipe(
            Effect.andThen(sql`
            UPDATE program_wakes
            SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
                updated_at = ${input.now}
            WHERE wake_id = ${input.lease.wakeId}
          `),
          ),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("finish_wake", input.lease.programId)(cause),
          ),
        ),
  };

  return store;
});
