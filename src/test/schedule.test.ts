import { expect, it } from "vitest";
import { daylightSavingNotes } from "../schedule";

const from = new Date("2026-10-01T12:00:00Z");

it("says when a spring-forward change skips the chosen time, and when GitHub starts instead", () => {
  const [note, ...rest] = daylightSavingNotes("02:30", "America/New_York", from);
  expect(rest).toEqual([]);
  expect(note).toMatch(/Mar 14, 2027.*jump from 02:00 to 03:00.*02:30 doesn't happen.*at 03:00/);
});

it("says when a fall-back change repeats the chosen time", () => {
  const [note, ...rest] = daylightSavingNotes("01:30", "America/New_York", from);
  expect(rest).toEqual([]);
  expect(note).toMatch(/Nov 1, 2026.*back from 02:00 to 01:00.*01:30 happens twice.*outside 01:00–02:00/);
});

it("stays quiet for times clock changes don't touch, and zones without daylight saving", () => {
  expect(daylightSavingNotes("09:30", "America/New_York", from)).toEqual([]);
  expect(daylightSavingNotes("02:00", "America/New_York", from)).toHaveLength(1); // the first skipped minute
  expect(daylightSavingNotes("03:00", "America/New_York", from)).toEqual([]); // the first minute after it
  expect(daylightSavingNotes("02:30", "Asia/Kolkata", from)).toEqual([]);
  expect(daylightSavingNotes("02:30", "UTC", from)).toEqual([]);
});

it("finds both changes when a zone skips and repeats the same hour, in either hemisphere", () => {
  // London skips 01:00–02:00 in March and repeats it in October.
  const london = daylightSavingNotes("01:30", "Europe/London", from);
  expect(london).toHaveLength(2);
  expect(london[0]).toMatch(/Oct 25, 2026.*happens twice/);
  expect(london[1]).toMatch(/Mar 28, 2027.*doesn't happen/);
  // Sydney goes back in April and forward in October.
  const sydney = daylightSavingNotes("02:30", "Australia/Sydney", new Date("2026-11-08T00:00:00Z"));
  expect(sydney.map((note) => note.match(/^On (\w+ \d+, \d+)/)?.[1])).toEqual(["Apr 4, 2027", "Oct 3, 2027"]);
});

it("ignores a time or zone it can't read", () => {
  expect(daylightSavingNotes("9:30", "America/New_York", from)).toEqual([]);
  expect(daylightSavingNotes("02:30", "Mars/Olympus_Mons", from)).toEqual([]);
});
