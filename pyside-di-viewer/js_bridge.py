"""
JsBridge — QWebChannel bridge between Python and injected JavaScript.
Replaces the old nExposeFunction + WebMessage approach.
"""
import json
import os
import re

import requests
from PySide6.QtCore import QObject, Slot, QUrl

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class JsBridge(QObject):
    """Exposed to JS as `window.bridge` via QWebChannel."""

    def __init__(self, browser):
        super().__init__(browser)
        self._browser = browser

    # ─── navigation ─────────────────────────────────────────────

    @Slot(str)
    def navigate(self, url: str):
        if not url.startswith(("http://", "https://", "file://")):
            url = "https://" + url
        self._browser.web.load(QUrl(url))

    # ─── window controls ───────────────────────────────────────

    @Slot()
    def minimize(self):
        self._browser.showMinimized()

    @Slot()
    def maximize(self):
        if self._browser.isMaximized():
            self._browser.showNormal()
        else:
            self._browser.showMaximized()

    @Slot()
    def close_window(self):
        self._browser.close()

    @Slot()
    def toggle_show_hide(self):
        self._browser.toggle_show_hide()

    @Slot()
    def toggle_on_top(self):
        self._browser.toggle_on_top()

    @Slot()
    def toggle_inside_mode(self):
        self._browser.toggle_inside_mode()

    # ─── lock position ────────────────────────────────────────────

    @Slot(result=bool)
    def toggle_lock_position(self):
        return self._browser.toggle_lock_position()

    # ─── window size presets ──────────────────────────────────────

    @Slot(float)
    def resize_to_ratio(self, ratio: float):
        self._browser.resize_to_ratio(ratio)

    # ─── bookmarks ────────────────────────────────────────────────

    @Slot(str, str, result=bool)
    def add_bookmark(self, url: str, title: str):
        return self._browser.add_bookmark(url, title)

    @Slot(str)
    def remove_bookmark(self, url: str):
        self._browser.remove_bookmark(url)

    @Slot(result=str)
    def get_bookmarks(self):
        return self._browser.get_bookmarks()

    # ─── multi-tab ────────────────────────────────────────────────

    @Slot(str, result=int)
    def new_tab(self, url: str):
        tab = self._browser.new_tab(url)
        return self._browser.tab_count() - 1

    @Slot(int)
    def close_tab(self, index: int):
        if index < 0:
            index = self._browser._active_idx
        self._browser.close_tab(index)

    @Slot(int)
    def switch_tab(self, index: int):
        self._browser.switch_tab(index)

    # ─── opacity ────────────────────────────────────────────────

    @Slot(float)
    def set_opacity(self, value: float):
        self._browser._opacity = max(0.1, min(1.0, value))
        self._browser.setWindowOpacity(self._browser._opacity)

    @Slot()
    def increase_opacity(self):
        self._browser.increase_opacity()

    @Slot()
    def decrease_opacity(self):
        self._browser.decrease_opacity()

    # ─── video controls ─────────────────────────────────────────

    @Slot()
    def toggle_play_pause(self):
        self._browser.toggle_play_pause()

    @Slot()
    def video_forward(self):
        self._browser.video_forward()

    @Slot()
    def video_backward(self):
        self._browser.video_backward()

    @Slot()
    def request_fullscreen(self):
        self._browser.request_fullscreen()

    # ─── config ─────────────────────────────────────────────────

    @Slot(result=str)
    def get_config(self):
        return json.dumps(self._browser.get_config())

    @Slot(str)
    def save_config(self, config_json: str):
        config = json.loads(config_json)
        self._browser.save_config(config)

    # ─── bilibili subtitle download ─────────────────────────────

    @Slot(str, result=str)
    def download_subtitles(self, bvid_or_url: str) -> str:
        bvid = self._extract_bvid(bvid_or_url)
        if not bvid:
            return json.dumps({"ok": False, "message": "BV号未找到"})

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/121.0.0.0 Safari/537.36"
            )
        }

        try:
            view_url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
            resp = requests.get(view_url, headers=headers, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if data.get("code") != 0:
                return json.dumps({"ok": False, "message": "获取视频信息失败"})

            video = data.get("data", {})
            aid = video.get("aid")
            pages = video.get("pages", [])
            if not aid or not pages:
                return json.dumps({"ok": False, "message": "缺少视频元数据"})

            cid = pages[0].get("cid")
            if not cid:
                return json.dumps({"ok": False, "message": "CID未找到"})

            sub_url = f"https://api.bilibili.com/x/player/v2?aid={aid}&cid={cid}"
            sub_resp = requests.get(sub_url, headers=headers, timeout=10)
            sub_resp.raise_for_status()
            sub_data = sub_resp.json()
            subtitles = (
                sub_data.get("data", {})
                .get("subtitle", {})
                .get("subtitles", [])
            )
            if not subtitles:
                return json.dumps({"ok": False, "message": "无可用字幕"})

            subtitle_url = subtitles[0].get("subtitle_url", "")
            if subtitle_url.startswith("//"):
                subtitle_url = f"https:{subtitle_url}"

            sub_content = requests.get(subtitle_url, headers=headers, timeout=10)
            sub_content.raise_for_status()

            dl_dir = os.path.join(BASE_DIR, "download")
            os.makedirs(dl_dir, exist_ok=True)
            save_path = os.path.join(dl_dir, f"{bvid}_subtitle.json")
            with open(save_path, "w", encoding="utf-8") as f:
                f.write(sub_content.text)

            return json.dumps({"ok": True, "message": f"字幕已保存: {save_path}"})

        except Exception as e:
            return json.dumps({"ok": False, "message": f"下载失败: {e}"})

    @staticmethod
    def _extract_bvid(value: str):
        if not value:
            return None
        m = re.search(r"(BV[0-9A-Za-z]{10})", value)
        return m.group(1) if m else None
