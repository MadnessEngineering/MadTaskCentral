#!/usr/bin/env python3
"""Build Hearth_Ledger.prj.xml from scene.html + the Tasker JS files.

    python3 build.py            # writes ../Hearth_Ledger.prj.xml
    python3 build.py --unpack F # print the Scene V2 layout JSON inside a .prj.xml

Scene V2 keeps its layout as gzip+base64 JSON in <Scene><lj>. Schema notes come
from the docs Tasker 6.7.9 ships in its own dex (Scaffold/WebView/JS bridge).
Action XML is cloned from Dan's phone exports, not invented: JavaScriptlet
(129), Return (126), If/End If (37/38), Notify (523), Time context incl.
<fromvar> and rep=2 (= minutes; the phone shows "Every 5m").
Show Scene v2 (479; v2 opens as Dialog, v1 was Fullscreen) is cloned from the task built in Tasker's UI.
<limit>true</limit> on a profile imports it switched OFF, so we leave it out.
Cloned from Ludomancery/FrostLedger/build.py (life timers instead of game timers; no strip scene yet).
"""
import base64
import gzip
import json
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "Hearth_Ledger.prj.xml"
PROJECT = "Hearth Ledger"
SCENE = "Hearth Ledger"
STAMP = 1795521476000  # keep stable so rebuilds diff cleanly
# Placeholder ids for the first import; replace with what the phone assigns so exports diff cleanly.
T_STORAGE, T_REMINDER, T_OPEN, P_DUE, P_POLL = 900, 901, 902, 903, 904
POLL_MINUTES = 5


def no_tasker_vars(name: str, text: str) -> None:
    # A WebView with the JS bridge resolves %words in the page, and a hit inside
    # <script> switches the page to resolve-and-reload. Keep sources free of them.
    hits = sorted(set(re.findall(r"%[A-Za-z_]\w*", text)))
    if hits:
        sys.exit(f"{name}: Tasker would expand {hits}")


def webview(html: str, wid: str) -> dict:
    return {
        "type": "WebView",
        "id": wid,
        "modifiers": [{"type": "FillSize"}],
        "content": html,
        "javaScriptEnabled": "true",
        "domStorageEnabled": "true",
        "jsBridgeEnabled": "true",
        "useWideViewPort": "true",
        "allowContentAccess": "false",
    }


def blob(layout: dict) -> str:
    raw = json.dumps(layout, ensure_ascii=False, separators=(",", ":")).encode()
    return base64.b64encode(gzip.compress(raw, mtime=0)).decode()


def layout_blob(html: str) -> str:
    return blob({"name": SCENE, "root": {"type": "Scaffold", "id": "Scaffold1", "content": [webview(html, "Ledger")]}})


def js_action(sr: str, code: str) -> str:
    return f"""		<Action sr="{sr}" ve="7">
			<code>129</code>
			<Str sr="arg0" ve="3">{escape(code)}</Str>
			<Str sr="arg1" ve="3"/>
			<Int sr="arg2" val="1"/>
			<Int sr="arg3" val="45"/>
		</Action>"""


