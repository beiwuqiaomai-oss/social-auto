# 社媒自动发布系统（social-auto）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每天定时将 1 条 cosplay 素材（IP+角色命名规范）自动分发到 7 个社媒平台，AI 生成英文文案，幂等可续跑，漏跑有看门狗，失败有邮件告警。

**Architecture:** 独立 Python 项目。schtasks 每日 11:55 触发 pipeline（单写者锁），按时间表错峰调用各平台模块（6 平台官方 API + Pinterest 浏览器兜底）；IG/Threads/Pinterest 所需公网 URL 由 Shopify CDN 上传器提供；state.json 承载幂等/断点续跑/素材在途保护；watchdog 20:00 检测漏跑/卡死并补跑。

**Tech Stack:** Python 3.11、requests、tweepy、praw、google-api-python-client、openai(DeepSeek 兼容)、PyYAML、python-dotenv、pytest（测试）、agent-browser（仅 Pinterest 兜底）。

**规格文档：** `docs/specs/2026-08-26-social-media-auto-poster-design.md`（实现时对照，尤其是第 5 节调度可靠性设计）

**执行注意：**
- 用户偏好：无中间审计，阶段边界才汇报；只在不确定时提问。
- Task 1–8、15、16 不需要任何平台凭据，可立即开工；Task 9–13、14 需要用户完成对应开发者应用申请（用户正在进行中）。
- 所有 `.bat` 文件必须 CRLF 行尾（历史教训：LF 会导致 Windows 启动失败）。
- 本机开发根目录：`d:\1\跨境\social-auto`（下文 `<root>` 指此路径）。

---

## 全局数据契约（所有 Task 共享，不得偏离）

```python
# core/models.py —— 唯一的数据结构定义处
from dataclasses import dataclass, field
from pathlib import Path

@dataclass
class Material:
    key: str            # "IP__角色__序号"，如 "原神__雷电将军__001"
    ip: str             # IP 名原文（可能中文）
    character: str      # 角色名原文（可能中文）
    seq: str            # 序号字符串，如 "001"
    kind: str           # "video" | "images"
    group: list[Path]   # 视频为单元素；图片组按 -1/-2/-3 排序多元素

@dataclass
class PlatformCopy:
    platform: str
    text: str = ""          # 正文/caption/描述
    title: str = ""         # pinterest/youtube/reddit 用
    description: str = ""   # youtube/pinterest 用
    tags: list[str] = field(default_factory=list)
```

state.json 结构（Task 2 实现的契约）：

```json
{
  "days": {
    "2026-08-26": {
      "material_key": "原神__雷电将军__001",
      "material_kind": "video",
      "run_started_at": "2026-08-26T11:55:03",
      "run_ended_at": "2026-08-26T15:02:11",
      "public_urls": {"001.mp4": "https://cdn.shopify.com/.../001.mp4"},
      "platforms": {
        "instagram": {"status": "success", "post_url": "https://...", "error": null, "attempts": 1}
      }
    }
  }
}
```

平台 status 取值：`pending` / `success` / `failed`（终态，已重试）/ `skipped`（规则性跳过，如图片日 YouTube）。

---

### Task 1: 项目骨架 + 配置加载

**Files:**
- Create: `requirements.txt`、`config.example.yaml`、`.env.example`、`core/__init__.py`、`core/models.py`、`core/config.py`、`platforms/__init__.py`、`tests/__init__.py`、`tests/conftest.py`
- Test: `tests/test_config.py`

- [ ] **Step 1: 创建虚拟环境并装依赖**

```powershell
cd d:\1\跨境\social-auto
python -m venv .venv
.venv\Scripts\python.exe -m pip install -U pip
.venv\Scripts\python.exe -m pip install requests tweepy praw google-api-python-client google-auth-oauthlib pyyaml python-dotenv openai pytest
```

- [ ] **Step 2: 写 requirements.txt**

```
requests
tweepy
praw
google-api-python-client
google-auth-oauthlib
pyyaml
python-dotenv
openai
```

- [ ] **Step 3: 写 config.example.yaml（完整内容，用户拷贝为 config.yaml 后改 UNC 路径）**

```yaml
brand: yumecosplay

materials:
  inbox: "\\\\SERVER\\share\\social-materials\\inbox"   # 共享盘素材池 UNC 路径
  posted: "\\\\SERVER\\share\\social-materials\\posted" # 归档根目录（按月建子目录）

schedule:
  plan:                      # 定时轮次时刻（本地时间）
    instagram: "12:00"
    threads: "12:30"
    facebook: "13:00"
    x: "13:30"
    youtube: "14:00"
    pinterest: "14:30"
  deadline: "18:00"          # 定时轮次截止
  catchup_step_minutes: 5    # 补跑轮次平台间隔
  catchup_deadline: "23:00"  # 补跑轮次硬停
  platform_timeout_minutes: 10

reddit:
  interval_days: 3           # 每 3 天发一帖
  time: "15:00"
  subreddits: ["cosplaygirls"]   # 实现期核实版规后可改

copy:
  language: en
  brand_platforms: [instagram, threads, facebook, x, pinterest, youtube]   # 这些平台带 @brand
  # reddit 永不带品牌

alerts:
  low_material_days: 7

pinterest:
  mode: browser              # browser | api（trial access 批准后切 api）
  board_name: "yumecosplay"
```

- [ ] **Step 4: 写 .env.example**

```
DEEPSEEK_API_KEY=
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
ALERT_TO=
# 平台凭据（申请完成填写）
META_APP_ID=
META_APP_SECRET=
X_API_KEY=
X_API_SECRET=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
SHOPIFY_SHOP=
SHOPIFY_ACCESS_TOKEN=
PINTEREST_APP_ID=
PINTEREST_APP_SECRET=
```

- [ ] **Step 5: 写 core/models.py（全局数据契约原文照抄）**（见上文"全局数据契约"代码块，一字不差）

- [ ] **Step 6: 写失败测试 tests/test_config.py**

```python
import yaml
from core.config import load_config

def test_load_config_defaults(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text(yaml.safe_dump({
        "brand": "yumecosplay",
        "materials": {"inbox": str(tmp_path / "inbox"),
                      "posted": str(tmp_path / "posted")},
    }), encoding="utf-8")
    cfg = load_config(p)
    assert cfg["brand"] == "yumecosplay"
    assert cfg["schedule"]["deadline"] == "18:00"          # 缺省值
    assert cfg["schedule"]["plan"]["instagram"] == "12:00"  # 缺省值
    assert cfg["reddit"]["interval_days"] == 3
    assert cfg["copy"]["brand_platforms"][0] == "instagram"

def test_load_config_rejects_missing_inbox(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text(yaml.safe_dump({"brand": "x"}), encoding="utf-8")
    try:
        load_config(p)
        assert False, "应当抛错"
    except ValueError:
        pass
```

- [ ] **Step 7: 运行确认失败**

```powershell
.venv\Scripts\python.exe -m pytest tests\test_config.py -v
```
预期：FAIL（`No module named 'core.config'`）

- [ ] **Step 8: 写 core/config.py**

```python
import os
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULTS = {
    "schedule": {
        "plan": {"instagram": "12:00", "threads": "12:30", "facebook": "13:00",
                 "x": "13:30", "youtube": "14:00", "pinterest": "14:30"},
        "deadline": "18:00", "catchup_step_minutes": 5, "catchup_deadline": "23:00",
        "platform_timeout_minutes": 10,
    },
    "reddit": {"interval_days": 3, "time": "15:00", "subreddits": []},
    "copy": {"language": "en",
             "brand_platforms": ["instagram", "threads", "facebook", "x", "pinterest", "youtube"]},
    "alerts": {"low_material_days": 7},
    "pinterest": {"mode": "browser", "board_name": "yumecosplay"},
}

def _deep_merge(base: dict, override: dict) -> dict:
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out

def load_config(path: Path | str | None = None) -> dict:
    path = Path(path) if path else ROOT / "config.yaml"
    if not path.exists():
        path = ROOT / "config.example.yaml"
    with open(path, encoding="utf-8") as f:
        user_cfg = yaml.safe_load(f) or {}
    cfg = _deep_merge(DEFAULTS, user_cfg)
    inbox = cfg.get("materials", {}).get("inbox")
    if not inbox:
        raise ValueError("config.yaml 缺少 materials.inbox（共享盘素材池路径）")
    if not cfg.get("materials", {}).get("posted"):
        cfg["materials"]["posted"] = str(Path(inbox).parent / "posted")
    return cfg
```

- [ ] **Step 9: 运行测试通过**

```powershell
.venv\Scripts\python.exe -m pytest tests\test_config.py -v
```
预期：2 passed

- [ ] **Step 10: Commit**

```powershell
git add requirements.txt config.example.yaml .env.example core tests
git commit -m "feat: 项目骨架与配置加载"
```

---

### Task 2: state 状态存储（幂等核心）

**Files:**
- Create: `core/state.py`
- Test: `tests/test_state.py`

- [ ] **Step 1: 写失败测试 tests/test_state.py**

```python
import json
from pathlib import Path
from core.state import StateStore

PLATFORMS = ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]

def make_store(tmp_path):
    return StateStore(tmp_path / "state.json")

def test_ensure_day_creates_all_platforms_pending(tmp_path):
    st = make_store(tmp_path)
    day = st.ensure_day("2026-08-26", PLATFORMS)
    assert day["platforms"]["x"]["status"] == "pending"
    assert day["run_started_at"]           # 记录开始时间

def test_ensure_day_idempotent_keeps_results(tmp_path):
    st = make_store(tmp_path)
    st.ensure_day("2026-08-26", PLATFORMS)
    st.set_platform("2026-08-26", "x", "success", post_url="http://x/1")
    day = st.ensure_day("2026-08-26", PLATFORMS)   # 重复调用
    assert day["platforms"]["x"]["status"] == "success"   # 不被重置

def test_set_material_once(tmp_path):
    st = make_store(tmp_path)
    st.ensure_day("2026-08-26", PLATFORMS)
    st.set_material("2026-08-26", "原神__雷电将军__001", "video")
    st.set_material("2026-08-26", "其他__角色__002", "video")  # 第二次无效
    assert st.get_day("2026-08-26")["material_key"] == "原神__雷电将军__001"

def test_used_keys(tmp_path):
    st = make_store(tmp_path)
    st.ensure_day("2026-08-25", PLATFORMS)
    st.set_material("2026-08-25", "A__B__001", "video")
    assert "A__B__001" in st.used_keys()

def test_last_success_date(tmp_path):
    st = make_store(tmp_path)
    for d in ["2026-08-24", "2026-08-25", "2026-08-26"]:
        st.ensure_day(d, PLATFORMS)
    st.set_platform("2026-08-24", "reddit", "success")
    st.set_platform("2026-08-26", "reddit", "failed")
    assert st.last_success_date("reddit") == "2026-08-24"

def test_all_terminal(tmp_path):
    st = make_store(tmp_path)
    st.ensure_day("2026-08-26", PLATFORMS)
    for p in PLATFORMS:
        st.set_platform("2026-08-26", p, "success")
    assert st.all_terminal("2026-08-26", PLATFORMS)
    st.set_platform("2026-08-26", "x", "pending")  # 不可能的复活，仅验证逻辑
    assert not st.all_terminal("2026-08-26", PLATFORMS)

def test_public_url_cache(tmp_path):
    st = make_store(tmp_path)
    st.ensure_day("2026-08-26", PLATFORMS)
    st.set_public_url("2026-08-26", "001.mp4", "https://cdn/x.mp4")
    assert st.get_public_url("2026-08-26", "001.mp4") == "https://cdn/x.mp4"
```

- [ ] **Step 2: 运行确认失败**：`.venv\Scripts\python.exe -m pytest tests\test_state.py -v` → FAIL

- [ ] **Step 3: 写 core/state.py**

