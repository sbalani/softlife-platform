import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeocodeAddress } from "./geocode.ts";

test("removes a venue prefix and expands Spanish street abbreviations", () => {
  assert.equal(
    normalizeGeocodeAddress("Recinto Ferial, C. Peñista Rafael Fuentes, 43, Cruz de Humilladero, 29006 Málaga"),
    "Calle Peñista Rafael Fuentes, 43, Cruz de Humilladero, 29006 Málaga",
  );
});

test("preserves addresses without a venue prefix", () => {
  assert.equal(normalizeGeocodeAddress("Calle Larios, 1, Málaga"), "Calle Larios, 1, Málaga");
});
