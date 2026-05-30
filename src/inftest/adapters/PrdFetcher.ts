import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { logEvent } from '../observability/logger.js'

export type PrdSourceInput = {
  prd_file_url?: string | null
  prd_md_file_url?: string | null
  prd_file_key?: string | null
  prd_md_file_key?: string | null
}

export type PrdFetchResult = {
  path: string
  content: string
  source_url: string
}

const DEFAULT_MAX_PRD_CHARS = 120_000

function pickPrdUrl(input: PrdSourceInput): string | null {
  return (
    input.prd_md_file_url?.trim() ||
    input.prd_file_url?.trim() ||
    null
  )
}

function truncatePrd(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}\n\n...[truncated]`
}

async function fetchUrlWithRetry(
  url: string,
  retries = 2,
): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await Bun.sleep(300 * (attempt + 1))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/**
 * Downloads PRD markdown/text into workspace/input/prd.md and returns content.
 */
export async function fetchPrdToWorkspace(
  input: PrdSourceInput,
  workspace: string,
  options?: { max_chars?: number },
): Promise<PrdFetchResult | null> {
  const url = pickPrdUrl(input)
  if (!url) return null

  const maxChars = options?.max_chars ?? DEFAULT_MAX_PRD_CHARS
  const inputDir = join(workspace, 'input')
  await mkdir(inputDir, { recursive: true })
  const targetPath = join(inputDir, 'prd.md')

  try {
    const raw = await fetchUrlWithRetry(url)
    const content = truncatePrd(raw, maxChars)
    await writeFile(targetPath, content, 'utf8')
    logEvent('info', 'prd.fetch.success', {
      workspace,
      url,
      bytes: content.length,
    })
    return { path: targetPath, content, source_url: url }
  } catch (error) {
    logEvent('warn', 'prd.fetch.failed', {
      workspace,
      url,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function readPrdFromWorkspace(
  workspace: string,
): Promise<string | null> {
  const path = join(workspace, 'input', 'prd.md')
  try {
    const content = await readFile(path, 'utf8')
    return content.trim() ? content : null
  } catch {
    return null
  }
}
