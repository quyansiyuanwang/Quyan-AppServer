# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js backend API built with Express, TypeScript, and Prisma ORM. Uses TSOA for code-first OpenAPI specification generation and follows a 3-layer architecture pattern (Controller-Service-Repository).

## First-Time Setup

For initial project setup:

1. **Install dependencies**: `pnpm install`
2. **Configure environment**: `cp .env.sample .env` and edit database credentials
3. **Initialize database**:

   ```bash
   pnpm run db:generate  # Generate Prisma client
   pnpm run db:push      # Push schema to database
   pnpm run db:seed      # Seed initial data (creates admin user)
   ```

4. **Start development**: `pnpm run dev`
5. **Access Swagger UI**: `http://localhost:10001/docs`

Default admin credentials after seeding: Check `prisma/seed.ts` for details.

## Common Commands

### Development

```bash
pnpm run dev              # Start development server with hot reload (nodemon + tsx)
pnpm run tsx              # Run TypeScript directly without build
pnpm run check            # Type check without emitting files
pnpm run format           # Format code with Prettier
pnpm run lint             # ESLint with auto-fix
pnpm run lint-format-check # Combined lint, format, and type check
```

### Building

```bash
pnpm run build            # Standard build: type check, generate Prisma client, compile with esbuild
pnpm run build:tsc        # Alternative build using TypeScript compiler (slower)
pnpm run build:prod       # Production build with NODE_ENV=production
```

### Running

```bash
pnpm run start            # Start the built application from dist/
pnpm run start:watch      # Start with nodemon watching dist/ for changes
```

### Testing

```bash
pnpm run test             # Run all tests once
pnpm run test:watch       # Run tests in watch mode
pnpm run test:ui          # Open Vitest UI
pnpm run test:coverage    # Generate coverage report
```

### Database (Prisma)

```bash
pnpm run db:generate           # Generate Prisma client
pnpm run db:push               # Push schema changes to database (dev)
pnpm run db:migrate            # Run migrations (production)
pnpm run db:migrate:dev        # Create and run new migration
pnpm run db:migrate:reset      # Reset database and run all migrations
pnpm run db:migrate:reset-seed # Reset database, run migrations, and seed
pnpm run db:seed               # Seed database with initial data
```

### OpenAPI/Swagger

```bash
pnpm run tsoa:spec-and-routes  # Generate OpenAPI spec and routes (runs pre-build)
pnpm run openapi:generate      # Generate TypeScript types from OpenAPI spec
```

Access Swagger UI at `http://localhost:10001/docs` when server is running.
Get raw OpenAPI JSON at `http://localhost:10001/docs/openapi.json`.

## Architecture Overview

### 3-Layer Pattern

**Controllers** (`src/api/controllers/`)

- Handle HTTP requests/responses using `@tsoa` decorators
- Use `@Route`, `@Get`, `@Post`, `@Security("jwt")`, `@Response` for OpenAPI documentation
- Controllers automatically generate routes and OpenAPI specs
- Example: `AuthController`, `UserController`

**Services** (`src/services/`)

- Contain business logic
- Instantiate and orchestrate repositories
- Example: `AuthService` (handles login, token generation), `UserService` (user operations)

**Repositories** (`src/store/`)

- Data access layer wrapping Prisma ORM
- Use singleton pattern with `getInstance()` method
- Example: `UserRepository`

### Route System

**All routes are auto-generated from TSOA controller decorators:**

1. Define endpoints in controllers with decorators (`@Get`, `@Post`, etc.)
2. Run `pnpm run tsoa:spec-and-routes` (happens automatically in `prebuild` script)
3. Generated routes appear in `build/routes.ts`
4. `RegisterRoutes(app)` in `src/app.ts` registers all routes automatically

**There are NO manual route files.** All endpoints are defined through TSOA controllers.

**Special case:** Swagger UI page (`/docs`) is registered directly in `app.ts` because it requires special middleware (`swagger-ui-express`). The OpenAPI JSON endpoint (`/docs/openapi.json`) is a normal TSOA controller endpoint.

### Authentication

**JWT-based authentication with access + refresh tokens:**

- Access tokens: Short-lived (default 5 seconds in dev)
- Refresh tokens: Long-lived (default 28800 seconds / 8 hours in dev)
- Token utilities: `util/auth/index.ts` (`JWTAccessIns`, `JWTRefreshIns`)
- Production recommendation: Set `JWT_ACCESS_EXPIRES_IN=900` (15 min), `JWT_REFRESH_EXPIRES_IN=604800` (7 days)

