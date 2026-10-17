// PLAN G-T14: the browser keeps at most 3 processed reports, least recently used evicted first;
// no time-based expiry; cleared on logout (decided 2026-10-17).

export const REPORT_CACHE_SIZE = 3;

export class ReportCache<T> {
  private readonly map = new Map<string, T>();

  constructor(private readonly capacity = REPORT_CACHE_SIZE) {}

  get size(): number {
    return this.map.size;
  }

  /** Returns the report and marks it most recently used. */
  get(id: string): T | undefined {
    const v = this.map.get(id);
    if (v !== undefined) {
      this.map.delete(id);
      this.map.set(id, v);
    }
    return v;
  }

  set(id: string, value: T): void {
    this.map.delete(id);
    this.map.set(id, value);
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value!);
  }

  delete(id: string): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }

  /** Least recently used first. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}
