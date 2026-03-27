---
name: owasp-checklist
description: OWASP Top 10 security checklist for code review — injection, auth, data exposure, XSS
---

# OWASP Security Checklist

## A01 — Broken Access Control

- [ ] API endpoints check authorization (not just authentication)
- [ ] Users can only view/edit their own data (IDOR check)
- [ ] Admin routes have middleware guards
- [ ] Directory listing disabled
- [ ] CORS configured correctly (no `*` on production)

```typescript
// ❌ Vulnerable
app.get("/users/:id/data", auth, async (req) => {
  return db.user.findUnique({ where: { id: req.params.id } });
});

// ✅ Safe
app.get("/users/:id/data", auth, async (req) => {
  if (req.user.id !== req.params.id && !req.user.isAdmin) {
    throw new ForbiddenError();
  }
  return db.user.findUnique({ where: { id: req.params.id } });
});
```

## A02 — Cryptographic Failures

- [ ] Passwords hashed with bcrypt/argon2 (NOT md5/sha1)
- [ ] HTTPS enforced (HSTS header)
- [ ] Sensitive data not logged
- [ ] Tokens have sufficient entropy (crypto.randomBytes, not Math.random)
- [ ] Secrets not hardcoded in source

```typescript
// ❌ Vulnerable
const hash = md5(password);
const token = Math.random().toString(36);

// ✅ Safe
const hash = await bcrypt.hash(password, 12);
const token = crypto.randomBytes(32).toString("hex");
```

## A03 — Injection

- [ ] SQL: parameterized queries or ORM (no string concatenation)
- [ ] NoSQL: validate operators, don't pass user input directly into queries
- [ ] Shell: no exec with user input; use array args, not strings
- [ ] LDAP, XPath: sanitize inputs

```typescript
// ❌ SQL Injection
db.query(`SELECT * FROM users WHERE email = '${email}'`);

// ✅ Safe (parameterized)
db.query("SELECT * FROM users WHERE email = $1", [email]);

// ❌ Command Injection
exec(`convert ${userFile} output.pdf`);

// ✅ Safe
execFile("convert", [userFile, "output.pdf"]);
```

## A04 — Insecure Design

- [ ] Rate limiting on auth endpoints (login, register, password reset)
- [ ] Account lockout after N failed attempts
- [ ] Password reset tokens have expiry
- [ ] Sensitive operations require re-authentication

## A05 — Security Misconfiguration

- [ ] Default credentials changed
- [ ] Unnecessary features/endpoints disabled
- [ ] Error messages don't expose stack traces
- [ ] Security headers: CSP, X-Frame-Options, X-Content-Type-Options

```typescript
// Security headers (helmet.js)
app.use(helmet());
app.use(helmet.contentSecurityPolicy({ directives: { defaultSrc: ["'self'"] } }));
```

## A07 — Authentication Failures

- [ ] JWT: algorithm explicitly set (`HS256`/`RS256`), not `none`
- [ ] JWT expiry is short (access: 15m, refresh: 7d)
- [ ] Refresh token rotation + revocation list
- [ ] OAuth: state parameter validated, redirect URI whitelisted
- [ ] Session ID regenerated after login

```typescript
// ❌ JWT vulnerable
jwt.verify(token, secret); // Does not check algorithm

// ✅ Safe
jwt.verify(token, secret, { algorithms: ["HS256"] });
```

## A08 — Software & Data Integrity

- [ ] Dependencies: `npm audit` — no HIGH/CRITICAL CVEs
- [ ] CI/CD pipeline does not expose secrets
- [ ] Subresource Integrity for external scripts

## A09 — Logging Failures

- [ ] Auth events logged (login success/fail, password reset)
- [ ] Sensitive data NOT in logs (password, token, PII)
- [ ] Logs include timestamp + user ID + IP

## Severity Mapping

| Finding | Severity |
|---------|---------|
| SQL/Command injection | HIGH |
| Broken auth / JWT none alg | HIGH |
| Missing authorization check | HIGH |
| Hardcoded secrets | HIGH |
| Missing rate limiting | MEDIUM |
| Missing security headers | LOW |
| Verbose error messages | LOW |
