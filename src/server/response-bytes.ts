/** DOM BodyInit excludes shared backing stores; ordinary HTTP buffers need no copy. */
export function responseBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer
    ? (bytes as Uint8Array<ArrayBuffer>)
    : new Uint8Array(bytes);
}
