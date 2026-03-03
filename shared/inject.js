/*
 * DI-Viewer injected UI logic for Tauri.
 * Dock behavior, i18n, tabs/bookmarks and shortcut config.
 */
(function () {
  "use strict";

  window.__diviewer_inject_ready__ = false;

  function initBridge(callback) {
    if (window.bridge) {
      callback(window.bridge);
      return;
    }
    if (typeof QWebChannel !== "undefined" && window.qt && qt.webChannelTransport) {
      new QWebChannel(qt.webChannelTransport, function (ch) {
        window.bridge = (ch && ch.objects && ch.objects.bridge) || {};
        callback(window.bridge);
      });
      return;
    }
    window.bridge = window.bridge || {};
    callback(window.bridge);
  }

  function hasFn(obj, key) {
    return obj && typeof obj[key] === "function";
  }

  function asPromise(result) {
    if (result && typeof result.then === "function") return result;
    return Promise.resolve(result);
  }

  initBridge(function (bridge) {
    try {
      setupUI(bridge || {});
      window.__diviewer_inject_ready__ = true;
    } catch (_e) {
      window.__diviewer_inject_ready__ = false;
    }
  });

  function setupUI(bridge) {
    var tabs = Array.from(document.querySelectorAll(".diviewer-tab-box .tab-btn"));
    var allContent = Array.from(document.querySelectorAll(".diviewer-content-box .content"));
    var panel = document.getElementById("diviewer-panel");
    var overlay = document.getElementById("diviewer-overlay");
    var dock = document.getElementById("diviewer-dock");
    var dockBtns = Array.from(document.querySelectorAll(".diviewer-dock-bar .dock-btn"));
    var line = document.querySelector(".diviewer-line");
    var tabBox = document.querySelector(".diviewer-tab-box");
    var dockColorSelect = document.getElementById("diviewer-dockColorSelect");
    var langSelect = document.getElementById("diviewer-langSelect");
    var quickHint = document.getElementById("diviewer-quickState");
    var showHideLabel = document.getElementById("diviewer-showHideLabel");

    if (!panel || !overlay || !dock || tabs.length === 0 || allContent.length === 0) return;

    var i18n = {
      zh: {
        "dock.quick": "快捷",
        "dock.status": "状态",
        "dock.navigate": "导航",
        "dock.media": "媒体",
        "dock.shortcuts": "快捷键",
        "dock.help": "帮助",
        "dock.bookmarks": "书签",
        "panel.title": "DI-Viewer",
        "panel.lang": "语言",
        "key.theme": "状态条颜色",
        "theme.amber": "琥珀",
        "theme.blue": "蓝色",
        "theme.green": "绿色",
        "theme.rose": "玫瑰",
        "theme.slate": "石板",
        "tab.quick": "快捷",
        "tab.navigate": "导航",
        "tab.media": "媒体",
        "tab.shortcuts": "快捷键",
        "tab.help": "帮助",
        "quick.home": "主页",
        "quick.show": "显示",
        "quick.hide": "隐藏",
        "quick.onTop": "置顶",
        "quick.inside": "穿透",
        "quick.opacityDown": "透明-",
        "quick.opacityUp": "透明+",
        "quick.maxRestore": "最大化/还原",
        "quick.minimize": "最小化",
        "quick.lock": "锁定",
        "quick.locked": "已锁定",
        "quick.exit": "退出",
        "quick.status": "透明度 {opacity} | 置顶 {onTop} | 穿透 {inside}",
        "quick.on": "开",
        "quick.off": "关",
        "nav.placeholder": "输入网址...",
        "nav.go": "前往",
        "nav.back": "后退",
        "nav.forward": "前进",
        "nav.refresh": "刷新",
        "nav.tabs": "标签页",
        "nav.newTab": "+ 新建",
        "nav.bookmarks": "书签",
        "nav.addBookmark": "+ 收藏",
        "media.playPause": "播放/暂停",
        "media.backward": "后退 5 秒",
        "media.forward": "前进 5 秒",
        "media.fullscreen": "全屏",
        "media.pip": "画中画",
        "key.playPause": "播放/暂停",
        "key.showHide": "显示/隐藏",
        "key.inside": "穿透",
        "key.fullscreen": "全屏",
        "key.backward": "后退",
        "key.forward": "前进",
        "key.opacityDown": "透明-",
        "key.opacityUp": "透明+",
        "key.close": "关闭应用",
        "key.save": "保存",
        "key.reset": "重置",
        "help.title": "使用提示",
        "help.1": "侧边状态条悬停展开，离开自动收缩。",
        "help.2": "快捷页用于窗口级控制。",
        "help.3": "导航页用于标签与书签管理。",
        "help.4": "媒体页用于播放和全屏操作。",
        "help.5": "快捷键页用于全局热键配置。",
        "tab.close": "关闭"
      },
      en: {
        "dock.quick": "Quick",
        "dock.status": "Status",
        "dock.navigate": "Navigate",
        "dock.media": "Media",
        "dock.shortcuts": "Shortcuts",
        "dock.help": "Help",
        "dock.bookmarks": "Bookmarks",
        "panel.title": "DI-Viewer",
        "panel.lang": "Language",
        "key.theme": "Strip Color",
        "theme.amber": "Amber",
        "theme.blue": "Blue",
        "theme.green": "Green",
        "theme.rose": "Rose",
        "theme.slate": "Slate",
        "tab.quick": "Quick",
        "tab.navigate": "Navigate",
        "tab.media": "Media",
        "tab.shortcuts": "Shortcuts",
        "tab.help": "Help",
        "quick.home": "Home",
        "quick.show": "Show",
        "quick.hide": "Hide",
        "quick.onTop": "On Top",
        "quick.inside": "Inside",
        "quick.opacityDown": "Opacity-",
        "quick.opacityUp": "Opacity+",
        "quick.maxRestore": "Max/Restore",
        "quick.minimize": "Minimize",
        "quick.lock": "Lock",
        "quick.locked": "Locked",
        "quick.exit": "Exit",
        "quick.status": "Opacity {opacity} | OnTop {onTop} | Inside {inside}",
        "quick.on": "On",
        "quick.off": "Off",
        "nav.placeholder": "Type URL...",
        "nav.go": "Go",
        "nav.back": "Back",
        "nav.forward": "Forward",
        "nav.refresh": "Refresh",
        "nav.tabs": "Tabs",
        "nav.newTab": "+ New",
        "nav.bookmarks": "Bookmarks",
        "nav.addBookmark": "+ Save",
        "media.playPause": "Play/Pause",
        "media.backward": "Backward 5s",
        "media.forward": "Forward 5s",
        "media.fullscreen": "Fullscreen",
        "media.pip": "PiP",
        "key.playPause": "Play/Pause",
        "key.showHide": "Show/Hide",
        "key.inside": "Inside",
        "key.fullscreen": "Fullscreen",
        "key.backward": "Backward",
        "key.forward": "Forward",
        "key.opacityDown": "Opacity -",
        "key.opacityUp": "Opacity +",
        "key.close": "Close App",
        "key.save": "Save",
        "key.reset": "Reset",
        "help.title": "Tips",
        "help.1": "Dock auto expands on hover and collapses automatically.",
        "help.2": "Use Quick tab for window-level actions.",
        "help.3": "Use Navigate tab for tabs and bookmarks.",
        "help.4": "Use Media tab for playback and fullscreen actions.",
        "help.5": "Configure global shortcuts in Shortcuts tab.",
        "tab.close": "Close"
      }
    };

    var lang = "en";

    function t(key) {
      var table = i18n[lang] || i18n.en;
      return table[key] || i18n.en[key] || key;
    }

    function applyI18n(nextLang) {
      lang = (nextLang === "zh" || nextLang === "en") ? nextLang : "en";
      document.documentElement.setAttribute("lang", lang);

      Array.from(document.querySelectorAll("[data-i18n]")).forEach(function (el) {
        var key = el.getAttribute("data-i18n");
        if (key) el.textContent = t(key);
      });
      Array.from(document.querySelectorAll("[data-i18n-title]")).forEach(function (el) {
        var key = el.getAttribute("data-i18n-title");
        if (key) el.setAttribute("title", t(key));
      });
      Array.from(document.querySelectorAll("[data-i18n-placeholder]")).forEach(function (el) {
        var key = el.getAttribute("data-i18n-placeholder");
        if (key) el.setAttribute("placeholder", t(key));
      });
      if (langSelect) langSelect.value = lang;
    }

    function normalizeDockColor(value) {
      var raw = String(value || "").toLowerCase();
      if (raw === "blue" || raw === "green" || raw === "rose" || raw === "slate") return raw;
      return "amber";
    }

    function applyDockColor(nextColor) {
      var resolved = normalizeDockColor(nextColor);
      dock.setAttribute("data-dock-color", resolved);
      if (panel) panel.setAttribute("data-dock-color", resolved);
      if (dockColorSelect) dockColorSelect.value = resolved;
      return resolved;
    }

    function switchTab(index) {
      var max = Math.min(tabs.length, allContent.length) - 1;
      var idx = Math.max(0, Math.min(index, max));
      tabs.forEach(function (tItem) {
        tItem.classList.remove("active");
      });
      allContent.forEach(function (c) {
        c.classList.remove("active");
      });
      tabs[idx].classList.add("active");
      allContent[idx].classList.add("active");
      if (line && tabBox) {
        var w = tabBox.getBoundingClientRect().width || 0;
        line.style.left = (idx * w / tabs.length) + "px";
      }
    }

    var collapseTimer = null;

    function expandDock() {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
      dock.classList.add("expanded");
    }

    function scheduleDockCollapse() {
      if (collapseTimer) clearTimeout(collapseTimer);
      collapseTimer = setTimeout(function () {
        if (!panel.classList.contains("active") && !dock.matches(":hover")) {
          dock.classList.remove("expanded");
          dockBtns.forEach(function (btn) {
            btn.classList.remove("active");
          });
        }
      }, 260);
    }

    function openPanel(tabIndex) {
      panel.classList.add("active");
      overlay.classList.add("active");
      expandDock();
      switchTab(tabIndex);
      if (tabIndex === 0) refreshQuickState();
      if (tabIndex === 1) {
        refreshTabs();
        refreshBookmarks();
      }
    }

    function closePanel() {
      panel.classList.remove("active");
      overlay.classList.remove("active");
      dockBtns.forEach(function (b) {
        b.classList.remove("active");
      });
      scheduleDockCollapse();
    }

    function callBridge(name, args, fallback) {
      if (!hasFn(bridge, name)) return Promise.resolve(fallback);
      return asPromise(bridge[name].apply(bridge, args || []));
    }

    function refreshQuickState() {
      return callBridge("get_state", []).then(function (state) {
        if (!state) return;
        if (showHideLabel) {
          showHideLabel.textContent = state.visible ? t("quick.hide") : t("quick.show");
        }
        var lockSpan = document.querySelector("#diviewer-lockPosBtn span");
        if (lockSpan) {
          lockSpan.textContent = state.positionLocked ? t("quick.locked") : t("quick.lock");
        }
        if (quickHint) {
          quickHint.textContent = t("quick.status")
            .replace("{opacity}", Number(state.opacity || 1).toFixed(2))
            .replace("{onTop}", state.onTop ? t("quick.on") : t("quick.off"))
            .replace("{inside}", state.inside ? t("quick.on") : t("quick.off"));
        }
      }).catch(function () {});
    }

    overlay.addEventListener("click", closePanel);
    dock.addEventListener("mouseenter", expandDock);
    dock.addEventListener("mouseleave", scheduleDockCollapse);

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () {
        switchTab(i);
        if (i === 0) refreshQuickState();
        if (i === 1) {
          refreshTabs();
          refreshBookmarks();
        }
      });
    });

    dockBtns.forEach(function (btn) {
      btn.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
      });
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();

        var tabIndex = Number(btn.getAttribute("data-tab") || "0");
        var dockAction = btn.getAttribute("data-dock") || "";
        var isOpen = panel.classList.contains("active");
        var wasActive = btn.classList.contains("active");

        dockBtns.forEach(function (b) {
          b.classList.remove("active");
        });

        if (isOpen && wasActive) {
          closePanel();
          return;
        }

        btn.classList.add("active");
        openPanel(tabIndex);

        if (dockAction === "bookmarks") {
          var target = document.getElementById("diviewer-bookmarkSection");
          if (target && typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
        }
      });
    });

    var homePageBtn = document.getElementById("diviewer-homePageBtn");
    if (homePageBtn) {
      homePageBtn.onclick = function () {
        callBridge("navigate", ["https://limestart.cn/"]).finally(closePanel);
      };
    }

    var showHideBtn = document.getElementById("diviewer-showHideBtn");
    if (showHideBtn) {
      showHideBtn.onclick = function () {
        callBridge("toggle_show_hide", []).then(refreshQuickState).catch(function () {});
      };
    }

    var onTopBtn = document.getElementById("diviewer-onTopBtn");
    if (onTopBtn) {
      onTopBtn.onclick = function () {
        callBridge("toggle_on_top", []).then(refreshQuickState).catch(function () {});
      };
    }

    var insideModeBtn = document.getElementById("diviewer-insideModeBtn");
    if (insideModeBtn) {
      insideModeBtn.onclick = function () {
        callBridge("toggle_inside_mode", []).then(refreshQuickState).catch(function () {});
      };
    }

    var opacityUpBtn = document.getElementById("diviewer-opacityUpBtn");
    if (opacityUpBtn) {
      opacityUpBtn.onclick = function () {
        callBridge("increase_opacity", []).then(refreshQuickState).catch(function () {});
      };
    }

    var opacityDownBtn = document.getElementById("diviewer-opacityDownBtn");
    if (opacityDownBtn) {
      opacityDownBtn.onclick = function () {
        callBridge("decrease_opacity", []).then(refreshQuickState).catch(function () {});
      };
    }

    var maximizeBtn = document.getElementById("diviewer-maximizeBtn");
    if (maximizeBtn) {
      maximizeBtn.onclick = function () {
        callBridge("maximize_restore", []).then(refreshQuickState).catch(function () {});
      };
    }

    var minimizeBtn = document.getElementById("diviewer-minimizeBtn");
    if (minimizeBtn) {
      minimizeBtn.onclick = function () {
        callBridge("minimize", []).finally(closePanel);
      };
    }

    var closeBtn = document.getElementById("diviewer-closeBtn");
    if (closeBtn) {
      closeBtn.onclick = function () {
        callBridge("close_window", []);
      };
    }

    var lockPosBtn = document.getElementById("diviewer-lockPosBtn");
    if (lockPosBtn) {
      lockPosBtn.onclick = function () {
        if (!hasFn(bridge, "toggle_lock_position")) return;
        asPromise(bridge.toggle_lock_position(function () {})).then(refreshQuickState).catch(function () {});
      };
    }

    Array.from(document.querySelectorAll(".diviewer-size-presets button")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ratio = parseFloat(btn.getAttribute("data-ratio") || "0.5");
        callBridge("resize_to_ratio", [ratio]).catch(function () {});
      });
    });

    var addressInput = document.querySelector(".diviewer-address-input");
    if (addressInput) {
      addressInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          var target = addressInput.value.trim();
          callBridge("navigate", [target]).finally(closePanel);
        }
      });
    }

    var searchBtn = document.getElementById("diviewer-search-button");
    if (searchBtn) {
      searchBtn.onclick = function () {
        var target = addressInput ? addressInput.value.trim() : "";
        callBridge("navigate", [target]).finally(closePanel);
      };
    }

    var backBtn = document.getElementById("diviewer-backBtn");
    if (backBtn) backBtn.onclick = function () { history.back(); };
    var forwardBtn = document.getElementById("diviewer-forwardBtn");
    if (forwardBtn) forwardBtn.onclick = function () { history.forward(); };
    var refreshBtn = document.getElementById("diviewer-refreshBtn");
    if (refreshBtn) refreshBtn.onclick = function () { location.reload(); };

    Array.from(document.querySelectorAll("[data-video-action]")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.getAttribute("data-video-action") || "";
        callBridge("video_action", [action]).catch(function () {});
      });
    });

    var pipBtn = document.getElementById("diviewer-pipBtn");
    if (pipBtn) {
      pipBtn.onclick = function () {
        var v = document.querySelector("video");
        if (!v) return;
        if (document.pictureInPictureElement && document.exitPictureInPicture) {
          document.exitPictureInPicture().catch(function () {});
        } else if (v.requestPictureInPicture) {
          v.requestPictureInPicture().catch(function () {});
        }
      };
    }

    Array.from(document.querySelectorAll(".key-config-input")).forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        e.preventDefault();
        var keys = [];
        if (e.ctrlKey) keys.push("Ctrl");
        if (e.altKey) keys.push("Alt");
        if (e.shiftKey) keys.push("Shift");
        if (e.metaKey) keys.push("Meta");

        var raw = e.key || "";
        var finalKey = raw;
        if (raw === "`") finalKey = "Backquote";
        if (raw.length === 1 && /[a-z]/i.test(raw)) finalKey = raw.toUpperCase();
        if (["Control", "Alt", "Shift", "Meta"].indexOf(raw) >= 0) finalKey = "";

        if (finalKey) keys.push(finalKey);
        input.value = keys.join("+");
      });
    });

    var hotkeyDefaults = {
      togglePlayPause: "Backquote",
      toggleShowHide: "0",
      insideMode: "P",
      videoBackward: "5",
      videoForward: "6",
      decreaseOpacity: "7",
      increaseOpacity: "8",
      requestFullScreen: "O",
      closeWindow: "Ctrl+Q"
    };
    var cachedHotkeyConfig = null;

    function parseHotkeyConfig(jsonStr) {
      try {
        return JSON.parse(String(jsonStr || "{}"));
      } catch (_e) {
        return {};
      }
    }

    function normalizeHotkeyConfig(source) {
      var normalized = {};
      Object.keys(hotkeyDefaults).forEach(function (key) {
        var value = source && source[key];
        normalized[key] = value ? String(value) : hotkeyDefaults[key];
      });
      return normalized;
    }

    function applyHotkeyConfigToForm(config) {
      Object.keys(config || {}).forEach(function (key) {
        var el = document.getElementById("diviewer-" + key);
        if (el) el.value = config[key];
      });
    }

    function loadHotkeyConfig() {
      if (!hasFn(bridge, "get_config")) return Promise.resolve(normalizeHotkeyConfig({}));
      return new Promise(function (resolve) {
        bridge.get_config(function (jsonStr) {
          resolve(normalizeHotkeyConfig(parseHotkeyConfig(jsonStr)));
        });
      });
    }

    var saveConfigBtn = document.getElementById("diviewer-saveConfigBtn");
    if (saveConfigBtn) {
      saveConfigBtn.onclick = function () {
        var form = document.getElementById("diviewer-hotkeyForm");
        if (!form) return;

        var fd = new FormData(form);
        var nextConfig = normalizeHotkeyConfig(cachedHotkeyConfig || {});
        fd.forEach(function (v, k) {
          var value = String(v || "").trim();
          nextConfig[k] = value || hotkeyDefaults[k] || "";
        });

        if (hasFn(bridge, "save_config")) {
          asPromise(bridge.save_config(JSON.stringify(nextConfig))).then(function () {
            cachedHotkeyConfig = nextConfig;
            applyHotkeyConfigToForm(nextConfig);
          }).catch(function () {});
        }
      };
    }

    var resetConfigBtn = document.getElementById("diviewer-resetConfigBtn");
    if (resetConfigBtn) {
      resetConfigBtn.onclick = function () {
        if (hasFn(bridge, "reset_config")) {
          asPromise(bridge.reset_config(function (jsonStr) {
            var cfg = normalizeHotkeyConfig(parseHotkeyConfig(jsonStr));
            cachedHotkeyConfig = cfg;
            applyHotkeyConfigToForm(cfg);
          })).catch(function () {});
          return;
        }
        loadHotkeyConfig().then(function (cfg) {
          cachedHotkeyConfig = cfg;
          applyHotkeyConfigToForm(cfg);
        }).catch(function () {});
      };
    }

    function fallbackTabs() {
      if (!Array.isArray(window.__diaoTabs) || window.__diaoTabs.length === 0) {
        window.__diaoTabs = [{ title: document.title || window.location.href, url: window.location.href }];
        window.__diaoActiveTab = 0;
      }
      if (typeof window.__diaoActiveTab !== "number") window.__diaoActiveTab = 0;
      var max = window.__diaoTabs.length - 1;
      window.__diaoActiveTab = Math.max(0, Math.min(window.__diaoActiveTab, max));
      return {
        tabs: window.__diaoTabs.slice(),
        activeIndex: window.__diaoActiveTab
      };
    }

    function getTabs(cb) {
      if (hasFn(bridge, "get_tabs")) {
        bridge.get_tabs(cb);
        return;
      }
      cb(JSON.stringify(fallbackTabs()));
    }

    function switchTabSession(index) {
      if (hasFn(bridge, "switch_tab")) {
        return asPromise(bridge.switch_tab(index));
      }
      var snapshot = fallbackTabs();
      var idx = Math.max(0, Math.min(index, snapshot.tabs.length - 1));
      window.__diaoActiveTab = idx;
      var target = snapshot.tabs[idx] && snapshot.tabs[idx].url;
      if (target) window.location.assign(target);
      return Promise.resolve(target || "");
    }

    function createNewTab(url) {
      var target = url || "https://limestart.cn/";
      if (hasFn(bridge, "new_tab")) {
        return asPromise(bridge.new_tab(target));
      }
      var snapshot = fallbackTabs();
      snapshot.tabs.push({ title: target, url: target });
      window.__diaoTabs = snapshot.tabs;
      window.__diaoActiveTab = snapshot.tabs.length - 1;
      window.location.assign(target);
      return Promise.resolve(target);
    }

    function closeTabSession(index) {
      if (hasFn(bridge, "close_tab")) {
        return asPromise(bridge.close_tab(index));
      }
      var snapshot = fallbackTabs();
      if (snapshot.tabs.length <= 1) {
        snapshot.tabs[0] = { title: "Home", url: "https://limestart.cn/" };
        window.__diaoTabs = snapshot.tabs;
        window.__diaoActiveTab = 0;
        window.location.assign("https://limestart.cn/");
        return Promise.resolve(true);
      }
      var idx = Math.max(0, Math.min(index, snapshot.tabs.length - 1));
      snapshot.tabs.splice(idx, 1);
      if (window.__diaoActiveTab >= snapshot.tabs.length) {
        window.__diaoActiveTab = snapshot.tabs.length - 1;
      }
      var target = snapshot.tabs[window.__diaoActiveTab] && snapshot.tabs[window.__diaoActiveTab].url;
      window.__diaoTabs = snapshot.tabs;
      if (target) window.location.assign(target);
      return Promise.resolve(true);
    }

    function refreshTabs() {
      var list = document.getElementById("diviewer-session-tab-list");
      if (!list) return;

      getTabs(function (jsonStr) {
        list.innerHTML = "";
        try {
          var parsed = JSON.parse(jsonStr || "{}");
          var tabItems = Array.isArray(parsed.tabs) ? parsed.tabs : [];
          var activeIndex = Number(parsed.activeIndex || 0);

          tabItems.forEach(function (tab, i) {
            var item = document.createElement("div");
            item.className = "diviewer-session-tab-item" + (i === activeIndex ? " active" : "");

            var openBtn = document.createElement("button");
            openBtn.className = "tab-open";
            openBtn.textContent = tab.title || tab.url || ("Tab " + (i + 1));
            openBtn.title = tab.url || "";
            openBtn.addEventListener("click", function () {
              switchTabSession(i).then(refreshTabs).catch(function () {});
            });

            var closeTabBtn = document.createElement("button");
            closeTabBtn.className = "tab-close";
            closeTabBtn.textContent = "x";
            closeTabBtn.title = t("tab.close");
            closeTabBtn.addEventListener("click", function (e) {
              e.stopPropagation();
              closeTabSession(i).then(refreshTabs).catch(function () {});
            });

            item.appendChild(openBtn);
            item.appendChild(closeTabBtn);
            list.appendChild(item);
          });
        } catch (_e) {}
      });
    }

    var newTabBtn = document.getElementById("diviewer-newTabBtn");
    if (newTabBtn) {
      newTabBtn.onclick = function () {
        createNewTab("https://limestart.cn/").then(refreshTabs).catch(function () {});
      };
    }

    function fallbackBookmarks() {
      if (!Array.isArray(window.__diaoBookmarks)) window.__diaoBookmarks = [];
      return window.__diaoBookmarks;
    }

    function getBookmarks(cb) {
      if (hasFn(bridge, "get_bookmarks")) {
        bridge.get_bookmarks(cb);
        return;
      }
      cb(JSON.stringify(fallbackBookmarks()));
    }

    function addBookmark(url, title) {
      if (hasFn(bridge, "add_bookmark")) {
        return asPromise(bridge.add_bookmark(url, title));
      }
      var list = fallbackBookmarks();
      var exists = list.some(function (it) { return it.url === url; });
      if (!exists) list.push({ url: url, title: title || url });
      return Promise.resolve();
    }

    function removeBookmark(url) {
      if (hasFn(bridge, "remove_bookmark")) {
        return asPromise(bridge.remove_bookmark(url));
      }
      var list = fallbackBookmarks();
      window.__diaoBookmarks = list.filter(function (it) { return it.url !== url; });
      return Promise.resolve();
    }

    function refreshBookmarks() {
      var list = document.getElementById("diviewer-bookmark-list");
      if (!list) return;

      getBookmarks(function (jsonStr) {
        list.innerHTML = "";
        try {
          var bookmarks = JSON.parse(jsonStr || "[]");
          bookmarks.forEach(function (bm) {
            var item = document.createElement("div");
            item.className = "diviewer-bookmark-item";

            var title = document.createElement("button");
            title.className = "bm-title";
            title.textContent = bm.title || bm.url;
            title.title = bm.url || "";
            title.addEventListener("click", function () {
              callBridge("navigate", [bm.url]).finally(closePanel);
            });

            var del = document.createElement("button");
            del.className = "bm-del";
            del.textContent = "x";
            del.title = t("tab.close");
            del.addEventListener("click", function (e) {
              e.stopPropagation();
              removeBookmark(bm.url).then(refreshBookmarks).catch(function () {});
            });

            item.appendChild(title);
            item.appendChild(del);
            list.appendChild(item);
          });
        } catch (_e) {}
      });
    }

    var addBmBtn = document.getElementById("diviewer-addBookmarkBtn");
    if (addBmBtn) {
      addBmBtn.onclick = function () {
        addBookmark(window.location.href, document.title).then(refreshBookmarks).catch(function () {});
      };
    }

    if (dockColorSelect) {
      dockColorSelect.addEventListener("change", function () {
        var next = applyDockColor(dockColorSelect.value);
        callBridge("set_dock_color", [next], next).then(function (saved) {
          applyDockColor(saved);
        }).catch(function () {});
      });
    }

    if (langSelect) {
      langSelect.addEventListener("change", function () {
        var next = langSelect.value === "zh" ? "zh" : "en";
        applyI18n(next);
        callBridge("set_ui_language", [next], next).then(function (saved) {
          var resolved = saved === "zh" || saved === "en" ? saved : next;
          applyI18n(resolved);
          refreshQuickState();
          refreshTabs();
          refreshBookmarks();
        }).catch(function () {});
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("active")) closePanel();
      if (e.ctrlKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        createNewTab("https://limestart.cn/").then(refreshTabs).catch(function () {});
      }
      if (e.ctrlKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        closeTabSession(-1).then(refreshTabs).catch(function () {});
      }
    });

    var browserLang = (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
    callBridge("get_ui_language", [], browserLang).then(function (result) {
      var resolved = result === "zh" || result === "en" ? result : browserLang;
      applyI18n(resolved);
      return callBridge("get_dock_color", [], "amber");
    }).then(function (dockColor) {
      applyDockColor(dockColor);
      return loadHotkeyConfig();
    }).then(function (config) {
      cachedHotkeyConfig = config;
      applyHotkeyConfigToForm(config);
      refreshQuickState();
      refreshTabs();
      refreshBookmarks();
      scheduleDockCollapse();
    }).catch(function () {
      applyI18n("en");
      applyDockColor("amber");
      refreshQuickState();
      refreshTabs();
      refreshBookmarks();
      scheduleDockCollapse();
    });
  }
})();
