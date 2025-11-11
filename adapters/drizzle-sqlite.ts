 import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { Adapter, EnqueueOptions, Job, QueueStats } from "../core/types";
import { genId, now } from "../core/utils";

type DrizzleSchema = {
  jobs: any;
  jobLogs: any;
};

type Database<S extends DrizzleSchema> = LibSQLDatabase<S>;

/**
 * Creates a Drizzle-based adapter for newq.
 *
 * @param db A Drizzle (libsql) database instance.
 * @param schema An object containing your jobs & jobLogs tables.
 * @returns A newq-compatible adapter.
 */
export const drizzleAdapter = <S extends DrizzleSchema>(
  db: Database<S>,
  schema: S
): Adapter => {
  const { jobs, jobLogs } = schema;

  return {
    init: async () => {
      // You can run migrations externally if desired
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

      await db.insert(jobs).values(jobData);

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

      const result = await db.transaction(async (tx) => {
        const availableJobs = await tx
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.queue, queue),
              eq(jobs.status, "pending"),
              lt(jobs.visibleAt, currentTime),
              lt(jobs.lockedUntil, currentTime),
              sql`${jobs.attempts} < ${jobs.maxAttempts}`
            )
          )
          .orderBy(jobs.createdAt)
          .limit(limit);

        if (availableJobs.length === 0) return [];

        const jobIds = availableJobs.map((job) => job.id);
        const newLockedUntil = currentTime + visibilityTimeoutMs;

        await tx
          .update(jobs)
          .set({
            status: "processing",
            lockedUntil: newLockedUntil,
            updatedAt: currentTime,
            attempts: sql`${jobs.attempts} + 1`,
          })
          .where(inArray(jobs.id, jobIds));

        return await tx
          .select()
          .from(jobs)
          .where(inArray(jobs.id, jobIds));
      });
      return result.map((row) => ({
        id: row.id,
        queue: row.queue,
        payload: JSON.parse(row.payload),
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        visibleAt: row.visibleAt,
        lockedUntil: row.lockedUntil,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        status: row.status as Job["status"],
        meta: row.meta ? JSON.parse(row.meta) : undefined,
      }));
    },

    ack: async (jobId, opts) => {
      const currentTime = now();
      if (opts?.deleteAfterAck) {
        await db.delete(jobs).where(eq(jobs.id, jobId));
      } else {
        await db
          .update(jobs)
          .set({ status: "completed", updatedAt: currentTime })
          .where(eq(jobs.id, jobId));
      }
    },

    nack: async (jobId, opts) => {
      const currentTime = now();
      if (opts?.requeue !== false) {
        const visibleAt = opts?.delayMs
          ? currentTime + opts.delayMs
          : currentTime;
        await db
          .update(jobs)
          .set({
            status: "pending",
            lockedUntil: 0,
            visibleAt,
            updatedAt: currentTime,
          })
          .where(eq(jobs.id, jobId));
      } else {
        await db
          .update(jobs)
          .set({ status: "failed", updatedAt: currentTime })
          .where(eq(jobs.id, jobId));
      }
    },

    getJob: async (jobId) => {
      const [row] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        queue: row.queue,
        payload: JSON.parse(row.payload),
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        visibleAt: row.visibleAt,
        lockedUntil: row.lockedUntil,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        status: row.status as Job["status"],
        meta: row.meta ? JSON.parse(row.meta) : undefined,
      };
    },

    logEvent: async (jobId, event, data) => {
      const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);
      if (!job) return;
      await db.insert(jobLogs).values({
        id: genId("log"),
        jobId,
        queue: job.queue,
        event,
        data: data ? JSON.stringify(data) : null,
        createdAt: now(),
      });
    },

    getLogs: async (jobId) => {
      const result = await db
        .select()
        .from(jobLogs)
        .where(eq(jobLogs.jobId, jobId))
        .orderBy(desc(jobLogs.createdAt));
      return result.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        queue: row.queue,
        event: row.event,
        data: row.data ? JSON.parse(row.data) : undefined,
        createdAt: row.createdAt,
      }));
    },

    stats: async (queue) => {
      let query = db
        .select({
          queue: jobs.queue,
          status: jobs.status,
          count: sql<number>`count(*)`,
        })
        .from(jobs)
        .groupBy(jobs.queue, jobs.status);

      if (queue) query = query.where(eq(jobs.queue, queue));

      const result = await query;
      const statsMap = new Map<string, QueueStats>();

      for (const row of result) {
        const stats = statsMap.get(row.queue) || {
          queue: row.queue,
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        };
        stats[row.status as keyof QueueStats] = row.count;
        statsMap.set(row.queue, stats);
      }

      return [...statsMap.values()];
    },
  };
};
