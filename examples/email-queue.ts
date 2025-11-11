/**
 * Real-world Email Processing Queue Example
 *
 * This example demonstrates a production-ready email processing system using newq.
 * It shows:
 * - Type-safe queue definitions
 * - Multiple job types (welcome emails, notifications, analytics)
 * - Worker concurrency and error handling
 * - Job retries and dead letter queues
 * - Monitoring and logging
 * - Multiple adapters (in-memory for testing, Drizzle for persistence)
 */

import {
  createQueue,
  createWorker,
  inMemoryAdapter,
  drizzleAdapter,
} from "../index";

// ============================================================================
// Type Definitions
// ============================================================================

// Define all possible job types in our system
type JobQueues = {
  // Email jobs
  email: {
    type: "welcome" | "password_reset" | "notification";
    to: string;
    subject: string;
    template: string;
    data: Record<string, any>;
  };

  // User notification jobs
  notification: {
    userId: string;
    type: "push" | "sms" | "in_app" | "email";
    title: string;
    message: string;
    priority: "low" | "medium" | "high";
  };

  // Analytics jobs
  analytics: {
    event: string;
    userId?: string;
    properties: Record<string, any>;
    timestamp: number;
  };
};

// ============================================================================
// Mock Services (in real app, these would be actual services)
// ============================================================================

class EmailService {
  private sentEmails: Array<{ to: string; subject: string; template: string }> = [];

  async sendEmail(to: string, subject: string, template: string, data: any): Promise<void> {
    // Simulate email sending with random failures for demo
    if (Math.random() < 0.1) { // 10% failure rate
      throw new Error(`Failed to send email to ${to}`);
    }

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    this.sentEmails.push({ to, subject, template });
    console.log(`📧 Email sent: ${subject} -> ${to}`);
  }

  getSentEmails() {
    return this.sentEmails;
  }
}

class NotificationService {
  private notifications: Array<{ userId: string; type: string; title: string }> = [];

  async sendNotification(userId: string, type: string, title: string, message: string): Promise<void> {
    // Simulate notification sending
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

    this.notifications.push({ userId, type, title });
    console.log(`🔔 Notification sent: ${type} -> ${userId}: ${title}`);
  }

  getNotifications() {
    return this.notifications;
  }
}

class AnalyticsService {
  private events: Array<{ event: string; userId?: string; properties: any }> = [];

  async trackEvent(event: string, userId: string | undefined, properties: any): Promise<void> {
    // Simulate analytics processing
    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 50));

    this.events.push({ event, userId, properties });
    console.log(`📊 Event tracked: ${event}${userId ? ` for user ${userId}` : ""}`);
  }

  getEvents() {
    return this.events;
  }
}

// ============================================================================
// Queue Setup
// ============================================================================

async function setupQueues(usePersistentStorage = false) {
  let adapter;

  if (usePersistentStorage) {
    // In a real app, you'd set up Drizzle with LibSQL/Turso
    console.log("Using persistent storage (Drizzle + LibSQL)");
    // const client = createClient({ url: "file:queue.db" });
    // const db = drizzle(client, { schema: { jobs, jobLogs } });
    // adapter = drizzleAdapter(db);
    // For demo, fall back to in-memory
    adapter = inMemoryAdapter();
  } else {
    console.log("Using in-memory storage for demo");
    adapter = inMemoryAdapter();
  }

  // Create queue with configuration
  const queue = createQueue<JobQueues>(adapter, {
    archiveOnComplete: true, // Keep completed jobs for analytics
    autoDeleteOnAck: false,
  });

  return { queue, adapter };
}

// ============================================================================
// Worker Setup
// ============================================================================

function setupWorkers(queue: ReturnType<typeof createQueue>, services: {
  email: EmailService;
  notification: NotificationService;
  analytics: AnalyticsService;
}) {
  const { email: emailService, notification: notificationService, analytics: analyticsService } = services;

  // Email worker with concurrency
  const emailWorker = createWorker<JobQueues>(queue._adapter, {
    concurrency: 3, // Process up to 3 emails simultaneously
    pollInterval: 500, // Poll every 500ms for faster demo
    logger: (event, data) => console.log(`📧 Email Worker: ${event}`, data),
  });

  emailWorker.listen("email", async (ctx) => {
    const { type, to, subject, template, data } = ctx.job.payload;

    try {
      await emailService.sendEmail(to, subject, template, data);

      // Track successful email send
      await ctx.log("email_sent", { template, recipient: to });

      await ctx.ack();
    } catch (error) {
      console.error(`❌ Failed to send ${type} email to ${to}:`, error);

      // Log the failure
      await ctx.log("email_failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        template,
        recipient: to
      });

      // Retry with exponential backoff, max 3 attempts
      if (ctx.job.attempts < ctx.job.maxAttempts) {
        await ctx.retry(1000 * Math.pow(2, ctx.job.attempts)); // 1s, 2s, 4s
      } else {
        // Mark as failed - this would go to a dead letter queue in production
        await ctx.nack({ requeue: false });
      }
    }
  });

  // Notification worker
  const notificationWorker = createWorker<JobQueues>(queue._adapter, {
    concurrency: 5, // Higher concurrency for notifications
    logger: (event, data) => console.log(`🔔 Notification Worker: ${event}`, data),
  });

  notificationWorker.listen("notification", async (ctx) => {
    const { userId, type, title, message, priority } = ctx.job.payload;

    try {
      await notificationService.sendNotification(userId, type, title, message);

      // High priority notifications get logged
      if (priority === "high") {
        await ctx.log("high_priority_notification_sent", { userId, type });
      }

      await ctx.ack();
    } catch (error) {
      console.error(`❌ Failed to send ${type} notification to ${userId}:`, error);
      await ctx.nack({ requeue: true, delayMs: 5000 }); // Retry after 5 seconds
    }
  });

  // Analytics worker (fire-and-forget style)
  const analyticsWorker = createWorker<JobQueues>(queue._adapter, {
    concurrency: 10, // High concurrency for analytics
    logger: (event, data) => console.log(`📊 Analytics Worker: ${event}`, data),
  });

  analyticsWorker.listen("analytics", async (ctx) => {
    const { event, userId, properties } = ctx.job.payload;

    try {
      await analyticsService.trackEvent(event, userId, properties);
      await ctx.ack();
    } catch (error) {
      // Analytics failures are not critical, just log and continue
      console.error(`⚠️ Analytics tracking failed for ${event}:`, error);
      await ctx.ack(); // Still ack to prevent infinite retries
    }
  });

  return { emailWorker, notificationWorker, analyticsWorker };
}

