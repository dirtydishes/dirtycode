import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE programs (
      program_id TEXT PRIMARY KEY,
      attachment_json TEXT NOT NULL,
      driver_kind TEXT NOT NULL,
      projection_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE program_events (
      event_id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE(program_id, sequence),
      FOREIGN KEY(program_id) REFERENCES programs(program_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE program_requests (
      request_id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(program_id) REFERENCES programs(program_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE program_wakes (
      wake_id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      cause TEXT NOT NULL,
      operator_intent_json TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed')),
      epoch INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(program_id) REFERENCES programs(program_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE program_effects (
      effect_id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL,
      wake_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      effect_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(program_id) REFERENCES programs(program_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE program_receipts (
      receipt_id TEXT PRIMARY KEY,
      effect_id TEXT NOT NULL UNIQUE,
      program_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      acknowledged_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(program_id) REFERENCES programs(program_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE TABLE program_thread_bindings (
      program_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      phase_id TEXT,
      attempt_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(program_id, thread_id, role),
      FOREIGN KEY(program_id) REFERENCES programs(program_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX program_wakes_claim_idx
    ON program_wakes(program_id, status, lease_expires_at, created_at)
  `;
  yield* sql`
    CREATE INDEX program_events_program_idx
    ON program_events(program_id, sequence)
  `;
});
