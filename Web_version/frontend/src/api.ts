const parse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(body.detail || 'Something went wrong')
  }
  return response.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => fetch(path).then(parse<T>),
  post: <T>(path: string, body?: unknown) =>
    fetch(path, {
      method: 'POST',
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    }).then(parse<T>),
  patch: <T>(path: string, body: unknown) =>
    fetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(parse<T>),
}

