import { describe, expect, test } from "bun:test";
import { PORT_ATTEMPTS, listen, repoId } from "./server.ts";

function inUse(): Error {
  return Object.assign(new Error("Failed to start server. Is port in use?"), { code: "EADDRINUSE" });
}

describe("listen", () => {
  test("uses the requested port when it is free", () => {
    const tried: number[] = [];
    expect(listen(7777, (port) => {
      tried.push(port);
      return port;
    })).toBe(7777);
    expect(tried).toEqual([7777]);
  });

  test("walks up to the next free port", () => {
    const tried: number[] = [];
    const landed = listen(7777, (port) => {
      tried.push(port);
      if (port < 7779) throw inUse();
      return port;
    });
    expect(landed).toBe(7779);
    expect(tried).toEqual([7777, 7778, 7779]);
  });

  test("gives up after a bounded range rather than scanning forever", () => {
    const tried: number[] = [];
    expect(() =>
      listen(7777, (port) => {
        tried.push(port);
        throw inUse();
      })
    ).toThrow(`ports 7777-${7777 + PORT_ATTEMPTS - 1} are all in use; pass --port to pick another`);
    expect(tried).toHaveLength(PORT_ATTEMPTS);
  });

  test("leaves port 0 to the OS instead of walking", () => {
    const tried: number[] = [];
    expect(() =>
      listen(0, (port) => {
        tried.push(port);
        throw inUse();
      })
    ).toThrow();
    expect(tried).toEqual([0]);
  });

  test("rethrows failures that are not a taken port", () => {
    expect(() =>
      listen(7777, () => {
        throw new Error("permission denied");
      })
    ).toThrow("permission denied");
  });
});

describe("repoId", () => {
  test("two working copies key apart, so one machine's reviews do not share a browser store", () => {
    expect(repoId("/home/me/alpha")).not.toBe(repoId("/home/me/beta"));
  });

  test("the same working copy keys the same across runs, so a restart finds its notes", () => {
    expect(repoId("/home/me/alpha")).toBe(repoId("/home/me/alpha"));
  });

  test("the path itself does not reach the page", () => {
    expect(repoId("/home/me/alpha")).not.toContain("alpha");
  });
});
