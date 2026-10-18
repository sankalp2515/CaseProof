import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutGrid,
  Briefcase,
  ArrowRight,
  ShieldCheck,
  FileText,
  Menu,
  Search,
  ChevronRight,
  Landmark,
  Bell,
  Clock,
  Activity,
  Check,
  X,
  Compass,
} from "lucide-react";
import {
  useSession,
  useResource,
  useDisplayClock,
} from "./state/resources.jsx";
import { apiRequest, loadCaseView } from "./api/client.js";
import { useRoute, go } from "./router.js";
import {
  Card,
  CardH,
  LogoMark,
  Badge,
  ErrorBanner,
  Loading,
  Empty,
  Status,
  Metric,
} from "./components/live.jsx";
import { formatMinor, time, remaining, label } from "./models/caseView.js";
import Queue from "./pages/LiveQueue.jsx";
import GoldenHourAlert from "./components/GoldenHourAlert.jsx";
import CasePages from "./pages/CasePages.jsx";
import { auth } from "./api/auth.js";
import { notificationLedger, visibleNotifications } from "./models/queue.js";
import StaffSignIn from "./components/StaffSignIn.jsx";
import Victim from "./pages/victim/Victim.jsx";
import { TourButton } from "./tour/Tour.jsx";
import { tour } from "./tour/store.js";

