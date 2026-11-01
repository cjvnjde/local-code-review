import { describe, expect, test } from "bun:test";
import { DEFAULT_UI_SETTINGS, parseUiSettings } from "./settings.ts";

describe("UI settings schema", () => {
  test("accepts every live preference and leaves omitted fields omitted", () => {
    expect(parseUiSettings({})).toEqual({});
    expect(parseUiSettings(DEFAULT_UI_SETTINGS)).toEqual(DEFAULT_UI_SETTINGS);
    expect(parseUiSettings({ enterSaves: true, navHidden: true })).toEqual({
      enterSaves: true,
      navHidden: true,
    });
  });

  test("accepts exactly the choices offered by the numeric controls", () => {
    for (const limit of [0, 500, 900, 1800])
      expect(parseUiSettings({ limit })).toEqual({ limit });
    for (const expand of [10, 20, 50, 100])
      expect(parseUiSettings({ expand })).toEqual({ expand });
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      -1,
      1.5,
      2 ** 53,
      "20",
      null,
    ]) {
      expect(() => parseUiSettings({ limit: value })).toThrow("ui.limit");
      expect(() => parseUiSettings({ expand: value })).toThrow("ui.expand");
    }
    expect(() => parseUiSettings({ limit: 100 })).toThrow("ui.limit");
    expect(() => parseUiSettings({ expand: 0 })).toThrow("ui.expand");
  });

  test("rejects unknown and obsolete fields, invalid objects and wrong types", () => {
    for (const value of [null, undefined, [], true, 42, "settings", new Date()])
      expect(() => parseUiSettings(value)).toThrow("ui must be an object");
    for (const key of ["unknown", "clearSaved", "__proto__", "constructor"])
      expect(() => parseUiSettings({ [key]: true })).toThrow(
        "unknown ui setting",
      );
    for (const [key, value] of Object.entries(DEFAULT_UI_SETTINGS)) {
      const invalid = typeof value === "boolean" ? "true" : false;
      expect(() => parseUiSettings({ [key]: invalid })).toThrow(`ui.${key}`);
    }
    expect(() => parseUiSettings({ disabledHide: ["dist/", 1] })).toThrow(
      "ui.disabledHide",
    );
  });

  test("detaches configured arrays from the input", () => {
    const input = { disabledHide: ["dist/"] };
    const settings = parseUiSettings(input);
    input.disabledHide.push("*.snap");
    expect(settings.disabledHide).toEqual(["dist/"]);
  });

  test("null-prototype configuration records are accepted but inherited preferences are not", () => {
    const input = Object.assign(Object.create(null), {
      auto: false,
      hide: "*.snap",
    });
    expect(parseUiSettings(input)).toEqual({ auto: false, hide: "*.snap" });
    expect(() => parseUiSettings(Object.create({ auto: true }))).toThrow();
    class Preferences {
      auto = false;
    }
    expect(() => parseUiSettings(new Preferences())).toThrow();
  });

  test("boolean settings preserve both choices independently instead of resetting other fields", () => {
    const keys = [
      "auto",
      "back",
      "toast",
      "hideEnabled",
      "hideDeleted",
      "foldDel",
      "enterSaves",
      "navHidden",
      "ntFold",
      "bmFold",
      "single",
      "ghosts",
    ];
    for (const key of keys) {
      for (const value of [false, true]) {
        const input = { [key]: value };
        expect(parseUiSettings(input)).toEqual(input);
        expect(input).toEqual({ [key]: value });
      }
    }
    expect(parseUiSettings({ hide: "", editor: "" })).toEqual({
      hide: "",
      editor: "",
    });
    expect(
      parseUiSettings({ hide: "*.snap\nbuild/", editor: "code --wait" }),
    ).toEqual({ hide: "*.snap\nbuild/", editor: "code --wait" });
  });

  test("rejecting a later invalid preference leaves the caller's earlier arrays untouched", () => {
    const input = { disabledHide: ["dist/", "*.snap"], expand: 11 };
    expect(() => parseUiSettings(input)).toThrow();
    expect(input).toEqual({ disabledHide: ["dist/", "*.snap"], expand: 11 });
    const parsed = parseUiSettings({ disabledHide: input.disabledHide });
    parsed.disabledHide!.push("generated/");
    expect(input.disabledHide).toEqual(["dist/", "*.snap"]);
  });
});
