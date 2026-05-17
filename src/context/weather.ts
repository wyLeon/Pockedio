export type WeatherContext = {
  location: string;
  matchedLocation: string;
  temperatureC: number | null;
  relativeHumidity: number | null;
  precipitation: number | null;
  weatherCode: number | null;
  windSpeed: number | null;
  summary: string;
};

export async function readWeatherContext(location: string, fetchImpl: typeof fetch = fetch): Promise<WeatherContext | null> {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
    const geo = await getJson<{ results?: Array<{ name: string; country: string; latitude: number; longitude: number }> }>(geoUrl, fetchImpl);
    const place = geo.results?.[0];
    if (!place) {
      return null;
    }

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&forecast_days=1`;
    const forecast = await getJson<{
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        precipitation?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    }>(forecastUrl, fetchImpl);

    const current = forecast.current ?? {};
    const context = {
      location,
      matchedLocation: `${place.name}, ${place.country}`,
      temperatureC: current.temperature_2m ?? null,
      relativeHumidity: current.relative_humidity_2m ?? null,
      precipitation: current.precipitation ?? null,
      weatherCode: current.weather_code ?? null,
      windSpeed: current.wind_speed_10m ?? null
    };

    return {
      ...context,
      summary: `Weather in ${context.matchedLocation}: ${context.temperatureC ?? "unknown"}C, humidity ${context.relativeHumidity ?? "unknown"}%, precipitation ${context.precipitation ?? "unknown"}, wind ${context.windSpeed ?? "unknown"} km/h.`
    };
  } catch {
    return null;
  }
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.json() as T;
}
