# AionUi Twin Technical Reconstruction Notes

These notes are source-grounded documentation for `/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. They are written for another AI or engineer that needs to reconstruct, audit, optimize, or refactor the project without rereading every source file. Secrets and private credentials are intentionally excluded.

## Auth Model

WebUI auth uses SQLite users, bcrypt password hashes, JWT cookies, rate limiting, token blacklist on logout, and QR login tokens. Desktop IPC is trusted through Electron preload while WebUI/mobile access goes through Express auth middleware.

Default admin bootstrap generates a random password if no system/admin password exists, hashes it, stores it, and displays it once in console alongside QR login.

Protected routes generally follow this stack:

```ts
app.post(
  '/api/auth/change-password',
  apiRateLimiter,
  AuthMiddleware.authenticateToken,
  authenticatedActionLimiter,
  async (req, res) => {
    /* validate and update password */
  }
);
```

QR login HTML avoids embedding user input. On failed JSON responses it uses `textContent`, not `innerHTML`, for dynamic error strings.

Authorization boundaries: extension API routes default to authenticated, static extension assets are path-checked but public, WebUI remote mode changes cookie/security concerns, and desktop IPC remains broader trust.

## Areas for Review

- Persist JWT blacklist or rotate per-user secrets on logout/password change.
- Bind QR tokens to origin/IP/device metadata.
- Add capability checks for high-risk IPC actions used from shared desktop/WebUI renderer code.
