# Hoppscotch Architecture & Onboarding Guide

**Version:** 2025.10.0
**Last Updated:** November 2025
**Purpose:** Comprehensive architectural overview and onboarding guide for new developers

---

## Table of Contents

1. [Introduction](#introduction)
2. [Monorepo Structure](#monorepo-structure)
3. [Platform Abstraction System](#platform-abstraction-system)
4. [Data Versioning Strategy](#data-versioning-strategy)
5. [Package Deep Dive](#package-deep-dive)
6. [Authentication Architecture](#authentication-architecture)
7. [Request Execution Flow](#request-execution-flow)
8. [Deployment Targets](#deployment-targets)
9. [Development Workflow](#development-workflow)
10. [Common Patterns](#common-patterns)
11. [FAQ](#faq)

---

## Introduction

Hoppscotch is an **open-source API development ecosystem** built as a monorepo using **pnpm workspaces**. The codebase is designed to support multiple deployment targets (Web, Desktop, Self-Hosted, Cloud) while maintaining a **single source of truth** through a sophisticated platform abstraction system.

### Key Architectural Principles

1. **Platform Agnostic Core:** The `hoppscotch-common` package contains all shared business logic
2. **Versioned Data Structures:** All public data types use explicit versioning with migration paths
3. **Dependency Injection:** Uses `dioc` for service management
4. **Functional Programming:** Leverages `fp-ts` for error handling and type safety
5. **Type Safety:** Heavy use of TypeScript and runtime validation with Zod

---

## Monorepo Structure

### Package Overview

```
packages/
├── hoppscotch-common/           # Core UI and business logic (shared)
├── hoppscotch-data/             # Versioned data structures & migrations
├── hoppscotch-backend/          # NestJS GraphQL backend
├── hoppscotch-selfhost-web/     # Self-hosted web deployment
├── hoppscotch-desktop/          # Tauri-based desktop app
├── hoppscotch-sh-admin/         # Self-hosted admin dashboard
├── hoppscotch-cli/              # Command-line interface
├── hoppscotch-js-sandbox/       # Isolated script execution environment
├── hoppscotch-kernel/           # Cross-platform runtime kernel
├── hoppscotch-agent/            # Desktop agent for web requests
├── hoppscotch-relay/            # WebSocket relay server
├── codemirror-lang-graphql/     # GraphQL syntax highlighting
└── hoppscotch-ui/               # Component library (external)
```

### Package Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    hoppscotch-data                          │
│          (Versioned schemas & migrations)                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                  hoppscotch-common                          │
│    (Core UI, business logic, platform abstractions)         │
└───┬──────────────┬──────────────┬──────────────┬───────────┘
    │              │              │              │
    ↓              ↓              ↓              ↓
┌────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
│ SH-Web │  │ Desktop  │  │ SH-Admin │  │    CLI       │
└────────┘  └──────────┘  └──────────┘  └──────────────┘
```

---

## Platform Abstraction System

### What is Platform Abstraction?

Hoppscotch needs to run on multiple platforms with different capabilities:
- **Web (Cloud/SH):** Cookie-based auth, browser APIs, no native system access
- **Desktop:** Native interceptors, file system access, system integration
- **CLI:** Headless execution, different I/O model

The **platform abstraction system** allows a single codebase to adapt to these different environments.

### Core Abstraction Interface

Located in: [`packages/hoppscotch-common/src/platform/index.ts:26-76`](packages/hoppscotch-common/src/platform/index.ts#L26-L76)

```typescript
export type PlatformDef = {
  // Platform-specific implementations
  auth: AuthPlatformDef                    // Authentication mechanism
  sync: {
    environments: EnvironmentsPlatformDef  // Environment sync (local/cloud)
    collections: CollectionsPlatformDef    // Collection sync
    settings: SettingsPlatformDef          // Settings persistence
    history: HistoryPlatformDef            // Request history
  }
  kernelInterceptors: KernelInterceptorsPlatformDef  // Request execution
  backend: BackendPlatformDef              // Backend API configuration

  // Optional platform features
  ui?: UIPlatformDef                       // Custom UI components
  analytics?: AnalyticsPlatformDef         // Telemetry
  limits?: LimitsPlatformDef               // Resource limits

  // Feature flags
  platformFeatureFlags: {
    exportAsGIST: boolean                  // GitHub Gist export
    hasTelemetry: boolean                  // Analytics enabled
    cookiesEnabled?: boolean               // Cookie support
    promptAsUsingCookies?: boolean         // Cookie notice
  }
}
```

### Example: Authentication Abstraction

**Self-Hosted Web** ([`packages/hoppscotch-selfhost-web/src/platform/auth/web/index.ts:1-100`](packages/hoppscotch-selfhost-web/src/platform/auth/web/index.ts#L1-L100)):
- Cookie-based sessions
- OAuth redirects to backend
- Token management via cookies

**Desktop** (would have different implementation):
- Native token storage
- Local credential management
- Optional cloud sync

### Platform Configuration Example

From [`packages/hoppscotch-selfhost-web/src/main.ts:70-114`](packages/hoppscotch-selfhost-web/src/main.ts#L70-L114):

```typescript
const kernelMode = getKernelMode() // 'web' or 'desktop'

await createHoppApp("#app", {
  auth: platformDefs.auth.get(kernelMode),
  sync: {
    environments: platformDefs.environments.get(kernelMode),
    collections: platformDefs.collections.get(kernelMode),
    settings: platformDefs.settings.get(kernelMode),
    history: platformDefs.history.get(kernelMode),
  },
  kernelInterceptors: {
    default: kernelMode === "desktop" ? "native" : "browser",
    interceptors: getInterceptors(kernelMode),
  },
  platformFeatureFlags: {
    exportAsGIST: false,
    hasTelemetry: false,
    cookiesEnabled: kernelMode === "desktop",
  },
})
```

---

## Data Versioning Strategy

### Why Versioning?

The `@hoppscotch/data` package contains **public data structures** that are:
1. **Exported/Imported** by users (JSON files)
2. **Stored in databases** (backend)
3. **Persisted locally** (localStorage, IndexedDB)
4. **Shared across versions** (old exports must work in new versions)

**Problem:** Adding a field like `variables` to collections breaks old exports.

**Solution:** Explicit versioning with migration paths.

### Versioning Architecture

Uses the **`verzod`** library (Versioned Zod schemas):

```typescript
// Collection has evolved through 10 versions
export const HoppCollection = createVersionedEntity({
  latestVersion: 10,
  versionMap: {
    1: V1_VERSION,  // Initial: name, folders, requests
    2: V2_VERSION,  // Added: auth, headers
    3: V3_VERSION,  // Modified: auth types
    4: V4_VERSION,  // Added: id field
    5: V5_VERSION,  // Added: _ref_id (internal references)
    6: V6_VERSION,  // Added: headers to collection level
    7: V7_VERSION,  // Modified: auth to support OAuth2
    8: V8_VERSION,  // Added: variables (initial)
    9: V9_VERSION,  // Enhanced: OAuth2 advanced params
    10: V10_VERSION, // Enhanced: Collection variables with secrets
  },
  getVersion(data) {
    // Detect version from data structure
  },
})
```

### Version Migration Example

**V9 → V10 Migration** ([`packages/hoppscotch-data/src/collection/v/10.ts:36-54`](packages/hoppscotch-data/src/collection/v/10.ts#L36-L54)):

```typescript
export default defineVersion({
  initial: false,
  schema: V10_SCHEMA,
  up(old: z.infer<typeof V10_SCHEMA>) {
    const result: z.infer<typeof V10_SCHEMA> = {
      ...old,
      v: 10 as const,
      variables: [],  // Add new field with default value
      folders: old.folders.map((folder) => {
        // Recursively migrate nested folders
        const result = HoppCollection.safeParseUpToVersion(folder, 10)
        if (result.type !== "ok") {
          throw new Error("Failed to migrate child collections")
        }
        return result.value
      }),
    }
    return result
  },
})
```

### REST Request Versioning

REST requests have evolved through **16 versions** (current):

```typescript
export const HoppRESTRequest = createVersionedEntity({
  latestVersion: 16,
  versionMap: {
    0: V0_VERSION,   // Legacy
    1: V1_VERSION,   // Added basic auth types
    2: V2_VERSION,   // Added request variables
    4: V4_VERSION,   // Added API Key auth
    7: V7_VERSION,   // Added AWS Signature, structured headers/params
    8: V8_VERSION,   // Added Digest auth
    9: V9_VERSION,   // Added FormData support
    10: V10_VERSION, // Refactored body types
    12: V12_VERSION, // Added HAWK, Akamai EdgeGrid
    15: V15_VERSION, // Added JWT, OAuth2 enhancements
    16: V16_VERSION, // Latest
  },
})
```

### Why Not Just Add Fields?

**Without Versioning:**
```json
// Old export (2023)
{
  "name": "My Collection",
  "requests": [...]
}

// New field added (2024)
{
  "name": "My Collection",
  "requests": [...],
  "variables": []  // ❌ Old exports don't have this!
}
```

**With Versioning:**
```json
// Old export
{
  "v": 5,
  "name": "My Collection",
  "requests": [...]
}

// Automatically migrated to v10
{
  "v": 10,
  "name": "My Collection",
  "requests": [...],
  "variables": []  // ✅ Default value added during migration
}
```

### Version Detection Strategy

1. **Explicit version field:** `{ v: 10 }` (modern)
2. **Schema matching:** Try to parse with V1 schema (legacy)
3. **Fail gracefully:** Return default structure if unparsable

### When to Create a New Version

Create a new version when:
- ✅ **Adding required fields** (breaks old data)
- ✅ **Changing field types** (e.g., string → object)
- ✅ **Removing fields** (breaks round-trip compatibility)
- ✅ **Restructuring data** (nested → flat)

Don't create a new version for:
- ❌ **Adding optional fields** (use `z.optional()`)
- ❌ **Adding enum values** (backward compatible)
- ❌ **Internal implementation changes** (no schema change)

---

## Package Deep Dive

### hoppscotch-data

**Purpose:** Single source of truth for all data structures

**Key Files:**
- [`src/collection/index.ts`](packages/hoppscotch-data/src/collection/index.ts) - Collection versioning
- [`src/rest/index.ts`](packages/hoppscotch-data/src/rest/index.ts) - REST request versioning (16 versions)
- [`src/graphql/index.ts`](packages/hoppscotch-data/src/graphql/index.ts) - GraphQL request versioning
- [`src/environment/index.ts`](packages/hoppscotch-data/src/environment/index.ts) - Environment versioning

**Technologies:**
- `zod` - Runtime type validation
- `verzod` - Versioned schema management
- `fp-ts` - Functional programming utilities

**Key Concepts:**
- All exports are versioned entities
- Provides type safety across the entire app
- Used by frontend, backend, CLI, and desktop

### hoppscotch-common

**Purpose:** Shared UI components and business logic

**Key Areas:**
- **Platform abstractions** ([`src/platform/`](packages/hoppscotch-common/src/platform/)) - Define interfaces
- **Services** ([`src/services/`](packages/hoppscotch-common/src/services/)) - Business logic (DI-based)
- **Helpers** ([`src/helpers/`](packages/hoppscotch-common/src/helpers/)) - Utilities
- **Components** ([`src/components/`](packages/hoppscotch-common/src/components/)) - Vue components

**Platform Standards** ([`src/platform/std/`](packages/hoppscotch-common/src/platform/std/)):
- Standard implementations that can be reused
- Kernel interceptors (browser, native, proxy, agent, extension)
- Common UI elements (footer, support links)

### hoppscotch-backend

**Purpose:** GraphQL API and authentication server

**Architecture:**
- **Framework:** NestJS
- **Database:** PostgreSQL via Prisma ORM
- **API:** GraphQL with Apollo Server
- **Auth:** Passport.js (Google, GitHub, Microsoft, Email, SAML)

**Key Features:**
- User management
- Team workspaces
- Collection/environment sync
- Request history persistence
- Admin operations

### hoppscotch-selfhost-web

**Purpose:** Self-hosted web deployment (this is the "SH" codebase)

**Key Characteristics:**
- Integrates with `hoppscotch-backend`
- Cookie-based authentication
- Can be packaged for cloud deployment
- Synced to separate repo for cloud releases

**Build Output:** Static assets that can be served via Caddy/Nginx

### hoppscotch-desktop

**Purpose:** Native desktop application

**Technology:**
- **Framework:** Tauri v2 (Rust + Web)
- **Frontend:** Reuses `hoppscotch-selfhost-web` build
- **Features:**
  - Native request interceptor (bypasses CORS)
  - File system access
  - System tray integration
  - Auto-updates

**Unique Capabilities:**
- No CORS restrictions (native networking)
- Cookie jar support
- Local-only mode (no backend required)

### hoppscotch-js-sandbox

**Purpose:** Secure script execution environment

**Why Needed?**
- Execute user-provided pre-request/test scripts
- Must be isolated from main app (security)
- Must provide APIs (`pm.*, hopp.*`)

**Architecture:**
- Runs in Web Worker (browser) or isolated-vm (Node.js)
- Provides Postman-compatible APIs (`pm.test`, `pm.response`)
- Provides Hoppscotch APIs (`hopp.env.set`, `hopp.sendRequest`)

**Key Files:**
- [`src/cage-modules/`](packages/hoppscotch-js-sandbox/src/cage-modules/) - Sandboxed API implementations
- [`src/__tests__/`](packages/hoppscotch-js-sandbox/src/__tests__/) - Comprehensive test suite

### hoppscotch-cli

**Purpose:** Command-line test runner

**Use Cases:**
- CI/CD integration
- Automated API testing
- Batch request execution

**Features:**
- Execute collections
- Environment variable support
- Test assertions
- JSON/XML reports

### hoppscotch-kernel

**Purpose:** Cross-platform runtime abstraction

**Responsibilities:**
- Detect runtime environment (web/desktop)
- Provide unified APIs for platform differences
- Abstract file system, network, storage

---

## Authentication Architecture

### Self-Hosted Authentication Flow

**Technology Stack:**
- **Frontend:** Cookie-based sessions
- **Backend:** Passport.js strategies
- **Database:** User records in PostgreSQL

**Login Flow:**

```
1. User clicks "Sign in with Google"
   ↓
2. Redirect to: backend.com/auth/google
   ↓
3. Backend initiates OAuth flow
   ↓
4. User authorizes on Google
   ↓
5. Callback to: backend.com/auth/google/callback
   ↓
6. Backend creates session, sets httpOnly cookie
   ↓
7. Redirect to frontend with session
   ↓
8. Frontend calls: GET /auth/me (with cookie)
   ↓
9. Backend returns user details
   ↓
10. Frontend sets user state
```

**Auth Platform Implementation:**
- **Probable user:** Stored in localStorage (for fast initial render)
- **Confirmed user:** Retrieved from backend
- **Token refresh:** Automatic on GraphQL errors

### Authentication Abstraction

**Interface:** [`packages/hoppscotch-common/src/platform/auth.ts:61-290`](packages/hoppscotch-common/src/platform/auth.ts#L61-L290)

Key methods:
- `getCurrentUserStream()` - Reactive user state
- `getAuthEventsStream()` - Login/logout events
- `getBackendHeaders()` - Headers for API calls
- `signInUserWithGoogle/Github/Microsoft()` - OAuth flows
- `signInWithEmail()` - Magic link authentication

### Desktop Authentication

Desktop can operate in two modes:

1. **Cloud-connected:** Same as web (cookie-based with backend)
2. **Local-only:** No authentication, everything stored locally

---

## Request Execution Flow

### Kernel Interceptor System

**Problem:** Different platforms execute HTTP requests differently:
- **Browser:** `fetch()` API (CORS restrictions)
- **Desktop:** Native networking (no CORS)
- **Extension:** Browser extension APIs
- **Proxy:** Through Hoppscotch Proxy
- **Agent:** Through desktop agent

**Solution:** Pluggable interceptor system

**Interceptor Interface:**
```typescript
interface KernelInterceptor {
  id: string
  name: string
  // Execute HTTP request
  executeRequest(request: HoppRESTRequest): Promise<Response>
  // Cancel running request
  cancelRequest(requestId: string): void
  // Check if available
  isAvailable(): boolean
}
```

**Available Interceptors:**
1. **Browser** - `fetch()` API (web default)
2. **Native** - Tauri native networking (desktop default)
3. **Proxy** - Through proxy server
4. **Agent** - Through desktop agent (for web)
5. **Extension** - Browser extension

### Script Execution Flow

**Pre-Request Script:**
```
1. User hits "Send"
   ↓
2. Execute pre-request script in sandbox
   ↓
3. Script can modify request (headers, body, etc.)
   ↓
4. Updated request sent via interceptor
   ↓
5. Response received
   ↓
6. Execute test script in sandbox
   ↓
7. Test results displayed
```

**Sandbox Context:**
```javascript
// Available in scripts
pm.environment.get("token")
pm.environment.set("newToken", "...")
pm.test("Status is 200", () => {
  pm.response.to.have.status(200)
})

hopp.env.get("var")
hopp.sendRequest({ url: "...", method: "GET" })
```

---

## Deployment Targets

### 1. Self-Hosted (SH)

**Repository:** This main repo (synced to separate repo for releases)

**Components:**
- `hoppscotch-selfhost-web` - Frontend
- `hoppscotch-backend` - Backend API
- `hoppscotch-sh-admin` - Admin dashboard

**Deployment:**
```bash
docker-compose up
# Or
pnpm install
pnpm generate  # Build all packages
pnpm start     # Serve on localhost:3000
```

**Architecture:**
```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Frontend   │─────▶│   Backend    │─────▶│  PostgreSQL  │
│  (Vite SPA)  │      │  (NestJS)    │      │              │
└──────────────┘      └──────────────┘      └──────────────┘
```

### 2. Cloud (SHE - Self-Hosted Enterprise)

**Differences from SH:**
- Enhanced admin features
- SSO/SAML support
- Advanced team management
- Audit logs
- Usage analytics

**Same codebase**, different feature flags.

### 3. Desktop

**Build Process:**
```bash
cd packages/hoppscotch-desktop
pnpm tauri build
```

**Output:**
- `.dmg` (macOS)
- `.exe` / `.msi` (Windows)
- `.AppImage` / `.deb` (Linux)

**Architecture:**
```
┌─────────────────────────────────────┐
│         Tauri Window                │
│  ┌───────────────────────────────┐  │
│  │   Web Frontend (Bundled)     │  │
│  │   (hoppscotch-selfhost-web)  │  │
│  └───────────────────────────────┘  │
│              ↕                      │
│  ┌───────────────────────────────┐  │
│  │   Rust Core (Tauri)          │  │
│  │   - Native networking         │  │
│  │   - File system               │  │
│  │   - System integration        │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### 4. CLI

**Usage:**
```bash
hopp test collection.json --env production.json
```

**Architecture:**
- Headless execution
- No UI dependencies
- Direct request execution
- Test runner with assertions

---

## Development Workflow

### Initial Setup

```bash
# Clone repository
git clone https://github.com/hoppscotch/hoppscotch
cd hoppscotch

# Install dependencies (uses pnpm)
pnpm install

# Setup environment variables
cp .env.example .env
# Edit .env with your configuration

# Generate types and build packages
pnpm generate

# Start development server
pnpm dev
```

### Common Development Commands

```bash
# Run all packages in dev mode
pnpm dev

# Run specific package
pnpm --filter @hoppscotch/common dev

# Build all packages
pnpm generate

# Run tests
pnpm test

# Run tests for specific package
pnpm --filter @hoppscotch/js-sandbox test

# Lint
pnpm lint

# Type check
pnpm typecheck

# Fix linting issues
pnpm lintfix
```

### Working with Platform Abstractions

**Adding a new platform feature:**

1. **Define interface** in `hoppscotch-common/src/platform/`:
```typescript
// myfeature.ts
export type MyFeaturePlatformDef = {
  doSomething(): Promise<void>
}
```

2. **Add to PlatformDef**:
```typescript
// index.ts
export type PlatformDef = {
  // ... existing
  myFeature: MyFeaturePlatformDef
}
```

3. **Implement for each platform:**
```typescript
// selfhost-web/src/platform/myfeature/web/index.ts
export const def: MyFeaturePlatformDef = {
  async doSomething() {
    // Web-specific implementation
  }
}

// desktop/src/platform/myfeature/desktop/index.ts
export const def: MyFeaturePlatformDef = {
  async doSomething() {
    // Desktop-specific implementation
  }
}
```

4. **Register in app initialization:**
```typescript
await createHoppApp("#app", {
  // ... existing
  myFeature: platformDefs.myFeature.get(kernelMode),
})
```

### Adding a New Data Field

**Example: Adding `description` to collections**

1. **Create new version** in `hoppscotch-data`:
```typescript
// src/collection/v/11.ts
import { defineVersion } from "verzod"
import { z } from "zod"
import { v10_baseCollectionSchema } from "./10"

export const v11_baseCollectionSchema = v10_baseCollectionSchema.extend({
  v: z.literal(11),
  description: z.string().optional(),
})

export default defineVersion({
  initial: false,
  schema: V11_SCHEMA,
  up(old) {
    return {
      ...old,
      v: 11 as const,
      description: "",  // Default value
      folders: old.folders.map(migrateFolder),
    }
  },
})
```

2. **Update version map**:
```typescript
// src/collection/index.ts
export const HoppCollection = createVersionedEntity({
  latestVersion: 11,  // Increment
  versionMap: {
    // ... existing
    11: V11_VERSION,  // Add new version
  },
})
```

3. **Update UI components** to use new field
4. **Update backend** to persist new field
5. **Test migration** from v10 → v11

---

## Common Patterns

### 1. Service Injection (Dependency Injection)

**Pattern:**
```typescript
import { getService } from "~/modules/dioc"
import { PersistenceService } from "~/services/persistence"

const persistenceService = getService(PersistenceService)
const data = await persistenceService.getLocalConfig("key")
```

**Why:** Loose coupling, testability, platform independence

### 2. Reactive State Management

**Pattern:**
```typescript
import { BehaviorSubject } from "rxjs"

const user$ = new BehaviorSubject<User | null>(null)

// Subscribe to changes
user$.subscribe(user => {
  console.log("User changed:", user)
})

// Update value
user$.next(newUser)
```

**Why:** Real-time updates, multiple subscribers

### 3. Functional Error Handling

**Pattern:**
```typescript
import * as E from "fp-ts/Either"

function fetchUser(): Promise<E.Either<string, User>> {
  try {
    const user = await api.getUser()
    return E.right(user)  // Success
  } catch (err) {
    return E.left("Failed to fetch user")  // Error
  }
}

// Usage
const result = await fetchUser()
if (E.isRight(result)) {
  console.log("User:", result.right)
} else {
  console.error("Error:", result.left)
}
```

**Why:** Type-safe error handling, no exceptions

### 4. Platform-Specific Code

**Pattern:**
```typescript
import { platform } from "@hoppscotch/common/platform"

if (platform.platformFeatureFlags.cookiesEnabled) {
  // Use cookies
} else {
  // Use alternative
}

// Or delegate to platform
await platform.auth.signInUserWithGoogle()
```

**Why:** Single codebase, multiple platforms

### 5. Zod Schema Validation

**Pattern:**
```typescript
import { z } from "zod"

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
})

// Parse and validate
const result = UserSchema.safeParse(data)
if (result.success) {
  const user: User = result.data
} else {
  console.error("Validation errors:", result.error)
}
```

**Why:** Runtime type safety, validation, parsing

---

## FAQ

### Q: Why is the codebase structured as a monorepo?

**A:** Multiple packages share common code (`hoppscotch-data`, `hoppscotch-common`). A monorepo allows:
- Single source of truth
- Atomic commits across packages
- Easier dependency management
- Consistent tooling and CI/CD

### Q: What's the difference between SH and cloud deployments?

**A:**
- **SH (Self-Hosted):** This repo, can be deployed anywhere
- **Cloud/SHE:** Same codebase, synced to separate repo, deployed on Hoppscotch infrastructure with additional features

### Q: Why use `verzod` instead of just Zod?

**A:** Zod provides schema validation but not versioning. `verzod` adds:
- Version management
- Automatic migration paths
- Backward compatibility
- Future-proof data structures

### Q: When should I create a platform abstraction vs. just use conditionals?

**A:** Create abstraction when:
- Logic differs significantly between platforms
- Need to swap implementations (e.g., storage backends)
- Want to isolate platform-specific APIs

Use conditionals for:
- Simple feature flags
- UI-only differences
- One-off checks

### Q: How do I test version migrations?

**A:**
1. Create test data for old version
2. Parse with versioned entity: `HoppCollection.safeParse(oldData)`
3. Verify migrated structure matches expected latest version
4. See tests in `hoppscotch-data/src/**/__tests__/`

### Q: What's the scripting revamp mentioned in recent commits?

**A:** Modernization of script execution:
- Better API compatibility (Postman pm.* APIs)
- Enhanced security (sandboxing improvements)
- New features (hopp.sendRequest from scripts)
- Improved error handling and debugging

### Q: How are collections synced between devices?

**A:** Two modes:
- **Cloud sync:** Backend stores collections in PostgreSQL, synced via GraphQL
- **Local-only:** IndexedDB (web) or SQLite (desktop), no backend required

### Q: What's the kernel?

**A:** The `hoppscotch-kernel` package provides runtime detection and abstraction:
- Detects: web vs. desktop environment
- Provides: unified APIs across platforms
- Handles: request execution, storage, file system

### Q: Why both `hoppscotch-agent` and interceptors?

**A:**
- **Agent:** Standalone desktop app that acts as proxy for web version (CORS bypass)
- **Interceptors:** Pluggable system for different request execution strategies (browser, native, proxy, extension, agent)

### Q: How do I add a new authentication provider?

**A:**
1. Add Passport strategy to `hoppscotch-backend`
2. Create OAuth route (`/auth/provider`, `/auth/provider/callback`)
3. Update `AuthPlatformDef` interface with new method
4. Implement in platform-specific auth files
5. Add UI button in login screen

### Q: What's the difference between `preRequestScript` and `testScript`?

**A:**
- **Pre-request:** Runs BEFORE request is sent (modify request, set env vars)
- **Test:** Runs AFTER response received (assertions, extract data)

Both use same sandbox, but different context (no response in pre-request).

### Q: How are WebSocket/SSE/MQTT requests different from REST?

**A:**
- Different packages: `rest`, `graphql`, `socketio`, `sse`, `mqtt`
- Same versioning pattern
- Different UI components
- Different kernel interceptors

### Q: Can I use Hoppscotch Common in my own project?

**A:** Theoretically yes, but:
- Designed for Hoppscotch use cases
- Tightly coupled with platform system
- Would need significant adaptation
- Better to use specific packages (e.g., `@hoppscotch/data`)

---

## Quick Reference

### Key Files to Understand

1. **Platform System:** [`packages/hoppscotch-common/src/platform/index.ts`](packages/hoppscotch-common/src/platform/index.ts)
2. **Data Versioning:** [`packages/hoppscotch-data/src/collection/index.ts`](packages/hoppscotch-data/src/collection/index.ts)
3. **App Initialization:** [`packages/hoppscotch-selfhost-web/src/main.ts`](packages/hoppscotch-selfhost-web/src/main.ts)
4. **REST Request:** [`packages/hoppscotch-data/src/rest/index.ts`](packages/hoppscotch-data/src/rest/index.ts)
5. **Auth Interface:** [`packages/hoppscotch-common/src/platform/auth.ts`](packages/hoppscotch-common/src/platform/auth.ts)

### Important Concepts

- **Platform Abstraction:** Different implementations for different deployment targets
- **Versioned Entities:** All public data structures use explicit versioning
- **Verzod:** Library for versioned Zod schemas with migrations
- **Kernel:** Runtime environment detection and abstraction
- **Interceptor:** Pluggable request execution strategy
- **Sandbox:** Isolated script execution environment
- **DI Container:** Dependency injection for services

### Getting Help

- **Documentation:** https://docs.hoppscotch.io
- **Discord:** https://hoppscotch.io/discord
- **GitHub Discussions:** https://github.com/hoppscotch/hoppscotch/discussions
- **Issues:** https://github.com/hoppscotch/hoppscotch/issues

---

## Conclusion

Hoppscotch's architecture prioritizes:
1. **Maintainability:** Clear separation of concerns, platform abstractions
2. **Scalability:** Versioned data, migration paths
3. **Flexibility:** Multiple deployment targets from single codebase
4. **Type Safety:** TypeScript + Zod + fp-ts
5. **Developer Experience:** Monorepo with shared tooling

Understanding the platform abstraction system and data versioning strategy is crucial for contributing effectively. When in doubt, look at existing implementations as patterns to follow.

Welcome to the Hoppscotch codebase! 🚀
