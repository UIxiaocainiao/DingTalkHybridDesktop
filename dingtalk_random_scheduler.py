#!/usr/bin/env python3
"""Persistent Android device manager driven by adb.

Features:
1. Schedules DingTalk launches in randomized morning and evening windows
2. Persists the next planned run times so restarts do not reshuffle the day
3. Exposes `run`, `debug`, `status`, `schedule`, and `doctor` commands
4. Keeps scrcpy as an opt-in debug tool instead of a production dependency
5. Cleans up MIUI recent-task cards after the app is force-stopped
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Iterable


DEFAULT_PACKAGE = "com.alibaba.android.rimet"
DEFAULT_APP_LABEL = "钉钉"
DEFAULT_DELAY_AFTER_LAUNCH = 5
DEFAULT_POLL_INTERVAL = 5
DEFAULT_SCRCPY_LAUNCH_COOLDOWN = 15
DEFAULT_STATE_FILE = "logs/dingtalk-random-scheduler.state.json"
DEFAULT_WORKDAY_API_URL = "https://holiday.dreace.top?date={date}"
DEFAULT_WORKDAY_API_TIMEOUT = 5.0
OSASCRIPT_BIN = "/usr/bin/osascript"
ADB_BIN = "adb"
SCRCPY_BIN = "scrcpy"
ADB_CANDIDATES = (
    "adb",
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
    "/usr/bin/adb",
)
SCRCPY_CANDIDATES = (
    "scrcpy",
    "/opt/homebrew/bin/scrcpy",
    "/usr/local/bin/scrcpy",
)


@dataclass(frozen=True)
class TimeWindow:
    name: str
    start: dt_time
    end: dt_time


@dataclass(frozen=True)
class Config:
    serial: str
    package: str
    app_label: str
    delay_after_launch: int
    poll_interval: int
    enable_scrcpy_watch: bool
    scrcpy_launch_cooldown: int
    state_file: Path
    notify_on_success: bool
    enable_workday_check: bool
    workday_api_url: str
    workday_api_timeout: float


@dataclass(frozen=True)
class DeviceStatus:
    serial: str
    state: str
    usb_connected: bool
    raw_line: str


@dataclass(frozen=True)
class RecentTask:
    task_id: int
    package: str
    raw_line: str


@dataclass(frozen=True)
class NavigationState:
    navigation_mode: str
    force_fsg_nav_bar: str


@dataclass(frozen=True)
class WorkdayCheckResult:
    checked_date: date
    is_workday: bool
    note: str
    source: str
    checked_at: datetime


@dataclass
class SchedulerState:
    next_runs: dict[str, datetime]
    last_completed_dates: dict[str, date | None]
    last_workday_check: WorkdayCheckResult | None


WINDOWS: tuple[TimeWindow, ...] = (
    TimeWindow("morning", dt_time(9, 5), dt_time(9, 10)),
    TimeWindow("evening", dt_time(18, 5), dt_time(18, 15)),
)

MORNING_MESSAGES: tuple[str, ...] = (
    "打卡上班，像个不折不扣的牛，努力向前，但总是慢半拍。",
    "今天上班的目标：打卡！剩下的事交给未来的我。",
    "早上打卡前，我是一匹蓄势待发的马，打卡后，我变成了懒牛。",
    "上班就像骑在马背上，风光无限，可就是累得不行。",
    "打卡是上班前的“程序”，而我就是那台自动运行的牛马。",
    "看着同事们像马一样飞奔，我只能像牛一样慢慢走。",
    "我的上班节奏就像牛一样，慢而稳；只不过工作堆积得像山一样。",
    "每次打卡，我都觉得自己是那头无休止工作的牛。",
    "上班就像无止境的马拉松，跑不完的工作，停不下的脚步。",
    "上班是为了生存，打卡是为了证明：我还是在努力做牛马。",
    "如果工作是场马拉松，我一定是那头最后跑完的牛。",
    "我上班就是一头牛，走得慢，但每一步都很踏实。",
    "上班打卡，生活如牛，奋斗如马，目标却没变。",
    "我的上班节奏，像马的速度一样快，但精神却像牛一样缓慢。",
    "每次打卡，我都想变成飞速奔跑的马，可现实总是让我当牛。",
    "上班就是为了生存，打卡就是为了证明我还是在做牛马。",
    "今天上班前，我打卡后就变成了无所事事的牛，走得慢，吃得多。",
    "打卡的瞬间，想起自己就像一头默默耕耘的牛。",
    "我每天上班，感觉自己成了公司里的工作马，努力着没什么方向。",
    "我打卡上班，心里想着放飞自我，结果依然是被拖着前进的牛。",
    "上班第一件事：打卡！第二件事：假装自己不想睡觉。",
    "上班如牛，心却像马，四处奔波。",
    "早上上班，一身牛气，下午下班，疲惫成了马。",
    "不在办公室，心里却总感觉像马一样不停奔跑。",
    "我的生活：一只懒牛加上一匹忙马。",
    "打卡时，我心里想着：“今天我得做牛马，不然就完蛋了。”",
    "每天的打卡，似乎成了牛马间的一场接力赛，谁都不能停。",
    "今天上班的节奏，像牛一样稳重，像马一样迫不及待。",
    "上班的时候，总是问自己：“我为什么要做牛马？”",
    "上班是为了生存，打卡是为了证明我还是在做牛马。",
    "每天的打卡，我都告诉自己：“今天我一定是那头快跑的马！”",
    "生活就是在打卡、反省、再打卡之间循环。",
    "上班时，我希望自己能飞快如马，但结果却是步伐如牛。",
    "每次打卡，我都开始想：“今天我是不是比牛还慢？”",
    "上班的目标就是做个牛马，努力加班到天亮。",
    "上班第一件事：打卡！第二件事：开始想方设法偷懒。",
    "我的工作效率堪比牛的步伐，慢吞吞，但一天都在忙。",
    "不是我懒，是上班的节奏让我感到像个老牛。",
    "每天打卡，都会怀疑自己是被编程出来的牛马。",
    "上班前：活力满满！打卡后：开始发愁。",
    "上班就是为了生存，打卡就是为了证明我还是在做牛马。",
    "打卡上班，人生的“第一步”，也许是“慢慢走”。",
    "打卡后的我，变成了办公桌旁的牛马，吃草、工作、走慢。",
    "我的上班节奏，像马的速度一样快，但精神却像牛一样缓慢。",
    "上班不难，难的是变成“牛马”后的我，努力却没得到回报。",
    "打卡上班，我就像一头耐心的牛，工作慢慢来。",
    "今天的上班节奏：先是快马，后来变成了懒牛。",
    "每天都告诉自己：今天一定要像马一样快速，但结果总是像牛一样拖沓。",
    "每天的打卡，我都提醒自己：“做个马，做个牛，活得更充实。”",
    "我的工作生活，一头牛一匹马，慢慢走，偶尔飞奔。",
    "打卡后，我才知道：原来“牛马”的定义就是工作。",
    "上班时，我像牛一样努力着，但心里却想着偷懒。",
    "我的打卡就是：从牛慢到马快，但最终谁也没跑赢。",
    "说好要做马，最后却成了做牛的慢性病患者。",
    "打卡上班，虽然心里想做马，但无奈最终变成了慢慢走的牛。",
    "每天上班，我都期待自己像马一样驰骋，结果总是变成了牛。",
    "上班就是做牛做马的重复，过得像是工作中上演的一部马戏。",
    "我打卡上班，每次都像做牛做马，慢慢积累着工作。",
    "每次打卡，我都开始想：“今天我是不是比牛还慢？”",
    "打卡之后，我变成了工作上的牛，慢慢走，背负着任务。",
    "每天早上，期待自己能飞奔如马，结果成了日常工作的牛。",
    "我的工作节奏就是牛，做事时慢，休息时才快。",
    "打卡后，我像一头默默耕作的牛，吃草时就变成了马。",
    "上班的时候，我想骑在马背上飞驰，但现实总是让我当牛。",
    "每天上班，我总是想着：“做牛做马这生活什么时候才是头？”",
    "我的上班节奏就像牛一样，慢吞吞，但从不停止。",
    "每次打卡，我都幻想自己是马，跑到天涯，结果还是牛。",
    "每次上班，我都告诉自己：“做个马，走得快，但常常不行。”",
    "上班的目标就是做个牛马，努力加班到天亮。",
    "打卡后，我变成了“打卡牛”，进入了懒散工作模式。",
    "上班时，我是快马，但打卡后我却像牛一样慢下来。",
    "我上班的方式很简单：打卡，成为牛，做完工作。",
    "每天的打卡，我都告诉自己：“今天我一定是那头快跑的马！”",
    "打卡时，我就像一头耐心的牛，工作慢慢来。",
    "我的工作效率堪比牛的步伐，慢吞吞，但一天都在忙。",
    "每次打卡，我都在问自己：“我是不是牛，怎么总这么累？”",
    "我上班是牛马的合体，前进的动力是咖啡。",
    "今天的工作就像一头牛，走得很慢，但却始终不停止。",
    "我的上班节奏就像牛，慢吞吞但永远不停止。",
    "打卡时，我是那只懒散的牛，想当马但不敢。",
    "每天上班，我都提醒自己：“做马，做牛，还是得往前走！”",
    "每次上班，我都期待自己像马一样驰骋，结果总是变成了牛。",
    "每天的打卡，我都告诉自己：“今天我一定是那头快跑的马！”",
    "我总是想着上班时能当马，最后却变成了做牛的慢性病患者。",
    "上班时，我是沉默的牛；打卡后，我变成了充满活力的马。",
    "上班的节奏，我想是马，可结果是变成了牛。",
    "每次打卡，我都提醒自己：“今天我一定是那头快跑的马！”",
    "上班就是一场慢跑，骑上了马，但走的依然是牛的步伐。",
    "每次上班，我都幻想自己是马，跑到天涯，结果还是牛。",
    "我在办公室里做牛做马，不知道什么时候能像马一样奔跑。",
    "每次打卡，我都开始想：“今天我是不是比牛还慢？”",
    "上班时我像牛一样努力着，但心里却想着偷懒。",
    "打卡后的我，变成了办公桌旁的牛马，吃草、工作、走慢。",
    "上班就是骑马，但路途漫长，变成了牛的步伐。",
    "上班就像奔向远方的马，途中偶尔会变成步伐沉重的牛。",
    "每次上班，我都提醒自己：“做马，做牛，还是得往前走！”",
    "每天上班，我都在问自己：“我是不是牛，怎么总这么累？”",
    "打卡上班，生活如牛，奋斗如马，目标却没变。",
    "上班时我像牛一样努力着，但心里却想着偷懒。",
    "每次打卡，我都告诉自己：“今天我一定是那头快跑的马！”",
)

EVENING_MESSAGES: tuple[str, ...] = (
    "你看，今天下班，他的步伐像牛一样缓慢，心里却想着：“我真该像马一样飞奔！”",
    "你瞅瞅，他下班的时候，看起来像牛，拖着沉重的步伐，结果心里却在偷偷羡慕马的速度。",
    "你看，每次下班，他总是拖着疲惫的身躯，步伐慢得像牛，但他心里在想着：“要是我能像马一样，飞快回家就好了！”",
    "你瞅，他走出办公室，像头疲倦的牛，但心里却幻想着自己是一匹奔跑的马，飞奔回家。",
    "你看，每次下班，他都不急，脚步慢得像牛，内心却偷偷期待，哪天能像马一样，冲出公司。",
    "你瞅，他下班了，步伐慢得像牛，心情却轻松，仿佛在告诉自己：“今天的工作终于结束了，终于可以休息了！”",
    "你看，他下班了，虽然像牛一样慢慢走，但心里想的是：“我要飞得像马一样，快点回家！”",
    "你瞅，今天他下班了，走得慢得像牛，但心里却在偷偷想着：“如果我能像马一样快速回家就好了！”",
    "你看，每次下班，他的步伐慢得像牛，但他却希望自己能像马一样飞奔回家去，快点享受自由。",
    "你瞅瞅，他下班的时候，慢吞吞地像牛走着，心里却在想：“今天我就当个飞奔的马！”",
    "你看，他下班了，步伐慢得像牛，心里却想着自己要像马一样，飞速结束一天的工作。",
    "你瞅，他走出公司，眼里充满了放松的光芒，但脚步还是像牛一样缓慢，一点也不急。",
    "你看，下班后的他，心情放松得像马，步伐却像牛一样稳重，缓慢前进。",
    "你瞅，每次下班，他都幻想自己是一匹马，飞速冲回家，可现实总是把他拖成了懒牛。",
    "你看，他下班后，迈着牛步走向门外，心里想着：“如果我能像马一样快就好了。”",
    "你瞅，他下班时，步伐慢得像牛，心里却充满了像马一样奔腾的力量。",
    "你看，他今天下班，虽然像牛一样慢慢走，可内心却想着：“我要像马一样冲出去！”",
    "你瞅，他走出公司，脚步不紧不慢，就像牛一样缓慢走着，但内心其实期待飞快的马步。",
    "你看，下班时，他像牛一样慢，但他心里总在想：“如果我能像马一样快就好了！”",
    "你瞅，他下班时，步伐慢得像牛，心里却幻想着能像马一样快速回家。",
    "你看，下班时，他像牛一样走，心里却想着：“要是我能像马一样快就好了！”",
    "你瞅，他下班了，步伐慢得像牛，心里却期待着像马一样迅速回家。",
    "你看，他下班后，像牛一样慢慢走，心情却充满了自由，想着自己也该变得像马一样快速。",
    "你瞅，他走出公司时，脸上带着轻松的笑容，可步伐依旧是牛的节奏。",
    "你看，每次下班，他都像一头牛，慢慢走，心里却在渴望自己变成那匹奔腾的马。",
    "你瞅，他下班时，脚步慢得像牛，但心里却开始幻想：我要像马一样，飞速冲向家门。",
    "你看，下班时，他的步伐像牛一样慢，但心情却像马一样自由。",
    "你瞅，他今天下班，虽然走得像牛，但心里却希望自己能像马一样飞快。",
    "你看，下班时，他慢得像牛，心里却想着：“今天我一定要像马一样轻松。”",
    "你瞅，每次下班，他都渴望变得像马一样迅速，结果总是像牛一样慢慢走。",
    "你看，他下班了，步伐沉重，像牛，但心里却在想着：“今天我要像马一样快！”",
    "你瞅，今天下班，他走得像牛，但心里已经开始想着：“我要像马一样冲出去！”",
    "你看，他下班时，脸上是轻松的笑容，步伐却还是像牛一样慢。",
    "你瞅，他下班时，走得慢得像牛，但内心却在想：“今天我可以做一匹奔跑的马。”",
    "你看，下班时，他的步伐像牛一样慢，但心情却像马一样自由。",
    "你瞅，他今天下班，步伐慢得像牛，但心里却希望自己能像马一样飞快。",
    "你看，下班时，他像牛一样走，心里却想着：“要是我能像马一样快就好了！”",
    "你瞅，他下班了，步伐慢得像牛，心里却期待着像马一样迅速回家。",
    "你看，他下班后，像牛一样慢慢走，心里却想着：“今天我也想像马一样飞奔！”",
    "你瞅，他下班了，脸上带着笑容，但步伐仍像牛一样缓慢，想跑得像马却不行。",
    "你看，他下班了，走得像牛，内心却在想着：“今天我一定要像马一样飞奔！”",
    "你瞅，今天下班，他走得像牛，但心里已经开始幻想自己是那匹飞奔的马。",
    "你看，下班时，他走得像牛一样慢，但心情却充满了像马一样的飞奔欲望。",
    "你瞅，他今天下班，虽然走得像牛，但心里却开始幻想自己是那匹飞奔的马。",
    "你看，下班时，他的步伐像牛一样慢，但内心充满了像马一样奔腾的力量。",
    "你瞅，他下班时，步伐慢得像牛，但心情却像马一样飞扬，想着要快速回家。",
    "你看，每次下班，他都渴望像马一样快速，结果却像牛一样慢慢走。",
    "你瞅，他下班了，脚步慢得像牛，但心里却期待自己像马一样快速回家。",
    "你看，他下班时，走得像牛一样慢，心里却想着：“如果我能像马一样快就好了！”",
    "你瞅，每次下班，他都在想着自己像马，但步伐总是慢得像牛。",
    "你看，下班时，他走得像牛，但心里想着：“今天我一定要像马一样飞奔回家。”",
    "你瞅，他今天下班，步伐慢得像牛，但心里充满了像马一样的飞奔欲望。",
    "你看，他下班时步伐慢得像牛，但内心却在想着：“今天我要变成那匹飞奔的马。”",
    "你瞅，他下班了，走得像牛，心里却想着：“我要像马一样飞奔出去！”",
    "你看，下班时，他的步伐像牛一样慢，但内心却在想着：“今天我一定要像马一样快！”",
    "你瞅，他下班了，心情轻松，步伐却还是像牛一样慢。",
    "你看，他下班时走得像牛，但心里却在想着：“今天我能像马一样快点回家吗？”",
    "你瞅，他下班了，虽然脚步像牛，但心里却在想着：“我就要像马一样飞奔！”",
    "你看，下班时，他的步伐像牛一样慢，但心里却想着：“要是我能像马一样快该多好！”",
    "你瞅，他今天下班，走得像牛，但心里却想着：“如果我能像马一样快就好了！”",
    "你看，下班时，他像牛一样走，心里却想着：“要是我能像马一样快就好了！”",
    "你瞅，他下班了，步伐慢得像牛，心里却期待着像马一样迅速回家。",
    "你看，他下班后，像牛一样慢慢走，心情却想着：“今天我也想像马一样飞奔！”",
    "你瞅，他下班了，脸上带着笑容，但步伐仍像牛一样缓慢，想跑得像马却不行。",
    "你看，他下班了，走得像牛，内心却在想着：“今天我一定要像马一样飞奔！”",
    "你瞅，今天下班，他走得像牛，但心里已经开始幻想自己是那匹飞奔的马。",
    "你看，下班时，他走得像牛一样慢，但心情却充满了像马一样的飞奔欲望。",
    "你瞅，他今天下班，虽然走得像牛，但心里却开始幻想自己是那匹飞奔的马。",
    "你看，下班时，他的步伐像牛一样慢，但内心充满了像马一样奔腾的力量。",
    "你瞅，他下班时，步伐慢得像牛，但心情却像马一样飞扬，想着要快速回家。",
    "你看，每次下班，他都渴望像马一样快速，结果却像牛一样慢慢走。",
    "你瞅，他下班了，脚步慢得像牛，但心里却期待自己像马一样快速回家。",
    "你看，他下班时，走得像牛一样慢，心里却想着：“如果我能像马一样快就好了！”",
    "你瞅，每次下班，他都在想着自己像马，但步伐总是慢得像牛。",
    "你看，下班时，他走得像牛，但心里想着：“今天我一定要像马一样飞奔回家。”",
    "你瞅，他今天下班，步伐慢得像牛，但心里充满了像马一样的飞奔欲望。",
    "你看，他下班时步伐慢得像牛，但内心却在想着：“今天我要变成那匹飞奔的马。”",
    "你瞅，他下班了，走得像牛，心里却想着：“我要像马一样飞奔出去！”",
    "你看，下班时，他的步伐像牛一样慢，但内心却在想着：“今天我一定要像马一样快！”",
    "你瞅，他下班了，心情轻松，步伐却还是像牛一样慢。",
    "你看，他下班时走得像牛，但心里却在想着：“今天我能像马一样快点回家吗？”",
    "你瞅，他下班了，虽然脚步像牛，但心里却在想着：“我就要像马一样飞奔！”",
    "你看，下班时，他的步伐像牛一样慢，但心里却想着：“要是我能像马一样快该多好！”",
    "你瞅，他今天下班，走得像牛，但心里却想着：“如果我能像马一样快就好了！”",
    "你看，下班时，他像牛一样走，心里却想着：“要是我能像马一样快就好了！”",
    "你瞅，他下班了，步伐慢得像牛，心里却期待着像马一样迅速回家。",
    "你看，他下班后，像牛一样慢慢走，心情却想着：“今天我也想像马一样飞奔！”",
    "你瞅，他下班了，脸上带着笑容，但步伐仍像牛一样缓慢，想跑得像马却不行。",
    "你看，他下班了，走得像牛，内心却在想着：“今天我一定要像马一样飞奔！”",
    "你瞅，今天下班，他走得像牛，但心里已经开始幻想自己是那匹飞奔的马。",
    "你看，下班时，他走得像牛一样慢，但心情却充满了像马一样的飞奔欲望。",
    "你瞅，他今天下班，虽然走得像牛，但心里却开始幻想自己是那匹飞奔的马。",
    "你看，下班时，他的步伐像牛一样慢，但内心充满了像马一样奔腾的力量。",
    "你瞅，他下班时，步伐慢得像牛，但心情却像马一样飞扬，想着要快速回家。",
    "你看，每次下班，他都渴望像马一样快速，结果却像牛一样慢慢走。",
    "你瞅，他下班了，脚步慢得像牛，但心里却期待自己像马一样快速回家。",
    "你看，他下班时，走得像牛一样慢，心里却想着：“如果我能像马一样快就好了！”",
    "你瞅，每次下班，他都在想着自己像马，但步伐总是慢得像牛。",
    "你看，下班时，他走得像牛，但心里想着：“今天我一定要像马一样飞奔回家。”",
    "你瞅，他今天下班，走得像牛，但心里充满了像马一样的飞奔欲望。",
)


def log(message: str) -> None:
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}", flush=True)


def format_timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S")


def format_window(window: TimeWindow) -> str:
    return f"{window.start.strftime('%H:%M')}-{window.end.strftime('%H:%M')}"


def resolve_binary(binary_name: str, configured_path: str | None, candidates: tuple[str, ...]) -> str:
    if configured_path:
        return configured_path

    for candidate in candidates:
        if "/" in candidate:
            resolved = candidate if shutil.which(candidate) else None
        else:
            resolved = shutil.which(candidate)
        if resolved:
            return resolved

    raise RuntimeError(
        f"{binary_name} not found. Install it first or pass the explicit path."
    )


def run_adb(adb_bin: str, serial: str | None, args: Iterable[str]) -> subprocess.CompletedProcess[str]:
    command = [adb_bin]
    if serial:
        command.extend(["-s", serial])
    command.extend(args)
    return subprocess.run(command, capture_output=True, text=True, check=True)


def describe_process_error(exc: subprocess.CalledProcessError) -> str:
    stderr = (exc.stderr or "").strip()
    stdout = (exc.stdout or "").strip()
    return stderr or stdout or str(exc)


def get_setting(serial: str, namespace: str, key: str) -> str:
    result = run_adb(ADB_BIN, serial, ["shell", "settings", "get", namespace, key])
    return result.stdout.strip()


def put_setting(serial: str, namespace: str, key: str, value: str) -> None:
    run_adb(ADB_BIN, serial, ["shell", "settings", "put", namespace, key, value])


def parse_device_statuses(output: str) -> list[DeviceStatus]:
    statuses: list[DeviceStatus] = []
    for raw_line in output.splitlines()[1:]:
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        serial = parts[0]
        state = parts[1]
        usb_connected = any(part.startswith("usb:") for part in parts[2:])
        statuses.append(DeviceStatus(serial=serial, state=state, usb_connected=usb_connected, raw_line=line))
    return statuses


def list_device_statuses() -> list[DeviceStatus]:
    result = run_adb(ADB_BIN, None, ["devices", "-l"])
    return parse_device_statuses(result.stdout)


def get_device_status(serial: str) -> DeviceStatus | None:
    for status in list_device_statuses():
        if status.serial == serial:
            return status
    return None


def detect_single_device() -> str:
    devices = [status.serial for status in list_device_statuses() if status.state == "device"]

    if not devices:
        raise RuntimeError("No online adb device found. Check USB debugging and adb authorization.")
    if len(devices) > 1:
        raise RuntimeError(
            "Multiple adb devices found. Pass --serial to select one explicitly: "
            + ", ".join(devices)
        )
    return devices[0]


def apple_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def notify_user(title: str, message: str) -> None:
    try:
        subprocess.run(
            [
                OSASCRIPT_BIN,
                "-e",
                f"display notification {apple_string(message)} with title {apple_string(title)}",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except Exception as exc:
        log(f"Notification failed: {exc}")


def launch_app(serial: str, package: str) -> None:
    run_adb(
        ADB_BIN,
        serial,
        ["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"],
    )
    log(f"Launched {package} on device {serial}.")


def stop_app(serial: str, package: str) -> None:
    run_adb(ADB_BIN, serial, ["shell", "am", "force-stop", package])
    log(f"Force-stopped {package} on device {serial}.")


def get_navigation_state(serial: str) -> NavigationState:
    return NavigationState(
        navigation_mode=get_setting(serial, "secure", "navigation_mode"),
        force_fsg_nav_bar=get_setting(serial, "global", "force_fsg_nav_bar"),
    )


def switch_to_button_navigation_for_miui(serial: str) -> NavigationState:
    original_state = get_navigation_state(serial)
    changed = False

    if original_state.force_fsg_nav_bar != "0":
        put_setting(serial, "global", "force_fsg_nav_bar", "0")
        changed = True
    if original_state.navigation_mode != "0":
        put_setting(serial, "secure", "navigation_mode", "0")
        changed = True

    if changed:
        time.sleep(1)
    return original_state


def restore_navigation_state(serial: str, state: NavigationState) -> None:
    current_state = get_navigation_state(serial)
    if current_state.force_fsg_nav_bar != state.force_fsg_nav_bar:
        put_setting(serial, "global", "force_fsg_nav_bar", state.force_fsg_nav_bar)
    if current_state.navigation_mode != state.navigation_mode:
        put_setting(serial, "secure", "navigation_mode", state.navigation_mode)


def dump_ui_xml(serial: str) -> str:
    run_adb(ADB_BIN, serial, ["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"])
    return run_adb(ADB_BIN, serial, ["shell", "cat", "/sdcard/window_dump.xml"]).stdout


def parse_bounds(bounds: str) -> tuple[int, int, int, int]:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not match:
        raise ValueError(f"Unsupported bounds: {bounds}")
    return tuple(int(value) for value in match.groups())


def is_miui_recents_ui(xml_text: str) -> bool:
    return "com.miui.home:id/recents_container" in xml_text


def is_miui_recents_empty(xml_text: str) -> bool:
    return "近期没有任何内容" in xml_text


def find_miui_recent_card_bounds(xml_text: str, app_label: str) -> tuple[int, int, int, int] | None:
    root = ET.fromstring(xml_text)
    parent_map = {child: parent for parent in root.iter() for child in parent}

    for node in root.iter("node"):
        package = node.attrib.get("package", "")
        if package != "com.miui.home":
            continue

        content_desc = node.attrib.get("content-desc", "")
        text = node.attrib.get("text", "")
        if app_label not in content_desc and text != app_label:
            continue

        current = node
        while current is not None:
            clickable = current.attrib.get("clickable") == "true"
            bounds = current.attrib.get("bounds")
            if clickable and bounds:
                return parse_bounds(bounds)
            current = parent_map.get(current)

    return None


def dismiss_recent_task_card_on_miui(serial: str, package: str, app_label: str) -> bool:
    original_navigation_state = switch_to_button_navigation_for_miui(serial)
    try:
        run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_APP_SWITCH"])
        time.sleep(1)

        ui_xml = dump_ui_xml(serial)
        if not is_miui_recents_ui(ui_xml):
            log("MIUI recents UI did not open as expected.")
            return False

        bounds = find_miui_recent_card_bounds(ui_xml, app_label)
        if bounds is None:
            if is_miui_recents_empty(ui_xml):
                log(f"MIUI recents is already empty for {app_label}.")
                return True
            log(f"Could not locate recent-task card for {app_label}.")
            return False

        left, top, right, bottom = bounds
        center_x = (left + right) // 2
        center_y = (top + bottom) // 2
        dismiss_y = "120"

        removed = False
        for _ in range(2):
            run_adb(
                ADB_BIN,
                serial,
                ["shell", "input", "swipe", str(center_x), str(center_y), str(center_x), dismiss_y, "250"],
            )
            for _ in range(3):
                time.sleep(1)
                after_swipe_ui_xml = dump_ui_xml(serial)
                removed = (
                    is_miui_recents_empty(after_swipe_ui_xml)
                    or find_miui_recent_card_bounds(after_swipe_ui_xml, app_label) is None
                )
                if removed:
                    break
            if removed:
                break

        if not removed:
            run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_HOME"])
            time.sleep(1)
            run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_APP_SWITCH"])
            time.sleep(1)
            refreshed_ui_xml = dump_ui_xml(serial)
            removed = (
                is_miui_recents_empty(refreshed_ui_xml)
                or find_miui_recent_card_bounds(refreshed_ui_xml, app_label) is None
            )

        if removed:
            log(f"Dismissed MIUI recent-task card for {app_label}.")
        else:
            log(f"MIUI recent-task card for {app_label} is still visible after swipe.")
        return removed
    finally:
        run_adb(ADB_BIN, serial, ["shell", "input", "keyevent", "KEYCODE_HOME"])
        restore_navigation_state(serial, original_navigation_state)
        time.sleep(1)


def is_scrcpy_running_for_serial(serial: str) -> bool:
    result = subprocess.run(
        ["ps", "-ax", "-o", "pid=,args="],
        capture_output=True,
        text=True,
        check=True,
    )
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split(maxsplit=1)
        if len(parts) < 2:
            continue
        try:
            argv = shlex.split(parts[1])
        except ValueError:
            continue
        if not argv:
            continue
        executable = argv[0].rsplit("/", 1)[-1]
        if executable != "scrcpy":
            continue
        for index, arg in enumerate(argv[:-1]):
            if arg in {"--serial", "-s"} and argv[index + 1] == serial:
                return True
    return False


def launch_scrcpy(serial: str) -> None:
    env = os.environ.copy()
    current_path = env.get("PATH", "")
    adb_dir = ADB_BIN.rsplit("/", 1)[0] if "/" in ADB_BIN else ""
    if adb_dir and adb_dir not in current_path.split(":"):
        env["PATH"] = f"{adb_dir}:{current_path}" if current_path else adb_dir
    env["ADB"] = ADB_BIN
    subprocess.Popen(
        [SCRCPY_BIN, "--serial", serial],
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    log(f"Launched scrcpy for device {serial}.")


def random_datetime_for_window(target_day: date, window: TimeWindow) -> datetime:
    start_dt = datetime.combine(target_day, window.start)
    end_dt = datetime.combine(target_day, window.end)
    total_seconds = int((end_dt - start_dt).total_seconds())
    offset = random.randint(0, total_seconds)
    return start_dt + timedelta(seconds=offset)


def next_run_after(now: datetime, window: TimeWindow) -> datetime:
    today_candidate = random_datetime_for_window(now.date(), window)
    if today_candidate > now:
        return today_candidate
    return random_datetime_for_window(now.date() + timedelta(days=1), window)


def build_daily_schedule(now: datetime) -> dict[str, datetime]:
    return {window.name: next_run_after(now, window) for window in WINDOWS}


def create_scheduler_state(now: datetime) -> SchedulerState:
    return SchedulerState(
        next_runs=build_daily_schedule(now),
        last_completed_dates={window.name: None for window in WINDOWS},
        last_workday_check=None,
    )


def normalize_scheduler_state(state: SchedulerState, now: datetime) -> SchedulerState:
    normalized = SchedulerState(
        next_runs=dict(state.next_runs),
        last_completed_dates=dict(state.last_completed_dates),
        last_workday_check=state.last_workday_check,
    )
    for window in WINDOWS:
        normalized.last_completed_dates.setdefault(window.name, None)
        scheduled_time = normalized.next_runs.get(window.name)
        if scheduled_time is None:
            normalized.next_runs[window.name] = next_run_after(now, window)
            continue
        if scheduled_time.date() < now.date():
            normalized.next_runs[window.name] = next_run_after(now, window)
            continue
        last_completed = normalized.last_completed_dates.get(window.name)
        if last_completed == scheduled_time.date() and scheduled_time <= now:
            normalized.next_runs[window.name] = next_run_after(now, window)
    return normalized


def load_scheduler_state(path: Path, now: datetime) -> SchedulerState:
    if not path.exists():
        return create_scheduler_state(now)

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"State file is unreadable, recreating it: {exc}")
        return create_scheduler_state(now)

    next_runs: dict[str, datetime] = {}
    for window in WINDOWS:
        raw_value = payload.get("next_runs", {}).get(window.name)
        if not raw_value:
            continue
        try:
            next_runs[window.name] = datetime.fromisoformat(raw_value)
        except ValueError:
            continue

    last_completed_dates: dict[str, date | None] = {}
    for window in WINDOWS:
        raw_value = payload.get("last_completed_dates", {}).get(window.name)
        if not raw_value:
            last_completed_dates[window.name] = None
            continue
        try:
            last_completed_dates[window.name] = date.fromisoformat(raw_value)
        except ValueError:
            last_completed_dates[window.name] = None

    last_workday_check: WorkdayCheckResult | None = None
    raw_workday_check = payload.get("last_workday_check")
    if isinstance(raw_workday_check, dict):
        try:
            checked_date = date.fromisoformat(raw_workday_check["checked_date"])
            checked_at = datetime.fromisoformat(raw_workday_check["checked_at"])
            is_workday = bool(raw_workday_check["is_workday"])
            note = str(raw_workday_check.get("note", ""))
            source = str(raw_workday_check.get("source", ""))
            last_workday_check = WorkdayCheckResult(
                checked_date=checked_date,
                is_workday=is_workday,
                note=note,
                source=source,
                checked_at=checked_at,
            )
        except (KeyError, TypeError, ValueError):
            last_workday_check = None

    return normalize_scheduler_state(
        SchedulerState(next_runs, last_completed_dates, last_workday_check),
        now,
    )


def save_scheduler_state(path: Path, state: SchedulerState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "next_runs": {name: value.isoformat() for name, value in state.next_runs.items()},
        "last_completed_dates": {
            name: value.isoformat() if value else None
            for name, value in state.last_completed_dates.items()
        },
        "last_workday_check": (
            {
                "checked_date": state.last_workday_check.checked_date.isoformat(),
                "is_workday": state.last_workday_check.is_workday,
                "note": state.last_workday_check.note,
                "source": state.last_workday_check.source,
                "checked_at": state.last_workday_check.checked_at.isoformat(),
            }
            if state.last_workday_check
            else None
        ),
        "updated_at": datetime.now().isoformat(),
    }
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp_path.replace(path)


def reschedule_window(state: SchedulerState, window: TimeWindow, anchor_day: date) -> None:
    state.next_runs[window.name] = random_datetime_for_window(anchor_day + timedelta(days=1), window)


def fetch_workday_status(target_day: date, api_url_template: str, timeout: float) -> WorkdayCheckResult:
    request_url = api_url_template.format(date=target_day.isoformat())
    with urllib.request.urlopen(request_url, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))

    type_label = str(payload.get("type", "")).strip()
    note = str(payload.get("note", "")).strip()
    is_holiday = payload.get("isHoliday")

    if type_label == "工作日":
        is_workday = True
    elif type_label == "假日":
        is_workday = False
    elif isinstance(is_holiday, bool):
        is_workday = not is_holiday
    else:
        raise ValueError(f"Unsupported workday API response: {payload}")

    return WorkdayCheckResult(
        checked_date=target_day,
        is_workday=is_workday,
        note=note or type_label or ("工作日" if is_workday else "假日"),
        source=request_url,
        checked_at=datetime.now(),
    )


def ensure_workday_status(config: Config, state: SchedulerState, target_day: date) -> WorkdayCheckResult | None:
    if not config.enable_workday_check:
        return None

    if state.last_workday_check and state.last_workday_check.checked_date == target_day:
        return state.last_workday_check

    result = fetch_workday_status(target_day, config.workday_api_url, config.workday_api_timeout)
    state.last_workday_check = result
    save_scheduler_state(config.state_file, state)
    label = "workday" if result.is_workday else "non-workday"
    log(f"Workday check for {target_day.isoformat()}: {label} ({result.note}).")
    return result


def roll_windows_forward_for_non_workday(config: Config, state: SchedulerState, target_day: date) -> None:
    changed = False
    for window in WINDOWS:
        scheduled_time = state.next_runs[window.name]
        if scheduled_time.date() <= target_day:
            state.next_runs[window.name] = random_datetime_for_window(target_day + timedelta(days=1), window)
            changed = True
            log(
                f"Skipped {window.name} window on {target_day.isoformat()} because it is not a workday. "
                f"Rescheduled to {format_timestamp(state.next_runs[window.name])}."
            )

    if changed:
        save_scheduler_state(config.state_file, state)


def random_morning_message() -> str:
    return random.choice(MORNING_MESSAGES)


def random_evening_message() -> str:
    return random.choice(EVENING_MESSAGES)


def perform_action(serial: str, package: str, app_label: str, delay_after_launch: int) -> None:
    launch_app(serial, package)
    log(f"Waiting {delay_after_launch} seconds before stopping {package}.")
    time.sleep(delay_after_launch)
    stop_app(serial, package)
    try:
        dismiss_recent_task_card_on_miui(serial, package, app_label)
    except subprocess.CalledProcessError as exc:
        details = describe_process_error(exc)
        log(f"Recent-task cleanup failed: {details}")
    except Exception as exc:
        log(f"Unexpected error during recent-task cleanup: {exc}")


def process_due_windows(config: Config, state: SchedulerState) -> None:
    now = datetime.now()
    for window in WINDOWS:
        scheduled_time = state.next_runs[window.name]
        if now < scheduled_time:
            continue

        if state.last_completed_dates.get(window.name) == scheduled_time.date():
            log(
                f"Skipping {window.name} action at {format_timestamp(scheduled_time)} "
                "because it was already completed."
            )
            reschedule_window(state, window, scheduled_time.date())
            save_scheduler_state(config.state_file, state)
            continue

        log(f"Executing {window.name} action scheduled for {format_timestamp(scheduled_time)}.")
        action_succeeded = False
        try:
            perform_action(config.serial, config.package, config.app_label, config.delay_after_launch)
            action_succeeded = True
            state.last_completed_dates[window.name] = scheduled_time.date()
            completion_message: str | None = None
            if window.name == "morning":
                completion_message = random_morning_message()
                log(completion_message)
            elif window.name == "evening":
                completion_message = random_evening_message()
                log(completion_message)
            if config.notify_on_success:
                notify_message = (
                    completion_message
                    if completion_message
                    else f"{window.name} window completed at {datetime.now().strftime('%H:%M:%S')}."
                )
                notify_user("DingTalk automation completed", notify_message)
        except subprocess.CalledProcessError as exc:
            details = describe_process_error(exc)
            log(f"adb command failed: {details}")
            notify_user("DingTalk automation failed", details[:180])
        except Exception as exc:
            log(f"Unexpected error during scheduled action: {exc}")
            notify_user("DingTalk automation failed", str(exc)[:180])
        finally:
            reschedule_window(state, window, scheduled_time.date())
            save_scheduler_state(config.state_file, state)
            outcome = "completed" if action_succeeded else "finished with errors"
            log(
                f"{window.name} action {outcome}. "
                f"Next run: {format_timestamp(state.next_runs[window.name])}."
            )


def is_device_ready(status: DeviceStatus | None) -> bool:
    return bool(status and status.state == "device" and status.usb_connected)


def maybe_launch_scrcpy(
    serial: str,
    status: DeviceStatus | None,
    previous_device_ready: bool | None,
    last_scrcpy_attempt_monotonic: float | None,
    scrcpy_launch_cooldown: int,
) -> tuple[bool, float | None]:
    current_device_ready = is_device_ready(status)
    if not current_device_ready:
        return current_device_ready, last_scrcpy_attempt_monotonic

    if previous_device_ready:
        return current_device_ready, last_scrcpy_attempt_monotonic

    now_monotonic = time.monotonic()
    if (
        last_scrcpy_attempt_monotonic is not None
        and now_monotonic - last_scrcpy_attempt_monotonic < scrcpy_launch_cooldown
    ):
        return current_device_ready, last_scrcpy_attempt_monotonic

    if is_scrcpy_running_for_serial(serial):
        return current_device_ready, last_scrcpy_attempt_monotonic

    try:
        launch_scrcpy(serial)
        return current_device_ready, now_monotonic
    except Exception as exc:
        log(f"Failed to launch scrcpy: {exc}")
        return current_device_ready, now_monotonic


def status_summary(status: DeviceStatus | None) -> str:
    if status is None:
        return "disconnected"
    if status.state == "unauthorized":
        return "usb-connected but unauthorized"
    if status.state == "device" and status.usb_connected:
        return "usb-connected and authorized"
    if status.state == "device":
        return "authorized but not identified as usb-connected"
    return status.state


def describe_window_state(state: SchedulerState, window: TimeWindow) -> str:
    next_run = state.next_runs[window.name]
    last_completed = state.last_completed_dates.get(window.name)
    last_completed_text = last_completed.isoformat() if last_completed else "never"
    return (
        f"{window.name:<7} window {format_window(window)} | "
        f"next: {format_timestamp(next_run)} | last completed: {last_completed_text}"
    )


def print_schedule_report(state: SchedulerState, state_file: Path) -> None:
    print(f"State file: {state_file}")
    if state.last_workday_check:
        decision = "workday" if state.last_workday_check.is_workday else "non-workday"
        print(
            "Last workday check: "
            f"{state.last_workday_check.checked_date.isoformat()} | "
            f"{decision} | {state.last_workday_check.note}"
        )
    for window in WINDOWS:
        print(describe_window_state(state, window))


def should_enable_scrcpy_watch(args: argparse.Namespace) -> bool:
    return args.command == "debug" or args.enable_scrcpy_watch


def resolve_binaries_for_run(args: argparse.Namespace) -> tuple[str, str | None]:
    adb_bin = resolve_binary("adb", args.adb_bin, ADB_CANDIDATES)
    scrcpy_bin = None
    if should_enable_scrcpy_watch(args):
        scrcpy_bin = resolve_binary("scrcpy", args.scrcpy_bin, SCRCPY_CANDIDATES)
    return adb_bin, scrcpy_bin


def resolve_binaries_for_inspection(args: argparse.Namespace) -> tuple[str | None, str | None, list[str]]:
    warnings: list[str] = []

    try:
        adb_bin = resolve_binary("adb", args.adb_bin, ADB_CANDIDATES)
    except Exception as exc:
        adb_bin = None
        warnings.append(f"adb unavailable: {exc}")

    try:
        scrcpy_bin = resolve_binary("scrcpy", args.scrcpy_bin, SCRCPY_CANDIDATES)
    except Exception as exc:
        scrcpy_bin = None
        warnings.append(f"scrcpy unavailable: {exc}")

    return adb_bin, scrcpy_bin, warnings


def build_config(args: argparse.Namespace, serial: str) -> Config:
    return Config(
        serial=serial,
        package=args.package,
        app_label=args.app_label,
        delay_after_launch=max(1, args.delay_after_launch),
        poll_interval=max(1, args.poll_interval),
        enable_scrcpy_watch=should_enable_scrcpy_watch(args),
        scrcpy_launch_cooldown=max(1, args.scrcpy_launch_cooldown),
        state_file=Path(args.state_file).expanduser(),
        notify_on_success=args.notify_on_success,
        enable_workday_check=not args.disable_workday_check,
        workday_api_url=args.workday_api_url,
        workday_api_timeout=max(1.0, args.workday_api_timeout),
    )


def command_schedule(args: argparse.Namespace) -> int:
    state_file = Path(args.state_file).expanduser()
    state = load_scheduler_state(state_file, datetime.now())
    print_schedule_report(state, state_file)
    return 0


def command_status(args: argparse.Namespace) -> int:
    state_file = Path(args.state_file).expanduser()
    state = load_scheduler_state(state_file, datetime.now())
    print_schedule_report(state, state_file)

    adb_bin, scrcpy_bin, warnings = resolve_binaries_for_inspection(args)
    for warning in warnings:
        print(f"Warning: {warning}")

    if not adb_bin:
        return 0

    global ADB_BIN, SCRCPY_BIN
    ADB_BIN = adb_bin
    if scrcpy_bin:
        SCRCPY_BIN = scrcpy_bin

    try:
        serial = args.serial or detect_single_device()
    except subprocess.CalledProcessError as exc:
        print(f"Device: unavailable ({describe_process_error(exc)})")
        return 0
    except Exception as exc:
        print(f"Device: unavailable ({exc})")
        return 0

    try:
        status = get_device_status(serial)
    except subprocess.CalledProcessError as exc:
        print(f"Device: unavailable ({describe_process_error(exc)})")
        return 0
    print(f"Device: {serial} | {status_summary(status)}")
    if scrcpy_bin:
        print(f"scrcpy: {'running' if is_scrcpy_running_for_serial(serial) else 'not running'}")
    return 0


def command_doctor(args: argparse.Namespace) -> int:
    state_file = Path(args.state_file).expanduser()
    issues: list[str] = []
    warnings: list[str] = []
    scrcpy_required = should_enable_scrcpy_watch(args)

    adb_bin, scrcpy_bin, binary_warnings = resolve_binaries_for_inspection(args)
    if adb_bin:
        print(f"OK   adb: {adb_bin}")
    else:
        issues.append("adb is required for scheduling and device checks.")
    if scrcpy_bin:
        print(f"OK   scrcpy: {scrcpy_bin}")
    else:
        if scrcpy_required:
            issues.append("scrcpy is required while debug mode or scrcpy watch is enabled.")
        else:
            print("WARN scrcpy: unavailable, but production mode only needs adb.")

    try:
        state = load_scheduler_state(state_file, datetime.now())
        save_scheduler_state(state_file, state)
        print(f"OK   state file: {state_file}")
    except Exception as exc:
        issues.append(f"state file is not writable: {exc}")

    if args.disable_workday_check:
        print("OK   workday check: disabled")
    else:
        try:
            result = fetch_workday_status(date.today(), args.workday_api_url, max(1.0, args.workday_api_timeout))
            decision = "workday" if result.is_workday else "non-workday"
            print(f"OK   workday API: {decision} ({result.note})")
        except Exception as exc:
            warnings.append(f"workday API unavailable: {exc}")

    for warning in binary_warnings + warnings:
        print(f"WARN {warning}")

    if not adb_bin:
        for issue in issues:
            print(f"FAIL {issue}")
        return 1

    global ADB_BIN, SCRCPY_BIN
    ADB_BIN = adb_bin
    if scrcpy_bin:
        SCRCPY_BIN = scrcpy_bin

    try:
        statuses = list_device_statuses()
        if not statuses:
            issues.append("no adb devices found.")
        else:
            for status in statuses:
                print(f"OK   device: {status.raw_line}")
    except subprocess.CalledProcessError as exc:
        issues.append(f"failed to query adb devices: {describe_process_error(exc)}")
        statuses = []
    except Exception as exc:
        issues.append(f"failed to query adb devices: {exc}")
        statuses = []

    selected_serial: str | None = None
    if statuses:
        try:
            selected_serial = args.serial or detect_single_device()
            print(f"OK   selected device: {selected_serial}")
        except Exception as exc:
            issues.append(str(exc))

    if selected_serial:
        selected_status = get_device_status(selected_serial)
        if selected_status and selected_status.state == "unauthorized":
            issues.append(
                f"device {selected_serial} is connected but unauthorized. Approve USB debugging on the phone."
            )
        elif selected_status is None:
            issues.append(f"device {selected_serial} is not visible to adb.")
        else:
            print(f"OK   device state: {status_summary(selected_status)}")
            if scrcpy_bin:
                print(
                    f"OK   scrcpy state: "
                    f"{'running' if is_scrcpy_running_for_serial(selected_serial) else 'not running'}"
                )

    if issues:
        for issue in issues:
            print(f"FAIL {issue}")
        return 1

    print("OK   doctor finished with no blocking issues.")
    return 0


def command_run(args: argparse.Namespace) -> int:
    global ADB_BIN, SCRCPY_BIN

    try:
        ADB_BIN, SCRCPY_BIN = resolve_binaries_for_run(args)
    except Exception as exc:
        log(f"Binary initialization failed: {exc}")
        return 1

    try:
        serial = args.serial or detect_single_device()
    except Exception as exc:
        log(f"Device detection failed: {exc}")
        return 1

    config = build_config(args, serial)
    state = load_scheduler_state(config.state_file, datetime.now())
    save_scheduler_state(config.state_file, state)

    log(f"Using adb {ADB_BIN}.")
    if config.enable_scrcpy_watch and SCRCPY_BIN:
        log(f"Using scrcpy {SCRCPY_BIN}.")
    log(f"Using device {config.serial}. Package: {config.package}. App label: {config.app_label}")
    log(
        f"scrcpy reconnect watch: {'enabled' if config.enable_scrcpy_watch else 'disabled'}. "
        f"Poll interval: {config.poll_interval}s."
    )
    if config.enable_workday_check:
        log(f"Workday check: enabled via {config.workday_api_url}.")
    else:
        log("Workday check: disabled.")
    log(f"State file: {config.state_file}")
    for window in WINDOWS:
        log(f"Next {window.name} run scheduled at {format_timestamp(state.next_runs[window.name])}.")
    log("Press Ctrl+C to stop.")

    previous_status_summary: str | None = None
    previous_device_ready: bool | None = None
    last_scrcpy_attempt_monotonic: float | None = None
    authorization_prompt_shown = False

    try:
        while True:
            try:
                device_status = get_device_status(config.serial)
            except Exception as exc:
                device_status = None
                log(f"Device status check failed: {exc}")

            current_status_summary = status_summary(device_status)
            if previous_status_summary is None or current_status_summary != previous_status_summary:
                log(f"Device {config.serial} state: {current_status_summary}.")
                previous_status_summary = current_status_summary

            if device_status and device_status.state == "unauthorized" and device_status.usb_connected:
                if not authorization_prompt_shown:
                    log(
                        f"Device {config.serial} is connected by USB but adb is not authorized. "
                        "Approve the USB debugging prompt on the phone."
                    )
                    notify_user(
                        "Android device authorization required",
                        f"Device {config.serial} is waiting for USB debugging authorization. "
                        "Please tap Allow on the phone.",
                    )
                    authorization_prompt_shown = True
            else:
                authorization_prompt_shown = False

            if config.enable_scrcpy_watch:
                previous_device_ready, last_scrcpy_attempt_monotonic = maybe_launch_scrcpy(
                    config.serial,
                    device_status,
                    previous_device_ready,
                    last_scrcpy_attempt_monotonic,
                    config.scrcpy_launch_cooldown,
                )
            else:
                previous_device_ready = is_device_ready(device_status)

            if is_device_ready(device_status):
                if config.enable_workday_check:
                    try:
                        workday_result = ensure_workday_status(config, state, datetime.now().date())
                    except Exception as exc:
                        log(f"Workday check failed, continuing with normal scheduling: {exc}")
                        workday_result = None
                    if workday_result and not workday_result.is_workday:
                        roll_windows_forward_for_non_workday(config, state, datetime.now().date())
                    else:
                        process_due_windows(config, state)
                else:
                    process_due_windows(config, state)
            time.sleep(config.poll_interval)
    except KeyboardInterrupt:
        log("Scheduler stopped by user.")
        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Persistent DingTalk scheduler and scrcpy reconnect manager for one Android device."
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=("run", "debug", "status", "schedule", "doctor"),
        default="run",
        help="run the scheduler, start debug mode with scrcpy, inspect status/schedule, or run diagnostics",
    )
    parser.add_argument(
        "--serial",
        help="adb device serial. If omitted, the script auto-selects the only online device.",
    )
    parser.add_argument(
        "--package",
        default=DEFAULT_PACKAGE,
        help=f"Android package name to control. Default: {DEFAULT_PACKAGE}",
    )
    parser.add_argument(
        "--app-label",
        default=DEFAULT_APP_LABEL,
        help=f"Visible app label used for MIUI recents cleanup. Default: {DEFAULT_APP_LABEL}",
    )
    parser.add_argument(
        "--delay-after-launch",
        type=int,
        default=DEFAULT_DELAY_AFTER_LAUNCH,
        help=f"Seconds to wait before force-stopping the app. Default: {DEFAULT_DELAY_AFTER_LAUNCH}",
    )
    parser.add_argument(
        "--adb-bin",
        help="Absolute path to adb. If omitted, the script searches common platform-tools locations.",
    )
    parser.add_argument(
        "--scrcpy-bin",
        help="Absolute path to scrcpy. If omitted, the script searches common install locations.",
    )
    parser.add_argument(
        "--enable-scrcpy-watch",
        action="store_true",
        help="Enable automatic scrcpy relaunch on reconnect during run mode.",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=DEFAULT_POLL_INTERVAL,
        help=f"Main loop poll interval in seconds. Default: {DEFAULT_POLL_INTERVAL}",
    )
    parser.add_argument(
        "--scrcpy-launch-cooldown",
        type=int,
        default=DEFAULT_SCRCPY_LAUNCH_COOLDOWN,
        help=(
            "Minimum seconds between scrcpy relaunch attempts after reconnect. "
            f"Default: {DEFAULT_SCRCPY_LAUNCH_COOLDOWN}"
        ),
    )
    parser.add_argument(
        "--state-file",
        default=DEFAULT_STATE_FILE,
        help=f"Path to the persisted scheduler state file. Default: {DEFAULT_STATE_FILE}",
    )
    parser.add_argument(
        "--disable-workday-check",
        action="store_true",
        help="Disable the online China workday check and always use the local schedule.",
    )
    parser.add_argument(
        "--workday-api-url",
        default=DEFAULT_WORKDAY_API_URL,
        help=f"China workday API URL template. Default: {DEFAULT_WORKDAY_API_URL}",
    )
    parser.add_argument(
        "--workday-api-timeout",
        type=float,
        default=DEFAULT_WORKDAY_API_TIMEOUT,
        help=f"Workday API timeout in seconds. Default: {DEFAULT_WORKDAY_API_TIMEOUT}",
    )
    parser.add_argument(
        "--notify-on-success",
        action="store_true",
        help="Show a macOS notification after a scheduled window completes successfully.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "schedule":
        return command_schedule(args)
    if args.command == "status":
        return command_status(args)
    if args.command == "doctor":
        return command_doctor(args)
    return command_run(args)


if __name__ == "__main__":
    sys.exit(main())
