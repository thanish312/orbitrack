const API_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export interface CelestrakOmm {
  ARG_OF_PERICENTER?: number;
  BSTAR?: number;
  CLASSIFICATION_TYPE?: string;
  ECCENTRICITY: number;
  ELEMENT_SET_NO?: number;
  EPOCH: string;
  EPHEMERIS_TYPE?: number;
  INCLINATION: number;
  MEAN_ANOMALY: number;
  MEAN_MOTION: number;
  MEAN_MOTION_DDOT?: number;
  MEAN_MOTION_DOT?: number;
  NORAD_CAT_ID: number;
  OBJECT_ID?: string;
  OBJECT_NAME?: string;
  RA_OF_ASC_NODE: number;
  REV_AT_EPOCH?: number;
}

interface CacheEntry {
  savedAt: number;
  payload: CelestrakOmm[];
}

interface TextCacheEntry {
  savedAt: number;
  payload: string;
}

export interface SatelliteGroup {
  label: string;
  queryType: 'GROUP' | 'SPECIAL';
  value: string;
  caution?: string;
}

export interface SatellitePreset {
  label: string;
  catalogNumber: number;
  groupHint?: string;
}

export const SATELLITE_GROUPS: SatelliteGroup[] = [
  { label: 'Last 30 Days Launches', queryType: 'GROUP', value: 'last-30-days' },
  { label: 'Space Stations', queryType: 'GROUP', value: 'stations' },
  { label: 'Brightest / Visual', queryType: 'GROUP', value: 'visual' },
  { label: 'Active Satellites', queryType: 'GROUP', value: 'active', caution: 'Large download. CelesTrak rate-limits this group aggressively.' },
  { label: 'Analyst Objects', queryType: 'GROUP', value: 'analyst' },
  { label: 'Fengyun-1C Debris', queryType: 'GROUP', value: 'fengyun-1c-debris' },
  { label: 'Iridium 33 Debris', queryType: 'GROUP', value: 'iridium-33-debris' },
  { label: 'Cosmos 2251 Debris', queryType: 'GROUP', value: 'cosmos-2251-debris' },
  { label: 'Weather', queryType: 'GROUP', value: 'weather' },
  { label: 'Earth Resources', queryType: 'GROUP', value: 'resource' },
  { label: 'Search & Rescue', queryType: 'GROUP', value: 'sarsat' },
  { label: 'Disaster Monitoring', queryType: 'GROUP', value: 'dmc' },
  { label: 'TDRSS', queryType: 'GROUP', value: 'tdrss' },
  { label: 'ARGOS', queryType: 'GROUP', value: 'argos' },
  { label: 'Planet', queryType: 'GROUP', value: 'planet' },
  { label: 'Spire', queryType: 'GROUP', value: 'spire' },
  { label: 'Active GEO', queryType: 'GROUP', value: 'geo' },
  { label: 'GEO Protected Zone', queryType: 'SPECIAL', value: 'GPZ' },
  { label: 'GEO Protected Zone Plus', queryType: 'SPECIAL', value: 'GPZ-PLUS' },
  { label: 'Intelsat', queryType: 'GROUP', value: 'intelsat' },
  { label: 'SES', queryType: 'GROUP', value: 'ses' },
  { label: 'Eutelsat', queryType: 'GROUP', value: 'eutelsat' },
  { label: 'Telesat', queryType: 'GROUP', value: 'telesat' },
  { label: 'Starlink', queryType: 'GROUP', value: 'starlink', caution: 'Large download. Query on demand only.' },
  { label: 'OneWeb', queryType: 'GROUP', value: 'oneweb' },
  { label: 'Qianfan', queryType: 'GROUP', value: 'qianfan' },
  { label: 'Hulianwang', queryType: 'GROUP', value: 'hulianwang' },
  { label: 'Kuiper', queryType: 'GROUP', value: 'kuiper' },
  { label: 'Iridium NEXT', queryType: 'GROUP', value: 'iridium-NEXT' },
  { label: 'Orbcomm', queryType: 'GROUP', value: 'orbcomm' },
  { label: 'Globalstar', queryType: 'GROUP', value: 'globalstar' },
  { label: 'Amateur Radio', queryType: 'GROUP', value: 'amateur' },
  { label: 'SatNOGS', queryType: 'GROUP', value: 'satnogs' },
  { label: 'Experimental Comm', queryType: 'GROUP', value: 'x-comm' },
  { label: 'Other Comm', queryType: 'GROUP', value: 'other-comm' },
  { label: 'GNSS', queryType: 'GROUP', value: 'gnss' },
  { label: 'GPS Operational', queryType: 'GROUP', value: 'gps-ops' },
  { label: 'GLONASS Operational', queryType: 'GROUP', value: 'glo-ops' },
  { label: 'Galileo', queryType: 'GROUP', value: 'galileo' },
  { label: 'BeiDou', queryType: 'GROUP', value: 'beidou' },
  { label: 'SBAS', queryType: 'GROUP', value: 'sbas' },
  { label: 'Science', queryType: 'GROUP', value: 'science' },
  { label: 'Geodetic', queryType: 'GROUP', value: 'geodetic' },
  { label: 'Engineering', queryType: 'GROUP', value: 'engineering' },
  { label: 'Education', queryType: 'GROUP', value: 'education' },
  { label: 'Military', queryType: 'GROUP', value: 'military' },
  { label: 'Radar Calibration', queryType: 'GROUP', value: 'radar' },
  { label: 'CubeSats', queryType: 'GROUP', value: 'cubesat' },
];

