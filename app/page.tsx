"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { RadioStats } from "./lib/router-adapters/types";
import { plannedAdapters, x17uAdapter } from "./lib/router-adapters/x17u";

type HistoryPoint = RadioStats & {
  note?: string;
};

type Grade = {
  label: string;
  score: number;
  tone: "great" | "good" | "watch" | "bad";
  summary: string;
};

type Diagnosis = {
  title: string;
  body: string;
  tone: Grade["tone"];
};

type RouterSessionState = {
  baseUrl: string;
  username: string;
  sessionId: string;
  createdAt: string;
  lastSyncAt: string | null;
};

const SESSION_STORAGE_KEY = "broadband-diagnostics-x17u-session";
const AUTO_SYNC_MS = 5_000;

const sampleHistory: HistoryPoint[] = [
  {
    capturedAt: "2026-08-30T12:39:00.000Z",
    routerFamily: "zlt-x17u",
    routerName: "ZLT X17U",
    networkType: "4G+",
    operator: "MTN NG",
    rsrp: -79,
    rsrq: -10,
    rssi: -55,
    sinr: 9,
    cqi: 12,
    dlMcs: 13,
    ulMcs: 26,
    rank4g: 2,
    bands: ["B7", "B20", "B7", "B3"],
    bandwidthMHz: [20, 20, 20, 20],
    pci: "113",
    earfcn: ["3050", "6250", "2852", "1650"],
    enodebId: "82193",
    cellId: "14",
    ecgi: "62130082193014",
    flowDl: 4820000,
    flowUl: 760000,
    bler4g: 1,
    onlineDuration: "18:42:11",
    routerLatencyMs: 18,
    raw: {},
  },
  {
    capturedAt: "2026-08-30T12:42:00.000Z",
    routerFamily: "zlt-x17u",
    routerName: "ZLT X17U",
    networkType: "4G+",
    operator: "MTN NG",
    rsrp: -77,
    rsrq: -9,
    rssi: -54,
    sinr: 12,
    cqi: 13,
    dlMcs: 16,
    ulMcs: 28,
    rank4g: 2,
    bands: ["B7", "B20", "B7", "B3"],
    bandwidthMHz: [20, 20, 20, 20],
    pci: "113",
    earfcn: ["3050", "6250", "2852", "1650"],
    enodebId: "82193",
    cellId: "14",
    ecgi: "62130082193014",
    flowDl: 6120000,
    flowUl: 980000,
    bler4g: 0,
    onlineDuration: "18:45:12",
    routerLatencyMs: 16,
    raw: {},
  },
  {
    capturedAt: "2026-08-30T12:45:00.000Z",
    routerFamily: "zlt-x17u",
    routerName: "ZLT X17U",
    networkType: "4G+",
    operator: "MTN NG",
    plmn: "62130",
    signalLevel: 5,
    rsrp: -74,
    rsrq: -9,
    rssi: -53,
    sinr: 10,
    cqi: 13,
    dlMcs: 12,
    ulMcs: 29,
    rank4g: 2,
    bands: ["B7", "B20", "B7", "B3"],
    bandwidthMHz: [20, 20, 20, 20],
    pci: "113",
    earfcn: ["3050", "6250", "2852", "1650"],
    enodebId: "82193",
    cellId: "14",
    ecgi: "62130082193014",
    flowDl: 5350000,
    flowUl: 880000,
    bler4g: 2,
    maxDlQam: "64QAM",
    maxUlQam: "64QAM",
    wifiNetworks: [
      {
        ssid: "MTN-X17U",
        band: "2.4 GHz",
        channel: "6",
        security: "WPA2-PSK",
        enabled: true,
        mode: "11b/g/n",
        maxClients: 32,
        connectedCount: 3,
      },
      {
        ssid: "MTN-X17U-5G",
        band: "5 GHz",
        channel: "Auto",
        security: "WPA2-PSK",
        enabled: true,
        mode: "11ac",
        maxClients: 32,
        connectedCount: 1,
      },
    ],
    connectedDevices: [
      {
        id: "demo-phone",
        name: "Bode phone",
        ip: "192.168.0.102",
        mac: null,
        connection: "Wi-Fi",
        band: "5 GHz",
        connectedFor: null,
        signal: null,
      },
      {
        id: "demo-laptop",
        name: "Laptop",
        ip: "192.168.0.110",
        mac: null,
        connection: "Wi-Fi",
        band: "2.4 GHz",
        connectedFor: null,
        signal: null,
      },
      {
        id: "demo-tv",
        name: "Smart TV",
        ip: "192.168.0.115",
        mac: null,
        connection: "Wi-Fi",
        band: "2.4 GHz",
        connectedFor: null,
        signal: null,
      },
    ],
    connectedDeviceCount: 4,
    wifiClientCount: 4,
    onlineDuration: "18:48:10",
    routerLatencyMs: 21,
    raw: {},
  },
];

const metricHelp = {
  rsrp:
    "Tower signal strength. Closer to zero is stronger, so -74 dBm is much better than -105 dBm.",
  rsrq:
    "Signal quality after noise and shared-cell load are considered. Below -14 dB usually hurts performance.",
  sinr:
    "How clearly the router hears the tower over interference. Higher is better.",
  cqi: "Network quality score from 0 to 15. Higher usually unlocks faster modulation.",
  dlMcs:
    "Download coding mode. Higher means the tower can send denser data to the router.",
  latency:
    "How long this local dashboard waited for the router to answer.",
};

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function scoreRsrp(value: number | null): Grade {
  if (value === null) return missingGrade("Signal strength");
  if (value >= -80)
    return {
      label: "Excellent",
      score: 96,
      tone: "great",
      summary: "The router is hearing the tower strongly.",
    };
  if (value >= -90)
    return {
      label: "Good",
      score: 82,
      tone: "good",
      summary: "The signal is strong enough for stable broadband.",
    };
  if (value >= -100)
    return {
      label: "Fair",
      score: 58,
      tone: "watch",
      summary: "Usable, but placement can probably improve it.",
    };
  return {
    label: "Weak",
    score: 28,
    tone: "bad",
    summary: "The router is struggling to hear the tower.",
  };
}

function scoreRsrq(value: number | null): Grade {
  if (value === null) return missingGrade("Signal quality");
  if (value >= -9)
    return {
      label: "Clean",
      score: 88,
      tone: "great",
      summary: "The radio channel looks tidy.",
    };
  if (value >= -12)
    return {
      label: "Good",
      score: 74,
      tone: "good",
      summary: "Quality is fine, with some normal load or noise.",
    };
  if (value >= -15)
    return {
      label: "Noisy",
      score: 48,
      tone: "watch",
      summary: "The signal is being dragged down by noise or load.",
    };
  return {
    label: "Poor",
    score: 22,
    tone: "bad",
    summary: "Quality is poor enough to hurt speed and stability.",
  };
}

