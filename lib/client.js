window.__ModuleLoader__.load({
  id: "dsh-session-status",
  factory: (require) => {
    "use strict";

    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const ReactDOM = require("react-dom");
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = "session-status";
    const STYLE_ID = "dsh-session-status/styles";

    const zh = {
      "status.standby": "待命",
      "status.standby.code": "STANDBY",
      "status.standby.hint": "会话尚未开始 · 发送消息以启动",
      "status.running": "执行中",
      "status.running.code": "EXECUTING",
      "status.running.hint": "模型正在推进本轮任务",
      "status.complete": "已完成",
      "status.complete.code": "COMPLETE",
      "status.complete.hint": "本轮已完成 · 等待下一步指令",
      "status.error": "已中断",
      "status.error.code": "INTERRUPTED",
      "status.error.hint": "本轮遇到异常 · 查看对话或重新发送",
      "meta.ready": "READY",
      "meta.ok": "OK",
      "meta.lost": "ERR",
      "action.detach": "弹出到桌面 · 可拖动到任意位置",
      "action.dock": "收回输入框上方",
      "action.show": "显示会话状态",
      "action.hide": "隐藏会话状态",
      "action.showDesktop": "显示桌面状态",
      "action.hideDesktop": "隐藏桌面状态",
      "menu.hide": "隐藏状态",
      "menu.detach": "弹出到桌面",
      "menu.dock": "收回输入框上方",
      "aria.status": "会话状态",
    };

    const en = {
      "status.standby": "Standby",
      "status.standby.code": "STANDBY",
      "status.standby.hint": "Session not started · send a message to engage",
      "status.running": "Executing",
      "status.running.code": "EXECUTING",
      "status.running.hint": "Model is advancing this turn",
      "status.complete": "Complete",
      "status.complete.code": "COMPLETE",
      "status.complete.hint": "Turn finished · ready for the next instruction",
      "status.error": "Interrupted",
      "status.error.code": "INTERRUPTED",
      "status.error.hint": "The turn hit an error · inspect the chat or retry",
      "meta.ready": "READY",
      "meta.ok": "OK",
      "meta.lost": "ERR",
      "action.detach": "Detach to desktop · drag anywhere",
      "action.dock": "Dock above the composer",
      "action.show": "Show session status",
      "action.hide": "Hide session status",
      "action.showDesktop": "Show desktop status",
      "action.hideDesktop": "Hide desktop status",
      "menu.hide": "Hide status",
      "menu.detach": "Detach to desktop",
      "menu.dock": "Dock above the composer",
      "aria.status": "Session status",
    };

    const FALLBACK = en;

    function formatElapsed(ms) {
      const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
      const seconds = safe / 1000;
      if (seconds < 60) return seconds.toFixed(1) + "s";
      const whole = Math.floor(seconds);
      return String(Math.floor(whole / 60)) + ":" + String(whole % 60).padStart(2, "0");
    }

    /** Compact telemetry waveform, compressed into the pill's 64px trace. */
    const TRACE_TICKS = [
      4, 9, 6, 15, 8, 18, 5, 12, 19, 7, 11, 4, 16, 10,
      5, 8, 17, 6, 13, 9, 15, 4, 10, 14,
    ];

    function buildWavePath(values) {
      return values
        .map((value, index) => {
          const x = ((index * 600) / (values.length - 1)).toFixed(2);
          const y = (10 - (value - 12) * 0.8).toFixed(2);
          return (index === 0 ? "M" : "L") + x + "," + y;
        })
        .join(" ");
    }

    const WAVE_PATH = buildWavePath(TRACE_TICKS);

    const POSITION_KEY = "dsh-session-status:position";
    const PANEL_KEY = "dsh-session-status:panel";
    const LEGACY_HIDDEN_KEY = "dsh-session-status:hidden";
    const HOST = "http://127.0.0.1:47901";
    const STATE_ENDPOINT = HOST + "/state";
    const PANEL_ENDPOINT = HOST + "/panel";
    const PANEL_EVENTS_ENDPOINT = HOST + "/panel/events";
    const DETACH_ENDPOINT = HOST + "/detach";
    const HIDE_ENDPOINT = HOST + "/hide";
    const DETACH_URL = HOST + "/";
    const TOGGLE_SHORTCUT =
      typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
        ? "⌘⇧H"
        : "Ctrl+Shift+H";

    function readPosition() {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(POSITION_KEY);
        if (raw === null) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.left !== "number" || typeof parsed?.top !== "number") return null;
        return { left: parsed.left, top: parsed.top };
      } catch {
        return null;
      }
    }

    function savePosition(position) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      } catch {
        // storage unavailable in hardened contexts
      }
    }

    function clearPosition() {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(POSITION_KEY);
      } catch {
        // ignore
      }
    }

    function readPanel() {
      if (typeof window === "undefined") return { mode: "docked", shown: true };
      try {
        const raw = window.localStorage.getItem(PANEL_KEY);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          if (
            parsed !== null &&
            (parsed.mode === "docked" || parsed.mode === "desktop") &&
            typeof parsed.shown === "boolean"
          ) {
            return { mode: parsed.mode, shown: parsed.shown };
          }
        }
        // Migrate the pre-0.3 single hidden flag.
        if (window.localStorage.getItem(LEGACY_HIDDEN_KEY) === "1") {
          return { mode: "docked", shown: false };
        }
      } catch {
        // storage unavailable in hardened contexts
      }
      return { mode: "docked", shown: true };
    }

    function savePanel(value) {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(PANEL_KEY, JSON.stringify(value));
        window.localStorage.removeItem(LEGACY_HIDDEN_KEY);
      } catch {
        // storage unavailable in hardened contexts
      }
    }

    let panelSnapshot = readPanel();
    const panelSubscribers = new Set();

    function getPanel() {
      return panelSnapshot;
    }

    function setPanel(next) {
      const value = {
        mode: next.mode === "desktop" ? "desktop" : "docked",
        shown: next.shown !== false,
      };
      if (value.mode === panelSnapshot.mode && value.shown === panelSnapshot.shown) {
        return panelSnapshot;
      }
      panelSnapshot = value;
      savePanel(value);
      for (const listener of panelSubscribers) listener();
      return panelSnapshot;
    }

    function subscribePanel(listener) {
      panelSubscribers.add(listener);
      return () => {
        panelSubscribers.delete(listener);
      };
    }

    function usePanelState() {
      const [panel, update] = React.useState(getPanel);
      React.useEffect(() => {
        update(getPanel());
        return subscribePanel(() => update(getPanel()));
      }, []);
      return panel;
    }

    /**
     * The host owns the panel state and mirrors it to the native pet. The
     * browser talks to /panel when that endpoint exists and falls back to the
     * legacy detach/hide calls on older hosts.
     */
    let hostPanelProtocol = 0;
    let hostPanelSource = null;
    let hostPanelRetry = null;
    let hostPanelDisposed = false;
    let fallbackWindow = null;

    function postJson(url, body, timeoutMs) {
      if (typeof fetch !== "function") return Promise.resolve(null);
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller !== null
        ? setTimeout(() => controller.abort(), timeoutMs || 12000)
        : null;
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller !== null ? controller.signal : undefined,
        keepalive: true,
      })
        .then((response) => (response.ok ? response.json().catch(() => ({})) : null))
        .catch(() => null)
        .finally(() => {
          if (timer !== null) clearTimeout(timer);
        });
    }

    function syncFallbackWindow(payload) {
      if (typeof window === "undefined" || payload.native !== false) return;
      const wanted = payload.mode === "desktop" && payload.shown === true;
      if (wanted) {
        if (fallbackWindow !== null && fallbackWindow.closed !== true) return;
        try {
          fallbackWindow = window.open(
            DETACH_URL,
            "dsh-session-status",
            "popup=yes,width=360,height=170",
          );
        } catch {
          fallbackWindow = null;
        }
        return;
      }
      if (fallbackWindow !== null && fallbackWindow.closed !== true) {
        try {
          fallbackWindow.close();
        } catch {
          // ignore
        }
      }
      fallbackWindow = null;
    }

    function applyHostPanel(payload, options) {
      if (payload === null || typeof payload !== "object") return null;
      if (typeof payload.protocol === "number" && payload.protocol < 5) return null;
      if (typeof payload.protocol === "number") hostPanelProtocol = payload.protocol;

      if (options?.bootstrap === true && payload.initialized === false) {
        const local = getPanel();
        savePanel(local);
        postJson(PANEL_ENDPOINT, {
          mode: local.mode,
          shown: local.shown,
          initialize: true,
        }).then((result) => applyHostPanel(result));
        return local;
      }

      const next = setPanel({ mode: payload.mode, shown: payload.shown });
      syncFallbackWindow(payload);
      if (options?.bootstrap === true) {
        postJson(PANEL_ENDPOINT, {
          mode: next.mode,
          shown: next.shown,
          reconcile: true,
        }).then((result) => applyHostPanel(result));
      }
      return next;
    }

    async function pushPanel(patch) {
      const current = getPanel();
      const mode =
        patch.mode === "desktop" || patch.mode === "docked" ? patch.mode : current.mode;
      const shown = typeof patch.shown === "boolean" ? patch.shown : current.shown;

      if (hostPanelProtocol >= 5) {
        const payload = await postJson(PANEL_ENDPOINT, { mode, shown });
        if (payload !== null && payload.protocol >= 5) applyHostPanel(payload);
        return payload;
      }

      // Older host: emulate the unified state with the legacy endpoints. Both
      // directions hide the native panel first, so duplicate pills are
      // impossible even before the host is reloaded.
      try {
        const response = await fetch(mode === "desktop" && shown ? DETACH_ENDPOINT : HIDE_ENDPOINT, {
          method: "POST",
          keepalive: true,
        });
        return response.ok ? { ok: true } : null;
      } catch {
        // older host not reachable
        return null;
      }
    }

    function showStatusPanel() {
      const current = getPanel();
      setPanel({ mode: current.mode, shown: true });
      pushPanel({ mode: current.mode, shown: true });
    }

    function hideStatusPanel() {
      const current = getPanel();
      setPanel({ mode: current.mode, shown: false });
      pushPanel({ mode: current.mode, shown: false });
    }

    function toggleStatusPanel() {
      if (getPanel().shown) hideStatusPanel();
      else showStatusPanel();
    }

    async function detachStatusPanel() {
      const previous = getPanel();
      const next = setPanel({ mode: "desktop", shown: true });
      const payload = await pushPanel({ mode: next.mode, shown: next.shown });
      if (payload === null || payload.ok === false) {
        setPanel(previous);
        return false;
      }
      return true;
    }

    function openHostPanelEvents() {
      if (typeof EventSource === "undefined" || hostPanelDisposed) return;
      if (hostPanelSource !== null) hostPanelSource.close();
      try {
        hostPanelSource = new EventSource(PANEL_EVENTS_ENDPOINT);
        hostPanelSource.onmessage = (event) => {
          try {
            applyHostPanel(JSON.parse(event.data));
          } catch {
            // ignore malformed frames
          }
        };
      } catch {
        hostPanelSource = null;
      }
    }

    function scheduleHostProbe() {
      if (hostPanelDisposed || hostPanelRetry !== null) return;
      hostPanelRetry = setTimeout(() => {
        hostPanelRetry = null;
        if (hostPanelDisposed || hostPanelProtocol >= 5) return;
        hostPanelProtocol = 0;
        probeHostPanel();
      }, 15000);
    }

    function probeHostPanel() {
      if (hostPanelDisposed || typeof fetch !== "function") return;
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller !== null ? setTimeout(() => controller.abort(), 1800) : null;
      fetch(PANEL_ENDPOINT, {
        cache: "no-store",
        signal: controller !== null ? controller.signal : undefined,
      })
        .then((response) => {
          if (!response.ok) throw new Error("legacy host");
          return response.json();
        })
        .then((payload) => {
          if (payload === null || typeof payload.protocol !== "number" || payload.protocol < 5) {
            throw new Error("legacy host");
          }
          hostPanelProtocol = payload.protocol;
          applyHostPanel(payload, { bootstrap: true });
          openHostPanelEvents();
        })
        .catch(() => {
          hostPanelProtocol = -1;
          scheduleHostProbe();
        })
        .finally(() => {
          if (timer !== null) clearTimeout(timer);
        });
    }

    function startHostPanelBridge() {
      hostPanelDisposed = false;
      probeHostPanel();
      return () => {
        hostPanelDisposed = true;
        if (hostPanelSource !== null) {
          hostPanelSource.close();
          hostPanelSource = null;
        }
        if (hostPanelRetry !== null) {
          clearTimeout(hostPanelRetry);
          hostPanelRetry = null;
        }
      };
    }

    function startStorageBridge() {
      if (typeof window === "undefined") return () => {};
      const onStorage = (event) => {
        if (event.key !== null && event.key !== PANEL_KEY && event.key !== LEGACY_HIDDEN_KEY) {
          return;
        }
        if (hostPanelProtocol >= 5) return;
        setPanel(readPanel());
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    }

    let liveStatusSnapshot = {
      phase: "standby",
      label: "",
      code: "",
      hint: "",
    };
    const liveStatusSubscribers = new Set();

    function getLiveStatus() {
      return liveStatusSnapshot;
    }

    function publishLiveStatus(next) {
      const previous = liveStatusSnapshot;
      if (
        previous.phase === next.phase &&
        previous.label === next.label &&
        previous.code === next.code &&
        previous.hint === next.hint
      ) {
        return;
      }
      liveStatusSnapshot = next;
      for (const listener of liveStatusSubscribers) listener();
    }

    function subscribeLiveStatus(listener) {
      liveStatusSubscribers.add(listener);
      return () => {
        liveStatusSubscribers.delete(listener);
      };
    }

    function useLiveStatus() {
      const [live, update] = React.useState(getLiveStatus);
      React.useEffect(() => {
        update(getLiveStatus());
        return subscribeLiveStatus(() => update(getLiveStatus()));
      }, []);
      return live;
    }

    function themeName() {
      return typeof document !== "undefined" && document.body?.hasAttribute("data-ds-dark-theme")
        ? "dark"
        : "light";
    }

    function clampPosition(position, width, height) {
      if (typeof window === "undefined") return position;
      const maxLeft = Math.max(8, window.innerWidth - width - 8);
      const maxTop = Math.max(8, window.innerHeight - height - 8);
      return {
        left: Math.min(Math.max(8, position.left), maxLeft),
        top: Math.min(Math.max(8, position.top), maxTop),
      };
    }

    function DetachIcon() {
      return h(
        "svg",
        { viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M9 3h4v4M13 3 7.5 8.5M6.5 4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9.5",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      );
    }

    function DockIcon() {
      return h(
        "svg",
        { viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M8 2.5v7m0 0 2.8-2.8M8 9.5 5.2 6.7M3 13.5h10",
          stroke: "currentColor",
          strokeWidth: 1.4,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      );
    }

    function ShowIcon() {
      return h(
        "svg",
        { viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M1.75 8s2.3-4.25 6.25-4.25S14.25 8 14.25 8 11.95 12.25 8 12.25 1.75 8 1.75 8Z",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
        h("circle", {
          cx: 8,
          cy: 8,
          r: 1.75,
          stroke: "currentColor",
          strokeWidth: 1.3,
        }),
      );
    }

    /**
     * One phase machine over the Session snapshot:
     *   error > running > standby (blank) > complete.
     *
     * The pill can be dragged out of the composer into a fixed floating
     * position. Its right-click opens an action menu; the detach action hands
     * the status to the native desktop pet. Docked and desktop surfaces share
     * one panel state, so the sidebar eye always toggles whichever surface is
     * currently active and only one of the two can ever be visible.
     */
    function SessionStatusDock(props) {
      const useSession = props.useSession;
      const t = typeof props.t === "function" ? props.t : (key) => FALLBACK[key] || key;

      const running = useSession((s) => s.running) === true;
      const awaitingFirstTurn = useSession((s) => s.awaitingFirstTurn) === true;
      const blank = useSession((s) => s.blank) !== false;
      const promptError = useSession((s) => s.promptError) ?? null;
      const lastAgentError = useSession((s) => s.lastAgentError) ?? null;
      const removed = useSession((s) => s.removed) === true;

      const active = running || awaitingFirstTurn;
      const failed = !active && (promptError !== null || lastAgentError !== null);
      const phase = failed ? "error" : active ? "running" : blank ? "standby" : "complete";

      const status = t("status." + phase);
      const code = t("status." + phase + ".code");
      const hint = t("status." + phase + ".hint");

      const [elapsed, setElapsed] = React.useState(0);
      const elapsedRef = React.useRef(0);
      React.useEffect(() => {
        if (!active) return undefined;
        const startedAt = Date.now();
        elapsedRef.current = 0;
        setElapsed(0);
        const timer = setInterval(() => {
          const next = Date.now() - startedAt;
          elapsedRef.current = next;
          setElapsed(next);
        }, 200);
        return () => clearInterval(timer);
      }, [active]);

      const [pulse, setPulse] = React.useState(0);
      const previousPhase = React.useRef(phase);
      React.useEffect(() => {
        if (previousPhase.current === phase) return;
        previousPhase.current = phase;
        if (phase === "complete") setPulse((value) => value + 1);
      }, [phase]);

      const [initialPosition] = React.useState(() => readPosition());
      const [floating, setFloating] = React.useState(initialPosition !== null);
      const [position, setPosition] = React.useState(initialPosition ?? { left: 24, top: 120 });
      const [dragging, setDragging] = React.useState(false);
      const panel = usePanelState();
      const [detaching, setDetaching] = React.useState(false);
      const [menu, setMenu] = React.useState(null);
      const pillRef = React.useRef(null);
      const menuRef = React.useRef(null);
      const positionRef = React.useRef(position);
      const floatingRef = React.useRef(floating);
      const liveRef = React.useRef({ phase, label: status, code, hint });
      liveRef.current = { phase, label: status, code, hint };

      React.useEffect(() => {
        publishLiveStatus({ phase, label: status, code, hint });
      }, [phase, status, code, hint]);

      const updatePosition = (next) => {
        positionRef.current = next;
        setPosition(next);
      };

      const postStatus = () => {
        const live = liveRef.current;
        fetch(STATE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phase: live.phase,
            label: live.label,
            code: live.code,
            hint: live.hint,
            elapsedMs: elapsedRef.current,
            theme: themeName(),
            updatedAt: Date.now(),
          }),
          keepalive: true,
        }).catch(() => {});
      };

      React.useEffect(() => {
        postStatus();
        if (!active) return undefined;
        const timer = setInterval(postStatus, 1000);
        return () => clearInterval(timer);
      }, [phase, active]);

      React.useEffect(() => {
        if (typeof MutationObserver === "undefined" || typeof document === "undefined") return undefined;
        const observer = new MutationObserver(postStatus);
        observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
        return () => observer.disconnect();
      }, []);

      React.useEffect(() => {
        if (!floating) return undefined;
        const clampNow = () => {
          const rect = pillRef.current?.getBoundingClientRect();
          if (!rect) return;
          const next = clampPosition(positionRef.current, rect.width, rect.height);
          if (next.left !== positionRef.current.left || next.top !== positionRef.current.top) {
            updatePosition(next);
          }
        };
        clampNow();
        window.addEventListener("resize", clampNow);
        return () => window.removeEventListener("resize", clampNow);
      }, [floating]);

      React.useEffect(() => {
        if (menu === null || typeof window === "undefined") return undefined;
        const close = (event) => {
          if (
            menuRef.current !== null &&
            typeof Node !== "undefined" &&
            event.target instanceof Node &&
            menuRef.current.contains(event.target)
          ) {
            return;
          }
          setMenu(null);
        };
        const onKeyDown = (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setMenu(null);
        };
        window.addEventListener("pointerdown", close, true);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", close);
        window.addEventListener("scroll", close, true);
        window.addEventListener("blur", close);
        menuRef.current?.querySelector("button")?.focus();
        return () => {
          window.removeEventListener("pointerdown", close, true);
          window.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("resize", close);
          window.removeEventListener("scroll", close, true);
          window.removeEventListener("blur", close);
        };
      }, [menu]);

      React.useEffect(() => {
        if (panel.mode !== "docked" || !panel.shown) setMenu(null);
      }, [panel.mode, panel.shown]);

      const previousMode = React.useRef(panel.mode);
      React.useEffect(() => {
        if (previousMode.current === panel.mode) return;
        previousMode.current = panel.mode;
        if (panel.mode !== "docked") return;
        setMenu(null);
        clearPosition();
        floatingRef.current = false;
        setFloating(false);
        setDragging(false);
      }, [panel.mode]);

      if (removed) return null;

      if (panel.mode !== "docked" || !panel.shown) return null;

      let timeValue;
      if (phase === "running") timeValue = formatElapsed(elapsed);
      else if (phase === "complete") timeValue = elapsed > 0 ? formatElapsed(elapsed) : t("meta.ok");
      else if (phase === "standby") timeValue = t("meta.ready");
      else timeValue = t("meta.lost");

      function beginDrag(event) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("[data-no-drag]") !== null) return;
        const node = pillRef.current;
        if (node === null) return;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0) return;
        event.preventDefault();
        setMenu(null);
        const start = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          moved: false,
        };
        setDragging(true);
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          // pointer capture is optional
        }
        const onMove = (moveEvent) => {
          if (moveEvent.pointerId !== start.pointerId) return;
          const dx = moveEvent.clientX - start.x;
          const dy = moveEvent.clientY - start.y;
          if (!start.moved && Math.hypot(dx, dy) < 4) return;
          if (!start.moved) {
            start.moved = true;
            if (!floatingRef.current) {
              floatingRef.current = true;
              setFloating(true);
            }
          }
          updatePosition(
            clampPosition(
              { left: start.left + dx, top: start.top + dy },
              start.width,
              start.height,
            ),
          );
          document.body.style.userSelect = "none";
          moveEvent.preventDefault();
        };
        const onUp = (upEvent) => {
          if (upEvent.pointerId !== start.pointerId) return;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
          try {
            node.releasePointerCapture(start.pointerId);
          } catch {
            // already released
          }
          document.body.style.userSelect = "";
          setDragging(false);
          if (start.moved) savePosition(positionRef.current);
        };
        window.addEventListener("pointermove", onMove, { passive: false });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }

      function hide(event) {
        if (event) event.preventDefault();
        setMenu(null);
        hideStatusPanel();
      }

      function openMenu(event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof window === "undefined") return;
        const width = 184;
        const height = floating ? 120 : 84;
        setMenu({
          left: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
          top: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
        });
      }

      function dock(event) {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
        clearPosition();
        floatingRef.current = false;
        setFloating(false);
        setDragging(false);
      }

      async function detach(event) {
        event.preventDefault();
        event.stopPropagation();
        setMenu(null);
        if (detaching) return;
        setDetaching(true);
        try {
          await detachStatusPanel();
        } finally {
          setTimeout(() => setDetaching(false), 500);
        }
      }

      const pill = h(
        "div",
        {
          ref: pillRef,
          className: "dsh-ss" + (dragging ? " is-dragging" : ""),
          "data-phase": phase,
          role: "status",
          "aria-live": "polite",
          "aria-label": t("aria.status") + ": " + status + " (" + code + ") — " + hint,
          title: status + " · " + hint + " · 右键菜单 · " + TOGGLE_SHORTCUT + " 隐藏/显示",
          onPointerDown: beginDrag,
          onContextMenu: openMenu,
        },
        h("span", { className: "dsh-ss__aurora", "aria-hidden": "true" }),
        h("span", { className: "dsh-ss__grid", "aria-hidden": "true" }),
        h("span", { className: "dsh-ss__sweep", "aria-hidden": "true" }),
        h("span", { className: "dsh-ss__scanline", "aria-hidden": "true" }),
        h(
          "span",
          { className: "dsh-ss__core", "aria-hidden": "true" },
          h("span", { className: "dsh-ss__ring" }),
          h("span", { className: "dsh-ss__orbit" }),
          h("span", { className: "dsh-ss__orbit dsh-ss__orbit--2" }),
          h("span", { className: "dsh-ss__nucleus" }),
          h(
            "svg",
            {
              className: "dsh-ss__check",
              viewBox: "0 0 24 24",
              fill: "none",
              "aria-hidden": "true",
            },
            h("path", {
              d: "M5.5 12.5 10 17l8.5-9.5",
              stroke: "currentColor",
              strokeWidth: 2.4,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }),
          ),
          h(
            "svg",
            {
              className: "dsh-ss__cross",
              viewBox: "0 0 24 24",
              fill: "none",
              "aria-hidden": "true",
            },
            h("path", {
              d: "M7 7l10 10M17 7 7 17",
              stroke: "currentColor",
              strokeWidth: 2.2,
              strokeLinecap: "round",
            }),
          ),
        ),
        h("span", { className: "dsh-ss__status" }, status),
        h(
          "span",
          { className: "dsh-ss__trace", "aria-hidden": "true" },
          h(
            "svg",
            {
              className: "dsh-ss__wave",
              viewBox: "0 0 600 20",
              preserveAspectRatio: "none",
              "aria-hidden": "true",
            },
            h("path", { className: "dsh-ss__wave-base", d: WAVE_PATH }),
            h("path", { className: "dsh-ss__wave-run", d: WAVE_PATH }),
          ),
        ),
        h("span", { className: "dsh-ss__time" }, timeValue),
        h(
          "span",
          { className: "dsh-ss__actions", "data-no-drag": "true" },
          h(
            "button",
            {
              type: "button",
              className: "dsh-ss__icon",
              title: t("action.detach"),
              "aria-label": t("action.detach"),
              disabled: detaching,
              onClick: detach,
              onPointerDown: (event) => event.stopPropagation(),
            },
            h(DetachIcon),
          ),
          floating
            ? h(
                "button",
                {
                  type: "button",
                  className: "dsh-ss__icon",
                  title: t("action.dock"),
                  "aria-label": t("action.dock"),
                  onClick: dock,
                  onPointerDown: (event) => event.stopPropagation(),
                },
                h(DockIcon),
              )
            : null,
        ),
        pulse > 0
          ? h("span", {
              key: pulse,
              className: "dsh-ss__burst",
              "aria-hidden": "true",
            })
          : null,
      );

      const menuLayer =
        menu !== null && typeof document !== "undefined"
          ? ReactDOM.createPortal(
              h(
                "div",
                {
                  ref: menuRef,
                  className: "dsh-ss-menu",
                  "data-phase": phase,
                  role: "menu",
                  style: { left: menu.left + "px", top: menu.top + "px" },
                  onContextMenu: (event) => event.preventDefault(),
                  onPointerDown: (event) => event.stopPropagation(),
                },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-ss-menu__item",
                    role: "menuitem",
                    onClick: hide,
                  },
                  t("menu.hide"),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-ss-menu__item",
                    role: "menuitem",
                    onClick: detach,
                  },
                  t("menu.detach"),
                ),
                floating
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "dsh-ss-menu__item",
                        role: "menuitem",
                        onClick: dock,
                      },
                      t("menu.dock"),
                    )
                  : null,
              ),
              document.body,
            )
          : null;

      const pillLayer =
        floating && typeof document !== "undefined"
          ? ReactDOM.createPortal(
              h(
                "div",
                {
                  className: "dsh-ss-float",
                  style: { left: position.left + "px", top: position.top + "px" },
                },
                pill,
              ),
              document.body,
            )
          : pill;

      return h(React.Fragment, null, pillLayer, menuLayer);
    }

    /**
     * Persistent visibility switch beside the account area. DSH reserves the
     * account avatar for its own single-instance launcher, so this uses the
     * public footer action slot directly above it instead of touching another
     * plugin's DOM.
     */
    function SessionStatusRestore(props) {
      const t = typeof props.t === "function" ? props.t : (key) => FALLBACK[key] || key;
      const panel = usePanelState();
      const live = useLiveStatus();

      const phase = live.phase || "standby";
      const label = live.label || t("status." + phase);
      const hint = live.hint || t("status." + phase + ".hint");
      const desktop = panel.mode === "desktop";
      const actionLabel = t(
        panel.shown
          ? desktop
            ? "action.hideDesktop"
            : "action.hide"
          : desktop
            ? "action.showDesktop"
            : "action.show",
      );
      const labelText = actionLabel + " · " + label;
      const wide = props.wide !== false;

      return h(
        "button",
        {
          type: "button",
          className: "dsh-ss-restore" + (wide ? "" : " is-rail"),
          "data-phase": phase,
          "data-mode": panel.mode,
          "data-shown": panel.shown ? "true" : "false",
          "data-tooltip": wide ? labelText + " · " + TOGGLE_SHORTCUT : undefined,
          title: wide ? undefined : labelText + " · " + TOGGLE_SHORTCUT,
          "aria-label": labelText + " · " + hint + " · " + TOGGLE_SHORTCUT,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleStatusPanel();
          },
        },
        h(ShowIcon),
        h("span", { className: "dsh-ss-restore__dot", "aria-hidden": "true" }),
      );
    }

    const CSS = `
.dsh-ss {
  --ss-accent: #57d8ff;
  --ss-accent-rgb: 87, 216, 255;
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  align-self: flex-start;
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
  min-height: 36px;
  margin: 5px 0 0;
  padding: 5px 12px 5px 7px;
  border-radius: 999px;
  border: 1px solid rgba(var(--ss-accent-rgb), 0.26);
  background:
    radial-gradient(140% 240% at 0% 0%, rgba(var(--ss-accent-rgb), 0.15), transparent 56%),
    linear-gradient(100deg, rgba(7, 12, 22, 0.94), rgba(11, 9, 26, 0.92) 55%, rgba(6, 13, 19, 0.95));
  box-shadow:
    0 12px 28px -16px rgba(0, 0, 0, 0.85),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: #ddf8ff;
  font-family: inherit;
  overflow: hidden;
  isolation: isolate;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  animation: dsh-ss-in 0.3s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}

.dsh-ss.is-dragging { cursor: grabbing; }

.dsh-ss-float {
  position: fixed;
  z-index: 2147483000;
  margin: 0;
  pointer-events: auto;
}

.dsh-ss-float .dsh-ss { margin: 0; }

.dsh-ss-menu {
  --ss-accent-rgb: 87, 216, 255;
  position: fixed;
  z-index: 2147483001;
  min-width: 168px;
  padding: 5px;
  border-radius: 12px;
  border: 1px solid rgba(var(--ss-accent-rgb), 0.28);
  background: rgba(10, 15, 28, 0.96);
  box-shadow:
    0 16px 40px -20px rgba(0, 0, 0, 0.9),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(18px);
  color: #e8fbff;
  font-family: inherit;
  animation: dsh-ss-menu-in 0.14s ease-out both;
}

.dsh-ss-menu[data-phase="running"] { --ss-accent-rgb: 138, 146, 255; }
.dsh-ss-menu[data-phase="complete"] { --ss-accent-rgb: 61, 242, 177; }
.dsh-ss-menu[data-phase="error"] { --ss-accent-rgb: 255, 104, 136; }

body:not([data-ds-dark-theme]) .dsh-ss-menu {
  --ss-accent-rgb: 11, 143, 184;
  background: rgba(250, 251, 255, 0.98);
  color: #082430;
  border-color: rgba(var(--ss-accent-rgb), 0.35);
  box-shadow:
    0 18px 36px -22px rgba(24, 32, 96, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
}

body:not([data-ds-dark-theme]) .dsh-ss-menu[data-phase="running"] { --ss-accent-rgb: 91, 95, 240; }
body:not([data-ds-dark-theme]) .dsh-ss-menu[data-phase="complete"] { --ss-accent-rgb: 13, 159, 116; }
body:not([data-ds-dark-theme]) .dsh-ss-menu[data-phase="error"] { --ss-accent-rgb: 220, 58, 96; }

.dsh-ss-menu__item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.dsh-ss-menu__item + .dsh-ss-menu__item { margin-top: 1px; }

.dsh-ss-menu__item:hover,
.dsh-ss-menu__item:focus-visible {
  background: rgba(var(--ss-accent-rgb), 0.14);
  outline: none;
}

.dsh-ss[data-phase="standby"] { --ss-accent: #57d8ff; --ss-accent-rgb: 87, 216, 255; }
.dsh-ss[data-phase="running"] { --ss-accent: #8a92ff; --ss-accent-rgb: 138, 146, 255; }
.dsh-ss[data-phase="complete"] { --ss-accent: #3df2b1; --ss-accent-rgb: 61, 242, 177; }
.dsh-ss[data-phase="error"] { --ss-accent: #ff6888; --ss-accent-rgb: 255, 104, 136; }

.dsh-ss[data-phase="error"] {
  animation:
    dsh-ss-in 0.3s cubic-bezier(0.2, 0.9, 0.25, 1) both,
    dsh-ss-shake 0.42s 0.1s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

.dsh-ss[data-phase="complete"] {
  animation:
    dsh-ss-in 0.3s cubic-bezier(0.2, 0.9, 0.25, 1) both,
    dsh-ss-settle 0.6s cubic-bezier(0.2, 0.9, 0.25, 1) both;
}

.dsh-ss__aurora {
  position: absolute;
  inset: -90% -20%;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(38% 58% at 18% 50%, rgba(var(--ss-accent-rgb), 0.26), transparent 70%),
    radial-gradient(34% 54% at 82% 42%, rgba(128, 92, 255, 0.18), transparent 70%);
  filter: blur(14px);
  opacity: 0.8;
  animation: dsh-ss-drift 8s ease-in-out infinite alternate;
}

.dsh-ss__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.1;
  background-image: radial-gradient(
    rgba(var(--ss-accent-rgb), 0.85) 0.6px,
    transparent 0.8px
  );
  background-size: 9px 9px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}

.dsh-ss__sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 34%;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(var(--ss-accent-rgb), 0.16),
    rgba(var(--ss-accent-rgb), 0.3),
    transparent
  );
}

.dsh-ss[data-phase="running"] .dsh-ss__sweep {
  opacity: 1;
  animation: dsh-ss-sweep 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.dsh-ss__scanline {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -2%;
  width: 1px;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(var(--ss-accent-rgb), 0.7),
    transparent
  );
}

.dsh-ss[data-phase="running"] .dsh-ss__scanline {
  opacity: 0.55;
  animation: dsh-ss-scanline 3.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.dsh-ss__core {
  position: relative;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  color: var(--ss-accent);
  filter: drop-shadow(0 0 7px rgba(var(--ss-accent-rgb), 0.45));
}

.dsh-ss__ring {
  position: absolute;
  inset: 0;
  border: 1px solid currentColor;
  border-radius: 50%;
  opacity: 0.26;
}

.dsh-ss__orbit {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  opacity: 0;
  background: conic-gradient(
    from 0deg,
    transparent 0deg,
    transparent 288deg,
    rgba(var(--ss-accent-rgb), 0.35) 330deg,
    var(--ss-accent) 356deg,
    transparent 360deg
  );
  -webkit-mask: radial-gradient(
    farthest-side,
    transparent calc(100% - 2.2px),
    #000 calc(100% - 1.4px)
  );
  mask: radial-gradient(
    farthest-side,
    transparent calc(100% - 2.2px),
    #000 calc(100% - 1.4px)
  );
}

.dsh-ss__orbit--2 {
  inset: 4px;
}

.dsh-ss__nucleus {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow:
    0 0 8px currentColor,
    0 0 18px currentColor;
  animation: dsh-ss-pulse 2.4s ease-in-out infinite;
}

.dsh-ss[data-phase="running"] .dsh-ss__orbit {
  opacity: 0.95;
  animation: dsh-ss-spin 2.4s linear infinite;
}

.dsh-ss[data-phase="running"] .dsh-ss__orbit--2 {
  opacity: 0.55;
  animation: dsh-ss-spin 1.5s linear infinite reverse;
}

.dsh-ss[data-phase="running"] .dsh-ss__nucleus {
  animation-duration: 1.1s;
}

.dsh-ss[data-phase="complete"] .dsh-ss__ring {
  opacity: 0.55;
}

.dsh-ss[data-phase="complete"] .dsh-ss__orbit,
.dsh-ss[data-phase="complete"] .dsh-ss__nucleus,
.dsh-ss[data-phase="error"] .dsh-ss__orbit,
.dsh-ss[data-phase="error"] .dsh-ss__nucleus {
  opacity: 0;
}

.dsh-ss[data-phase="error"] .dsh-ss__ring {
  border-style: dashed;
  opacity: 0.45;
}

.dsh-ss__check,
.dsh-ss__cross {
  position: absolute;
  inset: 4px;
  width: 14px;
  height: 14px;
  opacity: 0;
  transform: scale(0.6);
  transition:
    opacity 0.2s ease,
    transform 0.28s cubic-bezier(0.2, 0.9, 0.25, 1);
}

.dsh-ss[data-phase="complete"] .dsh-ss__check,
.dsh-ss[data-phase="error"] .dsh-ss__cross {
  opacity: 1;
  transform: none;
}

.dsh-ss__check path {
  stroke-dasharray: 26;
  stroke-dashoffset: 26;
}

.dsh-ss[data-phase="complete"] .dsh-ss__check path {
  animation: dsh-ss-draw 0.55s 0.08s cubic-bezier(0.6, 0, 0.2, 1) forwards;
}

.dsh-ss__status {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #f3fdff;
  text-shadow: 0 0 16px rgba(var(--ss-accent-rgb), 0.5);
  white-space: nowrap;
}

.dsh-ss__trace {
  position: relative;
  display: flex;
  align-items: center;
  width: 64px;
  flex: 0 0 64px;
  height: 16px;
  overflow: hidden;
  opacity: 0.82;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}

.dsh-ss__wave {
  display: block;
  width: 100%;
  height: 16px;
  overflow: visible;
}

.dsh-ss__wave-base,
.dsh-ss__wave-run {
  fill: none;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.dsh-ss__wave-base {
  stroke: var(--ss-accent);
  stroke-width: 1.1;
  opacity: 0.46;
}

.dsh-ss__wave-run {
  stroke: var(--ss-accent);
  stroke-width: 1.8;
  opacity: 0;
  stroke-dasharray: 80 520;
  stroke-dashoffset: 600;
  filter: drop-shadow(0 0 4px rgba(var(--ss-accent-rgb), 0.95));
}

.dsh-ss[data-phase="running"] .dsh-ss__wave-run {
  opacity: 0.95;
  animation: dsh-ss-wave 3.2s linear infinite;
}

.dsh-ss[data-phase="complete"] .dsh-ss__wave-base {
  opacity: 0.58;
}

.dsh-ss[data-phase="error"] .dsh-ss__wave-base {
  opacity: 0.42;
  stroke-dasharray: 3 2;
}

.dsh-ss__time {
  min-width: 44px;
  padding-left: 8px;
  border-left: 1px solid rgba(var(--ss-accent-rgb), 0.18);
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--ss-accent);
  text-shadow: 0 0 10px rgba(var(--ss-accent-rgb), 0.5);
  white-space: nowrap;
}

.dsh-ss__burst {
  position: absolute;
  inset: -1px;
  pointer-events: none;
  border: 1px solid rgba(var(--ss-accent-rgb), 0.85);
  border-radius: 999px;
  box-shadow:
    inset 0 0 24px rgba(var(--ss-accent-rgb), 0.22),
    0 0 24px rgba(var(--ss-accent-rgb), 0.2);
  animation: dsh-ss-burst 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.dsh-ss__actions {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: 1px;
  padding-left: 4px;
  border-left: 1px solid rgba(var(--ss-accent-rgb), 0.16);
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.dsh-ss:hover .dsh-ss__actions,
.dsh-ss:focus-within .dsh-ss__actions { opacity: 1; }

.dsh-ss__icon {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.9;
}

.dsh-ss__icon:hover {
  color: var(--ss-accent);
  background: rgba(var(--ss-accent-rgb), 0.12);
}

.dsh-ss__icon:disabled { opacity: 0.35; cursor: default; }
.dsh-ss__icon svg { width: 12px; height: 12px; }

.dsh-ss-restore {
  --ss-accent: #57d8ff;
  --ss-accent-rgb: 87, 216, 255;
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: none;
  align-self: center;
  width: 28px;
  height: 28px;
  margin-left: auto;
  padding: 0;
  box-sizing: border-box;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #8b93a4);
  font: inherit;
  cursor: pointer;
  opacity: 0.78;
  appearance: none;
  -webkit-appearance: none;
  transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
  animation: dsh-ss-restore-in 0.18s cubic-bezier(0.2, 0.9, 0.3, 1) both;
}

.dsh-ss-restore[data-phase="standby"] { --ss-accent: #57d8ff; --ss-accent-rgb: 87, 216, 255; }
.dsh-ss-restore[data-phase="running"] { --ss-accent: #8a92ff; --ss-accent-rgb: 138, 146, 255; }
.dsh-ss-restore[data-phase="complete"] { --ss-accent: #3df2b1; --ss-accent-rgb: 61, 242, 177; }
.dsh-ss-restore[data-phase="error"] { --ss-accent: #ff6888; --ss-accent-rgb: 255, 104, 136; }

.dsh-ss-restore[data-shown="false"] {
  color: var(--dsw-alias-label-secondary, #c5cbd5);
  opacity: 1;
}

/* The desktop surface gets a square indicator; the phase color is unchanged. */
.dsh-ss-restore[data-mode="desktop"] .dsh-ss-restore__dot {
  border-radius: 2px;
}

.dsh-ss-restore svg {
  display: block;
  width: 16px;
  height: 16px;
}

.dsh-ss-restore__dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ss-accent);
  box-shadow:
    0 0 0 2px var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #f5f7fb)),
    0 0 8px rgba(var(--ss-accent-rgb), 0.65);
}

.dsh-ss-restore[data-phase="running"] .dsh-ss-restore__dot {
  animation: dsh-ss-pulse 1.8s ease-in-out infinite;
}

.dsh-ss-restore::after {
  content: attr(data-tooltip);
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 20;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.22));
  border-radius: 7px;
  background: var(--dsw-specific-menu, rgba(16, 19, 28, 0.96));
  box-shadow: 0 10px 26px -16px rgba(0, 0, 0, 0.7);
  color: var(--dsw-alias-label-primary, #f5f7fa);
  font-size: 11px;
  font-weight: 400;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transform: translateY(2px);
  transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s;
}

.dsh-ss-restore:hover,
.dsh-ss-restore:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  color: var(--dsw-alias-label-primary, currentColor);
  opacity: 1;
}

.dsh-ss-restore:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #57d8ff));
  outline-offset: -2px;
}

.dsh-ss-restore:focus:not(:focus-visible) {
  outline: none;
}

body:not([data-ds-dark-theme]) .dsh-ss-restore[data-phase="standby"] { --ss-accent: #0b8fb8; --ss-accent-rgb: 11, 143, 184; }
body:not([data-ds-dark-theme]) .dsh-ss-restore[data-phase="running"] { --ss-accent: #5b5ff0; --ss-accent-rgb: 91, 95, 240; }
body:not([data-ds-dark-theme]) .dsh-ss-restore[data-phase="complete"] { --ss-accent: #0d9f74; --ss-accent-rgb: 13, 159, 116; }
body:not([data-ds-dark-theme]) .dsh-ss-restore[data-phase="error"] { --ss-accent: #dc3a60; --ss-accent-rgb: 220, 58, 96; }

.dsh-ss-restore:hover::after,
.dsh-ss-restore:focus-visible::after {
  opacity: 1;
  visibility: visible;
  transform: none;
}

.dsh-ss-restore.is-rail {
  width: 36px;
  height: 36px;
  margin-left: 0;
  border-radius: 50%;
}

.dsh-ss-restore.is-rail::after {
  display: none;
}

/* Light theme keeps the HUD, with readable ink and deeper accents. */
body:not([data-ds-dark-theme]) .dsh-ss[data-phase="standby"] { --ss-accent: #0b8fb8; --ss-accent-rgb: 11, 143, 184; }
body:not([data-ds-dark-theme]) .dsh-ss[data-phase="running"] { --ss-accent: #5b5ff0; --ss-accent-rgb: 91, 95, 240; }
body:not([data-ds-dark-theme]) .dsh-ss[data-phase="complete"] { --ss-accent: #0d9f74; --ss-accent-rgb: 13, 159, 116; }
body:not([data-ds-dark-theme]) .dsh-ss[data-phase="error"] { --ss-accent: #dc3a60; --ss-accent-rgb: 220, 58, 96; }

body:not([data-ds-dark-theme]) .dsh-ss {
  background:
    radial-gradient(140% 240% at 0% 0%, rgba(var(--ss-accent-rgb), 0.16), transparent 56%),
    linear-gradient(100deg, rgba(250, 250, 255, 0.97), rgba(243, 247, 255, 0.93) 55%, rgba(240, 250, 252, 0.97));
  color: #082430;
  border-color: rgba(var(--ss-accent-rgb), 0.4);
  box-shadow:
    0 14px 30px -22px rgba(24, 32, 96, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 0 26px rgba(var(--ss-accent-rgb), 0.05);
}

body:not([data-ds-dark-theme]) .dsh-ss__aurora { opacity: 0.5; }
body:not([data-ds-dark-theme]) .dsh-ss__grid { opacity: 0.07; }
body:not([data-ds-dark-theme]) .dsh-ss[data-phase="running"] .dsh-ss__scanline { opacity: 0.3; }
body:not([data-ds-dark-theme]) .dsh-ss__status { color: #062733; text-shadow: none; }
body:not([data-ds-dark-theme]) .dsh-ss__time { text-shadow: none; }
body:not([data-ds-dark-theme]) .dsh-ss__wave-base { opacity: 0.6; }

@media (max-width: 520px) {
  .dsh-ss__trace { display: none; }
  .dsh-ss__time { border-left: 0; padding-left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-ss,
  .dsh-ss *,
  .dsh-ss-restore,
  .dsh-ss-restore *,
  .dsh-ss-menu,
  .dsh-ss-menu * {
    animation: none !important;
    transition: none !important;
  }
}

@keyframes dsh-ss-menu-in {
  from { opacity: 0; transform: translateY(-3px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

@keyframes dsh-ss-restore-in {
  from { opacity: 0; transform: scale(0.86); }
  to { opacity: 1; transform: none; }
}

@keyframes dsh-ss-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

@keyframes dsh-ss-settle {
  0% { box-shadow: 0 12px 28px -16px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 0 rgba(var(--ss-accent-rgb), 0.5); }
  45% { box-shadow: 0 12px 28px -16px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 5px rgba(var(--ss-accent-rgb), 0.16), 0 0 28px rgba(var(--ss-accent-rgb), 0.3); }
  100% { box-shadow: 0 12px 28px -16px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 0 rgba(var(--ss-accent-rgb), 0); }
}

@keyframes dsh-ss-shake {
  0%, 100% { transform: translateX(0); }
  18% { transform: translateX(-3px); }
  36% { transform: translateX(3px); }
  54% { transform: translateX(-2px); }
  72% { transform: translateX(2px); }
  90% { transform: translateX(-1px); }
}

@keyframes dsh-ss-drift {
  from { transform: translate3d(-3%, 1%, 0) scale(1); }
  to { transform: translate3d(4%, -2%, 0) scale(1.08); }
}

@keyframes dsh-ss-sweep {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(380%); }
}

@keyframes dsh-ss-scanline {
  0% { left: -2%; }
  100% { left: 102%; }
}

@keyframes dsh-ss-spin {
  to { transform: rotate(360deg); }
}

@keyframes dsh-ss-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.82); }
  50% { opacity: 1; transform: scale(1.08); }
}

@keyframes dsh-ss-wave {
  0% { stroke-dashoffset: 600; }
  100% { stroke-dashoffset: 0; }
}

@keyframes dsh-ss-burst {
  0% { opacity: 0.85; transform: scale(0.985); }
  100% { opacity: 0; transform: scale(1.035); }
}

@keyframes dsh-ss-draw {
  to { stroke-dashoffset: 0; }
}
`;

    function installStyles() {
      if (typeof document === "undefined") return () => {};
      const previous = document.getElementById(STYLE_ID);
      if (previous !== null) previous.remove();
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        style.remove();
      };
    }

    /**
     * Client plugin body: styles, copy, the composer pill, and the sidebar
     * recovery control that lives directly above the account launcher.
     */
    function apply(ctx) {
      ctx.effect(() => installStyles(), "dsh-session-status: styles");
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        "dsh-session-status: dictionaries",
      );
      ctx.effect(
        () =>
          ctx.slots.inject("conversation.input.dock", () =>
            ctx.slots.register(
              {
                name: "conversation.input.dock",
                id: "session-status",
                order: 30,
                locale: NS,
              },
              SessionStatusDock,
            ),
          ),
        "dsh-session-status: input dock",
      );
      ctx.effect(
        () =>
          ctx.slots.inject("sidebar.footer.action", () =>
            ctx.slots.register(
              {
                name: "sidebar.footer.action",
                id: "session-status-restore",
                order: 30,
                locale: NS,
              },
              SessionStatusRestore,
            ),
          ),
        "dsh-session-status: sidebar restore",
      );
      ctx.effect(
        () => startHostPanelBridge(),
        "dsh-session-status: panel bridge",
      );
      ctx.effect(
        () => startStorageBridge(),
        "dsh-session-status: panel storage",
      );
      ctx.effect(() => {
        if (typeof window === "undefined") return undefined;
        const onKeyDown = (event) => {
          if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
          if (typeof event.key !== "string" || event.key.toLowerCase() !== "h") return;
          event.preventDefault();
          toggleStatusPanel();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, "dsh-session-status: visibility shortcut");
    }

    exports.name = "dsh-session-status";
    exports.inject = ["slots", "locale"];
    exports.apply = apply;
    exports.SessionStatusDock = SessionStatusDock;
    exports.SessionStatusRestore = SessionStatusRestore;

    return module.exports;
  },
});
