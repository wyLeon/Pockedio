const location = process.env.LEONDIO_LOCATION || "Shanghai";

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
const geo = await getJson(geoUrl);
const place = geo.results?.[0];

if (!place) {
  console.log(JSON.stringify({ ok: false, stage: "geocoding", location }, null, 2));
  process.exit(1);
}

const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&forecast_days=1`;
const forecast = await getJson(forecastUrl);

console.log(JSON.stringify({
  ok: true,
  requestedLocation: location,
  matchedLocation: `${place.name}, ${place.country}`,
  latitude: place.latitude,
  longitude: place.longitude,
  current: forecast.current,
}, null, 2));
