import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { clientsRouter } from "./clients";
import { appointmentsRouter } from "./appointments";
import { messagesRouter, conversationsHandler } from "./messages";
import { statsRouter } from "./stats";
import { chatRouter } from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/clients", clientsRouter);
router.use("/appointments", appointmentsRouter);
router.use("/messages", messagesRouter);
router.get("/conversations", conversationsHandler);
router.use("/stats", statsRouter);
router.use("/chat", chatRouter);

export default router;
