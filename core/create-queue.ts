import type { Adapter, CreateQueueOptions, EnqueueOptions, Job, JobLog, QueueStats } from "./types";

export const createQueue = <TQueues = Record<string, any>>(
  adapter: Adapter,
  opts?: CreateQueueOptions
): {
  enqueue: <TQueueName extends keyof TQueues>(
    queueName: TQueueName,
    payload: TQueues[TQueueName],
    options?: EnqueueOptions
  ) => Promise<Job<TQueues[TQueueName]>>;
  getJob: (jobId: string) => Promise<Job | null>;
  getLogs: (jobId: string) => Promise<JobLog[]>;
  getStats: (queue?: string) => Promise<QueueStats[]>;
  remove: (jobId: string) => Promise<void>;
  _adapter: Adapter;
  _opts: { archiveOnComplete: boolean; autoDeleteOnAck: boolean };
} => {
  const archiveOnComplete = opts?.archiveOnComplete ?? true;
  const autoDeleteOnAck = opts?.autoDeleteOnAck ?? false;

  const enqueue = async <TQueueName extends keyof TQueues>(
    queueName: TQueueName,
    payload: TQueues[TQueueName],
    options?: EnqueueOptions
  ): Promise<Job<TQueues[TQueueName]>> => {
    const job = await adapter.enqueue(queueName as string, payload, options);
    await adapter.logEvent(job.id, "enqueue", { payload });
    return job as Job<TQueues[TQueueName]>;
  };

  const getJob = async (jobId: string): Promise<Job | null> => adapter.getJob(jobId);

  const getLogs = async (jobId: string): Promise<JobLog[]> => adapter.getLogs(jobId);

  const getStats = async (queue?: string): Promise<QueueStats[]> => {
    if (adapter.stats) return adapter.stats(queue);
    // fallback: empty
    return [];
  };

  const remove = async (jobId: string): Promise<void> => {
    // convenience: nack with requeue=false
    await adapter.nack(jobId, { requeue: false });
    await adapter.logEvent(jobId, "delete", {});
  };

  return {
    enqueue: enqueue,
    getJob: getJob,
    getLogs: getLogs,
    getStats: getStats,
    remove: remove,
    _adapter: adapter,
    _opts: { archiveOnComplete, autoDeleteOnAck },
  };
};