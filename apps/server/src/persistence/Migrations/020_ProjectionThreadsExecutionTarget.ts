import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (columns.some((column) => column.name === "execution_target_json")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN execution_target_json TEXT NOT NULL DEFAULT '{"kind":"local"}'
  `;

  yield* sql`
    UPDATE projection_threads
    SET execution_target_json = '{"kind":"local"}'
    WHERE execution_target_json IS NULL OR trim(execution_target_json) = ''
  `;
});
