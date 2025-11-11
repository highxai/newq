# Examples

This directory contains real-world examples demonstrating how to use the newq queue system.

## Examples

### `simple-test.ts`
A basic test that demonstrates the core queue functionality:
- Enqueuing jobs
- Setting up workers
- Processing jobs
- Checking job status

Run with: `bun run examples/simple-test.ts`

### `sync-demo.ts` ⭐ **Recommended**
A complete synchronous demo showing:
- Multiple queue types with type safety
- Worker concurrency (processing multiple jobs simultaneously)
- Job processing and acknowledgment
- Queue statistics and monitoring
- Real-time job tracking

Run with: `bun run examples/sync-demo.ts`

### `email-queue.ts`
A comprehensive example of an email processing system that shows:
- Type-safe queue definitions for multiple job types
- Worker concurrency and error handling
- Job retries with exponential backoff
- Logging and monitoring
- Multiple service integrations

**Note**: This example runs workers indefinitely. Use Ctrl+C to stop.

Run with: `bun run examples/email-queue.ts`

## Key Concepts Demonstrated

### Type-Safe Queues
```ts
type JobQueues = {
  email: { to: string; subject: string; template: string };
  notification: { userId: string; type: string; message: string };
};
```

### Worker Setup
```ts
const worker = createWorker<JobQueues>(adapter, {
  concurrency: 3,
  pollInterval: 1000,
});

worker.listen("email", async (ctx) => {
  // Process email job
  await ctx.ack();
});
```

### Error Handling & Retries
```ts
worker.listen("email", async (ctx) => {
  try {
    await sendEmail(ctx.job.payload);
    await ctx.ack();
  } catch (error) {
    // Retry with backoff
    await ctx.retry(1000 * Math.pow(2, ctx.job.attempts));
  }
});
```

### Adapters
- **In-Memory**: For testing and development
- **Drizzle**: For LibSQL/Turso databases
- **MongoDB**: For MongoDB deployments

## Running Examples

```bash
# Simple test
bun run examples/simple-test.ts

# Email processing demo
bun run examples/email-queue.ts
```

## Production Considerations

- Use persistent adapters (Drizzle/MongoDB) in production
- Configure appropriate concurrency levels
- Set up proper monitoring and alerting
- Implement dead letter queues for failed jobs
- Use health checks and graceful shutdowns