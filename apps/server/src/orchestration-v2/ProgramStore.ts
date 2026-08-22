import {
  AcceptedOperatorIntent,
  ProgramAttachment,
  type ProgramDriverDecision,
  ProgramEffect,
  ProgramEffectId,
  ProgramEvent,
  ProgramEventId,
  ProgramId,
  type ProgramListSnapshot,
  ProgramProjection,
  ProgramReceiptId,
  ProgramRequestId,
  ProgramSnapshot,
  summarizeProgramProjection,
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
  readonly operator_intent_json: string | null;
  readonly status: "pending" | "running" | "completed";
  readonly epoch: number;
  readonly lease_owner: string | null;
  readonly lease_expires_at: string | null;
  readonly available_at: string;
}

interface ReceiptRow {
  readonly receipt_json: string;
}

interface EffectRow {
  readonly effect_json: string;
  readonly revision: number;
  readonly request_id: string;
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
  readonly operatorIntent: AcceptedOperatorIntent | null;
  readonly epoch: number;
  readonly workerId: string;
}

export interface PendingProgramWake {
  readonly requestId: ProgramRequestId;
  readonly availableAt: string;
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
  readonly requestSnapshot: (
    requestId: ProgramRequestId,
  ) => Effect.Effect<Option.Option<ProgramSnapshot>, ProgramStoreError>;
  readonly enqueueWake: (input: {
    readonly wakeId: ProgramWakeId;
    readonly programId: ProgramId;
    readonly requestId: ProgramRequestId;
    readonly cause: ProgramWakeCause;
    readonly operatorIntent: AcceptedOperatorIntent | null;
    readonly now: string;
    readonly availableAt?: string;
  }) => Effect.Effect<void, ProgramStoreError>;
  readonly claimWake: (input: {
    readonly programId: ProgramId;
    readonly workerId: string;
    readonly now: string;
    readonly leaseExpiresAt: string;
  }) => Effect.Effect<Option.Option<ClaimedProgramWake>, ProgramStoreError>;
  readonly nextPendingRequestId: (
    programId: ProgramId,
    now: string,
  ) => Effect.Effect<Option.Option<ProgramRequestId>, ProgramStoreError>;
  readonly nextPendingWake: (
    programId: ProgramId,
  ) => Effect.Effect<Option.Option<PendingProgramWake>, ProgramStoreError>;
  readonly activeLeaseExpiresAt: (
    programId: ProgramId,
  ) => Effect.Effect<Option.Option<string>, ProgramStoreError>;
  readonly assertLease: (input: {
    readonly lease: ClaimedProgramWake;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
  readonly saveProjection: (input: {
    readonly lease: ClaimedProgramWake;
    readonly projection: ProgramProjection;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
  readonly saveDecision: (input: {
    readonly lease: ClaimedProgramWake;
    readonly decision: ProgramDriverDecision;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
  readonly incompleteEffects: (programId: ProgramId) => Effect.Effect<
    ReadonlyArray<{
      readonly effect: ProgramEffect;
      readonly programRevision: number;
      readonly requestId: ProgramRequestId;
    }>,
    ProgramStoreError
  >;
  readonly receiptByEffect: (
    effectId: ProgramEffectId,
  ) => Effect.Effect<Option.Option<RuntimeReceipt>, ProgramStoreError>;
  readonly saveReceipt: (input: {
    readonly lease: ClaimedProgramWake;
    readonly receipt: RuntimeReceipt;
    readonly now: string;
  }) => Effect.Effect<RuntimeReceipt, ProgramStoreError | ProgramStoreLeaseError>;
  readonly unacknowledgedReceipts: (
    programId: ProgramId,
  ) => Effect.Effect<ReadonlyArray<RuntimeReceipt>, ProgramStoreError>;
  readonly receipts: (
    programId: ProgramId,
  ) => Effect.Effect<ReadonlyArray<RuntimeReceipt>, ProgramStoreError>;
  readonly acknowledgeReceipts: (input: {
    readonly lease: ClaimedProgramWake;
    readonly receiptIds: ReadonlyArray<ProgramReceiptId>;
    readonly now: string;
  }) => Effect.Effect<ReadonlyArray<RuntimeReceipt>, ProgramStoreError | ProgramStoreLeaseError>;
  readonly events: (
    programId: ProgramId,
  ) => Effect.Effect<ReadonlyArray<ProgramEvent>, ProgramStoreError>;
  readonly finishWake: (input: {
    readonly lease: ClaimedProgramWake;
    readonly snapshot: ProgramSnapshot;
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
const decodeEffectJson = Schema.decodeUnknownSync(Schema.fromJsonString(ProgramEffect));
const decodeOperatorIntentJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(AcceptedOperatorIntent),
);
const decodeEventJson = Schema.decodeUnknownSync(Schema.fromJsonString(ProgramEvent));
const encodeEventJson = Schema.encodeSync(Schema.fromJsonString(ProgramEvent));
const encodeProjectionJson = Schema.encodeSync(Schema.fromJsonString(ProgramProjection));
const encodeAttachmentJson = Schema.encodeSync(Schema.fromJsonString(ProgramAttachment));
const encodeOperatorIntentJson = Schema.encodeSync(Schema.fromJsonString(AcceptedOperatorIntent));
const encodeEffectJson = Schema.encodeSync(Schema.fromJsonString(ProgramEffect));
const encodeReceiptJson = Schema.encodeSync(Schema.fromJsonString(RuntimeReceipt));
const encodeSnapshotJson = Schema.encodeSync(Schema.fromJsonString(ProgramSnapshot));

const asStoreError = (operation: string, programId?: ProgramId) => (cause: unknown) =>
  new ProgramStoreError({ operation, ...(programId === undefined ? {} : { programId }), cause });
const isProgramStoreLeaseError = Schema.is(ProgramStoreLeaseError);

export const makeProgramStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const verifyLease = (lease: ClaimedProgramWake, now: string) =>
    sql<WakeRow>`
      SELECT * FROM program_wakes
      WHERE wake_id = ${lease.wakeId}
        AND status = 'running'
        AND epoch = ${lease.epoch}
        AND lease_owner = ${lease.workerId}
        AND lease_expires_at > ${now}
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
              driverKind: (row.driver_kind === "dirtyloops_readonly"
                ? "dirtyloops"
                : row.driver_kind) as StartProgramInput["driverKind"],
              projection: decodeProjectionJson(row.projection_json),
            });
      }),
      Effect.mapError(asStoreError("load", programId)),
    );

  const store: ProgramStoreShape = {
    create: (input, projection) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO programs (
                program_id, attachment_json, driver_kind, projection_json,
                revision, created_at, updated_at
              ) VALUES (
                ${input.attachment.programId}, ${encodeAttachmentJson(input.attachment)},
                ${input.driverKind}, ${encodeProjectionJson(projection)}, ${projection.revision},
                ${input.attachment.createdAt}, ${input.attachment.createdAt}
              ) ON CONFLICT(program_id) DO NOTHING
            `;
            const event: ProgramEvent = {
              eventId: ProgramEventId.make(`program-event:${input.attachment.programId}:started`),
              programId: input.attachment.programId,
              sequence: 1,
              revision: projection.revision,
              requestId: input.requestId,
              occurredAt: input.attachment.createdAt,
              type: "program.started",
              payload: { attachment: input.attachment, projection },
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${event.eventId}, ${event.programId}, ${event.sequence}, ${event.revision},
                ${event.requestId}, ${event.type}, ${encodeEventJson(event)}, ${event.occurredAt}
              ) ON CONFLICT(event_id) DO NOTHING
            `;
          }),
        )
        .pipe(Effect.asVoid, Effect.mapError(asStoreError("create", input.attachment.programId))),
    load,
    list: sql<ProgramRow>`SELECT * FROM programs ORDER BY updated_at DESC`.pipe(
      Effect.map((rows) => ({
        schemaVersion: 1,
        programs: rows.map((row) =>
          summarizeProgramProjection(decodeProjectionJson(row.projection_json)),
        ),
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
        SET result_json = COALESCE(result_json, ${encodeSnapshotJson(input.snapshot)}),
            updated_at = ${input.now}
        WHERE request_id = ${input.requestId}
      `.pipe(Effect.asVoid, Effect.mapError(asStoreError("complete_request"))),
    requestSnapshot: (requestId) =>
      sql<RequestRow>`
        SELECT * FROM program_requests WHERE request_id = ${requestId}
      `.pipe(
        Effect.map((rows) =>
          rows[0]?.result_json === null || rows[0]?.result_json === undefined
            ? Option.none()
            : Option.some(decodeSnapshotJson(rows[0].result_json) as ProgramSnapshot),
        ),
        Effect.mapError(asStoreError("request_snapshot")),
      ),
    enqueueWake: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO program_wakes (
                wake_id, program_id, request_id, cause, operator_intent_json, status, epoch,
                lease_owner, lease_expires_at, available_at, created_at, updated_at
              ) VALUES (
                ${input.wakeId}, ${input.programId}, ${input.requestId}, ${input.cause},
                ${input.operatorIntent === null ? null : encodeOperatorIntentJson(input.operatorIntent)},
                'pending', 0, NULL, NULL, ${input.availableAt ?? input.now}, ${input.now}, ${input.now}
              ) ON CONFLICT(wake_id) DO NOTHING
            `;
            const sequenceRows = yield* sql<EventSequenceRow>`
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM program_events WHERE program_id = ${input.programId}
            `;
            const revisionRows = yield* sql<{ readonly revision: number }>`
              SELECT revision FROM programs WHERE program_id = ${input.programId}
            `;
            const event: ProgramEvent = {
              eventId: ProgramEventId.make(`program-event:${input.wakeId}:enqueued`),
              programId: input.programId,
              sequence: sequenceRows[0]?.next_sequence ?? 1,
              revision: revisionRows[0]?.revision ?? 0,
              requestId: input.requestId,
              occurredAt: input.now,
              type: "program.wake-enqueued",
              payload: { wakeId: input.wakeId, cause: input.cause },
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${event.eventId}, ${event.programId}, ${event.sequence}, ${event.revision},
                ${event.requestId}, ${event.type}, ${encodeEventJson(event)}, ${event.occurredAt}
              ) ON CONFLICT(event_id) DO NOTHING
            `;
          }),
        )
        .pipe(Effect.asVoid, Effect.mapError(asStoreError("enqueue_wake", input.programId))),
    claimWake: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const activeRows = yield* sql<WakeRow>`
              SELECT * FROM program_wakes
              WHERE program_id = ${input.programId}
                AND status = 'running'
                AND lease_expires_at > ${input.now}
              ORDER BY created_at ASC
              LIMIT 1
            `;
            if (activeRows[0] !== undefined) return Option.none<ClaimedProgramWake>();
            const rows = yield* sql<WakeRow>`
              SELECT * FROM program_wakes
              WHERE program_id = ${input.programId}
                AND (
                  (status = 'pending' AND available_at <= ${input.now})
                  OR (status = 'running' AND lease_expires_at <= ${input.now})
                )
              ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, created_at ASC
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
            const sequenceRows = yield* sql<EventSequenceRow>`
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM program_events WHERE program_id = ${input.programId}
            `;
            const revisionRows = yield* sql<{ readonly revision: number }>`
              SELECT revision FROM programs WHERE program_id = ${input.programId}
            `;
            const event: ProgramEvent = {
              eventId: ProgramEventId.make(`program-event:${wake.wake_id}:claimed:${epoch}`),
              programId: input.programId,
              sequence: sequenceRows[0]?.next_sequence ?? 1,
              revision: revisionRows[0]?.revision ?? 0,
              requestId: ProgramRequestId.make(wake.request_id),
              occurredAt: input.now,
              type: "program.wake-claimed",
              payload: {
                wakeId: ProgramWakeId.make(wake.wake_id),
                epoch,
                workerId: input.workerId,
              },
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${event.eventId}, ${event.programId}, ${event.sequence}, ${event.revision},
                ${event.requestId}, ${event.type}, ${encodeEventJson(event)}, ${event.occurredAt}
              ) ON CONFLICT(event_id) DO NOTHING
            `;
            return Option.some({
              wakeId: ProgramWakeId.make(wake.wake_id),
              programId: ProgramId.make(wake.program_id),
              requestId: ProgramRequestId.make(wake.request_id),
              cause: wake.cause as ProgramWakeCause,
              operatorIntent:
                wake.operator_intent_json === null
                  ? null
                  : decodeOperatorIntentJson(wake.operator_intent_json),
              epoch,
              workerId: input.workerId,
            });
          }),
        )
        .pipe(Effect.mapError(asStoreError("claim_wake", input.programId))),
    nextPendingRequestId: (programId, now) =>
      sql<WakeRow>`
        SELECT * FROM program_wakes
        WHERE program_id = ${programId} AND status = 'pending' AND available_at <= ${now}
        ORDER BY created_at ASC
        LIMIT 1
      `.pipe(
        Effect.map((rows) =>
          rows[0] === undefined
            ? Option.none()
            : Option.some(ProgramRequestId.make(rows[0].request_id)),
        ),
        Effect.mapError(asStoreError("next_pending_request", programId)),
      ),
    nextPendingWake: (programId) =>
      sql<WakeRow>`
        SELECT * FROM program_wakes
        WHERE program_id = ${programId} AND status = 'pending'
        ORDER BY available_at ASC, created_at ASC
        LIMIT 1
      `.pipe(
        Effect.map((rows) =>
          rows[0] === undefined
            ? Option.none()
            : Option.some({
                requestId: ProgramRequestId.make(rows[0].request_id),
                availableAt: rows[0].available_at,
              }),
        ),
        Effect.mapError(asStoreError("next_pending_wake", programId)),
      ),
    activeLeaseExpiresAt: (programId) =>
      sql<WakeRow>`
        SELECT * FROM program_wakes
        WHERE program_id = ${programId} AND status = 'running'
        ORDER BY lease_expires_at ASC
        LIMIT 1
      `.pipe(
        Effect.map((rows) => Option.fromNullishOr(rows[0]?.lease_expires_at)),
        Effect.mapError(asStoreError("active_lease_expiry", programId)),
      ),
    assertLease: (input) => verifyLease(input.lease, input.now),
    saveDecision: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* verifyLease(input.lease, input.now);
            const sequenceRows = yield* sql<EventSequenceRow>`
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM program_events WHERE program_id = ${input.lease.programId}
            `;
            const sequence = sequenceRows[0]?.next_sequence ?? 1;
            const event: ProgramEvent = {
              eventId: ProgramEventId.make(
                `program-event:${input.lease.wakeId}:decision:${input.decision.programRevision}`,
              ),
              programId: input.lease.programId,
              sequence,
              revision: input.decision.programRevision,
              requestId: input.lease.requestId,
              occurredAt: input.now,
              type: "program.decision-recorded",
              payload: input.decision,
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${event.eventId}, ${event.programId}, ${event.sequence}, ${event.revision},
                ${event.requestId}, ${event.type}, ${encodeEventJson(event)}, ${event.occurredAt}
              ) ON CONFLICT(event_id) DO NOTHING
            `;
            if (input.decision.kind === "effects") {
              yield* Effect.forEach(
                input.decision.effects,
                (effect, index) =>
                  Effect.gen(function* () {
                    yield* sql`
                      INSERT INTO program_effects (
                        effect_id, program_id, wake_id, revision, request_id,
                        effect_json, created_at
                      ) VALUES (
                        ${effect.effectId}, ${input.lease.programId}, ${input.lease.wakeId},
                        ${input.decision.programRevision}, ${input.lease.requestId},
                        ${encodeEffectJson(effect)}, ${input.now}
                      ) ON CONFLICT(effect_id) DO NOTHING
                    `;
                    const effectEvent: ProgramEvent = {
                      eventId: ProgramEventId.make(`program-event:${effect.effectId}:proposed`),
                      programId: input.lease.programId,
                      sequence: sequence + index + 1,
                      revision: input.decision.programRevision,
                      requestId: input.lease.requestId,
                      occurredAt: input.now,
                      type: "program.effect-proposed",
                      payload: effect,
                    };
                    yield* sql`
                      INSERT INTO program_events (
                        event_id, program_id, sequence, revision, request_id,
                        event_type, event_json, occurred_at
                      ) VALUES (
                        ${effectEvent.eventId}, ${effectEvent.programId},
                        ${effectEvent.sequence}, ${effectEvent.revision},
                        ${effectEvent.requestId}, ${effectEvent.type},
                        ${encodeEventJson(effectEvent)}, ${effectEvent.occurredAt}
                      ) ON CONFLICT(event_id) DO NOTHING
                    `;
                  }),
                { discard: true },
              );
            }
          }),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("save_decision", input.lease.programId)(cause),
          ),
        ),
    saveProjection: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* verifyLease(input.lease, input.now);
            const sequenceRows = yield* sql<EventSequenceRow>`
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM program_events
              WHERE program_id = ${input.lease.programId}
            `;
            const sequence = sequenceRows[0]?.next_sequence ?? 1;
            const event: ProgramEvent = {
              eventId: ProgramEventId.make(
                `program-event:${input.lease.programId}:projection:${sequence}`,
              ),
              programId: input.lease.programId,
              sequence,
              revision: input.projection.revision,
              requestId: input.lease.requestId,
              occurredAt: input.now,
              type: "program.projection-saved",
              payload: input.projection,
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${event.eventId}, ${event.programId}, ${event.sequence}, ${event.revision},
                ${event.requestId}, ${event.type}, ${encodeEventJson(event)}, ${event.occurredAt}
              )
            `;
            yield* sql`
              UPDATE programs
              SET projection_json = ${encodeProjectionJson(input.projection)},
                  revision = ${input.projection.revision}, updated_at = ${input.now}
              WHERE program_id = ${input.lease.programId}
            `;
            yield* Effect.forEach(
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
            );
          }),
        )
        .pipe(
          Effect.asVoid,
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("save_projection", input.lease.programId)(cause),
          ),
        ),
    incompleteEffects: (programId) =>
      sql<EffectRow>`
        SELECT effects.effect_json, effects.revision, effects.request_id
        FROM program_effects effects
        LEFT JOIN program_receipts receipts ON receipts.effect_id = effects.effect_id
        WHERE effects.program_id = ${programId} AND receipts.receipt_id IS NULL
        ORDER BY effects.created_at ASC
      `.pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            effect: decodeEffectJson(row.effect_json),
            programRevision: row.revision,
            requestId: ProgramRequestId.make(row.request_id),
          })),
        ),
        Effect.mapError(asStoreError("incomplete_effects", programId)),
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
          Effect.gen(function* () {
            yield* verifyLease(input.lease, input.now);
            yield* sql`
              INSERT INTO program_receipts (
                receipt_id, effect_id, program_id, receipt_json, acknowledged_at, created_at
              ) VALUES (
                ${input.receipt.receiptId}, ${input.receipt.effectId}, ${input.receipt.programId},
                ${encodeReceiptJson(input.receipt)}, NULL, ${input.receipt.createdAt}
              ) ON CONFLICT(effect_id) DO NOTHING
            `;
            const rows = yield* sql<ReceiptRow>`
              SELECT receipt_json FROM program_receipts WHERE effect_id = ${input.receipt.effectId}
            `;
            const retained = decodeReceiptJson(rows[0]!.receipt_json);
            const followUpRequestId = ProgramRequestId.make(
              `request:effect-receipt:${retained.effectId}`,
            );
            const followUpWakeId = ProgramWakeId.make(
              `wake:${input.lease.programId}:effect-receipt:${retained.effectId}`,
            );
            yield* sql`
              INSERT INTO program_wakes (
                wake_id, program_id, request_id, cause, operator_intent_json, status, epoch,
                lease_owner, lease_expires_at, available_at, created_at, updated_at
              ) VALUES (
                ${followUpWakeId}, ${input.lease.programId}, ${followUpRequestId},
                'effect_receipt', NULL, 'pending', 0, NULL, NULL,
                ${input.now}, ${input.now}, ${input.now}
              ) ON CONFLICT(wake_id) DO NOTHING
            `;
            const sequenceRows = yield* sql<EventSequenceRow>`
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM program_events WHERE program_id = ${input.lease.programId}
            `;
            const event: ProgramEvent = {
              eventId: ProgramEventId.make(`program-event:${retained.receiptId}:recorded`),
              programId: input.lease.programId,
              sequence: sequenceRows[0]?.next_sequence ?? 1,
              revision: retained.programRevision,
              requestId: input.lease.requestId,
              occurredAt: retained.createdAt,
              type: "program.receipt-recorded",
              payload: retained,
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${event.eventId}, ${event.programId}, ${event.sequence}, ${event.revision},
                ${event.requestId}, ${event.type}, ${encodeEventJson(event)}, ${event.occurredAt}
              ) ON CONFLICT(event_id) DO NOTHING
            `;
            const followUpSequenceRows = yield* sql<EventSequenceRow>`
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM program_events WHERE program_id = ${input.lease.programId}
            `;
            const followUpEvent: ProgramEvent = {
              eventId: ProgramEventId.make(`program-event:${followUpWakeId}:enqueued`),
              programId: input.lease.programId,
              sequence: followUpSequenceRows[0]?.next_sequence ?? event.sequence + 1,
              revision: retained.programRevision,
              requestId: followUpRequestId,
              occurredAt: input.now,
              type: "program.wake-enqueued",
              payload: { wakeId: followUpWakeId, cause: "effect_receipt" },
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${followUpEvent.eventId}, ${followUpEvent.programId}, ${followUpEvent.sequence},
                ${followUpEvent.revision}, ${followUpEvent.requestId}, ${followUpEvent.type},
                ${encodeEventJson(followUpEvent)}, ${followUpEvent.occurredAt}
              ) ON CONFLICT(event_id) DO NOTHING
            `;
            const permit =
              retained.kind === "bind_prepared_worktree"
                ? retained.identity
                : retained.kind === "launch_owner_attempt"
                  ? retained.identity.preparedWorktree
                  : null;
            if (permit !== null) {
              const timerRequestId = ProgramRequestId.make(
                `request:lease-expired:${permit.leaseId}:${permit.leaseEpoch}`,
              );
              const timerWakeId = ProgramWakeId.make(
                `wake:${input.lease.programId}:lease-expired:${permit.leaseId}:${permit.leaseEpoch}`,
              );
              yield* sql`
                INSERT INTO program_wakes (
                  wake_id, program_id, request_id, cause, operator_intent_json, status, epoch,
                  lease_owner, lease_expires_at, available_at, created_at, updated_at
                ) VALUES (
                  ${timerWakeId}, ${input.lease.programId}, ${timerRequestId},
                  'timer', NULL, 'pending', 0, NULL, NULL,
                  ${permit.expiresAt}, ${input.now}, ${input.now}
                ) ON CONFLICT(wake_id) DO NOTHING
              `;
              const timerSequenceRows = yield* sql<EventSequenceRow>`
                SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
                FROM program_events WHERE program_id = ${input.lease.programId}
              `;
              const timerEvent: ProgramEvent = {
                eventId: ProgramEventId.make(`program-event:${timerWakeId}:enqueued`),
                programId: input.lease.programId,
                sequence: timerSequenceRows[0]?.next_sequence ?? followUpEvent.sequence + 1,
                revision: retained.programRevision,
                requestId: timerRequestId,
                occurredAt: input.now,
                type: "program.wake-enqueued",
                payload: { wakeId: timerWakeId, cause: "timer" },
              };
              yield* sql`
                INSERT INTO program_events (
                  event_id, program_id, sequence, revision, request_id,
                  event_type, event_json, occurred_at
                ) VALUES (
                  ${timerEvent.eventId}, ${timerEvent.programId}, ${timerEvent.sequence},
                  ${timerEvent.revision}, ${timerEvent.requestId}, ${timerEvent.type},
                  ${encodeEventJson(timerEvent)}, ${timerEvent.occurredAt}
                ) ON CONFLICT(event_id) DO NOTHING
              `;
            }
            return retained;
          }),
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
    receipts: (programId) =>
      sql<ReceiptRow>`
        SELECT receipt_json FROM program_receipts
        WHERE program_id = ${programId}
        ORDER BY created_at ASC
      `.pipe(
        Effect.map((rows) => rows.map((row) => decodeReceiptJson(row.receipt_json))),
        Effect.mapError(asStoreError("receipts", programId)),
      ),
    acknowledgeReceipts: (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* verifyLease(input.lease, input.now);
            const acknowledged = yield* Effect.forEach(input.receiptIds, (receiptId) =>
              sql<ReceiptRow>`
                SELECT receipt_json FROM program_receipts WHERE receipt_id = ${receiptId}
              `.pipe(
                Effect.flatMap((rows) => {
                  const retained = decodeReceiptJson(rows[0]!.receipt_json);
                  const next = { ...retained, acknowledged: true } as RuntimeReceipt;
                  return sql`
                    UPDATE program_receipts
                    SET receipt_json = ${encodeReceiptJson(next)}, acknowledged_at = ${input.now}
                    WHERE receipt_id = ${receiptId}
                  `.pipe(Effect.as(next));
                }),
              ),
            );
            const sequenceRows = yield* sql<EventSequenceRow>`
              SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
              FROM program_events WHERE program_id = ${input.lease.programId}
            `;
            const event: ProgramEvent = {
              eventId: ProgramEventId.make(
                `program-event:${input.lease.wakeId}:receipts-acknowledged:${input.lease.epoch}`,
              ),
              programId: input.lease.programId,
              sequence: sequenceRows[0]?.next_sequence ?? 1,
              revision: acknowledged.at(-1)?.programRevision ?? 0,
              requestId: input.lease.requestId,
              occurredAt: input.now,
              type: "program.receipts-acknowledged",
              payload: { receiptIds: acknowledged.map((receipt) => receipt.receiptId) },
            };
            yield* sql`
              INSERT INTO program_events (
                event_id, program_id, sequence, revision, request_id,
                event_type, event_json, occurred_at
              ) VALUES (
                ${event.eventId}, ${event.programId}, ${event.sequence}, ${event.revision},
                ${event.requestId}, ${event.type}, ${encodeEventJson(event)}, ${event.occurredAt}
              )
            `;
            return acknowledged;
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            isProgramStoreLeaseError(cause)
              ? cause
              : asStoreError("acknowledge_receipts", input.lease.programId)(cause),
          ),
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
          Effect.gen(function* () {
            yield* verifyLease(input.lease, input.now);
            yield* sql`
              UPDATE program_wakes
              SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
                  updated_at = ${input.now}
              WHERE wake_id = ${input.lease.wakeId}
            `;
            yield* sql`
              UPDATE program_requests
              SET result_json = COALESCE(result_json, ${encodeSnapshotJson(input.snapshot)}),
                  updated_at = ${input.now}
              WHERE request_id = ${input.lease.requestId}
            `;
          }),
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
