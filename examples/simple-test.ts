/**
 * Simple test to verify the queue system works
 */

import { createQueue, createWorker, inMemoryAdapter } from "../index";

type TestQueues = {
  test: { message: string; count: number };
};

async function simpleTest() {
  console.log("🧪 Running simple queue test...");

  const adapter = inMemoryAdapter();
  const queue = createQueue<TestQueues>(adapter);

  // Enqueue a job
  console.log("📨 Enqueueing test job...");
  const job = await queue.enqueue("test", {
    message: "Hello World!",
    count: 42,
  });

  console.log(`✅ Job enqueued: ${job.id} (${job.status})`);

  // Check job details
  const retrievedJob = await queue.getJob(job.id);
  console.log(`📋 Retrieved job: ${retrievedJob?.payload.message}`);

  // Create a worker and process the job
  console.log("⚙️ Setting up worker...");
  const worker = createWorker<TestQueues>(adapter, {
    pollInterval: 100, // Fast polling for test
  });

  let processed = false;
  worker.listen("test", async (ctx) => {
    console.log(`🔄 Processing job: ${ctx.job.payload.message} (${ctx.job.payload.count})`);
    processed = true;
    await ctx.ack();
  });

  // Start worker
  console.log("▶️ Starting worker...");
  worker.start();

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 500));

  // Stop worker
  worker.stop();

  // Check results
  const finalJob = await queue.getJob(job.id);
  console.log(`🏁 Final job status: ${finalJob?.status}`);
  console.log(`✅ Job processed: ${processed}`);

  console.log("🎉 Simple test completed!");
}

if (import.meta.main) {
  simpleTest().catch(console.error);
}