import {
  AcceptedOperatorIntent,
  ProgramAttachment,
  ProgramDriverDecision,
  ProgramEffect,
  ProgramEffectId,
  ProgramEvent,
  ProgramId,
  ProgramListSnapshot,
  ProgramProjection,
  ProgramReceiptId,
  RecordProgramDeliberationInput,
  RecordProgramEvaluationInput,
  ProgramRequestId,
  ProgramSnapshot,
  ProgramWakeCause,
  ProgramWakeId,
  RuntimeReceipt,
  StartProgramInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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

export type ProgramEvaluationRecordResult =
  | { readonly kind: "recorded"; readonly projection: ProgramProjection }
  | { readonly kind: "already_applied"; readonly projection: ProgramProjection }
  | { readonly kind: "conflict"; readonly projection: ProgramProjection };

export type ProgramDeliberationRecordResult =
  | { readonly kind: "recorded"; readonly projection: ProgramProjection }
  | { readonly kind: "already_applied"; readonly projection: ProgramProjection }
  | { readonly kind: "conflict"; readonly projection: ProgramProjection };

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
  readonly recordEvaluation: (input: {
    readonly command: RecordProgramEvaluationInput;
    readonly now: string;
  }) => Effect.Effect<ProgramEvaluationRecordResult, ProgramStoreError>;
  readonly recordDeliberation: (input: {
    readonly command: RecordProgramDeliberationInput;
    readonly now: string;
  }) => Effect.Effect<ProgramDeliberationRecordResult, ProgramStoreError>;
  readonly events: (
    programId: ProgramId,
  ) => Effect.Effect<ReadonlyArray<ProgramEvent>, ProgramStoreError>;
  readonly finishWake: (input: {
    readonly lease: ClaimedProgramWake;
    readonly snapshot: ProgramSnapshot;
    readonly now: string;
  }) => Effect.Effect<void, ProgramStoreError | ProgramStoreLeaseError>;
}
