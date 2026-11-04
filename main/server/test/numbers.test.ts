import assert from "node:assert/strict";
import { test } from "node:test";
import { collectAllowedNumbers, extractNumbers, findUnsupportedNumbers } from "../src/numbers.js";

test('"100.000" and "100000" are the same figure', () => {
  assert.deepEqual(findUnsupportedNumbers("Budget di 100.000 euro", { budget: 100000 }), []);
  assert.deepEqual(findUnsupportedNumbers("Budget di 100000 euro", { budget: 100000 }), []);
  assert.equal(extractNumbers("100.000")[0]?.value, extractNumbers("100000")[0]?.value);
});

test('"1,5 milioni" reads as 1500000', () => {
  assert.equal(extractNumbers("1,5 milioni")[0]?.value, 1_500_000);
  assert.deepEqual(findUnsupportedNumbers("1,5 milioni di euro", { x: 1500000 }), []);
  assert.deepEqual(findUnsupportedNumbers("1,5 milioni di euro", { x: 1.5 }), ["1,5 milioni"]);
});

test('"200k" reads as 200000', () => {
  assert.equal(extractNumbers("200k")[0]?.value, 200_000);
  assert.deepEqual(findUnsupportedNumbers("circa 200k", { x: 200000 }), []);
  assert.deepEqual(findUnsupportedNumbers("circa 200k", { x: 200 }), ["200k"]);
});

test('"duecentomila" reads as 200000', () => {
  assert.equal(extractNumbers("duecentomila")[0]?.value, 200_000);
  assert.deepEqual(findUnsupportedNumbers("duecentomila euro", { x: 200000 }), []);
  assert.deepEqual(findUnsupportedNumbers("duecentomila euro", { x: 100000 }), ["duecentomila"]);
});

test('"42%" passes against 0.42 while bare "42" fails', () => {
  assert.deepEqual(findUnsupportedNumbers("quota del 42%", { share: 0.42 }), []);
  assert.deepEqual(findUnsupportedNumbers("quota del 42 per cento", { share: 0.42 }), []);
  assert.deepEqual(findUnsupportedNumbers("sono 42 zone", { share: 0.42 }), ["42"]);
});

test('"0,04" passes against 0.0423 by rounding to the shown precision', () => {
  assert.deepEqual(findUnsupportedNumbers("indice 0,04", { index: 0.0423 }), []);
  assert.deepEqual(findUnsupportedNumbers("indice 0,05", { index: 0.0423 }), ["0,05"]);
});

test('"over 75" and "50-64" are labels, not figures', () => {
  assert.deepEqual(findUnsupportedNumbers("gli over 75 e gli over-65", {}), []);
  assert.deepEqual(findUnsupportedNumbers("adulti 50-64 anni e 50 – 64", {}), []);
});

test("list markers and URLs are ignored", () => {
  assert.deepEqual(findUnsupportedNumbers("1. prima voce\n2) seconda voce\n  3. terza voce", {}), []);
  assert.deepEqual(findUnsupportedNumbers("Fonte: https://dati.torino.it/2024/set-99?id=7 e basta", {}), []);
});

test("an invented figure is reported", () => {
  assert.deepEqual(findUnsupportedNumbers("Costa 123.456 € in totale", { budget: 100000 }), ["123.456"]);
  assert.deepEqual(findUnsupportedNumbers("Sono 7 zone | 8 interventi", { zones: 7 }), ["8"]);
});

test('"sei" as a verb is not a number, "sei zone" is', () => {
  assert.deepEqual(findUnsupportedNumbers("Tu sei il referente", {}), []);
  assert.deepEqual(findUnsupportedNumbers("Abbiamo scelto sei zone", {}), ["sei"]);
  assert.deepEqual(findUnsupportedNumbers("Abbiamo scelto sei zone", { zones: 6 }), []);
});

test("spelled-out figures are checked, common Italian words are not", () => {
  assert.deepEqual(findUnsupportedNumbers("le tre zone", {}), ["tre"]);
  assert.deepEqual(findUnsupportedNumbers("nel centro, una percentuale recente, per un'istituzione", {}), []);
});

test("figures inside payload strings and key names are allowed", () => {
  const allowed = collectAllowedNumbers({ display: "50.000 €", over75_2030: null, share: "42%" });
  for (const value of [50000, 75, 2030, 42]) assert.ok(allowed.includes(value), `manca ${value}`);
});

test("Italian display strings all parse back to their value", () => {
  for (const [text, value] of [
    ["1000", 1000],
    ["10.000", 10000],
    ["1.234.567", 1234567],
    ["1234,5", 1234.5],
    ["0,042", 0.042],
    ["41,67", 41.67],
  ] as const) {
    assert.equal(extractNumbers(text)[0]?.value, value, text);
  }
});

test('"un milione" is a figure, while "un" alone is an article', () => {
  assert.deepEqual(findUnsupportedNumbers("un milione di euro", { budget: 100000 }), ["un milione"]);
  assert.deepEqual(findUnsupportedNumbers("un milione di euro", { budget: 1000000 }), []);
  assert.deepEqual(findUnsupportedNumbers("un progetto per una zona", { x: 1 }), []);
});

test('a figure glued to a unit, like "999m", is checked', () => {
  assert.deepEqual(findUnsupportedNumbers("a 999m dal centro", { x: 1 }), ["999m"]);
  assert.deepEqual(findUnsupportedNumbers("a 640m dal centro", { x: 640 }), []);
  assert.deepEqual(findUnsupportedNumbers("a 5km dal centro", { x: 5 }), []);
  assert.deepEqual(findUnsupportedNumbers("200k", { x: 200000 }), []);
});