export const PRESET_SATELLITES: SatellitePreset[] = [
  { label: 'ISS (ZARYA)', catalogNumber: 25544, groupHint: 'stations' },
  { label: 'Hubble Space Telescope', catalogNumber: 20580, groupHint: 'science' },
  { label: 'NOAA-20', catalogNumber: 43013, groupHint: 'weather' },
  { label: 'GOES-16', catalogNumber: 41866, groupHint: 'geo' },
  { label: 'Terra', catalogNumber: 25994, groupHint: 'resource' },
  { label: 'Landsat 9', catalogNumber: 49260, groupHint: 'resource' },
  { label: 'Sentinel-2A', catalogNumber: 40697, groupHint: 'resource' },
  { label: 'GPS BIIR-2 (PRN 13)', catalogNumber: 24876, groupHint: 'gps-ops' },
  { label: 'Starlink-1008', catalogNumber: 44713, groupHint: 'starlink' },
  { label: 'OneWeb-0178', catalogNumber: 45178, groupHint: 'oneweb' },
];

export class CelestrakClient {
  private readonly memoryCache = new Map<string, CacheEntry>();
  private readonly textCache = new Map<string, TextCacheEntry>();
  private readonly pending = new Map<string, Promise<CelestrakOmm[]>>();
  private readonly pendingText = new Map<string, Promise<string>>();

  async fetchByCatalogNumber(catalogNumber: number): Promise<CelestrakOmm[]> {
    return this.fetchQuery({ CATNR: String(catalogNumber) });
  }

  async fetchGroup(group: SatelliteGroup): Promise<CelestrakOmm[]> {
    return this.fetchQuery({ [group.queryType]: group.value });
  }

  async searchByName(name: string): Promise<CelestrakOmm[]> {
    return this.fetchQuery({ NAME: name.trim() });
  }

  async fetchTleLines(catalogNumber: number): Promise<[string, string]> {
    const url = this.getTextQueryUrl({ CATNR: String(catalogNumber) }, 'TLE');
    const body = await this.fetchText(url);
    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);

    const tleLines = lines.filter((line) => line.startsWith('1 ') || line.startsWith('2 '));
    if (tleLines.length < 2) {
      throw new Error(`No TLE response available for NORAD ${catalogNumber}. This often means the current library cannot propagate that catalog ID yet.`);
    }

