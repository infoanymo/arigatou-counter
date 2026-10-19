import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RequestTimeoutError,
  withRequestDeadline,
} from "../src/lib/abortable-request.ts";

test("an operation that never settles rejects on its deadline and aborts its fetch signal", async () => {
  let innerSignal: AbortSignal | undefined;
  await assert.rejects(
    withRequestDeadline(
      (signal) => {
        innerSignal = signal;
        return new Promise<never>(() => {});
      },
      new AbortController().signal,
      10,
    ),
    RequestTimeoutError,
  );
  assert.equal(innerSignal?.aborted, true);
});

test("successful requests return their result and failures stop sibling work", async () => {
  const controller = new AbortController();
  assert.equal(
    await withRequestDeadline(async () => 42, controller.signal),
    42,
  );
  let innerSignal: AbortSignal | undefined;
  await assert.rejects(
    withRequestDeadline(async (signal) => {
      innerSignal = signal;
      throw new Error("network failed");
    }, controller.signal),
    /network failed/,
  );
  assert.equal(innerSignal?.aborted, true);
  assert.equal(controller.signal.aborted, false);
});

test("cancelling a page exits even when the underlying request ignores cancellation", async () => {
  const controller = new AbortController();
  const operation = withRequestDeadline(
    () => new Promise<never>(() => {}),
    controller.signal,
  );
  controller.abort(new Error("page closed"));
  await assert.rejects(operation, /page closed/);
});

test("already cancelled requests do not start", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  let called = false;
  await assert.rejects(
    withRequestDeadline(async () => {
      called = true;
    }, controller.signal),
    /cancelled/,
  );
  assert.equal(called, false);
});
