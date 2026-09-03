import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { appRouter } from "../server/routers.ts";
import { getDb } from "../server/db.ts";
import { ENV } from "../server/_core/env.ts";
import { users } from "../drizzle/schema.ts";

const manifest = JSON.parse(await readFile("/home/ubuntu/rlf-workstream-control/data/canonical-books-manifest.json", "utf8"));
const source = manifest.books.find(book => book.relativePath === "data/RLF_OFFICIAL_SOURCE_REGISTRY_20260822.md");
if (!source) throw new Error("The official source registry is absent from the generated manifest.");

const db = await getDb();
if (!db) throw new Error("Database unavailable; canonical manifest was not registered.");
const owner = (await db.select().from(users).where(eq(users.openId, ENV.ownerOpenId)).limit(1))[0];
if (!owner || owner.role !== "admin") throw new Error("Authenticated project owner with admin role is required; canonical manifest was not registered.");

const caller = appRouter.createCaller({ user: owner, req: { protocol: "https", headers: {} }, res: {} });
const registered = await caller.workstream.registerCanonicalManifest({
  manifestName: "RLF canonical books — 2026-08-22",
  sourcePath: source.sourcePath,
  sourceSha256: source.sha256,
  sourceVersion: manifest.manifestFormat,
  entries: manifest.books.map(book => ({
    entryKey: book.relativePath,
    entrySha256: book.sha256,
    metadata: { sourceMode: book.sourceMode, sizeBytes: book.sizeBytes, sourcePath: book.sourcePath },
  })),
});
const verified = await caller.workstream.verifyCanonicalManifest({
  importId: registered.importId,
  reason: "Manifesto local de solo lectura generado desde nueve libros canónicos con SHA-256 registrado para cada entrada.",
});
console.log(JSON.stringify({ registered, verified }));
