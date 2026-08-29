/**
 * Reading a response that might not be JSON.
 *
 * Our own routes always answer with JSON, so `await res.json()` looks safe —
 * and it is, right up until something between the browser and the route
 * answers instead. A hosting proxy rejecting an oversized body, or cutting a
 * request that ran too long, replies with an empty body or an HTML error page.
 * `res.json()` then throws `Unexpected end of JSON input`, which surfaces to
 * someone standing in a kitchen holding eighteen photos of their own oven and
 * tells them nothing about what to do next.
 *
 * So every response is read as text first and parsed defensively, and the
 * status is turned into a sentence that names the actual problem.
 */

export interface JsonResult<T> {
  data: T | null;
  /** A message to show the person, or null when the response was usable. */
  failure: string | null;
}

export async function readJson<T = unknown>(res: Response): Promise<JsonResult<T>> {
  const body = await res.text().catch(() => '');

  if (body) {
    try {
      return { data: JSON.parse(body) as T, failure: null };
    } catch {
      // Fall through: a body that isn't JSON is a proxy error page.
    }
  }

  return { data: null, failure: describeFailure(res.status, body) };
}

function describeFailure(status: number, body: string): string {
  if (status === 413) {
    return 'Las fotos pesaron demasiado para enviarlas juntas. Haz el recorrido con menos espacios a la vez — la cocina y un baño primero.';
  }
  if (status === 429) {
    return 'Demasiados intentos seguidos. Espera un momento y vuelve a probar.';
  }
  if (status === 504 || status === 408) {
    return 'El análisis tardó demasiado y se cortó. Prueba con menos espacios a la vez.';
  }
  if (status === 502 || status === 503) {
    return 'El servidor no respondió. Espera unos segundos y vuelve a intentarlo.';
  }
  if (status >= 500) {
    return 'Hubo un error en el servidor. Vuelve a intentarlo en un momento.';
  }
  if (!body) {
    // A 2xx with nothing in it means something upstream dropped the request
    // mid-flight; the size of the upload is by far the most common reason.
    return 'La respuesta llegó vacía. Suele pasar cuando el envío es muy grande: prueba con menos espacios a la vez.';
  }
  return 'No pudimos leer la respuesta del servidor. Vuelve a intentarlo.';
}
