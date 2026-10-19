export class RequestTimeoutError extends Error {
  constructor() {
    super(
      "集計データの取得に時間がかかっています。更新ボタンで再試行してください。",
    );
    this.name = "RequestTimeoutError";
  }
}

// Racing the abort signal also bounds waits before fetch starts (for example,
// session refresh), where passing abortSignal to the query alone is not enough.
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });

  let onAbort: (() => void) | undefined;
  const timer = setTimeout(
    () => controller.abort(new RequestTimeoutError()),
    timeoutMs,
  );
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([
      Promise.resolve(operation(controller.signal)),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