export default function App() {
  const route = useRoute(),
    session = useSession();
  const [authTick, setAuthTick] = useState(0);
  const ready = useCallback(() => setAuthTick((x) => x + 1), []);
  useEffect(() => {
    const id = setInterval(() => setAuthTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (session.error)
    return (
      <div className="page">
        <ErrorBanner error={session.error} onRetry={() => location.reload()} />
      </div>
    );
  if (!session.config) return <Loading />;
  if (route.startsWith("/victim/")) return <Victim route={route} />;
  if (route === "/entry") return <Entry />;
  if (!auth.ready()) return <StaffSignIn onReady={ready} />;
  return <Staff route={route} />;
}
function Entry() {
  return (
    <div className="entry-page">
      <div className="entry-brand">
        <span className="logo-mark">
          <LogoMark />
        </span>
        <b>CaseProof</b>
        <Badge tone="warn">Synthetic bank demonstration</Badge>
      </div>
      <div className="entry-body">
        <div className="eyebrow">Cedar Demo Bank · payment scam response</div>
        <h1>
          From a difficult moment
          <br />
          to a supported next step.
        </h1>
        <p>
          Report what happened. Understand the evidence. Give the fraud desk a
          clear, accountable path forward.
        </p>
        <div className="entry-tour">
          <button
            className="btn primary lg tour-launch"
            onClick={() => tour.start(0)}
          >
            <Compass size={16} /> Take the guided tour
          </button>
          <span className="muted">
            12 highlights · one golden-hour scam, from report to handoff
          </span>
        </div>
        <div className="entry-options">
          <button className="entry-option" onClick={() => go("/victim/start")}>
            <span className="entry-icon">
              <ShieldCheck />
            </span>
            <h2>Report a payment scam</h2>
            <p>
              Select your payments, share your account of what happened, and
              return for updates.
            </p>
            <span className="row gap8">
              Open reporting portal <ArrowRight size={15} />
            </span>
          </button>
          <button className="entry-option" onClick={() => go("/staff/queue")}>
            <span className="entry-icon violet">
              <Briefcase />
            </span>
            <h2>Fraud desk workspace</h2>
            <p>
              Inspect cited evidence, review the money trail and approve a
              supported handoff.
            </p>
            <span className="row gap8">
              Enter staff demo <ArrowRight size={15} />
            </span>
          </button>
        </div>
        <div className="entry-foot">
          <Landmark size={15} /> Fictional accounts · source-linked assessment ·
          simulated report destinations
        </div>
      </div>
    </div>
  );
}
function Staff({ route }) {
  const { persona, setPersona, config } = useSession();
  const [menu, setMenu] = useState(false);
  const [queueScope, setQueueScope] = useState("active");
  const resourceScope = route === "/staff/cases" ? "all" : queueScope;
  const queue = useResource(
    "staff-queue:" + persona + ":" + resourceScope,
    (signal) =>
      apiRequest("/v1/workspace?scope=" + resourceScope, { persona, signal }),
    5000,
  );
  // The active practice queue drives notifications even on the historical Cases screen.
  const activeNotifications = useResource(
    "notification-queue:" + persona,
    (signal) => apiRequest("/v1/workspace?scope=active", { persona, signal }),
    resourceScope === "active" ? false : 5000,
  );
  const notificationQueue =
    resourceScope === "active" ? queue : activeNotifications;
  const [ledger, setLedger] = useState(() => {
    try {
      return (
        JSON.parse(sessionStorage.getItem("cp-notifications-v1")) || {
          initialized: false,
          known: [],
          events: [],
        }
      );
    } catch {
      return { initialized: false, known: [], events: [] };
    }
  });
  const [showAlerts, setShowAlerts] = useState(false);
  const notificationRows = notificationQueue.data?.cases || [];
  const alerts = visibleNotifications(ledger, notificationRows);
  const setAlerts = (update) =>
    setLedger((old) => {
      const changed = update(visibleNotifications(old, notificationRows));
      const read = new Map(changed.map((event) => [event.eventId, event.seen]));
      return {
        ...old,
        events: old.events.map((event) =>
          read.has(event.eventId)
            ? { ...event, seen: read.get(event.eventId) }
            : event,
        ),
      };
    });
  useEffect(() => {
    if (!notificationQueue.data) return;
    setLedger((old) =>
      notificationLedger(old, notificationQueue.data.cases || []),
    );
  }, [notificationQueue.data]);
  useEffect(() => {
    try {
      sessionStorage.setItem("cp-notifications-v1", JSON.stringify(ledger));
    } catch {
      /* read state still survives identity changes in memory */
    }
  }, [ledger]);
  const parts = route.split("/"),
    caseId = parts[2] === "cases" ? parts[3] : null,
    tab = (parts[4] || "overview").split("?")[0];
  useEffect(() => {
    if (caseId)
      setAlerts((old) =>
        old.map((a) => (a.case_id === caseId ? { ...a, seen: true } : a)),
      );
  }, [caseId, notificationQueue.data]);
  return (
    <div className={"app studio-app " + (menu ? "menu-open" : "")}>
      <aside className="side">
        <button
          className="logo brand-button"
          onClick={() => location.assign("/")}
        >
          <span className="logo-mark">
            <LogoMark />
          </span>
          <div>
            <b>CaseProof</b>
            <small>Golden-hour evidence intake</small>
          </div>
        </button>
        <div className="unit">
          <span className="bank-letter">CDR</span>
          <div>
            <b>{config.institution.name}</b>
            <small>Fraud Operations</small>
          </div>
        </div>
        <div className="nav-h">Investigate</div>
        {[
          ["queue", "Queue", LayoutGrid],
          ["cases", "Cases", Briefcase],
          ["deliveries", "Deliveries", FileText],
        ].map(([id, name, Icon]) => (
          <button
            key={id}
            className={"nav " + (route.includes(id) ? "on" : "")}
            onClick={() => {
              go("/staff/" + id);
              setMenu(false);
            }}
          >
            <Icon size={16} />
            {name}
          </button>
        ))}
        <div className="shift">
          <div className="row gap8">
            <ShieldCheck size={16} />
            <b>Synthetic staff demo</b>
          </div>
          <p className="muted">
            Evidence-backed decisions. A report acknowledgement is not a hold or
            refund.
          </p>
          <button className="btn sm" onClick={() => go("/victim/start")}>
            Victim portal <ArrowRight size={12} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <button
            className="icon-btn mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMenu((v) => !v)}
          >
            <Menu size={17} />
          </button>
          <div className="muted row gap8 grow">
            <ShieldCheck size={15} />
            <span>Fraud response workspace</span>
          </div>
          <span className="demo-chip">Synthetic data · sandbox</span>
          <TourButton />
          <div className="notification-wrap" data-tour="notifications">
            <button
              className="icon-btn notification-bell"
              aria-label={`Notifications, ${alerts.filter((a) => !a.seen).length} unread`}
              aria-expanded={showAlerts}
              onClick={() => setShowAlerts((x) => !x)}
            >
              <Bell size={18} />
              {alerts.some((a) => !a.seen) && (
                <span className="notification-count">
                  {alerts.filter((a) => !a.seen).length}
                </span>
              )}
            </button>
            {showAlerts && (
              <div className="notification-panel">
                <div className="row">
                  <b>Workspace notifications</b>
                  <button
                    className="btn sm ghost right"
                    onClick={() =>
                      setAlerts((old) => old.map((a) => ({ ...a, seen: true })))
                    }
                  >
                    Mark read
                  </button>
                </div>
                {!alerts.length && (
                  <Empty>
                    No new changes since this workspace opened. The queue checks
                    every five seconds.
                  </Empty>
                )}
                {alerts.map((a) => (
                  <button
                    className="notification-item"
                    key={a.eventId}
                    onClick={() => {
                      go(`/staff/cases/${a.case_id}/overview`);
                      setShowAlerts(false);
                      setAlerts((old) =>
                        old.map((x) =>
                          x.eventId === a.eventId ? { ...x, seen: true } : x,
                        ),
                      );
                    }}
                  >
                    <b>
                      {a.type === "priority"
                        ? "Golden-hour case awaiting response"
                        : a.type === "arrived"
                          ? "New complaint received"
                          : "Case status changed"}
                    </b>
                    <span className="mono">{a.case_id}</span>
                    <small>{label(a.status)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="staff-identity">
            {auth.personas ? (
              <label className="persona-label" data-tour="persona">
                Demo identity
                <select
                  aria-label="Staff persona"
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                >
                  <option value="analyst">Analyst demo</option>
                  <option value="reviewer">Reviewer demo</option>
                </select>
              </label>
            ) : (
              <button
                className="btn sm"
                onClick={() => {
                  auth.clear();
                  location.reload();
                }}
              >
                Sign out
              </button>
            )}
            <span className="avatar">
              {!auth.personas ? "ST" : persona === "reviewer" ? "RV" : "AN"}
            </span>
          </div>
        </header>
        <details className="role-help">
          <summary>
            Analyst investigates · Reviewer approves — role guide
          </summary>
          <p>
            <b>Analyst:</b> investigates the complaint, checks sources and the
            trail, asks for missing information and prepares the proposed
            handoff. <b>Reviewer:</b> independently checks the current revision
            and approves or rejects it with a reason. An analyst cannot approve
            their own handoff. In this practice, use Demo identity to try each
            role; in a bank they are separately authorised staff.
          </p>
          <p>
            Both roles can read Overview, Evidence, Money Trail, Requests,
            Review &amp; decision, Delivery and Audit so an independent reviewer
            can trace the proposed action to its sources. Analyst actions
            include clarification requests, corrections and follow-up ownership.
            Reviewer actions include urgent-referral approval, handoff approval
            and sending the approved packet. The server enforces these
            permissions.
          </p>
        </details>
        {(() => {
          const item = alerts.find(
            (a) =>
              !a.seen &&
              ["arrived", "priority"].includes(a.type) &&
              a.clock?.golden_hour_remaining > 0,
          );
          return item ? (
            <GoldenHourAlert
              item={item}
              onLater={() =>
                setAlerts((old) =>
                  old.map((a) =>
                    a.eventId === item.eventId ? { ...a, seen: true } : a,
                  ),
                )
              }
              onOpen={() => {
                go(`/staff/cases/${item.case_id}/overview`);
                setAlerts((old) =>
                  old.map((a) =>
                    a.eventId === item.eventId ? { ...a, seen: true } : a,
                  ),
                );
              }}
            />
          ) : null;
        })()}
        <main className="content" id="content">
          {alerts.some(
            (a) => !a.seen && ["arrived", "priority"].includes(a.type),
          ) && (
            <div className="arrival-notice" role="status">
              <Bell size={16} />
              <b>
                {alerts.some((a) => !a.seen && a.type === "priority")
                  ? "Golden-hour case awaiting response"
                  : "New complaint received"}
              </b>
              <span>Review the current bank-timed response priority.</span>
              <button
                className="btn sm right"
                onClick={() => {
                  go("/staff/queue");
                  setAlerts((old) => old.map((a) => ({ ...a, seen: true })));
                }}
              >
                Review queue
              </button>
            </div>
          )}
          {caseId ? (
            <Case key={caseId + persona} caseId={caseId} tab={tab} />
          ) : (
            <Queue
              key={persona}
              mode={parts[2]}
              activeResource={queue}
              scope={queueScope}
              setScope={setQueueScope}
            />
          )}
        </main>
      </div>
    </div>
  );
}
function Case({ caseId, tab }) {
  const { persona } = useSession();
  const resource = useResource(
    caseId + ":" + persona,
    (s) => loadCaseView(caseId, { persona, signal: s }),
    "case",
  );
  const view = resource.data;
  const countdown = useDisplayClock(view?.workflow.clock);
  const tabs = [
    ["overview", "Overview"],
    ["evidence", "Evidence"],
    ["trail", "Money Trail"],
    ["requests", "Requests"],
    ["review", "Review & decision"],
    ["delivery", "Delivery & follow-up"],
    ["audit", "Audit"],
  ];
  return (
    <>
      <ErrorBanner error={resource.error} onRetry={resource.reload} />
      {!view ? (
        resource.loading ? (
          <Loading />
        ) : (
          <Empty>
            Case unavailable.{" "}
            <button className="btn" onClick={() => go("/staff/queue")}>
              Return to queue
            </button>
          </Empty>
        )
      ) : (
        <>
          <div className="case-h" data-tour="case-header">
            <span className="avatar lg">CP</span>
            <div className="col gap6 grow case-summary">
              <div className="mono muted">Cases / {caseId}</div>
              <div className="row gap8 wrap">
                <h1>
                  {{
                    overview: "Investigation brief",
                    evidence: "Evidence review",
                    trail: "Money trail",
                    requests: "Customer requests",
                    review: "Review & decision",
                    delivery: "Delivery & follow-up",
                    audit: "Case history",
                  }[tab] || "Investigation brief"}
                </h1>
                <Status value={view.workflow.status} />
                <Badge tone="warn">
                  {countdown == null
                    ? "Payment time not established"
                    : countdown > 0
                      ? `${remaining(countdown)} · golden hour remaining`
                      : "Golden-hour window elapsed"}
                </Badge>
              </div>
              <div className="muted">
                {view.workflow.customer_account} ·{" "}
                {label(view.workflow.intake_channel)} · version{" "}
                {view.identity.revision}
              </div>
            </div>
            <div className="stats" data-tour="case-stats">
              <div className="stat">
                <small>Confirmed disputed</small>
                <b className="num">{formatMinor(view.amounts.confirmed)}</b>
              </div>
              <div className="stat">
                <small>Additional candidate</small>
                <b className="num">{formatMinor(view.amounts.candidate)}</b>
              </div>
              <div
                className="stat"
                title={"Tamper-evident fingerprint: " + view.identity.digest}
              >
                <small>Case version</small>
                <b className="num">v{view.identity.revision}</b>
              </div>
            </div>
          </div>
          <nav className="tabs" data-tour="case-tabs">
            {tabs.map(([id, name]) => (
              <button
                key={id}
                className={"tab " + (tab === id ? "on" : "")}
                onClick={() => go(`/staff/cases/${caseId}/${id}`)}
              >
                {name}
                {id === "evidence" && (
                  <span className="n">{view.snapshot.artifacts?.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="case-body">
            <CasePages
              view={view}
              tab={tab}
              stale={!!resource.error}
              reload={resource.reload}
            />
          </div>
        </>
      )}
    </>
  );
}
