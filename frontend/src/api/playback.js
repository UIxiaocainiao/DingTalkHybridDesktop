const PLAYBACK_API_BASE_URL = String(
  import.meta.env.VITE_PLAYBACK_API_BASE_URL || "http://127.0.0.1:4000",
).trim().replace(/\/+$/, "");

function withBase(path) {
  if (!PLAYBACK_API_BASE_URL) return path;
  return `${PLAYBACK_API_BASE_URL}${path}`;
}

async function request(path, options = {}) {
  const response = await fetch(withBase(path), {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.success) {
    throw new Error(json?.message || `Playback request failed (${response.status})`);
  }
  return json.data;
}

function post(path, body, fallbackMessage) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  }).catch((error) => {
    if (error instanceof Error && error.message) throw error;
    throw new Error(fallbackMessage);
  });
}

export function fetchPlaybackDevices() {
  return request("/api/devices");
}

export async function fetchPlaybackDeviceApps(serial) {
  const data = await request(`/api/devices/${encodeURIComponent(serial)}/apps`);
  return data.apps || [];
}

export function playbackUnlockDevice(serial, pattern, clearCredential) {
  return post(
    `/api/devices/${encodeURIComponent(serial)}/unlock`,
    { pattern, clearCredential },
    "执行远程解锁失败",
  );
}

export function playbackStartProgram(serial, packageNames, config) {
  return post(
    `/api/devices/${encodeURIComponent(serial)}/start-program`,
    {
      packageNames,
      roundsMin: config.roundsMin,
      roundsMax: config.roundsMax,
      waitMinSeconds: config.waitMinSeconds,
      waitMaxSeconds: config.waitMaxSeconds,
      likeChancePercent: config.likeChancePercent,
    },
    "执行启动程序失败",
  );
}

export function playbackStopProgram(serial) {
  return post(
    `/api/devices/${encodeURIComponent(serial)}/stop-program`,
    {},
    "执行停止程序失败",
  );
}

export function fetchPlaybackProgramDashboard(serial) {
  return request(`/api/devices/${encodeURIComponent(serial)}/program-dashboard`);
}

export function clearPlaybackProgramDashboardLogs(serial) {
  return post(
    `/api/devices/${encodeURIComponent(serial)}/program-dashboard/clear-logs`,
    {},
    "清空运行日志失败",
  );
}

export function exportPlaybackProgramDashboard(serial) {
  return request(`/api/devices/${encodeURIComponent(serial)}/program-dashboard/export`);
}
