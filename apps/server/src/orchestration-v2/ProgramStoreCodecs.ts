import {
  AcceptedOperatorIntent,
  ProgramAttachment,
  ProgramEffect,
  ProgramEvent,
  ProgramEvaluationReport,
  ProgramProjection,
  ProgramRequestId,
  ProgramSnapshot,
  RuntimeReceipt,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const decodeProjectionJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(ProgramProjection),
);
export const decodeAttachmentJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(ProgramAttachment),
);
export const decodeSnapshotJson = Schema.decodeUnknownSync(
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
export const decodeReceiptJson = Schema.decodeUnknownSync(Schema.fromJsonString(RuntimeReceipt));
export const decodeEffectJson = Schema.decodeUnknownSync(Schema.fromJsonString(ProgramEffect));
export const decodeOperatorIntentJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(AcceptedOperatorIntent),
);
export const decodeEventJson = Schema.decodeUnknownSync(Schema.fromJsonString(ProgramEvent));
export const encodeEventJson = Schema.encodeSync(Schema.fromJsonString(ProgramEvent));
export const encodeProjectionJson = Schema.encodeSync(Schema.fromJsonString(ProgramProjection));
export const encodeAttachmentJson = Schema.encodeSync(Schema.fromJsonString(ProgramAttachment));
export const encodeOperatorIntentJson = Schema.encodeSync(
  Schema.fromJsonString(AcceptedOperatorIntent),
);
export const encodeEffectJson = Schema.encodeSync(Schema.fromJsonString(ProgramEffect));
export const encodeReceiptJson = Schema.encodeSync(Schema.fromJsonString(RuntimeReceipt));
export const encodeEvaluationJson = Schema.encodeSync(
  Schema.fromJsonString(ProgramEvaluationReport),
);
export const encodeSnapshotJson = Schema.encodeSync(Schema.fromJsonString(ProgramSnapshot));
