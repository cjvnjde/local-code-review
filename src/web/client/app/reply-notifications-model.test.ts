import { describe, expect, test } from "bun:test";
import type {
  ReviewMessage,
  ReviewNote,
} from "../../../shared/review-types.ts";
import { ReplyNotificationsTracker } from "./reply-notifications-model.ts";

const agent = (at: string, body = "Answer"): ReviewMessage => ({
  role: "agent",
  at,
  body,
});
const note = (id: string, messages: ReviewMessage[] = []): ReviewNote => ({
  id,
  key: id,
  file: "src/example.ts",
  label: "1",
  start: 1,
  end: 1,
  body: "Question",
  status: "pending",
  detail: "",
  messages,
});
const review = (notes: ReviewNote[], file = "review.md") => ({ file, notes });

describe("agent reply notification snapshots", () => {
  test("baselines initial data and each review or repository switch", () => {
    const tracker = new ReplyNotificationsTracker();
    expect(tracker.update("repo-a")).toEqual([]);
    expect(tracker.update("repo-a", review([note("n", [agent("a")])]))).toEqual(
      [],
    );
    expect(
      tracker.update("repo-a", review([note("n", [agent("b")])], "other.md")),
    ).toEqual([]);
    expect(
      tracker.update("repo-a", review([note("n", [agent("a"), agent("c")])])),
    ).toEqual([]);
    expect(tracker.update("repo-b", review([note("n", [agent("d")])]))).toEqual(
      [],
    );
  });

  test("reports new replies once across repeated effects and refetch snapshots", () => {
    const tracker = new ReplyNotificationsTracker();
    tracker.update("repo", review([note("n", [agent("a")])]));
    const updated = note("n", [agent("a"), agent("b"), agent("c")]);
    const snapshot = review([updated]);
    expect(tracker.update("repo", snapshot)).toEqual([
      { note: updated, count: 2 },
    ]);
    expect(tracker.update("repo", snapshot)).toEqual([]);
    expect(
      tracker.update(
        "repo",
        review([note("n", [agent("a"), agent("b"), agent("c")])]),
      ),
    ).toEqual([]);
  });

  test("edits, deletions and restored messages or notes never reannounce", () => {
    const tracker = new ReplyNotificationsTracker();
    tracker.update("repo", review([note("n", [agent("a"), agent("b")])]));
    expect(
      tracker.update("repo", review([note("n", [agent("b", "Edited")])])),
    ).toEqual([]);
    expect(tracker.update("repo", review([]))).toEqual([]);
    expect(
      tracker.update(
        "repo",
        review([note("n", [agent("a"), agent("b", "Edited")])]),
      ),
    ).toEqual([]);
    const updated = note("n", [agent("b", "Edited"), agent("c")]);
    expect(tracker.update("repo", review([updated]))).toEqual([
      { note: updated, count: 1 },
    ]);
  });

  test("isolates note identities and ignores reviewer replies", () => {
    const tracker = new ReplyNotificationsTracker();
    tracker.update(
      "repo",
      review([note("first", [agent("same")]), note("second")]),
    );
    const updated = note("second", [
      { role: "reviewer", at: "reviewer", body: "Follow-up" },
      agent("same"),
    ]);
    expect(
      tracker.update("repo", review([note("first", [agent("same")]), updated])),
    ).toEqual([{ note: updated, count: 1 }]);
    expect(
      tracker.update("repo", review([note("second", [updated.messages[0]!])])),
    ).toEqual([]);
  });

  test("uses occurrence high-water marks for missing or duplicate stamps", () => {
    const tracker = new ReplyNotificationsTracker();
    tracker.update(
      "repo",
      review([note("n", [agent(""), agent("same"), agent("same")])]),
    );
    expect(
      tracker.update(
        "repo",
        review([note("n", [agent("", "Edited"), agent("same")])]),
      ),
    ).toEqual([]);
    expect(
      tracker.update(
        "repo",
        review([note("n", [agent(""), agent("same"), agent("same")])]),
      ),
    ).toEqual([]);
    const updated = note("n", [
      agent(""),
      agent(""),
      agent("same"),
      agent("same"),
      agent("same"),
    ]);
    expect(tracker.update("repo", review([updated]))).toEqual([
      { note: updated, count: 2 },
    ]);
  });
});
