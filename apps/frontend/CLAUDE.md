# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

```bash
pnpm run dev              # Start dev server (Vite)
pnpm run prod             # Start dev server in production mode
pnpm run preview          # Preview production build locally
pnpm run build            # Type-check + production build
pnpm run build-only       # Production build without type-check
pnpm run build:prod       # Type-check + production build (prod mode)
pnpm run build-only:prod  # Production build without type-check (prod mode)
pnpm run build:full:prod  # Regenerate API client + full production build
pnpm run type-check       # Run vue-tsc type checking
pnpm run lint             # ESLint with auto-fix
pnpm run format           # Prettier formatting
pnpm run lint-format-check # Lint + format + type-check (full validation)
pnpm run precommit        # Full pre-commit validation (API gen + permissions + lint + format + type-check)

# API client generation (requires backend running at localhost:10001)
pnpm run openapi:generate  # Regenerate OpenAPI client + generate constants/types
pnpm run client:generate   # Generate API constants and type mappings only

# Validation (run from repo root)
pnpm run validate:permissions # Validate permission constants against backend
```

## Environment Requirements

- **Node.js**: `^20.19.0 || >=22.12.0`
- **Backend**: Must be running at `http://localhost:10001` for API client generation

## Architecture Overview

### Tech Stack

- **Vue 3** (Composition API) + **TypeScript** + **Vite** (rolldown-vite - faster Rolldown bundler)
- **Pinia** for state management
- **Vue Router** (HTML5 history mode)
- **Vue-i18n** for internationalization (en, zh-CN)
- **Element Plus** UI library (auto-imported)
- **Axios** with JWT token management
- **@hey-api/openapi-ts** for API client generation
- **Zod** for data validation
- **@tanstack/vue-query** for async state management
- **@vueuse/core** for Vue composition utilities

### Directory Structure (`src/`)

| Directory     | Purpose                                                        |
| ------------- | -------------------------------------------------------------- |
| `client/`     | **Auto-generated** OpenAPI client - DO NOT EDIT manually       |
| `stores/`     | Pinia stores (request, theme, i18n, progress bar, etc.)        |
| `service/`    | Business logic (auth: login, logout, token refresh)            |
| `views/`      | Page components organized by feature (auth/, home/, settings/) |
| `layouts/`    | Layout components (HomeFrameLayout, AsideMenu)                 |
| `components/` | Shared reusable components                                     |
| `locales/`    | i18n translation files                                         |
| `utils/`      | Utility functions (EventBus, encryption, debounce)             |
| `types/`      | TypeScript type definitions                                    |
| `constants/`  | Event types, storage keys, patterns, request config            |
| `config/`     | App configuration (progress bar setup)                         |
| `schemas/`    | Zod validation schemas                                         |
| `events/`     | Event bus registration                                         |
| `router/`     | Vue Router configuration                                       |

**Important**: `src/client/` is auto-generated and ignored by ESLint. Never edit files in this directory manually.

### Key Architectural Patterns

**API Layer Flow:**

1. OpenAPI spec fetched from backend at `http://localhost:10001/docs/openapi.json`
2. Configuration in `openapi-ts.config.ts` specifies output to `src/client/` with camelCase operation IDs
3. `pnpm run openapi:generate` generates typed SDK in `src/client/`
4. `script/generate-api-constants.js` and `script/generate-api-types-map.js` extract endpoint metadata
5. Axios instance in `stores/request.ts` handles auth, token refresh, interceptors

**Token Management (`stores/request.ts`):**

- JWT tokens stored in localStorage (`Authentication-AccessToken`, `Authentication-RefreshToken`)
- Auto-refresh triggered when token expires (3s buffer before expiration)
- Single-promise pattern prevents concurrent refresh requests
- 401 responses trigger refresh + request retry

**Request Wrapper Pattern:**

- All requests wrapped with progress bar tracking via `configureAll()` in `config/index.ts`
- Task-based progress animation with fallback

