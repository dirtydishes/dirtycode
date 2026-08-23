export interface ProgramRow {
  readonly program_id: string;
  readonly attachment_json: string;
  readonly driver_kind: string;
  readonly projection_json: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RequestRow {
  readonly request_id: string;
  readonly program_id: string;
  readonly operation: string;
  readonly input_json: string;
  readonly result_json: string | null;
}

export interface WakeRow {
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

export interface ReceiptRow {
  readonly receipt_json: string;
}

export interface EffectRow {
  readonly effect_json: string;
  readonly revision: number;
  readonly request_id: string;
}

export interface EventRow {
  readonly event_json: string;
}

export interface EventSequenceRow {
  readonly next_sequence: number;
}
