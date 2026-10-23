"""pytest 配置：自动把 hooks/scripts/lib 加入 sys.path。"""
import sys
import os

import pytest

LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib")
LIB = os.path.abspath(LIB)
if LIB not in sys.path:
    sys.path.insert(0, LIB)


@pytest.fixture(autouse=True)
def _no_auto_consult(monkeypatch):
    """单测默认关闭钩子自动咨询（不打真实 dsh 端点）；专项测试自行覆写。"""
    monkeypatch.setenv("REGRESS_AUTO_CONSULT", "off")


@pytest.fixture(autouse=True)
def _no_journal(monkeypatch):
    """单测默认关闭考古地层写入（journal 专项测试在子进程 env 里显式开启）。"""
    monkeypatch.setenv("REGRESS_JOURNAL", "off")


@pytest.fixture(autouse=True)
def _isolate_machine_notify(monkeypatch, tmp_path):
    """机器级通知配置默认指向不存在路径（v1.31.4）。

    病例：两层合并落地后，未隔离的测试读到真机 ~/.zcode/regress-notify.json——
    通道修复当天每次跑测试都向用户手机发真实推送，且 ==1 计数断言全翻 ==2。
    需要机器级配置的测试自行 setenv 覆写。"""
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(tmp_path / "no-machine-conf.json"))
    monkeypatch.delenv("RG_NOTIFY_WECOM_JSON", raising=False)


@pytest.fixture(autouse=True)
def _isolate_pending_and_send_ledger(monkeypatch, tmp_path):
    """机器级待决台账/发送台账默认指向 tmp（v1.34）。

    同 v1.31.4 病例的同族预防：决策事件测试（plan_approval/blocked…）一旦
    走真机 ~/.zcode/regress-pending.jsonl，观察仪表盘的误报率就被测试噪音
    污染——度量层被污染比配置被污染更隐蔽（数字看起来仍然"正常"）。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "no-pending.jsonl"))
    monkeypatch.setenv("RG_SEND_LEDGER", str(tmp_path / "no-send.log"))


@pytest.fixture(autouse=True)
def _isolate_chat_fold_state(monkeypatch, tmp_path):
    """chat 折叠状态默认指向 tmp（v1.64）。

    病例：折叠状态走真机 ~/.zcode/regress-chat-fold.json 时，同标题 chat
    跨测试/收集顺序串味——先发的测试把状态写进真机，后跑的 stop_notify
    用例被折叠掉通道副作用（marker 文件不落）→ FileNotFoundError，
    且 shell 与门禁两种收集顺序表现不同（订单依赖假绿）。"""
    monkeypatch.setenv("RG_CHAT_STATE", str(tmp_path / "chat-fold.json"))


# v1.68：_trust_project_channels_by_default autouse 夹具已删——env 缝即
# 生产旁路（RG_TRUST_PROJECT_CHANNELS 可被 git commit 前缀注入，057 收口）。
# 项目级 channels 测试改 monkeypatch notify 模块 _TRUST_TABLE_PATH 属性
# （helper 见各测试文件 _trusted()），默认拒路径从此是真默认。
