import test from "node:test";
import assert from "node:assert/strict";
import { aggregateDailyWeather, filterWeatherByActiveRanges, parseOpenMeteoDaily, weatherCodeLabel } from "./weather.ts";

test("weather aggregates machine locations without summing fleet rainfall", () => {
  const weather = aggregateDailyWeather([
    { day: "2026-09-01", temperatureMean: 20, temperatureMin: 15, temperatureMax: 25, precipitation: 2, weatherCode: 61 },
    { day: "2026-09-01", temperatureMean: 24, temperatureMin: 18, temperatureMax: 30, precipitation: 4, weatherCode: 61 },
  ]);
  assert.deepEqual(weather, [{ day: "2026-09-01", temperatureMean: 22, temperatureMin: 16.5, temperatureMax: 27.5, precipitation: 3, weatherCode: 61, locations: 2 }]);
});

test("weather conditions are reduced to stable local labels", () => {
  assert.equal(weatherCodeLabel(0), "Clear");
  assert.equal(weatherCodeLabel(63), "Rain");
  assert.equal(weatherCodeLabel(95), "Thunderstorm");
});

test("weather parsing rejects provider nulls instead of fabricating zeroes", () => {
  assert.deepEqual(parseOpenMeteoDaily({ time: ["2026-09-01"], temperature_2m_mean: [null], temperature_2m_max: [25], temperature_2m_min: [15], precipitation_sum: [null], weather_code: [null] }), []);
  assert.deepEqual(parseOpenMeteoDaily({ time: ["2026-09-01"], temperature_2m_mean: [20], temperature_2m_max: [25], temperature_2m_min: [15], precipitation_sum: [0], weather_code: [0] })[0]?.temperatureMean, 20);
});

test("weather follows each machine location's historical assignment days", () => {
  const rows = [{ day: "2026-09-01", locationKey: "madrid" }, { day: "2026-09-02", locationKey: "madrid" }];
  assert.deepEqual(filterWeatherByActiveRanges(rows, new Map([["madrid", [{ from: "2026-09-02", to: "2026-09-05" }]]])), [rows[1]]);
});
