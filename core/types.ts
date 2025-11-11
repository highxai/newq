export type ISOTime = number;

export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export type Job<T = any> = {
  id: string;
  queue: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
  visibleAt: number; // ms epoch
  lockedUntil: number; // ms epoch
  createdAt: ISOTime;
  updatedAt: ISOTime;
  status: JobStatus;
  meta?: Record<string, any>;
};

export type EnqueueOptions = {
  jobId?: string;
  delayMs?: number;
  maxAttempts?: number;
  overwrite?: boolean;
  meta?: Record<string, any>;
};

export type DequeueOptions = {
  limit?: number;
  visibilityTimeoutMs?: number;
};

export type NackOptions = {
  requeue?: boolean;
  delayMs?: number;
};

export type JobLog = {
  id: string;
  jobId: string;
  queue: string;
  event: string;
  data?: any;
  createdAt: ISOTime;
};

export type QueueStats = {
  queue: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
};

export type CreateQueueOptions = {
  archiveOnComplete?: boolean; // default true (keeps completed jobs)
  autoDeleteOnAck?: boolean; // default false (if true, ack deletes row)
  visibilityTimeout?: number; // default 30_000 (ms)
  pollInterval?: number; // default 1000 (ms)
};

export type CreateWorkerOptions = {
  concurrency?: number; // default 1
  pollInterval?: number; // default 1000 (ms)
  visibilityTimeout?: number; // default 30_000 (ms)
  logger?: (event: string, data: any) => void;
};

export type WorkerContext<T = any> = {
  job: Job<T>;
  ack(): Promise<void>;
  nack(opts?: NackOptions): Promise<void>;
  retry(delayMs?: number): Promise<void>;
  log(event: string, data?: any): Promise<void>;
};

export type QueueHandler<T = any> = (ctx: WorkerContext<T>) => Promise<void>;

export type Adapter = {
  init?: () => Promise<void>;
  enqueue: <T = any>(
    queue: string,
    payload: T,
    opts?: EnqueueOptions
  ) => Promise<Job<T>>;
  dequeue: <T = any>(queue: string, opts?: DequeueOptions) => Promise<Job<T>[]>;
  ack: (jobId: string, opts?: { deleteAfterAck?: boolean }) => Promise<void>;
  nack: (jobId: string, opts?: NackOptions) => Promise<void>;
  getJob: (jobId: string) => Promise<Job | null>;
  logEvent: (jobId: string, event: string, data?: any) => Promise<void>;
  getLogs: (jobId: string) => Promise<JobLog[]>;
  stats?: (queue?: string) => Promise<QueueStats[]>;
};
