// A pragmatic in-memory adapter for local testing. Not meant for multi-replica production.
import type {
  Adapter,
  EnqueueOptions,
  Job,
  JobLog,
  NackOptions,
  QueueStats,
} from "@/core/types";
import { genId, now } from "@/core/utils";

interface InMemoryJob extends Job {
  lockedUntil: number;
  visibleAt: number;
}

export const inMemoryAdapter = (): Adapter => {
  const jobs = new Map<string, InMemoryJob>();
  const logs = new Map<string, JobLog[]>();

  return {
    init: async () => {
      // no-op for in-memory
    },

    enqueue: async <T = any>(
      queue: string,
      payload: T,
      opts?: EnqueueOptions
    ): Promise<Job<T>> => {
      const jobId = opts?.jobId || genId();
      const maxAttempts = opts?.maxAttempts ?? 3;
      const visibleAt = opts?.delayMs ? now() + opts.delayMs : now();

      const job: InMemoryJob = {
        id: jobId,
        queue,
        payload,
        attempts: 0,
        maxAttempts,
        visibleAt,
        lockedUntil: 0,
        createdAt: now(),
        updatedAt: now(),
        status: "pending",
        meta: opts?.meta,
      };

      jobs.set(jobId, job);
      logs.set(jobId, []);

      return job as Job<T>;
    },

    dequeue: async <T = any>(
      queue: string,
      opts?: { limit?: number; visibilityTimeoutMs?: number }
    ): Promise<Job<T>[]> => {
      const limit = opts?.limit ?? 1;
      const visibilityTimeoutMs = opts?.visibilityTimeoutMs ?? 30_000;
      const currentTime = now();

      const availableJobs = Array.from(jobs.values())
        .filter(
          (job) =>
            job.queue === queue &&
            job.status === "pending" &&
            job.visibleAt <= currentTime &&
            job.lockedUntil < currentTime &&
            job.attempts < job.maxAttempts
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit);

      const dequeuedJobs: Job<T>[] = [];

      for (const job of availableJobs) {
        // Mark as processing and lock
        job.status = "processing";
        job.lockedUntil = currentTime + visibilityTimeoutMs;
        job.updatedAt = currentTime;
        job.attempts++;

        dequeuedJobs.push(job as Job<T>);
      }

      return dequeuedJobs;
    },

    ack: async (
      jobId: string,
      opts?: { deleteAfterAck?: boolean }
    ): Promise<void> => {
      const job = jobs.get(jobId);
      if (!job) return;

      job.status = "completed";
      job.updatedAt = now();

      if (opts?.deleteAfterAck) {
        jobs.delete(jobId);
      }
    },

    nack: async (jobId: string, opts?: NackOptions): Promise<void> => {
      const job = jobs.get(jobId);
      if (!job) return;

      const currentTime = now();

      if (opts?.requeue !== false) {
        job.status = "pending";
        job.lockedUntil = 0;
        job.visibleAt = opts?.delayMs
          ? currentTime + opts.delayMs
          : currentTime;
      } else {
        job.status = "failed";
      }

      job.updatedAt = currentTime;
    },

    getJob: async (jobId: string): Promise<Job | null> => {
      return jobs.get(jobId) || null;
    },

    logEvent: async (
      jobId: string,
      event: string,
      data?: any
    ): Promise<void> => {
      const jobLogs = logs.get(jobId) || [];
      const logEntry: JobLog = {
        id: genId("log"),
        jobId,
        queue: jobs.get(jobId)?.queue || "",
        event,
        data,
        createdAt: now(),
      };
      jobLogs.push(logEntry);
      logs.set(jobId, jobLogs);
    },

    getLogs: async (jobId: string): Promise<JobLog[]> => {
      return logs.get(jobId) || [];
    },

    stats: async (queue?: string): Promise<QueueStats[]> => {
      const allJobs = Array.from(jobs.values());
      const filteredJobs = queue
        ? allJobs.filter((job) => job.queue === queue)
        : allJobs;

      const stats = new Map<string, QueueStats>();

      for (const job of filteredJobs) {
        const queueStats = stats.get(job.queue) || {
          queue: job.queue,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        };

        switch (job.status) {
          case "pending":
            queueStats.pending++;
            break;
          case "processing":
            queueStats.processing++;
            break;
          case "completed":
            queueStats.completed++;
            break;
          case "failed":
            queueStats.failed++;
            break;
        }

        stats.set(job.queue, queueStats);
      }

      return Array.from(stats.values());
    },
  };
};
