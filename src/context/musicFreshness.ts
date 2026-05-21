export type MusicFreshnessSource = {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  snippet: string;
};

export type MusicFreshnessLookupResult = {
  sources: MusicFreshnessSource[];
};

export type MusicFreshnessProvider = {
  lookup: (query: string, options?: { signal?: AbortSignal }) => Promise<MusicFreshnessLookupResult>;
};

type WikidataSearchResponse = {
  search?: Array<{
    id?: string;
    label?: string;
    description?: string;
  }>;
};

type WikidataEntityResponse = {
  entities?: Record<string, {
    labels?: Record<string, { value?: string }>;
    claims?: {
      P570?: Array<{
        mainsnak?: {
          datavalue?: {
            value?: {
              time?: string;
            };
          };
        };
      }>;
    };
  }>;
};

export function createWikidataMusicFreshnessProvider(fetchImpl: typeof fetch = fetch): MusicFreshnessProvider {
  return {
    async lookup(query, options) {
      const entity = await findWikidataMusicEntity(query, fetchImpl, options?.signal);
      if (!entity) {
        return { sources: [] };
      }

      const source = await readWikidataEntityStatus(entity.id, fetchImpl, options?.signal);
      return { sources: source ? [source] : [] };
    }
  };
}

async function findWikidataMusicEntity(
  query: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<{ id: string } | undefined> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("format", "json");
  url.searchParams.set("language", "en");
  url.searchParams.set("uselang", "en");
  url.searchParams.set("limit", "5");
  url.searchParams.set("search", normalizeFreshnessQueryForSearch(query));

  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    return undefined;
  }
  const body = await response.json() as WikidataSearchResponse;
  const match = body.search?.find((item) => item.id && isLikelyMusicEntity(item.description));
  return match?.id ? { id: match.id } : undefined;
}

async function readWikidataEntityStatus(
  entityId: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<MusicFreshnessSource | undefined> {
  const url = new URL(`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`);
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    return undefined;
  }

  const body = await response.json() as WikidataEntityResponse;
  const entity = body.entities?.[entityId];
  const deathTime = entity?.claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time;
  if (!deathTime) {
    return undefined;
  }

  const name = entity.labels?.en?.value ?? entity.labels?.zh?.value ?? entityId;
  const deathDate = formatWikidataDate(deathTime);
  return {
    title: `${name} status`,
    url: `https://www.wikidata.org/wiki/${entityId}`,
    source: "Wikidata",
    snippet: `${name} died on ${deathDate}.`
  };
}

function normalizeFreshnessQueryForSearch(query: string): string {
  return query
    .replace(/\b(tell me|recent|latest|updates?|news|from|about|what happened to|is|still|active|alive|passed away|died|now|currently)\b/gi, " ")
    .replace(/[?.,!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyMusicEntity(description: string | undefined): boolean {
  if (!description) {
    return false;
  }
  return /\b(singer|songwriter|musician|composer|producer|band|artist|rapper|vocalist|music)\b/i.test(description);
}

function formatWikidataDate(value: string): string {
  const match = /^\+?(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}
