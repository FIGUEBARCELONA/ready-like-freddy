import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const USER_AGENT = "ReadyLikeFreddy-KB-Research/1.0 (+documentary, noncommercial; evidence-first)";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function isAllowedUrl(raw, allowedHosts) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function decodeHtmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function stripTags(value) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function extractAttribute(html, tagPattern, attribute) {
  const tag = html.match(tagPattern)?.[0];
  if (!tag) return null;
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

export async function fetchBounded(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const attempts = options.attempts ?? 3;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.2",
          "accept-language": "en-GB,en;q=0.8",
          "cache-control": "no-cache"
        }
      });
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > maxBytes) {
        throw new Error(`Response exceeds byte limit: ${contentLength} > ${maxBytes}`);
      }
      const reader = response.body?.getReader();
      const chunks = [];
      let total = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel("response byte limit exceeded");
            throw new Error(`Response exceeded byte limit while streaming: ${total} > ${maxBytes}`);
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
      clearTimeout(timer);
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type") ?? "",
        body,
        headers: Object.fromEntries(response.headers.entries()),
        attempt
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < attempts) await sleep(700 * attempt);
    }
  }
  throw lastError ?? new Error(`Unable to fetch ${url}`);
}
