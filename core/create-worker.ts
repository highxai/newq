import type {
  Adapter,
  CreateWorkerOptions,
  QueueHandler,
  WorkerContext,
} from "./types";

export const createWorker = <TQueues = Record<string, any>>(
  adapter: Adapter,
  opts?: CreateWorkerOptions
): {
  listen: <TQueueName extends keyof TQueues>(
    queueName: TQueueName,
    handler: QueueHandler<TQueues[TQueueName]>
  ) => void;
  start: () => Promise<void>;
  stop: () => void;
} => {
  const concurrency = opts?.concurrency ?? 1;
  const pollIntervalMs = opts?.pollInterval ?? 1000;
  const visibilityTimeoutMs = opts?.visibilityTimeout ?? 30_000;
  const logger = opts?.logger ?? (() => {});

  const listeners = new Map<string, QueueHandler>();
  const running = { value: false };

  const listen = <TQueueName extends keyof TQueues>(
    queueName: TQueueName,
    handler: QueueHandler<TQueues[TQueueName]>
  ): void => {
    listeners.set(queueName as string, handler);
  };

  const start = async (): Promise<void> => {
    running.value = true;

    // simple round-robin across registered queues
    const queueNames = () => Array.from(listeners.keys());

    while (running.value) {
      const qs = queueNames();
      if (!qs.length) {
        await sleep(pollIntervalMs);
        continue;
      }

      let workDone = false;

      // iterate queues and try to fetch jobs
      for (const q of qs) {
        const handler = listeners.get(q)!;
        try {
          const jobs = await adapter.dequeue(q, {
            limit: concurrency,
            visibilityTimeoutMs,
          });
          if (!jobs.length) continue;
          workDone = true;

          // process in parallel up to concurrency
          await Promise.all(
            jobs.map(async (job) => {
              const ack = async () => {
                await adapter.ack(job.id, { deleteAfterAck: false });
                await adapter.logEvent(job.id, "ack", {});
              };

              const nack = async (opts?: {
                requeue?: boolean;
                delayMs?: number;
              }) => {
                await adapter.nack(job.id, opts);
                await adapter.logEvent(job.id, "nack", { opts });
              };

              const retry = async (delayMs?: number) => {
                await nack({ requeue: true, delayMs });
              };

              const log = async (event: string, data?: any) => {
                await adapter.logEvent(job.id, event, data);
              };

              const ctx: WorkerContext = { job, ack, nack, retry, log };

              try {
                await handler(ctx);
              } catch (err) {
                logger("handler_error", { err, jobId: job.id });
                // on handler error, nack with requeue
                await nack({ requeue: true });
              }
            })
          );
        } catch (err) {
          logger("dequeue_error", { err, queue: q });
        }
      }

      if (!workDone) await sleep(pollIntervalMs);
    }
  };

  const stop = (): void => {
    running.value = false;
  };

  return {
    listen: listen,
    start: start,
    stop: stop,
  };
};

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
