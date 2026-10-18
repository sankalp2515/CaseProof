import { makeCaseView } from "../models/caseView.js";
import { auth } from "./auth.js";
// Plain-language text for the codes a visitor can actually meet.
const MESSAGES = {
  practice_session_required:
    "No practice session in this browser yet. Start one (it takes about 30 seconds); the victim and fraud-desk views must be opened in the same browser.",
  bank_data_preparing:
    "Your practice bank is still being prepared. Try again in a moment.",
  evidence_scan_pending_or_rejected:
    "This file is still being virus-scanned, or it was rejected as unsafe. It opens once it is confirmed clean.",
  daily_practice_session_limit:
    "Today's practice sessions are used up. They reset at 05:30 IST; you can still continue an existing session.",
  daily_case_limit:
    "Today's practice reports are used up. They reset at 05:30 IST.",
  session_case_limit:
    "This practice session has reached its report limit. Start a fresh practice session to continue.",
  invalid_request_or_state:
    "This action is not valid for the current case or submitted details. Refresh the case and check the required fields.",
  request_body_limit:
    "That file is larger than 5 MB. Use a smaller screenshot or photo.",
};
export class ApiError extends Error {
  constructor(status, body) {
    const fields = Array.isArray(body.detail)
      ? Object.fromEntries(body.detail.map((d) => [d.loc?.at(-1), d.msg]))
      : {};
    const code =
      body.error ||
      (typeof body.detail === "string" ? body.detail : undefined) ||
      `Request failed (${status})`;
    super(MESSAGES[code] || (status === 403
        ? "This case belongs to another practice session, or your role cannot do this."
        : status === 404
          ? "This item is unavailable."
          : status === 409
            ? "The case changed. Reload the current assessment before trying again."
            : status === 413
              ? "That file is larger than 5 MB. Use a smaller screenshot or photo."
              : status >= 500
                ? "The service is busy. Please try again in a moment."
                : code));
    Object.assign(this, {
      status,
      code,
      fieldErrors: fields,
      retryable: status >= 500 || status === 429,
    });
  }
}
const PREPARING_LIMIT_MS = 120000;
const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
export async function apiRequest(
  path,
  { method = "GET", body, persona, signal, fetcher = fetch, raw = false } = {},
) {
  const form = typeof FormData !== "undefined" && body instanceof FormData;
  const headers = {
    ...auth.headers(persona),
    ...(body && !form ? { "Content-Type": "application/json" } : {}),
  };
  const send = () =>
    fetcher(path, {
      method,
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
      headers,
      signal,
      credentials: "include",
      cache: "no-store",
    });
  let response = await send();
  // A new practice session's bank records publish asynchronously; reads answer
  // 503 bank_data_preparing with Retry-After until they are ready.
  for (let waited = 0; method === "GET" && waited < PREPARING_LIMIT_MS; ) {
    if (response.status !== 503) break;
    const detail = await response
      .clone()
      .json()
      .then((data) => data.detail)
      .catch(() => null);
    if (detail !== "bank_data_preparing" && detail !== "evidence_scan_pending_or_rejected")
      break;
    const delay =
      Math.min(Number(response.headers.get("Retry-After")) || 3, 10) * 1000;
    await pause(delay, signal);
    waited += delay;
    response = await send();
  }
  if (!response.ok) {
    if (response.status === 401 && !auth.personas) auth.clear();
    let data;
    try {
      data = await response.json();
    } catch {
      data = {
        error:
          response.status === 413
            ? "Attachment is too large."
            : "Request could not be completed.",
      };
    }
    throw new ApiError(response.status, data);
  }
  return raw ? response : response.status === 204 ? null : response.json();
}
export async function loadCaseView(caseId, options = {}) {
  const path = "/v1/cases/" + encodeURIComponent(caseId);
  for (let i = 0; i < 3; i++) {
    const [snapshot, workflow] = await Promise.all([
      apiRequest(path, options),
      apiRequest(path + "/workflow", options),
    ]);
    try {
      return makeCaseView(snapshot, workflow);
    } catch (error) {
      if (i === 2) throw error;
    }
  }
}
export const post = (path, body, persona) =>
  apiRequest(path, { method: "POST", body, persona });
export function evidenceForm(file, kind = "receipt", revision) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  if (revision != null) form.append("expected_revision", revision);
  return form;
}
