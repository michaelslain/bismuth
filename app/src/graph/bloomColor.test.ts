import { expect, test } from "bun:test";
import { parseHexColor, parseRgbTriple } from "./bloomColor";

test("parseHexColor reads a 6-digit hex", () => {
  expect(parseHexColor("#93BDB0")).toEqual([147, 189, 176]);
  expect(parseHexColor("#000000")).toEqual([0, 0, 0]);
  expect(parseHexColor("#ffffff")).toEqual([255, 255, 255]);
});

test("parseHexColor reads a 3-digit hex, expanded", () => {
  expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
  expect(parseHexColor("#0a1")).toEqual([0, 170, 17]);
});

test("parseHexColor is case-insensitive and trims whitespace", () => {
  expect(parseHexColor("  #93bdb0  ")).toEqual([147, 189, 176]);
  expect(parseHexColor("#ABCDEF")).toEqual(parseHexColor("#abcdef"));
});

test("parseHexColor rejects anything malformed instead of returning NaN channels", () => {
  expect(parseHexColor("")).toBeNull();
  expect(parseHexColor("93BDB0")).toBeNull(); // missing '#'
  expect(parseHexColor("#12345")).toBeNull(); // 5 digits
  expect(parseHexColor("#1234567")).toBeNull(); // 7 digits
  expect(parseHexColor("#zzzzzz")).toBeNull(); // non-hex digits
  expect(parseHexColor("rgb(1, 2, 3)")).toBeNull();
  expect(parseHexColor("teal")).toBeNull();
});

test("parseRgbTriple reads a comma-separated triple, with or without spaces", () => {
  expect(parseRgbTriple("150, 230, 216")).toEqual([150, 230, 216]);
  expect(parseRgbTriple("150,230,216")).toEqual([150, 230, 216]);
  expect(parseRgbTriple("  150 , 230 , 216  ")).toEqual([150, 230, 216]);
});

test("parseRgbTriple clamps out-of-range channels", () => {
  expect(parseRgbTriple("999, -5, 300")).toEqual([255, 0, 255]);
});

test("parseRgbTriple rejects anything malformed instead of returning NaN/Infinity channels", () => {
  expect(parseRgbTriple("")).toBeNull();
  expect(parseRgbTriple("150, 230")).toBeNull(); // only two channels
  expect(parseRgbTriple("150, 230, 216, 1")).toBeNull(); // four channels (e.g. rgba mistake)
  expect(parseRgbTriple("a, b, c")).toBeNull();
  expect(parseRgbTriple("150, , 216")).toBeNull(); // empty middle token
  expect(parseRgbTriple("150, Infinity, 216")).toBeNull();
});
