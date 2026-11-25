import { net } from 'electron';
import type { TrackerFetchResult, TrackerPlaylistStat } from '../shared/model';

export interface TrackerRequest {
  platform: string;
  username: string;
  apiKey: string;
  baseUrl: string;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Parse a tracker.gg Rocket League profile response (v2 "segments" format). */
export function parseTrackerProfile(json: any): TrackerPlaylistStat[] | null {
  const segments: any[] = json?.data?.segments;
  if (!Array.isArray(segments)) return null;
  const playlists: TrackerPlaylistStat[] = [];
  for (const seg of segments) {
    if (seg?.type !== 'playlist') continue;
    const stats = seg.stats ?? {};
    const matches = num(stats.matchesPlayed?.value);
    if (matches === undefined) continue;
    playlists.push({
      name: String(seg.metadata?.name ?? seg.attributes?.playlistId ?? 'Unknown'),
      matchesPlayed: matches,
      rating: num(stats.rating?.value),
      tier: stats.tier?.metadata?.name,
      division: stats.division?.metadata?.name,
    });
  }
  return playlists;
}

export function parseTrackerOverview(json: any): Record<string, number> {
  const out: Record<string, number> = {};
  const seg = (json?.data?.segments ?? []).find((s: any) => s?.type === 'overview');
  for (const [key, stat] of Object.entries<any>(seg?.stats ?? {})) {
    const v = num(stat?.value);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export async function fetchTrackerProfile(req: TrackerRequest): Promise<TrackerFetchResult> {
  if (!req.apiKey.trim()) return { ok: false, error: 'No API key set for this account.' };
  if (!req.username.trim()) return { ok: false, error: 'No username / ID set for this account.' };
  const base = req.baseUrl.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+/i.test(base)) return { ok: false, error: 'The tracker API base URL must start with https://' };
  const url = `${base}/rocket-league/standard/profile/${encodeURIComponent(req.platform)}/${encodeURIComponent(req.username.trim())}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await net.fetch(url, {
      headers: { 'TRN-Api-Key': req.apiKey.trim(), Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const apiMsg = json?.errors?.[0]?.message ?? json?.message;
      const reason =
        res.status === 401
          ? 'tracker.gg rejected the API key (401).'
          : res.status === 403
            ? 'tracker.gg denied access (403). Your API key may not include Rocket League.'
            : res.status === 404
              ? 'Player not found on tracker.gg (404). Check the platform and username.'
              : res.status === 429
                ? 'Rate limited by tracker.gg (429). Try a longer sync interval.'
                : `tracker.gg returned HTTP ${res.status}.`;
      return { ok: false, status: res.status, error: apiMsg ? `${reason} ${apiMsg}` : reason };
    }
    if (!json) return { ok: false, status: res.status, error: 'tracker.gg returned a web page instead of data.' };
    const playlists = parseTrackerProfile(json);
    if (!playlists) return { ok: false, status: res.status, error: 'Unexpected response format from tracker.gg.' };
    return {
      ok: true,
      snapshot: { at: new Date().toISOString(), playlists, overview: parseTrackerOverview(json) },
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'tracker.gg did not respond (timeout).' : `Network error: ${err?.message ?? err}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
