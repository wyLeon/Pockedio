const baseUrl = process.env.NETEASE_BASE_URL || "http://127.0.0.1:3000";
const keyword = process.env.NETEASE_KEYWORD || "坂本龙一";

async function getJson(path) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`);
  }
  return json;
}

const search = await getJson(`/search?keywords=${encodeURIComponent(keyword)}&limit=5`);
const songs = search?.result?.songs || [];
const first = songs[0];

if (!first?.id) {
  console.log(JSON.stringify({ ok: false, stage: "search", songCount: songs.length }, null, 2));
  process.exit(1);
}

const urlResult = await getJson(`/song/url/v1?id=${first.id}&level=standard`);
const urlItem = urlResult?.data?.[0];

console.log(JSON.stringify({
  ok: Boolean(urlItem?.url),
  baseUrl,
  keyword,
  songCount: songs.length,
  firstSong: {
    id: first.id,
    name: first.name,
    artists: (first.artists || []).map((artist) => artist.name),
  },
  playable: Boolean(urlItem?.url),
  urlType: urlItem?.type || null,
  code: urlItem?.code || null,
  freeTrialInfo: Boolean(urlItem?.freeTrialInfo),
}, null, 2));
