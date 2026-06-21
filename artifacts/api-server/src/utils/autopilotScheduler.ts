import cron from "node-cron";
import { db, autopilotTasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { shouldRunTask, runAutopilotTask } from "./autopilotEngine";
import { logger } from "../lib/logger";

let schedulerStarted = false;

export function startAutopilotScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  cron.schedule("* * * * *", async () => {
    try {
      const tasks = await db
        .select()
        .from(autopilotTasksTable)
        .where(eq(autopilotTasksTable.enabled, true));

      for (const task of tasks) {
        if (!shouldRunTask(task)) continue;

        // Fire-and-forget — don't block the scheduler tick
        runAutopilotTask(task).catch((err: unknown) => {
          logger.error({ err, taskId: task.id, taskName: task.name }, "[Autopilot] task run failed");
        });
      }
    } catch (err) {
      logger.error({ err }, "[Autopilot] scheduler tick error");
    }
  });

  logger.info("[Autopilot] scheduler started (every minute)");
}
