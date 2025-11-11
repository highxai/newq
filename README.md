# newq 🧩

**newq** is a minimal, modular, type-safe message queue for TypeScript — built for modern runtimes like **Bun**, **Node.js**, and **Deno**.

- 💡 **Functional** — no classes, no magic
- ⚙️ **Adapter-based** — supports Drizzle/SQLite (Turso), Redis, MongoDB, and more
- 🧠 **Fully type-safe** — your job payloads are statically typed
- ⚡ **Performant** — lightweight locking and concurrency-safe
- 🔒 **Reliable** — supports multiple replicas and workers
- 🧾 **Auditable** — built-in job logs and status tracking

---

## 🧱 Architecture Overview

### Core Concepts

| Concept | Description |
|----------|--------------|
| **Queue** | Logical channel where jobs are enqueued |
| **Job** | A single task with payload and metadata |
| **Worker** | Consumes and processes jobs from a queue |
| **Adapter** | Handles persistence and atomic job operations |
| **Audit Logs** | Immutable events for debugging and observability |

---

## 📦 Installation

```bash
bun add newq
# or
npm install newq
```

---

## ⚡ Quick Start

```ts
import { createQueue, createWorker } from "newq";
import { inMemoryAdapter } from "newq/adapters/in-memory";

type Queues = {
  email: { to: string; subject: string; body: string };
};

const adapter = inMemoryAdapter();

const queue = createQueue<Queues>(adapter, {
  archiveOnComplete: true,
});

// Enqueue job
await queue.enqueue("email", {
  to: "a@b.com",
  subject: "Welcome!",
  body: "Hello world!",
}, {
  jobId: "email:welcome:1",
});

// Worker listens for jobs
const worker = createWorker<Queues>(adapter, { concurrency: 5 });

worker.listen("email", async (ctx) => {
  await sendEmail(ctx.job.payload);
  await ctx.ack();
});

// Check status
const job = await queue.getJob("email:welcome:1");
console.log(job.status); // 'completed'

const logs = await queue.getLogs("email:welcome:1");
console.log(logs);
```

---

## 🧩 API Reference

### `createQueue(adapter, options)`
Creates a new queue instance bound to an adapter.

#### Options
| Key | Type | Default | Description |
|-----|------|----------|-------------|
| `archiveOnComplete` | `boolean` | `true` | Whether to retain completed jobs |
| `autoDeleteOnAck` | `boolean` | `false` | Delete job after completion |
| `visibilityTimeout` | `number` | `30_000` | Default lock period (ms) |
| `pollInterval` | `number` | `1000` | Worker polling interval (ms) |

#### Methods
| Method | Description |
|---------|--------------|
| `enqueue(name, payload, opts?)` | Adds a job to a queue |
| `getJob(jobId)` | Returns full job info |
| `getLogs(jobId)` | Returns all audit logs for job |
| `stats()` | Optional queue statistics (adapter-specific) |

#### Enqueue Options
| Key | Type | Description |
|------|------|-------------|
| `jobId` | `string` | Custom unique job ID |
| `delayMs` | `number` | Delay before job becomes visible |
| `maxAttempts` | `number` | Retry limit |
| `overwrite` | `boolean` | Replace if existing ID |

---

### `createWorker(adapter, options)`
Creates a worker loop to process queued jobs.

#### Options
| Key | Type | Default | Description |
|------|------|----------|-------------|
| `concurrency` | `number` | `1` | Number of parallel processors |
| `pollInterval` | `number` | `1000` | Milliseconds between polls |
| `visibilityTimeout` | `number` | `30_000` | Lock expiration period |

#### Methods
| Method | Description |
|---------|--------------|
| `listen(queueName, handler)` | Register handler for specific queue |
| `stop()` | Gracefully stop the worker |

---

### `ctx` (Worker Context)
The object passed to each job handler:

```ts
interface WorkerContext<T> {
  job: Job<T>;
  ack(): Promise<void>;
  nack(): Promise<void>;
  retry(delayMs?: number): Promise<void>;
  log(event: string, data?: any): Promise<void>;
}
```

---

## 🧾 Data Models

### `Job`
```ts
interface Job<TPayload = any> {
  id: string;
  queue: string;
  payload: TPayload;
  attempts: number;
  maxAttempts: number;
  visibleAt: number;
  lockedUntil: number;
  createdAt: number;
  updatedAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
  meta?: Record<string, any>;
}
```

### `JobLog`
```ts
interface JobLog {
  id: string;
  jobId: string;
  queue: string;
  event: 'enqueue' | 'dequeue' | 'ack' | 'nack' | 'retry' | 'expire' | 'delete';
  data?: any;
  createdAt: number;
}
```

---

## 🧱 Adapter Interface

```ts
interface Adapter {
  enqueue(queue: string, payload: any, options?: EnqueueOptions): Promise<Job>;
  dequeue(queue: string, opts: DequeueOptions): Promise<Job[]>;
  ack(jobId: string): Promise<void>;
  nack(jobId: string, opts?: NackOptions): Promise<void>;
  getJob(jobId: string): Promise<Job | null>;
  logEvent(jobId: string, event: string, data?: any): Promise<void>;
  getLogs(jobId: string): Promise<JobLog[]>;
  stats?(queue?: string): Promise<QueueStats[]>;
}
```

