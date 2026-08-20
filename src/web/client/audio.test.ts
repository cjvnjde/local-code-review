import { describe, expect, test } from "bun:test";
import type { DiffFile } from "../../types.ts";
import { audioHtml, isAudio } from "./audio.ts";

type AudioFile = Pick<DiffFile, "path" | "from" | "status">;
const file = (over: Partial<AudioFile> = {}): AudioFile => ({
  path: "music/theme.mp3",
  status: "modified",
  ...over,
});
const sides = (html: string) => [...html.matchAll(/class="audf (old|new)"/g)].map((match) => match[1]);

describe("isAudio", () => {
  test("recognizes browser-playable music extensions regardless of case", () => {
    for (const name of ["song.MP3", "song.wav", "song.ogg", "song.opus", "song.flac", "song.m4a", "song.aac", "song.aiff", "song.weba"]) {
      expect(isAudio(name)).toBe(true);
    }
    expect(isAudio("song.mp3.ts")).toBe(false);
    expect(isAudio("album.zip")).toBe(false);
  });
});

describe("audioHtml", () => {
  test("a change can be played on both sides, old before new", () => {
    const html = audioHtml(file());
    expect(sides(html)).toEqual(["old", "new"]);
    expect(html).toContain("/api/blob?side=old&amp;path=music%2Ftheme.mp3");
    expect(html).toContain("/api/blob?side=new&amp;path=music%2Ftheme.mp3");
    expect(html.match(/<audio controls preload="metadata"/g)).toHaveLength(2);
  });

  test("an added or deleted recording only offers the side that exists", () => {
    expect(sides(audioHtml(file({ status: "added" })))).toEqual(["new"]);
    expect(sides(audioHtml(file({ status: "deleted" })))).toEqual(["old"]);
  });

  test("a rename names the old recording and asks the server under the new path", () => {
    const html = audioHtml(file({ status: "renamed", from: "music/intro.mp3" }));
    expect(html).toContain("music/intro.mp3</span>");
    expect(html).toContain("/api/blob?side=old&amp;path=music%2Ftheme.mp3");
  });

  test("does not draw non-audio files and escapes paths placed in markup", () => {
    expect(audioHtml(file({ path: "music/notes.txt" }))).toBe("");
    const html = audioHtml(file({ path: 'music/a"><b>.mp3', status: "added" }));
    expect(html).not.toContain('"><b>');
    expect(html).toContain("music%2Fa%22%3E%3Cb%3E.mp3");
  });
});