**Security Schemes:**

The codebase supports multiple security schemes for different use cases:

- `"jwt"`: Standard JWT authentication (most common)
- `"local-or-jwt"`: Allows local requests (from localhost) to bypass authentication in development

**Using TSOA Security Decorator:**

```typescript
@Security("jwt")
@Get("/protected")
public async getProtected(@Request() request: express.Request) {
  const userId = request.user.userId; // Available after auth
}
```

**Auth implementation:**

- `middleware/auth/auth_guard.ts:expressAuthentication()`: TSOA security handler
- Tokens extracted from `Authorization: Bearer <token>` header
- Use `@Security("jwt")` decorator on any controller method that requires authentication

**Special Token Types:**

- `reurl:` prefix: Temporary URL tokens for one-time access (managed by ReURLService)
- `rlt_` prefix: Relay tokens for API proxy access (managed by RelayTokenService)

### Permission System

**RBAC (Role-Based Access Control) with flexible permission model:**

Permission calculation formula:

```plain
Final Permissions = Group Permissions + Added Permissions - Removed Permissions
```

- Users inherit permissions from their Group
- Additional permissions can be granted to individual users
- Specific permissions can be revoked from individual users

**Permission Decorators** (`util/permission/permission-decorator.ts`):

Use `@CheckPermission` decorator on controller methods to enforce permissions:

```typescript
// Single permission required
@CheckPermission(Permission.USER_CREATE, PermissionCheckMode.ALL, "jwt")
public async createUser() { ... }

// All permissions required (AND logic)
@CheckPermission([Permission.USER_UPDATE, Permission.USER_DELETE], PermissionCheckMode.ALL, "jwt")
public async modifyUser() { ... }

// Any permission required (OR logic)
@CheckPermission([Permission.USER_READ, Permission.USER_LIST], PermissionCheckMode.ANY, "jwt")
public async getUsers() { ... }
```

**Permission enum** (`constant/permission.ts`):

All permissions are defined in the `Permission` enum with format `resource:action`:

- User management: `USER_CREATE`, `USER_READ`, `USER_UPDATE`, `USER_DELETE`
- Group management: `GROUP_CREATE`, `GROUP_READ`, `GROUP_UPDATE`, `GROUP_DELETE`
- System management: `SYSTEM_CONFIG`, `SYSTEM_STATS_READ`, `SYSTEM_LOG_READ`
- And more...

**Important**: Permission decorators must be used with `@Security("jwt")` to ensure user context is available.

### Error Handling

**Custom error classes** (`util/errors.ts`):

- `BadRequestError` (400)
- `UnauthorizedError` (401)
- `ForbiddenError` (403)
- `NotFoundError` (404)
- `ValidationError` (422)
- `InternalServerError` (500)

**Usage:**

```typescript
throw new NotFoundError("User not found");
throw new UnauthorizedError("Invalid token");
```

All errors are caught by `exceptionMiddleware` and formatted consistently with custom codes.

### Response Format

All API responses follow this structure:

```typescript
{
  code: number,      // Custom status code (0 = success, 1001+ = errors)
  message: string,
  data?: T
}
```

Use `SuccessResponse<T>` interface from `api/response.ts` for type safety.

### Data Transfer Objects (DTOs)

Located in `src/api/dto/`:

- Define request/response interfaces
- Use TSOA validation decorators: `@minLength`, `@maxLength`, `@pattern`, `@isEmail`
- Automatically generate OpenAPI schema

Example:

```typescript
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
}
```

### Path Aliases

Configured in `tsconfig.json`:

```typescript
import { User } from "@src/store/user";
import logger from "@src/util/logger";
// @src/* → src/*
// @logs/* → logs/*
// @public/* → public/*
```

Note: `tsc-alias` resolves these at build time.

### Database Models

Prisma schema in `prisma/schema.prisma`:

- **User**: Authentication entity with username/password, linked to Group
- **Group**: Role-based permissions system
- **IPBlackList**: IP blocking for security
- **APILog**: Request logging

All models include:

- `id`: CUID primary key
- `status`: Soft delete flag (1 = active)
- `createTime`, `updateTime`: Timestamps

### Middleware Chain

Applied in `src/app.ts`:

