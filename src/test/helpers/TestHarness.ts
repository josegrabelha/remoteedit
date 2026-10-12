import { test as nodeTest, type TestFn, type TestOptions } from 'node:test';

export { after, afterEach, before, beforeEach } from 'node:test';

// A missing callback must fail a test instead of silently waiting forever.
// Longer integration tests can explicitly override this default.
const DEFAULT_TEST_TIMEOUT_MS = 30000;

export function test(name: string, fn: TestFn): Promise<void>;
export function test(name: string, options: TestOptions, fn: TestFn): Promise<void>;
export function test(name: string, optionsOrFn: TestOptions | TestFn, fn?: TestFn): Promise<void> {
  const options = typeof optionsOrFn === 'function' ? {} : optionsOrFn;
  const work = typeof optionsOrFn === 'function' ? optionsOrFn : fn;
  return nodeTest(name, { timeout: DEFAULT_TEST_TIMEOUT_MS, ...options }, work);
}

export default test;

/** Wait for an observable condition rather than assuming an async callback
 * completes within a particular fixed sleep. Used by scheduler/watch tests. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  description: string,
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  if (!(await condition())) throw new Error(`Timed out waiting for ${description}`);
}

/** A small controllable gate for concurrency tests (no polling or fixed sleeps). */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
