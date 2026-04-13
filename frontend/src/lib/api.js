const PRODUCTION_API_BASE_URL = "https://dingtalk-api-production.up.railway.app";
const PRODUCTION_FRONTEND_HOSTS = new Set([
  "www.dingtalk.pengshz.cn",
  "dingtalk-web-production.up.railway.app",
]);

function resolveApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
  if (configuredBaseUrl) return configuredBaseUrl;

  if (typeof window !== "undefined" && PRODUCTION_FRONTEND_HOSTS.has(window.location.hostname)) {
    return PRODUCTION_API_BASE_URL;
  }

  return "";
}

const API_BASE_URL = resolveApiBaseUrl();

function withBase(path) {
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path}`;
}

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    if (payload?.message) return payload.message;
  } catch {}
  return `请求失败 (${response.status})`;
}

async function request(path, options = {}) {
  const response = await fetch(withBase(path), {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

export function fetchDashboard() {
  return request("/api/dashboard");
}

export function saveConfig(payload) {
  return request("/api/config", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function rerollSchedule() {
  return request("/api/actions/reroll", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function runDoctor() {
  return request("/api/actions/doctor", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function runOnce() {
  return request("/api/actions/run-once", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function startScheduler(mode) {
  return request("/api/actions/start", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function stopScheduler() {
  return request("/api/actions/stop", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function fetchCheckinRecords(params = {}) {
  const query = new URLSearchParams(params).toString();
  return request(`/api/checkin-records${query ? `?${query}` : ""}`);
}

export function addCheckinRecord(record) {
  return request("/api/checkin-records", {
    method: "POST",
    body: JSON.stringify(record),
  });
}

export function deleteCheckinRecord(index) {
  return request("/api/checkin-records/delete", {
    method: "POST",
    body: JSON.stringify({ index }),
  });
}
