---
name: typescript-contracts
description: Design or change TypeScript domain models, component and module contracts, runtime validation, and browser/server boundaries. Use for typed data flow or external input handling; preserve the host's strictness, schema library, and import conventions.
---

# TypeScript contracts

Inspect the existing domain types, TypeScript configuration, serialization format,
and validation layer first. Extend the current contract where possible. Keep this
guidance portable: it does not require React, a schema library, a specific runtime,
or a particular directory structure.

## Model meaningful states

- Give exported functions, component props, and module boundaries clear contracts.
  Infer straightforward local values; don't add aliases or generics that only make
  the same information harder to find.
- Use discriminated unions for mutually exclusive states or commands. Put each
  variant's required fields on that variant so a caller cannot construct an
  impossible combination of optional fields and flags.
- Keep independently varying concerns separate. A request's pending state and a
  record's domain status may coexist; they need not become one giant union.
- Narrow a union before reading variant-specific fields. Use exhaustive handling
  where adding a variant without updating a consumer would produce incorrect
  behavior. An untrusted unknown variant still needs a runtime error path.
- Distinguish absence from meaningful empty or zero values. Preserve the domain's
  difference between a missing field, an explicit `null`, an empty string, and
  `false`; don't replace them all with a truthiness default.
- Use generics to preserve a relationship between inputs and outputs. Prefer a
  concrete union or ordinary function when callers do not need that relationship.

See [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)
for discriminants and exhaustive handling.

## Validate where data enters

Treat JSON, storage, files, messages, and network responses as untrusted runtime
values. A type annotation or assertion changes what the compiler believes; it
does not establish that the received value matches the contract.

1. Bound the input before expensive parsing when the format or transport can be
   large. Payload size, collection length, and string limits are separate from
   type correctness.
2. Parse and validate with the host's existing schema or explicit validation
   functions. Decide deliberately how unknown fields, absent values, and malformed
   data are handled. Don't silently coerce values unless the contract calls for it.
3. Convert transport data into the domain representation at a clear boundary.
   Keep validation errors distinguishable from operational failures so callers
   can offer the appropriate recovery.

Reuse a schema's inferred type when that is the established pattern. Otherwise,
keep the validator and declared contract aligned through meaningful boundary tests.
Avoid creating two independent definitions that drift as fields change.

Validation does not replace authorization, origin checks, or path containment.
Validated strings may still be unsafe to render as HTML or use as commands. Keep
those checks with the operation that needs them.

## Assertions and ownership

- Prefer `unknown` and narrowing over `any`. Keep unavoidable third-party `any`
  behind a small adapter so it does not spread through the domain model.
- Don't use non-null assertions or double casts to hide a missing state. When an
  assertion is necessary, keep it close to the boundary and state the invariant
  that establishes it. Fix the source contract when the same cast keeps recurring.
- Treat readonly types as an ownership promise, not as runtime freezing. Copy or
  normalize mutable external values when the receiving layer must own them.
- Preserve meaningful error details without making every caller parse a message
  string. Use existing error types or a discriminated result when different
  outcomes require different handling.

## Keep runtime boundaries explicit

- Put contracts used by browser and server in a browser-safe shared module.
  Filesystem, process, secret, and server framework dependencies belong behind
  server boundaries. A type-only import is not a reason to house a shared model
  in a server module.
- Use `import type` for type-only dependencies and follow the host's extension
  and module-resolution conventions. Avoid a barrel that mixes browser-safe
  contracts with server runtime exports.
- Model the serialized representation honestly. Dates, class instances, maps,
  and `undefined` may not survive the chosen transport unchanged; decode them
  explicitly rather than asserting the response is the in-memory model.
- Treat persisted and public contract changes as compatibility changes. Check
  existing readers and old saved data; prefer a deliberate migration or versioned
  decoder over assuming every consumer updates at once.

Run the host's typecheck and focused boundary tests. Verify valid, malformed, and
older supported inputs when changing a decoder. Do not add runtime tests solely
to prove a TypeScript annotation or repeat the implementation's property checks.