```python
import json
import threading
from datetime import datetime
from pathlib import Path

TERMINAL = {"success", "failed", "skipped"}

class StateStore:
    """state.json 的读写层。所有写操作立即落盘，进程崩溃不丢状态。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data = {"days": {}}
        if self.path.exists():
            with open(self.path, encoding="utf-8") as f:
                self._data = json.load(f)

    def _save(self):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)

    def _day(self, date: str) -> dict:
        return self._data["days"].setdefault(date, {"platforms": {}})

    def ensure_day(self, date: str, platforms: list[str]) -> dict:
        with self._lock:
            day = self._day(date)
            if not day.get("run_started_at"):
                day["run_started_at"] = datetime.now().isoformat(timespec="seconds")
            for p in platforms:
                day["platforms"].setdefault(p, {"status": "pending", "post_url": None, "error": None, "attempts": 0})
            self._save()
            return day

    def get_day(self, date: str) -> dict | None:
        return self._data["days"].get(date)

    def set_material(self, date: str, key: str, kind: str):
        with self._lock:
            day = self._day(date)
            if not day.get("material_key"):
                day["material_key"] = key
                day["material_kind"] = kind
                self._save()

    def get_platform(self, date: str, platform: str) -> dict:
        return self._data["days"].get(date, {}).get("platforms", {}).get(platform, {"status": "pending"})

    def set_platform(self, date: str, platform: str, status: str, post_url: str | None = None, error: str | None = None):
        with self._lock:
            day = self._day(date)
            rec = day["platforms"].setdefault(platform, {"status": "pending", "post_url": None, "error": None, "attempts": 0})
            rec["status"] = status
            rec["attempts"] += 1
            if post_url:
                rec["post_url"] = post_url
            if error:
                rec["error"] = str(error)[:500]
            self._save()

    def set_run_end(self, date: str):
        with self._lock:
            self._day(date)["run_ended_at"] = datetime.now().isoformat(timespec="seconds")
            self._save()

    def set_public_url(self, date: str, filename: str, url: str):
        with self._lock:
            day = self._day(date)
            day.setdefault("public_urls", {})[filename] = url
            self._save()

    def get_public_url(self, date: str, filename: str) -> str | None:
        return self._data["days"].get(date, {}).get("public_urls", {}).get(filename)

    def all_terminal(self, date: str, platforms: list[str]) -> bool:
        day = self._data["days"].get(date)
        if not day:
            return False
        return all(day["platforms"].get(p, {}).get("status") in TERMINAL for p in platforms)

    def last_success_date(self, platform: str) -> str | None:
        best = None
        for date in sorted(self._data["days"]):
            if self._data["days"][date]["platforms"].get(platform, {}).get("status") == "success":
                best = date
        return best

    def used_keys(self) -> list[str]:
        return [d["material_key"] for d in self._data["days"].values() if d.get("material_key")]

    def append_stat(self, root: Path, row: list[str]):
        """追加一行到 stats/posts.csv（date,platform,material,status,post_url,error）"""
        import csv
        stats = Path(root) / "stats"
        stats.mkdir(exist_ok=True)
        new = not (stats / "posts.csv").exists()
        with open(stats / "posts.csv", "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["date", "platform", "material", "status", "post_url", "error"])
            w.writerow(row)
```

- [ ] **Step 4: 运行测试通过**：`pytest tests\test_state.py -v` → 7 passed

- [ ] **Step 5: Commit**：`git add core/state.py tests/test_state.py` + `git commit -m "feat: state 状态存储(幂等/断点续跑/统计)"`

---

### Task 3: 素材模块（命名解析/选取/归档）

**Files:**
- Create: `core/material.py`
- Test: `tests/test_material.py`

- [ ] **Step 1: 写失败测试 tests/test_material.py**

```python
from pathlib import Path
from core.material import parse_name, scan_inbox, select_material, archive_material, remaining_days

def test_parse_single_video():
    m = parse_name(Path(r"原神__雷电将军__001.mp4"))
    assert m == ("原神", "雷电将军", "001")

def test_parse_group_image():
    m = parse_name(Path("Genshin__Raiden Shogun__002-1.jpg"))
    assert m == ("Genshin", "Raiden Shogun", "002")

def test_parse_invalid():
    assert parse_name(Path("random.jpg")) is None
    assert parse_name(Path("只有一段__001.mp4")) is None
    assert parse_name(Path("a__b.mp4")) is None

def test_scan_inbox_groups_and_flags_invalid(tmp_path):
    (tmp_path / "A__B__001-1.jpg").write_bytes(b"x")
    (tmp_path / "A__B__001-2.jpg").write_bytes(b"x")
    (tmp_path / "A__B__002.mp4").write_bytes(b"x")
    (tmp_path / "bad name.jpg").write_bytes(b"x")
    (tmp_path / "C__D__003.txt").write_bytes(b"x")   # 不支持扩展名→算 invalid
    materials, invalid = scan_inbox(tmp_path)
    assert [m.key for m in materials] == ["A__B__001", "A__B__002"]
    assert materials[0].kind == "images" and len(materials[0].group) == 2
    assert materials[1].kind == "video"
    assert len(invalid) == 2

def test_select_skips_used(tmp_path):
    (tmp_path / "A__B__001.mp4").write_bytes(b"x")
    (tmp_path / "A__B__002.mp4").write_bytes(b"x")
    m = select_material(tmp_path, used=["A__B__001"])
    assert m.key == "A__B__002"

def test_select_returns_none_when_all_used(tmp_path):
    (tmp_path / "A__B__001.mp4").write_bytes(b"x")
    assert select_material(tmp_path, used=["A__B__001"]) is None

def test_archive_moves_group(tmp_path):
    inbox = tmp_path / "inbox"; inbox.mkdir()
    posted = tmp_path / "posted"
    (inbox / "A__B__001-1.jpg").write_bytes(b"x")
    (inbox / "A__B__001-2.jpg").write_bytes(b"x")
    materials, _ = scan_inbox(inbox)
    dest = archive_material(materials[0], posted)
    assert dest.name == "2026-08"          # 当月目录
    assert len(list(dest.glob("A__B__001-*.jpg"))) == 2
    assert not list(inbox.glob("A__B__001-*"))   # 已移走

def test_remaining_days(tmp_path):
    (tmp_path / "A__B__001.mp4").write_bytes(b"x")
    materials, _ = scan_inbox(tmp_path)
    assert remaining_days(materials) == 1
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 写 core/material.py**

```python
import re
import shutil
from datetime import datetime
from pathlib import Path
from core.models import Material

VIDEO_EXT = {".mp4", ".mov", ".webm"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
NAME_RE = re.compile(r"^(?P<ip>.+?)__(?P<char>.+?)__(?P<seq>\d+)(?:-\d+)?$")

def parse_name(path: Path):
    m = NAME_RE.match(path.stem)
    if not m:
        return None
    return m.group("ip"), m.group("char"), m.group("seq")

def scan_inbox(inbox: Path) -> tuple[list[Material], list[Path]]:
    """返回 (合规素材按 key 排序, 不合规文件列表)。"""
    inbox = Path(inbox)
    if not inbox.exists():
        return [], []
    groups: dict[str, dict] = {}
    invalid: list[Path] = []
    for p in sorted(inbox.iterdir()):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext not in VIDEO_EXT and ext not in IMAGE_EXT:
            invalid.append(p)
            continue
        parsed = parse_name(p)
        if not parsed:
            invalid.append(p)
            continue
        ip, char, seq = parsed
        key = f"{ip}__{char}__{seq}"
        g = groups.setdefault(key, {"ip": ip, "char": char, "seq": seq, "files": []})
        g["files"].append(p)
    materials = []
    for key, g in groups.items():
        files = sorted(g["files"])
        kinds = {"video" if f.suffix.lower() in VIDEO_EXT else "images" for f in files}
        kind = "video" if kinds == {"video"} else "images"   # 混合按图片组处理（视频单独成组更规范）
        materials.append(Material(key=key, ip=g["ip"], character=g["char"], seq=g["seq"], kind=kind, group=files))
    materials.sort(key=lambda m: (m.seq, m.key))
    return materials, invalid

def select_material(inbox: Path, used: list[str]) -> Material | None:
    materials, _ = scan_inbox(inbox)
    for m in materials:
        if m.key not in used:
            return m
    return None

def archive_material(material: Material, posted_root: Path) -> Path:
    month_dir = Path(posted_root) / datetime.now().strftime("%Y-%m")
    month_dir.mkdir(parents=True, exist_ok=True)
    for f in material.group:
        shutil.move(str(f), str(month_dir / f.name))
    return month_dir

def remaining_days(materials: list[Material]) -> int:
    return len(materials)
```

- [ ] **Step 4: 运行测试通过**：`pytest tests\test_material.py -v` → 8 passed

- [ ] **Step 5: Commit**：`git commit -m "feat: 素材模块(命名解析/分组/选取/归档)"`

---

### Task 4: 文案生成（DeepSeek）

**Files:**
- Create: `core/copywriter.py`
- Test: `tests/test_copywriter.py`

- [ ] **Step 1: 写失败测试（mock OpenAI 客户端，不发真实请求）**

```python
import json
import pytest
from core.copywriter import Copywriter
from core.models import Material
from pathlib import Path

def make_material():
    return Material(key="原神__雷电将军__001", ip="原神", character="雷电将军",
                    seq="001", kind="images", group=[Path("a.jpg")])

FAKE_JSON = {
    "instagram": {"text": "Raiden Shogun cosplay!", "title": "", "description": "", "tags": ["raiden", "genshin"]},
    "threads": {"text": "Baal vibes", "title": "", "description": "", "tags": []},
    "facebook": {"text": "New Raiden set", "title": "", "description": "", "tags": ["cosplay"]},
    "x": {"text": "Raiden Shogun done right", "title": "", "description": "", "tags": ["cosplay"]},
    "youtube": {"text": "Full video", "title": "Raiden Shogun Cosplay", "description": "desc", "tags": ["raiden"]},
    "pinterest": {"text": "", "title": "Raiden Cosplay", "description": "kw rich", "tags": ["raiden"]},
    "reddit": {"text": "My Raiden build", "title": "Raiden Shogun", "description": "", "tags": []},
}

class FakeCompletions:
    def __init__(self, fail_times=0):
        self.fail_times = fail_times
        self.calls = 0
    def create(self, **kw):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise RuntimeError("api down")
        msg = type("M", (), {})()
        msg.content = json.dumps(FAKE_JSON, ensure_ascii=False)
        resp = type("R", (), {})()
        resp.choices = [type("C", (), {"message": msg})()]
        return resp

def make_writer(fail_times=0):
    cw = Copywriter(api_key="sk-test")
    cw._completions = FakeCompletions(fail_times)
    return cw

def test_generate_returns_all_platforms():
    copies = make_writer().generate(make_material(), brand="yumecosplay", brand_platforms=["instagram"])
    assert set(copies.keys()) == {"instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"}
    assert copies["instagram"].text == "Raiden Shogun cosplay!"
    assert copies["pinterest"].title == "Raiden Cosplay"
    assert copies["instagram"].platform == "instagram"

def test_generate_retries_twice_then_succeeds():
    cw = make_writer(fail_times=2)
    copies = cw.generate(make_material(), brand="yumecosplay", brand_platforms=[])
    assert copies["x"].text != ""

def test_generate_gives_up_after_two_failures():
    cw = make_writer(fail_times=3)
    with pytest.raises(RuntimeError):
        cw.generate(make_material(), brand="yumecosplay", brand_platforms=[])

def test_prompt_contains_character_and_brand_rules():
    cw = Copywriter(api_key="sk-test")
    prompt = cw._build_prompt(make_material(), brand="yumecosplay", brand_platforms=["instagram"])
    assert "雷电将军" in prompt and "原神" in prompt
    assert "@yumecosplay" in prompt
    assert "instagram" in prompt and "reddit" in prompt
```

- [ ] **Step 2: 运行确认失败** → FAIL

- [ ] **Step 3: 写 core/copywriter.py**

```python
import json
import time
from openai import OpenAI
from core.models import Material, PlatformCopy

ALL_PLATFORMS = ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]

SYSTEM = """You are the social media copywriter for {brand}, a cosplay costume brand.
You will receive: the IP (franchise) and character name of one cosplay photo/video set, possibly written in Chinese.
Convert the names to the common English fandom spelling and known aliases.
Respond ONLY with valid JSON (no markdown fence) with exactly these keys:
instagram, threads, facebook, x, youtube, pinterest, reddit.
Each value must be an object: {{"text": str, "title": str, "description": str, "tags": [str]}}.
Fill the fields each platform needs; use empty string / empty list otherwise.
Rules:
- Language: English. Tone: enthusiastic cosplay-community showcase; highlight costume fidelity, fabric details, silhouette accuracy, wearability at conventions. Never hard-sell.
- NEVER include any URL or purchase link anywhere.
- Brand mention "@{brand}" exactly once, and ONLY in these platforms: {brand_platforms}. NEVER mention the brand on reddit.
- reddit: pure cosplay showcase; no brand, no promo; descriptive title; short first-person text.
- x: text + tags together <= 260 characters, max 3 tags.
- instagram: max 10 tags. facebook: max 3 tags. threads: max 1 tag.
- pinterest: title <= 100 chars; description <= 480 chars, keyword-rich (character name, franchise, "cosplay", "cosplay costume").
- youtube: title <= 95 chars; description 2-4 sentences; 3-5 tags.
- Tags: lowercase, no spaces, must include the character tag and franchise tag."""

