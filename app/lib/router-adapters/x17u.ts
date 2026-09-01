import { makeX17UTemporarySessionId, sha256 } from "./crypto";
import type { RadioStats, RouterAdapter, RouterCredentials } from "./types";

type X17URaw = Record<string, unknown>;
type RouterPayload = Record<string, string | number>;
type X17UProbeMap = Partial<Record<string, X17URaw | null>>;
type NormalizationExtras = {
  basic?: X17URaw | null;
  legacy?: X17URaw | null;
  probes?: X17UProbeMap;
};

class X17UProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X17UProtocolError";
  }
}

function cleanBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function splitList(value: unknown) {
  if (value === null || value === undefined || value === "") return [];
  return String(value)
    .split(/[+,/| ]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitNumbers(value: unknown) {
  return splitList(value)
    .map((item) => asNumber(item))
    .filter((item): item is number => item !== null);
}

function normalizeBand(value: string) {
  const match = value.match(/(?:band)?(\d+)/i);
  return match ? `B${match[1]}` : value.toUpperCase();
}

function compactResponseShape(raw: X17URaw) {
  const keys = Object.keys(raw).slice(0, 10);
  const success =
    raw.success === undefined ? "" : ` success=${String(raw.success)}`;
  const cmd = raw.cmd === undefined ? "" : ` cmd=${String(raw.cmd)}`;
  const message =
    raw.message || raw.msg || raw.err || raw.error
      ? ` message=${String(raw.message ?? raw.msg ?? raw.err ?? raw.error)}`
      : "";
  return `keys: ${keys.join(", ") || "none"}${success}${cmd}${message}`;
}

function findStringDeep(
  raw: unknown,
  names: string[],
  depth = 0,
): string | null {
  if (!raw || typeof raw !== "object" || depth > 3) return null;
  const record = raw as Record<string, unknown>;
  const wanted = new Set(names.map((name) => name.toLowerCase()));

  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase()) && typeof value === "string" && value) {
      return value;
    }
  }

  for (const value of Object.values(record)) {
    const found = findStringDeep(value, names, depth + 1);
    if (found) return found;
  }

  return null;
}

function findValueDeep(
  raw: unknown,
  names: string[],
  depth = 0,
): unknown {
  if (!raw || typeof raw !== "object" || depth > 3) return undefined;
  const record = raw as Record<string, unknown>;
  const wanted = new Set(names.map((name) => name.toLowerCase()));

  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase()) && value !== "") {
      return value;
    }
  }

  for (const value of Object.values(record)) {
    const found = findValueDeep(value, names, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

function findArrayDeep(
  raw: unknown,
  names: string[],
  depth = 0,
): unknown[] | null {
  if (!raw || typeof raw !== "object" || depth > 3) return null;
  const record = raw as Record<string, unknown>;
  const wanted = new Set(names.map((name) => name.toLowerCase()));

  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(key.toLowerCase()) && Array.isArray(value)) {
      return value;
    }
  }

  for (const value of Object.values(record)) {
    const found = findArrayDeep(value, names, depth + 1);
    if (found) return found;
  }

  return null;
}

