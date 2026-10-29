/**
 * dsh-focus — Client half.
 *
 * Two jobs, one idea: a Session you are actually working on should look
 * different from a Session you created once, and everything that already
 * wants your attention should be reachable in one place even when the
 * sidebar has every workspace group folded.
 *
 *   sidebar.session.row.leading            the 16px cell, one click cycles
 *   sidebar.session.row.hover              words for the same state
 *   conversation.session.header.utilities  the current Session's chip
 *   sidebar.panellist + main               the cross-workspace radar page
 *
 * The radar page reads the shipped `useSessionStatus` snapshot instead of
 * inventing its own notion of "active", so whatever the sidebar's own status
 * dots mean today, the page means the same thing — labels included. Marks
 * add the one thing the shipped status cannot know: your intent.
 *
 * State is per-browser (`localStorage`) and synced across tabs over a
 * BroadcastChannel. No Host route, no tool, no model call.
 */
window.__ModuleLoader__.load({
  id: "dsh-session-focus",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const useSyncExternalStore = React.useSyncExternalStore;
    if (typeof useSyncExternalStore !== "function") {
      exports.name = "dsh-session-focus";
      exports.inject = ["slots", "sessions", "workspaces"];
      exports.apply = () => {};
      return module.exports;
    }

    const STORAGE_KEY = "dsh-focus.marks.v1";
    const CHANNEL_NAME = "dsh-focus";
    const STALE_MS = 7 * 24 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;

    const FOCUS = "focus";
    const PARKED = "parked";

    const COPY = { focus: "进行中", parked: "挂起", stale: "久未触碰" };

    /**
     * The sidebar panel row's label. It is also the handle the footer uses to
     * reach that row, so both sides must read it from here.
     */
    const RADAR_PANEL_LABEL = "焦点";

    const COLOR = {
      // The sidebar cell already trained your eye on amber for "mine", so
      // that stays. Native categories differ by shape and wording instead:
      // a pending interaction is a status dot with its own label, not a mark.
      focus: "var(--dsw-alias-state-warn-primary, #e0a04a)",
      parked: "var(--dsw-alias-state-idle-primary, #8a8f96)",
      stale: "var(--dsw-alias-label-secondary, #9aa0a6)",
      native: "var(--dsw-alias-state-success-primary, #4caf7d)",
      nativeWarn: "var(--dsw-alias-state-warn-primary, #e0a04a)",
    };

    const TONE = {
      focus: { color: COLOR.focus, label: COPY.focus },
      parked: { color: COLOR.parked, label: COPY.parked },
      native: { color: COLOR.native, label: "系统" },
    };

    // ---------------------------------------------------------------- store

    function readMarks() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch (_) {
        return {};
      }
    }

    let marks = readMarks();
    const listeners = new Set();
    let channel = null;

    try {
      if (typeof window.BroadcastChannel === "function") {
        channel = new window.BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = () => {
          marks = readMarks();
          publish();
        };
      }
    } catch (_) {
      channel = null;
    }

    function publish() {
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch (_) {
          /* one broken subscriber must not stop the rest */
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    // Identity has to stay stable across renders, so an unmarked Session
    // always resolves to the same `null` rather than a fresh object.
    function readMark(sessionId) {
      const mark = sessionId ? marks[sessionId] : undefined;
      return mark !== null && typeof mark === "object" ? mark : null;
    }

    function getMarkSnapshot() {
      return marks;
    }

    function writeMark(sessionId, state) {
      if (!sessionId) return;
      const next = Object.assign({}, marks);
      if (state === FOCUS || state === PARKED) next[sessionId] = { state, at: Date.now() };
      else delete next[sessionId];
      marks = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (_) {
        /* private mode or quota: the in-memory mark still applies this run */
      }
      publish();
      try {
        if (channel) channel.postMessage({ type: "marks", at: Date.now() });
      } catch (_) {
        /* channel closed: tabs drift until the next write */
      }
    }

    function nextState(state) {
      if (state === FOCUS) return PARKED;
      if (state === PARKED) return null;
      return FOCUS;
    }

    // ----------------------------------------------------------------- hooks

    const NOOP_HOOK = () => null;

    function useMark(sessionId) {
      useSyncExternalStore(subscribe, getMarkSnapshot, getMarkSnapshot);
      return readMark(sessionId);
    }

    function useAllMarks() {
      return useSyncExternalStore(subscribe, getMarkSnapshot, getMarkSnapshot);
    }

    function useSessionValue(props, field) {
      const sessionId = props && props.sessionId;
      const select = props && typeof props.useSessions === "function" ? props.useSessions : null;
      if (!select || !sessionId) return undefined;
      return select((snapshot) => {
        const row = snapshot && snapshot.byId ? snapshot.byId[sessionId] : null;
        return row ? row[field] : undefined;
      });
    }

    const EMPTY_SNAPSHOT = {};

    function useStore(source) {
      const subscribeTo = React.useCallback(
        (notify) =>
          source && typeof source.subscribe === "function" ? source.subscribe(notify) : () => {},
        [source],
      );
      const read = React.useCallback(
        () =>
          source && typeof source.getSnapshot === "function"
            ? source.getSnapshot()
            : EMPTY_SNAPSHOT,
        [source],
      );
      return useSyncExternalStore(subscribeTo, read, read);
    }

    /**
     * The shipped status snapshot, read verbatim. Its shape is owned by
     * ui-workspace, so `statusOf` below accepts every arrangement it could
     * reasonably have instead of assuming one.
     */
    function useStatusSnapshot(props) {
      const hook =
        props && typeof props.useSessionStatus === "function" ? props.useSessionStatus : NOOP_HOOK;
      return hook((snapshot) => snapshot);
    }

    /**
     * Native status, derived exactly the way ui-workspace's own `sessionNode`
     * derives it: the snapshot is a `Map` keyed by Session id, and the entry
     * carries `running`, `pendingInteraction.kind` and `completionUnread`.
     * `SessionSummary.running` is the fallback the shipped code also uses.
     *
     * Priority is the shipped priority: a pending interaction outranks
     * activity, and activity outranks an unread completion.
     */
    const PENDING_LABELS = {
      approval: "等待审批",
      "plan-review": "计划待审",
      question: "等待回答",
    };

    function nativeStatusOf(statuses, session) {
      if (!session) return null;
      let status = null;
      try {
        if (statuses && typeof statuses.get === "function") status = statuses.get(session.id) || null;
        else if (statuses && typeof statuses === "object") status = statuses[session.id] || null;
      } catch (_) {
        status = null;
      }

      const kind =
        status && status.pendingInteraction && typeof status.pendingInteraction.kind === "string"
          ? status.pendingInteraction.kind
          : null;
      if (kind && PENDING_LABELS[kind]) {
        return { id: "pending:" + kind, label: PENDING_LABELS[kind], rank: 0, color: COLOR.nativeWarn, ordinal: kind };
      }

      const running = status ? status.running === true : session.running === true;
      if (running) {
        return { id: "running", label: "在跑", rank: 1, color: COLOR.native, ordinal: "running" };
      }

      const completed =
        status && status.completionUnread === true
          ? true
          : status
            ? false
            : session.completed === true;
      if (completed) {
        return { id: "done", label: "已完成未查看", rank: 2, color: COLOR.native, ordinal: "done" };
      }

      return null;
    }

    // ------------------------------------------------------------------ time

    function isStale(updatedAt) {
      return typeof updatedAt === "number" && updatedAt > 0 && Date.now() - updatedAt >= STALE_MS;
    }

    function describeDays(at) {
      if (typeof at !== "number" || at <= 0) return "";
      // Calendar days, not elapsed hours: a mark made at 20:40 yesterday is
      // "昨天" this morning, even though fewer than 24 hours have passed.
      const then = new Date(at);
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
      const days = Math.round((startOfToday - startOfThen) / DAY_MS);
      if (days <= 0) return "今天";
      if (days === 1) return "昨天";
      return days + " 天前";
    }

    function relativeTime(stamp) {
      if (typeof stamp !== "number" || stamp <= 0) return "";
      const diff = Date.now() - stamp;
      if (diff < 60 * 1000) return "刚刚";
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + " 分钟前";
      if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + " 小时前";
      if (diff < 30 * DAY_MS) return Math.floor(diff / DAY_MS) + " 天前";
      return describeDays(stamp);
    }

    function tailOfPath(path) {
      if (typeof path !== "string") return "";
      const parts = path.split(/[\\/]+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : "";
    }

    /** Coerce whatever a snapshot hands over (epoch ms or ISO string) to ms. */
    function timeOf(value) {
      if (typeof value === "number" && value > 0) return value;
      if (typeof value === "string" && value) {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return 0;
    }

    /** Paths arrive with either separator and either casing on Windows. */
    function normalizePath(path) {
      if (typeof path !== "string" || !path) return "";
      return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
    }

    // ------------------------------------------------------------ components

    const CELL = {
      width: 16,
      height: 20,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      padding: 0,
      border: "none",
      background: "transparent",
      cursor: "pointer",
    };

    function dotStyle(state) {
      if (state === FOCUS) {
        // A bar, not a dot: it reads as a bookmark in a dense list and cannot
        // be confused with the shipped status dot or the remote-work dot.
        return {
          width: 3,
          height: 14,
          borderRadius: 2,
          background: COLOR.focus,
        };
      }
      if (state === PARKED) {
        return {
          width: 8,
          height: 8,
          borderRadius: "50%",
          boxSizing: "border-box",
          border: "1.5px solid " + COLOR.parked,
          background: "transparent",
        };
      }
      return { width: 6, height: 6, borderRadius: "50%", background: COLOR.stale, opacity: 0.4 };
    }

    function titleFor(state, mark, updatedAt) {
      if (state === FOCUS) {
        const when = mark ? describeDays(mark.at) : "";
        return COPY.focus + (when ? "（" + when + "标记）" : "") + " · 点击切换";
      }
      if (state === PARKED) {
        const when = mark ? describeDays(mark.at) : "";
        return COPY.parked + (when ? "（" + when + "标记）" : "") + " · 点击切换";
      }
      if (isStale(updatedAt)) {
        return COPY.stale + "：" + describeDays(updatedAt) + "没有动静 · 点击标为进行中";
      }
      return "标为进行中";
    }

    /**
     * Leading seat of one Session row. The owner mounts this cell only while
     * the row is idle, so it never competes with the shipped status dot.
     *
     * Only an explicit mark paints here: a workspace full of old Sessions
     * would otherwise light up all at once, which is the noise this plugin
     * exists to remove.
     */
    function FocusMark(props) {
      const sessionId = props && props.sessionId;
      const mark = useMark(sessionId);
      const updatedAt = useSessionValue(props, "updatedAt");
      const state = mark ? mark.state : null;
      if (!state) return null;

      const label = titleFor(state, mark, updatedAt);
      return React.createElement(
        "button",
        {
          type: "button",
          "data-dsh-focus-mark": state,
          "aria-label": label,
          title: label,
          style: CELL,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            writeMark(sessionId, nextState(state));
          },
          onMouseDown: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
        },
        React.createElement("span", { "aria-hidden": "true", style: dotStyle(state) }),
      );
    }

    /** Hover-card section: the same state, spelled out. */
    function FocusHover(props) {
      const sessionId = props && props.sessionId;
      const mark = useMark(sessionId);
      const updatedAt = useSessionValue(props, "updatedAt");
      const state = mark ? mark.state : null;
      if (!state && !isStale(updatedAt)) return null;

      const headline = state
        ? COPY[state] + (mark ? " · " + describeDays(mark.at) + "标记" : "")
        : COPY.stale + " · " + describeDays(updatedAt) + "没有动静";

      return React.createElement(
        "div",
        {
          "data-dsh-focus-hover": state || "stale",
          style: {
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            lineHeight: "16px",
            color: "var(--dsw-alias-label-secondary, #adb2b8)",
          },
        },
        React.createElement(
          "span",
          { "aria-hidden": "true", style: Object.assign({ flexShrink: 0 }, dotStyle(state)) },
        ),
        React.createElement(
          "span",
          { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          headline,
        ),
      );
    }

    /** Current Session's chip in the conversation header: the explicit way in. */
    function FocusChip(props) {
      const sessionId = props && props.sessionId;
      const mark = useMark(sessionId);
      if (!sessionId) return null;
      const state = mark ? mark.state : null;

      const label = state ? COPY[state] : "标记";
      const accent = state ? COLOR[state] : "var(--dsw-alias-label-secondary, #9aa0a6)";

      return React.createElement(
        "button",
        {
          type: "button",
          "data-dsh-focus-chip": state || "none",
          "aria-label": state ? "焦点：" + label + " · 点击切换" : "标为进行中",
          title: state ? "焦点：" + label + " · 点击切换" : "把这一轮标为进行中",
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            writeMark(sessionId, nextState(state));
          },
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 28,
            padding: "0 10px",
            borderRadius: 999,
            border: "1px solid " + (state ? accent : "var(--dsw-alias-border-l1, #3a3d41)"),
            background: state ? "color-mix(in srgb, " + accent + " 14%, transparent)" : "transparent",
            color: state ? accent : "var(--dsw-alias-label-secondary, #9aa0a6)",
            fontSize: 12,
            lineHeight: 1,
            cursor: "pointer",
            flexShrink: 0,
          },
        },
        React.createElement("span", {
          "aria-hidden": "true",
          style: Object.assign({}, dotStyle(state), { opacity: state ? 1 : 0.8 }),
        }),
        React.createElement("span", null, label),
      );
    }

    // ---------------------------------------------------------------- radar

    const services = { sessions: null, workspaces: null, ui: null };

    const RADAR_CSS = [
      ".dsh-focus-row{position:relative;transition:background .12s ease}",
      ".dsh-focus-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10))}",
      ".dsh-focus-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#e0a04a);outline-offset:-2px}",
      ".dsh-focus-row-actions{position:absolute;right:0;top:50%;transform:translateY(-50%);",
      "display:flex;align-items:center;gap:6px;padding:3px 0 3px 16px;border-radius:6px;",
      "background:var(--dsw-alias-bg-base,#fff);opacity:0;transition:opacity .12s ease}",
      ".dsh-focus-row:hover .dsh-focus-row-actions,",
      ".dsh-focus-row:focus-within .dsh-focus-row-actions{opacity:1}",
      ".dsh-focus-list>.dsh-focus-row:last-child{border-bottom:none!important}",
      "@keyframes dsh-focus-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}",
      ".dsh-focus-enter{animation:dsh-focus-in .24s cubic-bezier(.22,.9,.3,1) both}",
      ".dsh-focus-badge{white-space:nowrap}",
      ".dsh-focus-footer{transition:background .12s ease}",
      ".dsh-focus-footer:hover,.dsh-focus-footer[data-dsh-focus-footer='open']",
      "{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}",
      "@media (prefers-reduced-motion: reduce){.dsh-focus-enter{animation:none}}",
    ].join("");

    function ensureStyle() {
      try {
        if (typeof document === "undefined" || document.getElementById("dsh-focus-style")) return;
        const element = document.createElement("style");
        element.id = "dsh-focus-style";
        element.textContent = RADAR_CSS;
        document.head.appendChild(element);
      } catch (_) {
        /* no document: inline styles still carry the layout */
      }
    }

    function openSession(sessionId) {
      const ui = services.ui;
      if (!ui || typeof ui.openSession !== "function") return;
      try {
        ui.openSession(sessionId);
      } catch (_) {
        /* navigation refused: leave the page where it is */
      }
    }

    /** Sidebar panel icon; its id is also the main-panel key. */
    function FocusRadarIcon(props) {
      const allMarks = useAllMarks();
      const count = allMarks ? Object.keys(allMarks).length : 0;
      const size = (props && props.size) || 20;
      const active = Boolean(props && props.active);
      const brand = "var(--dsw-alias-brand-primary, #e0a04a)";
      const color = active || count > 0 ? brand : "currentColor";
      return React.createElement(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        React.createElement("circle", {
          cx: 12,
          cy: 12,
          r: 7.5,
          stroke: color,
          strokeWidth: 1.6,
          opacity: active || count > 0 ? 1 : 0.8,
        }),
        React.createElement("rect", {
          x: 9.5,
          y: 9.5,
          width: 5,
          height: 5,
          rx: 1.2,
          fill: color,
        }),
        React.createElement("path", {
          d: "M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3",
          stroke: color,
          strokeWidth: 1.6,
          strokeLinecap: "round",
          opacity: active ? 0.9 : 0.5,
        }),
        count > 0 ? React.createElement("circle", { cx: 19, cy: 19, r: 2.7, fill: brand }) : null,
      );
    }

    function badgeStyle(color) {
      return {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 19,
        padding: "0 7px",
        borderRadius: 5,
        border: "1px solid color-mix(in srgb, " + color + " 42%, transparent)",
        background: "color-mix(in srgb, " + color + " 13%, transparent)",
        color,
        fontSize: 11,
        lineHeight: 1,
        flexShrink: 0,
      };
    }

    /**
     * Cross-workspace aggregate. Folding a workspace group hides its Session
     * rows — and with them every mark — so this page is the one place where
     * attention survives collapse.
     */
    /**
     * One model for every surface. The page, the footer counter and the
     * popover must never disagree about how many things are on your hands.
     */
    function buildFocusModel(marks, sessionList, workspaceList, statusSnapshot) {
      const byId = sessionList && sessionList.byId ? sessionList.byId : {};
      const ids = sessionList && Array.isArray(sessionList.ids) ? sessionList.ids : [];
      // The workspace snapshot's exact shape is owned by another package and
      // has been observed as a plain array, `{ items }`, `{ workspaces }` and
      // `{ ids, byId }`. Accept all of them rather than silently resolving to
      // an empty list and losing every workspace mapping.
      const workspaceItems = (() => {
        if (!workspaceList) return [];
        if (Array.isArray(workspaceList)) return workspaceList;
        for (const field of ["items", "workspaces", "list", "entries"]) {
          if (Array.isArray(workspaceList[field])) return workspaceList[field];
        }
        if (workspaceList.byId && typeof workspaceList.byId === "object") {
          return Array.isArray(workspaceList.ids)
            ? workspaceList.ids.map((id) => workspaceList.byId[id]).filter(Boolean)
            : Object.keys(workspaceList.byId).map((id) => workspaceList.byId[id]);
        }
        return [];
      })();

      const workspaceById = {};
      const workspaceByPath = {};
      for (const workspace of workspaceItems) {
        if (!workspace || typeof workspace !== "object") continue;
        const id = workspace.id || workspace.workspaceId;
        if (id) workspaceById[id] = workspace;
        const path = workspace.path || workspace.cwd;
        if (id && path) workspaceByPath[normalizePath(path)] = id;
      }

      const rows = [];
      const push = (sessionId) => {
        const session = byId[sessionId];
        if (!session) return;
        if (session.origin === "subagent") return;
        const status = nativeStatusOf(statusSnapshot, session);
        const stored = marks ? marks[sessionId] : null;
        const mark = stored !== null && typeof stored === "object" ? stored : null;
        if (!status && !mark) return;
        if (session.blank && !mark) return;
        // `workspaceId` is not always present on a summary; the shipped
        // sidebar falls back to matching the Session's cwd against the
        // registry path, so do the same instead of dropping the row.
        const resolvedWorkspaceId =
          session.workspaceId && workspaceById[session.workspaceId]
            ? session.workspaceId
            : workspaceByPath[normalizePath(session.cwd)] || session.workspaceId || "";
        const workspace = workspaceById[resolvedWorkspaceId];
        // The row's right-hand timestamp answers "how long has this been
        // quiet", so it comes from the Session's own activity clock. The mark
        // time is a different fact and is printed separately underneath.
        const activity = timeOf(session.updatedAt) || timeOf(session.createdAt);
        const markedAt = mark ? timeOf(mark.at) : 0;
        rows.push({
          id: sessionId,
          session,
          status,
          mark,
          workspaceId: resolvedWorkspaceId || "",
          at: activity || markedAt || 0,
          markedAt,
          workspaceLabel:
            (workspace && (workspace.title || workspace.name)) ||
            tailOfPath(session.cwd) ||
            "未分组",
          title: session.blank ? "新会话" : session.displayTitle || sessionId,
        });
      };

      for (const sessionId of ids) push(sessionId);
      // A mark can outlive its list membership; keep it visible anyway.
      for (const sessionId of Object.keys(marks || {})) {
        if (!ids.includes(sessionId)) push(sessionId);
      }

      const nativeByKind = new Map();
      const focusRows = [];
      const parkedRows = [];
      for (const row of rows) {
        if (row.status) {
          const key = row.status.id;
          if (!nativeByKind.has(key)) {
            nativeByKind.set(key, {
              id: key,
              label: row.status.label,
              rank: row.status.rank,
              color: row.status.color,
              items: [],
            });
          }
          nativeByKind.get(key).items.push(row);
        } else if (row.mark && row.mark.state === FOCUS) {
          focusRows.push(row);
        } else if (row.mark && row.mark.state === PARKED) {
          parkedRows.push(row);
        }
      }

      const byRecent = (left, right) => (right.at || 0) - (left.at || 0);
      const groups = [];

      // Per-workspace tally: a folded group hides its rows, so the group
      // header is the only place a count can survive collapse.
      const byWorkspace = new Map();
      for (const row of rows) {
        const key = row.workspaceId || "";
        const prev = byWorkspace.get(key);
        byWorkspace.set(key, {
          count: (prev ? prev.count : 0) + 1,
          attention: (prev ? prev.attention : false) || Boolean(row.status),
        });
      }

      const nativeGroups = Array.from(nativeByKind.values())
        .sort((left, right) => left.rank - right.rank)
        .map((group) => ({
          id: group.id,
          label: group.label,
          tone: { color: group.color, label: group.label },
          items: group.items.slice().sort(byRecent),
        }));
      for (const group of nativeGroups) groups.push(group);

      if (focusRows.length) {
        groups.push({ id: "focus", label: COPY.focus, tone: TONE.focus, items: focusRows.sort(byRecent) });
      }
      if (parkedRows.length) {
        groups.push({ id: "parked", label: COPY.parked, tone: TONE.parked, items: parkedRows.sort(byRecent) });
      }

      // The most recent Session that finished and has not been looked at yet.
      // This is what the sidebar-foot indicator offers to jump to: it is the
      // one entry where a click has an obvious place to land.
      const latestCompleted =
        rows
          .filter((row) => row.status && row.status.id === "done")
          .sort(byRecent)[0] || null;

      return {
        entries: rows,
        groups,
        byWorkspace,
        latestCompleted,
        total: rows.length,
        attentionCount: rows.filter((row) => row.status).length,
        markedCount: rows.filter((row) => row.mark).length,
        statusAvailable: statusSnapshot !== null && statusSnapshot !== undefined,
      };
    }

    function useFocusModel(props) {
      const marks = useAllMarks();
      const sessionList = useStore(services.sessions ? services.sessions.list : null);
      const workspaceList = useStore(services.workspaces ? services.workspaces.list : null);
      const statusSnapshot = useStatusSnapshot(props);
      return buildFocusModel(marks, sessionList, workspaceList, statusSnapshot);
    }

    function FocusRadar(props) {
      ensureStyle();
      const { groups, total, attentionCount, statusAvailable } = useFocusModel(props);

      const today = (() => {
        try {
          return new Date().toLocaleDateString("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "long",
          });
        } catch (_) {
          return "";
        }
      })();

      const header = React.createElement(
        "div",
        { style: { marginBottom: 22 } },
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              fontSize: 12,
              color: "var(--dsw-alias-label-secondary, #9aa0a6)",
            },
          },
          React.createElement("span", { style: { fontWeight: 600, letterSpacing: ".02em" } }, "焦点"),
          today ? React.createElement("span", { style: { opacity: 0.7 } }, today) : null,
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              marginTop: 8,
              flexWrap: "wrap",
            },
          },
          React.createElement(
            "span",
            {
              style: {
                fontSize: 19,
                lineHeight: 1.3,
                fontWeight: 600,
                letterSpacing: "-.01em",
                color: "var(--dsw-alias-label-primary, #e9ecef)",
              },
            },
            total === 0 ? "都清空了" : "手上 " + total + " 条",
          ),
          total === 0
            ? null
            : attentionCount > 0
              ? React.createElement(
                  "span",
                  {
                    style: {
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      color: COLOR.native,
                    },
                  },
                  React.createElement("span", {
                    "aria-hidden": "true",
                    style: { width: 6, height: 6, borderRadius: "50%", background: COLOR.native },
                  }),
                  attentionCount + " 条在等你或正在跑",
                )
              : React.createElement(
                  "span",
                  {
                    style: { fontSize: 12.5, color: "var(--dsw-alias-label-secondary, #9aa0a6)" },
                  },
                  "没有需要你处理的",
                ),
        ),
      );

      const renderRow = (entry, groupTone, index) =>
        React.createElement(
          "div",
          {
            key: entry.id,
            className: "dsh-focus-row dsh-focus-enter",
            role: "button",
            tabIndex: 0,
            title: "打开这个会话",
            onClick: () => openSession(entry.id),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openSession(entry.id);
              }
            },
            style: {
              display: "flex",
              alignItems: "stretch",
              gap: 12,
              padding: "10px 8px 10px 0",
              borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.18))",
              cursor: "pointer",
              animationDelay: Math.min(index * 16, 240) + "ms",
            },
          },
          React.createElement("span", {
            "aria-hidden": "true",
            style: {
              width: 3,
              flexShrink: 0,
              margin: "2px 0",
              borderRadius: 2,
              background: groupTone.color,
            },
          }),
          React.createElement(
            "div",
            { style: { minWidth: 0, flex: 1 } },
            React.createElement(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
              React.createElement(
                "span",
                {
                  style: {
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: "var(--dsw-alias-label-primary, #e9ecef)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                entry.title,
              ),
              entry.mark
                ? React.createElement(
                    "span",
                    {
                      className: "dsh-focus-badge",
                      style: badgeStyle(TONE[entry.mark.state] ? TONE[entry.mark.state].color : COLOR.stale),
                    },
                    COPY[entry.mark.state],
                  )
                : null,
              React.createElement("span", { style: { flex: 1, minWidth: 8 } }),
              React.createElement(
                "span",
                {
                  style: {
                    fontSize: 11.5,
                    color: "var(--dsw-alias-label-secondary, #9aa0a6)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  },
                  title: "会话最后活动",
                },
                relativeTime(entry.at),
              ),
            ),
            React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                  fontSize: 11.5,
                  color: "var(--dsw-alias-label-secondary, #9aa0a6)",
                },
              },
              React.createElement(
                "span",
                {
                  style: {
                    maxWidth: 320,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                },
                entry.workspaceLabel,
              ),
              entry.mark && entry.markedAt
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement("span", { style: { opacity: 0.45 } }, "·"),
                    React.createElement("span", null, "标记于 " + describeDays(entry.markedAt)),
                  )
                : null,
            ),
          ),
          React.createElement(
            "div",
            { className: "dsh-focus-row-actions" },
            actionButton(FOCUS, entry.id, "标为进行中", "进行中"),
            actionButton(PARKED, entry.id, "标为挂起", "挂起"),
            entry.mark ? actionButton(null, entry.id, "清除标记", "清除") : null,
          ),
        );

      const sections = groups.map((group) => {
        const heading = React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 9,
              margin: "0 0 2px 1px",
              paddingBottom: 7,
            },
          },
          React.createElement("span", {
            "aria-hidden": "true",
            style: { width: 7, height: 7, borderRadius: "50%", background: group.tone.color, flexShrink: 0 },
          }),
          React.createElement(
            "span",
            {
              style: {
                fontSize: 12.5,
                fontWeight: 500,
                color: "var(--dsw-alias-label-secondary, #9aa0a6)",
              },
            },
            group.label,
          ),
          React.createElement(
            "span",
            { style: { fontSize: 11.5, color: "var(--dsw-alias-label-secondary, #9aa0a6)", opacity: 0.6 } },
            String(group.items.length),
          ),
        );
        return React.createElement(
          "section",
          { key: group.id, style: { marginBottom: 26 } },
          heading,
          React.createElement(
            "div",
            { className: "dsh-focus-list" },
            group.items.map((entry, index) => renderRow(entry, group.tone, index)),
          ),
        );
      });

      const footer =
        total > 0
          ? React.createElement(
              "div",
              {
                style: {
                  marginTop: 20,
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  color: "var(--dsw-alias-label-secondary, #9aa0a6)",
                  opacity: 0.7,
                },
              },
              "标记会一直留在这里，直到你清除它或者归档那条会话。",
            )
          : null;

      const empty =
        total > 0
          ? null
          : React.createElement(
              "div",
              {
                style: {
                  padding: "26px 22px",
                  borderRadius: 12,
                  border: "1px dashed var(--dsw-alias-border-l1, rgba(127,127,127,.3))",
                  color: "var(--dsw-alias-label-secondary, #9aa0a6)",
                  fontSize: 13,
                  lineHeight: 1.8,
                },
              },
              "这里会收拢三种东西：正在跑的会话、正在等你回复的会话、以及你亲手标记过的会话。",
              React.createElement("br"),
              "标记方式：侧边栏会话行首那 16px 的格子点一下（琥珀 = 进行中），再点一下变成空心环（挂起），第三下清除。",
            );

      return React.createElement(
        "div",
        {
          style: {
            width: "100%",
            maxWidth: 760,
            margin: "0 auto",
            padding: "30px 36px 56px",
            boxSizing: "border-box",
          },
        },
        header,
        sections,
        empty,
        footer,
        statusAvailable
          ? null
          : React.createElement(
              "div",
              {
                style: {
                  marginTop: 6,
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  color: "var(--dsw-alias-label-secondary, #9aa0a6)",
                  opacity: 0.75,
                },
              },
              "原生状态源没有接上（这个面板的 props 里没有 useSessionStatus），所以这里只有你手动标记的会话；「在跑」仍然能靠会话摘要的 running 兜底。",
            ),
      );
    }

    function actionButton(nextValue, sessionId, title, text) {
      return React.createElement(
        "button",
        {
          key: String(nextValue) + text,
          type: "button",
          title,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            writeMark(sessionId, nextValue);
          },
          style: {
            height: 24,
            padding: "0 9px",
            borderRadius: 6,
            border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.3))",
            background: "transparent",
            color: "var(--dsw-alias-label-secondary, #9aa0a6)",
            fontSize: 11.5,
            lineHeight: 1,
            cursor: "pointer",
            whiteSpace: "nowrap",
          },
        },
        text,
      );
    }

    // ------------------------------------------------------ workspace badges

    /**
     * The shipped sidebar gives a Workspace header row no plugin seat, so a
     * folded group would hide every mark inside it. That row does publish
     * `data-row-key="workspace:<id>"`, which is a stable structural hook: this
     * reads it and inserts one count chip after the group name.
     *
     * React owns that subtree and drops foreign nodes when it re-renders, so
     * the chip is re-asserted after DOM changes rather than inserted once.
     */
    let workspaceBadgeState = new Map();
    let badgeStyleElement = null;

    const cssEscape = (value) => String(value).replace(/["\\]/g, "\\$&");

    /**
     * Driven entirely by a stylesheet, never by a node inside the row.
     *
     * An injected child node is deleted by React on every commit and has to be
     * re-added, which shows up as a blink no matter how fast the retry is.
     * A `::after` rule keyed on the row's own `data-row-key` has no lifecycle
     * of its own: React can rebuild that row as often as it likes and the
     * pseudo-element simply stays.
     */
    function ensureBadgeStyle() {
      if (typeof document === "undefined" || !document.head) return null;
      if (badgeStyleElement && badgeStyleElement.isConnected) return badgeStyleElement;
      const existing = document.getElementById("dsh-focus-ws-style");
      if (existing) {
        badgeStyleElement = existing;
        return existing;
      }
      const element = document.createElement("style");
      element.id = "dsh-focus-ws-style";
      document.head.appendChild(element);
      badgeStyleElement = element;
      return element;
    }

    function syncWorkspaceBadges() {
      const element = ensureBadgeStyle();
      if (!element) return;
      // Remove chips left behind by the earlier node-based implementation:
      // React never adopted them, so nothing else will ever clean them up and
      // they would otherwise sit beside the stylesheet chip forever.
      const strays = document.querySelectorAll("[data-dsh-focus-ws]");
      for (const stray of strays) {
        try {
          stray.remove();
        } catch (_) {
          /* already detached */
        }
      }
      const rules = [];
      for (const [workspaceId, info] of workspaceBadgeState) {
        if (!info || !info.count) continue;
        const text = info.count > 99 ? "99+" : String(info.count);
        const color = info.attention ? COLOR.nativeWarn : COLOR.focus;
        const selector = '[data-row-key="workspace:' + cssEscape(workspaceId) + '"]';
        // Resting state is a dot, not a number: a folded folder only has to
        // say "something is in here", and the exact total is already on the
        // sidebar foot. Hovering trades the dot for the count, so the detail
        // sits one gesture away instead of being painted on permanently.
        rules.push(
          selector +
            '::after{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;' +
            "margin-left:7px;flex-shrink:0;background:" +
            color +
            ";opacity:.7;pointer-events:none;}",
          selector +
            ':hover::after{content:"' +
            text +
            '";display:inline;width:auto;height:auto;border-radius:0;background:none;' +
            "font-size:10px;line-height:1;font-weight:500;opacity:.9;color:" +
            color +
            ";}",
        );
      }
      const css = rules.join("");
      if (element.textContent !== css) element.textContent = css;
    }

    /** Kept as the single entry point both the model effect and boot use. */
    function scheduleBadgeSync() {
      syncWorkspaceBadges();
    }

    // ---------------------------------------------------------------- footer

    /**
     * The sidebar owner selects panels itself and exposes no programmatic
     * selector, but the row it renders for this panel carries our own label in
     * `aria-label`. Clicking that row is therefore a self-owned bridge: if the
     * label ever changes, both the registration and this lookup change with it.
     */
    function openRadarPanel() {
      if (typeof document === "undefined") return;
      const button = document.querySelector('button[aria-label="' + RADAR_PANEL_LABEL + '"]');
      if (!button) return;
      try {
        button.click();
      } catch (_) {
        /* the owner refused the navigation */
      }
    }

    /**
     * Sidebar-foot indicator. It stays put no matter how many workspace groups
     * are folded, so it carries the summary that is otherwise hidden.
     *
     * Its target is always readable from its own text: when something finished
     * and has not been looked at, the row names that Session and clicking
     * jumps there; otherwise it shows the count and clicking opens the panel.
     * A click destination that changes silently is worse than one extra click.
     */
    function FocusFooter(props) {
      const model = useFocusModel(props);
      const wide = Boolean(props && props.wide);
      const total = model.total;
      const latest = model.latestCompleted;
      const jumpable = Boolean(latest);
      const accent = jumpable
        ? COLOR.native
        : total > 0
          ? model.attentionCount > 0
            ? COLOR.nativeWarn
            : COLOR.focus
          : COLOR.parked;
      const label = jumpable
        ? latest.title
        : total > 0
          ? total + " 条在手上"
          : "焦点";

      React.useEffect(() => {
        workspaceBadgeState = model.byWorkspace || new Map();
        scheduleBadgeSync();
      }, [model.byWorkspace]);

      const onClick = jumpable
        ? () => {
            openSession(latest.id);
          }
        : openRadarPanel;

      return React.createElement(
        "button",
        {
          type: "button",
          className: "dsh-focus-footer",
          "data-dsh-focus-footer": jumpable ? "jump" : "",
          title: jumpable
            ? "「" + latest.title + "」已完成 · 点开回复"
            : total > 0
              ? label + " · 点开看全部"
              : "焦点 · 点开看说明",
          "aria-label": jumpable ? latest.title + " 已完成 · 打开" : label + " · 打开焦点面板",
          onClick,
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: wide ? "flex-start" : "center",
            gap: 8,
            height: 28,
            padding: wide ? "0 10px" : 0,
            width: wide ? "100%" : 28,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color:
              total > 0
                ? "var(--dsw-alias-label-primary, #e9ecef)"
                : "var(--dsw-alias-label-secondary, #9aa0a6)",
            fontSize: 12.5,
            lineHeight: 1,
            cursor: "pointer",
            userSelect: "none",
            flexShrink: 0,
            textAlign: "left",
          },
        },
        React.createElement("span", {
          "aria-hidden": "true",
          style: {
            width: 7,
            height: 7,
            flexShrink: 0,
            borderRadius: "50%",
            boxSizing: "border-box",
            background: total > 0 ? accent : "transparent",
            border: total > 0 ? "none" : "1.5px solid " + COLOR.parked,
          },
        }),
        wide
          ? React.createElement(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              label,
            )
          : null,
        !wide && total > 0
          ? React.createElement("span", { style: { fontSize: 11 } }, String(total))
          : null,
      );
    }

    // ---------------------------------------------------------------- apply

    /**
     * A page-level failure must not become a white screen: the radar reads
     * three different client snapshots whose shapes belong to other packages,
     * so a shape change upstream should degrade to one readable line.
     */
    class RadarBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        try {
          console.error("[dsh-focus] radar failed:", error);
        } catch (_) {
          /* console missing: nothing to report to */
        }
      }

      render() {
        if (!this.state.failed) return this.props.children;
        return React.createElement(
          "div",
          {
            style: {
              width: "100%",
              maxWidth: 760,
              padding: "30px 36px",
              boxSizing: "border-box",
              margin: "0 auto",
              color: "var(--dsw-alias-label-secondary, #9aa0a6)",
              fontSize: 13,
              lineHeight: 1.8,
            },
          },
          React.createElement(
            "div",
            {
              style: {
                fontSize: 15,
                color: "var(--dsw-alias-label-primary, #e9ecef)",
                marginBottom: 8,
              },
            },
            "焦点面板没能渲染出来",
          ),
          "侧边栏的行首标记和会话头胶囊不受影响，仍然可用。刷新页面通常能恢复；如果反复出现，说明上游某个快照的形状变了。",
        );
      }
    }

    function FocusRadarSafe(props) {
      return React.createElement(RadarBoundary, null, React.createElement(FocusRadar, props));
    }

    const SEATS = [
      { name: "sidebar.session.row.leading", id: "dsh-focus-mark", order: 20, component: FocusMark },
      { name: "sidebar.session.row.hover", id: "dsh-focus-hover", order: 20, component: FocusHover },
      {
        name: "conversation.session.header.utilities",
        id: "dsh-focus-chip",
        order: 12,
        component: FocusChip,
      },
      {
        name: "sidebar.panellist",
        id: "dsh-focus-radar",
        order: 40,
        component: FocusRadarIcon,
        label: RADAR_PANEL_LABEL,
      },
      {
        name: "main",
        id: "dsh-focus-radar",
        key: "dsh-focus-radar",
        order: 0,
        component: FocusRadarSafe,
      },
      {
        name: "sidebar.footer.action",
        id: "dsh-focus-footer",
        order: 20,
        component: FocusFooter,
      },
    ];

    function apply(ctx) {
      const slots = ctx && ctx.slots;
      if (!slots || typeof slots.inject !== "function") return;
      services.sessions = (ctx && ctx.sessions) || null;
      services.workspaces = (ctx && ctx.workspaces) || null;
      // Navigation is optional: a composition without it still lists
      // Sessions, it just cannot jump to one.
      try {
        if (typeof ctx.inject === "function") {
          ctx.inject(["uiWorkspace"], (scoped) => {
            services.ui = (scoped && scoped.uiWorkspace) || null;
          });
        }
      } catch (_) {
        services.ui = null;
      }
      for (const seat of SEATS) {
        try {
          slots.inject(seat.name, () => {
            const options = { name: seat.name, id: seat.id, order: seat.order };
            if (seat.key) options.key = seat.key;
            if (seat.label) options.label = seat.label;
            return slots.register(options, seat.component);
          });
        } catch (_) {
          /* a composition without that seat simply never declares it */
        }
      }
    }

    exports.name = "dsh-session-focus";
    exports.inject = ["slots", "sessions", "workspaces"];
    exports.apply = apply;
    exports.writeMark = writeMark;
    exports.readMark = readMark;
    return module.exports;
  },
});
