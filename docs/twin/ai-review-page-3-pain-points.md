# AI Review Page 3: Pain Points, Trade-Offs, and Review Questions

Current trade-offs are pragmatic but create refactoring opportunities. IPC is centralized and flexible but weakly typed. Extension route loading uses native `require`, which is powerful but high trust. SQLite JSON text columns keep schema changes easy but weaken queryability and validation. Worker task caching is simple but in-memory and array-based. Renderer provider nesting is explicit but can become hard to test.

Known limitations or fragile areas:

- Bridge payloads and preload methods use `any`.
- `initAllBridges` is a manual list that can drift from feature modules.
- Extension WebUI API handlers execute in-process.
- Token blacklist persistence needs confirmation.
- Directory-size conventions are stricter than the current repo layout.
- Coverage thresholds are currently informational, not protective.
- Build packaging manually includes native/runtime dependencies and excludes risky files; this is easy to break when dependencies change.

Design decisions that make sense: process/preload/renderer boundaries are clear, upload workspace validation prevents path trust bugs, DB recovery avoids replacing healthy DBs on native ABI errors, WebSocket `noServer` avoids Vite HMR failures, and static copy keeps packaged skills/assistants accessible.

## Areas for Review

- Which bridge domains should be converted first to typed schemas?
- Should extension APIs run in a child process/sandbox?
- Which JSON database columns deserve normalization?
- Can package inclusion be generated from runtime dependency analysis?
- What minimum coverage gates should protect auth, database recovery, uploads, and task lifecycle?
