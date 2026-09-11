/**
 * A body read while counting, that stops at the bound.
 *
 * A declared length is a hint, not a promise: it is absent on a chunked request,
 * where `Number(null)` is zero and a header check would wave anything through to
 * be buffered whole. Counting the bytes as they arrive refuses the same
 * oversized body without ever holding it.
 *
 * This lives here because more than one boundary needs it: an endpoint bounding
 * its request body, and an intake bounding what it pulls out of a mailbox. A
 * second hand-rolled copy is a second place where the bound can quietly differ.
 */
export type BoundedRead<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'too_large' | 'unreadable' };

/** Drains a stream into one buffer, refusing to hold more than `limit` bytes. */
export async function readBoundedStream(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<BoundedRead<Uint8Array>> {
  if (!body) return { ok: true, value: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return { ok: false, reason: 'too_large' }; }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, value: bytes };
}

/** The same bound, applied to a request body and decoded as text. */
export async function readBoundedBody(req: Request, limit: number): Promise<BoundedRead<string>> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: 'too_large' };
  const read = await readBoundedStream(req.body, limit);
  if (read.ok === false) return read;
  return { ok: true, value: new TextDecoder().decode(read.value) };
}
