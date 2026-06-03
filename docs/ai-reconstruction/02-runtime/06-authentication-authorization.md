# 06 - Authentication & Authorization System

## Auth model

The WebUI server authenticates users with username/password, bcrypt password hashes, JWT session tokens, secure cookies, QR login tokens, and middleware-enforced protected routes. Electron desktop still uses the same renderer auth context so WebUI and desktop behavior stay aligned.

## User table fields

`users` contains `id`, unique `username`, optional `email`, `password_hash`, optional `avatar_path`, `jwt_secret`, timestamps, and `last_login`. A system user `system_default_user` is inserted on database initialization.

## Password hashing and token generation

Source: `src/process/webserver/auth/service/AuthService.ts:44`

```typescript
  new Promise((resolve, reject) => {
    bcrypt.compare(password, hash, (error, same) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(same);
    });
  });

const DUMMY_BCRYPT_PASSWORD = 'aionui-auth-dummy-password';
const DUMMY_BCRYPT_HASH = '$2a$12$s5cKddFA1hp06nhAubmZa.eT3/xT9Bmve36cul7fZ6ch2mz9EITDu';

/**
 * 认证服务 - 提供密码哈希、Token 生成与验证等能力
 * Authentication Service - handles password hashing, token issuance, and validation
 */
export class AuthService {
  private static readonly SALT_ROUNDS = 12;
  private static jwtSecret: string | null = null;
  private static readonly TOKEN_EXPIRY = AUTH_CONFIG.TOKEN.SESSION_EXPIRY;

  /**
   * Token 黑名单 - 存储已登出的 token（内存存储，重启后清空）
   * Token blacklist - stores logged out tokens (in-memory, cleared on restart)
   * Key: token 的 SHA-256 哈希, Value: 过期时间戳
   */
  private static tokenBlacklist: Map<string, number> = new Map();
  private static readonly BLACKLIST_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  private static blacklistCleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 将 token 加入黑名单（登出时调用）
   * Add token to blacklist (called on logout)
   */
  public static blacklistToken(token: string): void {
    // 使用 token 的哈希作为 key，避免存储原始 token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 解析 token 获取过期时间
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      const expiry = decoded?.exp ? decoded.exp * 1000 : Date.now() + AUTH_CONFIG.TOKEN.COOKIE_MAX_AGE;
      this.tokenBlacklist.set(tokenHash, expiry);

      // 启动清理定时器（如果还没启动）
      this.startBlacklistCleanup();
    } catch {
      // 即使解析失败，也加入黑名单（使用默认过期时间）
      this.tokenBlacklist.set(tokenHash, Date.now() + AUTH_CONFIG.TOKEN.COOKIE_MAX_AGE);
    }
  }

  /**
   * 检查 token 是否在黑名单中
   * Check if token is blacklisted
   */
  public static isTokenBlacklisted(token: string): boolean {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiry = this.tokenBlacklist.get(tokenHash);

    if (!expiry) {
      return false;
    }

    // 如果已过期，从黑名单移除
    if (Date.now() > expiry) {
      this.tokenBlacklist.delete(tokenHash);
      return false;
    }

    return true;
  }
```

Key parameters:

- bcrypt salt rounds: 12.
- JWT secret source priority: `JWT_SECRET` env var, database `users.jwt_secret`, newly generated 64-byte random hex secret.
- Token payload: `userId`, `username`, random `tokenId`.
- JWT issuer: `aionui`.
- JWT audience: `aionui-webui`.
- Logout blacklist key: SHA-256 hash of raw token, with expiry cleanup every 1 hour.

## Constant-time protections

Login for missing users calls dummy bcrypt verification to reduce timing attacks. Token blacklist stores hashes, not raw tokens.

## Token extraction

Source: `src/process/webserver/auth/middleware/TokenMiddleware.ts:22`