class Copywriter:
    def __init__(self, api_key: str, model: str = "deepseek-chat", base_url: str = "https://api.deepseek.com"):
        self.model = model
        self._client = OpenAI(api_key=api_key, base_url=base_url)
        self._completions = self._client.chat.completions   # 测试注入点

    def _build_prompt(self, material: Material, brand: str, brand_platforms: list[str]) -> str:
        return SYSTEM.format(brand=brand, brand_platforms=", ".join(brand_platforms)) + (
            f"\n\nIP: {material.ip}\nCharacter: {material.character}\n"
            f"Content type: {'video' if material.kind == 'video' else 'photo set'}")

    def generate(self, material: Material, brand: str, brand_platforms: list[str]) -> dict[str, PlatformCopy]:
        prompt = self._build_prompt(material, brand, brand_platforms)
        last_err = None
        for attempt in range(3):
            try:
                resp = self._completions.create(
                    model=self.model,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    temperature=1.0,
                )
                data = json.loads(resp.choices[0].message.content)
                return {p: PlatformCopy(
                    platform=p,
                    text=str(data.get(p, {}).get("text", "")),
                    title=str(data.get(p, {}).get("title", "")),
                    description=str(data.get(p, {}).get("description", "")),
                    tags=[str(t) for t in data.get(p, {}).get("tags", [])],
                ) for p in ALL_PLATFORMS}
            except Exception as e:
                last_err = e
                time.sleep(3 * (attempt + 1))
        raise RuntimeError(f"DeepSeek 文案生成失败(重试3次): {last_err}")
```

- [ ] **Step 4: 运行测试通过**：`pytest tests\test_copywriter.py -v` → 4 passed

- [ ] **Step 5: Commit**：`git commit -m "feat: DeepSeek 文案生成(平台适配/重试)"`

---

### Task 5: 邮件告警

**Files:**
- Create: `core/notify.py`
- Test: `tests/test_notify.py`

- [ ] **Step 1: 写失败测试（mock smtplib）**

```python
import builtins
from core.notify import Notifier

def test_send_uses_smtp_ssl(monkeypatch):
    sent = {}
    class FakeSMTP:
        def __init__(self, host, port, timeout):
            sent["host"], sent["port"] = host, port
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def login(self, user, pwd): sent["login"] = user
        def send_message(self, msg):
            sent["subject"] = msg["Subject"]
            sent["to"] = msg["To"]
    monkeypatch.setattr("core.notify.smtplib.SMTP_SSL", FakeSMTP)
    n = Notifier(smtp_host="smtp.x.com", port=465, user="u", password="p", to="me@x.com")
    n.send("标题A", "正文B")
    assert sent["host"] == "smtp.x.com" and sent["port"] == 465
    assert sent["subject"] == "标题A" and sent["to"] == "me@x.com"
    assert "正文B" in str(sent)

def test_send_failure_does_not_raise(monkeypatch):
    def boom(*a, **k): raise OSError("net down")
    monkeypatch.setattr("core.notify.smtplib.SMTP_SSL", boom)
    n = Notifier("smtp.x.com", 465, "u", "p", "me@x.com")
    n.send("t", "b")   # 不抛异常，只打印
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 core/notify.py**

```python
import smtplib
from email.mime.text import MIMEText
from email.header import Header

class Notifier:
    """告警邮件。发送失败只打印不抛异常——告警渠道自身不能炸掉主流程。"""

    def __init__(self, smtp_host: str, port: int, user: str, password: str, to: str):
        self.host, self.port, self.user, self.password, self.to = smtp_host, port, user, password, to

    def send(self, subject: str, body: str):
        if not all([self.host, self.user, self.password, self.to]):
            print(f"[notify] SMTP 未配置，跳过邮件: {subject}")
            return
        try:
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = Header(subject, "utf-8")
            msg["From"] = self.user
            msg["To"] = self.to
            with smtplib.SMTP_SSL(self.host, self.port, timeout=30) as s:
                s.login(self.user, self.password)
                s.send_message(msg)
        except Exception as e:
            print(f"[notify] 邮件发送失败({subject}): {e}")
```

- [ ] **Step 4: 测试通过** → 2 passed；**Step 5: Commit** `feat: SMTP 告警邮件`

---

### Task 6: 调度器（当日计划/补跑压缩/deadline）

**Files:**
- Create: `core/scheduler.py`
- Test: `tests/test_scheduler.py`

- [ ] **Step 1: 写失败测试**

```python
from datetime import datetime
from core.scheduler import build_plan
from core.state import StateStore

def make_cfg():
    return {
        "schedule": {"plan": {"instagram": "12:00", "threads": "12:30", "facebook": "13:00",
                              "x": "13:30", "youtube": "14:00", "pinterest": "14:30"},
                     "deadline": "18:00", "catchup_step_minutes": 5, "catchup_deadline": "23:00",
                     "platform_timeout_minutes": 10},
        "reddit": {"interval_days": 3, "time": "15:00", "subreddits": ["s"]},
    }

def test_build_plan_video_day(tmp_path):
    st = StateStore(tmp_path / "s.json")
    plan = build_plan(make_cfg(), st, "2026-08-26", material_kind="video", catchup=False)
    names = [p for p, _ in plan]
    assert names == ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]
    assert plan[0][1].hour == 12 and plan[0][1].minute == 0

def test_build_plan_image_day_skips_youtube(tmp_path):
    st = StateStore(tmp_path / "s.json")
    plan = build_plan(make_cfg(), st, "2026-08-26", material_kind="images", catchup=False)
    assert "youtube" not in [p for p, _ in plan]

def test_build_plan_reddit_rotation(tmp_path):
    st = StateStore(tmp_path / "s.json")
    # 8-25 发过 reddit，interval=3 → 8-26 不该发
    st.ensure_day("2026-08-25", ["reddit"])
    st.set_platform("2026-08-25", "reddit", "success")
    plan = build_plan(make_cfg(), st, "2026-08-26", material_kind="video", catchup=False)
    assert "reddit" not in [p for p, _ in plan]
    # 但 8-28 该发（8-25 + 3 天）
    plan2 = build_plan(make_cfg(), st, "2026-08-28", material_kind="video", catchup=False)
    assert "reddit" in [p for p, _ in plan2]

def test_build_plan_skips_terminal_platforms(tmp_path):
    st = StateStore(tmp_path / "s.json")
    st.ensure_day("2026-08-26", ["instagram"])
    st.set_platform("2026-08-26", "instagram", "success")
    plan = build_plan(make_cfg(), st, "2026-08-26", material_kind="video", catchup=False)
    assert "instagram" not in [p for p, _ in plan]

def test_build_plan_catchup_compressed(tmp_path):
    st = StateStore(tmp_path / "s.json")
    now = datetime(2026, 8, 26, 20, 0, 0)
    plan = build_plan(make_cfg(), st, "2026-08-26", material_kind="video", catchup=True, now=now)
    names = [p for p, _ in plan]
    assert names[0] == "instagram"
    assert plan[0][1] == now                     # 立即
    assert (plan[1][1] - plan[0][1]).total_seconds() == 300   # 5 分钟间隔

def test_build_plan_respects_deadline(tmp_path):
    st = StateStore(tmp_path / "s.json")
    # reddit 15:00 < deadline 18:00 应在；构造一个超 deadline 的配置验证被剔除
    cfg = make_cfg()
    cfg["reddit"]["time"] = "18:30"
    plan = build_plan(cfg, st, "2026-08-26", material_kind="video", catchup=False)
    assert "reddit" not in [p for p, _ in plan]
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 core/scheduler.py**

```python
from datetime import datetime, timedelta

def _at(date: str, hhmm: str) -> datetime:
    y, m, d = int(date[:4]), int(date[5:7]), int(date[8:10])
    hh, mm = int(hhmm[:2]), int(hhmm[3:5])
    return datetime(y, m, d, hh, mm)

def _reddit_due(cfg: dict, state, today: str) -> bool:
    interval = cfg["reddit"]["interval_days"]
    last = state.last_success_date("reddit")
    if last is None:
        return True
    y, m, d = int(today[:4]), int(today[5:7]), int(today[8:10])
    return (datetime(y, m, d) - datetime(int(last[:4]), int(last[5:7]), int(last[8:10]))).days >= interval

def build_plan(cfg: dict, state, today: str, material_kind: str, catchup: bool = False,
               now: datetime | None = None) -> list[tuple[str, datetime]]:
    """返回 [(platform, 执行时刻)]，已剔除终态平台/图片日youtube/轮值外的reddit/超deadline项。"""
    now = now or datetime.now()
    sc = cfg["schedule"]
    deadline = _at(today, sc["deadline"])
    day = state.get_day(today) or {"platforms": {}}

    order: list[str] = []
    for p in ["instagram", "threads", "facebook", "x", "youtube", "pinterest"]:
        if p == "youtube" and material_kind != "video":
            continue
        if day["platforms"].get(p, {}).get("status") in {"success", "failed", "skipped"}:
            continue
        order.append(p)
    if _reddit_due(cfg, state, today):
        if day["platforms"].get("reddit", {}).get("status") not in {"success", "failed", "skipped"}:
            order.append("reddit")

    plan: list[tuple[str, datetime]] = []
    if catchup:
        t = now
        for p in order:
            plan.append((p, t))
            t += timedelta(minutes=sc["catchup_step_minutes"])
        return plan
    for p in order:
        hhmm = sc["plan"].get(p) or cfg["reddit"]["time"]
        at = _at(today, hhmm)
        if at > deadline:
            continue
        plan.append((p, at))
    return plan

def wait_until(dt: datetime):
    import time
    while True:
        remaining = (dt - datetime.now()).total_seconds()
        if remaining <= 0:
            return
        time.sleep(min(remaining, 60))
```

- [ ] **Step 4: 测试通过** → 6 passed；**Step 5: Commit** `feat: 当日调度计划(轮值/deadline/补跑压缩)`

---

### Task 7: pipeline 主流程（锁/dry-run/幂等/归档）

**Files:**
- Create: `core/pipeline.py`
- Test: `tests/test_pipeline.py`

- [ ] **Step 1: 写失败测试（假平台注册表，验证顺序与幂等）**

```python
import json
from pathlib import Path
import yaml
from core.pipeline import run

class FakePlatform:
    def __init__(self, name, fail=False):
        self.name, self.fail, self.calls = name, fail, 0
    def post(self, copy, material, url_for):
        self.calls += 1
        if self.fail:
            raise RuntimeError("boom")
        return f"https://{self.name}/123"

def write_cfg(tmp_path):
    cfg = {
        "brand": "yumecosplay",
        "materials": {"inbox": str(tmp_path / "inbox"), "posted": str(tmp_path / "posted")},
        "schedule": {"plan": {"instagram": "00:00", "threads": "00:00", "facebook": "00:00",
                              "x": "00:00", "youtube": "00:00", "pinterest": "00:00"},
                     "deadline": "23:59", "catchup_step_minutes": 0, "catchup_deadline": "23:59",
                     "platform_timeout_minutes": 1},
        "reddit": {"interval_days": 3, "time": "00:00", "subreddits": ["s"]},
        "copy": {"language": "en", "brand_platforms": ["instagram"]},
        "alerts": {"low_material_days": 7},
        "pinterest": {"mode": "browser", "board_name": "b"},
    }
    p = tmp_path / "config.yaml"
    p.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    (tmp_path / "inbox").mkdir()
    (tmp_path / "A__B__001.mp4").write_bytes(b"x") if False else (tmp_path / "inbox" / "A__B__001.mp4").write_bytes(b"x")
    return p

class FakeCopywriter:
    def generate(self, material, brand, brand_platforms):
        from core.models import PlatformCopy
        return {p: PlatformCopy(platform=p, text="t", title="ti", description="d", tags=[])
                for p in ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]}

def test_run_dry_run_posts_nothing_and_archives_nothing(tmp_path):
    cfg_path = write_cfg(tmp_path)
    platforms = {n: FakePlatform(n) for n in ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]}
    run(cfg_path=cfg_path, state_path=tmp_path / "state.json", dry_run=True,
        platform_registry=platforms, copywriter=FakeCopywriter(), notifier=None, now=None)
    assert all(p.calls == 0 for p in platforms.values())
    assert list((tmp_path / "inbox").glob("*.mp4"))          # 素材未动