function scoreSinr(value: number | null): Grade {
  if (value === null) return missingGrade("Signal cleanliness");
  if (value >= 20)
    return {
      label: "Excellent",
      score: 98,
      tone: "great",
      summary: "Very little interference is visible.",
    };
  if (value >= 13)
    return {
      label: "Very good",
      score: 86,
      tone: "great",
      summary: "Clean enough for high data rates.",
    };
  if (value >= 5)
    return {
      label: "Good",
      score: 68,
      tone: "good",
      summary: "Usable, but interference is present.",
    };
  if (value >= 0)
    return {
      label: "Marginal",
      score: 42,
      tone: "watch",
      summary: "Interference is likely limiting performance.",
    };
  return {
    label: "Bad",
    score: 16,
    tone: "bad",
    summary: "The router is hearing more noise than useful signal.",
  };
}

function scoreMcs(value: number | null): Grade {
  if (value === null) return missingGrade("MCS");
  if (value >= 20)
    return {
      label: "High",
      score: 90,
      tone: "great",
      summary: "The link is carrying dense, efficient data.",
    };
  if (value >= 12)
    return {
      label: "Good",
      score: 70,
      tone: "good",
      summary: "The link has enough quality for solid throughput.",
    };
  if (value >= 6)
    return {
      label: "Low",
      score: 45,
      tone: "watch",
      summary: "The tower is using a cautious data mode.",
    };
  return {
    label: "Very low",
    score: 20,
    tone: "bad",
    summary: "Throughput will probably suffer.",
  };
}

function missingGrade(label: string): Grade {
  return {
    label: "Unknown",
    score: 50,
    tone: "watch",
    summary: `${label} is not available from this snapshot yet.`,
  };
}

function latestOf(history: HistoryPoint[]) {
  return history[history.length - 1];
}

function aggregateBandwidth(stats: RadioStats) {
  return stats.bandwidthMHz.reduce((total, value) => total + value, 0);
}

