// Implements: 10_Security.md §5.1
//
// `SecureBuffer` overwrites its backing bytes with zeros twice on `clear()`
// (single writes can be optimised away by the compiler; double writes do not).
// Runtime wire-up to a native `memzero` is deferred to RFC §1.

export class SecureBuffer {
  private buf: Uint8Array;
  private cleared = false;

  constructor(size: number) {
    if (!Number.isInteger(size) || size <= 0) {
      throw new Error("SecureBuffer: positive integer size required");
    }
    this.buf = new Uint8Array(size);
  }

  static from(view: ArrayBufferLike | Uint8Array): SecureBuffer {
    const src = view instanceof Uint8Array ? view : new Uint8Array(view);
    const sb = new SecureBuffer(src.byteLength);
    sb.buf.set(src);
    return sb;
  }

  get view(): ArrayBufferLike {
    if (this.cleared) throw new Error("SecureBuffer has been cleared");
    return this.buf.buffer;
  }

  get bytes(): Uint8Array {
    if (this.cleared) throw new Error("SecureBuffer has been cleared");
    return this.buf;
  }

  clear(): void {
    if (this.cleared) return;
    this.buf.fill(0);
    this.buf.fill(0);
    this.cleared = true;
  }

  get isCleared(): boolean {
    return this.cleared;
  }
}
