---
name: docs-style-guide
description: Documentation style guide — README format, TSDoc conventions, markdown patterns
---

# Documentation Style Guide

## README Structure

```markdown
# Project Name

One-line description.

## Quick Start

```bash
npm install
npm run dev
```

## Installation

Prerequisites, detailed setup.

## Usage

Common use cases with code examples.

## API Reference

Auto-generated or manual API docs.

## Contributing

How to contribute.
```

## TSDoc / JSDoc Conventions

### Functions

```typescript
/**
 * Authenticates a user and returns a JWT token.
 *
 * @param email - User's email address
 * @param password - Plain text password (compared against stored hash)
 * @returns JWT access token valid for 15 minutes
 * @throws {UnauthorizedError} When credentials are invalid
 * @throws {RateLimitError} When too many attempts within 15 minutes
 *
 * @example
 * const token = await login("user@example.com", "password123");
 * // Returns: "eyJhbGci..."
 */
async function login(email: string, password: string): Promise<string>
```

### Classes

```typescript
/**
 * Manages user sessions with automatic refresh.
 *
 * @example
 * const manager = new SessionManager({ ttl: 3600 });
 * await manager.create(userId);
 */
class SessionManager
```

### Types/Interfaces

```typescript
/** Configuration options for the auth module */
interface AuthConfig {
  /** JWT secret key — minimum 32 characters */
  secret: string;
  /** Access token TTL in seconds (default: 900) */
  ttl?: number;
}
```

## Markdown Patterns

### Code blocks — always specify language
````markdown
```typescript
const x = 1;
```
````

### Tables — use for comparisons
```markdown
| Option | Default | Description |
|--------|---------|-------------|
| `ttl`  | `900`   | Token expiry in seconds |
```

### Callouts
```markdown
> **Note:** Important information
> **Warning:** Potential issue
> **Tip:** Best practice suggestion
```

## File Naming

| Type | Convention | Example |
|------|-----------|---------|
| ADR | `NNNN-title-kebab.md` | `0001-use-prisma.md` |
| Guide | `TOPIC_GUIDE.md` | `AUTH_GUIDE.md` |
| README | `README.md` | — |
| Changelog | `CHANGELOG.md` | — |

## Tone & Style

- **Active voice**: "Creates a user" (not "A user is created")
- **Present tense**: "Returns the token" (not "Will return")
- **Second person**: "You can configure..." (not "One can configure")
- **Concise**: Avoid "In order to", "It should be noted that"
- **Examples**: Every non-trivial API needs at least 1 `@example`
