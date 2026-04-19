import {
  Activity,
  AlarmClockCheck,
  BadgeCheck,
  BellRing,
  Bot,
  Bug,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CirclePlay,
  ClipboardList,
  Download,
  FileClock,
  FolderCog,
  Gauge,
  ListChecks,
  Menu,
  MoonStar,
  Play,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  SquareTerminal,
  Stethoscope,
  SunMedium,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { SplitText as GSAPSplitText } from "gsap/SplitText";
import { toast } from "sonner";

import { AdvancedCursor } from "./components/AdvancedCursor";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Separator } from "./components/ui/separator";
import { TimePicker } from "./components/ui/time-picker";
import { APP_VERSION } from "./app-version";
import {
  fetchDashboard,
  fetchCheckinRecords,
  connectRemoteAdb,
  deleteRemoteAdbTarget,
  diagnoseRemoteAdb,
  disconnectRemoteAdb,
  installAdb,
  rerollSchedule,
  restartAdb,
  runDoctor,
  runOnce,
  saveConfig,
  startScheduler,
  stopScheduler,
} from "./api";
import {
  clearPlaybackProgramDashboardLogs,
  exportPlaybackProgramDashboard,
  fetchPlaybackDeviceApps,
  fetchPlaybackDevices,
  fetchPlaybackProgramDashboard,
  playbackStartProgram,
  playbackStopProgram,
  playbackUnlockDevice,
} from "./api/playback";
import { cn } from "./lib/utils.js";

gsap.registerPlugin(GSAPSplitText);

const PROJECT_NAV_ITEMS = [
  { id: "dingtalk", label: "自动钉钉打卡项目", icon: Bot },
  { id: "playback", label: "自动刷视频项目", icon: CirclePlay },
];

const DINGTALK_FEATURE_GROUP_NAV = {
  id: "feature-center",
  label: "打卡功能",
  icon: FolderCog,
  items: [
    { id: "actions", label: "任务配置", icon: FolderCog },
    { id: "records", label: "打卡记录", icon: ClipboardList },
    { id: "logs", label: "告警日志", icon: BellRing },
  ],
};
const GUIDE_NAV_ITEM = { id: "guide", label: "使用说明", icon: CircleHelp };
const DINGTALK_PROJECT_MENU_ITEMS = [...DINGTALK_FEATURE_GROUP_NAV.items];
const PLAYBACK_NAV_ITEMS = [
  { id: "playback-devices", label: "任务配置", icon: FolderCog },
  { id: "playback-dashboard", label: "运行记录", icon: ListChecks },
];
const PLAYBACK_CONSOLE_MODULE_NAME = "playback-project-console";
const ADVANCED_SEARCH_FEATURE_MODULE_ID = "advanced-search-feature";
const ADVANCED_SEARCH_FEATURE_MODULE_NAME = "高级搜索功能";

const SECTION_GROUP_MAP = {
  overview: "overview",
  "device-management": "device-management",
  actions: "actions",
  windows: "actions",
  config: "actions",
  records: "records",
  logs: "logs",
  guards: "logs",
  guide: "guide",
  "guide-connection-wizard": "guide",
  "playback-devices": "playback-devices",
  "playback-dashboard": "playback-dashboard",
};

const SECTION_TOPBAR_META = {
  overview: { title: "监控总览与执行态势", tone: "overview" },
  "device-management": { title: "设备管理", tone: "overview" },
  actions: { title: "任务配置与排期管理", tone: "config" },
  records: { title: "打卡记录", tone: "records" },
  logs: { title: "告警日志与通知中心", tone: "notify" },
  guide: { title: "使用说明", tone: "config" },
  "playback-devices": { title: "自动刷视频 · 任务配置", tone: "overview" },
  "playback-dashboard": { title: "自动刷视频 · 运行记录", tone: "notify" },
};

const SECTION_NAV_META = {
  overview: { label: "运行总览", hint: "查看当前设备、调度与风险状态" },
  "device-management": { label: "设备管理", hint: "查看所有已连接安卓设备" },
  actions: { label: "任务配置", hint: "调整参数、排期窗口与执行动作" },
  records: { label: "打卡记录", hint: "按日期和状态追踪执行结果" },
  logs: { label: "告警日志", hint: "定位异常并快速做处置决策" },
  guide: { label: "使用说明", hint: "查看连接向导与操作文档" },
  "playback-devices": { label: "任务配置", hint: "配置刷视频设备与应用目标" },
  "playback-dashboard": { label: "运行记录", hint: "查看刷视频任务执行记录" },
};

const SIDEBAR_NAV_SEARCH_INPUT_ID = "sidebar-nav-search-input";

const PLAYBACK_SECTIONS = new Set(PLAYBACK_NAV_ITEMS.map((item) => item.id));

function resolveProjectFromSection(sectionId) {
  return PLAYBACK_SECTIONS.has(sectionId) ? "playback" : "dingtalk";
}

const quickChecklist = [
  "先看设备是否已连接且 ADB 已授权",
  "再核对今日上午 / 下午随机执行时间",
  "最后执行自检或试运行，不要直接启动",
];

const initialPlaybackOverviewState = {
  ready: false,
  loading: false,
  error: "",
  deviceCount: 0,
  onlineCount: 0,
  unauthorizedCount: 0,
  selectedSerial: "",
  isRunning: false,
  startedAt: "",
  lastUpdatedAt: "",
  currentAppName: "",
  totalCycles: 0,
  recentLogDetail: "",
};

const initialDeviceCenterState = {
  ready: false,
  loading: false,
  error: "",
  partialError: "",
  devices: [],
  updatedAtLabel: "",
};

const configGroups = [
  {
    title: "设备与应用",
    eyebrow: "Device",
    summary: "绑定设备、目标应用与状态文件落点",
    icon: Smartphone,
    badgeClass:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    description: "先配置识别对象，再校验状态文件落点。",
    fields: [
      {
        label: "远程 ADB 目标 remote_adb_target",
        key: "remote_adb_target",
        defaultValue: "",
        helper: "可选。填写远程 ADB/TCP 地址，例如 192.168.1.8:5555；保存后可在网页端点“连接远程 ADB”。",
      },
      {
        label: "远程目标名称 remote_adb_target_name",
        key: "remote_adb_target_name",
        defaultValue: "",
        helper: "可选。给远程目标起一个便于识别的名字，例如 办公室测试机、备用 Redmi。",
      },
      {
        label: "设备序列号 serial",
        key: "serial",
        defaultValue: "",
        helper: "用于绑定具体 ADB 设备；留空时会自动选择唯一在线设备。远程 ADB 常见 serial 就是 host:port。",
      },
      {
        label: "ADB 路径 adb_bin",
        key: "adb_bin",
        defaultValue: "",
        helper: "留空时优先使用服务器内置 platform-tools/adb，再回退到系统 PATH；如未安装，可直接在网页端触发在线安装。",
      },
      { label: "应用包名 package", key: "package", defaultValue: "com.alibaba.android.rimet" },
      { label: "应用名称 app_label", key: "app_label", defaultValue: "钉钉" },
      {
        label: "状态文件路径 state_file",
        key: "state_file",
        defaultValue: "backend/logs/dingtalk-random-scheduler.state.json",
      },
    ],
  },
  {
    title: "调度与服务",
    eyebrow: "Runtime",
    summary: "控制轮询节奏、工作日判断与接口容错",
    icon: SquareTerminal,
    badgeClass:
      "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    description: "控制节奏、工作日判断与接口容错。",
    fields: [
      { label: "启动后停留时长", key: "delay_after_launch", defaultValue: "5 秒" },
      {
        label: "轮询间隔 poll_interval",
        key: "poll_interval",
        defaultValue: "5 秒",
        helper: "最小值为 1 秒，建议结合设备稳定性谨慎调整。",
      },
      {
        label: "工作日接口地址",
        key: "workday_api_url",
        defaultValue: "https://holiday.dreace.top?date={date}",
      },
      { label: "接口超时时间", key: "workday_api_timeout_ms", defaultValue: "5000 ms" },
    ],
  },
  {
    title: "scrcpy 前台配置",
    eyebrow: "Mirror",
    summary: "观察能力只由前台开关和参数控制",
    icon: Bug,
    badgeClass:
      "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    description: "设备端只做连接，是否拉起 scrcpy 完全取决于这里的保存配置。",
    fields: [
      {
        label: "scrcpy 路径 scrcpy_bin",
        key: "scrcpy_bin",
        defaultValue: "",
        helper: "留空时后端自动查找 scrcpy；填写后会使用该路径启动前台观察窗口。",
      },
      {
        label: "scrcpy 重连冷却",
        key: "scrcpy_launch_cooldown",
        defaultValue: "15 秒",
        helper: "设备断开后再次连上时，至少间隔这么久才允许再次拉起 scrcpy。",
      },
    ],
  },
];

const unifiedWindowAccentClass =
  "border-border/70 bg-muted/25 dark:border-border/80 dark:bg-muted/15";
const unifiedWindowBadgeClass =
  "border-border/70 bg-muted/80 text-foreground";

const windowsData = [
  {
    name: "morning",
    title: "上午窗口",
    eyebrow: "AM Window",
    accentClass: unifiedWindowAccentClass,
    badgeClass: unifiedWindowBadgeClass,
    icon: SunMedium,
    note: "系统会在这个区间内随机抽取一个执行时刻。",
    defaultStart: "09:05",
    defaultEnd: "09:10",
    defaultSelected: "09:06:00",
  },
  {
    name: "evening",
    title: "下午窗口",
    eyebrow: "PM Window",
    accentClass: unifiedWindowAccentClass,
    badgeClass: unifiedWindowBadgeClass,
    icon: MoonStar,
    note: "随机逻辑与上午一致，支持独立控制。",
    defaultStart: "18:05",
    defaultEnd: "18:15",
    defaultSelected: "18:08:00",
  },
];

const checkinTypeOptions = ["上午打卡", "下午打卡"];

function normalizeCheckinType(rawValue) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return "手动记录";

  const aliases = {
    morning: "上午打卡",
    "上午窗口": "上午打卡",
    "上午打卡": "上午打卡",
    evening: "下午打卡",
    "下午窗口": "下午打卡",
    "下午打卡": "下午打卡",
  };
  return aliases[raw] ?? aliases[raw.toLowerCase()] ?? raw;
}

const actions = [
  {
    label: "一键自检",
    style: "default",
    icon: Stethoscope,
    group: "primary",
    note: "先确认 adb、设备和工作日接口状态。",
  },
  {
    label: "刷新设备状态",
    style: "secondary",
    icon: RefreshCw,
    group: "primary",
    note: "重新读取当前设备连接、授权和日志状态。",
  },
  {
    label: "连接远程 ADB",
    style: "secondary",
    icon: Search,
    group: "support",
    note: "按已保存的 remote_adb_target 执行 adb connect。",
  },
  {
    label: "断开远程 ADB",
    style: "secondary",
    icon: X,
    group: "support",
    note: "按已保存的 remote_adb_target 执行 adb disconnect。",
  },
  {
    label: "远程连通诊断",
    style: "secondary",
    icon: Search,
    group: "support",
    note: "一次性检查 DNS、TCP 和 adb 设备链路。",
  },
  {
    label: "在线安装 ADB",
    style: "secondary",
    icon: Download,
    group: "support",
    note: "在当前云服务器安装官方 platform-tools/adb。",
  },
  {
    label: "重启 ADB",
    style: "secondary",
    icon: Power,
    group: "support",
    note: "重启 adb server，适合连接异常或 5037 端口占用时使用。",
  },
  {
    label: "连接向导",
    style: "secondary",
    icon: CircleHelp,
    group: "support",
    note: "按步骤完成 ADB 安装、授权与设备绑定。",
  },
  {
    label: "试运行",
    style: "secondary",
    icon: Bot,
    group: "primary",
    note: "不改排期，直接验证一次动作链路。",
  },
  {
    label: "启动任务",
    style: "secondary",
    icon: Play,
    group: "runtime",
    note: "以标准 run 模式托管调度进程。",
  },
  {
    label: "停止任务",
    style: "ghost",
    icon: CirclePlay,
    group: "runtime",
    note: "停止当前受控调度进程。",
  },
  {
    label: "调试模式",
    style: "secondary",
    icon: Bug,
    group: "runtime",
    note: "以当前前台配置启动调试进程，不再隐式开启 scrcpy。",
  },
  {
    label: "查看排期",
    style: "secondary",
    icon: FileClock,
    group: "support",
    note: "快速定位到上午、下午窗口的详细设置。",
  },
];

const toggleDefinitions = [
  {
    label: "scrcpy 观察模式",
    key: "enable_scrcpy_watch",
    enabledNote: "按前台配置的路径和冷却时间，在设备重新连接后自动拉起 scrcpy。",
    disabledNote: "设备端只保持 ADB 连接，不自动拉起 scrcpy。",
  },
  {
    label: "成功通知",
    key: "notify_on_success",
    enabledNote: "动作执行完成后发送 macOS 通知。",
    disabledNote: "执行成功后不发送桌面通知。",
  },
  {
    label: "工作日校验",
    key: "enable_workday_check",
    enabledNote: "执行前通过在线接口判断是否为工作日。",
    disabledNote: "忽略工作日接口，每天都按本地排期执行。",
  },
  {
    label: "远程 ADB 自动连接",
    key: "enable_auto_remote_adb_connect",
    enabledNote: "无在线设备时，监控页会自动尝试连接 remote_adb_target。",
    disabledNote: "仅在你手动点击“连接远程 ADB”时才发起连接。",
  },
];

const guards = [
  ["设备未连接提醒", "保存前阻断启动动作", true],
  ["ADB 未授权提醒", "显示明确授权步骤"],
  ["工作日接口异常提示", "超时与失败次数聚合展示"],
  ["时间窗口合法性校验", "开始时间必须早于结束时间"],
  ["轮询与超时参数下限", "防止设置过低造成压力"],
  ["关键配置变更二次确认", "serial / package / state_file 变更需确认", true],
];

const CONFIG_FIELD_MAP = Object.fromEntries(
  configGroups.flatMap((group) => group.fields.map((field) => [field.label, field.key])),
);
const TOGGLE_FIELD_MAP = Object.fromEntries(toggleDefinitions.map((item) => [item.label, item.key]));

const initialConfigState = Object.fromEntries(
  configGroups.flatMap((group) => group.fields.map((field) => [field.label, field.defaultValue])),
);

const initialToggleState = Object.fromEntries(
  toggleDefinitions.map((item) => [
    item.label,
    item.key === "enable_workday_check" || item.key === "enable_auto_remote_adb_connect",
  ]),
);

const initialWindowState = Object.fromEntries(
  windowsData.flatMap((item) => [
    [`${item.title}-start`, item.defaultStart],
    [`${item.title}-end`, item.defaultEnd],
    [`${item.title}-selected`, item.defaultSelected],
    [`${item.title}-custom`, item.defaultSelected],
    [`${item.title}-completed`, "未执行"],
  ]),
);

function statusTone(value) {
  if (/(失败|异常|错误|未连接|未授权|不可用|停止)/.test(value)) return "destructive";
  if (/(成功|已连接|已授权|已校验|运行中|工作日|已同步)/.test(value)) return "success";
  if (/(提醒|未保存|处理中|待执行|试运行|重新抽取|风险|待处理|调试中)/.test(value)) return "warning";
  return "secondary";
}

function toneLabel(tone) {
  if (tone === "success") return "正常";
  if (tone === "warning") return "关注";
  if (tone === "destructive") return "异常";
  return "信息";
}