Adapters must ensure atomicity and consistency across multiple replicas.

### 🧩 Drizzle (LibSQL/Turso) Usage

```ts
import { createQueue } from "newq";
import { drizzleAdapter } from "newq/adapters/drizzle-sqlite";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Drizzle schema definitions
const jobs = sqliteTable("newq_jobs", {
  id: text("id").primaryKey(),
  queue: text("queue").notNull(),
  payload: text("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  visibleAt: integer("visible_at").notNull(),
  lockedUntil: integer("locked_until").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  status: text("status").notNull().default("pending"),
  meta: text("meta"),
});

const jobLogs = sqliteTable("newq_job_logs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  queue: text("queue").notNull(),
  event: text("event").notNull(),
  data: text("data"),
  createdAt: integer("created_at").notNull(),
});

// Initialize LibSQL client (works with local files or Turso URLs)
const client = createClient({
  url: "file:queue.db", // or your Turso database URL
});

const db = drizzle(client);

const adapter = drizzleAdapter(db, { jobs, jobLogs });
const queue = createQueue(adapter);
```

### 🍃 MongoDB Usage

```ts
import { createQueue } from "newq";
import { mongoAdapter } from "newq/adapters/mongodb";
import { MongoClient } from "mongodb";

// Connect to MongoDB
const client = new MongoClient("mongodb://localhost:27017");
await client.connect();
const db = client.db("queue_db");

// Initialize adapter (creates indexes automatically)
const adapter = mongoAdapter(db);
await adapter.init(); // Creates necessary indexes

const queue = createQueue(adapter);
```

### 🔴 Redis Usage (Coming Soon)

```ts
import { createQueue } from "newq";
import { redisAdapter } from "newq/adapters/redis";
import { createClient } from "redis";

// Connect to Redis
const redis = createClient({ url: "redis://localhost:6379" });
await redis.connect();

// Initialize adapter
const adapter = redisAdapter(redis);

const queue = createQueue(adapter);
```



---

## 🧰 Multi-Replica Safety

- Workers use atomic `UPDATE ... WHERE locked_until < now()` queries to claim jobs.
- `lockedUntil` and `visibleAt` prevent double-processing.
- If a worker crashes, the job becomes visible again after the visibility timeout.
- All lifecycle events are logged in `job_logs`.

---

## 🪶 Example of Multiple Workers

```ts
const workerA = createWorker(adapter, { concurrency: 2 });
const workerB = createWorker(adapter, { concurrency: 3 });

workerA.listen('email', handler);
workerB.listen('email', handler);
// Both coordinate safely using DB locks.
```

---

## 🔍 Queue Inspection

```ts
const job = await queue.getJob('email:welcome:1');
console.log(job.status, job.attempts);

const logs = await queue.getLogs('email:welcome:1');
logs.forEach(log => console.log(log.event, log.createdAt));
```

---

## 🔧 Configuration Examples

### Auto-delete completed jobs
```ts
createQueue(adapter, { autoDeleteOnAck: true });
```

### Custom job ID
```ts
queue.enqueue('email', payload, { jobId: 'custom-id' });
```

### Delayed job
```ts
queue.enqueue('email', payload, { delayMs: 5000 });
```

---

## 🛠️ Advanced Examples

### Error Handling and Retries

```ts
worker.listen("email", async (ctx) => {
  try {
    await sendEmail(ctx.job.payload);
    await ctx.ack(); // Mark as completed
  } catch (error) {
    console.error("Failed to send email:", error);
    if (ctx.job.attempts < ctx.job.maxAttempts) {
      await ctx.retry(1000 * ctx.job.attempts); // Exponential backoff
    } else {
      await ctx.nack(); // Fail permanently
    }
  }
});
```

### Logging Custom Events

```ts
worker.listen("email", async (ctx) => {
  await ctx.log("email_sent", { recipient: ctx.job.payload.to });
  await ctx.ack();
});

// Later, inspect logs
const logs = await queue.getLogs(jobId);
logs.forEach(log => console.log(`${log.event}: ${log.data?.recipient}`));
```

### Delayed Jobs and Scheduling

```ts
// Send welcome email after 1 hour
await queue.enqueue("email", welcomePayload, { delayMs: 60 * 60 * 1000 });

// Schedule recurring task (external cron)
setInterval(() => {
  queue.enqueue("cleanup", {});
}, 24 * 60 * 60 * 1000);
```

### Custom Job Metadata

```ts
await queue.enqueue("email", payload, {
  meta: { priority: "high", userId: 123 },
  maxAttempts: 5,
});

// Access in worker
console.log(ctx.job.meta.priority); // "high"
```

---

## 🧪 Testing In-Memory

```ts
import { inMemoryAdapter } from 'newq/adapters/in-memory';

const adapter = inMemoryAdapter();
const queue = createQueue(adapter);
```

Useful for local testing and development.

---

## 🛠️ Roadmap

- [x] Drizzle Adapter (LibSQL/Turso)
- [x] MongoDB Adapter
- [x] In-memory Adapter
- [ ] Redis Adapter
- [ ] S3 Adapter
- [ ] Job Dependencies
- [ ] Dead-letter Queue
- [ ] OpenTelemetry Integration
- [ ] Dashboard / CLI Inspector

---

## 📜 License

MIT

