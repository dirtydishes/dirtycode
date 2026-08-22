import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE program_wakes
    ADD COLUMN available_at TEXT
  `;
  yield* sql`
    UPDATE program_wakes
    SET available_at = created_at
    WHERE available_at IS NULL
  `;
  yield* sql`
    CREATE INDEX program_wakes_available_idx
    ON program_wakes(program_id, status, available_at, created_at)
  `;
});
