import { protectedProcedure, router } from "../_core/trpc";
import { loadLatestExecutionStatus } from "../executionStatus";

export const executionRouter = router({
  status: protectedProcedure.query(async () => loadLatestExecutionStatus()),
});
