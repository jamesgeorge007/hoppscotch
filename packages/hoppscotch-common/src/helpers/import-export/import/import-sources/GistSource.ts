import UrlImport from "~/components/importExport/ImportExportSteps/UrlImport.vue"
import { defineStep } from "~/composables/step-components"

import * as E from "fp-ts/Either"
import { z } from "zod"

import { v4 as uuidv4 } from "uuid"
import { InterceptorService } from "~/services/interceptor.service"
import { getService } from "~/modules/dioc"

const interceptorService = getService(InterceptorService)

export function GistSource(metadata: {
  caption: string
  onImportFromGist: (
    importResult: E.Either<string, string[]>
  ) => any | Promise<any>
}) {
  const stepID = uuidv4()

  return defineStep(stepID, UrlImport, () => ({
    caption: metadata.caption,
    onImportFromURL: (gistResponse: Record<string, unknown>) => {
      const fileSchema = z.object({
        files: z.record(z.object({ content: z.string() })),
      })

      const parseResult = fileSchema.safeParse(gistResponse)

      if (!parseResult.success) {
        metadata.onImportFromGist(E.left("INVALID_GIST"))
        return
      }

      const contents = Object.values(parseResult.data.files).map(
        ({ content }) => content
      )

      metadata.onImportFromGist(E.right(contents))
    },
    fetchLogic: fetchGistFromUrl,
  }))
}

const fetchGistFromUrl = async (url: string) => {
  const res = await interceptorService.runRequest({
    url: `https://api.github.com/gists/${url.split("/").pop()}`,
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  }).response

  if (E.isLeft(res)) {
    return E.left("REQUEST_FAILED")
  }

  // convert ArrayBuffer to string
  if (!(res.right.data instanceof ArrayBuffer)) {
    return E.left("REQUEST_FAILED")
  }

  const data = new TextDecoder().decode(res.right.data).replace(/\0+$/, "")
  return E.right(data)
}
