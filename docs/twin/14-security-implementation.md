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

## Areas for Review

- Sandbox extension execution.
- Validate every IPC/HTTP payload with Zod.
- Require HTTPS/trusted proxy settings for remote mode.
- Add upload scanning/quarantine policy.
