import {
  Activity,
  AlarmClockCheck,
  BadgeCheck,
  BellRing,
  Bot,
  Bug,
  CalendarRange,
  CheckCheck,
  CirclePlay,
  Clock3,
  Cog,
  FileClock,
  FolderCog,
  Gauge,
  ListChecks,
  Menu,
  MoonStar,
  Play,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  SquareTerminal,
  Stethoscope,
  SunMedium,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { SplitText as GSAPSplitText } from "gsap/SplitText";
import { toast } from "sonner";

import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Separator } from "./components/ui/separator";
import { cn } from "./lib/utils";

gsap.registerPlugin(GSAPSplitText);

const navItems = [
  { id: "overview", label: "监控总览", icon: Gauge },
  { id: "actions", label: "任务配置", icon: FolderCog },
  { id: "logs", label: "告警日志", icon: BellRing },
];

const priorities = [
  {
    title: "建议先处理",
    value: "先确认下午窗口，再决定是否试运行",
    note: "减少在错误时间窗口内触发动作的风险。",
    icon: CheckCheck,
  },
  {
    title: "当前风险",
    value: "工作日接口依赖在线",
    note: "接口异常会直接影响任务判断，属于优先关注项。",
    icon: TriangleAlert,
  },
  {
    title: "最近变更",
    value: "轮询间隔 30 秒",
    note: "高频配置刚改过，保存后应立即自检。",
    icon: BellRing,
  },
];

const quickChecklist = [
  "先看设备是否已连接且 ADB 已授权",
  "再核对今日上午 / 下午随机执行时间",
  "最后执行自检或试运行，不要直接启动",
];

const configGroups = [
  {
    title: "设备与应用",
    description: "先配置识别对象，再校验状态文件落点。",
    fields: [
      { label: "设备序列号 serial", value: "emulator-5554", helper: "用于绑定具体 ADB 设备" },
      { label: "应用包名 package", value: "com.alibaba.android.rimet" },
      { label: "应用名称 app_label", value: "钉钉" },
      { label: "状态文件路径 state_file", value: "./runtime/state.json" },
    ],
  },
  {
    title: "调度与服务",
    description: "控制节奏、工作日判断与接口容错。",
    fields: [
      { label: "启动后停留时长", value: "4 秒" },
      { label: "轮询间隔 poll_interval", value: "30 秒", helper: "建议设置下限保护，避免过高轮询" },
      { label: "工作日接口地址", value: "https://holiday.dreace.top?date=YYYY-MM-DD" },
      { label: "接口超时时间", value: "3000 ms" },
    ],
  },
];

const toggles = [
  "scrcpy 观察模式 已开启",
  "成功通知 已开启",
  "工作日校验 已开启",
];

const windowsData = [
  {
    title: "上午窗口",
    note: "系统会在这个区间内随机抽取一个执行时刻。",
    start: "08:35",
    end: "08:55",
    selected: "08:43:00",
    completed: "2026-04-09",
  },
  {
    title: "下午窗口",
    note: "随机逻辑与上午一致，支持独立控制。",
    start: "18:05",
    end: "18:30",
    selected: "18:17:00",
    completed: "2026-04-09",
  },
];

const actions = [
  { label: "一键自检", style: "default", icon: Stethoscope },
  { label: "查看排期", style: "secondary", icon: FileClock },
  { label: "刷新设备状态", style: "secondary", icon: RefreshCw },
  { label: "启动任务", style: "secondary", icon: Play },
  { label: "停止任务", style: "ghost", icon: CirclePlay },
  { label: "调试模式", style: "secondary", icon: Bug },
  { label: "试运行一次", style: "secondary", icon: Bot },
];

const statusTags = ["任务 运行中", "scrcpy 运行中", "今天是工作日"];