def build() -> str:
    shared = (HERE / "ledger.js").read_text()
    html = (HERE / "scene.html").read_text().replace("/*LEDGER_JS*/", shared)
    storage = (HERE / "storage.js").read_text()
    reminder = (HERE / "reminder.js").read_text()
    ack = (HERE / "ack.js").read_text()
    for name, text in (("scene.html", html), ("storage.js", storage), ("reminder.js", reminder), ("ack.js", ack)):
        no_tasker_vars(name, text)

    return f"""<TaskerData sr="" dvi="1" tv="6.7.9">
	<dmetric>1080.0,2424.0</dmetric>
	<Profile sr="prof{P_DUE}" ve="2">
		<id>{P_DUE}</id>
		<nme>Hearth Ledger Due</nme>
		<Time sr="con0">
			<fromvar>%HearthLedgerNext</fromvar>
			<th>-1</th>
			<tm>-1</tm>
		</Time>
		<mid0>{T_REMINDER}</mid0>
		<cdate>{STAMP}</cdate>
		<edate>{STAMP}</edate>
		<flags>8</flags>
	</Profile>
	<Profile sr="prof{P_POLL}" ve="2">
		<id>{P_POLL}</id>
		<nme>Hearth Ledger Poll</nme>
		<Time sr="con0">
			<repval>{POLL_MINUTES}</repval>
			<fh>-1</fh>
			<fm>-1</fm>
			<th>-1</th>
			<tm>-1</tm>
			<rep>2</rep>
		</Time>
		<mid0>{T_REMINDER}</mid0>
		<cdate>{STAMP}</cdate>
		<edate>{STAMP}</edate>
		<flags>8</flags>
	</Profile>
	<Project sr="proj0" ve="2">
		<cdate>{STAMP}</cdate>
		<id>76c7afe7-dcdd-4d7d-83dd-13ae13298a9b</id>
		<name>{PROJECT}</name>
		<pids>{P_DUE},{P_POLL}</pids>
		<scenes>{SCENE}</scenes>
		<tids>{T_STORAGE},{T_REMINDER},{T_OPEN}</tids>
	</Project>
	<Scene sr="scene{SCENE}">
		<cdate>{STAMP}</cdate>
		<edate>{STAMP}</edate>
		<heightLand>-1</heightLand>
		<heightPort>-1</heightPort>
		<lj>{layout_blob(html)}</lj>
		<nme>{SCENE}</nme>
		<widthLand>-1</widthLand>
		<widthPort>-1</widthPort>
	</Scene>
	<Task sr="task{T_STORAGE}">
		<cdate>{STAMP}</cdate>
		<edate>{STAMP}</edate>
		<id>{T_STORAGE}</id>
		<nme>Hearth Ledger Storage</nme>
{js_action("act0", storage)}
		<Action sr="act1" ve="7">
			<code>126</code>
			<Str sr="arg0" ve="3">%hl_reply</Str>
			<Int sr="arg1" val="1"/>
			<Int sr="arg2" val="0"/>
			<Int sr="arg3" val="0"/>
			<Str sr="arg4" ve="3"/>
		</Action>
	</Task>
	<Task sr="task{T_REMINDER}">
		<cdate>{STAMP}</cdate>
		<edate>{STAMP}</edate>
		<id>{T_REMINDER}</id>
		<nme>Hearth Ledger Reminder</nme>
{js_action("act0", reminder)}
		<Action sr="act1" ve="7">
			<code>37</code>
			<ConditionList sr="if">
				<Condition sr="c0" ve="3">
					<lhs>%hl_notify</lhs>
					<op>0</op>
					<rhs>yes</rhs>
				</Condition>
			</ConditionList>
		</Action>
		<Action sr="act2" ve="7">
			<code>523</code>
			<Str sr="arg0" ve="3">%hl_title</Str>
			<Str sr="arg1" ve="3">%hl_text</Str>
			<Img sr="arg2" ve="2"/>
			<Int sr="arg3" val="0"/>
			<Int sr="arg4" val="0"/>
			<Int sr="arg5" val="3"/>
			<Int sr="arg6" val="0"/>
			<Int sr="arg7" val="0"/>
			<Int sr="arg8" val="0"/>
			<Str sr="arg9" ve="3"/>
			<Str sr="arg10" ve="3"/>
			<Str sr="arg11" ve="3">Information</Str>
			<Str sr="arg12" ve="3"/>
			<Int sr="arg13" val="0"/>
			<Str sr="arg14" ve="3"/>
			<Str sr="arg15" ve="3"/>
		</Action>
{js_action("act3", ack)}
		<Action sr="act4" ve="7">
			<code>38</code>
		</Action>
	</Task>
	<Task sr="task{T_OPEN}">
		<cdate>{STAMP}</cdate>
		<edate>{STAMP}</edate>
		<id>{T_OPEN}</id>
		<nme>Hearth Ledger Open</nme>
		<pri>100</pri>
		<Action sr="act0" ve="7">
			<code>479</code>
			<Bundle sr="arg0">
				<Vals sr="val"/>
			</Bundle>
			<Str sr="arg1" ve="3">{SCENE}</Str>
			<Str sr="arg10" ve="3"/>
			<Str sr="arg11" ve="3"/>
			<Int sr="arg12" val="0"/>
			<Int sr="arg13" val="0"/>
			<Int sr="arg14" val="0"/>
			<Str sr="arg15" ve="3"/>
			<Int sr="arg16" val="1"/>
			<Str sr="arg2" ve="3"/>
			<Str sr="arg3" ve="3">Dialog</Str>
			<Str sr="arg4" ve="3"/>
			<Str sr="arg5" ve="3"/>
			<Str sr="arg6" ve="3"/>
			<Str sr="arg7" ve="3"/>
			<Int sr="arg8" val="1"/>
			<Str sr="arg9" ve="3"/>
		</Action>
	</Task>
</TaskerData>
"""


def unpack(path: str) -> None:
    lj = re.search(r"<lj>(.*?)</lj>", Path(path).read_text(), re.S).group(1)
    print(json.dumps(json.loads(gzip.decompress(base64.b64decode(lj))), indent=2))


if __name__ == "__main__":
    if sys.argv[1:2] == ["--unpack"]:
        unpack(sys.argv[2])
    else:
        OUT.write_text(build())
        print(f"wrote {OUT}")