// ============================================================================
// Demo Scenarios
// ============================================================================

async function runDemo() {
  console.log("🚀 Starting Email Queue Demo\n");

  // Setup services
  const services = {
    email: new EmailService(),
    notification: new NotificationService(),
    analytics: new AnalyticsService(),
  };

  // Setup queues and workers
  const { queue } = await setupQueues();
  const workers = setupWorkers(queue, services);

  // Start all workers
  console.log("Starting workers...");
  workers.emailWorker.start();
  workers.notificationWorker.start();
  workers.analyticsWorker.start();
  console.log("Workers started!");

  console.log("\n📨 Enqueueing demo jobs...\n");

  // Scenario 1: User registration flow
  console.log("Scenario 1: User Registration");
  const userId = "user_123";
  const userEmail = "john@example.com";

  // Welcome email
  await queue.enqueue("email", {
    type: "welcome",
    to: userEmail,
    subject: "Welcome to Our Platform!",
    template: "welcome",
    data: { name: "John", loginUrl: "https://app.example.com/login" },
  });

  // Welcome notification
  await queue.enqueue("notification", {
    userId,
    type: "push",
    title: "Welcome!",
    message: "Thanks for joining our platform",
    priority: "medium",
  });

  // Analytics event
  await queue.enqueue("analytics", {
    event: "user_registered",
    userId,
    properties: { source: "web", plan: "free" },
    timestamp: Date.now(),
  });

  // Scenario 2: Password reset
  console.log("\nScenario 2: Password Reset");
  await queue.enqueue("email", {
    type: "password_reset",
    to: userEmail,
    subject: "Reset Your Password",
    template: "password_reset",
    data: { resetToken: "abc123", resetUrl: "https://app.example.com/reset?token=abc123" },
  }, {
    maxAttempts: 2, // Password resets are time-sensitive
  });

  // High-priority notification
  await queue.enqueue("notification", {
    userId,
    type: "push",
    title: "Security Alert",
    message: "Password reset requested",
    priority: "high",
  });

  // Scenario 3: Bulk notifications (simulating a marketing campaign)
  console.log("\nScenario 3: Bulk Notifications");
  const users = ["alice@example.com", "bob@example.com", "charlie@example.com"];

  for (let i = 0; i < users.length; i++) {
    await queue.enqueue("notification", {
      userId: `user_${i + 1}`,
      type: "email",
      title: "New Feature Available",
      message: "Check out our latest feature!",
      priority: "low",
    }, {
      delayMs: i * 1000, // Stagger notifications
    });
  }

  // Scenario 4: Error simulation
  console.log("\nScenario 4: Error Handling");
  await queue.enqueue("email", {
    type: "notification",
    to: "error@example.com", // This will fail
    subject: "This will fail",
    template: "error_template",
    data: {},
  });

  // Wait for processing
  console.log("\n⏳ Processing jobs...");
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Check results
  console.log("\n📊 Results:");
  console.log(`Emails sent: ${services.email.getSentEmails().length}`);
  console.log(`Notifications sent: ${services.notification.getNotifications().length}`);
  console.log(`Analytics events: ${services.analytics.getEvents().length}`);

  // Check queue stats
  const stats = await queue.getStats();
  console.log("\n📈 Queue Statistics:");
  stats.forEach(stat => {
    console.log(`${stat.queue}: ${stat.pending} pending, ${stat.processing} processing, ${stat.completed} completed, ${stat.failed} failed`);
  });

  // Get some job details
  const jobs = await queue.getJob("job_1"); // Get first job
  if (jobs) {
    console.log(`\n🔍 Sample Job: ${jobs.id} (${jobs.status})`);
    const logs = await queue.getLogs(jobs.id);
    console.log(`Job has ${logs.length} log entries`);
  }

  // Graceful shutdown
  console.log("\n🛑 Shutting down workers...");
  await Promise.all([
    workers.emailWorker.stop(),
    workers.notificationWorker.stop(),
    workers.analyticsWorker.stop(),
  ]);

  console.log("✅ Demo completed!");
}

// ============================================================================
// Run the demo
// ============================================================================

if (import.meta.main) {
  runDemo().catch(console.error);
}

export { runDemo };