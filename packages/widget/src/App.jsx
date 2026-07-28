import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsOut,
  BookOpenText,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  CircleNotch,
  ClipboardText,
  Clock,
  Code,
  Desktop,
  DotsThreeVertical,
  FileCode,
  FileText,
  Flask,
  FolderOpen,
  Gear,
  House,
  Info,
  ListMagnifyingGlass,
  LockKey,
  NotePencil,
  Path,
  Play,
  Robot,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Table,
  TestTube,
  Warning,
} from "@phosphor-icons/react";
import { demoRun, PHASES } from "./demo-data.js";
import { connectWorkflowHost } from "./mcp-host.js";
import {
  isUsableSnapshot,
  normalizeRun,
  reconcileRunSnapshot,
} from "./run-state.js";

const NAV_ITEMS = [
  ["Workshop", House],
  ["Runs", FolderOpen],
  ["Contracts", BookOpenText],
  ["Agents", Robot],
  ["Tests", ClipboardText],
  ["Releases", Path],
  ["Settings", Gear],
];

const DESIGN_OPTIONS = [
  {
    id: "design-1",
    name: "Learning Foundry",
    image: "/assets/design-option-1.jpg",
  },
  {
    id: "design-2",
    name: "Verification Observatory",
    image: "/assets/design-option-2.jpg",
  },
  {
    id: "design-3",
    name: "Studio Path",
    image: "/assets/stringzilla-preview.jpg",
  },
];

function humanizeDesignKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

const DESIGN_VALUE_MAX_DEPTH = 4;
const DESIGN_VALUE_MAX_ITEMS = 16;
const DESIGN_VALUE_MAX_CHARS = 1_200;

function truncateDesignValue(value) {
  const text = String(value);
  return text.length > DESIGN_VALUE_MAX_CHARS
    ? `${text.slice(0, DESIGN_VALUE_MAX_CHARS)}… [truncated]`
    : text;
}

function designValue(value, depth = 0) {
  if (value === null || value === undefined) return "Not specified";
  if (["string", "number", "boolean"].includes(typeof value)) return truncateDesignValue(value);
  if (depth >= DESIGN_VALUE_MAX_DEPTH) return "[nested value omitted]";
  if (Array.isArray(value)) {
    if (value.length === 0) return "No values";
    const visible = value
      .slice(0, DESIGN_VALUE_MAX_ITEMS)
      .map((item) => designValue(item, depth + 1));
    if (value.length > DESIGN_VALUE_MAX_ITEMS) visible.push(`… (+${value.length - DESIGN_VALUE_MAX_ITEMS} more)`);
    return truncateDesignValue(visible.join(" · "));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "No values";
    const visible = entries
      .slice(0, DESIGN_VALUE_MAX_ITEMS)
      .map(([key, nestedValue]) => `${key}: ${designValue(nestedValue, depth + 1)}`);
    if (entries.length > DESIGN_VALUE_MAX_ITEMS) visible.push(`… (+${entries.length - DESIGN_VALUE_MAX_ITEMS} more)`);
    return truncateDesignValue(visible.join(" · "));
  }
  return truncateDesignValue(value);
}

