import {
  Activity,
  AlarmClockCheck,
  BadgeCheck,
  BellRing,
  Bot,
  Bug,
  CheckCheck,
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
  rerollSchedule,
  runDoctor,
  runOnce,
  saveConfig,
  startScheduler,
  stopScheduler,
} from "./lib/api.js";
import { cn } from "./lib/utils.js";

gsap.registerPlugin(GSAPSplitText);

const navItems = [
  { id: "overview", label: "监控总览", icon: Gauge },
  { id: "actions", label: "任务配置", icon: FolderCog },
  { id: "guide", label: "使用说明", icon: CircleHelp },
  { id: "records", label: "打卡记录", icon: ClipboardList },
  { id: "logs", label: "告警日志", icon: BellRing },
];

const quickChecklist = [
  "先看设备是否已连接且 ADB 已授权",
  "再核对今日上午 / 下午随机执行时间",
  "最后执行自检或试运行，不要直接启动",
];

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
        label: "设备序列号 serial",
        key: "serial",
        defaultValue: "",
        helper: "用于绑定具体 ADB 设备；留空时会自动选择唯一在线设备。",
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
    note: "以 debug 模式启动，便于观察运行状态。",
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
    enabledNote: "设备重新连接后，会尝试自动拉起 scrcpy。",
    disabledNote: "只保留调度行为，不自动拉起 scrcpy。",
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
  toggleDefinitions.map((item) => [item.label, item.key === "enable_workday_check"]),
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