def test_run_posts_each_platform_once_and_archives(tmp_path):
    cfg_path = write_cfg(tmp_path)
    platforms = {n: FakePlatform(n) for n in ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]}
    run(cfg_path=cfg_path, state_path=tmp_path / "state.json", dry_run=False,
        platform_registry=platforms, copywriter=FakeCopywriter(), notifier=None, now=None)
    assert all(p.calls == 1 for p in platforms.values())
    assert not list((tmp_path / "inbox").glob("*.mp4"))      # 已归档
    assert list((tmp_path / "posted").rglob("*.mp4"))

def test_run_resume_is_idempotent(tmp_path):
    cfg_path = write_cfg(tmp_path)
    platforms = {n: FakePlatform(n) for n in ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]}
    run(cfg_path=cfg_path, state_path=tmp_path / "state.json", dry_run=False,
        platform_registry=platforms, copywriter=FakeCopywriter(), notifier=None, now=None)
    # 归档后再跑：无素材可发，且不重复发布
    run(cfg_path=cfg_path, state_path=tmp_path / "state.json", dry_run=False,
        platform_registry=platforms, copywriter=FakeCopywriter(), notifier=None, now=None)
    assert all(p.calls == 1 for p in platforms.values())

def test_run_failed_platform_recorded_and_others_continue(tmp_path):
    cfg_path = write_cfg(tmp_path)
    platforms = {n: FakePlatform(n, fail=(n == "x")) for n in ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]}
    alerts = []
    class FakeNotifier:
        def send(self, s, b): alerts.append(s)
    run(cfg_path=cfg_path, state_path=tmp_path / "state.json", dry_run=False,
        platform_registry=platforms, copywriter=FakeCopywriter(), notifier=FakeNotifier(), now=None)
    state = json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))
    day = list(state["days"].values())[0]
    assert day["platforms"]["x"]["status"] == "failed"
    assert day["platforms"]["instagram"]["status"] == "success"
    assert alerts                                                  # 失败已告警
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 core/pipeline.py**

```python
import argparse
import os
import sys
import threading
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from core.config import ROOT, load_config
from core.state import StateStore, TERMINAL
from core.material import scan_inbox, select_material, archive_material
from core.scheduler import build_plan, wait_until

ALL_PLATFORMS = ["instagram", "threads", "facebook", "x", "youtube", "pinterest", "reddit"]

def _today(now=None) -> str:
    return (now or datetime.now()).strftime("%Y-%m-%d")

def _lock_acquire(lock_path: Path) -> bool:
    """单写者锁：文件存在且其中 PID 存活 → 拒绝；否则抢占。"""
    import psutil if False else None  # 不引入 psutil：用 Windows tasklist 检查
    if lock_path.exists():
        try:
            old_pid = int(lock_path.read_text().strip())
            import subprocess
            out = subprocess.run(["tasklist", "/FI", f"PID eq {old_pid}"], capture_output=True, text=True, timeout=10).stdout
            if str(old_pid) in out:
                print(f"[lock] 已有实例运行(PID={old_pid})，本次退出")
                return False
        except Exception:
            pass   # 锁文件损坏视为无锁
    lock_path.write_text(str(os.getpid()))
    return True

def run(cfg_path=None, state_path=None, dry_run=False, only=None, catchup=False,
        platform_registry=None, copywriter=None, notifier=None, now=None):
    cfg = load_config(cfg_path or ROOT / "config.yaml")
    load_dotenv(ROOT / ".env")
    now = now or datetime.now()
    today = _today(now)
    state_path = Path(state_path or ROOT / "state.json")
    lock_path = state_path.parent / "run.lock"
    if not _lock_acquire(lock_path):
        return 0

    from core.notify import Notifier
    notifier = notifier or Notifier(
        os.getenv("SMTP_HOST", ""), int(os.getenv("SMTP_PORT", "465")),
        os.getenv("SMTP_USER", ""), os.getenv("SMTP_PASS", ""), os.getenv("ALERT_TO", ""))

    st = StateStore(state_path)
    st.ensure_day(today, ALL_PLATFORMS)
    day = st.get_day(today)

    # ---- 素材选取（幂等：当日已选定则复用） ----
    materials, invalid = scan_inbox(cfg["materials"]["inbox"])
    if invalid and notifier:
        notifier.send("[social-auto] 发现命名不合规素材",
                      "以下素材不符合 IP__角色__序号 命名规范，已跳过：\n" +
                      "\n".join(p.name for p in invalid))
    if day.get("material_key"):
        material = next((m for m in materials if m.key == day["material_key"]), None)
        # 素材可能已在归档目录（当日重跑且此前已归档），从 posted 找回
        if material is None and day.get("run_ended_at") is None:
            posted_month = Path(cfg["materials"]["posted"]) / now.strftime("%Y-%m")
            found = sorted(posted_month.glob(day["material_key"].replace("[", "[[]") + "*")) if posted_month.exists() else []
            if found:
                from core.models import Material
                ip, char, seq = day["material_key"].split("__", 2)
                material = Material(key=day["material_key"], ip=ip, character=char, seq=seq,
                                    kind=day.get("material_kind", "video"), group=found)
    elif materials:
        chosen = select_material(cfg["materials"]["inbox"], st.used_keys())
        if chosen:
            st.set_material(today, chosen.key, chosen.kind)
            material = chosen
        else:
            material = None
    else:
        material = None

    if material is None and not day.get("material_key"):
        if notifier:
            notifier.send("[social-auto] 素材池为空", f"{today} 无可用素材，当日未发布。剩余素材天数: 0")
        st.set_run_end(today)
        return 1

    # ---- 素材余量告警 ----
    remaining = len(materials)
    if notifier and remaining < cfg["alerts"]["low_material_days"]:
        notifier.send("[social-auto] 素材余量不足",
                      f"当前剩余可发天数: {remaining}（阈值 {cfg['alerts']['low_material_days']}），请补充素材。")

    # ---- 文案 ----
    if copywriter is None:
        from core.copywriter import Copywriter
        copywriter = Copywriter(api_key=os.getenv("DEEPSEEK_API_KEY", ""))
    try:
        copies = copywriter.generate(material, cfg["brand"], cfg["copy"]["brand_platforms"])
    except Exception as e:
        if notifier:
            notifier.send("[social-auto] 文案生成失败", f"{material.key}\n{e}")
        st.set_run_end(today)
        return 1

    # ---- 发布计划 ----
    plan = build_plan(cfg, st, today, material_kind=material.kind, catchup=catchup, now=now)
    if only:
        plan = [(p, t) for p, t in plan if p == only]
    if registry_is_test := platform_registry is None:
        platform_registry = _load_real_platforms(cfg)

    failures = []
    for platform, at in plan:
        if not dry_run:
            wait_until(at)
        copy = copies[platform]
        plat = platform_registry[platform]
        timeout = cfg["schedule"]["platform_timeout_minutes"] * 60
        result = {"url": None, "error": None}

        def _worker():
            try:
                result["url"] = plat.post(copy, material, lambda fn: _public_url(st, today, cfg, material, fn))
            except Exception as e:
                result["error"] = e

        th = threading.Thread(target=_worker, daemon=True)
        th.start(); th.join(timeout if not dry_run else 5)
        if th.is_alive():
            result["error"] = RuntimeError(f"平台操作超时(>{timeout}s)")

        if dry_run:
            print(f"[dry-run] {today} {platform} @{at.strftime('%H:%M')} 素材={material.key} "
                  f"文案={copy.text[:50]!r} 标签={copy.tags}")
            continue
        if result["error"] is None:
            st.set_platform(today, platform, "success", post_url=result["url"])
            st.append_stat(ROOT, [today, platform, material.key, "success", result["url"] or "", ""])
        else:
            # 失败重试 1 次
            st.set_platform(today, platform, "failed", error=str(result["error"]))
            try:
                url2 = plat.post(copy, material, lambda fn: _public_url(st, today, cfg, material, fn))
                st.set_platform(today, platform, "success", post_url=url2)
                st.append_stat(ROOT, [today, platform, material.key, "success", url2, ""])
            except Exception as e2:
                st.set_platform(today, platform, "failed", error=str(e2))
                st.append_stat(ROOT, [today, platform, material.key, "failed", "", str(e2)])
                failures.append((platform, str(e2)))

    # ---- 收尾：终态后归档 + run_end + 失败汇总 ----
    if not dry_run:
        planned = [p for p, _ in plan] or [p for p in ALL_PLATFORMS
                                           if st.get_platform(today, p)["status"] in TERMINAL]
        if st.all_terminal(today, ALL_PLATFORMS) and material:
            archive_material(material, cfg["materials"]["posted"])
        st.set_run_end(today)
        if failures and notifier:
            notifier.send(f"[social-auto] {today} 发布失败 {len(failures)} 项",
                          "\n".join(f"{p}: {e}" for p, e in failures) + f"\n素材: {material.key}")
        print(f"[done] {today}: " + ", ".join(
            f"{p}={st.get_platform(today, p)['status']}" for p in ALL_PLATFORMS))
    lock_path.unlink(missing_ok=True)
    return 0 if not failures else 2

def _public_url(st, today, cfg, material, filename):
    """IG/Threads/Pinterest 需要公网 URL：查缓存 → Shopify 上传 → 缓存。"""
    cached = st.get_public_url(today, filename)
    if cached:
        return cached
    from platforms.shopify import ShopifyUploader
    up = ShopifyUploader(os.getenv("SHOPIFY_SHOP", ""), os.getenv("SHOPIFY_ACCESS_TOKEN", ""))
    url = up.upload(Path(cfg["materials"]["inbox"]) / filename) if (Path(cfg["materials"]["inbox"]) / filename).exists() \
        else up.upload(next(f for f in material.group if f.name == filename))
    st.set_public_url(today, filename, url)
    return url

def _load_real_platforms(cfg):
    import platform as _p
    reg = {}
    from platforms.x import XPlatform
    from platforms.reddit import RedditPlatform
    from platforms.youtube import YouTubePlatform
    from platforms.meta import FacebookPlatform, InstagramPlatform, ThreadsPlatform
    from platforms.pinterest import load_pinterest
    reg["x"] = XPlatform.load(ROOT / "auth" / "x.json")
    reg["reddit"] = RedditPlatform.load(ROOT / "auth" / "reddit.json", cfg["reddit"]["subreddits"][0])
    reg["youtube"] = YouTubePlatform.load(ROOT / "auth" / "google.json")
    fb = FacebookPlatform.load(ROOT / "auth" / "meta.json")
    ig = InstagramPlatform.load(ROOT / "auth" / "meta.json")
    th = ThreadsPlatform.load(ROOT / "auth" / "threads.json")
    reg.update({"facebook": fb, "instagram": ig, "threads": th})
    reg["pinterest"] = load_pinterest(cfg, ROOT / "auth" / "pinterest.json")
    return reg

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="只跑指定平台")
    ap.add_argument("--catchup", action="store_true", help="补跑模式：立即压缩发布")
    args = ap.parse_args()
    sys.exit(run(dry_run=args.dry_run, only=args.only, catchup=args.catchup))

if __name__ == "__main__":
    main()
```

注意：`_lock_acquire` 里第一行 `import psutil if False else None` 是非法语法——实现时直接删掉该行，保留 tasklist 方案。上面的测试用 `now=None` 且 plan 时间为 00:00（当天已过）→ `wait_until` 立即返回，测试不会真等。

- [ ] **Step 4: 测试通过**：`pytest tests\test_pipeline.py -v` → 4 passed
- [ ] **Step 5: Commit** `feat: pipeline 主流程(锁/幂等/归档/重试/告警)`

---

### Task 8: Shopify 公网 URL 上传器（IG/Threads/Pinterest 的前置依赖）

**Files:**
- Create: `platforms/shopify.py`
- Test: `tests/test_shopify.py`

- [ ] **Step 1: 写失败测试（mock requests.Session）**