1. CORS configuration (allows all origins with `*`)
2. `urlTokenExtractor`: Converts URL `?token=` parameter to Authorization header
3. `requestIdMiddleware`: Adds unique request ID (UUID)
4. `loggingMiddleware`: Logs requests with timing
5. `responseWrapperMiddleware`: Wraps all responses in `{code, message, data}` format
6. `errorTrackerMiddleware`: Tracks IP errors and auto-bans
7. `ipBlacklistCheckMiddleware`: Blocks banned IPs
8. `streamingMiddleware`: Handles streaming responses
9. `RegisterRoutes(app)`: TSOA-generated routes
10. Swagger UI setup (if swagger.json exists)
11. 404 handler
12. `exceptionMiddleware`: Catches all errors

### Key Services

Important singleton services in `src/services/`:

- **RedisService**: Caching and session management (singleton pattern)
- **LogService**: API request logging to database
- **SystemService**: System stats and uptime tracking
- **RelayProxyService**: AI model API proxying with token tracking and usage logging
- **PermissionService**: User permission calculation and validation
- **RateLimiterService**: Rate limiting for API endpoints
- **IPBlacklistService**: IP blocking and auto-ban management

All services use singleton pattern - access via `ServiceName.getInstance()`.

### Logging System

**Logger Decorator:**

- Use `@LogRoute()` decorator for automatic request/response logging in controllers
- Import: `import { LogRoute } from "@/util/logger-decorator"`
- Place after `@Get/@Post/@Put/@Delete` decorators
- Options: `{ message, category, logRequest, logResponse, level }`
- Example: `@LogRoute({ message: "获取用户", logResponse: true })`

**Log Content Truncation:**

- All loggers auto-truncate long content via `LOG_TRUNCATE_CONFIG`
- Config in `src/util/logger.ts`: `maxFieldLength`, `maxContextLength`, `enabled`
- Manual truncation: `truncateContent(data, maxLength)` from `@/util/logger-decorator`
- Truncated logs show `...<truncated> [原长:X]` suffix

**API Log Search:**

- Fuzzy search across logs: `APILogRepository.getInstance().query({ search: "keyword" })`
- Searches: path, requestID, ipAddress, queryParams, bodyParams
- API endpoint: `GET /system/logs?search=keyword`

## Development Workflow

### Adding a New Endpoint

1. **Create/update controller** in `src/api/controllers/`:

   ```typescript
   @Route("users")
   export class UserController extends Controller {
     @Get("{userId}")
     @Security("jwt")
     public async getUser(@Path() userId: string) {
       // Implementation
     }
   }
   ```

2. **Define DTOs** in `src/api/dto/` if needed

3. **Implement service logic** in `src/services/`

4. **Implement repository methods** in `src/store/` if database access needed

5. **Build to regenerate routes**:

   ```bash
   pnpm run build  # Regenerates routes + OpenAPI spec
   ```

6. **Test endpoint** at Swagger UI (`/docs`)

### Modifying Database Schema

1. **Edit** `prisma/schema.prisma`

2. **Generate migration** (development):

   ```bash
   pnpm run db:migrate:dev  # Creates migration and applies it
   ```

3. **Apply migration** (production):

   ```bash
   pnpm run db:migrate  # Runs pending migrations
   ```

4. **Regenerate Prisma client**:

   ```bash
   pnpm run db:generate
   ```

### Testing1

- Tests use Vitest + Supertest for API testing
- Place tests in `tests/` directory
- Import supertest and create test app:

  ```typescript
  import request from "supertest";
  import { createApp } from "@src/app";

  const app = createApp();
  ```

- Tests run sequentially (no parallelism) to avoid database conflicts
- Use separate test database: Configure `.env.test` with test database URL
- Test environment automatically loads `.env.test` instead of `.env`

## Important Notes

- **All routes via TSOA**: There are NO manual route files (`src/api/routes/` has been removed). All API endpoints must be defined as TSOA controller methods.
- **OpenAPI generation is automatic**: Routes and specs regenerate on every build via `prebuild` hook
- **Repository singleton pattern**: Always use `Repository.getInstance()`, never `new Repository()`
- **Password hashing**: Currently uses MD5 (see `util/crypto.ts`) - consider upgrading to bcrypt for production
- **Token expiry times**: Very short in development (5s access, 28800s refresh) - adjust in production via environment variables
- **Build output**: esbuild compiles to `dist/index.cjs` (CommonJS format)
- **External dependencies**: Prisma client, Sharp, and native modules are marked as external in esbuild config
- **Precommit checks**: Run `pnpm run precommit` before committing to execute: Prisma generation, OpenAPI generation, lint, format, and type-check