function DesignDecisionPanel({ run, busy, onSelect, onAgentResolution }) {
  const options = run.design.options || [];
  const recommended = options.find((option) => option.recommended);
  return (
    <section className="panel decision-panel" aria-labelledby="design-decision-title">
      <header className="decision-heading">
        <div>
          <span className="eyebrow">Decision required · I0</span>
          <h2 id="design-decision-title">Choose the learning experience</h2>
          <p>Three distinct systems are grounded in the learner, content, interactions, and one-file artifact contract.</p>
        </div>
        <span className="decision-count">Exactly 3 options</span>
      </header>
      <div className="design-choice-grid" role="list" aria-label="Design system options">
        {options.map((option, index) => {
          const direction = option.visualDirection || {};
          const details = typeof direction === "object" ? Object.entries(direction) : [["direction", direction]];
          return (
            <article className={option.recommended ? "design-choice is-recommended" : "design-choice"} key={option.id} role="listitem">
              <div className="design-choice-preview">
                <img src={DESIGN_OPTIONS[index]?.image} alt="" aria-hidden="true" />
                <span>Option {index + 1}</span>
              </div>
              <div className="design-choice-body">
                <div className="design-choice-title">
                  <h3>{option.name}</h3>
                  {option.recommended && <span><Sparkle size={13} weight="fill" />Recommended · nonbinding</span>}
                </div>
                <p className="design-fit"><strong>Best fit:</strong> {option.rationale}</p>
                <dl tabIndex="0" aria-label={`${option.name} visual direction details`}>
                  {details.map(([label, value]) => (
                    <div key={label}>
                      <dt>{humanizeDesignKey(label)}</dt>
                      <dd>{designValue(value)}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() => onSelect(option, "user-selected")}
                >
                  <CheckCircle size={18} weight="fill" /> Select {option.name}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="decision-footer">
        <p>The recommendation is guidance, not a default. A hybrid or revision is synthesized by Codex into one coherent final system.</p>
        <div>
          <button type="button" className="secondary-button" disabled={busy || !recommended} onClick={() => onSelect(recommended, "recommended-default")}>Use recommended design</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => onAgentResolution("Use your judgment and select the strongest pedagogical, accessible, and feasible option.")}>Use your judgment</button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => onAgentResolution("Help me form a bounded hybrid or revision from the three proposed design systems. Preserve all resolved instructional requirements.")}>Request hybrid or revision</button>
        </div>
      </div>
    </section>
  );
}

function statusLabel(status) {
  return {
    passed: "Complete",
    active: "Current",
    stale: "Needs repair",
    failed: "Failed",
    awaiting_user: "Waiting",
    skipped: "Skipped",
    not_started: "Upcoming",
  }[status] || status;
}

function Sidebar({ active, onSelect }) {
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand-mark" aria-label="Learning Booklet Studio">
        <span>LB</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(([label, Icon]) => (
          <button
            className={active === label ? "side-link is-active" : "side-link"}
            key={label}
            onClick={() => onSelect(label)}
            type="button"
            aria-current={active === label ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={22} weight={active === label ? "fill" : "regular"} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="side-link side-help" type="button" onClick={() => onSelect("Help")}>
        <Info aria-hidden="true" size={22} />
        <span>Help</span>
      </button>
    </aside>
  );
}

function PhaseRail({ phases, currentPhase, selectedPhase, onSelect }) {
  return (
    <nav className="phase-rail" aria-label="Workflow phases">
      <ol>
        {phases.map((phase, index) => {
          const status = phase.status || "not_started";
          return (
            <li className={`phase-step phase-${status}`} key={phase.id}>
              <button
                type="button"
                className={selectedPhase === phase.id ? "phase-button is-selected" : "phase-button"}
                onClick={() => onSelect(phase.id)}
                aria-current={currentPhase === phase.id ? "step" : undefined}
                aria-label={`${phase.id}, ${phase.label}, ${statusLabel(status)}`}
              >
                <span className="phase-node" aria-hidden="true">
                  {status === "passed" ? <Check size={15} weight="bold" /> : index + 1}
                </span>
                <span className="phase-copy">
                  <strong>{phase.short || phase.label}</strong>
                  <small>{statusLabel(status)}</small>
                </span>
              </button>
              {index < phases.length - 1 && <span className="phase-connector" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function PreviewCard({ run }) {
  const selectedIndex = Math.max(
    0,
    DESIGN_OPTIONS.findIndex((option) => option.id === run.design.selectedOptionId),
  );
  const [visibleIndex, setVisibleIndex] = useState(selectedIndex);
  const [previewMode, setPreviewMode] = useState("desktop");
  const visible = DESIGN_OPTIONS[visibleIndex];

  function changeSlide(direction) {
    setVisibleIndex((current) => (current + direction + DESIGN_OPTIONS.length) % DESIGN_OPTIONS.length);
  }

  return (
    <section className="panel direction-panel" aria-labelledby="direction-title">
      <header className="panel-heading inline-heading">
        <div>
          <span className="eyebrow">Locked decision</span>
          <h2 id="direction-title">Selected visual direction</h2>
        </div>
        <span className="selected-pill">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          {run.design.selectedName}
        </span>
      </header>

      <div className="direction-layout">
        <div className="visual-preview-block">
          <div className="device-switcher" aria-label="Preview size">
            {[
              ["desktop", Desktop],
              ["tablet", Table],
              ["mobile", FileCode],
            ].map(([mode, Icon]) => (
              <button
                type="button"
                aria-label={`${mode} preview`}
                aria-pressed={previewMode === mode}
                className={previewMode === mode ? "is-active" : ""}
                onClick={() => setPreviewMode(mode)}
                key={mode}
              >
                <Icon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className={`preview-frame preview-${previewMode}`}>
            <img src={visible.image} alt={`${visible.name} design preview`} />
          </div>
          <div className="carousel-controls">
            <span>{visibleIndex + 1} / {DESIGN_OPTIONS.length} options</span>
            <div className="carousel-dots" aria-label="Design options">
              {DESIGN_OPTIONS.map((option, index) => (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => setVisibleIndex(index)}
                  aria-label={`Show ${option.name}`}
                  aria-current={visibleIndex === index ? "true" : undefined}
                  className={visibleIndex === index ? "is-active" : ""}
                />
              ))}
            </div>
            <div className="carousel-arrows">
              <button type="button" onClick={() => changeSlide(-1)} aria-label="Previous design">
                <CaretLeft size={16} />
              </button>
              <button type="button" onClick={() => changeSlide(1)} aria-label="Next design">
                <CaretRight size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="system-card">
          <h3>Selected system</h3>
          <dl>
            {run.design.system.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{designValue(value)}</dd>
              </div>
            ))}
          </dl>
          <button className="secondary-button system-button" type="button" onClick={() => document.getElementById("journal-title")?.scrollIntoView({ behavior: "smooth" })}>
            View design rationale
            <CaretRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function CurrentWorkPanel({ run, busy, onContinue, onRequestChanges, onAddNote }) {
  const work = run.currentWork;
  if (!work) {
    return (
      <section className="panel current-panel unavailable-panel" aria-labelledby="current-work-title">
        <header className="current-title-row">
          <span className="current-icon is-warning"><Warning size={25} weight="fill" aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">Authoritative projection incomplete</span>
            <h2 id="current-work-title">Current work was not published</h2>
          </div>
        </header>
        <p className="current-description">No current-work details are available in this snapshot. Reconcile the run before taking an action.</p>
      </section>
    );
  }
  const actions = work.actions || [];
  const locked = work.locked || [];
  const artifacts = work.artifacts || [];
  const constraints = work.constraints || [];
  return (
    <section className="panel current-panel" aria-labelledby="current-work-title">
      <header className="current-title-row">
        <span className="current-icon"><Sparkle size={25} weight="fill" aria-hidden="true" /></span>
        <div>
          <span className="eyebrow">Current phase · {run.currentPhase}</span>
          <h2 id="current-work-title">{work.title}</h2>
        </div>
      </header>
      <p className="current-description">{work.description}</p>

      <div className="current-grid">
        <div className="current-main">
          <h3>Next authoritative action</h3>
          <ol className="action-list">
            {actions.map(([title, detail], index) => (
              <li key={title}>
                <span>{index + 1}</span>
                <div><strong>{title}</strong><small>{detail}</small></div>
              </li>
            ))}
          </ol>

          {locked.length > 0 && <><h3>Locked decisions</h3>
            <ul className="locked-list">
              {locked.map((item) => (
                <li key={item}><LockKey size={17} weight="fill" aria-hidden="true" />{item}</li>
              ))}
            </ul></>}

          {work.assumption && <div className="assumption-note">
              <Warning size={19} weight="fill" aria-hidden="true" />
              <div><strong>Assumption · non-blocking</strong><span>{work.assumption}</span></div>
              <button type="button" onClick={onRequestChanges}>Review</button>
            </div>}
        </div>

        <aside className="scope-card" aria-label="Phase scope contract">
          <div className="scope-title"><FileText size={19} aria-hidden="true" /><strong>Scope contract</strong></div>
          <h4>Current phase artifacts</h4>
          {artifacts.length > 0 ? <ul>{artifacts.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="empty-copy">None published.</p>}
          {constraints.length > 0 && <><h4>Constraints</h4>
            <ul className="constraint-list">{constraints.map((item) => <li key={item}>{item}</li>)}</ul></>}
        </aside>
      </div>

      <div className="action-bar">
        <button className="primary-button" type="button" onClick={onContinue} disabled={busy}>
          {busy ? <CircleNotch className="spin" size={19} /> : <Play size={19} weight="fill" />}
          {busy ? "Waiting for reconciliation…" : work.nextAction?.label || "Continue workflow"}
        </button>
        <button className="secondary-button" type="button" onClick={onRequestChanges} disabled={busy}>
          <ListMagnifyingGlass size={18} /> Request changes
        </button>
        <button className="secondary-button" type="button" onClick={onAddNote} disabled={busy}>
          <NotePencil size={18} /> Add note
        </button>
      </div>
      <p className="action-help">Continue posts a model-visible follow-up; the skill resumes from the authoritative run state.</p>
    </section>
  );
}

function ActivityPanel({ run, onRefresh, onFullscreen }) {
  const activity = run.activity || { state: "unavailable", recent: [] };
  return (
    <aside className="activity-panel" aria-labelledby="activity-title">
      <header>
        <div><span className="eyebrow">Run telemetry</span><h2 id="activity-title">Activity</h2></div>
        <button type="button" onClick={onFullscreen} aria-label="Open full-screen workflow"><ArrowsOut size={18} /></button>
      </header>
      <div className="live-card">
        <div><span className={`live-dot state-${activity.state}`} /> <strong>Server state</strong></div>
        <span>{activity.state}</span>
        <p>Activity state does not imply that a local process is running.</p>
        <button type="button" onClick={onRefresh}>Reconcile state</button>
      </div>
      <h3>Recent events</h3>
      <ol className="recent-events">
        {(activity.recent || []).map(([time, title, tone]) => (
          <li key={`${time}-${title}`}>
            <time>{time}</time>
            <span>{title}<small className={`event-${tone}`}>{tone}</small></span>
          </li>
        ))}
        {(activity.recent || []).length === 0 && <li className="empty-event"><span>No events were published.</span></li>}
      </ol>
      <button className="activity-footer" type="button" onClick={() => document.getElementById("journal-title")?.scrollIntoView({ behavior: "smooth" })}>
        View full activity <CaretRight size={14} />
      </button>
    </aside>
  );
}

function Journal({ entries }) {
  const [expanded, setExpanded] = useState(new Set());
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? entries : entries.filter((entry) => entry.tone === filter);

  function toggle(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="panel journal-panel" aria-labelledby="journal-title">
      <header className="journal-header">
        <div><span className="eyebrow">Inspectable history</span><h2 id="journal-title">Work journal</h2></div>
        <label>
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span className="sr-only">Filter journal</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All events</option>
            <option value="success">Passed</option>
            <option value="warning">Reopened</option>
            <option value="error">Failed</option>
            <option value="info">Other updates</option>
          </select>
        </label>
      </header>
      <ol className="journal-list">
        {filtered.map((entry) => {
          const isExpanded = expanded.has(entry.id);
          return (
            <li className={`journal-row tone-${entry.tone}`} key={entry.id}>
              <span className="journal-symbol" aria-hidden="true"><ShieldCheck size={20} weight="fill" /></span>
              <time>{entry.time}</time>
              <div className="journal-title"><strong>{entry.title}</strong><span>{entry.status}</span></div>
              <small>by <strong>{entry.actor}</strong></small>
              <p>{entry.detail}</p>
              <span className="journal-badge">{entry.badge}</span>
              <code>{entry.id}</code>
              <button type="button" onClick={() => toggle(entry.id)} aria-expanded={isExpanded} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${entry.title}`}>
                <CaretDown size={16} className={isExpanded ? "rotate" : ""} />
              </button>
              {isExpanded && (
                <div className="journal-detail">
                  Evidence is retained with its producer, observed time, current artifact hash, and limitations.
                </div>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && <li className="journal-empty">No journal events were published in this snapshot.</li>}
      </ol>
    </section>
  );
}

function Toast({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice?.message) return undefined;
    const timeout = window.setTimeout(onDismiss, 4500);
    return () => window.clearTimeout(timeout);
  }, [notice, onDismiss]);
  if (!notice?.message) return null;
  const error = notice.tone === "error";
  return (
    <div className={`toast toast-${notice.tone || "info"}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
      {error ? <Warning size={18} weight="fill" /> : <Info size={18} weight="fill" />}
      {notice.message}
    </div>
  );
}

const SAFE_ERRORS = {
  "LBS-HOST-CONNECT-001": {
    title: "Host bridge unavailable",
    consequence: "The widget cannot read or change workflow state. Previously rendered data may be stale.",
  },
  "LBS-RECONCILE-002": {
    title: "Run reconciliation failed",
    consequence: "The latest server revision is unknown, so workflow actions are disabled until reconciliation succeeds.",
  },
  "LBS-DECISION-003": {
    title: "Decision not recorded",
    consequence: "The selected design was not confirmed by the server and the workflow has not advanced.",
  },
  "LBS-FOLLOWUP-004": {
    title: "Codex follow-up not sent",
    consequence: "The authoritative run state is unchanged; resume must be retried from the same task.",
  },
  "LBS-RUN-MISMATCH-005": {
    title: "Unexpected run snapshot ignored",
    consequence: "A snapshot for another run was rejected so it could not replace the workflow currently shown.",
  },
};

function ReconciliationBanner({ sync }) {
  if (!["connecting", "reconciling", "stale"].includes(sync.status)) return null;
  const stale = sync.status === "stale";
  return (
    <div className={`reconciliation-banner ${stale ? "is-stale" : ""}`} role="status" aria-live="polite">
      {stale ? <Warning size={18} weight="fill" aria-hidden="true" /> : <CircleNotch className="spin" size={18} aria-hidden="true" />}
      <div>
        <strong>{stale ? "Stale delivery ignored" : sync.status === "connecting" ? "Connecting to host" : "Reconciling authoritative state"}</strong>
        <span>{sync.message}</span>
      </div>
    </div>
  );
}

function SafeErrorPanel({ error, onRetry }) {
  if (!error) return null;
  return (
    <section className="safe-error" role="alert" aria-labelledby="safe-error-title">
      <Warning size={23} weight="fill" aria-hidden="true" />
      <div>
        <span className="error-code">{error.code}</span>
        <h2 id="safe-error-title">{error.title}</h2>
        <p>{error.consequence}</p>
      </div>
      <button className="secondary-button" type="button" onClick={onRetry}>Retry reconciliation</button>
    </section>
  );
}

function EvidenceStatus({ status, stale }) {
  const success = status === "pass" && !stale;
  return (
    <span className={`evidence-status evidence-${stale ? "stale" : status}`}>
      {success ? <CheckCircle size={14} weight="fill" aria-hidden="true" /> : <Warning size={14} weight="fill" aria-hidden="true" />}
      {stale ? "stale" : status}
    </span>
  );
}

function IntegrityPanel({ run }) {
  const repair = run.repair || { failedGateAttempts: [], phaseFailures: [], reopenedPhases: [], hasHistory: false };
  const evidence = run.evidence || [];
  const release = run.release;
  const risks = run.residualRisks || [];
  const limitations = run.limitations || [];
  return (
    <section className="panel integrity-panel" aria-labelledby="integrity-title">
      <header className="integrity-heading">
        <div><span className="eyebrow">Truth and release evidence</span><h2 id="integrity-title">Verification, repair, and native gates</h2></div>
        {release && <span className={`release-decision release-${release.decision}`}>
          {release.decision === "pass" ? <CheckCircle size={15} weight="fill" /> : <Warning size={15} weight="fill" />}
          Release {release.decision}
        </span>}
      </header>

      {(run.orchestration?.degraded || run.status === "blocked_external") && (
        <div className="degraded-callout">
          <Warning size={18} weight="fill" aria-hidden="true" />
          <div><strong>Orchestration is degraded</strong><span>{run.orchestration?.consequence || "The workflow is blocked by an external condition."}</span></div>
        </div>
      )}

      <div className="integrity-grid">
        <div>
          <h3>Evidence records</h3>
          {evidence.length > 0 ? <ul className="evidence-list">
            {evidence.slice(-8).map((entry) => (
              <li key={entry.id}>
                <div><strong>{entry.gateId}</strong><code>{entry.id}</code></div>
                <EvidenceStatus status={entry.status} stale={entry.stale} />
              </li>
            ))}
          </ul> : <p className="empty-copy">No evidence records were published.</p>}
        </div>
        <div>
          <h3>Native desktop gates</h3>
          <ul className="native-gate-list">
            {(run.nativeGates || []).map((gate) => (
              <li key={gate.architecture}>
                <strong>{gate.architecture === "native-macos-intel" ? "macOS Intel" : "macOS Apple Silicon"}</strong>
                <span className={`gate-state gate-${gate.status}`}><Warning size={13} weight="fill" />{gate.status}</span>
                <small>{gate.currentEvidenceCount} current record{gate.currentEvidenceCount === 1 ? "" : "s"}; {gate.notRunCount} not_run</small>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Offline artifact record</h3>
          <div className="artifact-record">
            <strong>{run.offlineArtifact?.status || "missing"}</strong>
            <code>{run.offlineArtifact?.artifactHash || "No production artifact hash published"}</code>
            <span>Self-contained claim: {String(run.offlineArtifact?.selfContainedClaim ?? "not recorded")}</span>
            <span>Current passing evidence: {run.offlineArtifact?.currentPassingEvidenceIds?.length || 0}</span>
          </div>
        </div>
      </div>

      <div className="audit-disclosures">
        <details>
          <summary><Warning size={15} weight="fill" />Repair history · {(repair.failedGateAttempts?.length || 0) + (repair.phaseFailures?.length || 0)} failures</summary>
          <div className="audit-detail">
            {!repair.hasHistory && <p>No failed or reopened attempts were published.</p>}
            {(repair.failedGateAttempts || []).map((attempt) => (
              <article key={attempt.id}>
                <strong>{attempt.phaseId} · {attempt.gateId}</strong>
                <span>Cause: {(attempt.reasons || []).join(", ") || "not recorded"}</span>
                <span>Earliest responsible phase: {attempt.causalPhase || "not recorded"}</span>
                <span>Repair attempt: {attempt.repairAttempt ?? "not recorded"}</span>
                <span>Failed hash: {attempt.failedArtifactHashes?.join(", ") || "not recorded"}</span>
                <span>Current pass: {attempt.currentPass?.artifactHash || "none"}</span>
              </article>
            ))}
            {(repair.reopenedPhases || []).map((entry) => <p key={entry.id}>{entry.phaseId} reopened: {entry.reason}</p>)}
          </div>
        </details>
        <details>
          <summary><ShieldCheck size={15} />Release blockers and residual risk</summary>
          <div className="audit-detail">
            <p><strong>Blocking reasons:</strong> {release?.blockingReasons?.join(", ") || "none published"}</p>
            <p><strong>Residual risks:</strong> {risks.length ? risks.map((risk) => typeof risk === "string" ? risk : risk.title || risk.id || JSON.stringify(risk)).join("; ") : "none recorded"}</p>
            <p><strong>Limitations:</strong> {limitations.length ? limitations.map((item) => typeof item === "string" ? item : item.title || item.id || JSON.stringify(item)).join("; ") : "none recorded"}</p>
          </div>
        </details>
      </div>
    </section>
  );
}

export function App() {
  const [run, setRun] = useState(() => {
    const standalone = window.parent === window || new URLSearchParams(location.search).has("standalone");
    return normalizeRun(window.openai?.toolOutput || (standalone ? demoRun : null));
  });
  const [activeNav, setActiveNav] = useState("Workshop");
  const [selectedPhase, setSelectedPhase] = useState(run.currentPhase);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [safeError, setSafeError] = useState(null);
  const [sync, setSync] = useState({ status: "connecting", message: "Waiting for the MCP host bridge." });
  const hostRef = useRef(null);
  const runRef = useRef(run);
  const applySnapshotRef = useRef(null);
  const reconcileRef = useRef(null);
  const reconcileInFlight = useRef(null);
  const decisionInFlight = useRef(false);

  function notify(message, tone = "info") {
    setNotice({ message, tone });
  }

  function showSafeError(code) {
    const record = SAFE_ERRORS[code] || SAFE_ERRORS["LBS-RECONCILE-002"];
    setSafeError({ code, ...record });
  }

  applySnapshotRef.current = (payload, source = "host") => {
    const outcome = reconcileRunSnapshot(runRef.current, payload);
    if (["applied", "child_transition"].includes(outcome.kind)) {
      runRef.current = outcome.run;
      setRun(outcome.run);
      setSelectedPhase((current) => current || outcome.run.currentPhase);
      setSync({
        status: "current",
        message: outcome.kind === "child_transition"
          ? `Verified same-thread child ${outcome.run.runId} and continued from terminal parent ${outcome.parentRunId}.`
          : `Authoritative revision ${outcome.run.stateVersion} reconciled from ${source}.`,
      });
      setSafeError(null);
    } else if (outcome.kind === "stale") {
      setSync({
        status: "stale",
        message: `Revision ${outcome.incomingVersion} was ignored; revision ${runRef.current.stateVersion} remains visible while the server is queried.`,
      });
      window.setTimeout(() => reconcileRef.current?.("stale-delivery"), 0);
    } else if (outcome.kind === "different_run") {
      showSafeError("LBS-RUN-MISMATCH-005");
      window.setTimeout(() => reconcileRef.current?.("run-mismatch"), 0);
    } else if (outcome.kind === "invalid") {
      showSafeError("LBS-RECONCILE-002");
    }
    return outcome;
  };

  reconcileRef.current = async (reason = "manual", forceReconnect = false) => {
    const host = hostRef.current;
    if (!host || host.isStandalone) {
      setSync({ status: "standalone", message: "Standalone preview uses its supplied fixture and cannot query workflow_get." });
      return false;
    }
    if (reconcileInFlight.current) return reconcileInFlight.current;
    const operation = (async () => {
      setSync({ status: "reconciling", message: `Reading the latest run snapshot (${reason}).` });
      try {
        if (forceReconnect) {
          const reconnected = await host.reconnect(reason);
          if (!reconnected) throw new Error("HOST_BRIDGE_UNAVAILABLE");
        }
        const args = runRef.current.runId ? { runId: runRef.current.runId } : {};
        let result;
        try {
          result = await host.callTool("workflow_get", args);
        } catch {
          const reconnected = await host.reconnect(`${reason}-retry`);
          if (!reconnected) throw new Error("HOST_BRIDGE_UNAVAILABLE");
          result = await host.callTool("workflow_get", args);
        }
        if (!result?.structuredContent) throw new Error("SNAPSHOT_MISSING");
        const outcome = applySnapshotRef.current(result.structuredContent, `workflow_get:${reason}`);
        if (!["applied", "child_transition", "duplicate"].includes(outcome.kind)) throw new Error("SNAPSHOT_NOT_CURRENT");
        setSafeError(null);
        setSync({ status: "current", message: `Authoritative revision ${runRef.current.stateVersion} is current.` });
        return true;
      } catch {
        setSync({ status: "error", message: "Authoritative state could not be read." });
        showSafeError(reason === "mount" ? "LBS-HOST-CONNECT-001" : "LBS-RECONCILE-002");
        return false;
      } finally {
        reconcileInFlight.current = null;
      }
    })();
    reconcileInFlight.current = operation;
    return operation;
  };

  useEffect(() => {
    const host = connectWorkflowHost({
      onResult: (payload) => applySnapshotRef.current?.(payload, "host-event"),
      onContext: (context) => {
        document.documentElement.dataset.hostTheme = context?.theme || "light";
      },
      onConnection: ({ status }) => {
        if (status === "connecting") setSync({ status: "connecting", message: "Opening the MCP host bridge." });
      },
    });
    hostRef.current = host;
    let disposed = false;

    host.connected.then((connected) => {
      if (disposed) return;
      if (host.isStandalone) {
        setSync({ status: "standalone", message: "Standalone preview uses the supplied fixture." });
      } else if (connected) {
        reconcileRef.current?.("mount");
      } else {
        setSync({ status: "error", message: "The MCP host bridge did not connect." });
        showSafeError("LBS-HOST-CONNECT-001");
      }
    });

    const reconcileAfterResume = () => reconcileRef.current?.("remount");
    const reconcileAfterOnline = () => reconcileRef.current?.("reconnect", true);
    const reconcileAfterVisibility = () => {
      if (document.visibilityState === "visible") reconcileRef.current?.("host-resume");
    };
    window.addEventListener("pageshow", reconcileAfterResume);
    window.addEventListener("online", reconcileAfterOnline);
    window.addEventListener("learning-booklet:host-reconnect", reconcileAfterOnline);
    document.addEventListener("visibilitychange", reconcileAfterVisibility);
    return () => {
      disposed = true;
      window.removeEventListener("pageshow", reconcileAfterResume);
      window.removeEventListener("online", reconcileAfterOnline);
      window.removeEventListener("learning-booklet:host-reconnect", reconcileAfterOnline);
      document.removeEventListener("visibilitychange", reconcileAfterVisibility);
      host.close().catch(() => {});
      if (hostRef.current === host) hostRef.current = null;
    };
  }, []);

  const currentPhase = useMemo(
    () => run.phases.find((phase) => phase.id === selectedPhase) || run.phases.find((phase) => phase.id === run.currentPhase),
    [run.phases, run.currentPhase, selectedPhase],
  );

  async function continueRun() {
    if (!isUsableSnapshot(run) && !hostRef.current?.isStandalone) {
      showSafeError("LBS-RECONCILE-002");
      return;
    }
    setBusy(true);
    const prompt = `Resume $build-learning-booklet for run ${run.runId} from ${run.currentPhase}. Read the authoritative run state, complete the current hard gate, record evidence, and stop at the next material decision.`;
    try {
      const sent = await hostRef.current?.sendFollowUp(prompt);
      notify(sent ? "Sent to Codex. The skill will resume from this run." : "Standalone preview: resume action simulated.");
    } catch {
      showSafeError("LBS-FOLLOWUP-004");
    } finally {
      setBusy(false);
    }
  }

  async function requestChanges() {
    const prompt = `Review the locked decisions for run ${run.runId}. Ask only for the smallest material change needed, preserve every other confirmed value, and do not advance the phase yet.`;
    const sent = await hostRef.current?.sendFollowUp(prompt).catch(() => false);
    if (!sent && !hostRef.current?.isStandalone) showSafeError("LBS-FOLLOWUP-004");
    else notify(sent ? "Change request sent to Codex." : "Standalone preview: change request simulated.");
  }

  async function addNote() {
    const prompt = `Add a user note to run ${run.runId}. Ask me for the note text, preserve provenance, and do not change phase status.`;
    const sent = await hostRef.current?.sendFollowUp(prompt).catch(() => false);
    if (!sent && !hostRef.current?.isStandalone) showSafeError("LBS-FOLLOWUP-004");
    else notify(sent ? "Codex is ready to capture your note." : "Standalone preview: note flow simulated.");
  }

  async function refreshRun() {
    const reconciled = await reconcileRef.current?.("manual");
    notify(reconciled ? "Authoritative run state reconciled." : "Standalone preview already shows its supplied fixture.");
  }

  async function selectDesignOption(option, method) {
    if (!option || decisionInFlight.current) return;
    decisionInFlight.current = true;
    setBusy(true);
    const commandId = `design-${run.runId}-${option.id}-${run.stateVersion}`;
    try {
      const result = await hostRef.current?.callTool("workflow_submit_decision", {
        runId: run.runId,
        commandId,
        expectedStateVersion: run.stateVersion,
        command: {
          type: "design.select",
          payload: {
            selection: { method, selectedOptionId: option.id },
            selectedBy: "user",
          },
        },
      });
      const outcome = result?.structuredContent
        ? applySnapshotRef.current(result.structuredContent, "decision-response")
        : null;
      if (outcome && !["applied", "child_transition", "duplicate"].includes(outcome.kind)) {
        throw new Error("DECISION_SNAPSHOT_REJECTED");
      }
      const acceptedRun = outcome?.run || runRef.current;
      const resumed = await hostRef.current?.sendFollowUp(
        `Resume $build-learning-booklet for run ${acceptedRun.runId}. The design decision ${option.id} was recorded idempotently${acceptedRun.parentRunId ? ` in the same-thread child of ${acceptedRun.parentRunId}` : ""}; reconcile authoritative state, complete I0 evidence, and continue to the next material decision.`,
      );
      notify(
        result
          ? `${option.name} recorded${resumed ? " and sent to Codex" : ""}.`
          : `Standalone preview: ${option.name} selection simulated.`,
      );
    } catch {
      showSafeError("LBS-DECISION-003");
      await reconcileRef.current?.("decision-conflict");
    } finally {
      decisionInFlight.current = false;
      setBusy(false);
    }
  }

  async function requestAgentDesignResolution(instruction) {
    if (decisionInFlight.current) return;
    decisionInFlight.current = true;
    setBusy(true);
    try {
      const sent = await hostRef.current?.sendFollowUp(
        `${instruction} Run ${run.runId}, state version ${run.stateVersion}. Do not concatenate option descriptions; record one coherent final direction through the authoritative engine.`,
      );
      if (!sent && !hostRef.current?.isStandalone) showSafeError("LBS-FOLLOWUP-004");
      else notify(sent ? "Design resolution request sent to Codex." : "Standalone preview: design resolution request simulated.");
    } catch {
      showSafeError("LBS-FOLLOWUP-004");
    } finally {
      decisionInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to workflow</a>
      <Sidebar active={activeNav} onSelect={(value) => { setActiveNav(value); notify(`${value} selected.`); }} />
      <div className="workspace-shell">
        <ReconciliationBanner sync={sync} />
        <SafeErrorPanel error={safeError} onRetry={() => reconcileRef.current?.("error-retry", true)} />
        <header className="topbar">
          <div>
            <div className="title-line">
              <h1>{run.topic}</h1>
              <span className={`run-status run-${run.status}`}><span />{run.status}</span>
            </div>
            <p>{run.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <span className="state-version">{Number.isInteger(run.stateVersion) ? `State v${run.stateVersion}` : "State unavailable"}</span>
            <button type="button" className="topbar-button" onClick={() => notify("Settings are owned by the current run contract.")}>
              <Gear size={17} /> Project settings
            </button>
            <button type="button" className="icon-button" aria-label="More project actions" onClick={() => notify("No additional project actions are available in this MVP.")}>
              <DotsThreeVertical size={19} />
            </button>
          </div>
        </header>

        <PhaseRail
          phases={run.phases}
          currentPhase={run.currentPhase}
          selectedPhase={selectedPhase}
          onSelect={(id) => { setSelectedPhase(id); notify(`${id} · ${PHASES.find((phase) => phase.id === id)?.label}`); }}
        />

        <main id="main-content" className="main-layout" tabIndex="-1">
          <div className="content-column">
            {currentPhase?.id !== run.currentPhase && (
              <div className="inspection-banner">
                <Info size={18} weight="fill" />
                Inspecting {currentPhase.id} · {currentPhase.label}. The authoritative current phase remains {run.currentPhase}.
                <button type="button" onClick={() => setSelectedPhase(run.currentPhase)}>Return to current</button>
              </div>
            )}
              {run.design.options?.length === 3 && !run.design.selectedOptionId && !run.design.finalVisualDirection ? (
                <DesignDecisionPanel
                  run={run}
                  busy={busy || (!["current", "standalone"].includes(sync.status) && !hostRef.current?.isStandalone)}
                  onSelect={selectDesignOption}
                  onAgentResolution={requestAgentDesignResolution}
                />
              ) : (
                <div className="primary-grid">
                  {run.design.finalVisualDirection ? <PreviewCard run={run} /> : (
                    <section className="panel direction-panel unavailable-panel" aria-labelledby="direction-title">
                      <span className="eyebrow">Visual direction unavailable</span>
                      <h2 id="direction-title">No resolved design was published</h2>
                      <p>The widget will not substitute a demo design for missing authoritative state.</p>
                    </section>
                  )}
                  <CurrentWorkPanel
                    run={run}
                    busy={busy || (!["current", "standalone"].includes(sync.status) && !hostRef.current?.isStandalone)}
                    onContinue={continueRun}
                    onRequestChanges={requestChanges}
                    onAddNote={addNote}
                  />
                </div>
              )}
            <IntegrityPanel run={run} />
            <Journal entries={run.journal} />
            <footer className="workspace-footer"><Clock size={16} />Times shown in your local timezone · Protocol {run.protocol}</footer>
          </div>
          <ActivityPanel
            run={run}
            onRefresh={refreshRun}
            onFullscreen={() => hostRef.current?.requestFullscreen().catch(() => showSafeError("LBS-HOST-CONNECT-001"))}
          />
        </main>
      </div>
      <Toast notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}
