import cron from "node-cron";
import { db, autopilotTasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { shouldRunTask, runAutopilotTask } from "./autopilotEngine";
import { logger } from "../lib/logger";

let schedulerStarted = false;

export async function runAutopilotTick(): Promise<void> {
  try {
    const tasks = await db
      .select()
      .from(autopilotTasksTable)
      .where(eq(autopilotTasksTable.enabled, true));

    for (const task of tasks) {
      // shouldRunTask is now async — evaluates CRM conditions for
      // condition-based triggers, not just rate-limiting.
      const ready = await shouldRunTask(task).catch((err: unknown) => {
        logger.error({ err, taskId: task.id }, "[Autopilot] condition check failed");
        return false;
      });
      if (!ready) continue;

      // Fire-and-forget — inflight guard inside runAutopilotTask prevents
      // concurrent duplicate executions even if a task takes >1 minute.
      runAutopilotTask(task).catch((err: unknown) => {
        logger.error({ err, taskId: task.id, taskName: task.name }, "[Autopilot] task run failed");
      });
    }
  } catch (err) {
    logger.error({ err }, "[Autopilot] scheduler tick error");
  }
}

export function startAutopilotScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  cron.schedule("* * * * *", runAutopilotTick);

  logger.info("[Autopilot] scheduler started (every minute)");
}
