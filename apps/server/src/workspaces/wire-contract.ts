/**
 * Compile-time bridge between server reply values and the shared API-contract
 * schemas in `@repo/shared`. These are type-only helpers — zero runtime cost.
 *
 * Two unavoidable, safe deltas exist between a raw service reply and the wire
 * contract the client validates:
 *   1. Date columns are `Date` in the service but ISO strings once Fastify's
 *      JSON serializer runs — {@link Serialized} models that.
 *   2. Enum columns (`role`, `status`) are typed `string` in the DB layer but
 *      constrained to the literal union by DB CHECK constraints, so the server
 *      type is legitimately wider than the schema's union.
 *
 * {@link WireContract} therefore asserts *presence and compatible kind* of every
 * field the client requires, tolerating those two deltas and ignoring extra
 * server fields (the client's zod schema strips them). A dropped/renamed field
 * or a genuine kind change surfaces as a type error naming the offending key.
 */

/** A server reply value as it appears on the wire (Date → ISO string). */
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

/** Element type of an array, or the type itself when not an array. */
export type Elem<T> = T extends (infer U)[] ? U : T;

/**
 * Maps every key the `Schema` requires to `true` when the serialized `Reply`
 * carries a compatible value, or an error tuple naming the key otherwise.
 * Union the results and feed to {@link AssertWire}.
 */
export type WireContract<Reply, Schema> = {
  [K in keyof Schema]-?: K extends keyof Serialized<Reply>
    ? Schema[K] extends Serialized<Reply>[K]
      ? true
      : Serialized<Reply>[K] extends Schema[K]
        ? true
        : ['field type mismatch', K]
    : ['missing field', K];
}[keyof Schema];

/** Compiles only when the `WireContract` holds (every field resolved to `true`). */
export type AssertWire<T extends true> = T;
