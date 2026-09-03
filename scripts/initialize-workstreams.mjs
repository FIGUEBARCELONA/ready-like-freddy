import { eq } from "drizzle-orm";
import { appRouter } from "../server/routers.ts";
import { getDb } from "../server/db.ts";
import { ENV } from "../server/_core/env.ts";
import { users } from "../drizzle/schema.ts";

const db = await getDb();
if (!db) throw new Error("Database unavailable; initialization was not attempted.");

const owner = (await db.select().from(users).where(eq(users.openId, ENV.ownerOpenId)).limit(1))[0];
if (!owner || owner.role !== "admin") throw new Error("Authenticated project owner with admin role is required; initialization was not attempted.");

const caller = appRouter.createCaller({
  user: owner,
  req: { protocol: "https", headers: {} },
  res: {},
});

const result = await caller.workstream.initializeSlots();
console.log(JSON.stringify(result));
