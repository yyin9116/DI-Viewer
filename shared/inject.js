/*
 * DI-Viewer injected UI logic for Tauri.
 * Single-window behavior with resilient event binding.
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
      // Rust fallback binder will take over when this is false.
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

    if (!panel || !overlay || tabs.length === 0 || allContent.length === 0) return;

    function $(id) {
      return document.getElementById(id);
    }

    function switchTab(index) {
      var max = Math.min(tabs.length, allContent.length) - 1;
      var idx = Math.max(0, Math.min(index, max));
      tabs.forEach(function (t) {
        t.classList.remove("active");
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

    function openPanel(tabIndex) {
      panel.classList.add("active");
      overlay.classList.add("active");
      if (dock) dock.classList.add("expanded");
      switchTab(tabIndex);
    }

    function closePanel() {
      panel.classList.remove("active");
      overlay.classList.remove("active");
      if (dock) dock.classList.remove("expanded");
      dockBtns.forEach(function (b) {
        b.classList.remove("active");
      });
    }

    overlay.addEventListener("click", closePanel);
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () {
        switchTab(i);
      });
    });

    // First 4 buttons map to tabs 0-3; 5th opens search tab + bookmarks.
    dockBtns.forEach(function (btn, i) {
      btn.addEventListener("pointerdown", function (e) {
        e.stopPropagation();
      });
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();

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
        if (i === 4) {
          openPanel(1);
          refreshTabs();
          refreshBookmarks();
        } else {
          openPanel(i);
        }
      });
    });

    var homePageBtn = $("diviewer-homePageBtn");
    if (homePageBtn) {
      homePageBtn.onclick = function () {
        if (hasFn(bridge, "navigate")) bridge.navigate("https://limestart.cn/");
        closePanel();
      };
    }

    var onTopBtn = $("diviewer-onTopBtn");
    if (onTopBtn) {
      onTopBtn.onclick = function () {
        if (hasFn(bridge, "toggle_on_top")) bridge.toggle_on_top();
      };
    }

    var pipBtn = $("diviewer-pipBtn");
    if (pipBtn) {
      pipBtn.onclick = function () {
        var v = document.querySelector("video");
        if (!v) return;
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(function () {});
        } else if (v.requestPictureInPicture) {
          v.requestPictureInPicture().catch(function () {});
        }
      };
    }

    var insideModeBtn = $("diviewer-insideModeBtn");
    if (insideModeBtn) {
      insideModeBtn.onclick = function () {
        if (hasFn(bridge, "toggle_inside_mode")) bridge.toggle_inside_mode();
        closePanel();
      };
    }

    var opacityUpBtn = $("diviewer-opacityUpBtn");
    if (opacityUpBtn) {
      opacityUpBtn.onclick = function () {
        if (hasFn(bridge, "increase_opacity")) bridge.increase_opacity();
      };
    }

    var opacityDownBtn = $("diviewer-opacityDownBtn");
    if (opacityDownBtn) {
      opacityDownBtn.onclick = function () {
        if (hasFn(bridge, "decrease_opacity")) bridge.decrease_opacity();
      };
    }

    var minimizeBtn = $("diviewer-minimizeBtn");
    if (minimizeBtn) {
      minimizeBtn.onclick = function () {
        if (hasFn(bridge, "minimize")) bridge.minimize();
        closePanel();
      };
    }

    var closeBtn = $("diviewer-closeBtn");
    if (closeBtn) {
      closeBtn.onclick = function () {
        if (hasFn(bridge, "close_window")) bridge.close_window();
      };
    }

    var lockState = false;
    var lockPosBtn = $("diviewer-lockPosBtn");
    if (lockPosBtn) {
      lockPosBtn.onclick = function () {
        var span = lockPosBtn.querySelector("span");
        var applyState = function (locked) {
          lockState = !!locked;
          if (!span) return;
          if (lockState) {
            span.textContent = "Locked";
            lockPosBtn.style.color = "#7360ff";
            lockPosBtn.style.background = "rgba(115,96,255,0.12)";
          } else {
            span.textContent = "Lock";
            lockPosBtn.style.color = "";
            lockPosBtn.style.background = "";
          }
        };

        if (hasFn(bridge, "toggle_lock_position")) {
          asPromise(bridge.toggle_lock_position(function (locked) {
            applyState(locked);
          })).catch(function () {});
        } else {
          applyState(!lockState);
        }
      };
    }

    document.querySelectorAll(".diviewer-size-presets button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ratio = parseFloat(this.getAttribute("data-ratio"));
        if (hasFn(bridge, "resize_to_ratio")) {
          asPromise(bridge.resize_to_ratio(ratio)).catch(function () {});
        }
      });
    });

    var addressInput = document.querySelector(".diviewer-address-input");
    if (addressInput) {
      addressInput.placeholder = window.location.href;
      addressInput.addEventListener("focus", function () {
        this.value = window.location.href;
        this.select();
      });
      addressInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          if (hasFn(bridge, "navigate")) bridge.navigate(this.value);
          closePanel();
        }
      });
    }

    var searchBtn = $("diviewer-search-button");
    if (searchBtn) {
      searchBtn.onclick = function () {
        var target = addressInput ? (addressInput.value || addressInput.placeholder) : window.location.href;
        if (hasFn(bridge, "navigate")) bridge.navigate(target);
        else window.location.assign(target);
        closePanel();
      };
    }

    var backBtn = $("diviewer-backBtn");
    if (backBtn) backBtn.onclick = function () { history.back(); };
    var forwardBtn = $("diviewer-forwardBtn");
    if (forwardBtn) forwardBtn.onclick = function () { history.forward(); };
    var refreshBtn = $("diviewer-refreshBtn");
    if (refreshBtn) refreshBtn.onclick = function () { location.reload(); };

    document.querySelectorAll(".key-config-input").forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        e.preventDefault();
        var keys = [];
        if (e.ctrlKey) keys.push("Ctrl");
        if (e.altKey) keys.push("Alt");
        if (e.shiftKey) keys.push("Shift");
        if (e.key !== "Control" && e.key !== "Alt" && e.key !== "Shift") keys.push(e.key);
        this.value = keys.join("+");
      });
    });

    var hotkeyDefaults = {
      togglePlayPause: "`",
      toggleShowHide: "0",
      insideMode: "p",
      videoBackward: "5",
      videoForward: "6",
      decreaseOpacity: "7",
      increaseOpacity: "8",
      requestFullScreen: "o",
      closeWindow: "Ctrl+q"
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

    loadHotkeyConfig().then(function (config) {
      cachedHotkeyConfig = config;
      applyHotkeyConfigToForm(config);
    }).catch(function () {});

    var saveConfigBtn = $("diviewer-saveConfigBtn");
    if (saveConfigBtn) {
      saveConfigBtn.onclick = function () {
        var form = document.querySelector(".diviewer-key-config-form");
        var fd = new FormData(form);
        var nextConfig = normalizeHotkeyConfig(cachedHotkeyConfig || {});

        fd.forEach(function (v, k) {
          var value = String(v || "").trim();
          nextConfig[k] = value || hotkeyDefaults[k] || "";
        });
        nextConfig.closeWindow = nextConfig.closeWindow || hotkeyDefaults.closeWindow;

        if (hasFn(bridge, "save_config")) {
          asPromise(bridge.save_config(JSON.stringify(nextConfig))).then(function () {
            cachedHotkeyConfig = nextConfig;
            applyHotkeyConfigToForm(nextConfig);
          }).catch(function () {});
        }
        closePanel();
      };
    }

    var resetConfigBtn = $("diviewer-resetConfigBtn");
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
          var tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
          var activeIndex = Number(parsed.activeIndex || 0);
          tabs.forEach(function (tab, i) {
            var item = document.createElement("div");
            item.className = "diviewer-session-tab-item" + (i === activeIndex ? " active" : "");

            var openBtn = document.createElement("button");
            openBtn.className = "tab-open";
            openBtn.textContent = tab.title || tab.url || ("Tab " + (i + 1));
            openBtn.title = tab.url || "";
            openBtn.addEventListener("click", function () {
              switchTabSession(i).then(function () {
                refreshTabs();
              }).catch(function () {});
            });

            var closeBtn = document.createElement("button");
            closeBtn.className = "tab-close";
            closeBtn.textContent = "x";
            closeBtn.title = "Close";
            closeBtn.addEventListener("click", function (e) {
              e.stopPropagation();
              closeTabSession(i).then(function () {
                refreshTabs();
              }).catch(function () {});
            });

            item.appendChild(openBtn);
            item.appendChild(closeBtn);
            list.appendChild(item);
          });
        } catch (_e) {}
      });
    }

    var newTabBtn = $("diviewer-newTabBtn");
    if (newTabBtn) {
      newTabBtn.onclick = function () {
        createNewTab("https://limestart.cn/").then(function () {
          refreshTabs();
        }).catch(function () {});
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
      var exists = list.some(function (it) {
        return it.url === url;
      });
      if (!exists) list.push({ url: url, title: title || url });
      return Promise.resolve();
    }

    function removeBookmark(url) {
      if (hasFn(bridge, "remove_bookmark")) {
        return asPromise(bridge.remove_bookmark(url));
      }
      var list = fallbackBookmarks();
      window.__diaoBookmarks = list.filter(function (it) {
        return it.url !== url;
      });
      return Promise.resolve();
    }

    function refreshBookmarks() {
      getBookmarks(function (jsonStr) {
        var list = document.getElementById("diviewer-bookmark-list");
        if (!list) return;
        list.innerHTML = "";
        try {
          var bookmarks = JSON.parse(jsonStr);
          bookmarks.forEach(function (bm) {
            var item = document.createElement("div");
            item.className = "diviewer-bookmark-item";

            var title = document.createElement("span");
            title.className = "bm-title";
            title.textContent = bm.title || bm.url;
            title.title = bm.url;
            title.addEventListener("click", function () {
              if (hasFn(bridge, "navigate")) bridge.navigate(bm.url);
              else window.location.assign(bm.url);
              closePanel();
            });

            var del = document.createElement("button");
            del.className = "bm-del";
            del.textContent = "x";
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

    var addBmBtn = $("diviewer-addBookmarkBtn");
    if (addBmBtn) {
      addBmBtn.onclick = function () {
        addBookmark(window.location.href, document.title).then(refreshBookmarks).catch(function () {});
      };
    }
    refreshTabs();
    refreshBookmarks();

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("active")) closePanel();
      if (e.ctrlKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        if (hasFn(bridge, "new_tab")) {
          asPromise(bridge.new_tab("https://limestart.cn/")).then(function () {
            refreshTabs();
          }).catch(function () {});
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (hasFn(bridge, "close_tab")) {
          asPromise(bridge.close_tab(-1)).then(function () {
            refreshTabs();
          }).catch(function () {});
        }
      }
    });
  }
})();
