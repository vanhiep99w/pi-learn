---
name: prisma-workflow
description: Prisma ORM migration workflow — schema changes, migrations, validation, seeding
---

# Prisma Workflow

## Key Commands

```bash
# Create migration from schema changes
npx prisma migrate dev --name <snake_case_name>

# Apply migrations (production)
npx prisma migrate deploy

# Validate schema
npx prisma validate

# Regenerate Prisma Client
npx prisma generate

# View migration status
npx prisma migrate status

# Reset DB (DEV ONLY — deletes all data!)
npx prisma migrate reset --force

# Sync DB → schema (when schema drift occurs)
npx prisma db pull

# Push schema without creating a migration (prototype only)
npx prisma db push
```

## Schema Patterns

### Add optional field (safe)
```prisma
model User {
  id        String   @id
  email     String   @unique
  timezone  String?  // Optional — safe to add
}
```

### Add required field (needs default)
```prisma
model User {
  createdAt DateTime @default(now())  // Default needed for existing rows
}
```

### One-to-many relation
```prisma
model User {
  id    String  @id
  posts Post[]
}

model Post {
  id     String @id
  userId String
  user   User   @relation(fields: [userId], references: [id])
}
```

### Soft delete pattern
```prisma
model User {
  deletedAt DateTime?  // null = active, value = deleted
}
```

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Model | PascalCase | `UserProfile` |
| Field | camelCase | `createdAt` |
| Migration | snake_case | `add_timezone_to_users` |
| Relation table | PascalCase joined | `UserRole` |

## Migration Safety Rules

1. **Add nullable column** → safe
2. **Add NOT NULL column with default** → safe
3. **Add NOT NULL column without default** → must migrate existing data first
4. **Rename column** → create new column, copy data, drop old (3 migrations)
5. **Drop column** → verify no code references it first
6. **Change type** → check compatibility, may need a cast

## Seeding

```typescript
// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { email: "test@example.com" },
    update: {},
    create: { email: "test@example.com", name: "Test User" },
  });
}

main().finally(() => prisma.$disconnect());
```

```bash
npx prisma db seed
```