function bandSummary(stats: RadioStats) {
  const counts = stats.bands.reduce<Record<string, number>>((acc, band) => {
    acc[band] = (acc[band] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([band, count]) => (count > 1 ? `${band} x${count}` : band))
    .join(" + ");
}

function describeBands(stats: RadioStats) {
  const descriptions: Record<string, string> = {
    B20: "Coverage anchor",
    B3: "Coverage plus capacity",
    B7: "High-capacity layer",
    B1: "City capacity",
    B8: "Wide-area coverage",
    B40: "Capacity layer",
    B41: "Capacity layer",
  };

  return Array.from(new Set(stats.bands)).map((band) => ({
    band,
    text: descriptions[band] || "Network layer",
  }));
}

function connectionScores(stats: RadioStats) {
  const strength = scoreRsrp(stats.rsrp);
  const cleanliness = scoreSinr(stats.sinr);
  const quality = scoreRsrq(stats.rsrq);
  const dlMcs = scoreMcs(stats.dlMcs);
  const capacityBonus = clamp(aggregateBandwidth(stats) * 0.9, 0, 80);
  const mimoBonus = stats.rank4g && stats.rank4g >= 2 ? 8 : 0;
  const connection = Math.round(
    clamp(
      strength.score * 0.28 +
        cleanliness.score * 0.32 +
        quality.score * 0.18 +
        dlMcs.score * 0.12 +
        capacityBonus * 0.08 +
        mimoBonus,
    ),
  );
  const callReadiness = Math.round(
    clamp(strength.score * 0.34 + cleanliness.score * 0.38 + quality.score * 0.28),
  );

  return {
    strength,
    cleanliness,
    quality,
    dlMcs,
    connection,
    callReadiness,
  };
}

function diagnosis(stats: RadioStats) {
  const scores = connectionScores(stats);
  const items: Diagnosis[] = [];
  const goodRadio =
    scores.strength.score >= 70 &&
    scores.cleanliness.score >= 65 &&
    scores.quality.score >= 60;

  if ((stats.rsrp ?? 0) < -100) {
    items.push({
      title: "Weak signal",
      body: "Move the router closer to a window, higher up, or toward the serving tower.",
      tone: "bad",
    });
  }

  if (
    (stats.rsrp !== null && stats.rsrp >= -90 && (stats.sinr ?? 99) < 8) ||
    (stats.rsrq ?? 0) < -13
  ) {
    items.push({
      title: "Likely interference",
      body: "Signal strength is not the main problem. The channel looks noisy or heavily shared.",
      tone: "watch",
    });
  }

  if (
    goodRadio &&
    ((stats.dlMcs !== null && stats.dlMcs < 12) ||
      (stats.cqi !== null && stats.cqi < 10) ||
      (stats.bler4g !== null && stats.bler4g > 5))
  ) {
    items.push({
      title: "Possible tower congestion",
      body: "The radio path looks decent, but the network is still choosing cautious data rates.",
      tone: "watch",
    });
  }

  if (goodRadio && stats.routerLatencyMs !== null && stats.routerLatencyMs > 80) {
    items.push({
      title: "Local-link issue",
      body: "The tower side looks fine, but the router answered slowly.",
      tone: "watch",
    });
  }

  if (!items.length) {
    items.push({
      title: "No major fault detected",
      body: "The current snapshot looks healthy. Keep the history running to catch drops or evening congestion.",
      tone: "great",
    });
  }

  return items;
}

function verdict(stats: RadioStats, scores: ReturnType<typeof connectionScores>) {
  if (scores.strength.score < 60) {
    return {
      title: "Move the router first.",
      body: "The strongest signal gain will probably come from placement: higher position, window side, or tower-facing side of the room.",
      tone: "bad" as const,
      label: "Coverage issue",
    };
  }

  if (scores.cleanliness.score < 70 && scores.strength.score >= 75) {
    return {
      title: "Signal is strong. Cleanliness is the limiter.",
      body: "This is the classic case where bars look fine but speeds feel uneven. Rotation, band locking, or another window can improve SINR.",
      tone: "watch" as const,
      label: "Interference likely",
    };
  }

  if (scores.connection >= 82 && stats.dlMcs !== null && stats.dlMcs < 12) {
    return {
      title: "Radio looks fine. Watch for congestion.",
      body: "The link is stable, but the tower may be conservative with data rates. History by time of day will tell the story.",
      tone: "watch" as const,
      label: "Capacity watch",
    };
  }

  return {
    title: "Connection looks usable right now.",
    body: "No obvious radio fault stands out in this snapshot. Keep sampling while you move the router or test at busy hours.",
    tone: "great" as const,
    label: "Healthy snapshot",
  };
}

function actionItems(stats: RadioStats, diagnoses: Diagnosis[]) {
  const has = (title: string) => diagnoses.some((item) => item.title === title);

  if (has("Weak signal")) {
    return [
      "Place the router higher and closer to a window.",
      "Rotate it slowly and watch RSRP for 30 seconds.",
      "Prioritize stronger RSRP before chasing speed tests.",
    ];
  }

  if (has("Likely interference")) {
    return [
      "Rotate the router in small steps and watch SINR.",
      "Test another window or side of the room.",
      "If the router supports it later, compare band combinations.",
    ];
  }

  if (has("Possible tower congestion")) {
    return [
      "Collect readings in the morning, afternoon, and evening.",
      "Compare MCS and CQI when speeds feel slow.",
      "If radio scores stay good while MCS drops, the tower is probably busy.",
    ];
  }

  if (has("Local-link issue")) {
    return [
      "Test one device over Ethernet or beside the router.",
      "Pause heavy downloads on other local devices.",
      "Compare router latency with radio metrics before moving the router.",
    ];
  }

  return [
    `Keep sampling this ${stats.networkType || "connection"} for a few minutes.`,
    "Move the router once, then compare the trend instead of one reading.",
    "Use Advanced mode when a raw value looks suspicious.",
  ];
}

function formatValue(value: number | null, suffix = "") {
  if (value === null) return "Unknown";
  return `${value}${suffix}`;
}

function formatFlow(value: number | null) {
  if (value === null) return "Unknown";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} KB`;
  return `${value} B`;
}

function timeLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toISOString().slice(11, 16);
}

function dateTimeLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return `${date.toISOString().slice(0, 10)} ${timeLabel(iso)} UTC`;
}

function shortTimeLabel(iso: string | null | undefined) {
  if (!iso) return "Not synced yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function syncIntervalLabel() {
  return `${Math.round(AUTO_SYNC_MS / 1000)} seconds`;
}

function formatDuration(value: string | null | undefined) {
  if (!value) return "Unknown";
  const routerMatch = value.match(/^(\d+)-(\d+)-(\d+)-(\d+)$/);
  if (routerMatch) {
    const [, days, hours, minutes] = routerMatch;
    return `${days}d ${hours}h ${minutes}m`;
  }
  return value;
}

function activeAccessLabel(stats: RadioStats) {
  const networkType = stats.networkType || "Unknown";
  if (/5g/i.test(networkType)) return "5G";
  if (/4g\+/i.test(networkType)) return "4G+ LTE-A";
  if (/4g|lte/i.test(networkType)) return "4G LTE";
  if (/3g/i.test(networkType)) return "3G";
  return networkType;
}

function isNrActive(stats: RadioStats) {
  const nr = stats.nr;
  if (!nr) return false;
  return Boolean(
    nr.rsrp !== null ||
      nr.sinr !== null ||
      nr.bands.length ||
      nr.bandwidthMHz.length ||
      /5g/i.test(stats.networkType),
  );
}

function connectedCount(stats: RadioStats) {
  return (
    stats.connectedDeviceCount ??
    stats.wifiClientCount ??
    stats.connectedDevices?.length ??
    null
  );
}

function clientCountLabel(stats: RadioStats) {
  const count = connectedCount(stats);
  if (count === null) return "Not available yet";
  return `${count} router-reported device${count === 1 ? "" : "s"}`;
}

function wifiSummary(stats: RadioStats) {
  const networks = stats.wifiNetworks || [];
  if (!networks.length) return "Not mapped yet";
  return networks.map((network) => `${network.band}: ${network.ssid}`).join(" / ");
}

function emptyHint(label: string) {
  return `${label} will appear once the router provides that part of the page.`;
}

function useLocalHistory() {
  const [history, setHistory] = useState<HistoryPoint[]>(sampleHistory);

  useEffect(() => {
    const saved = localStorage.getItem("broadband-diagnostics-history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as HistoryPoint[];
        if (Array.isArray(parsed) && parsed.length) {
          setHistory(parsed.slice(-80));
        }
      } catch {
        setHistory(sampleHistory);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "broadband-diagnostics-history",
      JSON.stringify(history.slice(-80)),
    );
  }, [history]);

  return [history, setHistory] as const;
}

function ScoreMeter({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  tone: Grade["tone"];
}) {
  return (
    <div
      className={`score-meter tone-${tone}`}
      style={{ "--score": `${value}%` } as CSSProperties}
    >
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="meter-track" aria-hidden="true">
        <span />
      </div>
      <small>{caption}</small>
    </div>
  );
}

function MetricTile({
  label,
  value,
  grade,
  help,
}: {
  label: string;
  value: string;
  grade: Grade;
  help: string;
}) {
  return (
    <article
      className={`metric-tile tone-${grade.tone}`}
      style={{ "--score": `${grade.score}%` } as CSSProperties}
    >
      <div className="metric-topline">
        <span>{label}</span>
        <b>{grade.label}</b>
      </div>
      <strong>{value}</strong>
      <div className="meter-track" aria-hidden="true">
        <span />
      </div>
      <p>{help}</p>
    </article>
  );
}

function StatusCard({
  label,
  value,
  detail,
  tone = "good",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: Grade["tone"];
}) {
  return (
    <article className={`status-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function LinkPath({
  stats,
  clientLabel,
}: {
  stats: RadioStats;
  clientLabel: string;
}) {
  const accessLabel = activeAccessLabel(stats);
  const nrActive = isNrActive(stats);

  return (
    <article className="link-path-card" aria-label="Current connection path">
      <div className="surface-heading">
        <div>
          <span>Live path</span>
          <h2>What you are using now</h2>
        </div>
      </div>
      <div className="link-path">
        <div className="path-node carrier-node">
          <span>Network</span>
          <strong>{stats.operator || "Unknown"}</strong>
          <small>{stats.plmn ? `PLMN ${stats.plmn}` : "SIM network"}</small>
        </div>
        <div className="path-line" />
        <div className="path-node radio-node">
          <span>Cellular</span>
          <strong>{accessLabel}</strong>
          <small>{nrActive ? "NR layer active" : "LTE layer active"}</small>
        </div>
        <div className="path-line" />
        <div className="path-node router-node">
          <span>Router</span>
          <strong>{stats.routerName}</strong>
          <small>{formatDuration(stats.onlineDuration)} online</small>
        </div>
        <div className="path-line" />
        <div className="path-node wifi-node">
          <span>Local network</span>
          <strong>Wi-Fi / LAN</strong>
          <small>{clientLabel}</small>
        </div>
      </div>
    </article>
  );
}

function WifiPanel({ stats }: { stats: RadioStats }) {
  const networks = stats.wifiNetworks || [];

  return (
    <section className="surface-block compact-surface">
      <div className="surface-heading">
        <div>
          <span>Wi-Fi settings</span>
          <h2>Local wireless</h2>
        </div>
      </div>
      {networks.length ? (
        <div className="wifi-list">
          {networks.map((network) => (
            <article key={`${network.band}-${network.ssid}`}>
              <div>
                <strong>{network.ssid}</strong>
                <span>{network.band}</span>
              </div>
              <dl>
                <div>
                  <dt>Channel</dt>
                  <dd>{network.channel || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Security</dt>
                  <dd>{network.security || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Mode</dt>
                  <dd>{network.mode || "Unknown"}</dd>
                </div>
                <div>
                  <dt>Limit</dt>
                  <dd>{network.maxClients ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Clients</dt>
                  <dd>
                    {network.connectedCount === null
                      ? "Unknown"
                      : network.connectedCount}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <div className="mapping-empty">
          <strong>Wi-Fi details not available yet</strong>
          <p>{emptyHint("SSID, channel, security, and Wi-Fi band")}</p>
        </div>
      )}
    </section>
  );
}

function ConnectionStrip({
  stats,
  accessLabel,
  clientLabel,
  wifiText,
  nrActive,
}: {
  stats: RadioStats;
  accessLabel: string;
  clientLabel: string;
  wifiText: string;
  nrActive: boolean;
}) {
  return (
    <section className="quick-status-strip" aria-label="Connection summary">
      <StatusCard
        label="Current connection"
        value={accessLabel}
        detail={`${stats.operator || "Unknown operator"}${
          stats.plmn ? ` · PLMN ${stats.plmn}` : ""
        }`}
        tone={nrActive || /4g/i.test(accessLabel) ? "great" : "watch"}
      />
      <StatusCard
        label="5G state"
        value={nrActive ? "Active" : "Not active"}
        detail={
          nrActive
            ? `${stats.nr?.bands.join(" + ") || "NR layer"} · ${
                stats.nr?.bandwidthMHz.join(" + ") || "unknown"
              } MHz`
            : "This reading is using LTE. 5G fields are empty in the current payload."
        }
        tone={nrActive ? "great" : "watch"}
      />
      <StatusCard
        label="Wi-Fi"
        value={wifiText}
        detail={
          (stats.wifiNetworks || []).length
            ? "SSID, channel, security, and mode are available."
            : "The next live reading will try the router's Wi-Fi pages after login."
        }
        tone={(stats.wifiNetworks || []).length ? "good" : "watch"}
      />
      <StatusCard
        label="Connected devices"
        value={clientLabel}
        detail={
          (stats.connectedDevices || []).length
            ? "Device names and addresses are visible."
            : "The next live reading will try the router's device tables after login."
        }
        tone={connectedCount(stats) === null ? "watch" : "good"}
      />
    </section>
  );
}

function SignalMap({
  stats,
  accessLabel,
  clientLabel,
  carriers,
  spectrumLabel,
  activeBands,
  nrActive,
  scores,
}: {
  stats: RadioStats;
  accessLabel: string;
  clientLabel: string;
  carriers: number;
  spectrumLabel: string;
  activeBands: string;
  nrActive: boolean;
  scores: ReturnType<typeof connectionScores>;
}) {
  const carrierLabel =
    carriers >= 2
      ? `${carriers} channels joined`
      : carriers === 1
        ? "1 channel"
        : "Channel data pending";
  const signalTone =
    scores.cleanliness.score >= 80
      ? "great"
      : scores.cleanliness.score >= 55
        ? "watch"
        : "bad";

  return (
    <section className="signal-map" aria-label="Signal map">
      <div className="surface-heading signal-map-heading">
        <div>
          <span>Live route</span>
          <h2>How your internet is connected</h2>
        </div>
        <b>{carrierLabel}</b>
      </div>

      <div className="signal-map-stage">
        <div className="signal-grid" aria-hidden="true" />
        <div className="signal-beam beam-a" aria-hidden="true" />
        <div className="signal-beam beam-b" aria-hidden="true" />
        <div className="signal-beam beam-c" aria-hidden="true" />

        <article className="signal-node tower-node">
          <span>Provider</span>
          <strong>{stats.operator || "Unknown"}</strong>
          <small>Your SIM is using this network</small>
        </article>

        <article className={`signal-node radio-node tone-${signalTone}`}>
          <span>Mobile link</span>
          <strong>{accessLabel}</strong>
          <small>
            {nrActive
              ? "The router is using a 5G connection"
              : "The router is using a 4G connection"}
          </small>
        </article>

        <article className="signal-node router-map-node">
          <span>Home router</span>
          <strong>{stats.routerName}</strong>
          <small>{formatDuration(stats.onlineDuration)} online</small>
        </article>

        <article className="signal-node device-map-node">
          <span>Your devices</span>
          <strong>{clientLabel}</strong>
          <small>{wifiSummary(stats)}</small>
        </article>

        <div className="signal-chip-grid" aria-label="Live connection snapshot">
          <div>
            <span>Signal clarity</span>
            <strong>{scores.cleanliness.label}</strong>
          </div>
          <div>
            <span>Joined width</span>
            <strong>{spectrumLabel}</strong>
          </div>
          <div>
            <span>Network layers</span>
            <strong>{activeBands}</strong>
          </div>
        </div>

        <div className="quality-stack" aria-label="Connection quality">
          <div style={{ "--score": `${scores.connection}%` } as CSSProperties}>
            <span>Overall</span>
            <b />
          </div>
          <div style={{ "--score": `${scores.callReadiness}%` } as CSSProperties}>
            <span>Calls</span>
            <b />
          </div>
          <div style={{ "--score": `${scores.cleanliness.score}%` } as CSSProperties}>
            <span>Clarity</span>
            <b />
          </div>
        </div>
      </div>
    </section>
  );
}

function ClientsPanel({ stats }: { stats: RadioStats }) {
  const devices = stats.connectedDevices || [];
  const count = connectedCount(stats);

  return (
    <section className="surface-block compact-surface">
      <div className="surface-heading">
        <div>
          <span>Connected devices</span>
          <h2>{count === null ? "Client list" : clientCountLabel(stats)}</h2>
        </div>
      </div>
      {devices.length ? (
        <div className="client-list">
          {devices.slice(0, 8).map((device) => (
            <article key={device.id}>
              <div className="client-avatar">
                {device.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <strong>{device.name}</strong>
                <span>{device.ip || device.mac || "No address shown"}</span>
              </div>
              <small>{device.connection}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="mapping-empty">
          <strong>
            {count === null ? "Device list not available yet" : `${count} router-reported devices`}
          </strong>
          <p>
            {count === null
              ? emptyHint("Device names, IP addresses, MAC addresses, and connection time")
              : "The router exposed a count, but not the full device table in this response."}
          </p>
        </div>
      )}
    </section>
  );
}

function Sparkline({
  label,
  points,
  field,
  suffix,
  invert,
}: {
  label: string;
  points: HistoryPoint[];
  field: keyof Pick<RadioStats, "sinr" | "rsrp" | "dlMcs" | "routerLatencyMs">;
  suffix: string;
  invert?: boolean;
}) {
  const values = points
    .map((point) => point[field])
    .filter((value): value is number => typeof value === "number");

  if (!values.length) {
    return (
      <div className="chart-panel">
        <div className="chart-heading">
          <span>{label}</span>
          <strong>Unknown</strong>
        </div>
        <div className="empty-chart">No readings yet</div>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const path = points
    .map((point, index) => {
      const rawValue = point[field];
      const value = typeof rawValue === "number" ? rawValue : min;
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const normalized = (value - min) / spread;
      const y = invert ? normalized * 64 + 8 : 72 - normalized * 64;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const latest = values[values.length - 1];

  return (
    <div className="chart-panel">
      <div className="chart-heading">
        <span>{label}</span>
        <strong>{latest === undefined ? "Unknown" : `${latest}${suffix}`}</strong>
      </div>
      <svg viewBox="0 0 100 80" role="img" aria-label={`${label} history`}>
        <polyline points={path} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-foot">
        <span>{timeLabel(points[0].capturedAt)}</span>
        <span>{timeLabel(points[points.length - 1].capturedAt)}</span>
      </div>
    </div>
  );
}

function RouterInsights({ stats }: { stats: RadioStats }) {
  const runtime = stats.runtime;
  const network = stats.networkSettings;
  const usage = stats.dataUsage;
  const yesNo = (value: boolean | null | undefined) =>
    value === null || value === undefined ? "Unknown" : value ? "On" : "Off";

  return (
    <section className="router-insights" aria-label="Router insights">
      <div className="section-heading">
        <div>
          <span>Router insights</span>
          <h2>More than signal bars</h2>
        </div>
        <p>Live settings and health reported directly by the router.</p>
      </div>
      <div className="insight-grid">
        <article>
          <span>Router health</span>
          <strong>{runtime?.uptime ? formatDuration(runtime.uptime) : "Loading"}</strong>
          <dl>
            <div><dt>CPU load</dt><dd>{runtime?.cpuLoad || "Unknown"}</dd></div>
            <div><dt>Memory</dt><dd>{runtime?.memory || "Unknown"}</dd></div>
            <div><dt>Firmware</dt><dd>{runtime?.firmware || "Unknown"}</dd></div>
          </dl>
        </article>
        <article>
          <span>Mobile network</span>
          <strong>{network?.mode || activeAccessLabel(stats)}</strong>
          <dl>
            <div><dt>5G mode</dt><dd>{network?.mode5g || "Unknown"}</dd></div>
            <div><dt>LTE aggregation</dt><dd>{yesNo(network?.lteCarrierAggregation)}</dd></div>
            <div><dt>5G aggregation</dt><dd>{yesNo(network?.nrCarrierAggregation)}</dd></div>
            <div><dt>Roaming</dt><dd>{yesNo(network?.roamingEnabled)}</dd></div>
          </dl>
        </article>
        <article>
          <span>Data guard</span>
          <strong>{usage?.limitEnabled ? "Limit enabled" : "No limit set"}</strong>
          <dl>
            <div><dt>Limit</dt><dd>{usage?.limitSize ? `${usage.limitSize} ${usage.unit || ""}` : "Not set"}</dd></div>
            <div><dt>Cycle starts</dt><dd>{usage?.cycleStart || "Unknown"}</dd></div>
            <div><dt>Warning at</dt><dd>{usage?.warningPercentage ? `${usage.warningPercentage}%` : "Not set"}</dd></div>
          </dl>
        </article>
      </div>
    </section>
  );
}

function RawTable({ stats }: { stats: RadioStats }) {
  const rows = [
    ["RSRP", formatValue(stats.rsrp, " dBm")],
    ["RSRQ", formatValue(stats.rsrq, " dB")],
    ["RSSI", formatValue(stats.rssi, " dBm")],
    ["SINR", formatValue(stats.sinr, " dB")],
    ["CQI", formatValue(stats.cqi)],
    ["DL MCS", formatValue(stats.dlMcs)],
    ["UL MCS", formatValue(stats.ulMcs)],
    ["MIMO rank", formatValue(stats.rank4g)],
    ["Connection", activeAccessLabel(stats)],
    ["Operator", stats.operator || "Unknown"],
    ["PLMN", stats.plmn || "Unknown"],
    ["Signal level", formatValue(stats.signalLevel ?? null)],
    ["Bands", stats.bands.join(" + ") || "Unknown"],
    ["Bandwidth", stats.bandwidthMHz.map((item) => `${item} MHz`).join(" + ")],
    ["Max DL QAM", stats.maxDlQam || "Unknown"],
    ["Max UL QAM", stats.maxUlQam || "Unknown"],
    ["5G active", isNrActive(stats) ? "Yes" : "No"],
    ["5G SINR", formatValue(stats.nr?.sinr ?? null, " dB")],
    ["5G RSRP", formatValue(stats.nr?.rsrp ?? null, " dBm")],
    ["Wi-Fi clients", clientCountLabel(stats)],
    ["PCI", stats.pci || "Unknown"],
    ["EARFCN", stats.earfcn.join(" + ") || "Unknown"],
    ["ENODEBID", stats.enodebId || "Unknown"],
    ["CELL_ID", stats.cellId || "Unknown"],
    ["ECGI", stats.ecgi || "Unknown"],
    ["Flow DL", formatFlow(stats.flowDl)],
    ["Flow UL", formatFlow(stats.flowUl)],
    ["BLER", formatValue(stats.bler4g, "%")],
    ["WAN IP", stats.wanIp || "Unknown"],
    ["Online", formatDuration(stats.onlineDuration)],
    ["System time", stats.systemTime || "Unknown"],
  ];

  return (
    <div className="raw-table">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value || "Unknown"}</strong>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [history, setHistory] = useLocalHistory();
  const [advanced, setAdvanced] = useState(true);
  const [hasEnteredDashboard, setHasEnteredDashboard] = useState(false);
  const [baseUrl, setBaseUrl] = useState("192.168.0.1");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [routerSession, setRouterSession] = useState<RouterSessionState | null>(
    null,
  );
  const [autoSync, setAutoSync] = useState(false);
  const [status, setStatus] = useState("Sign in once to start live sync");
  const [isLoading, setIsLoading] = useState(false);
  const syncInFlight = useRef(false);
  const stats = latestOf(history);
  const scores = useMemo(() => connectionScores(stats), [stats]);
  const diagnoses = useMemo(() => diagnosis(stats), [stats]);
  const currentVerdict = useMemo(() => verdict(stats, scores), [stats, scores]);
  const nextActions = useMemo(
    () => actionItems(stats, diagnoses),
    [stats, diagnoses],
  );
  const totalBandwidth = aggregateBandwidth(stats);
  const carriers = stats.bands.length || stats.bandwidthMHz.length;
  const hasLiveData = Object.keys(stats.raw).length > 0;
  const spectrumLabel = totalBandwidth ? `${totalBandwidth} MHz` : "Unknown";
  const accessLabel = activeAccessLabel(stats);
  const nrActive = isNrActive(stats);
  const clientLabel = clientCountLabel(stats);
  const wifiText = wifiSummary(stats);
  const activeBands = bandSummary(stats) || "Unknown";
  const isLoggedIn = routerSession !== null;
  const syncStateLabel = isLoggedIn
    ? autoSync
      ? "Live sync on"
      : "Live sync paused"
    : "Sign in needed";

  useEffect(() => {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as RouterSessionState;
      if (parsed?.baseUrl) {
        setBaseUrl(parsed.baseUrl);
        setUsername(parsed.username || "admin");
        setStatus("Sign in to open your live dashboard.");
      }
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (routerSession) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(routerSession));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [routerSession]);

  const syncRouter = useCallback(
    async ({
      forceLogin = false,
      silent = false,
    }: { forceLogin?: boolean; silent?: boolean } = {}) => {
      if (syncInFlight.current) return;

      const existingSession = forceLogin ? null : routerSession;
      const needsLogin = existingSession === null;
      const nextBaseUrl = (existingSession?.baseUrl || baseUrl).trim();
      const nextUsername = existingSession?.username || username || "admin";

      if (!nextBaseUrl) {
        setStatus("Enter the router address first.");
        return;
      }

      if (needsLogin && !password) {
        setStatus("Enter the router password once to start live sync.");
        return;
      }

      syncInFlight.current = true;
      setIsLoading(true);
      if (!silent) {
        setStatus(
          needsLogin
            ? "Signing in to the router..."
            : "Syncing the latest router data...",
        );
      }

      try {
        const useLocalBridge =
          window.location.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(window.location.hostname);
        const response = await fetch("/api/router/x17u/snapshot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            existingSession
              ? {
                baseUrl: existingSession.baseUrl,
                username: existingSession.username,
                sessionId: existingSession.sessionId,
                useLocalBridge,
                }
              : {
                  baseUrl: nextBaseUrl,
                username: nextUsername,
                password,
                useLocalBridge,
              },
          ),
        });
        const body = (await response.json()) as {
          snapshot?: RadioStats;
          sessionId?: string;
          sessionMode?: "new" | "existing";
          error?: string;
        };

        if (!response.ok || !body.snapshot) {
          throw new Error(body.error || "The router could not be reached.");
        }

        const now = new Date().toISOString();
        const sessionId = body.sessionId || existingSession?.sessionId;

        if (!sessionId) {
          throw new Error("The router synced, but did not return a session.");
        }

        setRouterSession({
          baseUrl: nextBaseUrl,
          username: nextUsername,
          sessionId,
          createdAt: existingSession?.createdAt || now,
          lastSyncAt: now,
        });
        setHistory((items) => [...items, body.snapshot as HistoryPoint].slice(-80));

        if (needsLogin) {
          setPassword("");
          setAutoSync(true);
          setHasEnteredDashboard(true);
          setStatus(`Signed in. Syncing every ${syncIntervalLabel()}.`);
        } else if (!silent) {
          setStatus(`Synced at ${shortTimeLabel(now)}.`);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The router could not be reached.";

        if (existingSession) {
          setRouterSession(null);
          setAutoSync(false);
          setStatus(`${message} Sign in once again to resume live sync.`);
        } else {
          setStatus(message);
        }
      } finally {
        syncInFlight.current = false;
        setIsLoading(false);
      }
    },
    [baseUrl, password, routerSession, setHistory, username],
  );

  useEffect(() => {
    if (!routerSession || !autoSync) return;

    const timer = window.setInterval(() => {
      void syncRouter({ silent: true });
    }, AUTO_SYNC_MS);

    return () => window.clearInterval(timer);
  }, [autoSync, routerSession, syncRouter]);

  async function refreshRouter(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await syncRouter({ forceLogin: !routerSession });
  }

  function stopLiveSync() {
    setRouterSession(null);
    setAutoSync(false);
    setPassword("");
    setHasEnteredDashboard(false);
    setStatus("Live sync stopped. Sign in once to start again.");
  }

  function updateAutoSync(checked: boolean) {
    if (!routerSession) return;
    setAutoSync(checked);
    setStatus(
      checked
        ? `Auto-sync resumed. The app will refresh every ${syncIntervalLabel()}.`
        : "Auto-sync paused. You can still sync manually.",
    );
  }

  function addDemoDip() {
    const last = latestOf(history);
    setHistory((items) =>
      [
        ...items,
        {
          ...last,
          capturedAt: new Date().toISOString(),
          sinr: Math.max(-2, (last.sinr ?? 8) - 7),
          rsrq: Math.min(-15, (last.rsrq ?? -10) - 5),
          dlMcs: Math.max(4, (last.dlMcs ?? 12) - 7),
          routerLatencyMs: (last.routerLatencyMs ?? 20) + 9,
          note: "Demo interference dip",
        },
      ].slice(-80),
    );
    setStatus("Added a demo interference dip");
  }

  function trimHistory() {
    setHistory([latestOf(history)]);
    setStatus("History trimmed to the latest reading");
  }

  if (!hasEnteredDashboard) {
    return (
      <main className="login-page">
        <section className="login-intro">
          <div className="login-brand"><span>BD</span> Broadband Diagnostics</div>
          <p className="eyebrow">Router intelligence, without the guesswork</p>
          <h1>See what your broadband is really doing.</h1>
          <p>
            Sign in directly to your ZLT X17U, then get a live, technical view of
            signal quality, bands, Wi-Fi clients, cell data and router health.
          </p>
          <div className="login-preview" aria-label="Dashboard features">
            <div><b>Live signal</b><span>RSRP · RSRQ · SINR · CQI</span></div>
            <div><b>Network detail</b><span>Bands · cell · carrier aggregation</span></div>
            <div><b>Home network</b><span>Wi-Fi · verified clients · router health</span></div>
          </div>
        </section>

        <section className="signin-panel" aria-label="Connect your router">
          <div className="signin-heading">
            <span>Step 1 of 1</span>
            <h2>Connect your router</h2>
            <p>Your password is used for this router session only and is never saved.</p>
          </div>
          <form onSubmit={refreshRouter} className="router-form">
            <label>
              Router address
              <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="192.168.0.1" autoComplete="url" />
            </label>
            <label>
              Username
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="admin" autoComplete="username" />
            </label>
            <label>
              Router password
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Router password" type="password" autoComplete="current-password" />
            </label>
            <button className="primary-button" disabled={isLoading || !password}>
              {isLoading ? "Connecting securely..." : "Open live dashboard"}
            </button>
          </form>
          <p className="status-line" role="status">{status}</p>
          <p className="signin-footnote">Once connected, the dashboard refreshes every 5 seconds. You can stop it at any time.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-page">
      <aside className="side-rail">
        <div className="brand-block">
          <div className="brand-mark">BD</div>
          <div>
            <strong>Broadband Diagnostics</strong>
            <span>MTN and Airtel broadband diagnostics</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Dashboard sections">
          <a href="#overview">Overview</a>
          <a href="#network">Network</a>
          <a href="#diagnosis">Diagnosis</a>
          <a href="#history">History</a>
          <a href="#adapters">Adapters</a>
        </nav>

        <div className="rail-status">
          <span>Active adapter</span>
          <strong>{x17uAdapter.label}</strong>
          <small>
            {hasLiveData ? "Live data loaded" : "Demo data shown"} · {accessLabel}
          </small>
          <small>{syncStateLabel}</small>
          <small>{clientLabel}</small>
        </div>
      </aside>

      <div className="dashboard-content">
        <header className="topbar product-header">
          <div>
            <span className="eyebrow">Your home internet</span>
            <h1>Broadband health, at a glance</h1>
            <p>
              {accessLabel} on {stats.operator}. {carriers || "Unknown"} carrier
              {carriers === 1 ? "" : "s"} · {spectrumLabel} · {clientLabel}.
            </p>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={advanced ? "mode-button active" : "mode-button"}
              onClick={() => setAdvanced((value) => !value)}
            >
              {advanced ? "Hide technical data" : "Show technical data"}
            </button>
          </div>
        </header>

        <ConnectionStrip
          stats={stats}
          accessLabel={accessLabel}
          clientLabel={clientLabel}
          wifiText={wifiText}
          nrActive={nrActive}
        />

        <section className="overview-grid" id="overview">
          <article className={`verdict-surface tone-${currentVerdict.tone}`}>
            <div className="snapshot-row">
              <span className={`state-dot tone-${currentVerdict.tone}`} />
              <strong>{currentVerdict.label}</strong>
              <span>{dateTimeLabel(stats.capturedAt)}</span>
            </div>
            <h2>{currentVerdict.title}</h2>
            <p>{currentVerdict.body}</p>
            <div className="score-pair">
              <ScoreMeter
                label="Connection"
                value={scores.connection}
                caption={
                  scores.connection >= 80
                    ? "Ready for streaming and work"
                    : scores.connection >= 60
                      ? "Usable, with limits"
                      : "Needs attention"
                }
                tone={
                  scores.connection >= 80
                    ? "great"
                    : scores.connection >= 60
                      ? "watch"
                      : "bad"
                }
              />
              <ScoreMeter
                label="Call readiness"
                value={scores.callReadiness}
                caption={
                  scores.callReadiness >= 80
                    ? "Voice and video should hold"
                    : scores.callReadiness >= 60
                      ? "Acceptable with dips"
                      : "Likely unstable"
                }
                tone={
                  scores.callReadiness >= 80
                    ? "great"
                    : scores.callReadiness >= 60
                      ? "watch"
                      : "bad"
                }
              />
            </div>
          </article>

          <div className="control-stack">
            <SignalMap
              stats={stats}
              accessLabel={accessLabel}
              clientLabel={clientLabel}
              carriers={carriers}
              spectrumLabel={spectrumLabel}
              activeBands={activeBands}
              nrActive={nrActive}
              scores={scores}
            />

            <section className="control-surface" aria-label="Router controls">
              <div className="surface-heading">
                <div>
                  <span>Router sync</span>
                  <h2>Sign in once</h2>
                </div>
                <b>{syncStateLabel}</b>
              </div>
              <form onSubmit={refreshRouter} className="router-form">
                <label>
                  Router address
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="192.168.0.1"
                    disabled={isLoggedIn}
                  />
                </label>
                {routerSession ? (
                  <div className="session-card">
                    <span>Logged in</span>
                    <strong>{routerSession.baseUrl}</strong>
                    <p>
                      No password stored. Last sync:{" "}
                      {shortTimeLabel(routerSession.lastSyncAt)}.
                    </p>
                  </div>
                ) : (
                  <div className="form-row">
                    <label>
                      Username
                      <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="admin"
                      />
                    </label>
                    <label>
                      Password
                      <input
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Router password"
                        type="password"
                      />
                    </label>
                  </div>
                )}
                <button
                  className="primary-button"
                  disabled={isLoading || (!routerSession && !password)}
                >
                  {isLoading
                    ? "Syncing..."
                    : routerSession
                      ? "Sync now"
                      : "Sign in and start sync"}
                </button>
                <div className="sync-controls">
                  <label className="sync-toggle">
                    <input
                      type="checkbox"
                      checked={autoSync}
                      disabled={!routerSession}
                      onChange={(event) => updateAutoSync(event.target.checked)}
                    />
                    <span>Auto-sync</span>
                    <small>
                      {routerSession
                        ? `Every ${syncIntervalLabel()}`
                        : "Starts after sign-in"}
                    </small>
                  </label>
                  {routerSession ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={stopLiveSync}
                    >
                      Sign out
                    </button>
                  ) : null}
                </div>
              </form>
              <p className="status-line">{status}</p>
            </section>
          </div>
        </section>

        <section className="link-summary-grid" id="network">
          <LinkPath stats={stats} clientLabel={clientLabel} />
          <div className="status-grid">
            <StatusCard
              label="Current connection"
              value={accessLabel}
              detail={`${stats.operator || "Unknown operator"}${
                stats.plmn ? ` · PLMN ${stats.plmn}` : ""
              }`}
              tone={nrActive || /4g/i.test(accessLabel) ? "great" : "watch"}
            />
            <StatusCard
              label="5G state"
              value={nrActive ? "Active" : "Not active"}
              detail={
                nrActive
                  ? `${stats.nr?.bands.join(" + ") || "NR layer"} · ${
                      stats.nr?.bandwidthMHz.join(" + ") || "unknown"
                    } MHz`
                  : "This reading is using LTE. 5G fields are empty in the current payload."
              }
              tone={nrActive ? "great" : "watch"}
            />
            <StatusCard
              label="Wi-Fi"
              value={wifiText}
              detail={
                (stats.wifiNetworks || []).length
                  ? "SSID and channel came from the router payload."
                  : "The basic X17U reading does not include SSID/channel yet."
              }
              tone={(stats.wifiNetworks || []).length ? "good" : "watch"}
            />
            <StatusCard
              label="Connected devices"
              value={clientLabel}
              detail={
                (stats.connectedDevices || []).length
                  ? "Device table came from the router payload."
                  : "The next live reading will try the router's device tables."
              }
              tone={connectedCount(stats) === null ? "watch" : "good"}
            />
          </div>
        </section>

        <section className="metrics-grid" aria-label="Core radio metrics">
          <MetricTile
            label="RSRP"
            value={formatValue(stats.rsrp, " dBm")}
            grade={scores.strength}
            help={metricHelp.rsrp}
          />
          <MetricTile
            label="SINR"
            value={formatValue(stats.sinr, " dB")}
            grade={scores.cleanliness}
            help={metricHelp.sinr}
          />
          <MetricTile
            label="RSRQ"
            value={formatValue(stats.rsrq, " dB")}
            grade={scores.quality}
            help={metricHelp.rsrq}
          />
          <MetricTile
            label="DL MCS"
            value={formatValue(stats.dlMcs)}
            grade={scores.dlMcs}
            help={metricHelp.dlMcs}
          />
        </section>

        <section className="local-grid">
          <WifiPanel stats={stats} />
          <ClientsPanel stats={stats} />
        </section>

        <RouterInsights stats={stats} />

        <section className="split-layout" id="diagnosis">
          <section className="surface-block">
            <div className="surface-heading">
              <div>
                <span>Diagnosis</span>
                <h2>Most likely cause</h2>
              </div>
            </div>
            <div className="diagnosis-list">
              {diagnoses.map((item) => (
                <article className={`diagnosis-row tone-${item.tone}`} key={item.title}>
                  <div />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
            <div className="action-box">
              <span>Next moves</span>
              <ol>
                {nextActions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
          </section>

          <section className="surface-block">
            <div className="surface-heading">
              <div>
                <span>Derived metrics</span>
                <h2>Spectrum view</h2>
              </div>
            </div>
            <div className="spectrum-grid">
              <div>
                <span>Total bandwidth</span>
                <strong>{spectrumLabel}</strong>
              </div>
              <div>
                <span>Carriers</span>
                <strong>{carriers || "Unknown"}</strong>
              </div>
              <div>
                <span>Band mix</span>
                <strong>{activeBands}</strong>
              </div>
              <div>
                <span>MIMO rank</span>
                <strong>{formatValue(stats.rank4g)}</strong>
              </div>
              <div>
                <span>Max DL QAM</span>
                <strong>{stats.maxDlQam || "Unknown"}</strong>
              </div>
              <div>
                <span>Max UL QAM</span>
                <strong>{stats.maxUlQam || "Unknown"}</strong>
              </div>
              <div>
                <span>WAN IP</span>
                <strong>{stats.wanIp || "Unknown"}</strong>
              </div>
              <div>
                <span>SIM status</span>
                <strong>{stats.simStatus || "Unknown"}</strong>
              </div>
            </div>
            <div className="band-list">
              {describeBands(stats).map((item) => (
                <div key={item.band}>
                  <strong>{item.band}</strong>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
            <p className="quiet-note">
              {carriers >= 4
                ? "4CA is active. That is more useful than bars alone because it shows the router is combining several spectrum layers."
                : "As more adapters land, this panel will stay the normalized view across MTN and Airtel devices."}
            </p>
          </section>
        </section>

        <section className="surface-block" id="history">
          <div className="surface-heading">
            <div>
              <span>Local history</span>
              <h2>Trends</h2>
            </div>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={addDemoDip}>
                Add demo dip
              </button>
              <button type="button" className="secondary-button" onClick={trimHistory}>
                Trim history
              </button>
            </div>
          </div>
          <div className="history-meta">
            <span>{history.length} saved readings</span>
            <span>Latest: {dateTimeLabel(stats.capturedAt)}</span>
          </div>
          <div className="charts-grid">
            <Sparkline label="SINR" points={history} field="sinr" suffix=" dB" />
            <Sparkline label="RSRP" points={history} field="rsrp" suffix=" dBm" />
            <Sparkline label="DL MCS" points={history} field="dlMcs" suffix="" />
            <Sparkline
              label="Router latency"
              points={history}
              field="routerLatencyMs"
              suffix=" ms"
              invert
            />
          </div>
        </section>

        <section className="surface-block" id="adapters">
          <div className="surface-heading">
            <div>
              <span>Router adapters</span>
              <h2>Platform coverage</h2>
            </div>
          </div>
          <div className="adapter-grid">
            <div className="adapter-card ready">
              <span>Ready</span>
              <strong>{x17uAdapter.label}</strong>
              <p>Token login, temporary session ID, hashed password, then cmd 205 stats.</p>
            </div>
            {plannedAdapters.map((adapter) => (
              <div className="adapter-card" key={adapter.family}>
                <span>Planned</span>
                <strong>{adapter.label}</strong>
                <p>Will reuse the same normalized scoring once its API is mapped.</p>
              </div>
            ))}
          </div>
        </section>

        {advanced ? (
          <section className="surface-block advanced-section">
            <div className="surface-heading">
              <div>
                <span>Advanced mode</span>
                <h2>Raw radio details</h2>
              </div>
            </div>
            <RawTable stats={stats} />
            <details className="raw-json">
              <summary>Router response JSON</summary>
              <pre>{JSON.stringify(stats.raw, null, 2)}</pre>
            </details>
          </section>
        ) : null}
      </div>
    </main>
  );
}
