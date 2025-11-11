import type { RedisClientType } from "redis";
import type {
  Adapter,
  EnqueueOptions,
  Job,
  JobLog,
  NackOptions,
  QueueStats,
} from "../core/types";
import { genId, now } from "../core/utils";

/**
 * Creates a Redis-based adapter for newq.
 *
 * @param redis A Redis client instance.
 * @returns A newq-compatible adapter.
 */
export const redisAdapter = (redis: RedisClientType): Adapter => {
  return {
    init: async () => {
      // no-op
    },

    enqueue: async <T = any>(
      queue: string,
      payload: T,
      opts?: EnqueueOptions
    ): Promise<Job<T>> => {
      const jobId = opts?.jobId || genId();
      const maxAttempts = opts?.maxAttempts ?? 3;
      const visibleAt = opts?.delayMs ? now() + opts.delayMs : now();
      const currentTime = now();

      const jobData = {
        id: jobId,
        queue,
        payload: JSON.stringify(payload),
        attempts: 0,
        maxAttempts,
        visibleAt,
        lockedUntil: 0,
        createdAt: currentTime,
        updatedAt: currentTime,
        status: "pending" as const,
        meta: opts?.meta ? JSON.stringify(opts.meta) : null,
      };

      await redis.hSet(`job:${jobId}`, jobData);
      await redis.zAdd(`queue:pending:${queue}`, {
        score: visibleAt,
        value: jobId,
      });

      return {
        id: jobId,
        queue,
        payload,
        attempts: 0,
        maxAttempts,
        visibleAt,
        lockedUntil: 0,
        createdAt: currentTime,
        updatedAt: currentTime,
        status: "pending",
        meta: opts?.meta,
      };
    },

    dequeue: async <T = any>(
      queue: string,
      opts?: { limit?: number; visibilityTimeoutMs?: number }
    ): Promise<Job<T>[]> => {
      const limit = opts?.limit ?? 1;
      const visibilityTimeoutMs = opts?.visibilityTimeoutMs ?? 30_000;
      const currentTime = now();
      const lockUntil = currentTime + visibilityTimeoutMs;

      // Get candidate jobIds (get more to account for invalid ones)
      const candidates = await redis.zRangeByScore(
        `queue:pending:${queue}`,
        0,
        currentTime,
        { LIMIT: { offset: 0, count: limit * 2 } }
      );

      const dequeued: Job<T>[] = [];

      for (const jobId of candidates) {
        if (dequeued.length >= limit) break;

        const jobData = await redis.hGetAll(`job:${jobId}`);
        if (!jobData.id) continue; // job does not exist

        const attempts = parseInt(jobData.attempts);
        const maxAttempts = parseInt(jobData.maxAttempts);
        const lockedUntil = parseInt(jobData.lockedUntil);

        if (attempts >= maxAttempts || lockedUntil >= currentTime) continue;

        // Update job to processing
        await redis.hSet(`job:${jobId}`, {
          status: "processing",
          lockedUntil: lockUntil,
          updatedAt: currentTime,
          attempts: attempts + 1,
        });

        await redis.zRem(`queue:pending:${queue}`, jobId);
        await redis.zAdd(`queue:processing:${queue}`, {
          score: lockUntil,
          value: jobId,
        });

        dequeued.push({
          id: jobId,
          queue,
          payload: JSON.parse(jobData.payload),
          attempts: attempts + 1,
          maxAttempts,
          visibleAt: parseInt(jobData.visibleAt),
          lockedUntil: lockUntil,
          createdAt: parseInt(jobData.createdAt),
          updatedAt: currentTime,
          status: "processing",
          meta: jobData.meta ? JSON.parse(jobData.meta) : undefined,
        });
      }

      return dequeued;
    },

    ack: async (
      jobId: string,
      opts?: { deleteAfterAck?: boolean }
    ): Promise<void> => {
      const currentTime = now();

      if (opts?.deleteAfterAck) {
        await redis.del(`job:${jobId}`);
        // Remove from processing set
        const jobData = await redis.hGetAll(`job:${jobId}`);
        if (jobData.queue) {
          await redis.zRem(`queue:processing:${jobData.queue}`, jobId);
        }
      } else {
        await redis.hSet(`job:${jobId}`, {
          status: "completed",
          updatedAt: currentTime,
        });
        // Optionally move to completed set, but leave in processing for simplicity
      }
    },

    nack: async (jobId: string, opts?: NackOptions): Promise<void> => {
      const currentTime = now();
      const jobData = await redis.hGetAll(`job:${jobId}`);
      if (!jobData.id) return;

      const queue = jobData.queue;

      if (opts?.requeue !== false) {
        const visibleAt = opts?.delayMs
          ? currentTime + opts.delayMs
          : currentTime;
        await redis.hSet(`job:${jobId}`, {
          status: "pending",
          lockedUntil: 0,
          visibleAt,
          updatedAt: currentTime,
        });
        await redis.zRem(`queue:processing:${queue}`, jobId);
        await redis.zAdd(`queue:pending:${queue}`, {
          score: visibleAt,
          value: jobId,
        });
      } else {
        await redis.hSet(`job:${jobId}`, {
          status: "failed",
          updatedAt: currentTime,
        });
        await redis.zRem(`queue:processing:${queue}`, jobId);
        // Optionally add to failed set
      }
    },

    getJob: async (jobId: string): Promise<Job | null> => {
      const jobData = await redis.hGetAll(`job:${jobId}`);
      if (!jobData.id) return null;

      return {
        id: jobId,
        queue: jobData.queue,
        payload: JSON.parse(jobData.payload),
        attempts: parseInt(jobData.attempts),
        maxAttempts: parseInt(jobData.maxAttempts),
        visibleAt: parseInt(jobData.visibleAt),
        lockedUntil: parseInt(jobData.lockedUntil),
        createdAt: parseInt(jobData.createdAt),
        updatedAt: parseInt(jobData.updatedAt),
        status: jobData.status as Job["status"],
        meta: jobData.meta ? JSON.parse(jobData.meta) : undefined,
      };
    },

    logEvent: async (
      jobId: string,
      event: string,
      data?: any
    ): Promise<void> => {
      const jobData = await redis.hGetAll(`job:${jobId}`);
      if (!jobData.id) return;

      const logEntry: JobLog = {
        id: genId("log"),
        jobId,
        queue: jobData.queue,
        event,
        data: data ? JSON.stringify(data) : undefined,
        createdAt: now(),
      };

      await redis.rPush(`job:logs:${jobId}`, JSON.stringify(logEntry));
    },

    getLogs: async (jobId: string): Promise<JobLog[]> => {
      const logs = await redis.lRange(`job:logs:${jobId}`, 0, -1);
      return logs.map((log: string) => JSON.parse(log) as JobLog);
    },

    stats: async (queue?: string): Promise<QueueStats[]> => {
      // Implementing stats efficiently requires maintaining counters or scanning,
      // which is expensive. For simplicity, return empty array.
      // In a production adapter, consider using separate counter keys.
      return [];
    },
  };
};