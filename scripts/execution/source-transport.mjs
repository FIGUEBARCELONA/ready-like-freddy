import { fetchBounded, sha256, sleep } from "./common.mjs";

const RETRYABLE_READER_STATUSES = new Set([401, 408, 425, 429, 500, 502, 503, 504]);

export function readerUrlsFor(rawUrl) {
  const url = new URL(rawUrl);
  const target = `${url.host}${url.pathname}${url.search}`;
  return [
    `https://r.jina.ai/https://${target}`,
    `https://r.jina.ai/http://${target}`,
  ];
}

export function readerUrlFor(rawUrl) {
  return readerUrlsFor(rawUrl)[0];
}

export function responseMetadata(response) {
  return {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    sourceBytes: response.body.length,
    sourceSha256: sha256(response.body),
    attempt: response.attempt ?? null,
  };
}

export function isChallengeResponse(response) {
  if (![403, 429, 503].includes(response.status)) return false;
  const sample = response.body.toString("utf8", 0, Math.min(response.body.length, 100_000));
  return /just a moment|cloudflare|cf-chl|attention required/i.test(sample);
}

async function fetchReaderWithRetries(sourceFetchUrl, options) {
  const attempts = Number(options.readerAttempts ?? 3);
  const attemptLog = [];
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchBounded(sourceFetchUrl, {
        maxBytes: options.maxBytes,
        timeoutMs: options.readerTimeoutMs,
        attempts: 1,
      });
      lastResponse = response;
      attemptLog.push({
        transport: "JINA_READER",
        sourceFetchUrl,
        attempt,
        ...responseMetadata(response),
      });
      if (response.ok || !RETRYABLE_READER_STATUSES.has(response.status)) break;
    } catch (error) {
      lastError = error;
      attemptLog.push({
        transport: "JINA_READER",
        sourceFetchUrl,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (attempt < attempts) {
      const backoff = Math.min(8_000, 1_000 * 2 ** (attempt - 1));
      await sleep(backoff);
    }
  }

  return { response: lastResponse, error: lastError, attemptLog };
}

export async function fetchEvidenceSource(originUrl, options = {}) {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const readerTimeoutMs = options.readerTimeoutMs ?? 60_000;
  const readerAttempts = options.readerAttempts ?? 3;
  const transportAttempts = [];

  const direct = await fetchBounded(originUrl, {
    maxBytes,
    timeoutMs: options.directTimeoutMs ?? 30_000,
    attempts: options.directAttempts ?? 2,
  });
  transportAttempts.push({
    transport: "DIRECT_OFFICIAL_HTTP",
    sourceFetchUrl: direct.finalUrl,
    ...responseMetadata(direct),
  });

  if (direct.ok) {
    return {
      response: direct,
      sourceTransport: "DIRECT_OFFICIAL_HTTP",
      sourceFetchUrl: direct.finalUrl,
      originResponse: null,
      fallbackError: null,
      transportAttempts,
    };
  }

  if (!isChallengeResponse(direct)) {
    return {
      response: direct,
      sourceTransport: "DIRECT_OFFICIAL_HTTP_BLOCKED",
      sourceFetchUrl: direct.finalUrl,
      originResponse: responseMetadata(direct),
      fallbackError: null,
      transportAttempts,
    };
  }

  let lastReaderResponse = null;
  let lastReaderError = null;
  let lastReaderUrl = null;

  for (const sourceFetchUrl of readerUrlsFor(originUrl)) {
    lastReaderUrl = sourceFetchUrl;
    const result = await fetchReaderWithRetries(sourceFetchUrl, {
      maxBytes,
      readerTimeoutMs,
      readerAttempts,
    });
    transportAttempts.push(...result.attemptLog);
    if (result.response) lastReaderResponse = result.response;
    if (result.error) lastReaderError = result.error;
    if (result.response?.ok) {
      return {
        response: result.response,
        sourceTransport: "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE",
        sourceFetchUrl,
        originResponse: responseMetadata(direct),
        fallbackError: null,
        transportAttempts,
      };
    }
  }

  if (lastReaderResponse) {
    return {
      response: lastReaderResponse,
      sourceTransport: "JINA_READER_TRANSFORM_FAILED",
      sourceFetchUrl: lastReaderUrl,
      originResponse: responseMetadata(direct),
      fallbackError: lastReaderError instanceof Error ? lastReaderError.message : null,
      transportAttempts,
    };
  }

  return {
    response: direct,
    sourceTransport: "DIRECT_OFFICIAL_HTTP_BLOCKED_READER_FAILED",
    sourceFetchUrl: lastReaderUrl,
    originResponse: responseMetadata(direct),
    fallbackError: lastReaderError instanceof Error ? lastReaderError.message : String(lastReaderError ?? "Reader failed without response"),
    transportAttempts,
  };
}
