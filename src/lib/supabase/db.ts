import type { createAdminClient } from "./admin";

/**
 * Every HiRAGe client is bound to the `hirage` schema, which makes its type
 * distinct from a default `SupabaseClient`. Deriving the alias from the factory
 * keeps the two in step: change the schema in one place and every helper that
 * accepts a client follows.
 */
export type Db = ReturnType<typeof createAdminClient>;
