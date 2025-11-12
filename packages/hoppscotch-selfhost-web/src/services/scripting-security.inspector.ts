import { Service } from "dioc"
import {
  InspectionService,
  Inspector,
  InspectorResult,
} from "@hoppscotch/common/services/inspection"
import { computed, markRaw, Ref } from "vue"
import {
  HoppRESTRequest,
  HoppRESTResponseOriginalRequest,
} from "@hoppscotch/data"
import { HoppRESTResponse } from "@hoppscotch/common/helpers/types/HoppRESTResponse"
import IconAlertTriangle from "~icons/lucide/alert-triangle"
import { getI18n } from "@hoppscotch/common/modules/i18n"

/**
 * Inspector service that warns about security issues in scripts for self-hosted instances.
 *
 * This inspector checks for fetch() calls in pre-request and post-request scripts that target
 * the same origin as the web app. On self-hosted instances, browsers automatically send cookies
 * with same-origin requests, which can lead to CSRF vulnerabilities if the script is malicious.
 *
 * Note: This warning is only relevant for self-hosted web instances, not cloud (which uses
 * bearer token auth) or desktop (which doesn't have origin restrictions).
 */
export class ScriptingSecurityInspectorService
  extends Service
  implements Inspector
{
  public static readonly ID = "SCRIPTING_SECURITY_INSPECTOR_SERVICE"
  public readonly inspectorID = "scripting-security"

  private readonly t = getI18n()
  private readonly inspection = this.bind(InspectionService)

  override onServiceInit() {
    this.inspection.registerInspector(this)
  }

  /**
   * Checks if the script contains fetch() calls that target the same origin as the web app.
   * This checks for:
   * 1. Relative URLs that would resolve to same origin
   * 2. Explicit references to window.location.origin
   * 3. Absolute URLs matching the current origin
   */
  private scriptContainsSameOriginFetch(script: string): boolean {
    if (!script || script.trim() === "") {
      return false
    }

    // Check if script contains fetch() calls
    const hasFetchCalls = /(?:hopp\.)?fetch\s*\(/i.test(script)
    if (!hasFetchCalls) {
      return false
    }

    const currentOrigin = window.location.origin

    // Check for patterns that indicate same-origin requests:
    // 1. Relative URLs: fetch('/api/...') or fetch('./api/...') or fetch('../api/...')
    const relativeUrlPatterns = [
      /fetch\s*\(\s*['"`]\/[^/]/i, // Starts with single slash: '/api'
      /fetch\s*\(\s*['"`]\.\//i, // Starts with './'
      /fetch\s*\(\s*['"`]\.\.\//i, // Starts with '../'
    ]

    if (relativeUrlPatterns.some((pattern) => pattern.test(script))) {
      return true
    }

    // 2. Check for explicit window.location.origin usage
    if (/(?:window\.)?location\.(?:origin|href|hostname)/i.test(script)) {
      return true
    }

    // 3. Check for absolute URLs that match the current origin
    // Extract all fetch() call arguments that look like URLs
    const fetchUrlPattern = /fetch\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/gi
    const matches = script.matchAll(fetchUrlPattern)

    for (const match of matches) {
      const url = match[1]
      try {
        const urlObj = new URL(url)
        if (urlObj.origin === currentOrigin) {
          return true
        }
      } catch {
        // Invalid URL, skip
        continue
      }
    }

    return false
  }

  /**
   * Returns inspector results for the given request.
   * Checks both pre-request and post-request scripts for same-origin fetch calls.
   */
  getInspections(
    req: Readonly<Ref<HoppRESTRequest | HoppRESTResponseOriginalRequest>>,
    _res: Readonly<Ref<HoppRESTResponse | null | undefined>>
  ): Ref<InspectorResult[]> {
    return computed(() => {
      const results: InspectorResult[] = []

      if (!req.value) {
        return results
      }

      // For response original requests, we don't have script access
      if (!("preRequestScript" in req.value)) {
        return results
      }

      const request = req.value as HoppRESTRequest

      // Check pre-request script
      const hasPreRequestWarning = this.scriptContainsSameOriginFetch(
        request.preRequestScript
      )

      // Check post-request script (testScript)
      const hasPostRequestWarning = this.scriptContainsSameOriginFetch(
        request.testScript
      )

      if (hasPreRequestWarning || hasPostRequestWarning) {
        const scriptType = hasPreRequestWarning
          ? hasPostRequestWarning
            ? this.t("inspections.scripting_security.both_scripts")
            : this.t("inspections.scripting_security.pre_request")
          : this.t("inspections.scripting_security.post_request")

        results.push({
          id: "same-origin-fetch-csrf",
          icon: markRaw(IconAlertTriangle),
          text: {
            type: "text",
            text: this.t(
              "inspections.scripting_security.same_origin_fetch_warning",
              { scriptType }
            ),
          },
          severity: 3, // High severity (red)
          isApplicable: true,
          locations: { type: "response" },
        })
      }

      return results
    })
  }
}
