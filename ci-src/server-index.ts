import express from "express";
import { createServer } from "http";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.cwd();
const apparatusScript = path.join(projectRoot, "scripts", "lane-apparatus.mjs");
const publicStatusFile = path.join(projectRoot, "client", "public", "tracker", "apparatus", "status.json");

async function runApparatus(args: string[]) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [apparatusScript, ...args], {
    cwd: projectRoot,
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });
  if (stderr.trim()) console.error(stderr.trim());
  return JSON.parse(stdout);
}

function requireWriteAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  const configuredToken = process.env.RLF_TRACKER_WRITE_TOKEN;
  const providedToken = req.header("x-rlf-tracker-token");
  const remote = req.ip || req.socket.remoteAddress || "";
  const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote.endsWith("127.0.0.1");
  if (configuredToken ? providedToken === configuredToken : isLoopback) return next();
  res.status(403).json({ ok: false, error: "Tracker write access denied" });
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/tracker/status", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const status = JSON.parse(await readFile(publicStatusFile, "utf8"));
      res.json(status);
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/tracker/events", async (req, res) => {
    try {
      const args = ["events", "--limit", String(req.query.limit || 100)];
      if (req.query.task) args.push("--task", String(req.query.task));
      res.json(await runApparatus(args));
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/tracker/claim", requireWriteAccess, async (req, res) => {
    try {
      const args = ["claim", "--lane", String(req.body.lane_id || ""), "--actor", String(req.body.actor || "api:operator")];
      if (req.body.task_id) args.push("--task", String(req.body.task_id));
      if (req.body.lease_seconds) args.push("--lease-seconds", String(req.body.lease_seconds));
      res.json(await runApparatus(args));
    } catch (error) {
      res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/tracker/heartbeat", requireWriteAccess, async (req, res) => {
    try {
      res.json(await runApparatus(["heartbeat", "--task", String(req.body.task_id || ""), "--lease", String(req.body.lease_id || ""), "--actor", String(req.body.actor || "api:operator")]));
    } catch (error) {
      res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/tracker/transition", requireWriteAccess, async (req, res) => {
    try {
      res.json(await runApparatus([
        "transition",
        "--task", String(req.body.task_id || ""),
        "--lease", String(req.body.lease_id || ""),
        "--actor", String(req.body.actor || "api:operator"),
        "--to", String(req.body.to_status || ""),
        "--payload", JSON.stringify(req.body.payload || {}),
      ]));
    } catch (error) {
      res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/tracker/release", requireWriteAccess, async (req, res) => {
    try {
      res.json(await runApparatus(["release", "--task", String(req.body.task_id || ""), "--lease", String(req.body.lease_id || ""), "--actor", String(req.body.actor || "api:operator"), "--reason", String(req.body.reason || "manual_release")]));
    } catch (error) {
      res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/tracker/reap", requireWriteAccess, async (req, res) => {
    try {
      res.json(await runApparatus(["reap", "--actor", String(req.body.actor || "api:lease-reaper")]));
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/tracker/sync", requireWriteAccess, async (req, res) => {
    try {
      res.json(await runApparatus(["sync", "--actor", String(req.body.actor || "api:sync")]));
    } catch (error) {
      res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const staticPath = process.env.NODE_ENV === "production"
    ? path.resolve(__dirname, "public")
    : path.resolve(__dirname, "..", "dist", "public");
  app.use(express.static(staticPath));
  app.get("*", (_req, res) => res.sendFile(path.join(staticPath, "index.html")));

  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Server running on http://localhost:${port}/`));
}

startServer().catch(console.error);
