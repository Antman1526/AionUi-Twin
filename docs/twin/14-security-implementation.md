# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Existing Controls

Electron uses contextBridge; WebUI uses bcrypt, JWT cookies, rate limits, token blacklist, QR tokens, upload path validation, filename sanitization, extension root path checks, and credential encryption helpers. Builder excludes risky unsigned native/vendor binaries.

```ts
function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normalizedTarget = path.resolve(targetPath);
  const normalizedRoot = path.resolve(rootPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}
```

Known risks to verify: generic preload bridge payloads, in-process extension `require`, token blacklist persistence, remote WebUI HTTPS/proxy handling, arbitrary remote file upload content, and consistent encryption for all provider/channel secrets.

## Local Model Security Boundary

The local model loader is deliberately constrained:

- it accepts only paths under configured model directories;
- it binds `llama-server` to `127.0.0.1`;
- it registers a no-key provider only for a loopback OpenAI-compatible endpoint;
- it removes the managed provider when the managed process stops;
- it never overwrites manually configured providers.

This avoids using IPC as a generic process launcher and avoids leaking the local
model server onto the network. Remaining risks are mostly operational: a malicious
GGUF file or compromised `llama-server` binary is outside the app's direct
control, and the app currently trusts the `llama-server` executable found on the
host.

## Areas for Review

- Sandbox extension execution.
- Validate every IPC/HTTP payload with Zod.
- Require HTTPS/trusted proxy settings for remote mode.
- Add upload scanning/quarantine policy.
- Display the resolved `llama-server` executable path before first local model launch.
