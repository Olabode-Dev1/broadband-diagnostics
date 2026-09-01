export type RouterFamily =
  | "zlt-x17u"
  | "zlt-x25"
  | "zlt-x17"
  | "zlt-x17m"
  | "mtn-mifi"
  | "airtel-router";

export type RadioStats = {
  capturedAt: string;
  routerFamily: RouterFamily;
  routerName: string;
  deviceModel?: string | null;
  networkType: string;
  operator: string;
  plmn?: string | null;
  simStatus?: string | null;
  serviceStatus?: string | null;
  wanIp?: string | null;
  signalLevel?: number | null;
  rsrp: number | null;
  rsrq: number | null;
  rssi: number | null;
  sinr: number | null;
  cqi: number | null;
  dlMcs: number | null;
  ulMcs: number | null;
  rank4g: number | null;
  bands: string[];
  bandwidthMHz: number[];
  pci: string | null;
  earfcn: string[];
  enodebId: string | null;
  cellId: string | null;
  ecgi: string | null;
  flowDl: number | null;
  flowUl: number | null;
  bler4g: number | null;
  maxDlQam?: string | null;
  maxUlQam?: string | null;
  nr?: {
    rsrp: number | null;
    rsrq: number | null;
    rssi: number | null;
    sinr: number | null;
    cqi: number | null;
    dlMcs: number | null;
    ulMcs: number | null;
    bands: string[];
    bandwidthMHz: number[];
    pci: string | null;
    earfcn: string[];
    rank: number | null;
    maxDlQam: string | null;
    maxUlQam: string | null;
    cellId: string | null;
  };
  wifiNetworks?: Array<{
    ssid: string;
    band: string;
    channel: string | null;
    security: string | null;
    enabled: boolean | null;
    mode?: string | null;
    maxClients?: number | null;
    connectedCount: number | null;
  }>;
  connectedDevices?: Array<{
    id: string;
    name: string;
    ip: string | null;
    mac: string | null;
    connection: string;
    band: string | null;
    connectedFor: string | null;
    signal: number | null;
  }>;
  connectedDeviceCount?: number | null;
  wifiClientCount?: number | null;
  onlineTime?: string | null;
  onlineDuration: string | null;
  systemTime?: string | null;
  dialTime?: number | null;
  currentWanPriority?: string | null;
  routerLatencyMs: number | null;
  raw: Record<string, unknown>;
};

export type RouterCredentials = {
  baseUrl: string;
  username?: string;
  password: string;
};

export type RouterAdapter = {
  family: RouterFamily;
  label: string;
  status: "ready" | "planned";
  login(credentials: RouterCredentials): Promise<{ sessionId: string }>;
  readStats(sessionId: string, baseUrl: string): Promise<RadioStats>;
  snapshot(credentials: RouterCredentials): Promise<RadioStats>;
};
