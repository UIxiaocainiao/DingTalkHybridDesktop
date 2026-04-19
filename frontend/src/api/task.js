import { request } from "./request";

export function fetchTasks() {
  return request("/api/tasks");
}

export function runTaskOnce() {
  return request("/api/actions/run-once", { method: "POST", body: JSON.stringify({}) });
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

export function installAdb() {
  return request("/api/actions/adb-install", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function connectRemoteAdb() {
  return request("/api/actions/adb-connect", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function disconnectRemoteAdb() {
  return request("/api/actions/adb-disconnect", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function diagnoseRemoteAdb() {
  return request("/api/actions/adb-diagnose", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function deleteRemoteAdbTarget(target) {
  return request("/api/actions/remote-adb-targets/delete", {
    method: "POST",
    body: JSON.stringify({ target }),
  });
}

export function restartAdb() {
  return request("/api/actions/adb-restart", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function runOnce() {
  return runTaskOnce();
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
