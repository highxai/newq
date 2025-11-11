/**
 * Synchronous Queue Demo
 *
 * This example shows how to process jobs synchronously without running
 * workers indefinitely. Useful for demos and testing.
 */

import { createQueue, createWorker, inMemoryAdapter } from "../index";

type DemoQueues = {
  email: { to: string; subject: string; body: string };
  process: { task: string; priority: number };
};

async function syncDemo() {
  console.log("🔄 Synchronous Queue Demo\n");

  const adapter = inMemoryAdapter();
  const queue = createQueue<DemoQueues>(adapter);

  // Create worker
  const worker = createWorker<DemoQueues>(adapter, {
    concurrency: 2,
    pollInterval: 100, // Fast polling
  });

  // Track processed jobs
  const processedJobs: string[] = [];

  // Set up listeners
  worker.listen("email", async (ctx) => {
    const { to, subject } = ctx.job.payload;
    console.log(`📧 Sending email: ${subject} -> ${to}`);

    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 200));

    processedJobs.push(`email-${ctx.job.id}`);
    await ctx.ack();
  });

  worker.listen("process", async (ctx) => {
    const { task, priority } = ctx.job.payload;
    console.log(`⚙️ Processing task: ${task} (priority: ${priority})`);

    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 100));

    processedJobs.push(`process-${ctx.job.id}`);
    await ctx.ack();
  });

  // Start worker in background
  worker.start();

  console.log("📨 Enqueueing jobs...\n");

  // Enqueue various jobs
  const jobs = await Promise.all([
    queue.enqueue("email", {
      to: "user1@example.com",
      subject: "Welcome!",
      body: "Welcome to our platform"
    }),
    queue.enqueue("email", {
      to: "user2@example.com",
      subject: "Newsletter",
      body: "Check out our latest updates"
    }),
    queue.enqueue("process", {
      task: "data_cleanup",
      priority: 1
    }),
    queue.enqueue("process", {
      task: "cache_warmup",
      priority: 2
    }),
    queue.enqueue("process", {
      task: "report_generation",
      priority: 3
    }),
  ]);

  console.log(`✅ Enqueued ${jobs.length} jobs\n`);

  // Wait for all jobs to be processed
  console.log("⏳ Waiting for processing...");
  let attempts = 0;
  while (processedJobs.length < jobs.length && attempts < 50) {
    await new Promise(resolve => setTimeout(resolve, 200));
    attempts++;
  }

  // Stop worker
  worker.stop();

  console.log(`\n✅ Processed ${processedJobs.length}/${jobs.length} jobs`);

  // Show queue stats
  const stats = await queue.getStats();
  console.log("\n📊 Queue Statistics:");
  stats.forEach(stat => {
    console.log(`  ${stat.queue}: ${stat.completed} completed`);
  });

  // Show a job's logs
  const sampleJob = jobs[0];
  const logs = await queue.getLogs(sampleJob.id);
  console.log(`\n📝 Job ${sampleJob.id} has ${logs.length} log entries`);

  console.log("\n🎉 Demo completed!");
}

// ============================================================================
// Run the demo
// ============================================================================

if (import.meta.main) {
  syncDemo().catch(console.error);
}

export { syncDemo };