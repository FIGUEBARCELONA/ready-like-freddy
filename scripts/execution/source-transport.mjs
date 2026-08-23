import { fetchBounded, sha256 } from "./common.mjs";

export function readerUrlFor(rawUrl) {
  const url = new URL(rawUrl);
  return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`;
}

export function responseMetadata(response) {
  return {
    httpStatus: response.status,
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    sourceBytes: response.body.length,
    sourceSha256: sha256(response.body),
  };
}

export function isChallengeResponse(response) {
  if (![403, 429, 503].includes(response.status)) return false;
  const sample = response.body.toString("utf8", 0, Math.min(response.body.length, 100_000));
  return /just a moment|cloudflare|cf-chl|attention required/i.test(sample);
}

export async function fetchEvidenceSource(originUrl, options = {}) {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const direct = await fetchBounded(originUrl, { maxBytes });
  if (direct.ok) {
    return {
      response: direct,
      sourceTransport: "DIRECT_OFFICIAL_HTTP",
      sourceFetchUrl: direct.finalUrl,
      originResponse: null,
      fallbackError: null,
    };
  }

  if (!isChallengeResponse(direct)) {
    return {
      response: direct,
      sourceTransport: "DIRECT_OFFICIAL_HTTP_BLOCKED",
      sourceFetchUrl: direct.finalUrl,
      originResponse: responseMetadata(direct),
      fallbackError: null,
    };
  }

  const sourceFetchUrl = readerUrlFor(originUrl);
  try {
    const reader = await fetchBounded(sourceFetchUrl, {
      maxBytes,
      timeoutMs: options.readerTimeoutMs ?? 60_000,
    });
    return {
      response: reader,
      sourceTransport: reader.ok
        ? "JINA_READER_TRANSFORMED_OFFICIAL_SOURCE"
        : "JINA_READER_TRANSFORM_FAILED",
      sourceFetchUrl,
      originResponse: responseMetadata(direct),
      fallbackError: null,
    };
  } catch (error) {
    return {
      response: direct,
      sourceTransport: "DIRECT_OFFICIAL_HTTP_BLOCKED_READER_FAILED",
      sourceFetchUrl,
      originResponse: responseMetadata(direct),
      fallbackError: error instanceof Error ? error.message : String(error),
    };
  }
}