function toneClasses(tone) {
  if (tone === "success") {
    return {
      panel: "border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/10",
      soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      icon: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (tone === "warning") {
    return {
      panel: "border-amber-200/70 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/10",
      soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      icon: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (tone === "destructive") {
    return {
      panel: "border-red-200/70 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/10",
      soft: "bg-red-500/10 text-red-700 dark:text-red-300",
      icon: "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }
  return {
    panel: "border-border bg-muted/20",
    soft: "bg-muted text-muted-foreground",
    icon: "border-border bg-background text-muted-foreground",
  };
}

function parseNumber(value) {
  const parsed = Number.parseInt(String(value).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimeToSeconds(value) {
  const matched = String(value).trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return null;

  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  const second = Number(matched[3] ?? 0);

  if (hour > 23 || minute > 59 || second > 59) return null;
  return hour * 3600 + minute * 60 + second;
}

function parseDashboardTimestamp(value) {
  const raw = String(value ?? "").trim();
  const matched = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!matched) return null;

  const [, year, month, day, hour, minute, second] = matched;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function parseDashboardDate(value) {
  const raw = String(value ?? "").trim();
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;

  const [, year, month, day] = matched;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function diffCalendarDays(left, right) {
  const leftDate = new Date(left.getFullYear(), left.getMonth(), left.getDate());
  const rightDate = new Date(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((leftDate - rightDate) / 86400000);
}

function padTimePart(value) {
  return String(value).padStart(2, "0");
}

function formatParsedDate(date) {
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}`;
}

function formatParsedTime(date) {
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}:${padTimePart(date.getSeconds())}`;
}

function getCurrentBeijingDateStamp() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function formatPendingWindowLabel(windowItem, now = new Date()) {
  if (!windowItem?.selectedAt) return "待排期";

  const nextRun = parseDashboardTimestamp(windowItem.selectedAt);
  if (!nextRun) {
    return `${windowItem.title} ${windowItem.selectedAt}`;
  }

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTargetDay = new Date(nextRun.getFullYear(), nextRun.getMonth(), nextRun.getDate());
  const dayDiff = Math.round((startOfTargetDay - startOfToday) / 86400000);
  const timePart = formatParsedTime(nextRun);

  if (dayDiff === 0) return `今天${windowItem.title.replace("窗口", "")}待执行 ${timePart}`;
  if (dayDiff === 1) return `明天${windowItem.title.replace("窗口", "")}待执行 ${timePart}`;
  return `${windowItem.title}待执行 ${windowItem.selectedAt}`;
}

function getPendingWindowSummary(dashboard, windowValues) {
  const windows = Array.isArray(dashboard?.windows) ? dashboard.windows : [];
  const dashboardNow = parseDashboardTimestamp(dashboard?.generatedAt) ?? new Date();

  const nextWindow = windows
    .map((item) => ({
      ...item,
      nextRunDate: parseDashboardTimestamp(item.selectedAt),
    }))
    .filter((item) => item.nextRunDate instanceof Date && !Number.isNaN(item.nextRunDate.getTime()))
    .sort((left, right) => left.nextRunDate - right.nextRunDate)[0];

  if (nextWindow) {
    const nextRun = parseDashboardTimestamp(nextWindow.selectedAt);
    const dayDiff = nextRun ? diffCalendarDays(nextRun, dashboardNow) : null;
    const dayLabel =
      dayDiff === 0 ? "今天" : dayDiff === 1 ? "明天" : nextWindow.selectedAt.slice(0, 10);
    const windowLabel = nextWindow.title.replace("窗口", "");
    const timeLabel = nextRun
      ? formatParsedTime(nextRun)
      : nextWindow.selectedAt;

    return {
      label: `下一次${windowLabel}执行`,
      value: `${dayLabel}${windowLabel}待执行`,
      time: timeLabel,
      detail: `${nextWindow.title}时间范围 ${nextWindow.start}-${nextWindow.end}，计划执行于 ${nextWindow.selectedAt}`,
      tone: "warning",
    };
  }

  return {
    label: "下一次执行",
    value: "等待后端排期",
    time: `${windowValues["上午窗口-selected"]} / ${windowValues["下午窗口-selected"]}`,
    detail: "默认按时间窗口抽取，也支持手动精确指定到秒。",
    tone: "secondary",
  };
}

function getWindowStatus(windowItem, dashboardGeneratedAt) {
  const now = parseDashboardTimestamp(dashboardGeneratedAt) ?? new Date();
  const nextRun = parseDashboardTimestamp(windowItem?.selectedAt);
  const completedAt = parseDashboardDate(windowItem?.completed);

  if (completedAt && diffCalendarDays(completedAt, now) === 0) {
    if (nextRun && diffCalendarDays(nextRun, now) >= 1) {
      return `今日已完成，下次 ${windowItem.title.replace("窗口", "")} 在 ${windowItem.selectedAt}`;
    }
    return "今日已完成";
  }

  if (nextRun) {
    const dayDiff = diffCalendarDays(nextRun, now);
    if (dayDiff === 0) return "今日待执行";
    if (dayDiff === 1) return "明日待执行";
    return `${nextRun.getMonth() + 1}月${nextRun.getDate()}日待执行`;
  }

  return "待排期";
}

function getWindowStatusTone(status) {
  if (/今日已完成/.test(status)) return "success";
  if (/(待执行|待排期)/.test(status)) return "warning";
  return "secondary";
}

function getLatestSuccessSummary(records, dashboardGeneratedAt) {
  const now = parseDashboardTimestamp(dashboardGeneratedAt) ?? new Date();
  const successRecord = (Array.isArray(records) ? records : []).find(
    (record) => record?.status === "成功" && record?.date && record?.time,
  );

  if (!successRecord) {
    return {
      headline: "暂无完成记录",
      time: "--:--:--",
      detail: "等待后端返回执行结果。",
      tone: "secondary",
    };
  }

  const completedAt = parseDashboardTimestamp(`${successRecord.date} ${successRecord.time}`);
  const dayDiff = completedAt ? diffCalendarDays(completedAt, now) : null;
  const checkinType = normalizeCheckinType(successRecord.type).replace("打卡", "");
  const dayLabel =
    dayDiff === 0 ? "今天" : dayDiff === 1 ? "昨天" : successRecord.date;

  return {
    headline: `${dayLabel}${checkinType}已完成`,
    time: successRecord.time,
    detail: successRecord.remark || `完成于 ${successRecord.date} ${successRecord.time}`,
    tone: "success",
  };
}

function buildConfigStateFromDashboard(dashboard) {
  if (!dashboard?.config) return { ...initialConfigState };

  const config = dashboard.config;
  return Object.fromEntries(
    configGroups.flatMap((group) =>
      group.fields.map((field) => {
        let value = config[field.key];
        if (field.key === "delay_after_launch") value = `${value} 秒`;
        if (field.key === "poll_interval") value = `${value} 秒`;
        if (field.key === "scrcpy_launch_cooldown") value = `${value} 秒`;
        if (field.key === "workday_api_timeout_ms") value = `${value} ms`;
        return [field.label, String(value ?? field.defaultValue ?? "")];
      }),
    ),
  );
}

function buildWindowStateFromDashboard(dashboard) {
  if (!dashboard?.windows?.length) return { ...initialWindowState };

  const nextState = { ...initialWindowState };
  dashboard.windows.forEach((item) => {
    nextState[`${item.title}-start`] = item.start;
    nextState[`${item.title}-end`] = item.end;
    nextState[`${item.title}-selected`] = item.selected;
    nextState[`${item.title}-custom`] = item.selected;
    nextState[`${item.title}-completed`] = item.completed;
  });
  return nextState;
}

function buildToggleStateFromDashboard(dashboard) {
  if (!dashboard?.config) return { ...initialToggleState };

  const config = dashboard.config;
  return Object.fromEntries(
    toggleDefinitions.map((item) => [item.label, Boolean(config[item.key])]),
  );
}

function buildConfigPayload(configValues, windowValues, toggleValues, baseConfig = {}) {
  const payload = {
    ...baseConfig,
  };
  Object.entries(CONFIG_FIELD_MAP).forEach(([label, key]) => {
    const rawValue = String(configValues[label] ?? "").trim();
    if (
      key === "delay_after_launch" ||
      key === "poll_interval" ||
      key === "scrcpy_launch_cooldown" ||
      key === "workday_api_timeout_ms"
    ) {
      payload[key] = parseNumber(rawValue) ?? 0;
      return;
    }
    payload[key] = rawValue;
  });

  payload.windows = Object.fromEntries(
    windowsData.map((item) => [
      item.name,
      {
        start: String(windowValues[`${item.title}-start`] ?? "").trim(),
        end: String(windowValues[`${item.title}-end`] ?? "").trim(),
      },
    ]),
  );

  if (Object.prototype.hasOwnProperty.call(payload, "serial")) {
    payload.serial = payload.serial.trim();
  }
  if (Object.prototype.hasOwnProperty.call(baseConfig, "recent_remote_adb_targets")) {
    payload.recent_remote_adb_targets = baseConfig.recent_remote_adb_targets;
  }

  Object.entries(TOGGLE_FIELD_MAP).forEach(([label, key]) => {
    payload[key] = Boolean(toggleValues[label]);
  });

  return payload;
}

function buildNextRunsPayload(windowValues) {
  return Object.fromEntries(
    windowsData.map((item) => [item.name, String(windowValues[`${item.title}-custom`] ?? "").trim()]),
  );
}

function getWindowFromDashboard(dashboard, name) {
  return dashboard?.windows?.find((item) => item.name === name);
}

function formatDeviceConnectionNote(deviceState) {
  if (!deviceState) return "等待设备连接或授权。";
  if (!deviceState.adbAvailable) {
    return `ADB 未就绪：${deviceState.adbInstallHint ?? "先安装 platform-tools/adb"}`;
  }

  if (deviceState.remoteAdbTarget && !deviceState.remoteAdbConnected && deviceState.deviceCount === 0) {
    return `远程目标 ${deviceState.remoteAdbTarget} 尚未连通，请先点击“连接远程 ADB”。`;
  }

  if (!deviceState.serial && deviceState.deviceCount > 1) {
    return `检测到 ${deviceState.deviceCount} 台设备，请配置 serial 绑定目标设备。`;
  }

  if (deviceState.deviceCount === 0) {
    return "未发现在线设备，请确认 USB 已连接、远程 ADB 已连通，或重新刷新设备状态。";
  }

  if (deviceState.usbConnected && !deviceState.authorized) {
    return "设备已连接但未授权，请在手机上确认 USB 调试授权。";
  }

  const adbSource = deviceState.adbSource ? `ADB ${deviceState.adbSource}` : "ADB 已找到";
  const mode = deviceState.usbConnected ? "USB" : deviceState.remoteAdbConnected ? "远程 ADB" : "ADB";
  const serial = deviceState.serial ? `serial: ${deviceState.serial}` : "等待设备连接或授权";
  return `${serial} / ${mode} / ${adbSource}`;
}

function formatAndroidDeviceStateLabel(state) {
  if (state === "device") return "在线";
  if (state === "unauthorized") return "未授权";
  if (state === "offline") return "离线";
  if (!state) return "未知";
  return state;
}

function androidDeviceStateTone(state) {
  if (state === "device") return "success";
  if (state === "unauthorized") return "warning";
  if (state === "offline") return "destructive";
  return "secondary";
}

function App() {
  const [theme, setTheme] = useState(() => {
    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem("console-theme") : null;
    if (saved === "dark" || saved === "light") return saved;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("sidebar-collapsed") === "1";
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0);
  const [activeProject, setActiveProject] = useState("dingtalk");
  const [activeSection, setActiveSection] = useState("overview");
  const [topbarTitle, setTopbarTitle] = useState("监控总览与执行态势");
  const [topbarTone, setTopbarTone] = useState("overview");
  const [pendingAction, setPendingAction] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [apiError, setApiError] = useState("");
  const [dashboardReady, setDashboardReady] = useState(false);
  const [configValues, setConfigValues] = useState(initialConfigState);
  const [savedConfigValues, setSavedConfigValues] = useState(initialConfigState);
  const [toggleValues, setToggleValues] = useState(initialToggleState);
  const [savedToggleValues, setSavedToggleValues] = useState(initialToggleState);
  const [windowValues, setWindowValues] = useState(initialWindowState);
  const [savedWindowValues, setSavedWindowValues] = useState(initialWindowState);
  const [checkinRecords, setCheckinRecords] = useState([]);
  const [checkinRecordsLoading, setCheckinRecordsLoading] = useState(false);
  const [playbackOverview, setPlaybackOverview] = useState(initialPlaybackOverviewState);
  const [deviceCenter, setDeviceCenter] = useState(initialDeviceCenterState);
  const [recordFilter, setRecordFilter] = useState({ date: "", type: "", status: "" });
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(10);
  const [activeGuidePanel, setActiveGuidePanel] = useState("console");

  const quickActionSet = useMemo(
    () =>
      new Set([
        "保存配置",
        "启动任务",
        "自检",
        "一键自检",
        "查看排期",
        "刷新设备状态",
        "连接远程 ADB",
        "断开远程 ADB",
        "远程连通诊断",
        "在线安装 ADB",
        "重启 ADB",
        "连接向导",
        "停止任务",
        "调试模式",
        "试运行",
        "重新抽取",
      ]),
    [],
  );

  const copyToClipboard = useCallback((text, label = "已复制到剪贴板") => {
    if (!text) return;
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持一键复制");
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(label))
      .catch(() => toast.error("复制失败，请手动复制"));
  }, []);


  const dirtyCount = useMemo(() => {
    const configDirty = Object.keys(configValues).filter(
      (key) => configValues[key] !== savedConfigValues[key],
    ).length;
    const toggleDirty = Object.keys(toggleValues).filter(
      (key) => toggleValues[key] !== savedToggleValues[key],
    ).length;
    const windowDirty = Object.keys(windowValues).filter(
      (key) => windowValues[key] !== savedWindowValues[key],
    ).length;
    return configDirty + toggleDirty + windowDirty;
  }, [configValues, savedConfigValues, toggleValues, savedToggleValues, windowValues, savedWindowValues]);

  const hydrateDashboard = useCallback((nextDashboard, preserveDraft = false) => {
    if (!nextDashboard) return;

    const nextConfigState = buildConfigStateFromDashboard(nextDashboard);
    const nextToggleState = buildToggleStateFromDashboard(nextDashboard);
    const nextWindowState = buildWindowStateFromDashboard(nextDashboard);

    setDashboard(nextDashboard);
    setApiError("");
    setSavedConfigValues(nextConfigState);
    setSavedToggleValues(nextToggleState);
    setSavedWindowValues(nextWindowState);
    if (!preserveDraft) {
      setConfigValues(nextConfigState);
      setToggleValues(nextToggleState);
      setWindowValues(nextWindowState);
    }
    setDashboardReady(true);
  }, []);

  const refreshDashboard = useCallback(
    async ({ preserveDraft = false, silent = false } = {}) => {
      try {
        const response = await fetchDashboard();
        hydrateDashboard(response.dashboard, preserveDraft);
        return response.dashboard;
      } catch (error) {
        setApiError(error.message);
        setDashboardReady(true);
        if (!silent) {
          toast.error("后端连接失败", {
            description: error.message,
          });
        }
        throw error;
      }
    },
    [hydrateDashboard],
  );

  const refreshPlaybackOverview = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setPlaybackOverview((current) => ({ ...current, loading: true }));
      }

      try {
        const list = await fetchPlaybackDevices();
        const devices = Array.isArray(list) ? list : [];
        const onlineDevices = devices.filter((item) => item?.state === "device");
        const unauthorizedCount = devices.filter((item) => item?.state === "unauthorized").length;
        const activeSerial =
          devices.find((item) => item?.serial === playbackOverview.selectedSerial)?.serial
          || onlineDevices[0]?.serial
          || devices[0]?.serial
          || "";

        let dashboardSnapshot = null;
        let dashboardError = "";

        if (activeSerial) {
          try {
            dashboardSnapshot = await fetchPlaybackProgramDashboard(activeSerial);
          } catch (error) {
            dashboardError = error instanceof Error ? error.message : "读取刷视频运行记录失败";
          }
        }

        setPlaybackOverview({
          ready: true,
          loading: false,
          error: dashboardError,
          deviceCount: devices.length,
          onlineCount: onlineDevices.length,
          unauthorizedCount,
          selectedSerial: activeSerial,
          isRunning: Boolean(dashboardSnapshot?.isRunning),
          startedAt: String(dashboardSnapshot?.startedAt || ""),
          lastUpdatedAt: String(dashboardSnapshot?.lastUpdatedAt || ""),
          currentAppName: String(
            dashboardSnapshot?.currentAppName
            || dashboardSnapshot?.currentAppPackageName
            || "",
          ),
          totalCycles: Number(dashboardSnapshot?.totalCycles) || 0,
          recentLogDetail: String(dashboardSnapshot?.recentLogs?.[0]?.detail || ""),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "读取刷视频设备状态失败";
        setPlaybackOverview({
          ...initialPlaybackOverviewState,
          ready: true,
          loading: false,
          error: message,
        });
      }
    },
    [playbackOverview.selectedSerial],
  );

  const refreshDeviceCenter = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setDeviceCenter((current) => ({ ...current, loading: true }));
      }

      const merged = new Map();
      const insertDevice = (item, sourceLabel) => {
        const serial = String(item?.serial || "").trim();
        if (!serial) return;
        const state = String(item?.state || "").trim() || "unknown";
        const existing = merged.get(serial);
        if (existing) {
          merged.set(serial, {
            ...existing,
            state: existing.state === "device" ? existing.state : state,
            usbConnected: existing.usbConnected || Boolean(item?.usbConnected),
            sources: Array.from(new Set([...existing.sources, sourceLabel])),
          });
          return;
        }
        merged.set(serial, {
          serial,
          state,
          usbConnected: Boolean(item?.usbConnected),
          sources: [sourceLabel],
        });
      };

      const dingtalkDevices = Array.isArray(dashboard?.device?.devices)
        ? dashboard.device.devices
        : [];
      dingtalkDevices.forEach((item) => insertDevice(item, "打卡后端"));

      let playbackError = "";
      try {
        const playbackDevices = await fetchPlaybackDevices();
        const list = Array.isArray(playbackDevices) ? playbackDevices : [];
        list.forEach((item) => insertDevice(item, "刷视频后端"));
      } catch (error) {
        playbackError = error instanceof Error ? error.message : "读取刷视频设备失败";
      }

      const statePriority = { device: 0, unauthorized: 1, offline: 2, unknown: 3 };
      const devices = Array.from(merged.values()).sort((left, right) => {
        const lp = statePriority[left.state] ?? 9;
        const rp = statePriority[right.state] ?? 9;
        if (lp !== rp) return lp - rp;
        return left.serial.localeCompare(right.serial);
      });

      const fallbackError = dashboard?.device?.error || "未检测到已连接安卓设备。";
      const hardError = devices.length === 0 ? (playbackError || fallbackError) : "";
      const partialError = devices.length > 0 ? playbackError : "";
      setDeviceCenter({
        ready: true,
        loading: false,
        error: hardError,
        partialError,
        devices,
        updatedAtLabel: new Date().toLocaleString("zh-CN", { hour12: false }),
      });
    },
    [dashboard?.device?.devices, dashboard?.device?.error],
  );

  useEffect(() => {
    refreshDashboard({ silent: true }).catch(() => {});
  }, [refreshDashboard]);

  useEffect(() => {
    if (activeSection !== "overview") return undefined;

    refreshPlaybackOverview({ silent: playbackOverview.ready }).catch(() => {});

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refreshPlaybackOverview({ silent: true }).catch(() => {});
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [activeSection, playbackOverview.ready, refreshPlaybackOverview]);

  useEffect(() => {
    if (activeSection !== "device-management") return undefined;

    refreshDeviceCenter({ silent: deviceCenter.ready }).catch(() => {});

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refreshDeviceCenter({ silent: true }).catch(() => {});
    }, 12000);

    return () => window.clearInterval(intervalId);
  }, [activeSection, deviceCenter.ready, refreshDeviceCenter]);

  useEffect(() => {
    if (!dashboardReady) return undefined;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refreshDashboard({ preserveDraft: dirtyCount > 0, silent: true }).catch(() => {});
    }, 12000);

    return () => window.clearInterval(intervalId);
  }, [dashboardReady, dirtyCount, refreshDashboard]);

  useEffect(() => {
    if (!dashboardReady) return;

    const loadCheckinRecords = async () => {
      setCheckinRecordsLoading(true);
      try {
        const response = await fetchCheckinRecords();
        setCheckinRecords(response.records || []);
      } catch {
        setCheckinRecords([]);
      } finally {
        setCheckinRecordsLoading(false);
      }
    };

    loadCheckinRecords();
  }, [dashboardReady]);

  const filteredRecords = useMemo(() => {
    return checkinRecords.filter((record) => {
      if (recordFilter.date && record.date !== recordFilter.date) return false;
      if (
        recordFilter.type &&
        normalizeCheckinType(record.type) !== normalizeCheckinType(recordFilter.type)
      ) {
        return false;
      }
      if (recordFilter.status && record.status !== recordFilter.status) return false;
      return true;
    });
  }, [checkinRecords, recordFilter]);

  const paginatedRecords = useMemo(() => {
    const start = (recordPage - 1) * recordPageSize;
    return filteredRecords.slice(start, start + recordPageSize);
  }, [filteredRecords, recordPage, recordPageSize]);

  const totalRecords = filteredRecords.length;
  const totalPages = Math.ceil(totalRecords / recordPageSize);

  const handleExportRecords = useCallback(() => {
    if (filteredRecords.length === 0) {
      toast.error("导出失败", { description: "没有可导出的记录" });
      return;
    }

    const headers = ["日期", "时间", "类型", "状态", "备注"];
    const rows = filteredRecords.map((r) => [
      r.date,
      r.time,
      normalizeCheckinType(r.type),
      r.status,
      r.remark,
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell ?? ""}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `打卡记录_${getCurrentBeijingDateStamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("导出成功", { description: `已导出 ${filteredRecords.length} 条记录` });
  }, [filteredRecords]);

  const handleResetFilter = useCallback(() => {
    setRecordFilter({ date: "", type: "", status: "" });
    setRecordPage(1);
  }, []);

  const handleUseRemoteAdbTarget = useCallback((target) => {
    const normalizedTarget = typeof target === "string" ? target : target?.target || "";
    const normalizedName = typeof target === "string" ? "" : target?.name || "";
    handleConfigChange("远程 ADB 目标 remote_adb_target", normalizedTarget);
    handleConfigChange("远程目标名称 remote_adb_target_name", normalizedName);
    toast.success("已填入远程目标", {
      description: `${normalizedName ? `${normalizedName} / ` : ""}${normalizedTarget} 已写入当前草稿，保存配置后生效。`,
    });
  }, []);

  const handleDeleteRemoteAdbTarget = useCallback(async (target) => {
    const normalizedTarget = typeof target === "string" ? target : target?.target || "";
    try {
      const response = await deleteRemoteAdbTarget(normalizedTarget);
      if (response?.dashboard) {
        hydrateDashboard(response.dashboard, true);
      }
      toast.success(response?.message || "远程目标已删除", {
        description: response?.detail || `${normalizedTarget} 已从最近使用列表移除。`,
      });
    } catch (error) {
      toast.error("删除远程目标失败", {
        description: error.message,
      });
    }
  }, [hydrateDashboard]);

  const pendingWindowSummary = useMemo(
    () => getPendingWindowSummary(dashboard, windowValues),
    [dashboard, windowValues],
  );
  const scheduleSummary = pendingWindowSummary.value;
  const latestSuccessSummary = useMemo(
    () => getLatestSuccessSummary(checkinRecords, dashboard?.generatedAt),
    [checkinRecords, dashboard?.generatedAt],
  );
  const todayCheckinStats = useMemo(() => {
    const today = getCurrentBeijingDateStamp();
    return checkinRecords.reduce(
      (acc, record) => {
        if (record?.date !== today) return acc;
        const normalizedStatus = String(record?.status || "");
        if (normalizedStatus.includes("成功")) acc.success += 1;
        else if (normalizedStatus.includes("失败")) acc.failed += 1;
        else acc.other += 1;
        return acc;
      },
      { date: today, success: 0, failed: 0, other: 0 },
    );
  }, [checkinRecords]);

  const monitorSnapshotCards = useMemo(() => {
    const dingtalkAlerts = (dashboard?.alerts ?? []).filter(
      (item) => item?.title && item.title !== "当前没有阻断性告警",
    );
    const dingtalkTone = !dashboardReady
      ? "secondary"
      : apiError
      ? "warning"
      : dashboard?.scheduler?.running && dashboard?.device?.ready
        ? "success"
        : dashboard?.device?.error
          ? "destructive"
          : "secondary";

    const playbackTone = !playbackOverview.ready || playbackOverview.loading
      ? "secondary"
      : playbackOverview.error
      ? "warning"
      : playbackOverview.isRunning
        ? "success"
        : playbackOverview.onlineCount > 0
          ? "secondary"
          : "warning";

    return [
      {
        id: "dingtalk",
        title: "自动钉钉打卡",
        icon: Bot,
        tone: dingtalkTone,
        statusText: !dashboardReady
          ? "状态读取中"
          : apiError
          ? "后端离线"
          : dashboard?.scheduler?.running
            ? "调度运行中"
            : "调度未启动",
        rows: [
          {
            label: "设备状态",
            value: dashboard?.device?.error
              ? `异常 / ${dashboard.device.error}`
              : dashboard?.device?.summary || "待同步",
          },
          {
            label: "今日打卡",
            value: `${todayCheckinStats.success} 成功 / ${todayCheckinStats.failed} 失败`,
          },
          {
            label: "下一执行",
            value: pendingWindowSummary.time || "待排期",
          },
          {
            label: "告警数量",
            value: dingtalkAlerts.length > 0 ? `${dingtalkAlerts.length} 条` : "无阻断告警",
          },
        ],
        detail: latestSuccessSummary.headline === "暂无完成记录"
          ? "今日尚无成功记录，建议先试运行。"
          : `最近成功：${latestSuccessSummary.headline} ${latestSuccessSummary.time}`,
        actions: [
          { key: "goto-actions", label: "任务配置", target: "actions" },
          { key: "goto-logs", label: "告警日志", target: "logs" },
        ],
      },
      {
        id: "playback",
        title: "自动刷视频",
        icon: CirclePlay,
        tone: playbackTone,
        statusText: !playbackOverview.ready || playbackOverview.loading
          ? "状态读取中"
          : playbackOverview.error
          ? "服务不可达"
          : playbackOverview.isRunning
            ? "程序运行中"
            : "程序未运行",
        rows: [
          {
            label: "设备在线",
            value: `${playbackOverview.onlineCount}/${playbackOverview.deviceCount}`,
          },
          {
            label: "目标设备",
            value: playbackOverview.selectedSerial || "未发现设备",
          },
          {
            label: "当前应用",
            value: playbackOverview.currentAppName || "-",
          },
          {
            label: "最近更新",
            value: playbackOverview.lastUpdatedAt ? formatPlaybackDateTime(playbackOverview.lastUpdatedAt) : "-",
          },
        ],
        detail: playbackOverview.error
          ? playbackOverview.error
          : playbackOverview.recentLogDetail
            ? `最新日志：${playbackOverview.recentLogDetail}`
            : `累计循环 ${playbackOverview.totalCycles} 次`,
        actions: [
          {
            key: "goto-playback-dashboard",
            label: "运行记录",
            target: "playback-dashboard",
          },
          {
            key: "goto-playback-devices",
            label: "任务配置",
            target: "playback-devices",
          },
        ],
      },
    ];
  }, [
    dashboardReady,
    apiError,
    dashboard,
    latestSuccessSummary.headline,
    latestSuccessSummary.time,
    pendingWindowSummary.time,
    playbackOverview,
    todayCheckinStats.failed,
    todayCheckinStats.success,
  ]);

  const remoteAdbSummary = useMemo(() => {
    const deviceState = dashboard?.device;
    const remoteAdbState = dashboard?.remoteAdb;
    const target = deviceState?.remoteAdbTarget || remoteAdbState?.target || "";
    const targetName = deviceState?.remoteAdbTargetName || "";

    if (!target) {
      return {
        headline: "未配置远程目标",
        detail: "在任务配置里填写 remote_adb_target 后，可直接在网页端连接或断开远程 ADB。",
        time: "等待配置",
        tone: "secondary",
      };
    }

    if (deviceState?.remoteAdbConnected) {
      return {
        headline: targetName ? `${targetName} 已连接` : "远程 ADB 已连接",
        detail: remoteAdbState?.detail || `${target} 当前已连通，可继续刷新状态或执行自检。`,
        time: remoteAdbState?.checkedAtLabel || `${targetName ? `${targetName} / ` : ""}${target}`,
        tone: "success",
      };
    }

    if (remoteAdbState?.detail) {
      return {
        headline: remoteAdbState?.ok === false
          ? (targetName ? `${targetName} 连接失败` : "远程 ADB 连接失败")
          : (targetName ? `${targetName} 未连接` : "远程 ADB 未连接"),
        detail: remoteAdbState.detail,
        time: remoteAdbState?.checkedAtLabel || `${targetName ? `${targetName} / ` : ""}${target}`,
        tone: remoteAdbState?.ok === false ? "destructive" : "warning",
      };
    }

    return {
      headline: targetName ? `${targetName} 待连接` : "远程 ADB 待连接",
      detail: `${target} 已保存，点击“连接远程 ADB”后再刷新设备状态。`,
      time: `${targetName ? `${targetName} / ` : ""}${target}`,
      tone: "warning",
    };
  }, [dashboard]);

  const metrics = useMemo(() => {
    const deviceState = dashboard?.device;
    const workdayState = dashboard?.workday;
    let deviceLabel = "待处理";

    if (deviceState && !deviceState.adbAvailable) deviceLabel = "ADB 未就绪";
    else if (deviceState?.ready) deviceLabel = "已连接";
    else if (deviceState?.error) deviceLabel = "异常";
    else if (/unauthorized/i.test(deviceState?.summary ?? "")) deviceLabel = "未授权";

    return [
      {
        id: "scheduler",
        label: "当前任务状态",
        value: dashboard?.scheduler?.label ?? "未启动",
        note: dashboard?.scheduler?.detail ?? "等待后端返回真实调度进程状态。",
        icon: Activity,
      },
      {
        id: "device",
        label: "设备状态",
        value: deviceLabel,
        note:
          dashboard?.remoteAdb?.detail && dashboard?.remoteAdb?.checkedAtLabel
            ? `${deviceState?.error || formatDeviceConnectionNote(deviceState)} / 最近远程 ADB：${dashboard.remoteAdb.checkedAtLabel}`
            : deviceState?.error || formatDeviceConnectionNote(deviceState),
        icon: Smartphone,
      },
      {
        id: "next-window",
        label: pendingWindowSummary.label,
        value: pendingWindowSummary.time,
        note: pendingWindowSummary.detail,
        icon: AlarmClockCheck,
        tone: pendingWindowSummary.tone,
      },
      {
        id: "recent-success",
        label: "最近成功执行",
        value: latestSuccessSummary.headline,
        note:
          workdayState?.enabled && workdayState?.checkedDateLabel
            ? `${workdayState.checkedDateLabel} / ${workdayState.note || "已校验"}`
            : "工作日状态会在后端返回后显示。",
        icon: BadgeCheck,
      },
    ];
  }, [dashboard, latestSuccessSummary.headline, pendingWindowSummary]);

  const statusRows = useMemo(() => {
    const morningWindow = getWindowFromDashboard(dashboard, "morning");
    const eveningWindow = getWindowFromDashboard(dashboard, "evening");
    const workdayState = dashboard?.workday;
    const connectorLabel = apiError
      ? "离线 / 无法读取后端"
      : dashboard?.generatedAtLabel
        ? `在线 / ${dashboard.generatedAtLabel}`
        : "在线 / 等待时间戳";

    return [
      ["连接器状态", connectorLabel, true],
      [
        "设备状态",
        dashboard?.device?.error
          ? `异常 / ${dashboard.device.error}`
          : `${dashboard?.device?.summary ?? "待处理"}${dashboard?.device?.serial ? ` / ${dashboard.device.serial}` : ""}`,
        true,
      ],
      [
        "ADB 连接器",
        !dashboard?.device
          ? "待后端返回"
          : dashboard.device.adbAvailable
            ? `${dashboard.device.adbSource ?? "已找到"} / ${dashboard.device.adbBin ?? "adb"}`
            : `未安装 / ${dashboard.device.adbInstallHint ?? "在网页端点击“在线安装 ADB”"}`,
      ],
      [
        "远程 ADB 目标",
        dashboard?.device?.remoteAdbTarget
          ? `${dashboard.device.remoteAdbTargetName ? `${dashboard.device.remoteAdbTargetName} / ` : ""}${dashboard.device.remoteAdbTarget} / ${dashboard.device.remoteAdbConnected ? "已连接" : "未连接"}`
          : "未配置",
      ],
      [
        "最近远程 ADB 动作",
        dashboard?.remoteAdb?.action
          ? `${dashboard.remoteAdb.action === "connect" ? "连接" : "断开"} / ${dashboard.remoteAdb.ok ? "成功" : "失败"}`
          : "暂无记录",
      ],
      [
        "最近远程 ADB 结果",
        dashboard?.remoteAdb?.detail
          ? `${dashboard.remoteAdb.detail}${dashboard.remoteAdb.checkedAtLabel ? ` / ${dashboard.remoteAdb.checkedAtLabel}` : ""}`
          : "暂无记录",
      ],
      [
        "scrcpy 前台观察",
        toggleValues["scrcpy 观察模式"]
          ? dashboard?.device?.scrcpyAvailable
            ? `已启用 / ${dashboard?.device?.scrcpyRunning ? "运行中" : "待拉起"}`
            : "已启用 / scrcpy 不可用"
          : "已关闭 / 仅保持设备连接",
      ],
      ["上午下一次执行时间", morningWindow?.selectedAtLabel ?? windowValues["上午窗口-selected"]],
      ["下午下一次执行时间", eveningWindow?.selectedAtLabel ?? windowValues["下午窗口-selected"]],
      [
        "最近一次成功执行时间",
        latestSuccessSummary.headline === "暂无完成记录"
          ? "暂无执行记录"
          : `${latestSuccessSummary.headline} ${latestSuccessSummary.time}`,
      ],
      [
        "最近一次工作日校验结果",
        !workdayState?.enabled
          ? "已关闭"
          : workdayState?.error
            ? `失败 / ${workdayState.error}`
            : `${workdayState?.checkedDateLabel ?? "待校验"} / ${workdayState?.note ?? "待返回"}`,
      ],
    ];
  }, [apiError, dashboard, latestSuccessSummary, toggleValues, windowValues]);

  const statusTags = dashboard?.statusTags ?? ["等待后端状态"];
  const toggles = dashboard?.toggles ?? [];
  const logs = dashboard?.logs ?? [];
  const timeline = dashboard?.timeline ?? [];
  const alerts = dashboard?.alerts ?? [];
  const deviceState = dashboard?.device;
  const primaryActions = actions.filter((item) => item.group === "primary");
  const runtimeActions = actions.filter((item) => item.group === "runtime");
  const supportActions = actions.filter((item) => item.group === "support");

  const needsConnectionGuide = useMemo(() => {
    if (apiError) return true;
    if (!dashboardReady || !deviceState) return false;
    if (!deviceState.adbAvailable) return true;
    if (deviceState.deviceCount === 0) return true;
    if (deviceState.unauthorizedCount > 0) return true;
    if (deviceState.deviceCount > 1 && !deviceState.serial) return true;
    if (deviceState.error) return true;
    return false;
  }, [apiError, dashboardReady, deviceState]);

  const validation = useMemo(() => {
    const next = {};
    const add = (key, message) => {
      next[key] = message;
    };

    if (!String(configValues["应用包名 package"] || "").trim()) {
      add("应用包名 package", "应用包名不能为空。");
    }
    if (!String(configValues["应用名称 app_label"] || "").trim()) {
      add("应用名称 app_label", "应用名称不能为空。");
    }
    if (!String(configValues["状态文件路径 state_file"] || "").trim()) {
      add("状态文件路径 state_file", "状态文件路径不能为空。");
    }

    const launchDelay = parseNumber(configValues["启动后停留时长"]);
    if (launchDelay === null || launchDelay < 1) {
      add("启动后停留时长", "启动后停留时长至少为 1 秒。");
    }

    const pollInterval = parseNumber(configValues["轮询间隔 poll_interval"]);
    if (pollInterval === null || pollInterval < 1) {
      add("轮询间隔 poll_interval", "轮询间隔至少为 1 秒。");
    }

    const scrcpyCooldown = parseNumber(configValues["scrcpy 重连冷却"]);
    if (scrcpyCooldown === null || scrcpyCooldown < 1) {
      add("scrcpy 重连冷却", "scrcpy 重连冷却至少为 1 秒。");
    }

    const timeout = parseNumber(configValues["接口超时时间"]);
    if (timeout === null || timeout < 1000) {
      add("接口超时时间", "接口超时时间建议不低于 1000 ms。");
    }

    const workdayUrl = String(configValues["工作日接口地址"] || "").trim();
    if (!/^https?:\/\//.test(workdayUrl)) {
      add("工作日接口地址", "工作日接口地址必须以 http:// 或 https:// 开头。");
    }

    const remoteAdbTarget = String(configValues["远程 ADB 目标 remote_adb_target"] || "").trim();
    if (remoteAdbTarget) {
      const matched = remoteAdbTarget.match(/^([^:\s]+):(\d{1,5})$/);
      if (!matched) {
        add("远程 ADB 目标 remote_adb_target", "远程 ADB 目标格式应为 host:port，例如 192.168.1.8:5555。");
      } else {
        const port = Number(matched[2]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          add("远程 ADB 目标 remote_adb_target", "远程 ADB 端口范围必须在 1-65535。");
        }
      }
    }

    windowsData.forEach((item) => {
      const startKey = `${item.title}-start`;
      const endKey = `${item.title}-end`;
      const customKey = `${item.title}-custom`;
      const start = String(windowValues[startKey] || "").trim();
      const end = String(windowValues[endKey] || "").trim();
      const custom = String(windowValues[customKey] || "").trim();
      if (!/^\d{2}:\d{2}$/.test(start)) add(startKey, "时间格式应为 HH:MM。");
      if (!/^\d{2}:\d{2}$/.test(end)) add(endKey, "时间格式应为 HH:MM。");
      if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end) && start >= end) {
        add(endKey, "结束时间必须晚于开始时间。");
      }

      if (!/^\d{2}:\d{2}:\d{2}$/.test(custom)) {
        add(customKey, "指定时间格式应为 HH:MM:SS。");
      }

      const startSeconds = parseTimeToSeconds(start);
      const endSeconds = parseTimeToSeconds(end);
      const customSeconds = parseTimeToSeconds(custom);
      if (
        startSeconds !== null &&
        endSeconds !== null &&
        customSeconds !== null &&
        (customSeconds < startSeconds || customSeconds > endSeconds)
      ) {
        add(customKey, "指定的下一次打卡时间必须落在当前时间窗口内。");
      }
    });

    return next;
  }, [configValues, windowValues]);

  const validationIssues = useMemo(
    () => Object.entries(validation).map(([key, message]) => ({ key, message })),
    [validation],
  );

  const hasBlockingIssues = validationIssues.length > 0;

  const focusState = useMemo(() => {
    if (hasBlockingIssues) {
      return {
        tone: "destructive",
        title: "当前优先项：先修复配置阻断问题",
        detail: `还有 ${validationIssues.length} 项配置校验未通过，当前不适合直接启动任务或试运行。`,
        chips: ["保存前先修复阻断项", `草稿变更 ${dirtyCount} 项`, "建议先完成自检"],
      };
    }

    if (apiError) {
      return {
        tone: "warning",
        title: "当前优先项：先恢复后端连接",
        detail: "前端无法读取后端真实状态，当前页面数据可能不是最新结果。",
        chips: ["执行 npm run backend:start", "恢复后自动拉取状态", "不要在离线状态下误判结果"],
      };
    }

    if (dashboard?.device && !dashboard.device.adbAvailable) {
      return {
        tone: "destructive",
        title: "当前优先项：安装 ADB 连接器",
        detail: dashboard.device.error || "ADB 未就绪，无法继续设备动作。",
        chips: [
          dashboard.device.adbInstallHint || "在网页端点击“在线安装 ADB”",
          "安装后刷新设备状态",
          "如需指定路径，可在前台填写 adb_bin",
        ],
      };
    }

    if (dashboard?.device?.remoteAdbTarget && !dashboard.device.remoteAdbConnected && dashboard.device.deviceCount === 0) {
      return {
        tone: "warning",
        title: "当前优先项：连接远程 ADB 目标",
        detail: `已配置远程目标 ${dashboard.device.remoteAdbTarget}，但后端尚未连通。`,
        chips: ["先点击连接远程 ADB", "连接后刷新设备状态", "必要时检查目标网络、端口和无线调试"],
      };
    }

    if (dashboard?.device?.usbConnected && !dashboard.device.authorized) {
      return {
        tone: "warning",
        title: "当前优先项：完成 USB 调试授权",
        detail: "设备已连接但未授权，请在手机上确认 USB 调试授权弹窗。",
        chips: ["手机上点击允许 USB 调试", "必要时重新插拔 USB", "授权后刷新设备状态"],
      };
    }

    if (dashboard?.device?.error) {
      return {
        tone: "destructive",
        title: "当前优先项：先处理设备或 adb 异常",
        detail: dashboard.device.error,
        chips: ["先恢复设备状态", "再执行一键自检", "确认后再试运行"],
      };
    }

    if (dashboard?.scheduler?.running && dashboard?.device?.ready) {
      return {
        tone: "success",
        title: "当前优先项：保持观察，等待下一个窗口",
        detail: "调度进程和设备状态都处于可执行区间，当前不需要额外操作。",
        chips: [
          `下一次计划 ${scheduleSummary}`,
          dashboard?.device?.serial ? `设备 ${dashboard.device.serial}` : "设备已就绪",
          dashboard?.workday?.note ? `工作日 ${dashboard.workday.note}` : "等待工作日结果",
        ],
      };
    }

    return {
      tone: "warning",
      title: "当前优先项：先自检，再决定是否启动",
      detail: "如果还没有明确确认设备与接口状态，不建议直接进入正式调度。",
      chips: [
        `下一次计划 ${scheduleSummary}`,
        dashboard?.workday?.enabled
          ? `工作日校验 ${dashboard?.workday?.note || "待返回"}`
          : "工作日校验已关闭",
        dirtyCount > 0 ? `未保存变更 ${dirtyCount} 项` : "当前没有未保存变更",
      ],
    };
  }, [apiError, dashboard, dirtyCount, hasBlockingIssues, scheduleSummary, validationIssues.length]);

  const priorities = useMemo(
    () => [
      {
        title: "建议先处理",
        value: hasBlockingIssues ? "先修复配置阻断项，再进行任何执行动作" : "先自检，再决定是否试运行或启动任务",
        note: hasBlockingIssues
          ? `当前仍有 ${validationIssues.length} 项校验问题。`
          : dashboard?.device?.ready
            ? "设备已就绪，直接做一次后端自检最稳妥。"
            : dashboard?.device?.error || "设备未就绪时不要直接触发自动打卡。",
        icon: CheckCheck,
      },
      {
        title: "当前风险",
        value: alerts[0]?.title ?? "暂无阻断风险",
        note: alerts[0]?.detail ?? "控制台已切换为真实后端数据源。",
        icon: TriangleAlert,
      },
      {
        title: "最近变更",
        value: `轮询间隔 ${parseNumber(configValues["轮询间隔 poll_interval"]) ?? "--"} 秒`,
        note: `状态文件：${String(configValues["状态文件路径 state_file"] || "未设置")}`,
        icon: BellRing,
      },
    ],
    [alerts, configValues, dashboard, hasBlockingIssues, validationIssues.length],
  );

  const overviewChecklist = useMemo(() => {
    if (hasBlockingIssues) {
      return [
        "先修复所有参数和时间窗口的阻断项",
        "确认排期草稿和基础参数草稿都可保存",
        "保存配置后执行一键自检",
        "最后再试运行或启动任务",
      ];
    }

    if (dashboard?.scheduler?.running && dashboard?.device?.ready) {
      return [
        "确认下一次计划时间是否符合当天安排",
        "保持设备在线并关注最新日志",
        "只在需要中断调度时再执行停止任务",
      ];
    }

    if (dashboard?.device?.error) {
      return [
        "先恢复设备连接或 adb 授权",
        "执行一键自检确认链路恢复",
        "刷新设备状态后再考虑试运行",
      ];
    }

    return quickChecklist;
  }, [dashboard, hasBlockingIssues]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("console-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sidebarCollapsed) return;
    document.documentElement.classList.remove("sidebar-expand-cursor-active");
    document.querySelector(".custom-cursor")?.classList.remove("custom-cursor--hidden");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!sidebarCollapsed) return undefined;
    if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) return undefined;

    const root = document.documentElement;
    const sidebar = document.getElementById("stage-slideover-sidebar");
    if (!sidebar) return undefined;

    const follower = document.createElement("div");
    follower.className = "sidebar-expand-follower";
    follower.setAttribute("aria-hidden", "true");
    follower.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path fill="none" d="M14 12H4m10 0l-4 4m4-4l-4-4m10-4v16"/></svg>';
    document.body.appendChild(follower);

    let active = false;
    let targetX = -100;
    let targetY = -100;
    let currentX = -100;
    let currentY = -100;
    let rafId = 0;
    let sidebarHovering = false;
    const isCursorBlockedArea = (target) =>
      target instanceof Element && Boolean(target.closest("[data-sidebar-cursor-block='true']"));
    const restoreMainCursor = () => {
      document.querySelector(".custom-cursor")?.classList.remove("custom-cursor--hidden");
    };

    const syncActive = (next) => {
      if (active === next) return;
      active = next;
      root.classList.toggle("sidebar-expand-cursor-active", active);
      follower.classList.toggle("sidebar-expand-follower--active", active);
      if (!active) restoreMainCursor();
    };

    const onSidebarEnter = () => {
      sidebarHovering = true;
      syncActive(false);
    };

    const onSidebarLeave = () => {
      sidebarHovering = false;
      syncActive(false);
    };

    const onMouseMove = (event) => {
      targetX = event.clientX;
      targetY = event.clientY;
      if (!sidebarHovering) {
        if (active) syncActive(false);
        return;
      }
      syncActive(!isCursorBlockedArea(event.target));
    };

    const onWindowLeave = () => {
      syncActive(false);
      targetX = -100;
      targetY = -100;
    };

    const onWindowBlur = () => {
      syncActive(false);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") syncActive(false);
    };

    const animate = () => {
      currentX += (targetX - currentX) * 0.16;
      currentY += (targetY - currentY) * 0.16;
      const scale = active ? 1 : 0.86;
      follower.style.transform = `translate(${currentX}px, ${currentY}px) translate(-50%, -50%) scale(${scale})`;
      rafId = window.requestAnimationFrame(animate);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onWindowLeave);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    sidebar.addEventListener("mouseenter", onSidebarEnter);
    sidebar.addEventListener("mouseleave", onSidebarLeave);
    animate();

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onWindowLeave);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sidebar.removeEventListener("mouseenter", onSidebarEnter);
      sidebar.removeEventListener("mouseleave", onSidebarLeave);
      root.classList.remove("sidebar-expand-cursor-active");
      follower.remove();
    };
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const interactiveSelector = '#stage-slideover-sidebar [data-sidebar-item="true"]';
    const segmentSelector = "path, line, polyline, polygon, rect, circle, ellipse";
    const cleanupTasks = [];

    const measureSegmentLength = (segment) => {
      let length = 0;

      try {
        if (typeof segment.getTotalLength === "function") {
          length = segment.getTotalLength();
        }
      } catch {
        length = 0;
      }

      if (!Number.isFinite(length) || length <= 0) {
        try {
          if (typeof segment.getBBox === "function") {
            const box = segment.getBBox();
            length = (box.width + box.height) * 2;
          }
        } catch {
          length = 0;
        }
      }

      if (!Number.isFinite(length) || length <= 0) return 72;
      return Math.max(20, Math.ceil(length));
    };

    const hosts = Array.from(document.querySelectorAll(interactiveSelector));

    hosts.forEach((host) => {
      const icons = host.querySelectorAll(".lucide");
      icons.forEach((icon) => {
        const segments = Array.from(icon.querySelectorAll(segmentSelector));
        if (!segments.length) return;

        const duration = Math.min(2400, 1500 + segments.length * 72);
        icon.style.setProperty("--icon-path-duration", `${duration}ms`);
        cleanupTasks.push(() => {
          icon.style.removeProperty("--icon-path-duration");
        });

        segments.forEach((segment, index) => {
          const length = measureSegmentLength(segment);
          segment.style.setProperty("--icon-path-length", `${length}`);
          segment.style.setProperty("--icon-path-delay", `${index * 34}ms`);
          cleanupTasks.push(() => {
            segment.style.removeProperty("--icon-path-length");
            segment.style.removeProperty("--icon-path-delay");
          });
        });
      });
    });

    return () => {
      cleanupTasks.forEach((task) => task());
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    const nextMeta = SECTION_TOPBAR_META[activeSection] ?? SECTION_TOPBAR_META.overview;
    setTopbarTitle((current) => (current === nextMeta.title ? current : nextMeta.title));
    setTopbarTone((current) => (current === nextMeta.tone ? current : nextMeta.tone));
  }, [activeSection]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const rawHash = window.location.hash.replace(/^#/, "");
    if (!rawHash) return undefined;

    const initialSection = SECTION_GROUP_MAP[rawHash] ?? "overview";
    setActiveProject(resolveProjectFromSection(initialSection));
    setActiveSection(initialSection);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(rawHash);
        if (target) {
          target.scrollIntoView({ behavior: "auto", block: "start" });
          return;
        }
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    });

    return undefined;
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileNavOpen]);

  const handleConfigChange = (label, value) => {
    setConfigValues((current) => ({ ...current, [label]: value }));
  };

  const handleToggleChange = (label) => {
    setToggleValues((current) => ({ ...current, [label]: !current[label] }));
  };

  const handleWindowChange = (title, key, value) => {
    setWindowValues((current) => ({ ...current, [`${title}-${key}`]: value }));
  };

  const handleRestoreDefaults = () => {
    setWindowValues({ ...initialWindowState });
    toast("已恢复默认排期", {
      description: "已回退为默认窗口与默认下一次时间，保存配置后生效。",
    });
  };

  const scrollToSection = useCallback((id) => {
    const targetGroup = SECTION_GROUP_MAP[id] ?? "overview";
    setActiveProject(resolveProjectFromSection(targetGroup));
    setActiveSection(targetGroup);

    const hashTarget = targetGroup === "guide" ? id : targetGroup;
    const hash = targetGroup === "overview" ? "" : `#${hashTarget}`;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      });
    });
  }, []);

  const openGuideSection = useCallback((anchorId = "guide") => {
    scrollToSection(anchorId || "guide");
  }, [scrollToSection]);

  const handleProjectSwitch = useCallback((projectId) => {
    setMobileNavOpen(false);
    if (projectId === "playback") {
      setActiveProject("playback");
      setActiveSection("playback-devices");
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#playback-devices`,
      );
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      });
      return;
    }

    setActiveProject("dingtalk");
    setActiveSection("overview");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  }, []);

  const handleNavClick = (event, id) => {
    event?.preventDefault?.();
    setMobileNavOpen(false);
    const targetGroup = SECTION_GROUP_MAP[id] ?? "overview";
    setActiveProject(resolveProjectFromSection(targetGroup));
    setActiveSection(targetGroup);

    const hashTarget = targetGroup === "guide" ? "guide" : targetGroup;
    const hash = targetGroup === "overview" ? "" : `#${hashTarget}`;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  };

  const isConfigFieldDirty = (label) => configValues[label] !== savedConfigValues[label];
  const isToggleDirty = (label) => toggleValues[label] !== savedToggleValues[label];
  const isWindowFieldDirty = (title, key) =>
    windowValues[`${title}-${key}`] !== savedWindowValues[`${title}-${key}`];

  const handleAction = async (label) => {
    if (!quickActionSet.has(label)) return;

    if (label === "连接向导") {
      openGuideSection("guide-connection-wizard");
      toast.success("已打开连接向导", {
        description: "连接向导已移动到“使用说明”中的独立版块，方便随时学习和查看。",
      });
      return;
    }

    if ((label === "保存配置" || label === "启动任务" || label === "调试模式") && hasBlockingIssues) {
      toast.warning("请先修复阻断问题", {
        description: `当前还有 ${validationIssues.length} 项校验问题，修复后才能继续保存或启动任务。`,
      });
      return;
    }

    if (label === "查看排期") {
      scrollToSection("windows");
      toast.success("已定位到排期设置", {
        description: "你可以直接修改时间窗口或手动指定下一次打卡时间。",
      });
      return;
    }

    setPendingAction(label);

    try {
      let response;
      let preserveDraft = dirtyCount > 0;
      let toastMethod = "success";

      if (label === "保存配置") {
        preserveDraft = false;
        response = await saveConfig({
          config: buildConfigPayload(configValues, windowValues, toggleValues, dashboard?.config),
          nextRuns: buildNextRunsPayload(windowValues),
        });
      } else if (label === "重新抽取") {
        preserveDraft = false;
        response = await rerollSchedule();
      } else if (label === "刷新设备状态") {
        const nextDashboard = await refreshDashboard({ preserveDraft: dirtyCount > 0, silent: true });
        toast.success("设备状态已刷新", {
          description: nextDashboard?.device?.error || "已从后端重新读取设备、排期与日志状态。",
        });
        return;
      } else if (label === "连接远程 ADB") {
        response = await connectRemoteAdb();
      } else if (label === "断开远程 ADB") {
        toastMethod = "warning";
        response = await disconnectRemoteAdb();
      } else if (label === "远程连通诊断") {
        response = await diagnoseRemoteAdb();
      } else if (label === "在线安装 ADB") {
        response = await installAdb();
      } else if (label === "重启 ADB") {
        toastMethod = "warning";
        response = await restartAdb();
      } else if (label === "启动任务") {
        response = await startScheduler("run");
      } else if (label === "停止任务") {
        toastMethod = "warning";
        response = await stopScheduler();
      } else if (label === "调试模式") {
        toastMethod = "warning";
        response = await startScheduler("debug");
      } else if (label === "试运行") {
        toastMethod = "warning";
        response = await runOnce();
      } else if (label === "自检" || label === "一键自检") {
        response = await runDoctor();
      } else {
        return;
      }

      if (response?.dashboard) {
        hydrateDashboard(response.dashboard, preserveDraft);
      }

      const title = response?.message || `${label} 已完成`;
      const detail = response?.detail || response?.output || "后端动作已执行。";
      if (toastMethod === "warning") {
        toast.warning(title, { description: detail });
      } else {
        toast.success(title, { description: detail });
      }
    } catch (error) {
      toast.error(`${label} 失败`, {
        description: error.message,
      });
    } finally {
      setPendingAction((current) => (current === label ? "" : current));
    }
  };

  const focusQuickActions = (() => {
    if (apiError) {
      return [
        { key: "refresh", label: "刷新设备状态", variant: "outline", onClick: () => handleAction("刷新设备状态") },
        { key: "guide", label: "打开连接向导", variant: "outline", onClick: () => openGuideSection("guide-connection-wizard") },
      ];
    }

    if (hasBlockingIssues) {
      return [
        { key: "fix", label: "去修复配置", variant: "default", onClick: () => scrollToSection("config") },
        { key: "doctor", label: "一键自检", variant: "outline", onClick: () => handleAction("一键自检") },
      ];
    }

    if (needsConnectionGuide || dashboard?.device?.error) {
      return [
        { key: "refresh", label: "刷新设备状态", variant: "default", onClick: () => handleAction("刷新设备状态") },
        { key: "doctor", label: "一键自检", variant: "outline", onClick: () => handleAction("一键自检") },
        { key: "guide", label: "连接向导", variant: "outline", onClick: () => openGuideSection("guide-connection-wizard") },
      ];
    }

    if (dashboard?.scheduler?.running && dashboard?.device?.ready) {
      return [
        { key: "schedule", label: "查看排期", variant: "outline", onClick: () => scrollToSection("windows") },
        { key: "logs", label: "查看告警日志", variant: "outline", onClick: () => handleNavClick(undefined, "logs") },
      ];
    }

    return [
      { key: "doctor", label: "一键自检", variant: "default", onClick: () => handleAction("一键自检") },
      { key: "run-once", label: "试运行", variant: "outline", onClick: () => handleAction("试运行") },
      { key: "actions", label: "前往任务配置", variant: "outline", onClick: () => scrollToSection("actions") },
    ];
  })();

  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery("");
    setCommandPaletteActiveIndex(0);
  }, []);

  const commandPaletteItems = useMemo(
    () => [
      {
        id: "goto-overview",
        group: "导航",
        label: "前往 运行总览",
        hint: "监控总览与执行态势",
        icon: Gauge,
        shortcut: "G O",
        keywords: "overview 总览 监控",
        run: () => handleNavClick(undefined, "overview"),
      },
      {
        id: "goto-actions",
        group: "导航",
        label: "前往 任务配置",
        hint: "配置参数与时间窗口",
        icon: FolderCog,
        shortcut: "G A",
        keywords: "actions 配置 参数",
        run: () => handleNavClick(undefined, "actions"),
      },
      {
        id: "goto-records",
        group: "导航",
        label: "前往 打卡记录",
        hint: "查看历史执行结果",
        icon: ClipboardList,
        shortcut: "G R",
        keywords: "records 记录",
        run: () => handleNavClick(undefined, "records"),
      },
      {
        id: "goto-logs",
        group: "导航",
        label: "前往 告警日志",
        hint: "查看异常与告警",
        icon: BellRing,
        shortcut: "G L",
        keywords: "logs 告警 日志",
        run: () => handleNavClick(undefined, "logs"),
      },
      {
        id: "goto-guide",
        group: "导航",
        label: "前往 使用说明",
        hint: "打开连接向导与文档",
        icon: CircleHelp,
        shortcut: "G ?",
        keywords: "guide 文档 说明 连接向导",
        run: () => handleNavClick(undefined, "guide"),
      },
      {
        id: "goto-device-management",
        group: "导航",
        label: "前往 设备管理",
        hint: "查看所有已连接安卓设备",
        icon: Smartphone,
        shortcut: "G M",
        keywords: "device management 设备 adb 安卓",
        run: () => handleNavClick(undefined, "device-management"),
      },
      {
        id: "goto-playback-devices",
        group: "导航",
        label: "前往 刷视频任务配置",
        hint: "进入 Playback 任务配置页",
        icon: FolderCog,
        shortcut: "G D",
        keywords: "playback devices 设备 任务配置",
        run: () => handleNavClick(undefined, "playback-devices"),
      },
      {
        id: "goto-playback-dashboard",
        group: "导航",
        label: "前往 刷视频运行记录",
        hint: "进入 Playback 运行记录页",
        icon: ListChecks,
        shortcut: "G B",
        keywords: "playback dashboard 看板 运行记录",
        run: () => handleNavClick(undefined, "playback-dashboard"),
      },
      {
        id: "switch-project-dingtalk",
        group: "项目",
        label: "切换到 自动钉钉打卡项目",
        hint: "回到钉钉控制台",
        icon: Bot,
        shortcut: "P D",
        keywords: "project dingtalk",
        visible: activeProject !== "dingtalk",
        run: () => handleProjectSwitch("dingtalk"),
      },
      {
        id: "switch-project-playback",
        group: "项目",
        label: "切换到 自动刷视频项目",
        hint: "切到 Playback 控制台",
        icon: CirclePlay,
        shortcut: "P P",
        keywords: "project playback",
        visible: activeProject !== "playback",
        run: () => handleProjectSwitch("playback"),
      },
      {
        id: "action-save-config",
        group: "操作",
        label: "执行 保存配置",
        hint: "将草稿同步到后端配置",
        icon: CheckCheck,
        shortcut: "A S",
        keywords: "save 保存 配置",
        visible: activeProject === "dingtalk",
        run: () => handleAction("保存配置"),
      },
      {
        id: "action-doctor",
        group: "操作",
        label: "执行 一键自检",
        hint: "检查 ADB、设备与服务链路",
        icon: Stethoscope,
        shortcut: "A D",
        keywords: "doctor 自检",
        visible: activeProject === "dingtalk",
        run: () => handleAction("一键自检"),
      },
      {
        id: "action-run-once",
        group: "操作",
        label: "执行 试运行",
        hint: "单次模拟执行流程",
        icon: Play,
        shortcut: "A R",
        keywords: "run once 试运行",
        visible: activeProject === "dingtalk",
        run: () => handleAction("试运行"),
      },
      {
        id: "action-start",
        group: "操作",
        label: "执行 启动任务",
        hint: "启动正式调度",
        icon: Power,
        shortcut: "A G",
        keywords: "start 启动",
        visible: activeProject === "dingtalk",
        run: () => handleAction("启动任务"),
      },
      {
        id: "action-stop",
        group: "操作",
        label: "执行 停止任务",
        hint: "停止调度任务",
        icon: Power,
        shortcut: "A X",
        keywords: "stop 停止",
        visible: activeProject === "dingtalk",
        run: () => handleAction("停止任务"),
      },
      {
        id: "action-refresh",
        group: "操作",
        label: "执行 刷新设备状态",
        hint: "从后端刷新当前状态",
        icon: RefreshCw,
        shortcut: "A F",
        keywords: "refresh 刷新",
        visible: activeProject === "dingtalk",
        run: () => handleAction("刷新设备状态"),
      },
      {
        id: "action-remote-diagnose",
        group: "操作",
        label: "执行 远程连通诊断",
        hint: "检查 DNS、TCP 和 adb 目标状态",
        icon: Search,
        shortcut: "A T",
        keywords: "diagnose remote adb 诊断",
        visible: activeProject === "dingtalk",
        run: () => handleAction("远程连通诊断"),
      },
    ],
    [activeProject, handleAction, handleNavClick, handleProjectSwitch],
  );

  const filteredCommandPaletteItems = useMemo(() => {
    const keyword = commandPaletteQuery.trim().toLowerCase();
    return commandPaletteItems
      .filter((item) => item.visible !== false)
      .filter((item) => {
        if (!keyword) return true;
        const haystack = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`.toLowerCase();
        return haystack.includes(keyword);
      });
  }, [commandPaletteItems, commandPaletteQuery]);

  useEffect(() => {
    if (commandPaletteActiveIndex < filteredCommandPaletteItems.length) return;
    setCommandPaletteActiveIndex(0);
  }, [commandPaletteActiveIndex, filteredCommandPaletteItems.length]);

  const executeCommandPaletteItem = useCallback(
    async (item) => {
      if (!item?.run) return;
      closeCommandPalette();
      try {
        await Promise.resolve(item.run());
      } catch (error) {
        toast.error("命令执行失败", {
          description: error?.message || "请稍后重试。",
        });
      }
    },
    [closeCommandPalette],
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const onKeyDown = (event) => {
      if (event.isComposing) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (!commandPaletteOpen) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (!filteredCommandPaletteItems.length) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandPaletteActiveIndex((current) => (current + 1) % filteredCommandPaletteItems.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandPaletteActiveIndex((current) =>
          current <= 0 ? filteredCommandPaletteItems.length - 1 : current - 1,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        executeCommandPaletteItem(filteredCommandPaletteItems[commandPaletteActiveIndex]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closeCommandPalette,
    commandPaletteActiveIndex,
    commandPaletteOpen,
    executeCommandPaletteItem,
    filteredCommandPaletteItems,
  ]);

  const wizardSteps = useMemo(() => {
    const steps = [];
    const adbInstallHint = deviceState?.adbInstallHint || "在网页端点击“在线安装 ADB”";
    const backendCommand = "npm run backend:start";
    const deviceCount = deviceState?.deviceCount ?? 0;
    const onlineCount = deviceState?.onlineCount ?? 0;
    const unauthorizedCount = deviceState?.unauthorizedCount ?? 0;
    const serial = deviceState?.serial ?? "";
    const remoteTarget = deviceState?.remoteAdbTarget ?? "";
    const remoteConnected = Boolean(deviceState?.remoteAdbConnected);
    const adbError = deviceState?.error ?? "";
    const needsSerial = deviceCount > 1 && !serial;
    const needsAdbRestart = /ADB 服务启动失败|daemon|5037/i.test(adbError);

    steps.push({
      key: "backend",
      title: "启动后端服务",
      detail: "确保当前服务器上的 api_server 正在运行，否则无法读取设备状态。",
      done: !apiError,
      code: backendCommand,
      primaryAction: {
        label: "复制启动命令",
        onClick: () => copyToClipboard(backendCommand, "启动命令已复制"),
      },
      secondaryAction: {
        label: "我已启动，刷新",
        onClick: () => handleAction("刷新设备状态"),
      },
    });

    steps.push({
      key: "adb",
      title: "安装 ADB",
      detail: deviceState?.adbAvailable
        ? "已检测到云端 ADB，可进入下一步。"
        : "在当前云服务器安装官方 platform-tools/adb，或在前台配置 adb_bin。",
      done: Boolean(deviceState?.adbAvailable),
      code: adbInstallHint,
      primaryAction: {
        label: "在线安装 ADB",
        onClick: () => handleAction("在线安装 ADB"),
      },
      secondaryAction: {
        label: "安装后刷新",
        onClick: () => handleAction("刷新设备状态"),
      },
    });

    steps.push({
      key: "device-connect",
      title: "连接设备",
      detail:
        deviceCount > 0
          ? `已检测到 ${deviceCount} 台设备，在线 ${onlineCount} 台。`
          : remoteTarget
            ? `当前远程目标为 ${remoteTarget}，请先执行远程连接。`
            : "未检测到设备，请连接 USB 并开启 USB 调试。",
      done: deviceCount > 0,
      primaryAction: remoteTarget && !remoteConnected
        ? {
            label: "连接远程 ADB",
            onClick: () => handleAction("连接远程 ADB"),
          }
        : {
            label: "刷新设备状态",
            onClick: () => handleAction("刷新设备状态"),
          },
      secondaryAction: remoteTarget && !remoteConnected
        ? {
            label: "刷新设备状态",
            onClick: () => handleAction("刷新设备状态"),
          }
        : null,
    });

    steps.push({
      key: "authorize",
      title: "完成 USB 调试授权",
      detail:
        unauthorizedCount > 0
          ? `检测到 ${unauthorizedCount} 台设备未授权，请在手机上点击允许 USB 调试。`
          : "已授权或未发现未授权设备。",
      done: unauthorizedCount === 0,
      primaryAction: {
        label: "刷新设备状态",
        onClick: () => handleAction("刷新设备状态"),
      },
    });

    steps.push({
      key: "bind-serial",
      title: "绑定目标设备",
      detail: needsSerial
        ? `当前检测到 ${deviceCount} 台设备，请在“设备与应用”里配置 serial。`
        : serial
          ? `已绑定 serial: ${serial}`
          : "当前无需绑定 serial。",
      done: !needsSerial,
      primaryAction: needsSerial
        ? {
            label: "去配置 serial",
            onClick: () => scrollToSection("config"),
          }
        : null,
    });

    if (needsAdbRestart) {
      steps.push({
        key: "adb-restart",
        title: "重启 ADB 服务",
        detail: "当前检测到 ADB daemon 启动异常，建议重启。",
        done: false,
        primaryAction: {
          label: "重启 ADB",
          onClick: () => handleAction("重启 ADB"),
        },
      });
    }

    steps.push({
      key: "doctor",
      title: "执行一键自检",
      detail: deviceState?.ready ? "设备已就绪，建议执行一次自检确认链路。" : "自检可确认设备与依赖是否可用。",
      done: Boolean(deviceState?.ready),
      primaryAction: {
        label: "一键自检",
        onClick: () => handleAction("一键自检"),
      },
    });

    return steps;
  }, [apiError, deviceState, handleAction, scrollToSection]);

  const activeWizardStep = useMemo(() => {
    if (!wizardSteps.length) return null;
    return wizardSteps.find((step) => !step.done) ?? wizardSteps[wizardSteps.length - 1];
  }, [wizardSteps]);

  const configDirtyCount = Object.keys(configValues).filter(
    (key) => configValues[key] !== savedConfigValues[key],
  ).length;
  const toggleDirtyCount = Object.keys(toggleValues).filter(
    (key) => toggleValues[key] !== savedToggleValues[key],
  ).length;
  const windowDirtyCount = Object.keys(windowValues).filter(
    (key) => windowValues[key] !== savedWindowValues[key],
  ).length;
  const configDraftParts = [
    configDirtyCount > 0 ? `${configDirtyCount} 个参数` : "",
    toggleDirtyCount > 0 ? `${toggleDirtyCount} 个开关` : "",
  ].filter(Boolean);

  const actionStatus = !dashboardReady
    ? {
        icon: RefreshCw,
        title: "正在同步执行环境",
        detail: "后端状态、设备状态和调度上下文读取中，建议等待同步完成后再触发动作。",
        loading: true,
      }
    : apiError
      ? {
          icon: TriangleAlert,
          tone: "warning",
          title: "后端离线，动作请求暂不可用",
          detail: "当前按钮仍可见，但所有需要后端响应的动作都会失败。先执行 npm run backend:start。",
          actionLabel: "刷新状态",
          onAction: () => handleAction("刷新设备状态"),
        }
      : hasBlockingIssues
        ? {
            icon: TriangleAlert,
            tone: "warning",
            title: `存在 ${validationIssues.length} 项阻断问题`,
            detail: "保存配置、启动任务和调试模式已禁用。先修复参数或时间窗口校验。",
          }
        : pendingAction
          ? {
              icon: RefreshCw,
              tone: "warning",
              title: `${pendingAction} 执行中`,
              detail: "等待后端返回结果，执行期间不建议重复触发同类动作。",
              loading: true,
            }
          : {
              icon: CheckCheck,
              tone: "success",
              title: "执行环境已就绪",
              detail: "推荐顺序：一键自检、刷新设备状态、试运行，最后再正式启动任务。",
            };

  const scheduleStatus = !dashboardReady
    ? {
        icon: RefreshCw,
        title: "正在同步排期",
        detail: "后端当前时间窗口和下一次执行计划读取中。",
        loading: true,
      }
    : apiError
      ? {
          icon: TriangleAlert,
          tone: "warning",
          title: "排期区进入离线草稿模式",
          detail: "你仍然可以修改时间，但当前无法保存到后端；恢复连接后会重新同步真实排期。",
          actionLabel: "刷新状态",
          onAction: () => handleAction("刷新设备状态"),
        }
      : windowDirtyCount > 0
        ? {
            icon: FileClock,
            tone: hasBlockingIssues ? "warning" : "success",
            title: "排期草稿待保存",
            detail: hasBlockingIssues
              ? `已修改 ${windowDirtyCount} 项窗口设置，但还有 ${validationIssues.length} 项校验问题需要先修复。`
              : `已修改 ${windowDirtyCount} 项窗口设置，保存后会覆盖后端当前下一次执行时间。`,
            actionLabel: hasBlockingIssues ? undefined : "保存配置",
            onAction: hasBlockingIssues ? undefined : () => handleAction("保存配置"),
          }
        : {
            icon: AlarmClockCheck,
            tone: "success",
            title: "排期已与后端同步",
            detail: "当前显示的是后端真实时间窗口和下一次执行计划。",
          };

  const configStatus = !dashboardReady
    ? {
        icon: RefreshCw,
        title: "正在同步基础参数",
        detail: "设备、应用和调度参数读取中，稍后会自动回填到表单。",
        loading: true,
      }
    : apiError
      ? {
          icon: TriangleAlert,
          tone: "warning",
          title: "基础参数处于离线草稿模式",
          detail: "现在可以继续编辑，但提交时不会成功。恢复后端连接后再保存更稳妥。",
          actionLabel: "刷新状态",
          onAction: () => handleAction("刷新设备状态"),
        }
      : configDirtyCount + toggleDirtyCount > 0
        ? {
            icon: FolderCog,
            tone: hasBlockingIssues ? "warning" : "success",
            title: "基础参数草稿待保存",
            detail: hasBlockingIssues
              ? `已修改 ${configDraftParts.join("、")}，但仍有 ${validationIssues.length} 项校验问题未通过。`
              : `已修改 ${configDraftParts.join("、")}，保存后才会同步到后端配置文件。`,
            actionLabel: hasBlockingIssues ? undefined : "保存配置",
            onAction: hasBlockingIssues ? undefined : () => handleAction("保存配置"),
          }
        : {
            icon: CheckCheck,
            tone: "success",
            title: "基础参数已与后端同步",
            detail: "当前展示的是后端真实配置，修改后需要显式保存才会生效。",
          };

  const deviceCenterSummary = useMemo(() => {
    const list = deviceCenter.devices;
    return {
      total: list.length,
      online: list.filter((item) => item.state === "device").length,
      unauthorized: list.filter((item) => item.state === "unauthorized").length,
      offline: list.filter((item) => item.state === "offline").length,
    };
  }, [deviceCenter.devices]);

  const showTopbar = !(activeProject === "dingtalk" && activeSection === "guide");
  const showBottomStickyMenu =
    activeProject === "dingtalk" &&
    activeSection !== "guide" &&
    activeSection !== "device-management";

  return (
    <div
      className="unified-icon-scale min-h-screen bg-background text-foreground"
      style={{
        "--sidebar-expanded-width": "280px",
        "--sidebar-inner-size": "40px",
        "--sidebar-rail-padding": "1rem",
        "--sidebar-border-width": "1px",
        "--sidebar-collapsed-width":
          "calc(var(--sidebar-inner-size) + (var(--sidebar-rail-padding) * 2) + var(--sidebar-border-width))",
      }}
    >
      <AdvancedCursor />
      <div className="surface-grid pointer-events-none fixed inset-0 opacity-60 dark:opacity-40" />

      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/30 backdrop-blur-sm transition-opacity lg:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!mobileNavOpen}
        onClick={() => setMobileNavOpen(false)}
      />

      <CommandPalette
        moduleId={ADVANCED_SEARCH_FEATURE_MODULE_ID}
        moduleName={ADVANCED_SEARCH_FEATURE_MODULE_NAME}
        open={commandPaletteOpen}
        query={commandPaletteQuery}
        onQueryChange={(value) => {
          setCommandPaletteQuery(value);
          setCommandPaletteActiveIndex(0);
        }}
        items={filteredCommandPaletteItems}
        activeIndex={commandPaletteActiveIndex}
        onActiveIndexChange={setCommandPaletteActiveIndex}
        onClose={closeCommandPalette}
        onSelectItem={executeCommandPaletteItem}
      />

        <div
          className={cn(
          "mx-auto min-h-screen transition-none lg:grid lg:transition-[grid-template-columns] lg:duration-500 lg:ease-[cubic-bezier(0.22,1,0.36,1)]",
          sidebarCollapsed
            ? "lg:grid-cols-[var(--sidebar-collapsed-width)_minmax(0,1fr)]"
            : "lg:grid-cols-[var(--sidebar-expanded-width)_minmax(0,1fr)]",
        )}
      >
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/90 px-4 py-4 backdrop-blur lg:hidden">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Console
            </p>
            <h1 className="truncate text-sm font-semibold">自动打卡控制台</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setMobileNavOpen((value) => !value)}>
              {mobileNavOpen ? <X /> : <Menu />}
            </Button>
          </div>
        </header>

        <aside
          id="stage-slideover-sidebar"
          className={cn(
            "group/sidebar-rail sidebar-scrollbar fixed inset-y-0 left-0 z-40 flex w-[var(--sidebar-expanded-width)] origin-left flex-col overflow-y-auto border-r bg-background/95 p-4 backdrop-blur transition-[width,padding,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:p-4",
            sidebarCollapsed
              ? "lg:w-[var(--sidebar-collapsed-width)] lg:cursor-none"
              : "lg:w-[var(--sidebar-expanded-width)]",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
          onClick={(event) => {
            if (!sidebarCollapsed) return;
            if (!(event.target instanceof Element)) return;
            if (event.target.closest("[data-sidebar-item='true']")) return;
            setSidebarCollapsed(false);
          }}
        >
          <div className="flex h-full min-h-0 flex-col gap-4">
            <LogoRegion collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((value) => !value)} />
            <SidebarNav
              collapsed={sidebarCollapsed}
              activeProject={activeProject}
              activeSection={activeSection}
              onProjectSwitch={handleProjectSwitch}
              onNavClick={handleNavClick}
              onOpenCommandPalette={openCommandPalette}
            />
            {/* <SidebarSummaryCard collapsed={sidebarCollapsed} scheduleSummary={scheduleSummary} /> */}
          </div>
        </aside>

        <main className="min-w-0 px-3 pb-40 pt-3 sm:px-4 sm:pb-36 lg:px-4 lg:pt-3 lg:pb-6">
          {showTopbar && (
            <TopbarRegion
              title={topbarTitle}
              tone={topbarTone}
              theme={theme}
              sidebarCollapsed={sidebarCollapsed}
              onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
            />
          )}

          <section className="content-region mt-4 space-y-10 sm:mt-4 sm:space-y-12 lg:mt-5 xl:space-y-12">
            {activeProject === "dingtalk" ? (
              <>
            {activeSection === "overview" ? (
                <RegionSection
                  title="监控总览与执行态势"
                  description="集中查看自动钉钉打卡与自动刷视频的关键运行状态。"
                >
              <div className="dashboard-layout">
                <section id="overview" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "60ms" }}>
                  <Card className="region-card h-full overflow-hidden">
                    <CardContent className="region-card-content space-y-4 p-4 pt-4">
                      {!dashboardReady ? (
                        <Card className="border-border bg-muted/30">
                          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                            <RefreshCw className="size-4 animate-spin" />
                            <span>正在读取后端状态与调度配置...</span>
                          </CardContent>
                        </Card>
                      ) : null}

                      {apiError ? (
                        <Card className="border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20">
                          <CardHeader className="pb-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="warning">后端未连接</Badge>
                              <CardTitle>控制台暂时无法读取真实后端数据</CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3 text-sm text-foreground">
                            <p>{apiError}</p>
                            <p className="text-muted-foreground">
                              启动命令：`npm run backend:start`
                            </p>
                          </CardContent>
                        </Card>
                      ) : null}

                      {hasBlockingIssues ? (
                        <Card className="border-red-200 bg-red-50/80 dark:border-red-900/40 dark:bg-red-950/20">
                          <CardHeader className="pb-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="destructive">阻断项 {validationIssues.length}</Badge>
                              <CardTitle>保存与启动前需要先修复以下问题</CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2">
                            {validationIssues.map((issue) => (
                              <div key={issue.key} className="flex items-start gap-2 text-sm text-foreground">
                                <TriangleAlert className="mt-1 size-4 text-red-500" />
                                <span>{issue.message}</span>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      ) : null}

                      <FocusStrip focus={focusState} quickActions={focusQuickActions} />

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {metrics.map((item, index) => (
                          <MetricCard key={item.label} item={item} delay={`${120 + index * 60}ms`} />
                        ))}
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        {monitorSnapshotCards.map((item) => (
                          <ProjectMonitorCard
                            key={item.id}
                            item={item}
                            onNavigate={(target) => handleNavClick(undefined, target)}
                          />
                        ))}
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                        <RemoteAdbPanel
                          summary={remoteAdbSummary}
                          pendingAction={pendingAction}
                          onConnect={() => handleAction("连接远程 ADB")}
                          onDisconnect={() => handleAction("断开远程 ADB")}
                          onRefresh={() => handleAction("刷新设备状态")}
                        />
                        <Card className="bg-muted/20">
                          <CardHeader className="pb-4">
                            <CardTitle>远程目标建议</CardTitle>
                            <CardDescription>最近使用过的远程 ADB 目标会自动保留在配置里。</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {(dashboard?.config?.recent_remote_adb_targets ?? []).length ? (
                              (dashboard?.config?.recent_remote_adb_targets ?? []).map((target) => (
                                <div key={target.target ?? target} className="flex items-center justify-between gap-3 rounded-lg border bg-background/70 px-4 py-3 text-sm">
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium text-foreground">{target.name || target.target || target}</div>
                                    {target.name ? <div className="truncate text-xs text-muted-foreground">{target.target}</div> : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => handleUseRemoteAdbTarget(target)}>
                                      填入
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => handleDeleteRemoteAdbTarget(target)}>
                                      删除
                                    </Button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="text-sm leading-6 text-muted-foreground">
                                还没有历史目标。首次连接成功或失败后，这里会自动沉淀最近使用的 `host:port`。
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <Card className="bg-muted/20">
                          <CardHeader className="pb-4">
                            <CardTitle>现在最该看的信息</CardTitle>
                            <CardDescription>只保留当前决策必需的信息。</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {!dashboardReady ? (
                              <SectionState
                                icon={RefreshCw}
                                title="正在生成决策建议"
                                detail="系统会根据设备、排期和运行状态生成建议。"
                                loading
                              />
                            ) : apiError ? (
                              <SectionState
                                icon={TriangleAlert}
                                tone="warning"
                                title="离线状态下不建议继续操作"
                                detail="先恢复后端连接，再根据实时状态决定是保存、自检还是启动任务。"
                                actionLabel="刷新状态"
                                onAction={() => handleAction("刷新设备状态")}
                              />
                            ) : (
                              priorities.map((item) => (
                                <DecisionRow key={item.title} item={item} />
                              ))
                            )}
                          </CardContent>
                        </Card>

                        <Card className="bg-muted/20">
                          <CardHeader className="pb-4">
                            <CardTitle>推荐操作路径</CardTitle>
                            <CardDescription>按顺序处理更稳妥。</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {!dashboardReady ? (
                              <SectionState
                                icon={RefreshCw}
                                title="正在整理操作路径"
                                detail="系统会根据当前状态给出推荐步骤。"
                                loading
                              />
                            ) : apiError ? (
                              <SectionState
                                icon={TriangleAlert}
                                tone="warning"
                                title="离线状态下仅展示基础步骤"
                                detail="恢复后端连接后，系统会给出更准确的操作顺序。"
                              />
                            ) : (
                              overviewChecklist.map((item, index) => (
                                <div key={item} className="flex items-start gap-2 rounded-lg border bg-background px-4 py-4 text-sm">
                                  <Badge variant="outline" className="mt-0.5 rounded-md">
                                    {index + 1}
                                  </Badge>
                                  <p className="leading-6 text-muted-foreground">{item}</p>
                                </div>
                              ))
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section className="dashboard-block fade-up" style={{ "--delay": "180ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <CardTitle>运行状态</CardTitle>
                        <CardDescription>先判断当前能不能执行。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4 pt-4">
                      <div className="flex flex-wrap gap-2">
                        {statusTags.map((item) => (
                          <Badge key={item} variant={statusTone(item)} className="rounded-md">
                            {item}
                          </Badge>
                        ))}
                      </div>
                      <div className="space-y-4">
                        {statusRows.map(([label, value, emphasized]) => (
                          <SummaryRow key={label} label={label} value={value} emphasized={emphasized} />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </div>
            </RegionSection>
            ) : null}

            {activeSection === "device-management" ? (
            <RegionSection
              title="设备管理"
              description="独立展示所有已连接安卓设备。"
            >
              <div className="dashboard-layout">
                <section id="device-management" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "120ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <CardTitle>安卓设备列表</CardTitle>
                        <CardDescription>汇总显示当前已连接设备（USB / 远程 ADB）。</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => refreshDeviceCenter({ silent: false })}
                        disabled={deviceCenter.loading}
                      >
                        <RefreshCw className={cn("size-4", deviceCenter.loading && "animate-spin")} />
                        <span>刷新设备</span>
                      </Button>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4 pt-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        <SummaryRow label="设备总数" value={`${deviceCenterSummary.total}`} emphasized />
                        <SummaryRow label="在线设备" value={`${deviceCenterSummary.online}`} />
                        <SummaryRow label="未授权设备" value={`${deviceCenterSummary.unauthorized}`} />
                        <SummaryRow label="离线设备" value={`${deviceCenterSummary.offline}`} />
                      </div>

                      {!deviceCenter.ready || (deviceCenter.loading && deviceCenterSummary.total === 0) ? (
                        <SectionState
                          icon={RefreshCw}
                          title="正在读取设备列表"
                          detail="正在同步安卓设备连接状态，请稍候。"
                          loading
                        />
                      ) : null}

                      {deviceCenter.error && deviceCenterSummary.total === 0 ? (
                        <SectionState
                          icon={TriangleAlert}
                          tone="warning"
                          title="设备列表暂不可用"
                          detail={deviceCenter.error}
                          actionLabel="重新刷新"
                          onAction={() => refreshDeviceCenter({ silent: false })}
                        />
                      ) : null}

                      {deviceCenter.partialError && deviceCenterSummary.total > 0 ? (
                        <Card className="border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20">
                          <CardContent className="p-4 text-sm text-amber-700 dark:text-amber-300">
                            部分数据源不可用：{deviceCenter.partialError}
                          </CardContent>
                        </Card>
                      ) : null}

                      {deviceCenterSummary.total > 0 ? (
                        <div className="overflow-x-auto rounded-lg border">
                          <table className="min-w-full border-collapse text-sm">
                            <thead>
                              <tr className="bg-muted/30 text-left">
                                <th className="border-b px-3 py-2">设备 serial</th>
                                <th className="border-b px-3 py-2">状态</th>
                                <th className="border-b px-3 py-2">连接类型</th>
                                <th className="border-b px-3 py-2">来源</th>
                              </tr>
                            </thead>
                            <tbody>
                              {deviceCenter.devices.map((item) => (
                                <tr key={item.serial}>
                                  <td className="border-b px-3 py-2 font-medium">{item.serial}</td>
                                  <td className="border-b px-3 py-2">
                                    <Badge variant={androidDeviceStateTone(item.state)} className="rounded-md">
                                      {formatAndroidDeviceStateLabel(item.state)}
                                    </Badge>
                                  </td>
                                  <td className="border-b px-3 py-2 text-muted-foreground">
                                    {item.usbConnected ? "USB" : "远程 ADB / TCP"}
                                  </td>
                                  <td className="border-b px-3 py-2 text-muted-foreground">
                                    {item.sources.join(" / ")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      {deviceCenter.updatedAtLabel ? (
                        <p className="text-xs text-muted-foreground">最近刷新：{deviceCenter.updatedAtLabel}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </section>
              </div>
            </RegionSection>
            ) : null}

            {activeSection === "actions" ? (
            <RegionSection
              title="任务配置与排期管理"
              description="集中管理动作、排期和关键参数。"
            >
              <div className="dashboard-layout">
                <section id="actions" className="dashboard-block fade-up scroll-mt-28" style={{ "--delay": "160ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <CardTitle>快捷动作</CardTitle>
                        <CardDescription>优先处理高频动作。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4 pt-4">
                      <SectionState {...actionStatus} />
                      <div className="grid items-stretch gap-4 lg:grid-cols-2">
                        <Card className="flex h-full flex-col bg-muted/20">
                          <CardHeader className="pb-4">
                            <CardTitle>优先动作</CardTitle>
                            <CardDescription>先做确认链路，再决定是否正式启动。</CardDescription>
                          </CardHeader>
                          <CardContent className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {primaryActions.map((item, index) => (
                              <ActionTile
                                key={item.label}
                                item={item}
                                className="fade-up"
                                style={{ "--delay": `${220 + index * 40}ms` }}
                                isPending={pendingAction === item.label}
                                onClick={() => handleAction(item.label)}
                              />
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="flex h-full flex-col bg-muted/20">
                          <CardHeader className="pb-4">
                            <CardTitle>运行控制与辅助动作</CardTitle>
                            <CardDescription>右侧合并为一块内容，运行控制和辅助动作横排展示。</CardDescription>
                          </CardHeader>
                          <CardContent className="grid flex-1 gap-4 md:grid-cols-2">
                            <div className="rounded-xl border bg-background/70 p-4">
                              <div className="mb-4 space-y-2">
                                <p className="text-sm font-medium text-foreground">运行控制</p>
                                <p className="text-xs leading-6 text-muted-foreground">控制后端调度进程的启动、停止和调试。</p>
                              </div>
                              <div className="space-y-3">
                                {runtimeActions.map((item) => (
                                  <ActionButton
                                    key={item.label}
                                    variant={item.style}
                                    icon={item.icon}
                                    size="sm"
                                    className="w-full justify-start"
                                    isPending={pendingAction === item.label}
                                    onClick={() => handleAction(item.label)}
                                  >
                                    {item.label}
                                  </ActionButton>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-xl border bg-background/70 p-4">
                              <div className="mb-4 space-y-2">
                                <p className="text-sm font-medium text-foreground">辅助动作</p>
                                <p className="text-xs leading-6 text-muted-foreground">低频但常用的辅助入口。</p>
                              </div>
                              <div className="space-y-3">
                                {supportActions.map((item) => (
                                  <ActionButton
                                    key={item.label}
                                    variant={item.style}
                                    icon={item.icon}
                                    size="sm"
                                    className="w-full justify-start"
                                    isPending={pendingAction === item.label}
                                    onClick={() => handleAction(item.label)}
                                  >
                                    {item.label}
                                  </ActionButton>
                                ))}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
                        <SquareTerminal className="size-4 shrink-0" />
                        <p>推荐顺序：保存配置后先自检，再刷新设备状态，确认无误后试运行。</p>
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section id="windows" className="dashboard-block relative z-30 fade-up scroll-mt-28" style={{ "--delay": "220ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <CardTitle>排期设置</CardTitle>
                        <CardDescription>看时间、改时间、重抽时间。</CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ActionButton
                          variant="default"
                          icon={RefreshCw}
                          size="sm"
                          isPending={pendingAction === "重新抽取"}
                          onClick={() => handleAction("重新抽取")}
                        >
                          重新抽取
                        </ActionButton>
                        <Button variant="outline" size="sm" onClick={handleRestoreDefaults}>
                          恢复默认
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4 pt-4">
                      <SectionState {...scheduleStatus} />
                      <div className="grid items-stretch gap-4 lg:grid-cols-2">
                        <PendingWindowPanel
                          title="当前待执行窗口"
                          headline={scheduleSummary}
                          time={pendingWindowSummary.time}
                          detail={pendingWindowSummary.detail}
                          tone={pendingWindowSummary.tone}
                        />
                        <PendingWindowPanel
                          title="最近完成记录"
                          headline={latestSuccessSummary.headline}
                          time={latestSuccessSummary.time}
                          detail={
                            dashboard?.workday?.checkedDate
                              ? `${latestSuccessSummary.detail} / 最近工作日校验：${dashboard.workday.checkedDateLabel ?? dashboard.workday.checkedDate}`
                              : latestSuccessSummary.detail
                          }
                          tone={latestSuccessSummary.tone}
                        />
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        {windowsData.map((item, index) => (
                          (() => {
                            const currentWindow = getWindowFromDashboard(dashboard, item.name);
                            const currentWindowStatus = getWindowStatus(
                              currentWindow,
                              dashboard?.generatedAt,
                            );

                            return (
                          <Card
                            key={item.title}
                            className={cn(
                              "fade-up card-hover flex h-full flex-col",
                              item.accentClass,
                            )}
                            style={{ "--delay": `${260 + index * 60}ms` }}
                          >
                            <CardHeader className="min-h-[92px]">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col gap-3">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={cn("rounded-md", item.badgeClass)}>
                                      <item.icon className="size-3.5" />
                                      {item.eyebrow}
                                    </Badge>
                                  </div>
                                  <CardTitle>{item.title}</CardTitle>
                                  <CardDescription>{item.note}</CardDescription>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="flex flex-1 flex-col gap-4">
                              <div className="grid gap-4 sm:grid-cols-2">
                                <TimePickerField
                                  label="开始时间"
                                  precision="minute"
                                  value={windowValues[`${item.title}-start`]}
                                  onChange={(nextValue) => handleWindowChange(item.title, "start", nextValue)}
                                  dirty={isWindowFieldDirty(item.title, "start")}
                                  error={validation[`${item.title}-start`]}
                                />
                                <TimePickerField
                                  label="结束时间"
                                  precision="minute"
                                  value={windowValues[`${item.title}-end`]}
                                  onChange={(nextValue) => handleWindowChange(item.title, "end", nextValue)}
                                  dirty={isWindowFieldDirty(item.title, "end")}
                                  error={validation[`${item.title}-end`]}
                                />
                              </div>
                              <Separator />
                              <div className="rounded-xl border bg-background p-4">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex flex-col gap-2">
                                    <p className="text-sm font-medium text-foreground">选择下一次执行</p>
                                    <p className="text-xs leading-6 text-muted-foreground">
                                      使用 shadcn 风格 Time Picker 精确到秒。保存配置后会覆盖当前下一次执行时间。
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-4 flex flex-col gap-4">
                                  <TimePickerField
                                    label="指定下一次打卡时间"
                                    precision="second"
                                    value={windowValues[`${item.title}-custom`]}
                                    onChange={(nextValue) => handleWindowChange(item.title, "custom", nextValue)}
                                    dirty={isWindowFieldDirty(item.title, "custom")}
                                    error={validation[`${item.title}-custom`]}
                                  />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <SummaryRow label="保存后生效时间" value={windowValues[`${item.title}-custom`]} emphasized />
                                    <SummaryRow
                                      label="当前已排期"
                                      value={currentWindow?.selectedAtLabel ?? windowValues[`${item.title}-selected`]}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="mt-auto">
                                <SummaryRow
                                  label="当前状态"
                                  value={currentWindowStatus}
                                  emphasized
                                  tone={getWindowStatusTone(currentWindowStatus)}
                                />
                                <SummaryRow
                                  label="最近完成日期"
                                  value={currentWindow?.completedLabel ?? windowValues[`${item.title}-completed`]}
                                />
                              </div>
                            </CardContent>
                          </Card>
                            );
                          })()
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section id="config" className="dashboard-block relative z-10 fade-up scroll-mt-28" style={{ "--delay": "280ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <CardTitle>基础参数</CardTitle>
                        <CardDescription>设备连接、调度节奏和 scrcpy 观察能力都从前台配置。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4 pt-4">
                      <SectionState {...configStatus} />
                      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        {configGroups.map((group) => (
                          <Card key={group.title} className="flex h-full flex-col bg-muted/20">
                            <CardHeader className="min-h-[96px]">
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className={cn("rounded-md", group.badgeClass)}>
                                    <group.icon className="size-3.5" />
                                    {group.eyebrow}
                                  </Badge>
                                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                    {group.summary}
                                  </p>
                                </div>
                                <div className="space-y-2">
                                  <CardTitle>{group.title}</CardTitle>
                                  <CardDescription>{group.description}</CardDescription>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="flex flex-1 flex-col">
                              <div className="grid gap-4 md:grid-cols-2">
                                {group.fields.map((field) => (
                                  field.key === "serial" ? (
                                    <SerialField
                                      key={field.label}
                                      label={field.label}
                                      value={configValues[field.label]}
                                      onChange={(nextValue) => handleConfigChange(field.label, nextValue)}
                                      dirty={isConfigFieldDirty(field.label)}
                                      error={validation[field.label]}
                                      helper={field.helper}
                                      devices={deviceState?.devices ?? []}
                                      deviceCount={deviceState?.deviceCount ?? 0}
                                      onRefresh={() => handleAction("刷新设备状态")}
                                    />
                                  ) : field.key === "remote_adb_target" ? (
                                    <RemoteAdbTargetField
                                      key={field.label}
                                      label={field.label}
                                      value={configValues[field.label]}
                                      onChange={(nextValue) => handleConfigChange(field.label, nextValue)}
                                      dirty={isConfigFieldDirty(field.label)}
                                      error={validation[field.label]}
                                      helper={field.helper}
                                      recentTargets={dashboard?.config?.recent_remote_adb_targets ?? []}
                                    />
                                  ) : (
                                    <Field
                                      key={field.label}
                                      label={field.label}
                                      value={configValues[field.label]}
                                      onChange={(event) => handleConfigChange(field.label, event.target.value)}
                                      dirty={isConfigFieldDirty(field.label)}
                                      error={validation[field.label]}
                                      helper={field.helper}
                                    />
                                  )
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      <div className="grid gap-4 xl:grid-cols-3">
                        {toggleDefinitions.map((item) => (
                          <ToggleCard
                            key={item.label}
                            label={item.label}
                            enabled={toggleValues[item.label]}
                            dirty={isToggleDirty(item.label)}
                            enabledNote={item.enabledNote}
                            disabledNote={item.disabledNote}
                            onToggle={() => handleToggleChange(item.label)}
                          />
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {toggles.map((item) => (
                          <Badge key={item} variant="outline" className="rounded-md">
                            {item}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </section>
              </div>
            </RegionSection>
            ) : null}

            {activeSection === "records" ? (
                <RegionSection
                  title="打卡记录"
                  description="查看历史打卡记录。"
                >
              <div className="dashboard-layout">
                <section id="records" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "180ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <CardTitle>打卡记录列表</CardTitle>
                        <CardDescription>查看历史打卡执行记录，支持筛选、分页和导出。</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={handleExportRecords}
                        disabled={filteredRecords.length === 0}
                      >
                        <Download className="size-4" />
                        <span>导出 CSV</span>
                      </Button>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4 pt-4">
                      {/* 筛选栏 */}
                      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">日期</label>
                          <Input
                            type="date"
                            value={recordFilter.date}
                            onChange={(e) => { setRecordFilter((f) => ({ ...f, date: e.target.value })); setRecordPage(1); }}
                            className="h-9 w-40"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">类型</label>
                          <select
                            value={recordFilter.type}
                            onChange={(e) => { setRecordFilter((f) => ({ ...f, type: e.target.value })); setRecordPage(1); }}
                            className="h-10 w-32 rounded-md border bg-background px-4 py-2 text-sm"
                          >
                            <option value="">全部</option>
                            {checkinTypeOptions.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">状态</label>
                          <select
                            value={recordFilter.status}
                            onChange={(e) => { setRecordFilter((f) => ({ ...f, status: e.target.value })); setRecordPage(1); }}
                            className="h-10 w-32 rounded-md border bg-background px-4 py-2 text-sm"
                          >
                            <option value="">全部</option>
                            <option value="成功">成功</option>
                            <option value="失败">失败</option>
                          </select>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleResetFilter} className="h-9">
                          重置
                        </Button>
                        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                          <Search className="size-4" />
                          <span>共 {totalRecords} 条记录</span>
                        </div>
                      </div>

                      {checkinRecordsLoading ? (
                        <SectionState
                          icon={RefreshCw}
                          title="正在加载打卡记录"
                          detail="正在从后端获取打卡记录数据..."
                          loading
                        />
                      ) : apiError ? (
                        <SectionState
                          icon={TriangleAlert}
                          tone="warning"
                          title="打卡记录暂时离线"
                          detail="后端未连接时无法获取打卡记录，恢复连接后会自动加载。"
                          actionLabel="刷新状态"
                          onAction={() => handleAction("刷新设备状态")}
                        />
                      ) : paginatedRecords.length === 0 ? (
                        <SectionState
                          icon={ClipboardList}
                          title={totalRecords === 0 ? "暂无打卡记录" : "没有符合条件的记录"}
                          detail={totalRecords === 0 ? "执行打卡后，记录会显示在这里。" : "请尝试调整筛选条件。"}
                        />
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b bg-muted/30">
                                  <th className="h-10 px-4 text-left font-medium">日期</th>
                                  <th className="h-10 px-4 text-left font-medium">时间</th>
                                  <th className="h-10 px-4 text-left font-medium">类型</th>
                                  <th className="h-10 px-4 text-left font-medium">状态</th>
                                  <th className="h-10 px-4 text-left font-medium">备注</th>
                                </tr>
                              </thead>
                              <tbody>
                                {paginatedRecords.map((record, index) => (
                                  <tr key={index} className="border-b transition-colors hover:bg-muted/30">
                                    <td className="px-4 py-3">{record.date || "--"}</td>
                                    <td className="px-4 py-3">{record.time || "--"}</td>
                                    <td className="px-4 py-3">
                                      <Badge variant="outline" className="rounded-md">
                                        {normalizeCheckinType(record.type) || "--"}
                                      </Badge>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Badge variant={record.status === "成功" ? "success" : record.status === "失败" ? "destructive" : "secondary"} className="rounded-md">
                                        {record.status || "--"}
                                      </Badge>
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{record.remark || "--"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* 分页 */}
                          <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>每页</span>
                              <select
                                value={recordPageSize}
                                onChange={(e) => { setRecordPageSize(Number(e.target.value)); setRecordPage(1); }}
                                className="h-10 w-20 rounded-md border bg-background px-4 py-2 text-sm"
                              >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                              </select>
                              <span>条</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={recordPage === 1}
                                onClick={() => setRecordPage((p) => p - 1)}
                              >
                                <ChevronLeft className="size-4" />
                              </Button>
                              <span className="min-w-[80px] text-center text-sm">
                                第 {recordPage} / {totalPages || 1} 页
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={recordPage >= totalPages}
                                onClick={() => setRecordPage((p) => p + 1)}
                              >
                                <ChevronRight className="size-4" />
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </section>
              </div>
            </RegionSection>
            ) : null}

            {activeSection === "logs" ? (
            <RegionSection
              title="告警日志与通知中心"
              description="统一查看提醒、告警和执行日志。"
            >
              <div className="dashboard-layout">
                <section className="dashboard-block fade-up" style={{ "--delay": "220ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-2">
                        <CardTitle>提醒</CardTitle>
                        <CardDescription>先处理风险项。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4 pt-4">
                      {!dashboardReady ? (
                        <SectionState
                          icon={RefreshCw}
                          title="正在同步提醒"
                          detail="后端告警和风险状态读取中，稍后会自动更新。"
                          loading
                        />
                      ) : apiError ? (
                        <SectionState
                          icon={TriangleAlert}
                          tone="warning"
                          title="提醒区暂时离线"
                          detail="后端未连接时无法展示实时提醒，恢复连接后会自动回填。"
                          actionLabel="刷新状态"
                          onAction={() => handleAction("刷新设备状态")}
                        />
                      ) : alerts.length === 0 ? (
                        <SectionState
                          icon={BadgeCheck}
                          tone="success"
                          title="当前没有新的提醒"
                          detail="后端没有返回新的风险项，继续关注设备状态和排期即可。"
                        />
                      ) : (
                        alerts.map((alert, index) => (
                          <AlertRow
                            key={`${alert.title}-${index}`}
                            icon={index === 0 ? TriangleAlert : index === 1 ? BellRing : ListChecks}
                            title={alert.title}
                            detail={alert.detail}
                          />
                        ))
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section id="logs" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "260ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader>
                      <CardTitle>日志</CardTitle>
                      <CardDescription>只看最近动作和结果。</CardDescription>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4">
                      {!dashboardReady ? (
                        <SectionState
                          icon={RefreshCw}
                          title="正在同步日志"
                          detail="最近动作和执行结果还在读取中。"
                          loading
                        />
                      ) : apiError ? (
                        <SectionState
                          icon={TriangleAlert}
                          tone="warning"
                          title="日志区暂时离线"
                          detail="后端未连接时无法回看最新执行日志。"
                          actionLabel="刷新状态"
                          onAction={() => handleAction("刷新设备状态")}
                        />
                      ) : logs.length === 0 ? (
                        <SectionState
                          icon={FileClock}
                          title="当前还没有执行日志"
                          detail="后端尚未返回新的动作记录，执行一次自检或试运行后会出现在这里。"
                        />
                      ) : (
                        logs.map((log) => (
                          <LogRow key={`${log.time}-${log.title}`} log={log} />
                        ))
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section className="dashboard-block fade-up" style={{ "--delay": "300ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader>
                      <CardTitle>时间线</CardTitle>
                      <CardDescription>快速回看今天发生了什么。</CardDescription>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-2">
                      {!dashboardReady ? (
                        <SectionState
                          icon={RefreshCw}
                          title="正在生成时间线"
                          detail="今天的执行轨迹会在后端状态同步完成后展示。"
                          loading
                        />
                      ) : apiError ? (
                        <SectionState
                          icon={TriangleAlert}
                          tone="warning"
                          title="时间线暂时不可用"
                          detail="恢复后端连接后，页面会重新拉取当天的执行轨迹。"
                          actionLabel="刷新状态"
                          onAction={() => handleAction("刷新设备状态")}
                        />
                      ) : timeline.length === 0 ? (
                        <SectionState
                          icon={AlarmClockCheck}
                          title="今天还没有新的时间线记录"
                          detail="执行动作产生后，这里会按顺序展示当天发生的关键节点。"
                        />
                      ) : (
                        timeline.map((item, index) => (
                          <TimelineRow
                            key={item}
                            item={item}
                            index={index}
                            isLast={index === timeline.length - 1}
                          />
                        ))
                      )}
                    </CardContent>
                  </Card>
                </section>

                <section id="guards" className="dashboard-block fade-up scroll-mt-28" style={{ "--delay": "340ms" }}>
                  <Card className="region-card h-full">
                    <CardHeader>
                      <CardTitle>保护规则</CardTitle>
                      <CardDescription>保存前再看这一组。</CardDescription>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-4">
                      {guards.map(([label, value, emphasized]) => (
                        <GuardRow key={label} label={label} value={value} emphasized={emphasized} />
                      ))}
                    </CardContent>
                  </Card>
                </section>
              </div>
              <div className="pt-4 text-center text-xs leading-6 text-muted-foreground">
                版本 {APP_VERSION}
              </div>
            </RegionSection>
            ) : null}

            {activeSection === "guide" ? (
              <RegionSection
                title="使用说明"
                description="查看使用说明文字介绍。"
              >
                <div className="dashboard-layout">
                  <section id="guide" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "140ms" }}>
                    <div className="pt-4 md:pt-6">
                      <article className="guide-doc-shell">
                          <nav className="guide-doc-breadcrumb" aria-label="使用说明路径">
                            <span className="guide-doc-crumb">Documentation</span>
                            <ChevronRight className="guide-doc-crumb-sep" />
                            <span className="guide-doc-crumb">自动打卡控制台</span>
                            <ChevronRight className="guide-doc-crumb-sep" />
                            <span className="guide-doc-crumb guide-doc-crumb--current">使用说明</span>
                          </nav>

                          <header className="guide-doc-header">
                            <h1 className="guide-doc-title">自动打卡控制台使用说明</h1>
                            <div className="guide-doc-title-rule" aria-hidden="true" />
                            <p className="guide-doc-lead">
                              本页用于快速完成日常操作和异常排查。建议按固定顺序执行，减少误操作和重复排查时间。
                            </p>
                          </header>

                          <section className="guide-doc-section" aria-labelledby="guide-reading-path">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="rounded-md">01</Badge>
                                  <Badge variant="secondary" className="rounded-md">先看这里</Badge>
                                </div>
                                <h2 id="guide-reading-path" className="guide-doc-h2">建议阅读顺序</h2>
                              </div>
                              <p className="text-sm text-muted-foreground">阅读 30 秒，先建立正确操作顺序。</p>
                            </div>
                            <div className="guide-doc-grid">
                              <article className="guide-doc-note-card">
                                <h3>1. 先连通</h3>
                                <p>先完成 ADB 安装、手机连接和 USB 调试授权，确保控制台能识别设备。</p>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>2. 再验证</h3>
                                <p>按“一键自检 → 刷新设备状态 → 试运行”的顺序，先确认链路正常，再决定是否启动。</p>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>3. 最后上线</h3>
                                <p>确认排期、设备和参数都无误后，再点击“启动任务”，避免直接上线导致漏打卡。</p>
                              </article>
                            </div>
                          </section>

                          <section className="guide-doc-section" aria-labelledby="guide-first-time">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="rounded-md">02</Badge>
                                  <Badge variant="secondary" className="rounded-md">新手必看</Badge>
                                </div>
                                <h2 id="guide-first-time" className="guide-doc-h2">第一次使用怎么做</h2>
                              </div>
                              <p className="text-sm text-muted-foreground">预计 3-5 分钟完成首次接入。</p>
                            </div>
                            <div className="guide-doc-grid">
                              <article className="guide-doc-note-card">
                                <h3>准备阶段</h3>
                                <ul className="guide-doc-list mt-3">
                                  <li>确认云服务器上的后端服务已部署并可访问。</li>
                                  <li>如 ADB 未就绪，直接在网页端执行“在线安装 ADB”。</li>
                                  <li>先确认手机不是只插在你本地电脑上，而是接在运行 ADB 的那台机器，或已打通远程 ADB。</li>
                                  <li>准备好需要连接的安卓手机和 USB 数据线。</li>
                                </ul>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>配置阶段</h3>
                                <ul className="guide-doc-list mt-3">
                                  <li>进入“任务配置”，检查 remote_adb_target、serial、adb_bin、应用包名和状态文件路径。</li>
                                  <li>核对上午/下午时间窗口，确认下一次执行时间合理。</li>
                                  <li>多设备场景下优先绑定 serial，避免误选设备。</li>
                                </ul>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>验证阶段</h3>
                                <ul className="guide-doc-list mt-3">
                                  <li>先执行“一键自检”，确认依赖和设备都可用。</li>
                                  <li>再执行“刷新设备状态”，看控制台是否识别到目标设备。</li>
                                  <li>最后用“试运行”验证实际动作链路。</li>
                                </ul>
                              </article>
                            </div>
                          </section>

                          <section
                            id="guide-connection-wizard"
                            className="guide-doc-section scroll-mt-28"
                            aria-labelledby="guide-connection-wizard-title"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="rounded-md">03</Badge>
                                  <Badge variant="warning" className="rounded-md">关键路径</Badge>
                                </div>
                                <h2 id="guide-connection-wizard-title" className="guide-doc-h2">连接向导</h2>
                              </div>
                              <p className="text-sm text-muted-foreground">先完成连接，再做排期和正式启动。</p>
                            </div>
                            <p className="guide-doc-lead text-sm">
                              如果你是第一次接入，建议先看这里。连接成功后，再去做排期设置和正式启动，会更顺畅。
                            </p>

                            <article className="overflow-hidden rounded-2xl border border-red-200/70 bg-red-50/70 dark:border-red-900/40 dark:bg-red-950/20">
                              <div className="border-b border-red-200/70 px-4 py-4 dark:border-red-900/40">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="destructive" className="rounded-md">先确认</Badge>
                                  <h3 className="text-base font-semibold">云服务器装上 ADB，不等于云服务器能看到你的手机</h3>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                  在线安装 ADB 只解决依赖安装问题。要让设备真正出现在控制台里，手机必须接在运行 ADB 的那台机器上，或者已经配置好远程 ADB/TCP。
                                </p>
                              </div>
                              <div className="px-4 py-4">
                                <ul className="guide-doc-list space-y-3">
                                  <li><strong>可行：</strong> 后端跑在本机，手机通过 USB 插在本机。</li>
                                  <li><strong>可行：</strong> 后端跑在云服务器，但手机接在该服务器可访问的设备连接器环境，或已打通远程 ADB。</li>
                                  <li><strong>通常不可行：</strong> 后端跑在 Railway/云服务器，手机只插在你自己的电脑上。</li>
                                  <li><strong>远程模式最小顺序：</strong> 先保存 remote_adb_target，再连接远程 ADB、刷新设备状态，最后执行一键自检。</li>
                                </ul>
                              </div>
                            </article>

                            <div className="space-y-4">
                              <GuideAccordionItem
                                title="控制台操作"
                                description="ADB 安装、状态刷新和自检都可在网页端触发，安装实际在云服务器执行。"
                                open={activeGuidePanel === "console"}
                                onToggle={() =>
                                  setActiveGuidePanel((current) => (current === "console" ? "" : "console"))
                                }
                              >

                                <div className="mt-3 space-y-3">
                                  <p className="text-sm leading-6 text-muted-foreground">
                                    按下面顺序完成控制台检查，确认云端依赖、ADB 状态和设备连接都正常。
                                  </p>
                                  <div className="guide-flow">
                                    <div className="guide-flow-rail" aria-hidden="true" />
                                    {wizardSteps.map((step, index) => {
                                      const isActive = activeWizardStep?.key === step.key;
                                      const badgeTone = step.done ? "success" : isActive ? "warning" : "outline";
                                      return (
                                        <div
                                          key={step.key}
                                          className={cn(
                                            "guide-flow-item",
                                            step.done && "guide-flow-item--done",
                                            isActive && !step.done && "guide-flow-item--active",
                                          )}
                                        >
                                          <div className="guide-flow-node" aria-hidden="true" />
                                          <div className="guide-flow-card">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                              <div className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <Badge variant={badgeTone} className="rounded-md">
                                                    {step.done ? "已完成" : isActive ? "进行中" : "待处理"}
                                                  </Badge>
                                                  <p className="text-sm font-medium">{`${index + 1}. ${step.title}`}</p>
                                                </div>
                                                <p className="text-sm leading-6 text-muted-foreground">{step.detail}</p>
                                                {step.code ? (
                                                  <pre className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-foreground">
                                                    {step.code}
                                                  </pre>
                                                ) : null}
                                              </div>
                                              {step.done ? (
                                                <Badge variant="outline" className="rounded-md">
                                                  OK
                                                </Badge>
                                              ) : null}
                                            </div>
                                            {!step.done && (step.primaryAction || step.secondaryAction) ? (
                                              <div className="mt-3 flex flex-wrap gap-2">
                                                {step.primaryAction ? (
                                                  <Button size="sm" onClick={step.primaryAction.onClick}>
                                                    {step.primaryAction.label}
                                                  </Button>
                                                ) : null}
                                                {step.secondaryAction ? (
                                                  <Button variant="outline" size="sm" onClick={step.secondaryAction.onClick}>
                                                    {step.secondaryAction.label}
                                                  </Button>
                                                ) : null}
                                              </div>
                                            ) : null}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  <div className="guide-flow-footer">
                                      <p className="text-xs text-muted-foreground">
                                        每完成一步建议点击“刷新状态”，让控制台同步最新设备信息。
                                      </p>
                                      <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" onClick={() => handleAction("连接远程 ADB")}>
                                          连接远程 ADB
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => handleAction("断开远程 ADB")}>
                                          断开远程 ADB
                                        </Button>
                                        <Button size="sm" onClick={() => handleAction("刷新设备状态")}>
                                          刷新状态
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </GuideAccordionItem>

                              <GuideAccordionItem
                                title="设备端操作"
                                description="USB 连接、开发者选项和 USB 调试授权，需要在手机上完成。"
                                open={activeGuidePanel === "device"}
                                onToggle={() =>
                                  setActiveGuidePanel((current) => (current === "device" ? "" : "device"))
                                }
                              >
                                <ol className="guide-doc-steps">
                                  <li>用 USB 数据线把安卓手机连接到当前电脑，尽量避免只充电线或不稳定转接头。</li>
                                  <li>进入手机“设置 → 关于手机”，连续点击版本号，开启“开发者选项”。</li>
                                  <li>进入“设置 → 开发者选项”，打开“USB 调试”。</li>
                                  <li>若手机连接后弹出“仅充电 / 传输文件”选择，优先切到“文件传输”或允许 USB 访问。</li>
                                  <li>看到“是否允许 USB 调试”弹窗时，点击“允许”；常用设备建议勾选“总是允许这台电脑调试”。</li>
                                  <li>完成后回到控制台，点击“刷新设备状态”或执行“一键自检”。</li>
                                </ol>
                              </GuideAccordionItem>

                              <GuideAccordionItem
                                title="远程 ADB/TCP"
                                description="适合后端在云端、设备不直接插在服务端 USB 上的场景。"
                                open={activeGuidePanel === "remote-adb"}
                                onToggle={() =>
                                  setActiveGuidePanel((current) => (current === "remote-adb" ? "" : "remote-adb"))
                                }
                              >
                                <div className="space-y-4">
                                  <div className="rounded-xl border bg-background/70 p-4">
                                    <p className="text-sm font-medium text-foreground">方案 A：Android 11+ 无线调试</p>
                                    <ol className="guide-doc-steps mt-3">
                                      <li>让手机和运行 ADB 的那台机器处于可互通的同一局域网。</li>
                                      <li>在手机开发者选项里打开“无线调试”。</li>
                                      <li>查看手机展示的调试地址，整理成 `host:port`。</li>
                                      <li>回到控制台，把这个值填进 `remote_adb_target`。</li>
                                      <li>点击“连接远程 ADB”，再刷新设备状态。</li>
                                    </ol>
                                  </div>

                                  <div className="rounded-xl border bg-background/70 p-4">
                                    <p className="text-sm font-medium text-foreground">方案 B：传统 adb tcpip 5555</p>
                                    <ol className="guide-doc-steps mt-3">
                                      <li>先把手机通过 USB 接到一台已经安装 ADB 的电脑上。</li>
                                      <li>确认 `adb devices` 能看到手机且状态为 `device`。</li>
                                      <li>执行 `adb tcpip 5555`。</li>
                                      <li>查出手机当前局域网 IP，并在控制台填写 `手机IP:5555`。</li>
                                      <li>点击“连接远程 ADB”，再刷新设备状态。</li>
                                    </ol>
                                  </div>

                                  <p className="text-sm leading-6 text-muted-foreground">
                                    两种方式的共同前提都是：手机和运行 ADB 的那台机器必须网络可达；如果地址或端口变化，需要同步更新 `remote_adb_target`。公网环境下还要确认设备侧端口映射、云服务器安全组/防火墙放行规则已经生效。
                                  </p>
                                </div>
                              </GuideAccordionItem>
                            </div>

                            <article className="mt-4 overflow-hidden rounded-2xl border border-amber-200/70 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20">
                              <div className="border-b border-amber-200/70 px-4 py-4 dark:border-amber-900/40">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="warning" className="rounded-md">高频问题</Badge>
                                  <h3 className="text-base font-semibold">连接失败时先看这里</h3>
                                </div>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                  大多数连接问题都集中在数据线、USB 模式、授权弹窗、多设备绑定，以及远程 ADB 目标不可达这几类场景。
                                </p>
                              </div>
                              <div className="px-4 py-4">
                                <ul className="guide-doc-list space-y-3">
                                  <li><strong>看不到设备：</strong> 先换数据线、USB 口，确认手机不是“仅充电”模式。</li>
                                  <li><strong>设备显示 unauthorized：</strong> 说明手机还没点授权，解锁屏幕后重新插拔或重新授权。</li>
                                  <li><strong>多台设备同时在线：</strong> 需要在“任务配置”里填写 serial，绑定目标设备。</li>
                                  <li><strong>远程 ADB 连不上：</strong> 先检查 remote_adb_target 是否为 `host:port`（端口 1-65535），再确认公网端口映射与云服务器安全组放行。</li>
                                  <li><strong>ADB 已安装但还是失败：</strong> 可先点“重启 ADB”，再重新刷新状态。</li>
                                </ul>
                              </div>
                            </article>
                          </section>

                          <section className="guide-doc-section" aria-labelledby="guide-daily-use">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="rounded-md">04</Badge>
                                  <Badge variant="secondary" className="rounded-md">日常使用</Badge>
                                </div>
                                <h2 id="guide-daily-use" className="guide-doc-h2">日常使用看这三块</h2>
                              </div>
                              <p className="text-sm text-muted-foreground">每天主要只需要关注这 3 个区域。</p>
                            </div>
                            <div className="guide-doc-grid">
                              <article className="guide-doc-note-card">
                                <h3>监控总览</h3>
                                <p>先看设备状态、当前风险和下一次执行时间，判断今天能不能正常跑。</p>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>任务配置</h3>
                                <p>修改设备参数、时间窗口和开关后，记得保存，再复查状态。</p>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>打卡记录 / 告警日志</h3>
                                <p>一个用来看结果，一个用来查原因。出现异常时先看日志，再回到记录核对影响范围。</p>
                              </article>
                            </div>
                          </section>

                          <section className="guide-doc-section" aria-labelledby="guide-action-order">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="rounded-md">05</Badge>
                                  <Badge variant="secondary" className="rounded-md">操作口诀</Badge>
                                </div>
                                <h2 id="guide-action-order" className="guide-doc-h2">推荐操作顺序</h2>
                              </div>
                              <p className="text-sm text-muted-foreground">记住：先自检，再试运行，最后启动任务。</p>
                            </div>
                            <ol className="guide-doc-steps">
                              <li>先看设备是否在线、ADB 是否可用。</li>
                              <li>如有配置改动，先保存，再刷新状态。</li>
                              <li>执行“一键自检”，确认依赖和设备无阻断问题。</li>
                              <li>执行“试运行”，确认真实动作链路可用。</li>
                              <li>确认无误后再“启动任务”或进入日常托管。</li>
                            </ol>
                          </section>

                          <section className="guide-doc-section" aria-labelledby="guide-troubleshooting">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="rounded-md">06</Badge>
                                  <Badge variant="warning" className="rounded-md">异常处理</Badge>
                                </div>
                                <h2 id="guide-troubleshooting" className="guide-doc-h2">异常排查顺序</h2>
                              </div>
                              <p className="text-sm text-muted-foreground">按顺序排查，能明显减少重复试错。</p>
                            </div>
                            <ol className="guide-doc-steps">
                              <li>先确认设备连接、USB 调试授权和 ADB 安装是否正常。</li>
                              <li>再检查工作日接口、轮询参数和排期时间是否合理。</li>
                              <li>如果动作失败，先看告警日志，再看打卡记录与时间线。</li>
                              <li>问题修复后，重新执行“一键自检”和“试运行”确认恢复。</li>
                            </ol>
                          </section>
                        </article>
                    </div>
                  </section>
                </div>
              </RegionSection>
            ) : null}
              </>
            ) : (
              <PlaybackProjectPanel
                activeSection={activeSection}
                onNavigate={(sectionId) => handleNavClick(undefined, sectionId)}
              />
            )}
          </section>
        </main>

        {showBottomStickyMenu ? (
          <BottomStickyMenu
            activeSection={activeSection}
            pendingAction={pendingAction}
            hasBlockingIssues={hasBlockingIssues}
            blockingCount={validationIssues.length}
            onAction={handleAction}
          />
        ) : null}
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, children, isPending = false, className, size, ...props }) {
  return (
    <Button size={size} className={cn("gap-2", className)} {...props}>
      <Icon />
      <span>{isPending ? "处理中" : children}</span>
    </Button>
  );
}

function ActionTile({ item, isPending = false, className, ...props }) {
  return (
    <div className={cn("rounded-xl border bg-background p-4", className)}>
      <div className="flex h-full flex-col gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md border bg-muted/30">
              <item.icon className="size-4" />
            </div>
            <p className="text-sm font-medium">{item.label}</p>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
        </div>
        <ActionButton
          variant={item.style}
          icon={item.icon}
          size="sm"
          className="mt-auto w-full justify-center"
          isPending={isPending}
          {...props}
        >
          {item.label}
        </ActionButton>
      </div>
    </div>
  );
}

function FocusStrip({ focus, quickActions = [] }) {
  const tone = toneClasses(focus.tone);
  return (
    <Card className={cn("overflow-hidden", tone.panel)}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={focus.tone} className="rounded-md">
                {toneLabel(focus.tone)}
              </Badge>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Current Focus
              </p>
            </div>
            <h3 className="text-lg font-semibold tracking-tight">{focus.title}</h3>
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{focus.detail}</p>
          </div>
        </div>

        {quickActions.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {quickActions.map((action) => (
              <Button
                key={action.key}
                variant={action.variant ?? "outline"}
                size="sm"
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {focus.chips.map((chip) => (
            <div key={chip} className={cn("rounded-md px-3 py-2 text-sm", tone.soft)}>
              {chip}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function GuideAccordionItem({ title, description, open, onToggle, children }) {
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-background/90 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        open ? "border-border" : "border-border/70",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors duration-300",
          open ? "bg-muted/35" : "hover:bg-muted/25",
        )}
      >
        <div>
          <h3>{title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            open && "rotate-90",
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t px-4 py-4">{children}</div>
        </div>
      </div>
    </article>
  );
}

function LogoRegion({ collapsed, onToggleCollapse }) {
  return (
    <div className="fade-up" style={{ "--delay": "40ms" }} data-sidebar-cursor-block="true">
      <div
        className={cn(
          "flex h-12 items-center rounded-lg bg-background/70 backdrop-blur",
          collapsed ? "justify-center px-0" : "justify-between px-0",
        )}
      >
        <div className="flex size-[var(--sidebar-inner-size)] shrink-0 items-center justify-center rounded-md bg-black text-white dark:bg-white dark:text-black">
          <Bot className="size-5" />
        </div>

        {!collapsed ? (
          <button
            type="button"
            className="no-draggable hidden h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none lg:flex"
            onClick={onToggleCollapse}
            aria-expanded="true"
            aria-controls="stage-slideover-sidebar"
            aria-label="收起导航栏"
            title="收起导航栏"
            data-testid="close-sidebar-button"
            data-state="open"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M10.15 16.15L6.7 12.7q-.3-.3-.3-.7t.3-.7l3.45-3.45q.25-.25.55-.125t.3.475v7.6q0 .35-.3.475t-.55-.125M13 20V4q0-.425.288-.712T14 3t.713.288T15 4v16q0 .425-.288.713T14 21t-.712-.288T13 20" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SidebarNav({
  collapsed,
  activeProject,
  activeSection,
  onProjectSwitch,
  onNavClick,
  onOpenCommandPalette,
}) {
  const dingtalkProjectMenuIds = DINGTALK_PROJECT_MENU_ITEMS.map((item) => item.id);
  const isDingtalkProjectMenuActive = dingtalkProjectMenuIds.includes(activeSection);
  const playbackProjectMenuIds = PLAYBACK_NAV_ITEMS.map((item) => item.id);
  const isPlaybackProjectMenuActive = playbackProjectMenuIds.includes(activeSection);
  const [dingtalkProjectOpen, setDingtalkProjectOpen] = useState(
    () => activeProject === "dingtalk" && isDingtalkProjectMenuActive,
  );
  const [playbackProjectOpen, setPlaybackProjectOpen] = useState(
    () => activeProject === "playback" && isPlaybackProjectMenuActive,
  );
  const [navQuery, setNavQuery] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const normalizedNavQuery = navQuery.trim().toLowerCase();
  const isFiltering = normalizedNavQuery.length > 0;

  useEffect(() => {
    if (activeProject === "dingtalk" && isDingtalkProjectMenuActive) setDingtalkProjectOpen(true);
  }, [activeProject, isDingtalkProjectMenuActive]);

  useEffect(() => {
    if (activeProject === "playback" && isPlaybackProjectMenuActive) setPlaybackProjectOpen(true);
  }, [activeProject, isPlaybackProjectMenuActive]);

  useEffect(() => {
    if (!collapsed) return;
    if (navQuery) setNavQuery("");
    if (searchPanelOpen) setSearchPanelOpen(false);
  }, [collapsed, navQuery, searchPanelOpen]);

  const focusSearchInput = useCallback(() => {
    if (collapsed) return;
    setSearchPanelOpen(true);
    window.requestAnimationFrame(() => {
      const input = document.getElementById(SIDEBAR_NAV_SEARCH_INPUT_ID);
      input?.focus();
      input?.select?.();
    });
  }, [collapsed]);

  useEffect(() => {
    if (activeProject === "dingtalk" && isFiltering) setDingtalkProjectOpen(true);
  }, [activeProject, isFiltering]);

  useEffect(() => {
    if (activeProject === "playback" && isFiltering) setPlaybackProjectOpen(true);
  }, [activeProject, isFiltering]);

  const matchesQuery = useCallback(
    (item) => {
      if (!isFiltering) return true;
      const haystack = `${item.label} ${item.id}`.toLowerCase();
      return haystack.includes(normalizedNavQuery);
    },
    [isFiltering, normalizedNavQuery],
  );

  const filteredDingtalkProjectItems = DINGTALK_PROJECT_MENU_ITEMS.filter(matchesQuery);
  const filteredPlaybackItems = PLAYBACK_NAV_ITEMS.filter(matchesQuery);
  const showGuideItem = matchesQuery(GUIDE_NAV_ITEM);
  const dingtalkProjectVisibleItems = isFiltering
    ? filteredDingtalkProjectItems
    : DINGTALK_PROJECT_MENU_ITEMS;
  const playbackProjectVisibleItems = isFiltering ? filteredPlaybackItems : PLAYBACK_NAV_ITEMS;
  const hasSearchResult =
    activeProject === "dingtalk"
      ? filteredDingtalkProjectItems.length > 0 || showGuideItem
      : filteredPlaybackItems.length > 0;

  const monitorQuickItem = { id: "overview", label: "监控页面", icon: Gauge, shortcut: "⌘1" };
  const quickActionItems = [
    monitorQuickItem,
    { id: "search", label: "搜索", icon: Search, shortcut: "⌘K", type: "search" },
    { id: "device-management", label: "设备管理", icon: Smartphone, shortcut: "⌘2" },
  ];
  const dingtalkProjectItem = PROJECT_NAV_ITEMS[0];
  const playbackProjectItem = PROJECT_NAV_ITEMS[1];
  const DingtalkProjectIcon = dingtalkProjectItem.icon;
  const PlaybackProjectIcon = playbackProjectItem.icon;

  const renderNavItem = (item, options = {}) => {
    const Icon = item.icon;
    const {
      active = activeSection === item.id,
      muted = false,
      isGuide = false,
      noHover = false,
      onClick = (event) => onNavClick(event, item.id),
    } = options;

    return (
      <a
        key={item.id}
        href={`#${item.id}`}
        data-sidebar-item="true"
        data-sidebar-icon-animate={noHover ? "false" : "true"}
        data-guide-item={isGuide ? "true" : "false"}
        data-guide-active={isGuide && active ? "true" : "false"}
        data-sidebar-cursor-block="true"
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 w-full items-center gap-2 overflow-hidden rounded-md border px-2 text-sm leading-6 transition-[width,padding,gap,background-color,color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed && "lg:h-10 lg:w-[var(--sidebar-inner-size)] lg:justify-center lg:px-0 lg:gap-0",
          isGuide
            ? active
              ? "border-transparent bg-transparent text-black dark:text-white hover:border-transparent hover:bg-transparent hover:text-black dark:hover:text-white"
              : "border-transparent text-muted-foreground hover:border-transparent hover:bg-transparent"
            : active
              ? "border-border bg-accent text-accent-foreground"
              : noHover
                ? "border-transparent text-muted-foreground"
                : muted
                  ? "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
        )}
        onClick={onClick}
      >
        <Icon className="size-4.5 shrink-0" data-guide-hotspot={isGuide ? "true" : undefined} />
        <span
          data-guide-hotspot={isGuide ? "true" : undefined}
          className={cn(
            "font-medium whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            collapsed
              ? "lg:pointer-events-none lg:absolute lg:max-w-0 lg:opacity-0 lg:-translate-x-1"
              : "lg:max-w-[11rem] lg:opacity-100 lg:translate-x-0",
          )}
        >
          {item.label}
        </span>
      </a>
    );
  };

  const renderQuickActionItem = (item) => {
    const Icon = item.icon;
    const isSearch = item.type === "search";
    const isActive = !isSearch && activeSection === item.id;

    return (
      <button
        key={item.id}
        type="button"
        data-sidebar-item="true"
        data-sidebar-icon-animate="false"
        data-sidebar-cursor-block="true"
        title={item.label}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group flex h-10 w-full items-center gap-2 overflow-hidden rounded-md border px-2 text-sm leading-6 transition-[width,padding,gap,background-color,color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "lg:h-10 lg:w-[var(--sidebar-inner-size)] lg:justify-center lg:px-0 lg:gap-0" : "justify-start",
          isActive
            ? "border-border bg-accent text-accent-foreground"
            : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
        )}
        onClick={(event) => {
          if (isSearch) {
            event.preventDefault();
            if (onOpenCommandPalette) {
              onOpenCommandPalette();
            } else {
              focusSearchInput();
            }
            return;
          }
          onNavClick(event, item.id);
        }}
      >
        <Icon className="size-4 shrink-0" />
        <span
          className={cn(
            "truncate text-sm transition-[max-width,opacity] duration-150",
            collapsed ? "lg:pointer-events-none lg:absolute lg:max-w-0 lg:opacity-0" : "max-w-[11rem] opacity-100",
          )}
        >
          {item.label}
        </span>
        {!collapsed ? (
          <span className="ml-auto text-xs text-muted-foreground opacity-0 transition-opacity duration-100 group-hover:opacity-100">
            {item.shortcut}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <nav
      className={cn(
        "fade-up flex h-full min-h-0 flex-col",
        collapsed && "lg:items-center",
      )}
      style={{ "--delay": "100ms" }}
    >
      <div className={cn("flex h-full min-h-0 flex-col gap-3", collapsed && "lg:w-[var(--sidebar-inner-size)]")}>
        <div className="space-y-2">{quickActionItems.map((item) => renderQuickActionItem(item))}</div>

        {!collapsed && searchPanelOpen ? (
          <div className="space-y-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={SIDEBAR_NAV_SEARCH_INPUT_ID}
                value={navQuery}
                onChange={(event) => setNavQuery(event.target.value)}
                placeholder="搜索导航（⌘/Ctrl + K）"
                aria-label="搜索导航"
                className="h-8 rounded-md border-border/70 bg-background pl-8 pr-8 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  setNavQuery("");
                  setSearchPanelOpen(false);
                }}
                className={cn(
                  "absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  navQuery ? "opacity-100" : "opacity-0",
                )}
                aria-label="关闭搜索"
                title="关闭搜索"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <p className="px-1 text-[11px] text-muted-foreground">输入关键词快速定位功能项。</p>
          </div>
        ) : null}

        <Separator />

        <div className={cn("flex min-h-0 flex-1 flex-col gap-4", collapsed && "lg:w-full lg:items-center")}>
          <div className="space-y-2">
            {!collapsed ? (
              <p className="px-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">项目</p>
            ) : null}
            <div className={cn("space-y-2", collapsed && "lg:w-[var(--sidebar-inner-size)]")}>
              <button
                type="button"
                data-sidebar-item="true"
                data-sidebar-icon-animate="false"
                data-sidebar-cursor-block="true"
                title={dingtalkProjectItem.label}
                aria-label={dingtalkProjectItem.label}
                aria-expanded={!collapsed ? dingtalkProjectOpen : undefined}
                className={cn(
                  "flex h-10 w-full items-center gap-2 overflow-hidden rounded-md border px-2 text-sm leading-6 transition-[width,padding,gap,background-color,color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  collapsed && "lg:h-10 lg:w-[var(--sidebar-inner-size)] lg:justify-center lg:px-0 lg:gap-0",
                  activeProject === "dingtalk"
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={(event) => {
                  event.preventDefault();
                  if (collapsed) {
                    onProjectSwitch("dingtalk");
                    return;
                  }
                  if (activeProject !== "dingtalk") {
                    onProjectSwitch("dingtalk");
                    setDingtalkProjectOpen(true);
                    return;
                  }
                  if (isFiltering) return;
                  setDingtalkProjectOpen((value) => !value);
                }}
              >
                <DingtalkProjectIcon className="size-4.5 shrink-0" />
                <span
                  className={cn(
                    "font-medium whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    collapsed
                      ? "lg:pointer-events-none lg:absolute lg:max-w-0 lg:opacity-0 lg:-translate-x-1"
                      : "lg:max-w-[11rem] lg:opacity-100 lg:translate-x-0",
                  )}
                >
                  {dingtalkProjectItem.label}
                </span>
                {!collapsed ? (
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {dingtalkProjectVisibleItems.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                        dingtalkProjectOpen && "rotate-180",
                      )}
                    />
                  </div>
                ) : null}
              </button>

              {!collapsed ? (
                <div
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                    dingtalkProjectOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="ml-3 space-y-2 border-l border-border/70 pl-3">
                      {dingtalkProjectVisibleItems.map((item) => {
                        const ItemIcon = item.icon;
                        const itemActive = activeSection === item.id;
                        return (
                          <a
                            key={item.id}
                            href={`#${item.id}`}
                            data-sidebar-item="true"
                            data-sidebar-icon-animate="true"
                            data-sidebar-cursor-block="true"
                            title={item.label}
                            aria-label={item.label}
                            aria-current={itemActive ? "page" : undefined}
                            className={cn(
                              "flex h-9 w-full items-center gap-2 rounded-md border px-2 text-sm leading-6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              itemActive
                                ? "border-border bg-accent text-accent-foreground"
                                : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
                            )}
                            onClick={(event) => onNavClick(event, item.id)}
                          >
                            <ItemIcon className="size-4 shrink-0" />
                            <span className="font-medium">{item.label}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                data-sidebar-item="true"
                data-sidebar-icon-animate="false"
                data-sidebar-cursor-block="true"
                title={playbackProjectItem.label}
                aria-label={playbackProjectItem.label}
                aria-expanded={!collapsed ? playbackProjectOpen : undefined}
                className={cn(
                  "flex h-10 w-full items-center gap-2 overflow-hidden rounded-md border px-2 text-sm leading-6 transition-[width,padding,gap,background-color,color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  collapsed && "lg:h-10 lg:w-[var(--sidebar-inner-size)] lg:justify-center lg:px-0 lg:gap-0",
                  activeProject === "playback"
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={(event) => {
                  event.preventDefault();
                  if (collapsed) {
                    onProjectSwitch("playback");
                    return;
                  }
                  if (activeProject !== "playback") {
                    onProjectSwitch("playback");
                    setPlaybackProjectOpen(true);
                    return;
                  }
                  if (isFiltering) return;
                  setPlaybackProjectOpen((value) => !value);
                }}
              >
                <PlaybackProjectIcon className="size-4.5 shrink-0" />
                <span
                  className={cn(
                    "font-medium whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    collapsed
                      ? "lg:pointer-events-none lg:absolute lg:max-w-0 lg:opacity-0 lg:-translate-x-1"
                      : "lg:max-w-[11rem] lg:opacity-100 lg:translate-x-0",
                  )}
                >
                  {playbackProjectItem.label}
                </span>
                {!collapsed ? (
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {playbackProjectVisibleItems.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
                        playbackProjectOpen && "rotate-180",
                      )}
                    />
                  </div>
                ) : null}
              </button>

              {!collapsed ? (
                <div
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                    playbackProjectOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="ml-3 space-y-2 border-l border-border/70 pl-3">
                      {playbackProjectVisibleItems.map((item) => {
                        const ItemIcon = item.icon;
                        const itemActive = activeSection === item.id;
                        return (
                          <a
                            key={item.id}
                            href={`#${item.id}`}
                            data-sidebar-item="true"
                            data-sidebar-icon-animate="true"
                            data-sidebar-cursor-block="true"
                            title={item.label}
                            aria-label={item.label}
                            aria-current={itemActive ? "page" : undefined}
                            className={cn(
                              "flex h-9 w-full items-center gap-2 rounded-md border px-2 text-sm leading-6 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              itemActive
                                ? "border-border bg-accent text-accent-foreground"
                                : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
                            )}
                            onClick={(event) => onNavClick(event, item.id)}
                          >
                            <ItemIcon className="size-4 shrink-0" />
                            <span className="font-medium">{item.label}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {isFiltering && !hasSearchResult ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
              未找到匹配导航，可尝试更换关键词。
            </div>
          ) : null}

          {activeProject === "dingtalk" ? (
            <div className={cn("mt-auto w-full border-t border-border/70 pt-3", collapsed && "lg:flex lg:justify-center")}>
              {renderNavItem(GUIDE_NAV_ITEM, {
                isGuide: true,
                noHover: true,
                active: activeSection === GUIDE_NAV_ITEM.id,
              })}
            </div>
          ) : null}

        </div>
      </div>
    </nav>
  );
}

function CommandPalette({
  moduleId,
  moduleName,
  open,
  query,
  onQueryChange,
  items,
  activeIndex,
  onActiveIndexChange,
  onClose,
  onSelectItem,
}) {
  if (!open) return null;

  let previousGroup = "";

  return (
    <div
      id={moduleId}
      data-module={moduleId}
      data-module-name={moduleName}
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/45 px-3 pt-14 backdrop-blur-sm sm:px-4 sm:pt-16"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="border-b border-border p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索页面、操作命令（⌘/Ctrl + K）"
              aria-label="命令面板搜索"
              className="h-10 rounded-lg border-border bg-background/80 pl-10 pr-12 text-sm"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border/80 px-2 py-0.5 text-xs leading-none text-muted-foreground">
              Esc
            </span>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-3">
          {items.length > 0 ? (
            <div className="space-y-1">
              {items.map((item, index) => {
                const Icon = item.icon;
                const isActive = index === activeIndex;
                const showGroup = item.group !== previousGroup;
                previousGroup = item.group;

                return (
                  <div key={item.id} className="space-y-1">
                    {showGroup ? (
                      <p className="px-3 pt-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {item.group}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-muted/40",
                      )}
                      onMouseEnter={() => onActiveIndexChange(index)}
                      onClick={() => onSelectItem(item)}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.label}</p>
                        {item.hint ? (
                          <p className="truncate text-xs text-muted-foreground">{item.hint}</p>
                        ) : null}
                      </div>
                      {item.shortcut ? (
                        <span className="rounded border border-border/70 px-2 py-0.5 text-xs leading-none text-muted-foreground">
                          {item.shortcut}
                        </span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              未找到匹配命令，试试输入“总览”、“自检”、“日志”。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatPlaybackDuration(ms) {
  const totalSeconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatPlaybackDateTime(input) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function PlaybackProjectPanel({ activeSection, onNavigate }) {
  const [devices, setDevices] = useState([]);
  const [apps, setApps] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedApps, setSelectedApps] = useState([]);
  const [appKeyword, setAppKeyword] = useState("");
  const [isAppDropdownOpen, setIsAppDropdownOpen] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [loadingApps, setLoadingApps] = useState(false);
  const [startingProgram, setStartingProgram] = useState(false);
  const [unlockingDevice, setUnlockingDevice] = useState(false);
  const [unlockPattern, setUnlockPattern] = useState("2589");
  const [clearCredentialAfterVerify, setClearCredentialAfterVerify] = useState(false);
  const [browseRoundsMin, setBrowseRoundsMin] = useState(6);
  const [browseRoundsMax, setBrowseRoundsMax] = useState(10);
  const [browseWaitMinSeconds, setBrowseWaitMinSeconds] = useState(3.2);
  const [browseWaitMaxSeconds, setBrowseWaitMaxSeconds] = useState(8.8);
  const [browseLikeChancePercent, setBrowseLikeChancePercent] = useState(18);
  const [browseConfigText, setBrowseConfigText] = useState("");
  const [unlockText, setUnlockText] = useState("");
  const [actionText, setActionText] = useState("");
  const [errorText, setErrorText] = useState("");

  const [dashboardData, setDashboardData] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [stoppingProgram, setStoppingProgram] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);

  const appSelectorRef = useRef(null);

  const loadPlaybackDevices = useCallback(async () => {
    setLoadingDevices(true);
    setErrorText("");
    try {
      const list = await fetchPlaybackDevices();
      setDevices(list);
      if (!selectedDevice) {
        const online = list.find((item) => item.state === "device");
        setSelectedDevice(online?.serial || list[0]?.serial || "");
      } else if (!list.some((item) => item.serial === selectedDevice)) {
        const online = list.find((item) => item.state === "device");
        setSelectedDevice(online?.serial || list[0]?.serial || "");
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载设备失败");
    } finally {
      setLoadingDevices(false);
    }
  }, [selectedDevice]);

  useEffect(() => {
    loadPlaybackDevices();
  }, [loadPlaybackDevices]);

  useEffect(() => {
    if (!selectedDevice) {
      setApps([]);
      setSelectedApps([]);
      return;
    }

    let cancelled = false;
    const loadApps = async () => {
      setLoadingApps(true);
      setErrorText("");
      try {
        const appList = await fetchPlaybackDeviceApps(selectedDevice);
        if (cancelled) return;
        setApps(appList);
        setSelectedApps([]);
        setAppKeyword("");
        setIsAppDropdownOpen(false);
      } catch (error) {
        if (cancelled) return;
        setErrorText(error instanceof Error ? error.message : "加载应用失败");
        setApps([]);
        setSelectedApps([]);
      } finally {
        if (!cancelled) setLoadingApps(false);
      }
    };

    loadApps();
    return () => {
      cancelled = true;
    };
  }, [selectedDevice]);

  useEffect(() => {
    setSelectedApps((current) =>
      current.filter((pkg) => apps.some((app) => app.packageName === pkg)),
    );
  }, [apps]);

  useEffect(() => {
    if (!isAppDropdownOpen) return undefined;
    const onOutsideClick = (event) => {
      if (appSelectorRef.current && !appSelectorRef.current.contains(event.target)) {
        setIsAppDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [isAppDropdownOpen]);

  const loadDashboard = useCallback(
    async ({ silent = false } = {}) => {
      if (!selectedDevice) return;
      if (!silent) setLoadingDashboard(true);
      try {
        const next = await fetchPlaybackProgramDashboard(selectedDevice);
        setDashboardData(next);
        if (!next?.isRunning) setStopRequested(false);
        setErrorText("");
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "读取运行记录失败");
      } finally {
        if (!silent) setLoadingDashboard(false);
      }
    },
    [selectedDevice],
  );

  useEffect(() => {
    if (activeSection !== "playback-dashboard") return undefined;
    if (!selectedDevice) {
      setDashboardData(null);
      return undefined;
    }

    let timerId = 0;
    loadDashboard({ silent: false });
    timerId = window.setInterval(() => {
      loadDashboard({ silent: true });
    }, 1500);

    return () => {
      if (timerId) window.clearInterval(timerId);
    };
  }, [activeSection, loadDashboard, selectedDevice]);

  const filteredApps = useMemo(() => {
    const keyword = appKeyword.trim().toLowerCase();
    if (!keyword) return apps;
    return apps.filter((app) => {
      const name = String(app.appName || "").toLowerCase();
      const pkg = String(app.packageName || "").toLowerCase();
      return name.includes(keyword) || pkg.includes(keyword);
    });
  }, [appKeyword, apps]);

  const appNameMap = useMemo(() => {
    const map = new Map();
    apps.forEach((item) => map.set(item.packageName, item.appName));
    return map;
  }, [apps]);

  const appSelectorText = useMemo(() => {
    if (selectedApps.length === 0) return "请选择软件（可多选）";
    const names = selectedApps.map((pkg) => appNameMap.get(pkg) || pkg);
    if (names.length <= 2) return names.join("、");
    return `${names.slice(0, 2).join("、")} 等 ${names.length} 个软件`;
  }, [appNameMap, selectedApps]);

  const appCountText = useMemo(() => {
    if (!selectedDevice) return "未选择设备";
    if (loadingApps) return "正在读取设备应用列表...";
    const base = appKeyword.trim()
      ? `共 ${apps.length} 个应用，匹配 ${filteredApps.length} 个`
      : `共 ${apps.length} 个应用`;
    return `${base}，已选择 ${selectedApps.length} 个`;
  }, [selectedDevice, loadingApps, appKeyword, apps.length, filteredApps.length, selectedApps.length]);

  const summaryItems = useMemo(
    () => [
      { label: "循环次数", value: dashboardData?.totalCycles ?? 0 },
      { label: "总滑动次数", value: dashboardData?.totalSwipes ?? 0 },
      { label: "总点赞次数", value: dashboardData?.totalLikes ?? 0 },
      { label: "弹窗处理次数", value: dashboardData?.totalPopupDismissed ?? 0 },
      { label: "应用启动成功", value: dashboardData?.totalLaunchSuccesses ?? 0 },
      { label: "应用启动失败", value: dashboardData?.totalLaunchFailures ?? 0 },
    ],
    [dashboardData],
  );

  const disabledAppSelector = loadingApps || apps.length === 0;
  const disabledStartProgramButton =
    startingProgram || loadingApps || !selectedDevice || selectedApps.length === 0;
  const disabledUnlockButton = unlockingDevice || startingProgram || !selectedDevice;

  const toggleAppSelection = (packageName) => {
    setSelectedApps((current) =>
      current.includes(packageName)
        ? current.filter((item) => item !== packageName)
        : [...current, packageName],
    );
  };

  const selectAllFilteredApps = () => {
    setSelectedApps((current) => {
      const merged = new Set(current);
      filteredApps.forEach((app) => merged.add(app.packageName));
      return Array.from(merged);
    });
  };

  const randomIntInRange = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min;
  const randomFloatInRange = (min, max, step = 0.1) => {
    const totalSteps = Math.max(0, Math.round((max - min) / step));
    const stepIndex = randomIntInRange(0, totalSteps);
    return Number((min + stepIndex * step).toFixed(1));
  };
  const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

  const randomProfiles = [
    { name: "快刷", weight: 0.35, avgStayMin: 8.5, avgStayMax: 11.5, staySpanMin: 3, staySpanMax: 6, likeMin: 8, likeMax: 18, perAppSecondsMin: 100, perAppSecondsMax: 200 },
    { name: "常规", weight: 0.45, avgStayMin: 10, avgStayMax: 13.5, staySpanMin: 4, staySpanMax: 7, likeMin: 12, likeMax: 26, perAppSecondsMin: 150, perAppSecondsMax: 300 },
    { name: "深看", weight: 0.2, avgStayMin: 13, avgStayMax: 18, staySpanMin: 5, staySpanMax: 10, likeMin: 18, likeMax: 36, perAppSecondsMin: 240, perAppSecondsMax: 420 },
  ];

  const handleRandomBrowseConfig = () => {
    const totalWeight = randomProfiles.reduce((sum, profile) => sum + profile.weight, 0);
    let cursor = Math.random() * totalWeight;
    let profile = randomProfiles[randomProfiles.length - 1];
    for (const item of randomProfiles) {
      cursor -= item.weight;
      if (cursor <= 0) {
        profile = item;
        break;
      }
    }

    const avgStay = randomFloatInRange(profile.avgStayMin, profile.avgStayMax, 0.1);
    const staySpan = randomFloatInRange(profile.staySpanMin, profile.staySpanMax, 0.1);
    const nextWaitMin = Number(clampNumber(avgStay - staySpan / 2, 0.8, 45).toFixed(1));
    const nextWaitMax = Number(clampNumber(avgStay + staySpan / 2, nextWaitMin + 1.2, 60).toFixed(1));
    const nextLikeChance = randomIntInRange(profile.likeMin, profile.likeMax);
    const targetPerAppSeconds = randomIntInRange(profile.perAppSecondsMin, profile.perAppSecondsMax);
    const stayMid = (nextWaitMin + nextWaitMax) / 2;
    const roundsCenter = Math.max(1, targetPerAppSeconds / stayMid);
    let nextRoundsMin = clampNumber(Math.floor(roundsCenter * 0.7), 3, 28);
    let nextRoundsMax = clampNumber(Math.ceil(roundsCenter * 1.3), nextRoundsMin + 2, 30);
    if (nextRoundsMax - nextRoundsMin < 2) {
      nextRoundsMin = clampNumber(nextRoundsMin - 1, 3, 28);
      nextRoundsMax = clampNumber(nextRoundsMin + 2, nextRoundsMin + 2, 30);
    }

    setBrowseRoundsMin(nextRoundsMin);
    setBrowseRoundsMax(nextRoundsMax);
    setBrowseWaitMinSeconds(nextWaitMin);
    setBrowseWaitMaxSeconds(nextWaitMax);
    setBrowseLikeChancePercent(nextLikeChance);
    setBrowseConfigText(
      `随机配置（${profile.name}）已应用：滑动 ${nextRoundsMin}-${nextRoundsMax} 次，停留 ${nextWaitMin}-${nextWaitMax} 秒，点赞 ${nextLikeChance}%`,
    );
  };

  const handleUnlockDevice = async () => {
    if (!selectedDevice) return;
    setUnlockingDevice(true);
    setErrorText("");
    setUnlockText("");
    try {
      const result = await playbackUnlockDevice(
        selectedDevice,
        unlockPattern,
        clearCredentialAfterVerify,
      );
      setUnlockText(result?.message || "远程解锁已执行");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "远程解锁失败");
    } finally {
      setUnlockingDevice(false);
    }
  };

  const handleStartProgram = async () => {
    if (!selectedDevice || selectedApps.length === 0) return;
    setStartingProgram(true);
    setErrorText("");
    setActionText("");
    try {
      const result = await playbackStartProgram(selectedDevice, selectedApps, {
        roundsMin: browseRoundsMin,
        roundsMax: browseRoundsMax,
        waitMinSeconds: browseWaitMinSeconds,
        waitMaxSeconds: browseWaitMaxSeconds,
        likeChancePercent: browseLikeChancePercent,
      });
      setActionText(result?.message || "启动程序已执行，正在进入运行记录...");
      onNavigate("playback-dashboard");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "启动程序失败");
    } finally {
      setStartingProgram(false);
    }
  };

  const handleStopProgram = async () => {
    if (!selectedDevice) return;
    setStoppingProgram(true);
    setErrorText("");
    setActionText("");
    try {
      const result = await playbackStopProgram(selectedDevice);
      setDashboardData(result?.dashboard || null);
      setActionText(result?.message || "停止请求已发送");
      setStopRequested(Boolean(result?.stopped && result?.dashboard?.isRunning));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "停止程序失败");
    } finally {
      setStoppingProgram(false);
    }
  };

  const handleClearLogs = async () => {
    if (!selectedDevice) return;
    setClearingLogs(true);
    setErrorText("");
    setActionText("");
    try {
      const next = await clearPlaybackProgramDashboardLogs(selectedDevice);
      setDashboardData(next);
      setActionText("运行日志已清空");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "清空运行日志失败");
    } finally {
      setClearingLogs(false);
    }
  };

  const handleExportLogs = async () => {
    if (!selectedDevice) return;
    setExportingLogs(true);
    setErrorText("");
    setActionText("");
    try {
      const exported = await exportPlaybackProgramDashboard(selectedDevice);
      const blob = new Blob([exported.content], { type: exported.contentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exported.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setActionText(`已导出日志文件：${exported.fileName}`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "导出运行日志失败");
    } finally {
      setExportingLogs(false);
    }
  };

  return (
    <RegionSection
      title="自动刷视频控制台"
      description="任务配置与运行记录，完全独立于自动钉钉打卡。"
      moduleName={PLAYBACK_CONSOLE_MODULE_NAME}
    >
      <div className="dashboard-layout">
        {activeSection === "playback-devices" ? (
          <section id="playback-devices" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "80ms" }}>
            <Card className="region-card h-full">
              <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <CardTitle>任务配置</CardTitle>
                  <CardDescription>选择设备与应用后，独立启动自动刷视频程序。</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={loadPlaybackDevices} disabled={loadingDevices}>
                  <RefreshCw className={cn("size-4", loadingDevices && "animate-spin")} />
                  <span>刷新设备</span>
                </Button>
              </CardHeader>
              <CardContent className="region-card-content space-y-4 pt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">安卓设备</label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-4 py-2 text-sm"
                      value={selectedDevice}
                      onChange={(event) => setSelectedDevice(event.target.value)}
                      disabled={loadingDevices || devices.length === 0}
                    >
                      {devices.length === 0 ? <option value="">暂无可用设备</option> : null}
                      {devices.map((device) => (
                        <option key={device.serial} value={device.serial}>
                          {device.serial}（{device.state}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">设备软件（支持搜索多选）</label>
                    <div className="relative" ref={appSelectorRef}>
                      <button
                        type="button"
                        className="flex h-10 w-full items-center rounded-md border bg-background px-4 py-2 text-left text-sm"
                        disabled={disabledAppSelector}
                        onClick={() => {
                          if (!disabledAppSelector) setIsAppDropdownOpen((open) => !open);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{appSelectorText}</span>
                        <ChevronDown className={cn("ml-2 size-4 shrink-0 transition-transform", isAppDropdownOpen && "rotate-180")} />
                      </button>
                      {isAppDropdownOpen ? (
                        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 rounded-md border bg-background p-3 shadow-sm">
                          <Input
                            value={appKeyword}
                            onChange={(event) => setAppKeyword(event.target.value)}
                            placeholder="搜索软件名称或包名"
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={selectAllFilteredApps} disabled={filteredApps.length === 0}>
                              全选匹配
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setSelectedApps([])} disabled={selectedApps.length === 0}>
                              清空已选
                            </Button>
                          </div>
                          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-md border bg-muted/15 p-2">
                            {filteredApps.length === 0 ? (
                              <p className="px-2 py-2 text-sm text-muted-foreground">无匹配结果</p>
                            ) : (
                              filteredApps.map((app) => {
                                const checked = selectedApps.includes(app.packageName);
                                return (
                                  <label key={app.packageName} className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-2 hover:border-border hover:bg-accent/40">
                                    <input type="checkbox" checked={checked} onChange={() => toggleAppSelection(app.packageName)} />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium">{app.appName}</span>
                                      <span className="block truncate text-xs text-muted-foreground">{app.packageName}</span>
                                    </span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <Card className="bg-muted/20">
                  <CardHeader className="pb-4">
                    <CardTitle>浏览视频配置</CardTitle>
                    <CardDescription>支持手动微调，随机配置可在底部固定栏执行。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {browseConfigText ? <p className="text-sm text-muted-foreground">{browseConfigText}</p> : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">每应用滑动最小次数</label>
                        <Input type="number" min={1} max={30} value={browseRoundsMin} onChange={(event) => setBrowseRoundsMin(Number(event.target.value) || 1)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">每应用滑动最大次数</label>
                        <Input type="number" min={1} max={30} value={browseRoundsMax} onChange={(event) => setBrowseRoundsMax(Number(event.target.value) || 1)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">停留最小秒数</label>
                        <Input type="number" step="0.1" min={0.5} max={60} value={browseWaitMinSeconds} onChange={(event) => setBrowseWaitMinSeconds(Number(event.target.value) || 0.5)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">停留最大秒数</label>
                        <Input type="number" step="0.1" min={0.5} max={60} value={browseWaitMaxSeconds} onChange={(event) => setBrowseWaitMaxSeconds(Number(event.target.value) || 0.5)} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">随机点赞概率（%）</label>
                        <Input type="number" min={0} max={100} step={1} value={browseLikeChancePercent} onChange={(event) => setBrowseLikeChancePercent(Number(event.target.value) || 0)} />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-muted/20">
                  <CardHeader className="pb-4">
                    <CardTitle>动作执行</CardTitle>
                    <CardDescription>远程解锁入口；启动任务可在底部固定栏执行。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={handleUnlockDevice}
                        disabled={disabledUnlockButton}
                      >
                        <ShieldCheck className="size-4" />
                        <span>{unlockingDevice ? "解锁中..." : "执行远程解锁"}</span>
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">图案序列</label>
                        <Input value={unlockPattern} onChange={(event) => setUnlockPattern(event.target.value)} placeholder="例如 2589" />
                      </div>
                      <label className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={clearCredentialAfterVerify}
                          onChange={(event) => setClearCredentialAfterVerify(event.target.checked)}
                        />
                        验证成功后清除锁屏凭据（远程模式）
                      </label>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>{appCountText}</p>
                  {unlockText ? <p>{unlockText}</p> : null}
                  {actionText ? <p>{actionText}</p> : null}
                  {errorText ? <p className="text-red-500">错误：{errorText}</p> : null}
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {activeSection === "playback-dashboard" ? (
          <section id="playback-dashboard" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "80ms" }}>
            <Card className="region-card h-full">
              <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <CardTitle>运行记录</CardTitle>
                  <CardDescription>实时展示自动刷视频执行数据与日志记录，约每 1.5 秒自动刷新。</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={handleClearLogs} disabled={!selectedDevice || clearingLogs || exportingLogs}>
                    {clearingLogs ? "清空中..." : "清空日志"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportLogs} disabled={!selectedDevice || exportingLogs || clearingLogs || stoppingProgram}>
                    {exportingLogs ? "导出中..." : "导出日志"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleStopProgram} disabled={!selectedDevice || stoppingProgram || stopRequested || !dashboardData?.isRunning}>
                    {stoppingProgram || stopRequested ? "停止中..." : "停止程序"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="region-card-content space-y-4 pt-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">安卓设备</label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-4 py-2 text-sm"
                      value={selectedDevice}
                      onChange={(event) => setSelectedDevice(event.target.value)}
                      disabled={loadingDevices || devices.length === 0}
                    >
                      {devices.length === 0 ? <option value="">暂无可用设备</option> : null}
                      {devices.map((device) => (
                        <option key={device.serial} value={device.serial}>
                          {device.serial}（{device.state}）
                        </option>
                      ))}
                    </select>
                  </div>
                  <Card className="bg-muted/20">
                    <CardContent className="space-y-2 p-4 text-sm">
                      <p>当前状态：<strong className={dashboardData?.isRunning ? "text-emerald-600" : "text-amber-600"}>{dashboardData?.isRunning ? "运行中" : "未运行"}</strong></p>
                      <p>开始时间：{formatPlaybackDateTime(dashboardData?.startedAt)}</p>
                      <p>最近更新：{formatPlaybackDateTime(dashboardData?.lastUpdatedAt)}</p>
                      <p>当前应用：{dashboardData?.currentAppName || dashboardData?.currentAppPackageName || "-"}</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  {summaryItems.map((item) => (
                    <div key={item.label} className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-xl font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">应用播放统计</h3>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-muted/30 text-left">
                          <th className="border-b px-3 py-2">应用</th>
                          <th className="border-b px-3 py-2">播放时长</th>
                          <th className="border-b px-3 py-2">循环命中</th>
                          <th className="border-b px-3 py-2">滑动</th>
                          <th className="border-b px-3 py-2">点赞</th>
                          <th className="border-b px-3 py-2">弹窗处理</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData?.apps?.length ? (
                          dashboardData.apps.map((app) => (
                            <tr key={app.packageName}>
                              <td className="border-b px-3 py-2">
                                <div className="font-medium">{app.appName}</div>
                                <div className="text-xs text-muted-foreground">{app.packageName}</div>
                              </td>
                              <td className="border-b px-3 py-2">{formatPlaybackDuration(app.playDurationMs)}</td>
                              <td className="border-b px-3 py-2">{app.cycles}</td>
                              <td className="border-b px-3 py-2">{app.swipes}</td>
                              <td className="border-b px-3 py-2">{app.likes}</td>
                              <td className="border-b px-3 py-2">{app.popupDismissed}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                              暂无应用统计数据
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">执行日志</h3>
                  <div className="max-h-[460px] space-y-2 overflow-y-auto rounded-lg border bg-muted/10 p-2">
                    {dashboardData?.recentLogs?.length ? (
                      dashboardData.recentLogs.map((log) => (
                        <div key={log.id} className={cn("grid gap-1 rounded-md border bg-background px-3 py-2 text-xs md:grid-cols-[180px_70px_180px_minmax(0,1fr)]", log.level === "error" ? "border-red-200 bg-red-50/60 dark:border-red-900/40 dark:bg-red-950/20" : log.level === "warn" ? "border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20" : "border-border")}>
                          <span className="text-muted-foreground">{formatPlaybackDateTime(log.timestamp)}</span>
                          <span className="text-muted-foreground">轮次 {log.cycle}</span>
                          <span className="font-medium">{log.action}</span>
                          <span className="break-all text-muted-foreground">{log.detail}</span>
                        </div>
                      ))
                    ) : (
                      <p className="px-2 py-3 text-sm text-muted-foreground">暂无日志</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>{loadingDashboard ? "正在加载看板数据..." : "看板已连接自动刷新"}</p>
                  {actionText ? <p>{actionText}</p> : null}
                  {errorText ? <p className="text-red-500">错误：{errorText}</p> : null}
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}
      </div>
      {activeSection === "playback-devices" ? (
        <div className="menu-outer">
          <div className="menu-inner menu-inner--dual">
            <button
              type="button"
              className="menu-link"
              onClick={handleRandomBrowseConfig}
              disabled={startingProgram}
            >
              <div>随机配置</div>
            </button>
            <button
              type="button"
              className={cn("menu-link", startingProgram && "menu-link--active")}
              onClick={handleStartProgram}
              disabled={disabledStartProgramButton}
            >
              <div>{startingProgram ? "执行中..." : "启动任务"}</div>
            </button>
          </div>
        </div>
      ) : null}
    </RegionSection>
  );
}

function SidebarSummaryCard({ collapsed, scheduleSummary }) {
  return (
    <Card className={cn("fade-up", collapsed && "lg:hidden")} style={{ "--delay": "160ms" }}>
      <CardHeader className="pb-4">
        <CardTitle>今日概览</CardTitle>
        <CardDescription>优先看状态和执行窗口</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryRow label="工作日状态" value="已校验" />
        <SummaryRow label="设备连接" value="1 台已连接" />
        <SummaryRow label="下一次计划" value={scheduleSummary} emphasized />
      </CardContent>
    </Card>
  );
}

function RegionSection({ title, description, children, moduleName }) {
  const tone =
    title === "监控总览与执行态势"
      ? "overview"
      : title === "任务配置与排期管理"
        ? "config"
        : title === "使用说明"
          ? "config"
        : title === "打卡记录"
          ? "records"
          : title === "告警日志与通知中心"
            ? "notify"
            : "brand";
  return (
    <section
      className="region-section"
      data-region-title={title}
      data-region-tone={tone}
      data-module={moduleName}
      aria-label={description}
    >
      {children}
    </section>
  );
}

function TopbarRegion({ title, tone, theme, sidebarCollapsed, onToggleTheme }) {
  const titleRef = useRef(null);
  const topbarRef = useRef(null);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const sidebarWidthsRef = useRef({ expanded: 280, collapsed: 73 });
  const insetToRef = useRef(null);
  const sidebarWidthToRef = useRef(null);

  useLayoutEffect(() => {
    const target = titleRef.current;
    if (!target) return undefined;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }

    const split = new GSAPSplitText(target, {
      type: "chars",
      charsClass: "topbar-title-char",
    });

    const tween = gsap.fromTo(
      split.chars,
      { yPercent: 108, opacity: 0, rotateX: -32 },
      {
        yPercent: 0,
        opacity: 1,
        rotateX: 0,
        duration: 0.56,
        ease: "power2.out",
        stagger: 0.022,
        clearProps: "transform,opacity",
      },
    );

    return () => {
      tween.kill();
      split?.revert();
    };
  }, [title]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const topbar = topbarRef.current;
    if (!topbar) return undefined;

    let scrollFrameId = 0;
    const maxInset = 16;
    const startY = 14;
    const endY = 280;
    const easeOutCubic = (value) => 1 - (1 - value) ** 3;
    const parseSize = (raw, fallback) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? value : fallback;
    };
    const resolveVarPx = (varName, fallback) => {
      const probe = document.createElement("div");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.pointerEvents = "none";
      probe.style.width = `var(${varName})`;
      topbar.appendChild(probe);
      const px = Number.parseFloat(window.getComputedStyle(probe).width);
      topbar.removeChild(probe);
      return Number.isFinite(px) ? px : fallback;
    };

    const readSidebarWidths = () => {
      const styles = window.getComputedStyle(topbar);
      sidebarWidthsRef.current = {
        expanded: parseSize(styles.getPropertyValue("--sidebar-expanded-width"), 280),
        collapsed: resolveVarPx("--sidebar-collapsed-width", 73),
      };
    };

    const updateInsetTarget = () => {
      const y = window.scrollY;
      const progress = Math.min(1, Math.max(0, (y - startY) / (endY - startY)));
      const targetInset = maxInset * easeOutCubic(progress);
      insetToRef.current?.(targetInset);
    };

    const updateSidebarTarget = () => {
      const widths = sidebarWidthsRef.current;
      const nextWidth = sidebarCollapsedRef.current ? widths.collapsed : widths.expanded;
      sidebarWidthToRef.current?.(nextWidth);
    };

    const onScroll = () => {
      if (scrollFrameId) return;
      scrollFrameId = window.requestAnimationFrame(() => {
        scrollFrameId = 0;
        updateInsetTarget();
      });
    };

    const onResize = () => {
      readSidebarWidths();
      updateSidebarTarget();
      onScroll();
    };

    readSidebarWidths();
    const widths = sidebarWidthsRef.current;
    const initialSidebarWidth = sidebarCollapsedRef.current ? widths.collapsed : widths.expanded;
    gsap.set(topbar, {
      "--topbar-inline-inset": "0px",
      "--topbar-sidebar-animated-width": `${initialSidebarWidth}px`,
    });

    insetToRef.current = gsap.quickTo(topbar, "--topbar-inline-inset", {
      duration: 0.46,
      ease: "power3.out",
      overwrite: "auto",
    });
    sidebarWidthToRef.current = gsap.quickTo(topbar, "--topbar-sidebar-animated-width", {
      duration: 0.56,
      ease: "power3.out",
      overwrite: "auto",
    });

    updateInsetTarget();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (scrollFrameId) window.cancelAnimationFrame(scrollFrameId);
      insetToRef.current?.tween?.kill();
      sidebarWidthToRef.current?.tween?.kill();
      insetToRef.current = null;
      sidebarWidthToRef.current = null;
    };
  }, []);

  useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed;
    const widths = sidebarWidthsRef.current;
    const nextWidth = sidebarCollapsed ? widths.collapsed : widths.expanded;
    sidebarWidthToRef.current?.(nextWidth);
  }, [sidebarCollapsed]);

  return (
    <>
      <div className="hidden h-12 lg:block" aria-hidden="true" />
      <section
        ref={topbarRef}
        className="topbar-region topbar-region--fixed sticky top-0 z-[30] -mx-3 bg-background/70 px-3 py-0 backdrop-blur sm:-mx-4 sm:px-4 lg:mx-0 lg:px-4"
        style={{
          "--topbar-sidebar-animated-width": sidebarCollapsed
            ? "var(--sidebar-collapsed-width)"
            : "var(--sidebar-expanded-width)",
          "--topbar-inline-inset": "0px",
        }}
      >
        <div className="topbar-region-inner flex h-12 items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                key={`${title}-indicator`}
                className={cn("title-swap topbar-indicator", `topbar-indicator--${tone}`)}
                aria-hidden="true"
              />
              <h2 className="truncate text-base font-semibold tracking-tight">
                <span key={title} ref={titleRef} className="topbar-title block">
                  {title}
                </span>
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={onToggleTheme}
          >
            {theme === "light" ? <MoonStar className="size-4" aria-hidden="true" /> : <SunMedium className="size-4" aria-hidden="true" />}
            <span>{theme === "light" ? "深色模式" : "浅色模式"}</span>
          </button>
        </div>
      </section>
    </>
  );
}

function BottomStickyMenu({ activeSection, pendingAction, hasBlockingIssues, blockingCount, onAction }) {
  const [visible, setVisible] = useState(true);
  const lastScrollYRef = useRef(0);
  const travelRef = useRef(0);
  const alwaysVisible = activeSection === "actions";
  const summaryTone = hasBlockingIssues ? "warning" : pendingAction ? "warning" : "success";
  const summaryToneSet = toneClasses(summaryTone);
  const summaryBadge = hasBlockingIssues ? `阻断项 ${blockingCount}` : pendingAction ? "处理中" : "快捷入口";
  const summaryText = hasBlockingIssues
    ? "先修复配置问题，再保存或启动任务。"
    : pendingAction
      ? "后端动作执行中，等待返回结果。"
      : "移动端可直接从这里完成保存、自检和启动。";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    if (alwaysVisible) {
      setVisible(true);
      return undefined;
    }

    lastScrollYRef.current = window.scrollY;
    travelRef.current = 0;

    const onScroll = () => {
      const nextY = window.scrollY;
      const delta = nextY - lastScrollYRef.current;

      if (nextY <= 36) {
        setVisible(true);
        travelRef.current = 0;
        lastScrollYRef.current = nextY;
        return;
      }

      if (Math.abs(delta) < 2) {
        lastScrollYRef.current = nextY;
        return;
      }

      if (delta > 0) {
        travelRef.current = Math.max(0, travelRef.current) + delta;
      } else {
        travelRef.current = Math.min(0, travelRef.current) + delta;
      }

      if (travelRef.current > 42) {
        setVisible(false);
        travelRef.current = 0;
      } else if (travelRef.current < -28) {
        setVisible(true);
        travelRef.current = 0;
      }

      lastScrollYRef.current = nextY;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [alwaysVisible]);

  return (
    <div className={cn("menu-outer", !visible && !alwaysVisible && "menu-outer--hidden")}>
      <div className={cn("flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2", summaryToneSet.panel)}>
        <Badge variant={summaryTone} className="rounded-md">
          {summaryBadge}
        </Badge>
        <p className="text-right text-xs leading-5 text-muted-foreground">{summaryText}</p>
      </div>
      <div className="menu-inner">
        <button
          type="button"
          className={cn("menu-link menu-link--wide", pendingAction === "保存配置" && "menu-link--active")}
          disabled={hasBlockingIssues}
          onClick={() => onAction("保存配置")}
        >
          <div>{pendingAction === "保存配置" ? "处理中..." : "保存配置"}</div>
        </button>
        <button
          type="button"
          className={cn("menu-link", pendingAction === "试运行" && "menu-link--active")}
          onClick={() => onAction("试运行")}
        >
          <div>{pendingAction === "试运行" ? "处理中..." : "试运行"}</div>
        </button>
        <button
          type="button"
          className={cn("menu-link", pendingAction === "启动任务" && "menu-link--active")}
          disabled={hasBlockingIssues}
          onClick={() => onAction("启动任务")}
        >
          <div>{pendingAction === "启动任务" ? "处理中..." : "启动任务"}</div>
        </button>
      </div>
    </div>
  );
}

function SectionState({
  icon: Icon,
  title,
  detail,
  tone = "secondary",
  actionLabel,
  actionIcon: ActionIcon = RefreshCw,
  loading = false,
  onAction,
}) {
  const toneSet = toneClasses(tone);
  return (
    <div className={cn("rounded-xl border p-4", toneSet.panel)}>
      <div className="flex items-start gap-3">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border", toneSet.icon)}>
          <Icon className={cn("size-4", loading && "animate-spin")} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
          {actionLabel ? (
            <Button variant="outline" size="sm" className="gap-2" onClick={onAction}>
              <ActionIcon className="size-4" />
              <span>{actionLabel}</span>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, emphasized = false, tone = null }) {
  const resolvedTone = tone ?? (emphasized ? "warning" : statusTone(value));
  const toneSet = toneClasses(resolvedTone);
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-lg border px-4 py-2", toneSet.panel)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "max-w-[60%] text-right text-sm text-muted-foreground",
          emphasized && "font-medium text-foreground",
          resolvedTone === "success" && "text-emerald-700 dark:text-emerald-300",
          resolvedTone === "warning" && "text-amber-700 dark:text-amber-300",
          resolvedTone === "destructive" && "text-red-700 dark:text-red-300",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MetricCard({ item, delay }) {
  const tone = item.tone ?? statusTone(item.value);
  const toneSet = toneClasses(tone);
  return (
    <Card className={cn("fade-up card-hover", toneSet.panel)} style={{ "--delay": delay }}>
      <CardContent className="space-y-4 p-4">
        <div className={cn("flex size-9 items-center justify-center rounded-md border", toneSet.icon)}>
          <item.icon className="size-3.5" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">{item.value}</h3>
            <Badge variant={tone} className="rounded-md px-2 py-1 text-xs">
              {toneLabel(tone)}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectMonitorCard({ item, onNavigate }) {
  const tone = item.tone ?? "secondary";
  const toneSet = toneClasses(tone);
  const Icon = item.icon;

  return (
    <Card className={cn("bg-muted/20", toneSet.panel)}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={cn("flex size-8 items-center justify-center rounded-md border", toneSet.icon)}>
                <Icon className="size-4" />
              </div>
              <CardTitle>{item.title}</CardTitle>
            </div>
            <CardDescription>{item.detail}</CardDescription>
          </div>
          <Badge variant={tone} className="rounded-md">
            {item.statusText}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {item.rows.map((row) => (
          <SummaryRow key={`${item.id}-${row.label}`} label={row.label} value={row.value} />
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          {item.actions.map((action) => (
            <Button
              key={action.key}
              variant="outline"
              size="sm"
              onClick={() => onNavigate(action.target)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionRow({ item }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-background px-4 py-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
        <item.icon className="size-4" />
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{item.title}</p>
        <p className="text-sm font-medium leading-6 text-foreground">{item.value}</p>
        <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
      </div>
    </div>
  );
}

function Field({ label, dirty, error, helper, ...props }) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {dirty ? (
          <Badge variant="outline" className="rounded-md text-xs">
            已修改
          </Badge>
        ) : null}
      </div>
      <Input
        className={cn(
          "h-10 rounded-lg bg-background/80",
          dirty && "border-zinc-400 dark:border-zinc-500",
          error && "border-red-400 focus-visible:ring-red-300 dark:border-red-500 dark:focus-visible:ring-red-900",
        )}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {helper ? <p className="text-xs leading-6 text-muted-foreground">{helper}</p> : null}
    </label>
  );
}

function SerialField({
  label,
  dirty,
  error,
  helper,
  value,
  onChange,
  devices,
  deviceCount,
  onRefresh,
}) {
  const showSelector = devices.length > 0;
  const deviceHint = deviceCount > devices.length ? `仅展示前 ${devices.length} 台` : "";
  const hasCurrentValue = Boolean(value) && !devices.some((device) => device.serial === value);

  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {dirty ? (
          <Badge variant="outline" className="rounded-md text-xs">
            已修改
          </Badge>
        ) : null}
      </div>
      {showSelector ? (
        <div className="space-y-2">
          <select
            className={cn(
              "h-10 w-full rounded-lg border border-border bg-background/80 px-4 py-2 text-sm",
              dirty && "border-zinc-400 dark:border-zinc-500",
              error && "border-red-400 focus-visible:ring-red-300 dark:border-red-500 dark:focus-visible:ring-red-900",
            )}
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">自动选择（唯一在线设备）</option>
            {hasCurrentValue ? <option value={value}>{value} (已配置)</option> : null}
            {devices.map((device) => (
              <option key={device.serial} value={device.serial}>
                {device.serial} ({device.state ?? "unknown"}
                {device.usbConnected ? "/usb" : ""})
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {deviceHint ? <span>{deviceHint}</span> : null}
            {onRefresh ? (
              <button
                type="button"
                className="underline decoration-dotted underline-offset-4"
                onClick={onRefresh}
              >
                刷新设备列表
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <Input
          className={cn(
            "h-10 rounded-lg bg-background/80",
            dirty && "border-zinc-400 dark:border-zinc-500",
            error && "border-red-400 focus-visible:ring-red-300 dark:border-red-500 dark:focus-visible:ring-red-900",
          )}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
        />
      )}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {helper ? <p className="text-xs leading-6 text-muted-foreground">{helper}</p> : null}
    </label>
  );
}

function RemoteAdbTargetField({
  label,
  dirty,
  error,
  helper,
  value,
  onChange,
  recentTargets,
}) {
  const listId = "remote-adb-target-suggestions";
  const normalizedRecentTargets = recentTargets.map((target) =>
    target && typeof target === "object"
      ? { name: target.name || "", target: target.target || "" }
      : { name: "", target: String(target || "") },
  ).filter((target) => target.target);
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {dirty ? (
          <Badge variant="outline" className="rounded-md text-xs">
            已修改
          </Badge>
        ) : null}
      </div>
      <Input
        list={listId}
        className={cn(
          "h-10 rounded-lg border-border bg-background/80",
          dirty && "border-zinc-400 dark:border-zinc-500",
          error && "border-red-400 focus-visible:ring-red-300 dark:border-red-500 dark:focus-visible:ring-red-900",
        )}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="例如 192.168.1.8:5555"
      />
      {normalizedRecentTargets.length ? (
        <datalist id={listId}>
          {normalizedRecentTargets.map((target) => (
            <option key={target.target} value={target.target}>
              {target.name || target.target}
            </option>
          ))}
        </datalist>
      ) : null}
      {helper ? <p className="text-xs leading-6 text-muted-foreground">{helper}</p> : null}
      {normalizedRecentTargets.length ? (
        <p className="text-xs leading-6 text-muted-foreground">
          最近使用：{normalizedRecentTargets.map((target) => target.name || target.target).join(" / ")}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </label>
  );
}

function TimePickerField({
  label,
  dirty,
  error,
  helper,
  className,
  precision = "minute",
  value,
  onChange,
}) {
  return (
    <label className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {dirty ? (
          <Badge variant="outline" className="rounded-md text-xs">
            已修改
          </Badge>
        ) : null}
      </div>
      <TimePicker
        value={value}
        onChange={onChange}
        precision={precision}
        invalid={Boolean(error)}
        className={cn(dirty && "rounded-lg ring-1 ring-zinc-300 dark:ring-zinc-600", className)}
      />
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {helper ? <p className="text-xs leading-6 text-muted-foreground">{helper}</p> : null}
    </label>
  );
}

function ToggleCard({ label, enabled, dirty, enabledNote, disabledNote, onToggle }) {
  return (
    <Card className="bg-muted/20">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" />
              <p className="text-sm font-medium">{label}</p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {enabled ? enabledNote : disabledNote}
            </p>
          </div>
          {dirty ? (
            <Badge variant="outline" className="rounded-md text-xs">
              已修改
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-3">
          <Badge variant={enabled ? "success" : "secondary"} className="rounded-md">
            {enabled ? "已开启" : "已关闭"}
          </Badge>
          <Button variant={enabled ? "default" : "outline"} size="sm" onClick={onToggle}>
            {enabled ? "关闭" : "开启"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LogRow({ log }) {
  const tone = statusTone(log.status);
  const toneSet = toneClasses(tone);
  return (
    <div className={cn("rounded-xl border p-4", toneSet.panel)}>
      <div className="grid gap-3 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-start">
        <Badge variant="outline" className={cn("h-fit w-fit rounded-md", toneSet.soft)}>
          {log.timeLabel ?? log.time}
        </Badge>
        <div className="space-y-2">
          <p className="text-sm font-medium">{log.title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{log.detail}</p>
        </div>
        <Badge variant={statusTone(log.status)} className="h-fit rounded-md">
          {log.status}
        </Badge>
      </div>
    </div>
  );
}

function TimelineRow({ item, index, isLast }) {
  return (
    <div className="relative pl-8">
      <div className="absolute left-0 top-0 flex size-5 items-center justify-center rounded-full border bg-background text-xs font-medium text-muted-foreground">
        {index + 1}
      </div>
      {!isLast ? <div className="absolute left-[9px] top-6 h-[calc(100%-12px)] w-px bg-border" /> : null}
      <div className="pb-4">
        <p className={cn("text-sm leading-6 text-muted-foreground", index === 1 && "font-medium text-foreground")}>
          {item}
        </p>
      </div>
    </div>
  );
}

function GuardRow({ label, value, emphasized = false }) {
  const tone = emphasized ? "warning" : statusTone(value);
  const toneSet = toneClasses(tone);
  return (
    <div className={cn("rounded-xl border p-4", toneSet.panel)}>
      <div className="flex items-start gap-3">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border", toneSet.icon)}>
          <ShieldCheck className="size-4" />
        </div>
        <div className="space-y-2">
          <p className={cn("text-sm", emphasized ? "font-medium text-foreground" : "font-medium")}>{label}</p>
          <p className="text-sm leading-6 text-muted-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}

function MiniPanel({ title, value, detail }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border bg-muted/20 p-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
        <h3 className="text-lg font-semibold tracking-tight">{value}</h3>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function PendingWindowPanel({ title, headline, time, detail, tone = "warning" }) {
  const toneSet = toneClasses(tone);

  return (
    <div className={cn("flex h-full flex-col justify-between rounded-xl border p-4", toneSet.panel)}>
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold tracking-tight">{headline}</h3>
          <div
            className={cn(
              "inline-flex w-fit items-center rounded-md border px-3 py-1 text-base font-medium",
              toneSet.icon,
            )}
          >
            {time}
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function RemoteAdbPanel({ summary, pendingAction, onConnect, onDisconnect, onRefresh }) {
  const toneSet = toneClasses(summary.tone);
  return (
    <Card className={cn("h-full", toneSet.panel)}>
      <CardHeader className="pb-4">
        <CardTitle>远程 ADB 状态</CardTitle>
        <CardDescription>把最近一次 connect/disconnect 的结果直接放到总览里。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Badge variant={summary.tone === "secondary" ? "outline" : summary.tone} className="rounded-md">
            {summary.headline}
          </Badge>
          <div
            className={cn(
              "inline-flex w-fit items-center rounded-md border px-3 py-1 text-sm font-medium",
              toneSet.icon,
            )}
          >
            {summary.time}
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{summary.detail}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onConnect} disabled={pendingAction === "连接远程 ADB"}>
            {pendingAction === "连接远程 ADB" ? "连接中..." : "连接远程 ADB"}
          </Button>
          <Button variant="outline" size="sm" onClick={onDisconnect} disabled={pendingAction === "断开远程 ADB"}>
            {pendingAction === "断开远程 ADB" ? "断开中..." : "断开远程 ADB"}
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            刷新状态
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AlertRow({ icon: Icon, title, detail }) {
  const tone = statusTone(`${title} ${detail}`);
  const toneSet = toneClasses(tone);
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border p-4", toneSet.panel)}>
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full border", toneSet.icon)}>
        <Icon className="size-4" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export default App;
