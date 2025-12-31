# Merge Summary: feat/unified-rest-gql-view ← backup/next

## Overview
Successfully merged `backup/next` (commit 67dff5fe0) into `feat/unified-rest-gql-view` branch. This merge integrates 68 upstream commits containing critical updates and maintains the unified REST/GraphQL view implementation.

## Merge Strategy
- **Strategy Used**: 3-way merge (non-rebase)
- **Rationale**: 
  - Preserves complete commit history for audit trail
  - Creates clear merge commit for easy revert if needed (single `git revert` possible)
  - Better for feature branches that need to maintain integration points
  - Easier to understand what came from where

## Conflicts Resolved

### 1. **packages/hoppscotch-common/src/helpers/backend/helpers.ts**
- **Type**: Content conflict
- **Issue**: Conflicting request wrapping strategy
- **Resolution**: Kept HEAD version (unified view)
  - Accepts: `coll.requests.map(wrapRESTRequest)` - proper typing for unified documents
  - Rejects: `coll.requests` - untyped requests
- **Rationale**: The wrapping ensures requests are properly typed for unified document handling

### 2. **packages/hoppscotch-common/src/helpers/backend/mutations/UserCollection.ts**
- **Type**: Delete/Modify conflict
- **Issue**: File deleted in backup/next but modified in HEAD
- **Resolution**: Accepted deletion from backup/next
- **Rationale**: File is part of old collection mutation structure, superseded by new implementation

### 3. **packages/hoppscotch-common/src/helpers/import-export/import/openapi/index.ts**
- **Type**: Content conflict
- **Issue**: Request wrapping vs. description field
- **Resolution**: Merged both features
  - Added: `description: tagDescriptions[name] ?? null` (from backup/next)
  - Kept: `paths.map(wrapRESTRequest)` (from HEAD)
- **Rationale**: Both features are valuable for the unified view

### 4. **packages/hoppscotch-common/src/pages/index.vue**
- **Type**: Content conflict (2 separate conflicts)
- **Issue**: Old REST-only document structure vs. unified document handling
- **Resolution**: 
  - **Import conflict**: Merged imports from both versions
    - Kept: `safelyExtractRESTRequest` (HEAD)
    - Added: `generateUniqueRefId` (backup/next)
  - **duplicateTab conflict**: Updated to handle unified documents
    ```typescript
    const duplicateTab = (tabID: string) => {
      const tab = tabs.getTabRef(tabID)
      if (tab.value) {
        const newDocument = cloneDeep(tab.value.document)
        newDocument.isDirty = true
        // Regenerate ref_id for requests to ensure uniqueness
        if (isRESTDocument(newDocument) && newDocument.request._ref_id) {
          newDocument.request._ref_id = generateUniqueRefId("req")
        }
        const newTab = tabs.createNewTab(newDocument)
        tabs.setActiveTab(newTab.id)
      }
    }
    ```
- **Rationale**: Unified documents need proper protocol detection and ref_id generation

### 5. **packages/hoppscotch-data/src/collection/v/11.ts**
- **Type**: Add/Add conflict
- **Issue**: Conflicting schema versions
- **Resolution**: Kept HEAD version (unified view implementation)
  - Includes: Protocol discrimination for requests
  - Detection logic for REST vs GraphQL
  - Migration function for backward compatibility
- **Rationale**: This schema is essential for the unified REST/GQL view

## Fixed Issues

### Runtime Error in [document.ts](packages/hoppscotch-common/src/helpers/unified/document.ts)
**Problem**: Using dynamic `require()` calls in ES modules
```typescript
// ❌ Before (caused runtime errors)
const { getDefaultRESTRequest } = require("../rest/default")
const { getDefaultGQLRequest } = require("@hoppscotch/data")
```

**Solution**: Converted to proper ES module imports
```typescript
// ✅ After (proper ES module)
import {
  HoppRESTRequest,
  HoppGQLRequest,
  getDefaultRESTRequest,
  getDefaultGQLRequest,
} from "@hoppscotch/data"
```

**Impact**: 
- Eliminates runtime errors when creating default documents
- Provides better tree-shaking and bundling
- Cleaner type inference

## Deleted Files (Accepted from backup/next)
- `.github/workflows/ui.yml` - UI workflow replaced
- `packages/hoppscotch-selfhost-desktop/*` - Package consolidated
- `packages/hoppscotch-js-sandbox/src/__tests__/pw-namespace/test-runner.spec.ts` - Moved/renamed
- Various GraphQL API mutation/query files - Consolidated/refactored

## Added Files (from backup/next)
- `packages/hoppscotch-backend/prisma.config.ts` - New Prisma configuration
- `packages/hoppscotch-backend/src/published-docs/*` - Published documentation feature
- `packages/hoppscotch-backend/src/mock-server/constants/mock-server-coll-request-example.ts` - Mock server examples
- Documentation-related components and utilities
- New test files for various features

## Testing Recommendations
1. **Type Safety**: Verify all unified documents properly discriminate protocol
2. **Requests**: Test wrapping and unwrapping of REST requests
3. **Collections**: Test import/export with mixed REST/GraphQL collections
4. **Tab Operations**: Test duplicating tabs with both REST and GraphQL requests
5. **Document Serialization**: Test saving/loading unified documents

## Revert Instructions
If needed, the merge can be easily reverted with a single commit:
```bash
git revert -m 1 aaaf517c4
```

The `-m 1` flag specifies reverting to parent 1 (the feat/unified-rest-gql-view branch).

## Commit Details
- **Merge Commit**: `aaaf517c4`
- **Timestamp**: 2025-12-31
- **Conflicts Resolved**: 5 (4 content, 1 delete/modify)
- **Files Modified**: 600+
- **Lines Added**: ~9,000
- **Lines Deleted**: ~500