**Event Bus Architecture (`stores/globalInstance.ts`):**

- `authEventBus` - authentication events (token refresh, login/logout)
- `webEventBus` - HTTP status events (401, 403, etc.)
- `customCodeBus` - custom API response codes (beyond standard HTTP)
- `i18nEventBus` - language change events
- `windowEventBus` - window/resize events
- `globalEventBus` - general app events

**Custom Code System:**

- Backend returns custom codes in addition to HTTP status codes (defined in `constant/custom-code.ts`)
- Example: `TOKEN_EXPIRED_DUE_TO_UPDATE` - token invalidated due to permission changes
- Custom codes trigger specific event bus handlers for specialized error handling
- Registered in `events/index.ts` via `registerAllEvents()`

**Permission System (`stores/permissionStore.ts` + `service/permissionService.ts`):**

- **Store**: Caches all available permissions and current user's effective permissions
- **Effective permissions** = group permissions + additional permissions - removed permissions
- **Local checking**: `hasPermission()`, `hasAnyPermission()`, `hasAllPermissions()`
- **Server operations**: `setUserPermissions()`, `addUserPermissions()`, `removeUserPermissions()`
- Permissions loaded on app startup and stored in Pinia for reactive access
- Permission changes on server trigger token refresh (custom code: `TOKEN_EXPIRED_DUE_TO_UPDATE`)

**Services Layer Pattern (`service/`):**

- Services use singleton pattern (`getInstance()`) for shared state
- `authorizationService.ts` - handles login, logout, token refresh, token verification
- `permissionService.ts` - manages user/group permissions (CRUD operations)
- `userService.ts` - fetches user information
- Services coordinate between API client (`src/client/`) and Pinia stores

**Layout Hierarchy:**

```
App.vue → IndexApp.vue → overLay.vue (protected) → HomeFrameLayout.vue → [Page Content]
```

### Environment Variables

Create `.env` file (see `.env.sample`):

```
VITE_BACKEND_URL=http://localhost:10001
```

### Development Server

The Vite dev server includes a proxy configuration for API requests:

- `/api/*` requests are proxied to `http://localhost:10001` with path rewriting
- Example: `fetch('/api/users')` → `http://localhost:10001/users`
- Configured in `vite.config.ts` with `changeOrigin: true`

### Production Build

Build configuration in `vite.config.ts`:

- **Bundler**: Rolldown (faster alternative to Rollup)
- **Minification**: Terser with console/debugger removal in production
- **Target**: ES2018 for broader browser compatibility (Chrome 63+, Firefox 58+, Safari 11.1+)
- **Code Splitting**: Automatic vendor chunking by node_modules
- **Compression**: Gzip compression for files > 10KB
- **Chunk Size Warning**: 500KB threshold
- **Babel**: Transpilation for better browser compatibility
- **Build Analysis**: `stats.html` generated after build for bundle visualization

### Auto-Import Configuration

Element Plus components and Vue utilities are auto-imported:

- `components.d.ts` - auto-registered components
- `auto-imports.d.ts` - auto-imported functions

### i18n Type Safety

Translation keys are typed via `I18nENAvailableKeys`. Use the helper functions:

```typescript
import { i18ns } from '@/locales'
i18ns.t('key') // Basic translation
i18ns.tref('key') // Ref-wrapped translation
i18ns.tf('key', n) // Pluralization
```

### Path Alias

`@` is aliased to `./src` in vite.config.ts and tsconfig files.

## Additional Documentation

Comprehensive documentation is available in `docs/develop/`:

- **01-architecture.md** - Detailed system architecture, startup flow, and core patterns
- **02-api-client.md** - OpenAPI client generation and usage
- **03-auth.md** - JWT authentication and authorization system
- **04-state-management.md** - Pinia stores and event bus architecture
- **05-development-workflow.md** - Environment setup and build configuration
- **06-i18n.md** - Internationalization implementation

Refer to these documents for in-depth understanding of specific subsystems.