function buildConfigStateFromDashboard(dashboard) {
  if (!dashboard?.config) return { ...initialConfigState };

  const config = dashboard.config;
  return Object.fromEntries(
    configGroups.flatMap((group) =>
      group.fields.map((field) => {
        let value = config[field.key];
        if (field.key === "delay_after_launch") value = `${value} 秒`;
        if (field.key === "poll_interval") value = `${value} 秒`;
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
    if (key === "delay_after_launch" || key === "poll_interval" || key === "workday_api_timeout_ms") {
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
  const [recordFilter, setRecordFilter] = useState({ date: "", type: "", status: "" });
  const [recordPage, setRecordPage] = useState(1);
  const [recordPageSize, setRecordPageSize] = useState(10);

  const quickActionSet = useMemo(
    () =>
      new Set([
        "保存配置",
        "启动任务",
        "自检",
        "一键自检",
        "查看排期",
        "刷新设备状态",
        "停止任务",
        "调试模式",
        "试运行",
        "重新抽取",
      ]),
    [],
  );

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

  useEffect(() => {
    refreshDashboard({ silent: true }).catch(() => {});
  }, [refreshDashboard]);

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
      if (recordFilter.type && record.type !== recordFilter.type) return false;
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
    const rows = filteredRecords.map((r) => [r.date, r.time, r.type, r.status, r.remark]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell ?? ""}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `打卡记录_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("导出成功", { description: `已导出 ${filteredRecords.length} 条记录` });
  }, [filteredRecords]);

  const handleResetFilter = useCallback(() => {
    setRecordFilter({ date: "", type: "", status: "" });
    setRecordPage(1);
  }, []);

  const scheduleSummary = useMemo(
    () =>
      dashboard?.scheduleSummary ??
      `${windowValues["上午窗口-selected"]} / ${windowValues["下午窗口-selected"]}`,
    [dashboard, windowValues],
  );

  const metrics = useMemo(() => {
    const morningWindow = getWindowFromDashboard(dashboard, "morning");
    const deviceState = dashboard?.device;
    const workdayState = dashboard?.workday;
    let deviceLabel = "待处理";

    if (deviceState?.ready) deviceLabel = "已连接";
    else if (deviceState?.error) deviceLabel = "异常";
    else if (/unauthorized/i.test(deviceState?.summary ?? "")) deviceLabel = "未授权";

    return [
      {
        label: "当前任务状态",
        value: dashboard?.scheduler?.label ?? "未启动",
        note: dashboard?.scheduler?.detail ?? "等待后端返回真实调度进程状态。",
        icon: Activity,
      },
      {
        label: "设备状态",
        value: deviceLabel,
        note:
          deviceState?.serial
            ? `serial: ${deviceState.serial}`
            : deviceState?.error || "等待设备连接或授权。",
        icon: Smartphone,
      },
      {
        label: "下一次上午执行",
        value: morningWindow?.selected ?? windowValues["上午窗口-selected"],
        note: morningWindow?.selectedAt || "默认按时间范围抽取，也可以手动精确指定到秒。",
        icon: AlarmClockCheck,
      },
      {
        label: "最近成功执行",
        value: dashboard?.lastSuccess?.label ?? "暂无执行记录",
        note:
          workdayState?.enabled && workdayState?.checkedDate
            ? `${workdayState.checkedDate} / ${workdayState.note || "已校验"}`
            : "工作日状态会在后端返回后显示。",
        icon: BadgeCheck,
      },
    ];
  }, [dashboard, windowValues]);

  const statusRows = useMemo(() => {
    const morningWindow = getWindowFromDashboard(dashboard, "morning");
    const eveningWindow = getWindowFromDashboard(dashboard, "evening");
    const workdayState = dashboard?.workday;

    return [
      [
        "设备状态",
        dashboard?.device?.error
          ? `异常 / ${dashboard.device.error}`
          : `${dashboard?.device?.summary ?? "待处理"}${dashboard?.device?.serial ? ` / ${dashboard.device.serial}` : ""}`,
        true,
      ],
      ["上午下一次执行时间", morningWindow?.selectedAt ?? windowValues["上午窗口-selected"]],
      ["下午下一次执行时间", eveningWindow?.selectedAt ?? windowValues["下午窗口-selected"]],
      ["最近一次成功执行时间", dashboard?.lastSuccess?.label ?? "暂无执行记录"],
      [
        "最近一次工作日校验结果",
        !workdayState?.enabled
          ? "已关闭"
          : workdayState?.error
            ? `失败 / ${workdayState.error}`
            : `${workdayState?.checkedDate ?? "待校验"} / ${workdayState?.note ?? "待返回"}`,
      ],
    ];
  }, [dashboard, windowValues]);

  const statusTags = dashboard?.statusTags ?? ["等待后端状态"];
  const toggles = dashboard?.toggles ?? [];
  const logs = dashboard?.logs ?? [];
  const timeline = dashboard?.timeline ?? [];
  const alerts = dashboard?.alerts ?? [];
  const primaryActions = actions.filter((item) => item.group === "primary");
  const runtimeActions = actions.filter((item) => item.group === "runtime");
  const supportActions = actions.filter((item) => item.group === "support");

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

    const timeout = parseNumber(configValues["接口超时时间"]);
    if (timeout === null || timeout < 1000) {
      add("接口超时时间", "接口超时时间建议不低于 1000 ms。");
    }

    const workdayUrl = String(configValues["工作日接口地址"] || "").trim();
    if (!/^https?:\/\//.test(workdayUrl)) {
      add("工作日接口地址", "工作日接口地址必须以 http:// 或 https:// 开头。");
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
        chips: ["启动 backend/api_server.py", "恢复后自动拉取状态", "不要在离线状态下误判结果"],
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
    const sectionIds = navItems.map((item) => item.id);
    const elements = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-15% 0px -55% 0px", threshold: [0.2, 0.35, 0.6] },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const regions = () => Array.from(document.querySelectorAll("[data-region-title]"));
    let frameId = 0;

    const syncTopbarMeta = () => {
      const currentRegions = regions();
      if (!currentRegions.length) return;

      const threshold = 132;
      let nextTitle = "监控总览与执行态势";
      let nextTone = "overview";

      for (const region of currentRegions) {
        if (region.offsetParent === null) continue;
        const rect = region.getBoundingClientRect();
        if (rect.top <= threshold) {
          nextTitle = region.getAttribute("data-region-title") || nextTitle;
          nextTone = region.getAttribute("data-region-tone") || nextTone;
        }
      }

      setTopbarTitle((current) => (current === nextTitle ? current : nextTitle));
      setTopbarTone((current) => (current === nextTone ? current : nextTone));
    };

    const onScrollOrResize = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        syncTopbarMeta();
      });
    };

    syncTopbarMeta();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
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

  const handleNavClick = (event, id) => {
    setMobileNavOpen(false);
    if (id === "guide") {
      event.preventDefault();
      setActiveSection("guide");
      setTopbarTitle("使用说明");
      setTopbarTone("config");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#guide`);
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return;
    }

    if (id === "overview") {
      event.preventDefault();
      setActiveSection("overview");
      setTopbarTitle("监控总览与执行态势");
      setTopbarTone("overview");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
      return;
    }

    event.preventDefault();
    setActiveSection(id);
    if (id === "actions") {
      setTopbarTitle("任务配置与排期管理");
      setTopbarTone("config");
    } else if (id === "records") {
      setTopbarTitle("打卡记录");
      setTopbarTone("records");
    } else if (id === "logs") {
      setTopbarTitle("告警日志与通知中心");
      setTopbarTone("notify");
    }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const isConfigFieldDirty = (label) => configValues[label] !== savedConfigValues[label];
  const isToggleDirty = (label) => toggleValues[label] !== savedToggleValues[label];
  const isWindowFieldDirty = (title, key) =>
    windowValues[`${title}-${key}`] !== savedWindowValues[`${title}-${key}`];

  const handleAction = async (label) => {
    if (!quickActionSet.has(label)) return;

    if ((label === "保存配置" || label === "启动任务" || label === "调试模式") && hasBlockingIssues) {
      toast.warning("请先修复阻断问题", {
        description: `当前还有 ${validationIssues.length} 项校验问题，修复后才能继续保存或启动任务。`,
      });
      return;
    }

    if (label === "查看排期") {
      document.getElementById("windows")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          detail: "当前按钮仍可见，但所有需要后端响应的动作都会失败。先恢复 api_server.py。",
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
          <div className="flex h-full min-h-0 flex-col gap-3.5">
            <LogoRegion collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((value) => !value)} />
            <SidebarNav collapsed={sidebarCollapsed} activeSection={activeSection} onNavClick={handleNavClick} />
            {/* <SidebarSummaryCard collapsed={sidebarCollapsed} scheduleSummary={scheduleSummary} /> */}
          </div>
        </aside>

        <main className="min-w-0 px-3 pb-40 pt-3 sm:px-4 sm:pb-36 lg:px-4 lg:pt-3 lg:pb-6">
          {activeSection !== "guide" && (
            <TopbarRegion
              title={topbarTitle}
              tone={topbarTone}
              theme={theme}
              sidebarCollapsed={sidebarCollapsed}
              onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
            />
          )}

          <section className="content-region mt-2.5 space-y-8 sm:mt-3 sm:space-y-10 lg:mt-5 xl:space-y-14">
            <div className={cn(activeSection === "guide" && "hidden")}>
                <RegionSection
                  title="监控总览与执行态势"
                  description="用于查看系统状态、关键指标和执行判断。"
                >
              <div className="dashboard-layout">
                <section id="overview" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "60ms" }}>
                  <Card className="region-card h-full overflow-hidden">
                    <CardContent className="region-card-content space-y-5 p-5 pt-5">
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
                              启动命令：`python3 backend/api_server.py`
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
                                <TriangleAlert className="mt-0.5 size-4 text-red-500" />
                                <span>{issue.message}</span>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      ) : null}

                      <FocusStrip focus={focusState} />

                      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                        {metrics.map((item, index) => (
                          <MetricCard key={item.label} item={item} delay={`${120 + index * 60}ms`} />
                        ))}
                      </div>

                      <div className="grid gap-5 lg:grid-cols-2">
                        <Card className="bg-muted/20">
                          <CardHeader className="pb-4">
                            <CardTitle>现在最该看的信息</CardTitle>
                            <CardDescription>只保留当前决策必需的信息。</CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {!dashboardReady ? (
                              <SectionState
                                icon={RefreshCw}
                                title="正在汇总决策信息"
                                detail="关键指标和风险会在后端状态同步完成后自动生成。"
                                loading
                              />
                            ) : apiError ? (
                              <SectionState
                                icon={TriangleAlert}
                                tone="warning"
                                title="当前只能查看离线草稿"
                                detail="后端离线时无法判断真实风险和最新执行上下文，先恢复连接再做决策。"
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
                                title="正在生成操作路径"
                                detail="系统会根据设备、排期和当前运行状态生成更合适的处理顺序。"
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
                    <CardContent className="region-card-content space-y-5 pt-5">
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
                    <CardContent className="region-card-content space-y-5 pt-5">
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
                              <div className="mb-3 space-y-1">
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
                              <div className="mb-3 space-y-1">
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
                    <CardContent className="region-card-content space-y-5 pt-5">
                      <SectionState {...scheduleStatus} />
                      <div className="grid items-stretch gap-4 lg:grid-cols-2">
                        <MiniPanel title="今日下一次计划" value={scheduleSummary} detail="默认按时间窗口抽取，也支持手动精确指定到秒。" />
                        <MiniPanel
                          title="最近完成记录"
                          value={dashboard?.lastSuccess?.label ?? "暂无执行记录"}
                          detail={dashboard?.workday?.checkedDate ? `最近工作日校验：${dashboard.workday.checkedDate}` : "等待后端返回执行结果。"}
                        />
                      </div>

                      <div className="grid gap-5 lg:grid-cols-2">
                        {windowsData.map((item, index) => (
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
                            <CardContent className="flex flex-1 flex-col gap-5">
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
                                    <SummaryRow label="当前下一次执行" value={windowValues[`${item.title}-selected`]} />
                                  </div>
                                </div>
                              </div>
                              <div className="mt-auto">
                                <SummaryRow label="最近完成日期" value={windowValues[`${item.title}-completed`]} />
                              </div>
                            </CardContent>
                          </Card>
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
                        <CardDescription>低频参数集中放在这里。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="region-card-content space-y-5 pt-5">
                      <SectionState {...configStatus} />
                      <div className="grid items-stretch gap-4 lg:grid-cols-2">
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
                                <div className="space-y-1.5">
                                  <CardTitle>{group.title}</CardTitle>
                                  <CardDescription>{group.description}</CardDescription>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="flex flex-1 flex-col">
                              <div className="grid gap-4 md:grid-cols-2">
                                {group.fields.map((field) => (
                                  <Field
                                    key={field.label}
                                    label={field.label}
                                    value={configValues[field.label]}
                                    onChange={(event) => handleConfigChange(field.label, event.target.value)}
                                    dirty={isConfigFieldDirty(field.label)}
                                    error={validation[field.label]}
                                    helper={field.helper}
                                  />
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
                    <CardContent className="region-card-content space-y-4 pt-5">
                      {/* 筛选栏 */}
                      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">日期</label>
                          <Input
                            type="date"
                            value={recordFilter.date}
                            onChange={(e) => { setRecordFilter((f) => ({ ...f, date: e.target.value })); setRecordPage(1); }}
                            className="h-9 w-40"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">类型</label>
                          <select
                            value={recordFilter.type}
                            onChange={(e) => { setRecordFilter((f) => ({ ...f, type: e.target.value })); setRecordPage(1); }}
                            className="h-9 w-32 rounded-md border bg-background px-3 text-sm"
                          >
                            <option value="">全部</option>
                            <option value="上午打卡">上午打卡</option>
                            <option value="下午打卡">下午打卡</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">状态</label>
                          <select
                            value={recordFilter.status}
                            onChange={(e) => { setRecordFilter((f) => ({ ...f, status: e.target.value })); setRecordPage(1); }}
                            className="h-9 w-32 rounded-md border bg-background px-3 text-sm"
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
                                        {record.type || "--"}
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
                                className="h-8 w-16 rounded-md border bg-background px-2"
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
                    <CardContent className="region-card-content space-y-5 pt-5">
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
                    <CardContent className="region-card-content space-y-3">
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
                    <CardContent className="region-card-content space-y-0">
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
                    <CardContent className="region-card-content space-y-3">
                      {guards.map(([label, value, emphasized]) => (
                        <GuardRow key={label} label={label} value={value} emphasized={emphasized} />
                      ))}
                    </CardContent>
                  </Card>
                </section>
              </div>
              <div className="pt-1 text-center text-xs leading-6 text-muted-foreground">
                版本 {APP_VERSION}
              </div>
            </RegionSection>

            </div>

            {activeSection === "guide" ? (
              <RegionSection
                title="使用说明"
                description="查看使用说明文字介绍。"
              >
                <div className="dashboard-layout">
                  <section id="guide" className="dashboard-block dashboard-block--wide fade-up scroll-mt-28" style={{ "--delay": "140ms" }}>
                    <div className="p-4 pt-4 md:p-6 md:pt-6">
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

                          <section className="guide-doc-section" aria-labelledby="guide-quick-start">
                            <h2 id="guide-quick-start" className="guide-doc-h2">快速开始</h2>
                            <ol className="guide-doc-steps">
                              <li>进入“任务配置”，先核对设备、应用包名、上午窗口和下午窗口时间。</li>
                              <li>依次执行“一键自检 → 刷新设备状态 → 试运行”，确认链路可用。</li>
                              <li>确认无阻断项后再“启动任务”，避免直接上线导致漏打卡。</li>
                            </ol>
                          </section>

                          <section className="guide-doc-section" aria-labelledby="guide-modules">
                            <h2 id="guide-modules" className="guide-doc-h2">模块联动说明</h2>
                            <ul className="guide-doc-list">
                              <li>
                                <strong>监控总览：</strong>
                                查看当前状态、关键指标和风险提示，适合作为第一观察入口。
                              </li>
                              <li>
                                <strong>任务配置：</strong>
                                维护设备参数、窗口时间和辅助开关，修改后需手动保存。
                              </li>
                              <li>
                                <strong>打卡记录：</strong>
                                核对每次执行结果和时间线，用于还原当天实际动作。
                              </li>
                              <li>
                                <strong>告警日志：</strong>
                                优先定位错误原因，适用于失败重试前的快速诊断。
                              </li>
                              <li>
                                <strong>使用说明：</strong>
                                本模块独立显示说明内容，不参与右侧业务模块联动。
                              </li>
                            </ul>
                          </section>

                          <section className="guide-doc-section" aria-labelledby="guide-scenarios">
                            <h2 id="guide-scenarios" className="guide-doc-h2">高频场景</h2>
                            <div className="guide-doc-grid">
                              <article className="guide-doc-note-card">
                                <h3>首次接入</h3>
                                <p>先完成参数配置，再做一次试运行，确认日志和记录都正常后再启动任务。</p>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>日常巡检</h3>
                                <p>优先查看监控总览和下一次计划，如需调整窗口，保存后立即复查状态。</p>
                              </article>
                              <article className="guide-doc-note-card">
                                <h3>异常恢复</h3>
                                <p>先看告警日志，再看打卡记录与时间线，修复后重新执行自检和试运行。</p>
                              </article>
                            </div>
                          </section>

                          <section className="guide-doc-section" aria-labelledby="guide-troubleshooting">
                            <h2 id="guide-troubleshooting" className="guide-doc-h2">异常排查顺序</h2>
                            <ol className="guide-doc-steps">
                              <li>确认设备连接和 ADB 授权状态是否正常。</li>
                              <li>检查工作日接口和轮询超时参数是否可用。</li>
                              <li>核对上午/下午窗口时间范围与随机时间是否合理。</li>
                              <li>在告警日志中定位错误，再到打卡记录验证影响范围。</li>
                              <li>问题修复后执行“一键自检”和“试运行”确认恢复。</li>
                            </ol>
                          </section>
                        </article>
                    </div>
                  </section>
                </div>
              </RegionSection>
            ) : null}
          </section>
        </main>

        {activeSection !== "guide" ? (
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
    <div className={cn("rounded-xl border bg-background p-3", className)}>
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

function FocusStrip({ focus }) {
  const tone = toneClasses(focus.tone);
  return (
    <Card className={cn("overflow-hidden", tone.panel)}>
      <CardContent className="space-y-4 p-5">
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

        <div className="flex flex-wrap gap-2">
          {focus.chips.map((chip) => (
            <div key={chip} className={cn("rounded-md px-3 py-1.5 text-sm", tone.soft)}>
              {chip}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
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

function SidebarNav({ collapsed, activeSection, onNavClick }) {
  const guideNavItem = navItems.find((item) => item.id === "guide");
  const primaryNavItems = navItems.filter((item) => item.id !== "guide");

  const renderNavItem = (item, className = "") => {
    const Icon = item.icon;
    const isGuideItem = item.id === "guide";
    return (
      <a
        key={item.id}
        href={`#${item.id}`}
        data-sidebar-item="true"
        data-sidebar-icon-animate={isGuideItem ? "false" : "true"}
        data-guide-item={isGuideItem ? "true" : "false"}
        data-guide-active={isGuideItem && activeSection === item.id ? "true" : "false"}
        data-sidebar-cursor-block="true"
        title={item.label}
        aria-label={item.label}
        className={cn(
          "flex h-10 w-full items-center gap-2 overflow-hidden rounded-md border px-2 text-sm leading-6 transition-[width,padding,gap,background-color,color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed && "lg:h-10 lg:w-[var(--sidebar-inner-size)] lg:justify-center lg:px-0 lg:gap-0",
          isGuideItem
            ? activeSection === item.id
              ? "border-transparent bg-transparent text-black dark:text-white hover:border-transparent hover:bg-transparent hover:text-black dark:hover:text-white"
              : "border-transparent text-muted-foreground hover:border-transparent hover:bg-transparent"
            : activeSection === item.id
              ? "border-border bg-accent text-accent-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
          className,
        )}
        onClick={(event) => onNavClick(event, item.id)}
      >
        <Icon className="size-4.5 shrink-0" data-guide-hotspot={isGuideItem ? "true" : undefined} />
        <span
          data-guide-hotspot={isGuideItem ? "true" : undefined}
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

  return (
    <nav
      className={cn(
        "fade-up flex h-full min-h-0 flex-col",
        collapsed && "lg:items-center",
      )}
      style={{ "--delay": "100ms" }}
    >
      <div className={cn("space-y-4", collapsed && "lg:flex lg:w-full lg:flex-col lg:items-center")}>
        {primaryNavItems.map((item) => renderNavItem(item))}
      </div>

      {guideNavItem ? (
        <div className={cn("mt-auto w-full border-t border-border/70 pt-4", collapsed && "lg:flex lg:justify-center")}>
          {renderNavItem(guideNavItem)}
        </div>
      ) : null}
    </nav>
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

function RegionSection({ title, description, children }) {
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
    <section className="space-y-6" data-region-title={title} data-region-tone={tone} aria-label={description}>
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
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

function SummaryRow({ label, value, emphasized = false }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 px-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("max-w-[60%] text-right text-sm text-muted-foreground", emphasized && "font-medium text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function MetricCard({ item, delay }) {
  const tone = statusTone(item.value);
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
            <Badge variant={tone} className="rounded-md px-2 py-0 text-xs">
              {toneLabel(tone)}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{item.note}</p>
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
    <label className="space-y-2.5">
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
    <label className="flex flex-col gap-2.5">
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
          {log.time}
        </Badge>
        <div className="space-y-1.5">
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
      <div className="pb-5">
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
        <div className="space-y-1.5">
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
