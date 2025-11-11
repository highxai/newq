import type { Collection, Db } from "mongodb";
import type {
  Adapter,
  EnqueueOptions,
  Job,
  JobLog,
  NackOptions,
  QueueStats,
} from "../core/types";
import { genId, now } from "../core/utils";

// MongoDB collection names
const JOBS_COLLECTION = "newq_jobs";
const JOB_LOGS_COLLECTION = "newq_job_logs";

// MongoDB document interfaces
interface JobDocument {
  _id: string;
  queue: string;
  payload: string; // JSON string
  attempts: number;
  maxAttempts: number;
  visibleAt: number;
  lockedUntil: number;
  createdAt: number;
  updatedAt: number;
  status: string;
  meta?: string; // JSON string
}

interface JobLogDocument {
  _id: string;
  jobId: string;
  queue: string;
  event: string;
  data?: string; // JSON string
  createdAt: number;
}

export const mongodbAdapter = (db: Db): Adapter => {
  const jobsCollection: Collection<JobDocument> =
    db.collection(JOBS_COLLECTION);
  const logsCollection: Collection<JobLogDocument> =
    db.collection(JOB_LOGS_COLLECTION);

  return {
    init: async () => {
      // Create indexes for optimal performance
      await jobsCollection.createIndex({
        queue: 1,
        status: 1,
        visibleAt: 1,
        lockedUntil: 1,
      });
      await jobsCollection.createIndex({ createdAt: 1 });
      await logsCollection.createIndex({ jobId: 1 });
      await logsCollection.createIndex({ createdAt: -1 });
    },

    enqueue: async <T = unknown>(
      queue: string,
      payload: T,
      opts?: EnqueueOptions
    ): Promise<Job<T>> => {
      const jobId = opts?.jobId || genId();
      const maxAttempts = opts?.maxAttempts ?? 3;
      const visibleAt = opts?.delayMs ? now() + opts.delayMs : now();
      const currentTime = now();

      const jobDoc: JobDocument = {
        _id: jobId,
        queue,
        payload: JSON.stringify(payload),
        attempts: 0,
        maxAttempts,
        visibleAt,
        lockedUntil: 0,
        createdAt: currentTime,
        updatedAt: currentTime,
        status: "pending",
        meta: opts?.meta ? JSON.stringify(opts.meta) : undefined,
      };

      await jobsCollection.insertOne(jobDoc);

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

    dequeue: async <T = unknown>(
      queue: string,
      opts?: { limit?: number; visibilityTimeoutMs?: number }
    ): Promise<Job<T>[]> => {
      const limit = opts?.limit ?? 1;
      const visibilityTimeoutMs = opts?.visibilityTimeoutMs ?? 30_000;
      const currentTime = now();
      const newLockedUntil = currentTime + visibilityTimeoutMs;

      const jobs: Job<T>[] = [];

      // Use a loop to claim jobs one by one to ensure atomicity
      for (let i = 0; i < limit; i++) {
        // First, find a candidate job that we can attempt to claim
        const candidate = await jobsCollection.findOne(
          {
            queue,
            status: "pending",
            visibleAt: { $lte: currentTime },
            lockedUntil: { $lt: currentTime },
          },
          {
            sort: { createdAt: 1 },
          }
        );

        if (!candidate) break; // No more jobs available

        // Check if this job has attempts remaining
        if (candidate.attempts >= candidate.maxAttempts) {
          // Mark as failed and skip
          await jobsCollection.updateOne(
            { _id: candidate._id },
            { $set: { status: "failed", updatedAt: currentTime } }
          );
          continue;
        }

        // Atomically claim the job
        const result = await jobsCollection.findOneAndUpdate(
          {
            _id: candidate._id,
            status: "pending", // Ensure it's still available
            lockedUntil: { $lt: currentTime },
          },
          {
            $set: {
              status: "processing",
              lockedUntil: newLockedUntil,
              updatedAt: currentTime,
            },
            $inc: { attempts: 1 },
          },
          {
            returnDocument: "after",
          }
        );

        if (!result) continue; // Job was claimed by another worker

        const job = result as JobDocument;
        jobs.push({
          id: job._id,
          queue: job.queue,
          payload: JSON.parse(job.payload),
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          visibleAt: job.visibleAt,
          lockedUntil: job.lockedUntil,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          status: job.status as Job["status"],
          meta: job.meta ? JSON.parse(job.meta) : undefined,
        });
      }

      return jobs;
    },

    ack: async (
      jobId: string,
      opts?: { deleteAfterAck?: boolean }
    ): Promise<void> => {
      const currentTime = now();

      if (opts?.deleteAfterAck) {
        await jobsCollection.deleteOne({ _id: jobId });
      } else {
        await jobsCollection.updateOne(
          { _id: jobId },
          {
            $set: {
              status: "completed",
              updatedAt: currentTime,
            },
          }
        );
      }
    },

    nack: async (jobId: string, opts?: NackOptions): Promise<void> => {
      const currentTime = now();

      if (opts?.requeue !== false) {
        const visibleAt = opts?.delayMs
          ? currentTime + opts.delayMs
          : currentTime;
        await jobsCollection.updateOne(
          { _id: jobId },
          {
            $set: {
              status: "pending",
              lockedUntil: 0,
              visibleAt,
              updatedAt: currentTime,
            },
          }
        );
      } else {
        await jobsCollection.updateOne(
          { _id: jobId },
          {
            $set: {
              status: "failed",
              updatedAt: currentTime,
            },
          }
        );
      }
    },

    getJob: async (jobId: string): Promise<Job | null> => {
      const job = await jobsCollection.findOne({ _id: jobId });
      if (!job) return null;

      return {
        id: job._id,
        queue: job.queue,
        payload: JSON.parse(job.payload),
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        visibleAt: job.visibleAt,
        lockedUntil: job.lockedUntil,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        status: job.status as Job["status"],
        meta: job.meta ? JSON.parse(job.meta) : undefined,
      };
    },

    logEvent: async (
      jobId: string,
      event: string,
      data?: unknown
    ): Promise<void> => {
      const job = await jobsCollection.findOne({ _id: jobId });
      if (!job) return;

      await logsCollection.insertOne({
        _id: genId("log"),
        jobId,
        queue: job.queue,
        event,
        data: data ? JSON.stringify(data) : undefined,
        createdAt: now(),
      });
    },

    getLogs: async (jobId: string): Promise<JobLog[]> => {
      const logs = await logsCollection
        .find({ jobId })
        .sort({ createdAt: -1 })
        .toArray();

      return logs.map((log: JobLogDocument) => ({
        id: log._id,
        jobId: log.jobId,
        queue: log.queue,
        event: log.event,
        data: log.data ? JSON.parse(log.data) : undefined,
        createdAt: log.createdAt,
      }));
    },

    stats: async (queue?: string): Promise<QueueStats[]> => {
      const matchStage = queue ? { queue } : {};

      const stats = await jobsCollection
        .aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: { queue: "$queue", status: "$status" },
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: "$_id.queue",
              pending: {
                $sum: {
                  $cond: [{ $eq: ["$_id.status", "pending"] }, "$count", 0],
                },
              },
              processing: {
                $sum: {
                  $cond: [{ $eq: ["$_id.status", "processing"] }, "$count", 0],
                },
              },
              completed: {
                $sum: {
                  $cond: [{ $eq: ["$_id.status", "completed"] }, "$count", 0],
                },
              },
              failed: {
                $sum: {
                  $cond: [{ $eq: ["$_id.status", "failed"] }, "$count", 0],
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              queue: "$_id",
              pending: 1,
              processing: 1,
              completed: 1,
              failed: 1,
            },
          },
        ])
        .toArray();

      return stats as QueueStats[];
    },
  };
};
