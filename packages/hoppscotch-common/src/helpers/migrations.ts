import { settingsStore, applySetting } from "~/newstore/settings"
import { migrateToUnifiedProtocol } from "./migrations/unified-protocol"

/*
 * This file contains all the migrations we have to perform overtime in various (persisted)
 * state/store entries
 */

export function performMigrations(): void {
  // Migrate old default proxy URL to the new proxy URL (if not set / overridden)
  if (
    settingsStore.value.PROXY_URL === "https://hoppscotch.apollosoftware.xyz/"
  ) {
    applySetting("PROXY_URL", "https://proxy.hoppscotch.io/")
  }

  // Unified Protocol Migration
  // Migrates separate REST and GraphQL stores to unified protocol-agnostic store
  const migrationResult = migrateToUnifiedProtocol()

  if (migrationResult.success) {
    console.log(
      `[Migrations] Unified protocol migration complete. Migrated ${migrationResult.migratedCollections} collections.`
    )
  } else {
    console.error(
      "[Migrations] Unified protocol migration failed:",
      migrationResult.errors
    )
  }
}