function pickValue(sources: unknown[], names: string[]) {
  for (const source of sources) {
    const value = findValueDeep(source, names);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickString(sources: unknown[], names: string[]) {
  const value = pickValue(sources, names);
  if (value === undefined) return null;
  return String(value);
}

function pickNumber(sources: unknown[], names: string[]) {
  return asNumber(pickValue(sources, names));
}

function findToken(raw: X17URaw) {
  return findStringDeep(raw, [
    "token",
    "Token",
    "loginToken",
    "login_token",
    "rand",
    "nonce",
  ]);
}

function findSessionId(raw: X17URaw, fallback: string) {
  return (
    findStringDeep(raw, [
      "sessionId",
      "sessionid",
      "SessionId",
      "session_id",
      "session-id",
      "sid",
    ]) || fallback
  );
}

function rootIsNull(raw: X17URaw) {
  return String(raw.message ?? raw.msg ?? "")
    .toLowerCase()
    .includes("root is null");
}

async function postRouterOnce(
  baseUrl: string,
  body: BodyInit,
  contentType: string,
  signal?: AbortSignal,
) {
  const started = performance.now();
  const response = await fetch(`${cleanBaseUrl(baseUrl)}/cgi-bin/http.cgi`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": contentType,
      "x-requested-with": "XMLHttpRequest",
    },
    body,
    cache: "no-store",
    signal,
  });
  const latencyMs = Math.round(performance.now() - started);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Router replied with HTTP ${response.status}.`);
  }

  try {
    return { raw: JSON.parse(text) as X17URaw, latencyMs };
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 90);
    throw new Error(
      `Router returned a response the app could not read. It began: ${preview}`,
    );
  }
}

async function postRouter(
  baseUrl: string,
  payload: RouterPayload,
  signal?: AbortSignal,
) {
  const jsonResponse = await postRouterOnce(
    baseUrl,
    JSON.stringify(payload),
    "application/json;charset=UTF-8",
    signal,
  );

  if (!rootIsNull(jsonResponse.raw)) {
    return jsonResponse;
  }

  const formPayload = new URLSearchParams(
    Object.entries(payload).map(([key, value]) => [key, String(value)]),
  );
  return postRouterOnce(
    baseUrl,
    formPayload,
    "application/x-www-form-urlencoded;charset=UTF-8",
    signal,
  );
}

async function readOptionalHttpCommand(baseUrl: string, payload: RouterPayload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_500);

  try {
    return await postRouter(baseUrl, payload, controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readOptionalJsonUrl(baseUrl: string, path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_500);

  try {
    const response = await fetch(`${cleanBaseUrl(baseUrl)}${path}`, {
      headers: { accept: "application/json, text/plain, */*" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as X17URaw;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readLegacyZltSnapshot(baseUrl: string) {
  const [systemStatus, stations, signal] = await Promise.all([
    readOptionalJsonUrl(
      baseUrl,
      "/goform/goform_get_cmd_process?isTest=false&cmd=system_status",
    ),
    readOptionalJsonUrl(
      baseUrl,
      "/goform/goform_get_cmd_process?isTest=false&cmd=station_list",
    ),
    readOptionalJsonUrl(
      baseUrl,
      "/goform/goform_get_cmd_process?multi_data=1&isTest=false&cmd=web_signal%2Csta_count",
    ),
  ]);

  if (!systemStatus && !stations && !signal) return null;
  return {
    system_status: systemStatus,
    station_list_response: stations,
    web_signal_response: signal,
  };
}

async function readAuthenticatedX17UDetails(baseUrl: string, sessionId: string) {
  const probes: Record<string, RouterPayload> = {
    systemStatus: { cmd: 113, method: "GET", sessionId },
    ipInfo: { cmd: 133, method: "GET", sessionId },
    dhcpInfo: { cmd: 208, method: "GET", sessionId },
    equipment: { cmd: 104, method: "GET", sessionId },
    homeInfo: { cmd: 402, method: "GET", sessionId },
    wifi24: { cmd: 2, method: "GET", subcmd: 0, sessionId },
    wifi5: { cmd: 211, method: "GET", subcmd: 0, sessionId },
    wifi24Setup: { cmd: 230, method: "GET", subcmd: 0, sessionId },
    wifi5Setup: { cmd: 231, method: "GET", subcmd: 0, sessionId },
    wifi24Clients: { cmd: 224, method: "GET", sessionId },
    wifi5Clients: { cmd: 225, method: "GET", sessionId },
  };

  const entries = await Promise.all(
    Object.entries(probes).map(async ([name, payload]) => {
      const response = await readOptionalHttpCommand(baseUrl, payload);
      return [name, response?.raw ?? null] as const;
    }),
  );

  return Object.fromEntries(entries) as X17UProbeMap;
}

async function readX17USnapshotWithSession(baseUrl: string, sessionId: string) {
  const [basicResponse, legacyResponse, statsResponse, probes] = await Promise.all([
    readOptionalHttpCommand(baseUrl, {
      cmd: 80,
      method: "GET",
      sessionId: "",
    }),
    readLegacyZltSnapshot(baseUrl),
    postRouter(baseUrl, {
      cmd: 205,
      method: "GET",
      sessionId,
    }),
    readAuthenticatedX17UDetails(baseUrl, sessionId),
  ]);

  if (statsResponse.raw.success === false) {
    throw new Error(
      `The router session was refused. Please sign in again. Router response ${compactResponseShape(
        statsResponse.raw,
      )}.`,
    );
  }

  return normalizeStats(statsResponse.raw, statsResponse.latencyMs, {
    basic: basicResponse?.raw,
    legacy: legacyResponse,
    probes,
  });
}

async function readLoginToken(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const attempts = [
      {
        cmd: 232,
        method: "GET",
        sessionId: "",
      },
      {
        sessionId: "",
        method: "GET",
        cmd: 232,
      },
    ];

    let lastRaw: X17URaw | null = null;
    for (const body of attempts) {
      const response = await postRouter(baseUrl, body, controller.signal);
      lastRaw = response.raw;
      const token = findToken(response.raw);
      if (token) return token;
    }

    throw new X17UProtocolError(
      `The device answered, but not with the X17U login token. Check that the router address is the X17U admin address. Router response ${compactResponseShape(
        lastRaw || {},
      )}.`,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The router did not answer the login-token request in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readField(record: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const entry = Object.entries(record).find(
      ([key, value]) => key.toLowerCase() === name.toLowerCase() && value !== "",
    );
    if (entry) return entry[1];
  }
  return undefined;
}

function hasDeviceShape(record: Record<string, unknown>) {
  const keys = Object.keys(record).map((key) => key.toLowerCase());
  const hasAddress = keys.some((key) =>
    [
      "ip",
      "ip_addr",
      "ipaddress",
      "ipv4",
      "mac",
      "mac_addr",
      "macaddress",
    ].includes(key),
  );
  const hasIdentity = keys.some((key) =>
    [
      "hostname",
      "host_name",
      "name",
      "device_name",
      "client_name",
      "mac",
      "mac_addr",
      "macaddress",
    ].includes(key),
  );
  return hasAddress && hasIdentity;
}

function collectDeviceRecords(raw: unknown, depth = 0): Record<string, unknown>[] {
  if (!raw || typeof raw !== "object" || depth > 4) return [];

  if (Array.isArray(raw)) {
    return raw.flatMap((item) => collectDeviceRecords(item, depth + 1));
  }

  const record = raw as Record<string, unknown>;
  const ownRecord = hasDeviceShape(record) ? [record] : [];
  return [
    ...ownRecord,
    ...Object.values(record).flatMap((value) => collectDeviceRecords(value, depth + 1)),
  ];
}

function parseConnectedDevices(sources: unknown[]) {
  const arrays = sources
    .map((source) =>
      findArrayDeep(source, [
        "station_list",
        "connectedDevices",
        "connected_devices",
        "client_list",
        "clientList",
        "wifi_clients",
        "wlan_clients",
        "lan_clients",
        "equipment_list",
        "equipmentList",
        "terminal_list",
        "terminalList",
        "dhcp_clients",
        "dhcpClientList",
        "online_clients",
        "connected_list",
        "connectedList",
        "host_list",
        "device_list",
      ]),
    )
    .filter((items): items is unknown[] => Array.isArray(items));

  const records = [
    ...arrays.flat(),
    ...sources.flatMap((source) => collectDeviceRecords(source)),
  ];
  const seen = new Set<string>();

  return records
    .flat()
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((device, index) => {
      const name =
        readField(device, [
          "hostname",
          "host_name",
          "name",
          "device_name",
          "client_name",
        ]) ||
        "Unknown device";
      const ip = readField(device, ["ip_addr", "ip", "ipAddress", "ipv4"]);
      const mac = readField(device, ["mac_addr", "mac", "macAddress"]);
      const connection =
        readField(device, ["connection", "connect_type", "interface", "type"]) ||
        "Wi-Fi/LAN";
      const band = readField(device, ["band", "wifi_band", "ssid"]);
      const connectedFor = readField(device, [
        "connect_time",
        "connected_time",
        "online_time",
        "uptime",
      ]);
      const signal = asNumber(readField(device, ["signal", "rssi", "strength"]));

      return {
        id: String(mac || ip || `${name}-${index}`),
        name: String(name),
        ip: ip ? String(ip) : null,
        mac: mac ? String(mac) : null,
        connection: String(connection),
        band: band ? String(band) : null,
        connectedFor: connectedFor ? String(connectedFor) : null,
        signal,
      };
    })
    .filter((device) => {
      if (seen.has(device.id)) return false;
      seen.add(device.id);
      return true;
    });
}

function enabledFrom(value: string | null) {
  if (value === null) return null;
  return !["0", "false", "disabled", "off", "close", "closed"].includes(
    value.toLowerCase(),
  );
}

function wifiNetworkFrom(
  sources: unknown[],
  band: string,
  connectedCount: number | null,
  names: {
    ssid: string[];
    channel: string[];
    security: string[];
    enabled: string[];
    mode: string[];
    maxClients: string[];
  },
) {
  const ssid = pickString(sources, names.ssid);
  const channel = pickString(sources, names.channel);
  const security = pickString(sources, names.security);
  const enabled = pickString(sources, names.enabled);
  const mode = pickString(sources, names.mode);
  const maxClients = pickNumber(sources, names.maxClients);

  if (!ssid && !channel && !security && !mode && maxClients === null) return null;

  return {
    ssid: ssid || "Hidden network",
    band,
    channel,
    security,
    enabled: enabledFrom(enabled),
    mode,
    maxClients,
    connectedCount,
  };
}

function parseWifiNetworks(
  sources: unknown[],
  connectedCount: number | null,
  probes: X17UProbeMap = {},
) {
  const wifi24Sources = [probes.wifi24, probes.wifi24Setup].filter(Boolean);
  const wifi5Sources = [probes.wifi5, probes.wifi5Setup].filter(Boolean);

  const networks = [
    wifiNetworkFrom(
      wifi24Sources.length ? wifi24Sources : sources,
      "2.4 GHz",
      pickNumber([probes.wifi24Clients], [
        "sta_count",
        "station_count",
        "client_count",
        "wifi_user_num",
        "wifi_num",
        "wifi24Num",
        "wifi_24_num",
        "wifi_2g_num",
      ]) ?? connectedCount,
      {
        ssid: [
          "wifi_2g_ssid",
          "ssid_2g",
          "ssid1",
          "SSID1",
          "SSID",
          "ssid",
          "wifi_ssid",
          "m_ssid",
          "ap_ssid",
          "ssid_name",
        ],
        channel: ["wifi_2g_channel", "channel_2g", "channel1", "channel"],
        security: [
          "wifi_2g_security",
          "security_2g",
          "AuthMode1",
          "AuthMode",
          "auth_mode",
          "authentication",
          "security",
          "security_mode",
          "encryption",
        ],
        enabled: [
          "wifi_2g_enable",
          "wifi2_enable",
          "wifi_2g_enabled",
          "wifi_enable",
          "enabled",
          "enable",
          "APenable",
        ],
        mode: ["wifi_2g_mode", "mode_2g", "wifi_mode", "wireless_mode"],
        maxClients: ["max_station", "maxStation", "MaxStaNum", "station_max"],
      },
    ),
    wifiNetworkFrom(
      wifi5Sources.length ? wifi5Sources : sources,
      "5 GHz",
      pickNumber([probes.wifi5Clients], [
        "sta_count",
        "station_count",
        "client_count",
        "wifi_user_num",
        "wifi_num",
        "wifi5Num",
        "wifi_5_num",
        "wifi_5g_num",
      ]) ?? connectedCount,
      {
        ssid: [
          "wifi_5g_ssid",
          "ssid_5g",
          "ssid5",
          "SSID5",
          "SSID",
          "ssid",
          "wifi_ssid",
          "m_ssid",
          "ap_ssid",
          "ssid_name",
        ],
        channel: ["wifi_5g_channel", "channel_5g", "channel5", "channel"],
        security: [
          "wifi_5g_security",
          "security_5g",
          "AuthMode5",
          "AuthMode",
          "auth_mode",
          "authentication",
          "security",
          "security_mode",
          "encryption",
        ],
        enabled: [
          "wifi_5g_enable",
          "wifi5_enable",
          "wifi_5g_enabled",
          "wifi_enable",
          "enabled",
          "enable",
          "APenable",
        ],
        mode: ["wifi_5g_mode", "mode_5g", "wifi_mode", "wireless_mode"],
        maxClients: ["max_station", "maxStation", "MaxStaNum", "station_max"],
      },
    ),
  ].filter((network): network is NonNullable<typeof network> => network !== null);

  const genericSsid = pickString(sources, [
    "ssid",
    "SSID",
    "wifi_ssid",
    "m_ssid",
    "ap_ssid",
  ]);

  if (!networks.length && genericSsid) {
    networks.push({
      ssid: genericSsid,
      band: "Wi-Fi",
      channel: pickString(sources, ["channel", "wifi_channel"]),
      security: pickString(sources, ["security", "wifi_security", "AuthMode"]),
      enabled: enabledFrom(pickString(sources, ["wifi_enable", "wifi_enabled"])),
      mode: pickString(sources, ["wifi_mode", "wireless_mode"]),
      maxClients: pickNumber(sources, ["max_station", "maxStation"]),
      connectedCount,
    });
  }

  return networks;
}

function normalizeStats(
  raw: X17URaw,
  routerLatencyMs: number | null,
  extras: NormalizationExtras = {},
): RadioStats {
  const probes = extras.probes || {};
  const probeSources = Object.values(probes).filter(Boolean);
  const sources: unknown[] = [raw, extras.basic, extras.legacy, ...probeSources].filter(
    Boolean,
  );
  const bands = splitList(raw.currentband ?? raw.band ?? raw.bands).map(normalizeBand);
  const bandwidthMHz = splitNumbers(raw.bandwidth ?? raw.band_width ?? raw.bw);
  const earfcn = splitList(raw.FREQ ?? raw.freq ?? raw.earfcn);
  const connectedDevices = parseConnectedDevices(sources);
  const wifi24Count = pickNumber([probes.wifi24Clients], [
    "sta_count",
    "station_count",
    "client_count",
    "wifi_user_num",
    "wifi_num",
    "wifi24Num",
    "wifi_24_num",
    "wifi_2g_num",
  ]);
  const wifi5Count = pickNumber([probes.wifi5Clients], [
    "sta_count",
    "station_count",
    "client_count",
    "wifi_user_num",
    "wifi_num",
    "wifi5Num",
    "wifi_5_num",
    "wifi_5g_num",
  ]);
  const summedWifiCount =
    wifi24Count !== null || wifi5Count !== null
      ? (wifi24Count ?? 0) + (wifi5Count ?? 0)
      : null;
  const connectedDeviceCount =
    pickNumber(sources, [
      "sta_count",
      "station_count",
      "client_count",
      "wifi_user_num",
      "online_device_num",
      "online_num",
    ]) ?? summedWifiCount ?? (connectedDevices.length ? connectedDevices.length : null);
  const wifiNetworks = parseWifiNetworks(sources, connectedDeviceCount, probes);
  const basicDeviceModel = pickString(sources, [
    "board_type",
    "device_model",
    "model",
    "product_model",
  ]);

  return {
    capturedAt: new Date().toISOString(),
    routerFamily: "zlt-x17u",
    routerName: basicDeviceModel || "ZLT X17U",
    deviceModel: basicDeviceModel,
    networkType: String(
      raw.network_type_str ??
        pickValue(sources, ["network_type", "networkType"]) ??
        "Unknown",
    ),
    operator: String(raw.network_operator ?? raw.operator ?? "Unknown operator"),
    plmn: pickString(sources, ["PLMN", "plmn"]),
    simStatus: pickString(sources, ["sim_status", "simStatus"]),
    serviceStatus: pickString(sources, ["service_status", "serviceStatus"]),
    wanIp: pickString(sources, ["wan_ip", "wanIp", "ip_wan"]),
    signalLevel: pickNumber(sources, ["signal_lvl", "web_signal", "signal_level"]),
    rsrp: asNumber(raw.RSRP ?? raw.rsrp),
    rsrq: asNumber(raw.RSRQ ?? raw.rsrq),
    rssi: asNumber(raw.RSSI ?? raw.rssi),
    sinr: asNumber(raw.SINR ?? raw.sinr),
    cqi: asNumber(raw.CQI ?? raw.cqi),
    dlMcs: asNumber(raw.dl_mcs ?? raw.DL_MCS),
    ulMcs: asNumber(raw.ul_mcs ?? raw.UL_MCS),
    rank4g: asNumber(raw.rank_4g ?? raw.rank4g),
    bands,
    bandwidthMHz,
    pci: raw.PCI || raw.pci ? String(raw.PCI ?? raw.pci) : null,
    earfcn,
    enodebId:
      raw.ENODEBID || raw.enodebid ? String(raw.ENODEBID ?? raw.enodebid) : null,
    cellId: raw.CELL_ID || raw.cell_id ? String(raw.CELL_ID ?? raw.cell_id) : null,
    ecgi: raw.ECGI || raw.ecgi ? String(raw.ECGI ?? raw.ecgi) : null,
    flowDl: asNumber(raw.flow_dl),
    flowUl: asNumber(raw.flow_ul),
    bler4g: asNumber(raw.bler_4g),
    maxDlQam: pickString(sources, ["max_dl_qam"]),
    maxUlQam: pickString(sources, ["max_ul_qam"]),
    nr: {
      rsrp: asNumber(raw.RSRP_5G),
      rsrq: asNumber(raw.RSRQ_5G),
      rssi: asNumber(raw.RSSI_5G),
      sinr: asNumber(raw.SINR_5G),
      cqi: asNumber(raw.CQI_5G),
      dlMcs: asNumber(raw.dl_mcs_5g),
      ulMcs: asNumber(raw.ul_mcs_5g),
      bands: splitList(raw.currentband_5g).map(normalizeBand),
      bandwidthMHz: splitNumbers(raw.bandwidth_5g),
      pci: raw.PCI_5G ? String(raw.PCI_5G) : null,
      earfcn: splitList(raw.FREQ_5G),
      rank: asNumber(raw.rank_5g),
      maxDlQam: pickString(sources, ["max_dl_qam_5g"]),
      maxUlQam: pickString(sources, ["max_ul_qam_5g"]),
      cellId: raw.CELL_ID_5G ? String(raw.CELL_ID_5G) : null,
    },
    wifiNetworks,
    connectedDevices,
    connectedDeviceCount,
    wifiClientCount: connectedDeviceCount,
    onlineTime: pickString(sources, ["onlineTime", "online_time"]),
    onlineDuration: raw.onlineDuration
      ? String(raw.onlineDuration)
      : raw.online_duration
        ? String(raw.online_duration)
        : null,
    systemTime: pickString(sources, ["systime", "system_time", "sys_time"]),
    dialTime: pickNumber(sources, ["dial_time"]),
    currentWanPriority: pickString(sources, ["current_real_wan_prio", "wan_priority"]),
    routerLatencyMs,
    raw: {
      status: raw,
      basic: extras.basic || null,
      legacy: extras.legacy || null,
      probes,
    },
  };
}

export const x17uAdapter: RouterAdapter = {
  family: "zlt-x17u",
  label: "ZLT X17U",
  status: "ready",

  async login(credentials: RouterCredentials) {
    const token = await readLoginToken(credentials.baseUrl);
    const temporarySessionId = makeX17UTemporarySessionId();
    const passwd = await sha256(token + credentials.password);
    const loginResponse = await postRouter(
      credentials.baseUrl,
      {
        sessionId: temporarySessionId,
        username: credentials.username || "admin",
        passwd,
        isAutoUpgrade: "1",
        method: "POST",
        cmd: 100,
        isCheckPasswd: "1",
      },
    );

    if (loginResponse.raw.success === false) {
      throw new Error(
        `The router rejected the password. Router response ${compactResponseShape(
          loginResponse.raw,
        )}.`,
      );
    }

    return { sessionId: findSessionId(loginResponse.raw, temporarySessionId) };
  },

  async readStats(sessionId: string, baseUrl: string) {
    return readX17USnapshotWithSession(baseUrl, sessionId);
  },

  async snapshot(credentials: RouterCredentials) {
    const { sessionId } = await this.login(credentials);
    return readX17USnapshotWithSession(credentials.baseUrl, sessionId);
  },
};

export const plannedAdapters = [
  { family: "zlt-x25", label: "ZLT X25", status: "planned" },
  { family: "zlt-x17", label: "ZLT X17", status: "planned" },
  { family: "zlt-x17m", label: "ZLT X17M", status: "planned" },
  { family: "mtn-mifi", label: "MTN MiFi", status: "planned" },
  { family: "airtel-router", label: "Airtel routers", status: "planned" },
] as const;