```typescript

/**
 * Token 提取器 - 从请求中提取认证 token
 * Token Extractor - Extract authentication token from request
 *
 * 安全说明：不再支持从 URL query 参数提取 token，避免 token 通过日志、Referrer 等泄露
 * Security: URL query token is no longer supported to prevent token leakage via logs, Referrer, etc.
 */
class TokenExtractor {
  /**
   * 从请求中提取 token，支持以下来源：
   * 1. Authorization header (Bearer token)
   * 2. Cookie (aionui-session)
   *
   * Extract token from request, supporting these sources:
   * 1. Authorization header (Bearer token)
   * 2. Cookie (aionui-session)
   *
   * @param req - Express 请求对象 / Express request object
   * @returns Token 字符串或 null / Token string or null
   */
  static extract(req: Request): string | null {
    // 1. 尝试从 Authorization header 提取 / Try to extract from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // 2. 尝试从 Cookie 提取 / Try to extract from Cookie
    if (typeof req.cookies === 'object' && req.cookies) {
      const cookieToken = req.cookies[AUTH_CONFIG.COOKIE.NAME];
      if (typeof cookieToken === 'string' && cookieToken.trim() !== '') {
        return cookieToken;
      }
    }

    // 不再支持从 URL query 参数提取 token（安全风险）
    // URL query token is no longer supported (security risk)

    return null;
  }
}

/**
 * 验证策略接口 - 定义未授权处理方式
```

Supported sources:

1. `Authorization: Bearer <token>`.
2. Cookie named by `AUTH_CONFIG.COOKIE.NAME` (`aionui-session` in current code path).
3. WebSocket-only fallback: first `sec-websocket-protocol` value.

URL query token extraction is intentionally unsupported to prevent token leakage through logs/referrers.

## Middleware rules

Source: `src/process/webserver/auth/middleware/AuthMiddleware.ts:32`

```typescript
   * CORS middleware for development
   */
  public static corsMiddleware(req: Request, res: Response, next: NextFunction): void {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  }

  /**
   * 安全响应头中间件
   * Security headers middleware
   */
  public static securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
    // 防止点击劫持
    // Prevent clickjacking
    res.header('X-Frame-Options', SECURITY_CONFIG.HEADERS.FRAME_OPTIONS);

    // 防止 MIME 类型嗅探
    // Prevent MIME type sniffing
    res.header('X-Content-Type-Options', SECURITY_CONFIG.HEADERS.CONTENT_TYPE_OPTIONS);

    // 启用 XSS 保护
    // Enable XSS protection
    res.header('X-XSS-Protection', SECURITY_CONFIG.HEADERS.XSS_PROTECTION);

    // Referrer 策略
    // Referrer policy
    res.header('Referrer-Policy', SECURITY_CONFIG.HEADERS.REFERRER_POLICY);

    // 内容安全策略（开发环境放宽限制以支持 webpack-dev-server）
    // Content Security Policy (relaxed in development for webpack-dev-server)
    const isDevelopment = process.env.NODE_ENV === 'development';
    const cspPolicy = isDevelopment ? SECURITY_CONFIG.HEADERS.CSP_DEV : SECURITY_CONFIG.HEADERS.CSP_PROD;

    res.header('Content-Security-Policy', cspPolicy);

    next();
  }

  /**
   * 请求日志中间件
   * Request logging middleware
   */
  public static requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
    // Only log API requests; skip Vite module / static asset requests to reduce noise
    const url = req.url;
    if (!url.startsWith('/api/') && !url.startsWith('/login')) {
      next();
      return;
    }

    const start = Date.now();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
```

- Security headers include X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, and CSP.
- Login inputs require string username/password, username length <= 32, password length <= 128.
- Registration/password changes use `AuthService.validateUsername` and `validatePasswordStrength`.

## QR login

`GET /qr-login` returns static HTML. JavaScript reads `token` from URL, posts it to `/api/auth/qr-login`, and uses DOM `textContent` for dynamic errors to avoid XSS.

## Authorization boundaries

- All `/api/directory`, upload, STT, extension asset, proxy, generic API, and most channel helper routes use `TokenMiddleware.validateToken`.
- Extension-contributed API routes default to auth unless the extension route config explicitly sets `auth: false`.
- WebSocket upgrades must supply a valid token via cookie, Authorization header, or subprotocol.

## Edge cases

- If `JWT_SECRET` changes between runs, existing tokens are invalidated.
- Token blacklist is in-memory, so logout invalidation is lost on restart; persisted JWT secret rotation handles global invalidation.
- QR login validates client IP/local-network restrictions in `verifyQRTokenDirect`.
- Remote mode cookie options differ from local mode via `getCookieOptions(req)`.

## Areas for Review

- Should token blacklist be persisted to SQLite for restart-safe logout semantics?
- Should CSP be tightened separately for desktop and WebUI production?
- Should QR login tokens be represented as database records instead of direct bridge-managed state?