    return [tleLines[0], tleLines[1]];
  }

  getQueryUrl(params: Record<string, string>): string {
    const search = new URLSearchParams({ ...params, FORMAT: 'JSON' });
    return `${API_BASE}?${search.toString()}`;
  }

  private getTextQueryUrl(params: Record<string, string>, format: string): string {
    const search = new URLSearchParams({ ...params, FORMAT: format });
    return `${API_BASE}?${search.toString()}`;
  }

  private async fetchQuery(params: Record<string, string>): Promise<CelestrakOmm[]> {
    const url = this.getQueryUrl(params);
    const cached = this.readCache(url);
    if (cached) {
      return cached;
    }

    const inFlight = this.pending.get(url);
    if (inFlight) {
      return inFlight;
    }

    const request = this.requestJson(url)
      .then((payload) => {
        const normalized = payload
          .filter((entry) => Number.isFinite(entry.NORAD_CAT_ID) && Number.isFinite(entry.MEAN_MOTION))
          .sort((left, right) => {
            const leftName = left.OBJECT_NAME ?? `NORAD ${left.NORAD_CAT_ID}`;
            const rightName = right.OBJECT_NAME ?? `NORAD ${right.NORAD_CAT_ID}`;
            return leftName.localeCompare(rightName);
          });
        this.writeCache(url, normalized);
        return normalized;
      })
      .finally(() => {
        this.pending.delete(url);
      });

    this.pending.set(url, request);
    return request;
  }

  private async requestJson(url: string): Promise<CelestrakOmm[]> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`CelesTrak returned HTTP ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        throw new Error('Unexpected CelesTrak response shape');
      }

      return payload as CelestrakOmm[];
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchText(url: string): Promise<string> {
    const cached = this.readTextCache(url);
    if (cached) {
      return cached;
    }

    const inFlight = this.pendingText.get(url);
    if (inFlight) {
      return inFlight;
    }

    const request = this.requestText(url)
      .then((payload) => {
        this.writeTextCache(url, payload);
        return payload;
      })
      .finally(() => {
        this.pendingText.delete(url);
      });

    this.pendingText.set(url, request);
    return request;
  }

  private async requestText(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/plain' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`CelesTrak returned HTTP ${response.status}`);
      }

      return response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private readCache(url: string): CelestrakOmm[] | null {
    const now = Date.now();
    const inMemory = this.memoryCache.get(url);
    if (inMemory && now - inMemory.savedAt < CACHE_TTL_MS) {
      return inMemory.payload;
    }

    try {
      const serialized = window.localStorage.getItem(this.cacheKey(url));
      if (!serialized) {
        return null;
      }

      const parsed = JSON.parse(serialized) as CacheEntry;
      if (now - parsed.savedAt >= CACHE_TTL_MS) {
        return null;
      }

      this.memoryCache.set(url, parsed);
      return parsed.payload;
    } catch {
      return null;
    }
  }

  private writeCache(url: string, payload: CelestrakOmm[]): void {
    const entry: CacheEntry = { savedAt: Date.now(), payload };
    this.memoryCache.set(url, entry);

    try {
      window.localStorage.setItem(this.cacheKey(url), JSON.stringify(entry));
    } catch {
      // Ignore storage failures. Memory cache is enough for the current session.
    }
  }

  private readTextCache(url: string): string | null {
    const now = Date.now();
    const inMemory = this.textCache.get(url);
    if (inMemory && now - inMemory.savedAt < CACHE_TTL_MS) {
      return inMemory.payload;
    }

    try {
      const serialized = window.localStorage.getItem(this.textCacheKey(url));
      if (!serialized) {
        return null;
      }

      const parsed = JSON.parse(serialized) as TextCacheEntry;
      if (now - parsed.savedAt >= CACHE_TTL_MS) {
        return null;
      }

      this.textCache.set(url, parsed);
      return parsed.payload;
    } catch {
      return null;
    }
  }

  private writeTextCache(url: string, payload: string): void {
    const entry: TextCacheEntry = { savedAt: Date.now(), payload };
    this.textCache.set(url, entry);

    try {
      window.localStorage.setItem(this.textCacheKey(url), JSON.stringify(entry));
    } catch {
      // Ignore storage failures. Memory cache is enough for the current session.
    }
  }

  private cacheKey(url: string): string {
    return `celestrak-cache:${url}`;
  }

  private textCacheKey(url: string): string {
    return `celestrak-text-cache:${url}`;
  }
}
