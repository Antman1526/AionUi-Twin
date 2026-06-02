# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Patterns

Startup logs elapsed timing for storage, extension registry, and channel manager. Extension/channel init failures do not block app boot. DB initialization distinguishes native module errors from corruption, backs up corrupted DB files, removes WAL/SHM, and retries. Web route wrappers convert async handler errors to Express middleware.

```ts
function wrapRouteHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
```

Auth hides missing-user vs bad-password differences. Task cleanup kills all managers and waits for asynchronous process cleanup. Sentry is available when configured; performance debug scripts and flags exist for ACP/startup diagnostics.

## Areas for Review

- Replace console logging with structured logs and request/task IDs.
- Show startup/service health in UI.
- Replace fixed cleanup sleeps with explicit task cleanup promises.
