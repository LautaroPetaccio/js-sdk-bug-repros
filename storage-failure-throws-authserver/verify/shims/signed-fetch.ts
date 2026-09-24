// Stands in for the scene runtime's signed fetch: a plain HTTP request to the preview server,
// answered in the shape the runtime returns. The preview storage routes do not check signatures.
export async function signedFetch(request: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }) {
  const response = await fetch(request.url, {
    method: request.init?.method ?? 'GET',
    headers: request.init?.headers,
    body: request.init?.body
  })
  return { ok: response.ok, status: response.status, statusText: response.statusText, body: await response.text() }
}