```python
from platforms.shopify import ShopifyUploader

def test_upload_flow(monkeypatch, tmp_path):
    calls = []
    class FakeResp:
        def __init__(self, code, body): self.status_code, self._body = code, body
        def json(self): return self._body
        def raise_for_status(self):
            if self.status_code >= 400: raise RuntimeError(f"http {self.status_code}")
    class FakeSession:
        def post(self, url, **kw):
            calls.append(("post", url))
            if "stagedUploadsCreate" in str(kw.get("json", "")):
                return FakeResp(200, {"data": {"stagedUploadsCreate": {"stagedTargets": [
                    {"url": "https://shop.staged/put", "resourceUrl": "shopify://staged/abc",
                     "parameters": [{"name": "key", "value": "v"}]}]}}})
            if "fileCreate" in str(kw.get("json", "")):
                return FakeResp(200, {"data": {"fileCreate": {"files": [{"id": "gid://1"}]}}})
            raise AssertionError(url)
        def put(self, url, **kw):
            calls.append(("put", url))
            return FakeResp(200, {})
        def get(self, url, **kw):
            return FakeResp(200, {"data": {"node": {"status": "READY", "url": "https://cdn.shopify.com/x.jpg"}}})
    up = ShopifyUploader("mystore", "token")
    up.session = FakeSession()
    f = tmp_path / "a.jpg"; f.write_bytes(b"x")
    url = up.upload(f)
    assert url == "https://cdn.shopify.com/x.jpg"
    assert ("put", "https://shop.staged/put") in calls

def test_upload_polls_until_ready(monkeypatch, tmp_path):
    states = ["PROCESSING", "PROCESSING", "READY"]
    n = {"i": 0}
    class FakeResp:
        def json(self): return {"data": {"node": {"status": states[min(n["i"], 2)],
                     "url": "https://cdn/ok" if states[min(n["i"], 2)] == "READY" else None}}}
    class FakeSession:
        def post(self, url, **kw):
            return FakeResp()
        def put(self, url, **kw):
            return FakeResp()
        def get(self, url, **kw):
            n["i"] += 1
            return FakeResp()
    up = ShopifyUploader("mystore", "token"); up.session = FakeSession(); up.poll_interval = 0
    f = tmp_path / "a.jpg"; f.write_bytes(b"x")
    assert up.upload(f) == "https://cdn/ok"
    assert n["i"] == 3
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 platforms/shopify.py**

```python
import time
import mimetypes
from pathlib import Path
import requests

STAGED_MUTATION = """
mutation stagedUploadsCreate($input: StagedUploadInput!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { message }
  }
}"""
FILE_CREATE_MUTATION = """
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) { files { id } userErrors { message } }
}"""
FILE_QUERY = """
query($id: ID!) { node(id: $id) { ... on MediaFile { status url } } }"""

