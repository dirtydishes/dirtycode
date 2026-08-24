import {
  ProgramEventId,
  type ProgramEvent,
  type ProgramId,
  type ProgramProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { deliberationPayloadIsValid } from "./ProgramDeliberationValidation.ts";
import { recordProgramDeliberation, recordProgramEvaluation } from "./ProgramProjection.ts";
import {
  decodeProjectionJson,
  encodeEvaluationJson,
  encodeEventJson,
  encodeProjectionJson,
} from "./ProgramStoreCodecs.ts";
import type { EventSequenceRow, ProgramRow } from "./ProgramStoreRows.ts";
import { ProgramStoreError, type ProgramStoreShape } from "./ProgramStoreTypes.ts";

const asStoreError = (operation: string, programId: ProgramId) => (cause: unknown) =>
  new ProgramStoreError({ operation, programId, cause });
const isProgramStoreError = Schema.is(ProgramStoreError);

/** Owns immutable evaluation and deliberation evidence persistence. */
export const makeProgramEvidenceStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const loadProjection = (programId: ProgramId, operation: string, missingCause: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<ProgramRow>`
        SELECT * FROM programs WHERE program_id = ${programId}
      `;
      const row = rows[0];
      if (row === undefined) {
        return yield* new ProgramStoreError({ operation, programId, cause: missingCause });
      }
      return decodeProjectionJson(row.projection_json);
    });

  const nextEventSequence = (programId: ProgramId) =>
    sql<EventSequenceRow>`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM program_events WHERE program_id = ${programId}
    `.pipe(Effect.map((rows) => rows[0]?.next_sequence ?? 1));

  const persistEvent = (event: ProgramEvent, projection: ProgramProjection, now: string) =>
    Effect.gen(function* () {
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
        SET projection_json = ${encodeProjectionJson(projection)},
            revision = ${projection.revision}, updated_at = ${now}
        WHERE program_id = ${event.programId}
      `;
    });

  const recordEvaluation: ProgramStoreShape["recordEvaluation"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const projection = yield* loadProjection(
            input.command.programId,
            "record_evaluation",
            "Program disappeared during evaluation recording.",
          );
          const metrics = input.command.report.metrics;
          if (
            metrics.acceptedTasks > metrics.tasks ||
            metrics.integratedPhases > metrics.tasks ||
            metrics.successfulRecoveries > metrics.injectedCrashes ||
            metrics.activeComputeMillis > metrics.elapsedMillis
          ) {
            return { kind: "conflict", projection } as const;
          }
          const repository = projection.repositorySnapshot;
          if (
            repository === null ||
            projection.graphDigest === null ||
            input.command.report.repositoryId !== repository.repositoryId ||
            input.command.report.startingCommit !== repository.head ||
            input.command.report.taskSetDigest !== projection.graphDigest
          ) {
            return { kind: "conflict", projection } as const;
          }
          const retained = (projection.evaluations ?? []).find(
            (evaluation) => evaluation.evaluationId === input.command.report.evaluationId,
          );
          if (retained !== undefined) {
            return encodeEvaluationJson(retained) === encodeEvaluationJson(input.command.report)
              ? ({ kind: "already_applied", projection } as const)
              : ({ kind: "conflict", projection } as const);
          }
          const retainedCohort = (projection.evaluations ?? []).find(
            (evaluation) => evaluation.cohortId === input.command.report.cohortId,
          );
          if (
            retainedCohort !== undefined &&
            (retainedCohort.fixedInputsDigest !== input.command.report.fixedInputsDigest ||
              retainedCohort.repositoryId !== input.command.report.repositoryId ||
              retainedCohort.startingCommit !== input.command.report.startingCommit ||
              retainedCohort.taskSetDigest !== input.command.report.taskSetDigest)
          ) {
            return { kind: "conflict", projection } as const;
          }
          const event: ProgramEvent = {
            eventId: ProgramEventId.make(
              `program-event:${input.command.programId}:evaluation:${input.command.report.evaluationId}`,
            ),
            programId: input.command.programId,
            sequence: yield* nextEventSequence(input.command.programId),
            revision: projection.revision + 1,
            requestId: input.command.requestId,
            occurredAt: input.now,
            type: "program.evaluation-recorded",
            payload: input.command.report,
          };
          const next = recordProgramEvaluation(projection, event);
          yield* persistEvent(event, next, input.now);
          return { kind: "recorded", projection: next } as const;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isProgramStoreError(cause)
            ? cause
            : asStoreError("record_evaluation", input.command.programId)(cause),
        ),
      );

  const recordDeliberation: ProgramStoreShape["recordDeliberation"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const projection = yield* loadProjection(
            input.command.programId,
            "record_deliberation",
            "Program disappeared during deliberation recording.",
          );
          if (!deliberationPayloadIsValid(projection, input.command.payload)) {
            return { kind: "conflict", projection } as const;
          }
          const eventId = ProgramEventId.make(
            `program-event:${input.command.programId}:deliberation:${input.command.requestId}`,
          );
          if (
            (projection.deliberations ?? []).some((deliberation) =>
              deliberation.entries.some((entry) => entry.eventId === eventId),
            )
          ) {
            return { kind: "already_applied", projection } as const;
          }
          const event: ProgramEvent = {
            eventId,
            programId: input.command.programId,
            sequence: yield* nextEventSequence(input.command.programId),
            revision: projection.revision + 1,
            requestId: input.command.requestId,
            occurredAt: input.now,
            type: "program.deliberation-recorded",
            payload: input.command.payload,
          };
          const next = recordProgramDeliberation(projection, event);
          yield* persistEvent(event, next, input.now);
          return { kind: "recorded", projection: next } as const;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isProgramStoreError(cause)
            ? cause
            : asStoreError("record_deliberation", input.command.programId)(cause),
        ),
      );

  return { recordEvaluation, recordDeliberation };
});
