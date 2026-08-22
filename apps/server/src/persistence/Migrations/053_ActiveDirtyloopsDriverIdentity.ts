import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE programs
    SET driver_kind = 'dirtyloops'
    WHERE driver_kind = 'dirtyloops_readonly'
  `;
});