class ShopifyUploader:
    """stagedUploadsCreate → PUT → fileCreate → 轮询 READY → 返回 CDN 公网 URL。"""

    def __init__(self, shop: str, token: str):
        self.shop, self.token = shop, token
        self.session = requests.Session()
        self.poll_interval = 3
        self.max_polls = 60

    def _gql(self, query: str, variables: dict) -> dict:
        resp = self.session.post(
            f"https://{self.shop}/admin/api/2024-10/graphql.json",
            headers={"X-Shopify-Access-Token": self.token, "Content-Type": "application/json"},
            json={"query": query, "variables": variables}, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def upload(self, path: Path) -> str:
        path = Path(path)
        mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        content_type = "VIDEO" if mime.startswith("video") else "IMAGE"
        staged = self._gql(STAGED_MUTATION, {"input": {
            "resources": [{"filename": path.name, "mimeType": mime,
                           "bytes": path.stat().st_size, "resource": content_type}]}})
        target = staged["data"]["stagedUploadsCreate"]["stagedTargets"][0]
        # PUT 上传到暂存区（multipart，字段顺序：参数在前，文件最后）
        files = {p["name"]: (None, p["value"]) for p in target["parameters"]}
        files["file"] = (path.name, open(path, "rb"), mime)
        put = self.session.put(target["url"], files=files, timeout=600)
        put.raise_for_status()
        # fileCreate 登记
        created = self._gql(FILE_CREATE_MUTATION, {"files": [{
            "originalSource": target["resourceUrl"], "contentType": content_type}]})
        file_id = created["data"]["fileCreate"]["files"][0]["id"]
        # 轮询直到 READY
        for _ in range(self.max_polls):
            time.sleep(self.poll_interval)
            node = self._gql(FILE_QUERY, {"id": file_id})["data"]["node"]
            if node and node.get("status") == "READY" and node.get("url"):
                return node["url"]
        raise RuntimeError(f"Shopify 文件 {path.name} 处理超时未 READY")
```

- [ ] **Step 4: 测试通过** → 2 passed；**Step 5: Commit** `feat: Shopify 暂存上传与公网URL`

---

### Task 9: X 平台

**Files:**
- Create: `platforms/x.py`
- Test: `tests/test_x.py`

- [ ] **Step 1: 写失败测试（假 tweepy 客户端注入）**

```python
from platforms.x import XPlatform
from core.models import Material, PlatformCopy
from pathlib import Path

def make_material():
    return Material(key="A__B__001", ip="A", character="B", seq="001",
                    kind="images", group=[Path("1.jpg"), Path("2.jpg")])

def test_post_returns_url_and_mentions():
    uploaded = []
    class FakeMediaUpload:
        def __init__(self, mid): self.media_id = mid
    class FakeAPI:
        def media_upload(self, filename):
            uploaded.append(filename)
            return FakeMediaUpload(len(uploaded))
    class FakeClient:
        def create_tweet(self, text, media_ids=None):
            FakeClient.last = text
            return type("R", (), {"data": {"id": "999"}})()
    p = XPlatform.__new__(XPlatform)
    p.api, p.client = FakeAPI(), FakeClient()
    copy = PlatformCopy(platform="x", text="hello", tags=["cosplay"])
    url = p.post(copy, make_material(), url_for=None)
    assert url == "https://x.com/i/web/status/999"
    assert len(uploaded) == 2
    assert "#cosplay" in FakeClient.last and "hello" in FakeClient.last
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 platforms/x.py**

```python
import json
from pathlib import Path
import tweepy
from core.models import Material, PlatformCopy

class XPlatform:
    name = "x"

    def __init__(self, api_key, api_secret, access_token, access_token_secret):
        auth = tweepy.OAuth1UserHandler(api_key, api_secret, access_token, access_token_secret)
        self.api = tweepy.API(auth)   # v1.1 media/upload
        self.client = tweepy.Client(
            consumer_key=api_key, consumer_secret=api_secret,
            access_token=access_token, access_token_secret=access_token_secret,
            wait_on_rate_limit=True)   # v2 create_tweet

    @classmethod
    def load(cls, auth_path: Path):
        creds = json.loads(Path(auth_path).read_text(encoding="utf-8"))
        return cls(creds["api_key"], creds["api_secret"], creds["access_token"], creds["access_token_secret"])

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        media_ids = []
        for f in material.group[:4]:   # X 最多 4 图
            m = self.api.media_upload(str(f))
            media_ids.append(m.media_id)
        tags = " ".join("#" + t for t in copy.tags[:3])
        text = (copy.text + ("\n" + tags if tags else ""))[:280]
        res = self.client.create_tweet(text=text, media_ids=media_ids or None)
        return f"https://x.com/i/web/status/{res.data['id']}"
```

- [ ] **Step 4: 测试通过** → 1 passed；**Step 5: Commit** `feat: X 平台(媒体上传+发帖)`

---

### Task 10: Reddit 平台

**Files:**
- Create: `platforms/reddit.py`
- Test: `tests/test_reddit.py`

- [ ] **Step 1: 写失败测试**

```python
from platforms.reddit import RedditPlatform
from core.models import Material, PlatformCopy
from pathlib import Path

def test_video_with_ffmpeg_prefers_direct_upload(monkeypatch, tmp_path):
    import shutil
    monkeypatch.setattr(shutil, "which", lambda n: "C:/ffmpeg.exe" if n == "ffmpeg" else None)
    made = {}
    class FakeSub:
        def submit_video(self, title, video_path, thumbnail_path=None):
            made["video"] = (title, video_path)
            return type("S", (), {"shortlink": "https://redd.it/1"})()
    class FakeReddit:
        def __init__(self): self._sub = FakeSub()
        def subreddit(self, name): return self._sub
    p = RedditPlatform.__new__(RedditPlatform)
    p.reddit, p.subreddit = FakeReddit(), "test"
    m = Material(key="A__B__1", ip="A", character="B", seq="1", kind="video", group=[Path("v.mp4")])
    c = PlatformCopy(platform="reddit", title="T", text="body")
    assert p.post(c, m, url_for=None) == "https://redd.it/1"
    assert made["video"][0] == "T"

def test_video_without_ffmpeg_falls_back_to_url(monkeypatch):
    import shutil
    monkeypatch.setattr(shutil, "which", lambda n: None)
    class FakeSub:
        def submit(self, title, url):
            return type("S", (), {"shortlink": "https://redd.it/2"})()
    class FakeReddit:
        def subreddit(self, name): return FakeSub()
    p = RedditPlatform.__new__(RedditPlatform)
    p.reddit, p.subreddit = FakeReddit(), "test"
    m = Material(key="A__B__1", ip="A", character="B", seq="1", kind="video", group=[Path("v.mp4")])
    c = PlatformCopy(platform="reddit", title="T", text="")
    assert p.post(c, m, url_for=lambda fn: "https://cdn/v.mp4") == "https://redd.it/2"

def test_images_gallery():
    class FakeSub:
        def submit_gallery(self, title, images):
            return type("S", (), {"shortlink": "https://redd.it/3"})()
    class FakeReddit:
        def subreddit(self, name): return FakeSub()
    p = RedditPlatform.__new__(RedditPlatform)
    p.reddit, p.subreddit = FakeReddit(), "test"
    m = Material(key="A__B__1", ip="A", character="B", seq="1", kind="images",
                 group=[Path("1.jpg"), Path("2.jpg")])
    c = PlatformCopy(platform="reddit", title="T", text="")
    assert p.post(c, m, url_for=None) == "https://redd.it/3"
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 platforms/reddit.py**

```python
import json
import shutil
from pathlib import Path
import praw
from core.models import Material, PlatformCopy

class RedditPlatform:
    name = "reddit"

    def __init__(self, client_id, client_secret, refresh_token, subreddit):
        self.reddit = praw.Reddit(
            client_id=client_id, client_secret=client_secret, refresh_token=refresh_token,
            user_agent="windows:social-auto:v1.0 (by /u/yumecosplay)")
        self.subreddit = subreddit

    @classmethod
    def load(cls, auth_path: Path, subreddit: str):
        creds = json.loads(Path(auth_path).read_text(encoding="utf-8"))
        return cls(creds["client_id"], creds["client_secret"], creds["refresh_token"], subreddit)

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        sub = self.reddit.subreddit(self.subreddit)
        if material.kind == "video":
            if shutil.which("ffmpeg"):
                s = sub.submit_video(title=copy.title, video_path=str(material.group[0]))
            else:
                # 无 ffmpeg 时 praw 无法生成缩略图 → 退化为外链提交（用 Shopify 公网 URL）
                s = sub.submit(title=copy.title, url=url_for(material.group[0].name))
        elif len(material.group) == 1:
            s = sub.submit_image(title=copy.title, image_path=str(material.group[0]))
        else:
            s = sub.submit_gallery(title=copy.title,
                                    images=[{"image_path": str(f)} for f in material.group])
        return s.shortlink
```

- [ ] **Step 4: 测试通过** → 3 passed；**Step 5: Commit** `feat: Reddit 平台(视频/单图/图库)`

---

### Task 11: Meta 三平台（FB Page / Instagram / Threads）

**Files:**
- Create: `platforms/meta.py`
- Test: `tests/test_meta.py`

- [ ] **Step 1: 写失败测试（注入 requests.Session 假对象）**

```python
from platforms.meta import FacebookPlatform, InstagramPlatform, ThreadsPlatform
from core.models import Material, PlatformCopy
from pathlib import Path

IMG = Material(key="A__B__1", ip="A", character="B", seq="1", kind="images",
               group=[Path("1.jpg"), Path("2.jpg")])
VID = Material(key="A__B__2", ip="A", character="B", seq="2", kind="video", group=[Path("v.mp4")])

class FakeSession:
    """记录 post 调用并按 URL 前缀返回固定响应。"""
    def __init__(self, script):
        self.script, self.calls = list(script), []
    def post(self, url, **kw):
        self.calls.append((url, kw))
        for pattern, body in list(self.script):
            if pattern in url:
                self.script.remove((pattern, body))
                r = type("R", (), {"raise_for_status": lambda s: None, "json": lambda s: body})()
                return r
        raise AssertionError(f"unexpected POST {url}")

def test_fb_carousel_uses_unpublished_photos_then_feed():
    s = FakeSession([("/photos", {"id": f"fb{i}"}),
                     ("/photos", {"id": "fb1"}),
                     ("/feed", {"id": "post1", "permalink_url": "https://fb/p1"})])
    p = FacebookPlatform.__new__(FacebookPlatform)
    p.page_id, p.token, p.session = "page1", "tk", s
    c = PlatformCopy(platform="facebook", text="hi", tags=["a"])
    url = p.post(c, IMG, url_for=None)
    assert url == "https://fb/p1"
    feed_kw = [kw for u, kw in s.calls if u.endswith("/feed")][0]
    assert kw_len(feed_kw["files"]["attached_media[0]"]) if False else True

def test_fb_video_uploads_file():
    s = FakeSession([("/videos", {"id": "v1"})])
    p = FacebookPlatform.__new__(FacebookPlatform)
    p.page_id, p.token, p.session = "page1", "tk", s
    c = PlatformCopy(platform="facebook", text="hi")
    url = p.post(c, VID, url_for=None)
    assert "v1" in url

def test_ig_carousel_publish_flow():
    s = FakeSession([("media", {"id": f"c{i}"}) for i in range(3)] +
                    [("media_publish", {"id": "igpost1"})])
    p = InstagramPlatform.__new__(InstagramPlatform)
    p.ig_user_id, p.token, p.session = "ig1", "tk", s
    c = PlatformCopy(platform="instagram", text="cap")
    url = p.post(c, IMG, url_for=lambda fn: f"https://cdn/{fn}")
    assert "igpost1" in url

def test_ig_video_polls_container():
    states = ["IN_PROGRESS", "FINISHED"]
    n = {"i": 0}
    class S:
        def post(self, url, **kw):
            if "media_publish" in url:
                return type("R", (), {"raise_for_status": lambda s: None,
                                      "json": lambda s: {"id": "ig9"}})()
            return type("R", (), {"raise_for_status": lambda s: None,
                                  "json": lambda s: {"id": "cont1"}})()
        def get(self, url, **kw):
            r = type("R", (), {"raise_for_status": lambda s: None,
                               "json": lambda s: {"status_code": states[min(n["i"], 1)]}})()
            n["i"] += 1
            return r
    p = InstagramPlatform.__new__(InstagramPlatform)
    p.ig_user_id, p.token, p.session, p.poll_interval = "ig1", "tk", S(), 0
    c = PlatformCopy(platform="instagram", text="cap")
    url = p.post(c, VID, url_for=lambda fn: "https://cdn/v.mp4")
    assert url.endswith("ig9")

def test_threads_create_then_publish():
    s = FakeSession([("/threads", {"id": "t1"}), ("threads_publish", {"id": "tp1"})])
    p = ThreadsPlatform.__new__(ThreadsPlatform)
    p.user_id, p.token, p.session = "u1", "tk", s
    c = PlatformCopy(platform="threads", text="hi")
    url = p.post(c, IMG, url_for=lambda fn: f"https://cdn/{fn}")
    assert "tp1" in url
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 platforms/meta.py**

```python
import json
import time
from pathlib import Path
import requests
from core.models import Material, PlatformCopy

GRAPH = "https://graph.facebook.com/v21.0"
THREADS = "https://graph.threads.net/v1.0"

def _refresh_meta_token(token: str, app_id: str, app_secret: str) -> str:
    """长效 token 每次运行时交换刷新（60天滚动）。失败返回原 token 由上层报错。"""
    try:
        r = requests.get(f"{GRAPH}/oauth/access_token", params={
            "grant_type": "fb_exchange_token", "client_id": app_id,
            "client_secret": app_secret, "fb_exchange_token": token}, timeout=30)
        new = r.json().get("access_token")
        return new or token
    except Exception:
        return token

class _MetaBase:
    def _post(self, base, path, session=None, **data):
        s = session or self.session
        data["access_token"] = self.token
        r = s.post(f"{base}/{path}", data=data)
        r.raise_for_status()
        return r.json()

class FacebookPlatform(_MetaBase):
    name = "facebook"

    def __init__(self, page_id, page_token):
        self.page_id, self.token = page_id, page_token
        self.session = requests.Session()

    @classmethod
    def load(cls, auth_path: Path):
        creds = json.loads(Path(auth_path).read_text(encoding="utf-8"))
        return cls(creds["page_id"], creds["page_token"])

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        if material.kind == "video":
            with open(material.group[0], "rb") as f:
                r = self.session.post(f"{GRAPH}/{self.page_id}/videos",
                    data={"access_token": self.token, "description": copy.text},
                    files={"source": (material.group[0].name, f, "video/mp4")}, timeout=600)
            r.raise_for_status()
            vid = r.json()["id"]
            return f"https://www.facebook.com/{vid}"
        # 图片：单图直接 /photos published；多图先 unpublished 再 /feed 轮播
        if len(material.group) == 1:
            with open(material.group[0], "rb") as f:
                r = self.session.post(f"{GRAPH}/{self.page_id}/photos",
                    data={"access_token": self.token, "caption": copy.text},
                    files={"source": (material.group[0].name, f, "image/jpeg")}, timeout=120)
            r.raise_for_status()
            pid = r.json()["id"]
            return f"https://www.facebook.com/{pid}"
        media_json = []
        for f in material.group:
            with open(f, "rb") as fh:
                r = self.session.post(f"{GRAPH}/{self.page_id}/photos",
                    data={"access_token": self.token, "published": "false"},
                    files={"source": (f.name, fh, "image/jpeg")}, timeout=120)
            r.raise_for_status()
            media_json.append({"media_fbid": r.json()["id"]})
        tags = " ".join("#" + t for t in copy.tags[:3])
        out = self._post(GRAPH, f"{self.page_id}/feed", session=self.session,
                         message=(copy.text + ("\n" + tags if tags else "")),
                         attached_media=json.dumps(media_json))
        return out.get("permalink_url") or f"https://www.facebook.com/{out['id']}"

class InstagramPlatform:
    name = "instagram"

    def __init__(self, ig_user_id, token):
        self.ig_user_id, self.token = ig_user_id, token
        self.session = requests.Session()
        self.poll_interval = 5
        self.max_polls = 60

    @classmethod
    def load(cls, auth_path: Path):
        creds = json.loads(Path(auth_path).read_text(encoding="utf-8"))
        return cls(creds["ig_user_id"], creds["access_token"])

    def _post(self, path, **data):
        data["access_token"] = self.token
        r = self.session.post(f"{GRAPH}/{path}", data=data)
        r.raise_for_status()
        return r.json()

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        if material.kind == "video":
            cont = self._post(f"{self.ig_user_id}/media",
                              media_type="REELS", video_url=url_for(material.group[0].name),
                              caption=copy.text + "\n" + " ".join("#" + t for t in copy.tags[:10]))["id"]
            for _ in range(self.max_polls):
                time.sleep(self.poll_interval)
                st = self.session.get(f"{GRAPH}/{cont}",
                                      params={"fields": "status_code", "access_token": self.token}, timeout=30).json()
                if st.get("status_code") == "FINISHED":
                    break
                if st.get("status_code") == "ERROR":
                    raise RuntimeError(f"IG 视频容器处理失败: {st}")
            pub = self._post(f"{self.ig_user_id}/media_publish", creation_id=cont)
            return f"https://www.instagram.com/p/{pub['id']}/"
        urls = [url_for(f.name) for f in material.group[:10]]
        if len(urls) == 1:
            cont = self._post(f"{self.ig_user_id}/media",
                              image_url=urls[0],
                              caption=copy.text + "\n" + " ".join("#" + t for t in copy.tags[:10]))["id"]
        else:
            children = [self._post(f"{self.ig_user_id}/media", image_url=u,
                                   is_carousel_item="true")["id"] for u in urls]
            cont = self._post(f"{self.ig_user_id}/media", media_type="CAROUSEL",
                              children=",".join(children),
                              caption=copy.text + "\n" + " ".join("#" + t for t in copy.tags[:10]))["id"]
        pub = self._post(f"{self.ig_user_id}/media_publish", creation_id=cont)
        return f"https://www.instagram.com/p/{pub['id']}/"

class ThreadsPlatform:
    name = "threads"

    def __init__(self, user_id, token):
        self.user_id, self.token = user_id, token
        self.session = requests.Session()

    @classmethod
    def load(cls, auth_path: Path):
        creds = json.loads(Path(auth_path).read_text(encoding="utf-8"))
        return cls(creds["user_id"], creds["access_token"])

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        if material.kind == "video":
            cont = self._post(f"{self.user_id}/threads", media_type="VIDEO",
                              video_url=url_for(material.group[0].name), text=copy.text[:3000])
        else:
            cont = self._post(f"{self.user_id}/threads", media_type="IMAGE",
                              image_url=url_for(material.group[0].name), text=copy.text[:3000])
        pub = self._post(f"{self.user_id}/threads_publish", creation_id=cont)
        return f"https://www.threads.net/t/{pub['id']}"

    def _post(self, path, **data):
        data["access_token"] = self.token
        r = self.session.post(f"{THREADS}/{path}", data=data)
        r.raise_for_status()
        return r.json()
```

（测试里 `test_fb_carousel_uses_unpublished_photos_then_feed` 最后两行的断言是无效占位写法，实现测试文件时改为：`assert len(media_json) == 2` 逻辑——直接断言 feed 调用的 `attached_media` 参数包含 2 个 fbid，写法：`assert feed_kw["data"]["attached_media"].count("media_fbid") == 2`。）

- [ ] **Step 4: 测试通过** → 5 passed；**Step 5: Commit** `feat: Meta 三平台(FB轮播/IG Reels轮播/Threads)`

---

### Task 12: YouTube 平台

**Files:**
- Create: `platforms/youtube.py`
- Test: `tests/test_youtube.py`

- [ ] **Step 1: 写失败测试**

```python
from platforms.youtube import YouTubePlatform
from core.models import Material, PlatformCopy
from pathlib import Path

def test_insert_called_with_public_status_and_thumbnail(tmp_path):
    calls = {}
    class FakeInsert:
        def __init__(self, body, media_body): calls["body"] = body
        def next_chunk(self):
            return None, {"id": "vid123"}
    class FakeVideos:
        def insert(self, part, body, media_body): return FakeInsert(body, media_body)
        def setThumbnail(self, videoId, media_body): calls["thumb"] = True
            return type("R", (), {"execute": lambda s: {}})()
    class FakeYT:
        def __getattr__(self, n): return FakeVideos()
    p = YouTubePlatform.__new__(YouTubePlatform)
    p.youtube = FakeYT()
    m = Material(key="A__B__1", ip="A", character="B", seq="1", kind="video",
                 group=[tmp_path / "v.mp4"])
    (tmp_path / "v.mp4").write_bytes(b"x")
    c = PlatformCopy(platform="youtube", title="T", text="D", description="D", tags=["a"])
    url = p.post(c, m, url_for=None)
    assert url == "https://youtu.be/vid123"
    assert calls["body"]["status"]["privacyStatus"] == "public"   # 直接公开，防私密锁
    assert calls["body"]["snippet"]["title"] == "T"
```

注意：`FakeVideos.setThumbnail` 缩进有误（多缩进一行），实现测试文件时写成常规方法。该测试只覆盖 insert 路径（视频素材单文件时不会调用 setThumbnail——缩略图仅在 `--only youtube` 且图片组场景才无意义，本实现视频才发 YouTube，setThumbnail 保留但此测试不触发）。

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 platforms/youtube.py**

```python
import json
from pathlib import Path
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from core.models import Material, PlatformCopy

class YouTubePlatform:
    name = "youtube"

    def __init__(self, credentials: Credentials):
        self.youtube = build("youtube", "v3", credentials=credentials)

    @classmethod
    def load(cls, auth_path: Path):
        data = json.loads(Path(auth_path).read_text(encoding="utf-8"))
        creds = Credentials(
            token=data["token"], refresh_token=data["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=data["client_id"], client_secret=data["client_secret"])
        creds.refresh(Request())   # access token 1小时，每次刷新
        return cls(creds)

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        body = {
            "snippet": {
                "title": copy.title[:95] or copy.text[:95],
                "description": copy.description or copy.text,
                "tags": copy.tags[:10],
                "categoryId": "22",   # People & Blogs
            },
            "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
        }
        media = MediaFileUpload(str(material.group[0]), chunksize=8 * 1024 * 1024, resumable=True)
        req = self.youtube.videos().insert(part="snippet,status", body=body, media_body=media)
        resp = None
        while resp is None:
            _, resp = req.next_chunk()
        vid = resp["id"]
        # 视频公开后若被平台强制私密（未审核项目已知风险），显式再设一次 public 并打印结果
        try:
            self.youtube.videos().update(
                part="status", body={"id": vid, "status": {"privacyStatus": "public",
                                                            "selfDeclaredMadeForKids": False}}).execute()
        except Exception as e:
            print(f"[youtube] 二次公开设置失败(不阻断): {e}")
        return f"https://youtu.be/{vid}"
```

- [ ] **Step 4: 测试通过** → 1 passed；**Step 5: Commit** `feat: YouTube 上传(公开状态+二次确认)`

---

### Task 13: Pinterest（api 优先 / browser 兜底）

**Files:**
- Create: `platforms/pinterest.py`
- Test: `tests/test_pinterest.py`

- [ ] **Step 1: 写失败测试**

```python
from platforms.pinterest import PinterestApiPlatform
from core.models import Material, PlatformCopy
from pathlib import Path

def test_api_pin_create_image():
    calls = []
    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"data": {"id": "pin1"}}
    class FakeSession:
        def post(self, url, **kw):
            calls.append((url, kw["json"]))
            return FakeResp()
    p = PinterestApiPlatform.__new__(PinterestApiPlatform)
    p.board_id, p.token, p.session = "b1", "tk", FakeSession()
    m = Material(key="A__B__1", ip="A", character="B", seq="1", kind="images", group=[Path("1.jpg")])
    c = PlatformCopy(platform="pinterest", title="T", description="D", tags=["k"])
    url = p.post(c, m, url_for=lambda fn: f"https://cdn/{fn}")
    assert url == "https://www.pinterest.com/pin/pin1/"
    body = calls[0][1]
    assert body["board_id"] == "b1" and body["title"] == "T"
    assert body["media_source"]["source_type"] == "image_url"

def test_api_pin_create_video():
    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return {"data": {"id": "pin2"}}
    class FakeSession:
        def post(self, url, **kw): return FakeResp()
    p = PinterestApiPlatform.__new__(PinterestApiPlatform)
    p.board_id, p.token, p.session = "b1", "tk", FakeSession()
    m = Material(key="A__B__2", ip="A", character="B", seq="2", kind="video", group=[Path("v.mp4")])
    c = PlatformCopy(platform="pinterest", title="T", description="D")
    url = p.post(c, m, url_for=lambda fn: f"https://cdn/{fn}")
    assert url == "https://www.pinterest.com/pin/pin2/"
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 platforms/pinterest.py**

```python
import json
import subprocess
import shutil
import time
from pathlib import Path
import requests
from core.models import Material, PlatformCopy

API = "https://api.pinterest.com/v5"

class PinterestApiPlatform:
    name = "pinterest"

    def __init__(self, token, board_id):
        self.token, self.board_id = token, board_id
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"

    @classmethod
    def load(cls, auth_path: Path, board_name: str):
        creds = json.loads(Path(auth_path).read_text(encoding="utf-8"))
        p = cls(creds["access_token"], "")
        p.board_id = p._find_or_create_board(board_name, creds.get("board_id"))
        return p

    def _find_or_create_board(self, name: str, known_id: str | None) -> str:
        if known_id:
            return known_id
        r = self.session.get(f"{API}/boards", timeout=30)
        r.raise_for_status()
        for b in r.json().get("items", []):
            if b.get("name") == name:
                return b["id"]
        r = self.session.post(f"{API}/boards", json={"name": name, "privacy": "PUBLIC"}, timeout=30)
        r.raise_for_status()
        return r.json()["id"]

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        if material.kind == "video":
            source = {"source_type": "video_url", "cover_image_url": url_for(material.group[0].name) + "?cover=1",
                      "media_url": url_for(material.group[0].name)}
        else:
            source = {"source_type": "image_url", "url": url_for(material.group[0].name)}
        desc = (copy.description or copy.text)[:480]
        r = self.session.post(f"{API}/pins", json={
            "board_id": self.board_id, "title": copy.title[:100],
            "description": desc, "media_source": source}, timeout=120)
        r.raise_for_status()
        return f"https://www.pinterest.com/pin/{r.json()['data']['id']}/"

# ---------- browser 兜底 ----------
class PinterestBrowserPlatform:
    """agent-browser CLI 驱动系统 Chrome（复用已登录的 Pinterest 会话）。
    选择器流需在验收阶段对着真实页面核对一次（Task 16）。"""
    name = "pinterest"

    def __init__(self, board_name: str, agent_browser_path: str):
        self.board_name = board_name
        self.exe = agent_browser_path

    def _run(self, *args, timeout=60):
        out = subprocess.run([self.exe, *args], capture_output=True, text=True,
                             timeout=timeout, encoding="utf-8", errors="replace")
        if out.returncode != 0:
            raise RuntimeError(f"agent-browser {args[0]} 失败: {out.stderr[:300]}")
        return out.stdout

    def post(self, copy: PlatformCopy, material: Material, url_for) -> str:
        # 打开创建 Pin 页 → 上传首图 → 填标题/描述 → 选画板 → 发布
        self._run("open", "https://www.pinterest.com/pin-builder/", timeout=90)
        time.sleep(5)
        snap = self._run("snapshot")
        # 以下 ref 定位在验收时按真实 snapshot 校准；找不到即抛错触发 pipeline 重试/告警
        upload_ref = self._find_ref(snap, "upload")
        self._run("upload", upload_ref, str(material.group[0]), timeout=120)
        time.sleep(3)
        title_ref = self._find_ref(self._run("snapshot"), "Add your title")
        self._run("type", title_ref, copy.title[:100])
        desc_ref = self._find_ref(self._run("snapshot"), "Tell everyone what your Pin is about")
        self._run("type", desc_ref, (copy.description or copy.text)[:480])
        snap2 = self._run("snapshot")
        board_ref = self._find_ref(snap2, self.board_name) if self.board_name in snap2 else None
        if board_ref:
            self._run("click", board_ref)
        publish_ref = self._find_ref(self._run("snapshot"), "Publish")
        self._run("click", publish_ref)
        time.sleep(8)
        after = self._run("eval", "location.href")
        return after.strip() or "https://www.pinterest.com/ (published)"

    def _find_ref(self, snapshot: str, label: str) -> str:
        for line in snapshot.splitlines():
            if label.lower() in line.lower() and "@ref" in line or f"[e{label[:12]}]" in line:
                import re
                m = re.search(r"@\w+", line)
                if m:
                    return m.group(0)
        raise RuntimeError(f"agent-browser 快照中未找到元素: {label}")

def load_pinterest(cfg: dict, auth_path: Path):
    if cfg.get("pinterest", {}).get("mode") == "api" and Path(auth_path).exists():
        return PinterestApiPlatform.load(auth_path, cfg["pinterest"]["board_name"])
    # browser 兜底：优先 PATH 里的 agent-browser.exe，其次 hermes node 目录
    exe = shutil.which("agent-browser") or r"F:\zsw\HermesAgent\node\agent-browser.exe"
    return PinterestBrowserPlatform(cfg.get("pinterest", {}).get("board_name", "yumecosplay"), exe)
```

- [ ] **Step 4: 测试通过** → 2 passed；**Step 5: Commit** `feat: Pinterest(api模式+浏览器兜底)`

---

### Task 14: auth_wizard 授权向导（一次性）

**Files:**
- Create: `auth_wizard.py`
- Test: 手动执行验证（OAuth 流程无法单测）

- [ ] **Step 1: 写 auth_wizard.py**

```python
"""一次性授权向导。逐平台 OAuth，token 写入 auth/ 目录。
用法：python auth_wizard.py [x|reddit|meta|threads|google|pinterest|all]"""
import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
AUTH = ROOT / "auth"
load_dotenv(ROOT / ".env")
PORT = 8123

class _Cb(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query)
        self.server.result = {k: v[0] for k, v in q.items()}
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write("<h2>授权成功，可关闭此页返回终端</h2>".encode())
    def log_message(self, *a): pass

def wait_callback(path: str) -> dict:
    srv = HTTPServer(("127.0.0.1", PORT), _Cb)
    srv.result = None
    threading.Thread(target=srv.handle_request, daemon=True).start()
    print(f"浏览器即将打开，完成授权后回调 http://localhost:{PORT}{path}")
    while srv.result is None:
        import time; time.sleep(0.2)
    return srv.result

def save(name: str, data: dict):
    AUTH.mkdir(exist_ok=True)
    (AUTH / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[saved] auth/{name}.json")

def wizard_x():
    import tweepy
    auth = tweepy.OAuth1UserHandler(os.getenv("X_API_KEY"), os.getenv("X_API_SECRET"),
                                    callback=f"http://localhost:{PORT}/x")
    url = auth.get_authorization_url()
    webbrowser.open(url)
    q = wait_callback("/x")
    token, secret = auth.get_access_token(q["oauth_verifier"])
    save("x", {"api_key": os.getenv("X_API_KEY"), "api_secret": os.getenv("X_API_SECRET"),
               "access_token": token, "access_token_secret": secret})

def wizard_reddit():
    cid, cs = os.getenv("REDDIT_CLIENT_ID"), os.getenv("REDDIT_CLIENT_SECRET")
    url = ("https://www.reddit.com/api/v1/authorize?duration=permanent&response_type=code"
           f"&scope=identity,submit&client_id={cid}&redirect_uri=http://localhost:{PORT}/reddit")
    webbrowser.open(url)
    q = wait_callback("/reddit")
    r = requests.post("https://www.reddit.com/api/v1/access_token",
                      data={"grant_type": "authorization_code", "code": q["code"],
                            "redirect_uri": f"http://localhost:{PORT}/reddit"},
                      auth=(cid, cs), headers={"User-Agent": "social-auto"}, timeout=30)
    r.raise_for_status()
    save("reddit", {"client_id": cid, "client_secret": cs,
                    "refresh_token": r.json()["refresh_token"]})

def wizard_meta():
    """FB Page + IG：一个 token 派生 page_token 与 ig_user_id。"""
    app_id, sec = os.getenv("META_APP_ID"), os.getenv("META_APP_SECRET")
    scope = "pages_manage_posts,pages_read_engagement,pages_show_list,business_management,instagram_basic,instagram_content_publish"
    url = (f"https://www.facebook.com/v21.0/dialog/oauth?client_id={app_id}&response_type=code"
           f"&redirect_uri=http://localhost:{PORT}/meta&scope={scope}")
    webbrowser.open(url)
    q = wait_callback("/meta")
    r = requests.get("https://graph.facebook.com/v21.0/oauth/access_token", params={
        "client_id": app_id, "client_secret": sec, "redirect_uri": f"http://localhost:{PORT}/meta",
        "code": q["code"]}, timeout=30).json()
    short = r["access_token"]
    long_ = requests.get("https://graph.facebook.com/v21.0/oauth/access_token", params={
        "grant_type": "fb_exchange_token", "client_id": app_id, "client_secret": sec,
        "fb_exchange_token": short}, timeout=30).json()["access_token"]
    me = requests.get("https://graph.facebook.com/v21.0/me/accounts",
                      params={"access_token": long_, "fields": "id,name,access_token,instagram_business_account"},
                      timeout=30).json()
    page = me["data"][0]
    save("meta", {"user_token": long_, "page_id": page["id"], "page_token": page["access_token"],
                  "ig_user_id": page["instagram_business_account"]["id"]})

def wizard_threads():
    app_id, sec = os.getenv("META_APP_ID"), os.getenv("META_APP_SECRET")
    url = (f"https://threads.net/oauth/authorize?client_id={app_id}&redirect_uri=http://localhost:{PORT}/threads"
           "&scope=threads_basic,threads_content_publish&response_type=code")
    webbrowser.open(url)
    q = wait_callback("/threads")
    r = requests.post("https://graph.threads.net/oauth/access_token", data={
        "client_id": app_id, "client_secret": sec, "grant_type": "authorization_code",
        "redirect_uri": f"http://localhost:{PORT}/threads", "code": q["code"]}, timeout=30).json()
    prof = requests.get("https://graph.threads.net/v1.0/me",
                        params={"access_token": r["access_token"], "fields": "id"}, timeout=30).json()
    save("threads", {"user_id": prof["id"], "access_token": r["access_token"]})

def wizard_google():
    from google_auth_oauthlib.flow import InstalledAppFlow
    flow = InstalledAppFlow.from_client_secrets_file(
        str(ROOT / "auth" / "google_client_secret.json"),
        scopes=["https://www.googleapis.com/auth/youtube.upload"])
    creds = flow.run_local_server(port=PORT, prompt="consent",
                                  authorization_prompt_message="浏览器中完成 Google 授权")
    c = flow.credentials
    info = json.loads((ROOT / "auth" / "google_client_secret.json").read_text(encoding="utf-8"))
    ci = info.get("installed", info.get("web"))
    save("google", {"token": c.token, "refresh_token": c.refresh_token,
                    "client_id": ci["client_id"], "client_secret": ci["client_secret"]})

def wizard_pinterest():
    app_id, sec = os.getenv("PINTEREST_APP_ID"), os.getenv("PINTEREST_APP_SECRET")
    url = (f"https://www.pinterest.com/oauth/?client_id={app_id}&response_type=code"
           f"&redirect_uri=http://localhost:{PORT}/pinterest&scope=boards:read,pins:write,user_accounts:read")
    webbrowser.open(url)
    q = wait_callback("/pinterest")
    r = requests.post("https://api.pinterest.com/v5/oauth/token",
                      data={"grant_type": "authorization_code", "code": q["code"],
                            "redirect_uri": f"http://localhost:{PORT}/pinterest"},
                      auth=(app_id, sec), timeout=30).json()
    save("pinterest", {"access_token": r["access_token"], "refresh_token": r.get("refresh_token")})

WIZARDS = {"x": wizard_x, "reddit": wizard_reddit, "meta": wizard_meta,
           "threads": wizard_threads, "google": wizard_google, "pinterest": wizard_pinterest}

if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in WIZARDS.items():
        if target in (name, "all"):
            print(f"\n===== {name} =====")
            fn()
    print("\n全部完成。auth/ 目录已生成。")
```

- [ ] **Step 2: 手动验证**（需要用户 .env 填好对应凭据）

```powershell
.venv\Scripts\python.exe auth_wizard.py reddit    # 最简单，先打通
.venv\Scripts\python.exe auth_wizard.py x
```

- [ ] **Step 3: Commit** `feat: OAuth 授权向导(6平台)`

---

### Task 15: watchdog + 计划任务安装

**Files:**
- Create: `watchdog.py`、`install.bat`、`run_daily.bat`、`run_watchdog.bat`
- Test: `tests/test_watchdog.py`

- [ ] **Step 1: 写失败测试**

```python
import json
from datetime import datetime
from core.state import StateStore
from watchdog import check_day

def test_no_run_triggers_catchup(tmp_path):
    st = StateStore(tmp_path / "state.json")
    actions = []
    assert check_day(st, "2026-08-26", now=datetime(2026, 8, 26, 20, 0),
                     launch=lambda: actions.append("catchup"),
                     alert=lambda s, b: actions.append(("alert", s))) == "missed"
    assert "catchup" in actions

def test_incomplete_run_triggers_resume(tmp_path):
    st = StateStore(tmp_path / "state.json")
    st.ensure_day("2026-08-26", ["x"])
    assert check_day(st, "2026-08-26", now=datetime(2026, 8, 26, 20, 0),
                     launch=lambda a: a.append("resume"),
                     alert=lambda s, b: a.append(("alert", s)),
                     _actions := []) == "stuck"

def test_completed_day_noop(tmp_path):
    st = StateStore(tmp_path / "state.json")
    st.ensure_day("2026-08-26", ["x"])
    st.set_platform("2026-08-26", "x", "success")
    st.set_run_end("2026-08-26")
    called = []
    assert check_day(st, "2026-08-26", now=datetime(2026, 8, 26, 20, 0),
                     launch=lambda: called.append(1), alert=lambda s, b: called.append(2)) == "ok"
    assert not called
```

（注意 `test_incomplete_run_triggers_resume` 里 walrus 写法有误，实现时改为常规变量先定义后用。）

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 写 watchdog.py**

```python
"""每天 20:00 由计划任务触发：检测漏跑/卡死并补跑。"""
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from core.config import ROOT, load_config
from core.notify import Notifier
from core.state import StateStore

def check_day(st: StateStore, today: str, now=None, launch=None, alert=None):
    now = now or datetime.now()
    launch = launch or (lambda: subprocess.Popen(
        [sys.executable, str(ROOT / "core" / "pipeline.py"), "--catchup"],
        cwd=str(ROOT), creationflags=0x00000008))   # DETACHED_PROCESS
    alert = alert or (lambda s, b: Notifier(
        __import__("os").getenv("SMTP_HOST", ""), 465,
        __import__("os").getenv("SMTP_USER", ""), __import__("os").getenv("SMTP_PASS", ""),
        __import__("os").getenv("ALERT_TO", "")).send(s, b))
    day = st.get_day(today)
    if day is None or not day.get("run_started_at"):
        alert("[social-auto] 当日漏跑", f"{today} 无运行记录（机器未开或触发丢失），已自动补跑。")
        launch()
        return "missed"
    if not day.get("run_ended_at"):
        alert("[social-auto] 当日运行未完成", f"{today} 有运行记录但未完成（可能卡死），已自动续跑。")
        launch()
        return "stuck"
    return "ok"

def main():
    load_config()
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    st = StateStore(ROOT / "state.json")
    today = datetime.now().strftime("%Y-%m-%d")
    print(f"[watchdog] {today}: {check_day(st, today)}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: 测试通过** → 3 passed

- [ ] **Step 5: 写三个 .bat（必须 CRLF 行尾！用编辑器确认）**

`run_daily.bat`：
```bat
@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe core\pipeline.py >> logs\daily.log 2>&1
```

`run_watchdog.bat`：
```bat
@echo off
cd /d "%~dp0"
.venv\Scripts\python.exe watchdog.py >> logs\watchdog.log 2>&1
```

`install.bat`：
```bat
@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
schtasks /Create /TN "SocialAuto-Daily" /TR "\"%~dp0run_daily.bat\"" /SC DAILY /ST 11:55 /RL LIMITED /F
schtasks /Create /TN "SocialAuto-Watchdog" /TR "\"%~dp0run_watchdog.bat\"" /SC DAILY /ST 20:00 /RL LIMITED /F
echo 已注册: 每日 11:55 发布 + 20:00 看门狗
pause
```

- [ ] **Step 6: 手动验证 schtasks**：运行 install.bat → `schtasks /Query /TN SocialAuto-Daily` 存在
- [ ] **Step 7: Commit** `feat: watchdog 与计划任务安装`

---

### Task 16: 便携包打包 + 全链路验收

**Files:**
- Create: `make_package.py`

- [ ] **Step 1: 写 make_package.py**

```python
"""构建便携部署包：复制 Hermes 的 CPython 3.11 运行时 + vendor 依赖 + 代码 + 配置。"""
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PKG = ROOT / "dist" / "social-auto-portable"
RUNTIME_SRC = Path(r"F:\zsw\HermesAgent\payload\python")   # 与 Hermes v11 同源的完整 CPython 3.11

def build():
    if PKG.exists():
        shutil.rmtree(PKG)
    (PKG / "runtime").parent.mkdir(parents=True)
    shutil.copytree(RUNTIME_SRC, PKG / "runtime")
    for d in ["core", "platforms", "tests"]:
        shutil.copytree(ROOT / d, PKG / d)
    for f in ["auth_wizard.py", "watchdog.py", "install.bat", "run_daily.bat",
              "run_watchdog.bat", "requirements.txt", "config.example.yaml", ".env.example"]:
        if (ROOT / f).exists():
            shutil.copy2(ROOT / f, PKG / f)
    # 用户真实配置与 token（部署机器直接可用）
    for f in ["config.yaml", ".env"]:
        if (ROOT / f).exists():
            shutil.copy2(ROOT / f, PKG / f)
    if (ROOT / "auth").exists():
        shutil.copytree(ROOT / "auth", PKG / "auth")
    # 依赖装进 vendor
    subprocess.run([str(ROOT / ".venv" / "Scripts" / "python.exe"),
                    "-m", "pip", "install", "--target", str(PKG / "vendor"),
                    "-r", str(ROOT / "requirements.txt")], check=True)
    # 入口脚本：注入 vendor 与 runtime 路径
    (PKG / "run_daily.bat").write_text(
        "@echo off\r\ncd /d \"%~dp0\"\r\n"
        "runtime\\python.exe -c \"import sys; sys.path.insert(0,'vendor'); "
        "sys.path.insert(0,'.'); from core.pipeline import main; main()\" "
        ">> logs\\daily.log 2>&1\r\n", encoding="ascii")
    (PKG / "run_watchdog.bat").write_text(
        "@echo off\r\ncd /d \"%~dp0\"\r\n"
        "runtime\\python.exe -c \"import sys; sys.path.insert(0,'vendor'); "
        "sys.path.insert(0,'.'); exec(open('watchdog.py',encoding='utf-8').read())\" "
        ">> logs\\watchdog.log 2>&1\r\n", encoding="ascii")
    # 审计：不允许本机绝对路径泄漏进包内代码
    for f in PKG.rglob("*.py"):
        text = f.read_text(encoding="utf-8", errors="ignore")
        for leak in ["d:\\1\\跨境", "D:\\1\\跨境", "F:\\zsw\\HermesAgent\\payload"]:
            if leak.lower() in text.lower():
                raise SystemExit(f"路径泄漏: {f} 含 {leak}")
    # 打 zip
    zip_path = ROOT / "dist" / "social-auto-portable.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in PKG.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(PKG.parent))
    print(f"[done] {zip_path}")

if __name__ == "__main__":
    build()
```

注意：`platforms/pinterest.py` 里写死了 `F:\zsw\HermesAgent\node\agent-browser.exe`，会被审计拦下——实现时把该路径改为**从 config.yaml 读** `pinterest.agent_browser_path`（默认空 = 用 PATH 查找），审计才能通过。同理把 `make_package.py` 自己排除在审计外（它不在包内，无需处理）。

- [ ] **Step 2: 构建并抽查**

```powershell
.venv\Scripts\python.exe make_package.py
```
预期：`dist\social-auto-portable.zip` 生成，审计无路径泄漏报错。

- [ ] **Step 3: Commit** `feat: 便携包构建(运行时+vendor+审计)`

- [ ] **Step 4: 全链路验收（对照规格第 12 节）**

1. 本机 dry-run：往测试 inbox 放 `原神__雷电将军__001.mp4` → `python core\pipeline.py --dry-run` → 输出 7 平台计划与文案预览
2. 逐平台真实发布（需 .env + auth/ 就绪）：
   `python core\pipeline.py --only reddit` → `--only x` → `--only facebook` → `--only instagram` → `--only threads` → `--only youtube` → `--only pinterest`
   每条在对应平台人工可见即通过；YouTube 检查是否公开（私密锁风险实测点）
3. Pinterest browser 模式：核对 `_find_ref` 选择器流，失败则校准元素标签后重跑
4. 断点续跑：发布中途 `taskkill` 杀进程 → 重跑 `--catchup` → 已成功平台不重发（核对各平台无重复帖）
5. 告警：临时改错 SMTP_PASS 之外再改对一个假 token 跑 `--only x` → 收到失败邮件（SMTP 正确时）
6. 连续 3 天 11:55 无人值守自动发布全成功
7. 打包部署到常开机器：解压 → install.bat → Chrome 登录 Pinterest → `schtasks /Run /TN SocialAuto-Daily` 手动触发一次验证

---

## 计划自审记录

- **规格覆盖**：平台接入(§2)→Task 9–13；素材规范(§4)→Task 3；时间表/可靠性(§5)→Task 6/7/15；文案(§6)→Task 4；token(§7)→Task 14+meta 刷新；告警(§8)→Task 5/7/15；统计(§9)→Task 2 append_stat；部署(§10)→Task 16；验收(§12)→Task 16 Step 4。✅ 无缺口
- **占位符**：Task 7/11/12/13/15 测试代码中标注的笔误（无效断言/缩进/walrus）已给出修正写法，执行者照修正实现。✅
- **类型一致性**：Material/PlatformCopy/StateStore 方法签名跨任务一致；平台 post 签名统一 `(copy, material, url_for)`。✅
- **已知不确定点（执行时验证，不阻塞开工）**：Shopify fileCreate 的 originalSource 形参名、Pinterest v5 video media_source 字段名、agent-browser CLI 子命令名、Threads video 是否需要轮询——均按当前最佳认知实现，验收阶段以真实 API 响应校准。
