import type {
  HackatimeStats,
  HackatimeProjectStat,
} from "../src/types/network.ts";

const BASE = "https://hackatime.hackclub.com".replace(/\/$/, "");

const PROJECTS_PATH = "/api/v1/authenticated/projects";

const TTL_MS = 60_000;
interface CacheEntry {
  at: number;
  stats: HackatimeStats;
}
const cache = new Map<string, CacheEntry>();

interface HtProject {
  name?: string;
  total_seconds?: number;
  text?: string;
}
interface HtProjectsResponse {
  projects?: HtProject[];
  data?: { projects?: HtProject[] };
}

const DISCONNECTED: HackatimeStats = {
  connected: false,
  totalSeconds: 0,
  humanReadableTotal: "",
  projects: [],
};

function humanize(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
  if (m > 0) return `${m} min`;
  return seconds > 0 ? `${Math.round(seconds)} sec` : "0 min";
}

export async function fetchHackatimeStats(
  token: string | null,
): Promise<HackatimeStats> {
  if (!token) return DISCONNECTED;

  const cached = cache.get(token);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.stats;

  let stats: HackatimeStats;
  try {
    const url = `${BASE}${PROJECTS_PATH}?include_archived=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      stats = { ...DISCONNECTED, connected: false, error: "invalid_key" };
    } else if (!res.ok) {
      stats = { ...DISCONNECTED, error: `http_${res.status}` };
    } else {
      const body = (await res.json()) as HtProjectsResponse;
      const raw = body.projects ?? body.data?.projects ?? [];
      const projects: HackatimeProjectStat[] = raw
        .filter(
          (p): p is HtProject & { name: string } => typeof p.name === "string",
        )
        .map((p) => ({
          name: p.name,
          seconds: Math.max(0, Math.round(p.total_seconds ?? 0)),
          text: p.text ?? humanize(p.total_seconds ?? 0),
        }));
      const totalSeconds = projects.reduce((sum, p) => sum + p.seconds, 0);
      stats = {
        connected: true,
        totalSeconds,
        humanReadableTotal: humanize(totalSeconds),
        projects,
      };
    }
  } catch (e) {
    console.error("[hackatime] fetch failed:", (e as Error)?.message ?? e);
    stats = { ...DISCONNECTED, error: "fetch_failed" };
  }

  if (stats.connected) cache.set(token, { at: Date.now(), stats });
  return stats;
}

export function invalidateHackatime(token: string | null) {
  if (token) cache.delete(token);
}

export function secondsByProject(stats: HackatimeStats): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of stats.projects) m.set(p.name, p.seconds);
  return m;
}