const logs = [
  {
    time: "08:43",
    title: "上午自动打卡执行完成",
    detail: "启动应用 > 进入工作台 > 完成打卡 > 发送通知",
    status: "成功",
  },
  {
    time: "07:58",
    title: "工作日接口检查",
    detail: "GET /workday 返回 true，响应耗时 182ms",
    status: "成功",
  },
  {
    time: "昨天 18:09",
    title: "下午自动打卡执行完成",
    detail: "随机窗口命中 18:17，动作链路整体正常",
    status: "成功",
  },
  {
    time: "昨天 07:30",
    title: "ADB 授权提醒",
    detail: "检测到设备重新连接，授权状态恢复正常",
    status: "已处理",
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

const timeline = [
  "07:58 工作日校验通过",
  "08:43 上午随机执行完成",
  "17:50 设备状态复检正常",
  "18:17 下午随机计划待执行",
];

const initialConfigState = Object.fromEntries(
  configGroups.flatMap((group) => group.fields.map((field) => [field.label, field.value])),
);

const initialWindowState = Object.fromEntries(
  windowsData.flatMap((item) => [
    [`${item.title}-start`, item.start],
    [`${item.title}-end`, item.end],
    [`${item.title}-selected`, item.selected],
    [`${item.title}-custom`, item.selected],
    [`${item.title}-completed`, item.completed],
  ]),
);

function statusTone(value) {
  if (/(成功|已连接|已授权|已校验|运行中|工作日|已同步)/.test(value)) return "success";
  if (/(提醒|未保存|处理中|待执行|试运行|重新抽取|风险)/.test(value)) return "warning";
  return "secondary";
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
  const [activeSection, setActiveSection] = useState("overview");
  const [topbarTitle, setTopbarTitle] = useState("DingTalk Dashboard");
  const [topbarTone, setTopbarTone] = useState("brand");
  const [pendingAction, setPendingAction] = useState("");
  const [configValues, setConfigValues] = useState(initialConfigState);
  const [savedConfigValues, setSavedConfigValues] = useState(initialConfigState);
  const [windowValues, setWindowValues] = useState(initialWindowState);
  const [savedWindowValues, setSavedWindowValues] = useState(initialWindowState);

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
        "试运行一次",
        "重新抽取",
      ]),
    [],
  );

  const scheduleSummary = useMemo(
    () => `${windowValues["上午窗口-selected"]} / ${windowValues["下午窗口-selected"]}`,
    [windowValues],
  );

  const metrics = useMemo(
    () => [
      {
        label: "当前任务状态",
        value: "运行中",
        note: "调度器已激活，等待下一个随机时间",
        icon: Activity,
      },
      {
        label: "设备状态",
        value: "已连接",
        note: "serial: emulator-5554",
        icon: Smartphone,
      },
      {
        label: "下一次上午执行",
        value: windowValues["上午窗口-selected"],
        note: "默认按时间范围抽取，也可以手动精确指定到秒。",
        icon: AlarmClockCheck,
      },
      {
        label: "最近成功执行",
        value: "昨天 18:09",
        note: "最近一次工作日校验正常",
        icon: BadgeCheck,
      },
    ],
    [windowValues],
  );

  const statusRows = useMemo(
    () => [
      ["设备状态", "已连接 / 已授权", true],
      ["上午下一次执行时间", `2026-04-10 ${windowValues["上午窗口-selected"]}`],
      ["下午下一次执行时间", `2026-04-10 ${windowValues["下午窗口-selected"]}`],
      ["最近一次成功执行时间", "2026-04-09 18:09"],
      ["最近一次工作日校验结果", "HTTP 200 / true"],
    ],
    [windowValues],
  );

  const dirtyCount = useMemo(() => {
    const configDirty = Object.keys(configValues).filter(
      (key) => configValues[key] !== savedConfigValues[key],
    ).length;
    const windowDirty = Object.keys(windowValues).filter(
      (key) => windowValues[key] !== savedWindowValues[key],
    ).length;
    return configDirty + windowDirty;
  }, [configValues, savedConfigValues, windowValues, savedWindowValues]);

  const validation = useMemo(() => {
    const next = {};
    const add = (key, message) => {
      next[key] = message;
    };

    if (!String(configValues["设备序列号 serial"] || "").trim()) {
      add("设备序列号 serial", "设备序列号不能为空。");
    }
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
    if (pollInterval === null || pollInterval < 15) {
      add("轮询间隔 poll_interval", "轮询间隔建议不低于 15 秒。");
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

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("console-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) return undefined;

    const root = document.documentElement;
    root.classList.add("cursor-effect-enabled");

    const cursor = document.createElement("div");
    cursor.className = "custom-cursor custom-cursor--hidden";
    document.body.appendChild(cursor);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const particleCanvas = reduceMotion ? null : document.createElement("canvas");
    const particleCtx = particleCanvas?.getContext("2d");
    const particleColor = theme === "dark" ? "232,228,222" : "32,36,44";

    if (particleCanvas && particleCtx) {
      particleCanvas.className = "custom-cursor-particles";
      document.body.appendChild(particleCanvas);
    }

    let currentX = -100;
    let currentY = -100;
    let targetX = -100;
    let targetY = -100;
    let prevTargetX = -100;
    let prevTargetY = -100;
    let pointerSpeed = 0;
    let cursorRaf = 0;
    let particleRaf = 0;

    const hoverSelector =
      'a, button, [role="button"], input[type="submit"], input[type="button"], .nav__toggle, [data-cursor-hover]';

    const onMouseMove = (event) => {
      prevTargetX = targetX;
      prevTargetY = targetY;
      targetX = event.clientX;
      targetY = event.clientY;
      pointerSpeed = Math.hypot(targetX - prevTargetX, targetY - prevTargetY);
      cursor.classList.remove("custom-cursor--hidden");
    };

    const onPointerMove = (event) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      targetX = event.clientX;
      targetY = event.clientY;
    };

    const onMouseLeave = () => {
      cursor.classList.add("custom-cursor--hidden");
      targetX = -100;
      targetY = -100;
      pointerSpeed = 0;
    };

    const onMouseEnter = () => {
      cursor.classList.remove("custom-cursor--hidden");
    };

    const onMouseOver = (event) => {
      if (event.target instanceof Element && event.target.closest(hoverSelector)) {
        cursor.classList.add("custom-cursor--hover");
      }
    };

    const onMouseOut = (event) => {
      if (event.target instanceof Element && event.target.closest(hoverSelector)) {
        cursor.classList.remove("custom-cursor--hover");
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("mouseenter", onMouseEnter);
    document.addEventListener("mouseover", onMouseOver);
    document.addEventListener("mouseout", onMouseOut);

    const animateCursor = () => {
      currentX += (targetX - currentX) * 0.15;
      currentY += (targetY - currentY) * 0.15;
      cursor.style.transform = `translate(${currentX}px, ${currentY}px) translate(-50%, -50%)`;
      cursorRaf = window.requestAnimationFrame(animateCursor);
    };

    animateCursor();

    let particles = [];
    const revealRadius = 180;
    const repulseRadius = 140;
    const repulseForce = 4.6;
    const returnForce = 0.005;
    const friction = 0.88;
    const spacing = 44;
    const dotSize = 1.1;
    const connectRadius = 52;

    const seedParticles = (width, height) => {
      particles = [];
      const cols = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const homeX = col * spacing + (Math.random() - 0.5) * spacing * 0.6;
          const homeY = row * spacing + (Math.random() - 0.5) * spacing * 0.6;
          particles.push({
            homeX,
            homeY,
            x: homeX,
            y: homeY,
            vx: 0,
            vy: 0,
            alpha: 0,
          });
        }
      }
    };

    let canvasWidth = 0;
    let canvasHeight = 0;
    const onResize = () => {
      if (!particleCanvas || !particleCtx) return;
      canvasWidth = particleCanvas.width = window.innerWidth;
      canvasHeight = particleCanvas.height = window.innerHeight;
      seedParticles(canvasWidth, canvasHeight);
    };

    const animateParticles = () => {
      if (!particleCanvas || !particleCtx) return;
      particleCtx.clearRect(0, 0, canvasWidth, canvasHeight);

      pointerSpeed *= 0.92;
      const isMoving = pointerSpeed > 1.5;
      const visible = [];

      for (const particle of particles) {
        const dx = particle.x - targetX;
        const dy = particle.y - targetY;
        const distance = Math.hypot(dx, dy);
        const nearCursor = distance < revealRadius * 1.3;
        const hasVelocity = Math.abs(particle.vx) > 0.06 || Math.abs(particle.vy) > 0.06;

        if (!nearCursor && !hasVelocity && particle.alpha < 0.005) continue;

        const targetAlpha =
          isMoving && nearCursor ? Math.max(0, (1 - distance / revealRadius)) * 0.58 : 0;
        particle.alpha += (targetAlpha - particle.alpha) * (targetAlpha > particle.alpha ? 0.12 : 0.05);

        if (isMoving && distance < repulseRadius && distance > 0) {
          const force = (1 - distance / repulseRadius) * repulseForce;
          particle.vx += (dx / distance) * force;
          particle.vy += (dy / distance) * force;
          particle.vx += (Math.random() - 0.5) * 0.8;
          particle.vy += (Math.random() - 0.5) * 0.8;
        }

        particle.vx += (particle.homeX - particle.x) * returnForce;
        particle.vy += (particle.homeY - particle.y) * returnForce;
        particle.vx *= friction;
        particle.vy *= friction;
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.alpha > 0.008) {
          particleCtx.beginPath();
          particleCtx.arc(particle.x, particle.y, dotSize, 0, Math.PI * 2);
          particleCtx.fillStyle = `rgba(${particleColor},${particle.alpha.toFixed(3)})`;
          particleCtx.fill();
          visible.push(particle);
        }
      }

      particleCtx.lineWidth = 0.3;
      for (let i = 0; i < visible.length; i += 1) {
        for (let j = i + 1; j < visible.length; j += 1) {
          const a = visible[i];
          const b = visible[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < connectRadius * connectRadius) {
            const distance = Math.sqrt(distanceSquared);
            const alpha = (1 - distance / connectRadius) * Math.min(a.alpha, b.alpha) * 0.12;
            particleCtx.beginPath();
            particleCtx.moveTo(a.x, a.y);
            particleCtx.lineTo(b.x, b.y);
            particleCtx.strokeStyle = `rgba(${particleColor},${alpha.toFixed(3)})`;
            particleCtx.stroke();
          }
        }
      }

      particleRaf = window.requestAnimationFrame(animateParticles);
    };

    if (particleCanvas && particleCtx) {
      onResize();
      window.addEventListener("resize", onResize);
      animateParticles();
    }

    return () => {
      window.cancelAnimationFrame(cursorRaf);
      window.cancelAnimationFrame(particleRaf);

      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("mouseenter", onMouseEnter);
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseout", onMouseOut);
      window.removeEventListener("resize", onResize);

      cursor.remove();
      particleCanvas?.remove();
      root.classList.remove("cursor-effect-enabled");
    };
  }, [theme]);

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
    const syncTopbarTitle = () => {
      const regions = Array.from(document.querySelectorAll("[data-region-title]"));
      const threshold = 120;
      let nextTitle = "DingTalk Dashboard";
      let nextTone = "brand";

      for (const region of regions) {
        const rect = region.getBoundingClientRect();
        if (rect.top <= threshold) {
          nextTitle = region.getAttribute("data-region-title") || "DingTalk Dashboard";
          nextTone = region.getAttribute("data-region-tone") || "brand";
        }
      }

      setTopbarTitle((current) => (current === nextTitle ? current : nextTitle));
      setTopbarTone((current) => (current === nextTone ? current : nextTone));
    };

    syncTopbarTitle();
    window.addEventListener("scroll", syncTopbarTitle, { passive: true });
    window.addEventListener("resize", syncTopbarTitle);

    return () => {
      window.removeEventListener("scroll", syncTopbarTitle);
      window.removeEventListener("resize", syncTopbarTitle);
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

    if (id !== "overview") return;

    event.preventDefault();
    setActiveSection("overview");
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };

  const isConfigFieldDirty = (label) => configValues[label] !== savedConfigValues[label];
  const isWindowFieldDirty = (title, key) =>
    windowValues[`${title}-${key}`] !== savedWindowValues[`${title}-${key}`];

  const handleAction = (label) => {
    if (!quickActionSet.has(label)) return;

    if ((label === "保存配置" || label === "启动任务") && hasBlockingIssues) {
      toast.warning("请先修复阻断问题", {
        description: `当前还有 ${validationIssues.length} 项校验问题，修复后才能继续保存或启动任务。`,
      });
      return;
    }

    setPendingAction(label);

    if (label === "保存配置") {
      window.setTimeout(() => {
        const nextWindowValues = windowsData.reduce((current, item) => {
          const customKey = `${item.title}-custom`;
          const selectedKey = `${item.title}-selected`;
          return {
            ...current,
            [selectedKey]: current[customKey],
          };
        }, windowValues);

        setSavedConfigValues(configValues);
        setWindowValues(nextWindowValues);
        setSavedWindowValues(nextWindowValues);
        toast.success("配置已保存", {
          description: `下一次打卡时间已更新为 上午 ${nextWindowValues["上午窗口-selected"]}，下午 ${nextWindowValues["下午窗口-selected"]}。`,
        });
      }, 320);
    } else if (label === "重新抽取") {
      setWindowValues((current) => ({
        ...current,
        "上午窗口-selected": "08:47:00",
        "上午窗口-custom": "08:47:00",
        "下午窗口-selected": "18:12:00",
        "下午窗口-custom": "18:12:00",
      }));
      toast("今日计划已重新抽取", {
        description: "上午调整为 08:47:00，下午调整为 18:12:00。请确认窗口范围是否仍然合理。",
      });
    } else {
      if (label === "查看排期") {
        document.getElementById("windows")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      const messages = {
        启动任务: ["success", "任务已加入执行队列", "当前为前端模拟反馈，后续可以直接接入 run 命令。"],
        自检: ["success", "环境自检已完成", "ADB、设备连接和工作日接口状态均已通过本地模拟校验。"],
        一键自检: ["success", "环境自检已完成", "ADB、设备连接和工作日接口状态均已通过本地模拟校验。"],
        查看排期: ["success", "已定位到排期设置", "你可以直接修改时间窗口或手动指定下一次打卡时间。"],
        刷新设备状态: ["success", "设备状态已刷新", "当前设备已连接，授权状态正常，可继续执行任务。"],
        停止任务: ["warning", "停止任务指令已受理", "当前为前端模拟反馈，后续可接入 stop 命令或进程控制。"],
        调试模式: ["warning", "调试模式已触发", "当前为前端模拟反馈，后续可接入 debug 命令。"],
        试运行一次: ["warning", "试运行已触发", "建议先确认下午窗口，再观察本次动作日志是否符合预期。"],
      };
      const [type, title, detail] = messages[label] ?? [
        "default",
        `${label} 已处理`,
        "当前为前端交互原型反馈，可在下一步接入真实命令执行。",
      ];
      if (type === "success") {
        toast.success(title, { description: detail });
      } else if (type === "warning") {
        toast.warning(title, { description: detail });
      } else {
        toast(title, { description: detail });
      }
    }

    window.setTimeout(() => {
      setPendingAction((current) => (current === label ? "" : current));
    }, 900);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="surface-grid pointer-events-none fixed inset-0 opacity-60 dark:opacity-40" />

      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/30 backdrop-blur-sm transition-opacity lg:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!mobileNavOpen}
        onClick={() => setMobileNavOpen(false)}
      />

      <div className="mx-auto min-h-screen max-w-[1600px] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
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
          className={cn(
            "sidebar-scrollbar fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col overflow-y-auto border-r bg-background/95 px-4 py-4 backdrop-blur transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="space-y-6">
            <LogoRegion />
            <SidebarNav activeSection={activeSection} onNavClick={handleNavClick} />
            <SidebarSummaryCard scheduleSummary={scheduleSummary} />
          </div>

          <div className="mt-auto space-y-3 pt-6">
            <div className="fade-up space-y-1 text-xs text-muted-foreground" style={{ "--delay": "260ms" }}>
              <p>版本 v0.4.0</p>
              <p>{theme === "light" ? "shadcn/ui · Light" : "shadcn/ui · Dark"}</p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 px-4 pb-28 pt-4 sm:px-6 lg:px-8 lg:pt-4 lg:pb-8">
          <TopbarRegion
            title={topbarTitle}
            tone={topbarTone}
            theme={theme}
            pendingAction={pendingAction}
            hasBlockingIssues={hasBlockingIssues}
            onAction={handleAction}
            onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
          />

          <section className="content-region mt-6 space-y-10 xl:space-y-12">
            <RegionSection
              title="监控总览与执行态势"
              description="用于查看系统状态、关键指标和执行判断。"
            >
              <section id="overview" className="fade-up scroll-mt-28" style={{ "--delay": "60ms" }}>
                <Card className="overflow-hidden">
                  <CardContent className="space-y-6 pt-6">
                    {hasBlockingIssues ? (
                      <Card className="border-red-200 bg-red-50/80 dark:border-red-900/40 dark:bg-red-950/20">
                        <CardHeader className="pb-4">
                          <div className="flex flex-wrap items-center gap-3">
                            <Badge variant="destructive">阻断项 {validationIssues.length}</Badge>
                            <CardTitle className="text-sm">保存与启动前需要先修复以下问题</CardTitle>
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

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {metrics.map((item, index) => (
                        <MetricCard key={item.label} item={item} delay={`${120 + index * 60}ms`} />
                      ))}
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                      <Card className="bg-muted/20">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">现在最该看的信息</CardTitle>
                          <CardDescription>只保留当前决策必需的信息。</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {priorities.map((item) => (
                            <DecisionRow key={item.title} item={item} />
                          ))}
                        </CardContent>
                      </Card>

                      <Card className="bg-muted/20">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">推荐操作路径</CardTitle>
                          <CardDescription>按顺序处理更稳妥。</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {quickChecklist.map((item, index) => (
                            <div key={item} className="flex items-start gap-3 rounded-lg border bg-background px-3 py-3 text-sm">
                              <Badge variant="outline" className="mt-0.5 rounded-md">
                                {index + 1}
                              </Badge>
                              <p className="leading-5 text-muted-foreground">{item}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div />
                <div className="space-y-6">
                  <section className="fade-up" style={{ "--delay": "180ms" }}>
                    <Card>
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                        <CardTitle>运行状态</CardTitle>
                        <CardDescription>先判断当前能不能执行。</CardDescription>
                      </div>
                    </CardHeader>
                      <CardContent className="space-y-4 pt-6">
                        <div className="flex flex-wrap gap-2">
                          {statusTags.map((item) => (
                            <Badge key={item} variant={statusTone(item)} className="rounded-md">
                              {item}
                            </Badge>
                          ))}
                        </div>
                        <div className="space-y-3">
                          {statusRows.map(([label, value, emphasized]) => (
                            <SummaryRow key={label} label={label} value={value} emphasized={emphasized} />
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                </div>
              </div>
            </RegionSection>

            <RegionSection
              title="任务配置与排期管理"
              description="集中管理动作、排期和关键参数。"
            >
              <div className="space-y-6">
                <section id="actions" className="fade-up scroll-mt-28" style={{ "--delay": "160ms" }}>
                  <Card>
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                        <CardTitle>快捷动作</CardTitle>
                        <CardDescription>优先处理高频动作。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-6">
                      <div className="flex flex-wrap gap-2">
                        {actions.map((item, index) => (
                          <ActionButton
                            key={item.label}
                            variant={item.style}
                            icon={item.icon}
                            className="fade-up"
                            style={{ "--delay": `${220 + index * 40}ms` }}
                            isPending={pendingAction === item.label}
                            onClick={() => handleAction(item.label)}
                          >
                            {item.label}
                          </ActionButton>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                        <SquareTerminal className="size-4 shrink-0" />
                        <p>推荐顺序：保存配置后先自检，再刷新设备状态，确认无误后试运行。</p>
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section id="windows" className="fade-up scroll-mt-28" style={{ "--delay": "220ms" }}>
                  <Card>
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                        <CardTitle>排期设置</CardTitle>
                        <CardDescription>看时间、改时间、重抽时间。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-6">
                      <div className="grid gap-3 lg:grid-cols-3">
                        <MiniPanel title="今日下一次计划" value={scheduleSummary} detail="默认按时间窗口抽取，也支持手动精确指定到秒。" />
                        <MiniPanel title="最近完成日期" value="2026-04-09" detail="两个窗口都已正常落库。" />
                        <div className="rounded-xl border bg-muted/30 p-4">
                          <div className="flex h-full flex-col justify-center gap-2">
                            <ActionButton
                              variant="default"
                              icon={RefreshCw}
                              isPending={pendingAction === "重新抽取"}
                              onClick={() => handleAction("重新抽取")}
                            >
                              重新抽取
                            </ActionButton>
                            <Button variant="ghost" onClick={handleRestoreDefaults}>
                              恢复默认
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        {windowsData.map((item, index) => (
                          <Card
                            key={item.title}
                            className="fade-up card-hover bg-muted/20"
                            style={{ "--delay": `${260 + index * 60}ms` }}
                          >
                            <CardHeader>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex flex-col gap-1">
                                  <CardTitle>{item.title}</CardTitle>
                                  <CardDescription>{item.note}</CardDescription>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Field
                                  label="开始时间"
                                  value={windowValues[`${item.title}-start`]}
                                  onChange={(event) => handleWindowChange(item.title, "start", event.target.value)}
                                  dirty={isWindowFieldDirty(item.title, "start")}
                                  error={validation[`${item.title}-start`]}
                                />
                                <Field
                                  label="结束时间"
                                  value={windowValues[`${item.title}-end`]}
                                  onChange={(event) => handleWindowChange(item.title, "end", event.target.value)}
                                  dirty={isWindowFieldDirty(item.title, "end")}
                                  error={validation[`${item.title}-end`]}
                                />
                              </div>
                              <Separator />
                              <div className="rounded-xl border bg-background p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex flex-col gap-1">
                                    <p className="text-sm font-semibold text-foreground">手动指定下一次执行</p>
                                    <p className="text-xs leading-5 text-muted-foreground">
                                      使用 Time Picker 精确到秒。保存配置后会覆盖当前下一次执行时间。
                                    </p>
                                  </div>
                                </div>
                                <div className="mt-4 flex flex-col gap-3">
                                  <TimePickerField
                                    label="指定下一次打卡时间"
                                    value={windowValues[`${item.title}-custom`]}
                                    onChange={(event) => handleWindowChange(item.title, "custom", event.target.value)}
                                    dirty={isWindowFieldDirty(item.title, "custom")}
                                    error={validation[`${item.title}-custom`]}
                                  />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <SummaryRow label="保存后生效时间" value={windowValues[`${item.title}-custom`]} emphasized />
                                    <SummaryRow label="当前下一次执行" value={windowValues[`${item.title}-selected`]} />
                                  </div>
                                </div>
                              </div>
                              <SummaryRow label="最近完成日期" value={windowValues[`${item.title}-completed`]} />
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </section>

                <section id="config" className="fade-up scroll-mt-28" style={{ "--delay": "280ms" }}>
                  <Card>
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                        <CardTitle>基础参数</CardTitle>
                        <CardDescription>低频参数集中放在这里。</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-6">
                      <div className="grid gap-4 lg:grid-cols-2">
                        {configGroups.map((group) => (
                          <Card key={group.title} className="bg-muted/20">
                            <CardHeader>
                              <CardTitle>{group.title}</CardTitle>
                              <CardDescription>{group.description}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
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
                            </CardContent>
                          </Card>
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
              title="告警日志与通知中心"
              description="统一查看提醒、告警和执行日志。"
            >
              <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
                <div className="space-y-6">
                  <section className="fade-up" style={{ "--delay": "220ms" }}>
                    <Card>
                    <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1.5">
                          <CardTitle>提醒</CardTitle>
                          <CardDescription>先处理风险项。</CardDescription>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-6">
                        <AlertRow
                          icon={TriangleAlert}
                          title="工作日接口依赖在线"
                          detail="如果接口连续超时，建议临时关闭工作日校验，并在保存后执行自检。"
                        />
                        <AlertRow
                          icon={BellRing}
                          title="关键配置修改需二次确认"
                          detail="serial、package、state_file 变更会影响执行链路，建议在保存前复核。"
                        />
                        <AlertRow
                          icon={ListChecks}
                          title="建议先做自检再试运行"
                          detail="先检查设备状态和权限，再触发单次动作，能减少误报。"
                        />
                      </CardContent>
                    </Card>
                  </section>

                </div>

                <div className="space-y-6">
                  <section id="logs" className="fade-up scroll-mt-28" style={{ "--delay": "260ms" }}>
                    <Card>
                      <CardHeader>
                        <CardTitle>日志</CardTitle>
                        <CardDescription>只看最近动作和结果。</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {logs.map((log) => (
                          <Card key={`${log.time}-${log.title}`} className="card-hover bg-muted/20">
                            <CardContent className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                              <Badge variant="outline" className="rounded-md">
                                {log.time}
                              </Badge>
                              <div className="space-y-1">
                                <p className="text-sm font-semibold">{log.title}</p>
                                <p className="text-sm leading-6 text-muted-foreground">{log.detail}</p>
                              </div>
                              <Badge variant={statusTone(log.status)} className="rounded-md">
                                {log.status}
                              </Badge>
                            </CardContent>
                          </Card>
                        ))}
                      </CardContent>
                    </Card>
                  </section>

                  <section className="fade-up" style={{ "--delay": "300ms" }}>
                    <Card>
                      <CardHeader>
                        <CardTitle>时间线</CardTitle>
                        <CardDescription>快速回看今天发生了什么。</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {timeline.map((item, index) => (
                          <div key={item}>
                            <div className="flex items-start gap-3 text-sm">
                              <Badge variant="outline" className="rounded-md">
                                {index + 1}
                              </Badge>
                              <p className={cn("leading-6 text-muted-foreground", index === 1 && "font-medium text-foreground")}>
                                {item}
                              </p>
                            </div>
                            {index < timeline.length - 1 ? <Separator className="mt-3" /> : null}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </section>

                  <section id="guards" className="fade-up scroll-mt-28" style={{ "--delay": "340ms" }}>
                    <Card>
                      <CardHeader>
                        <CardTitle>保护规则</CardTitle>
                        <CardDescription>保存前再看这一组。</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {guards.map(([label, value, emphasized], index) => (
                          <div key={label} className="space-y-4">
                            <SummaryRow label={label} value={value} emphasized={emphasized} />
                            {index < guards.length - 1 ? <Separator /> : null}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </section>
                </div>
              </div>
            </RegionSection>
          </section>
        </main>

        <div className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <ActionButton
            variant="ghost"
            icon={Stethoscope}
            className="w-full"
            isPending={pendingAction === "自检"}
            onClick={() => handleAction("自检")}
          >
            自检
          </ActionButton>
          <ActionButton
            variant="secondary"
            icon={RefreshCw}
            className="w-full"
            isPending={pendingAction === "刷新设备状态"}
            onClick={() => handleAction("刷新设备状态")}
          >
            刷新
          </ActionButton>
          <ActionButton
            variant="default"
            icon={Play}
            className="w-full"
            isPending={pendingAction === "启动任务"}
            disabled={hasBlockingIssues}
            onClick={() => handleAction("启动任务")}
          >
            启动
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, children, isPending = false, className, size, ...props }) {
  return (
    <Button size={size} className={cn("gap-2", className)} {...props}>
      <Icon className={cn(isPending && "animate-spin")} />
      <span>{isPending ? "处理中" : children}</span>
    </Button>
  );
}

function LogoRegion() {
  return (
    <div className="fade-up" style={{ "--delay": "40ms" }}>
      <div className="toolbar-surface flex h-16 items-center gap-3 px-4">
        <div className="flex size-9 items-center justify-center rounded-md border bg-background">
          <Bot className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">DingTalk</h2>
        </div>
      </div>
    </div>
  );
}

function SidebarNav({ activeSection, onNavClick }) {
  return (
    <nav className="fade-up space-y-1.5" style={{ "--delay": "100ms" }}>
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={cn(
              "flex h-10 items-center gap-3 rounded-md border px-3 text-sm transition-colors",
              activeSection === item.id
                ? "border-border bg-accent text-accent-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground",
            )}
            onClick={(event) => onNavClick(event, item.id)}
          >
            <Icon className="size-4" />
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function SidebarSummaryCard({ scheduleSummary }) {
  return (
    <Card className="fade-up" style={{ "--delay": "160ms" }}>
      <CardHeader className="pb-4">
        <CardTitle className="text-sm">今日概览</CardTitle>
        <CardDescription>优先看状态和执行窗口</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
        : title === "告警日志与通知中心"
          ? "notify"
          : "brand";

  return (
    <section className="space-y-5" data-region-title={title} data-region-tone={tone}>
      <div className="flex items-end justify-between gap-4 border-b pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="hidden h-px min-w-16 flex-1 bg-border xl:block" aria-hidden="true" />
      </div>
      {children}
    </section>
  );
}

function TopbarRegion({ title, tone, theme, pendingAction, hasBlockingIssues, onAction, onToggleTheme }) {
  const titleRef = useRef(null);

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
      { yPercent: 120, opacity: 0, rotateX: -45 },
      {
        yPercent: 0,
        opacity: 1,
        rotateX: 0,
        duration: 0.44,
        ease: "power3.out",
        stagger: 0.018,
        clearProps: "transform,opacity",
      },
    );

    return () => {
      tween.kill();
      split?.revert();
    };
  }, [title]);

  return (
    <section className="topbar-region sticky top-4 z-10">
      <div className="toolbar-surface flex min-h-16 flex-col gap-3 px-4 py-3 xl:h-16 xl:min-h-0 xl:flex-row xl:items-center xl:justify-between xl:gap-4 xl:py-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
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

        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            variant="default"
            icon={Cog}
            size="sm"
            isPending={pendingAction === "保存配置"}
            disabled={hasBlockingIssues}
            onClick={() => onAction("保存配置")}
          >
            保存配置
          </ActionButton>
          <ActionButton
            variant="secondary"
            icon={Play}
            size="sm"
            isPending={pendingAction === "启动任务"}
            disabled={hasBlockingIssues}
            onClick={() => onAction("启动任务")}
          >
            启动任务
          </ActionButton>
          <ActionButton
            variant="ghost"
            icon={Stethoscope}
            size="sm"
            isPending={pendingAction === "自检"}
            onClick={() => onAction("自检")}
          >
            自检
          </ActionButton>
          <Button variant="outline" size="sm" className="gap-2" onClick={onToggleTheme}>
            {theme === "light" ? <MoonStar /> : <SunMedium />}
            <span>{theme === "light" ? "深色模式" : "浅色模式"}</span>
          </Button>
        </div>
      </div>
    </section>
  );
}

function SummaryRow({ label, value, emphasized = false }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 px-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("max-w-[60%] text-right text-sm text-muted-foreground", emphasized && "font-medium text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function MetricCard({ item, delay }) {
  const tone = statusTone(item.value);
  return (
    <Card className="fade-up card-hover bg-muted/20" style={{ "--delay": delay }}>
      <CardContent className="space-y-3 p-4">
        <div className="flex size-9 items-center justify-center rounded-md border bg-background">
          <item.icon className="size-3.5" />
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{item.label}</p>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold tracking-tight">{item.value}</h3>
            <Badge variant={tone} className="rounded-md px-2 py-0 text-[11px]">
              {tone === "success" ? "正常" : tone === "warning" ? "关注" : "信息"}
            </Badge>
          </div>
          <p className="text-sm leading-5 text-muted-foreground">{item.note}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionRow({ item }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background px-3 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
        <item.icon className="size-4" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{item.title}</p>
        <p className="text-sm font-semibold leading-5 text-foreground">{item.value}</p>
        <p className="text-sm leading-5 text-muted-foreground">{item.note}</p>
      </div>
    </div>
  );
}

function Field({ label, dirty, error, helper, ...props }) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {dirty ? (
          <Badge variant="outline" className="rounded-md text-[11px]">
            已修改
          </Badge>
        ) : null}
      </div>
      <Input
        className={cn(
          dirty && "border-zinc-400 dark:border-zinc-500",
          error && "border-red-400 focus-visible:ring-red-300 dark:border-red-500 dark:focus-visible:ring-red-900",
        )}
        aria-invalid={Boolean(error)}
        {...props}
      />
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {helper ? <p className="text-xs leading-5 text-muted-foreground">{helper}</p> : null}
    </label>
  );
}

function TimePickerField({ label, dirty, error, helper, className, ...props }) {
  return (
    <label className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        {dirty ? (
          <Badge variant="outline" className="rounded-md text-[11px]">
            已修改
          </Badge>
        ) : null}
      </div>
      <div className="relative">
        <Clock3 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="time"
          step="1"
          className={cn(
            "h-10 rounded-lg bg-muted/30 pl-9 pr-3 font-medium tabular-nums [color-scheme:light_dark] [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
            dirty && "border-zinc-400 dark:border-zinc-500",
            error && "border-red-400 focus-visible:ring-red-300 dark:border-red-500 dark:focus-visible:ring-red-900",
            className,
          )}
          aria-invalid={Boolean(error)}
          {...props}
        />
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {helper ? <p className="text-xs leading-5 text-muted-foreground">{helper}</p> : null}
    </label>
  );
}

function MiniPanel({ title, value, detail }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight">{value}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function AlertRow({ icon: Icon, title, detail }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-background">
        <Icon className="size-4" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export default App;
