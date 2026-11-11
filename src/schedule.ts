// Daylight saving notes for a daily run at a local time. GitHub keeps the run at that local time all year
// (daily.yml sets `timezone`), but on the days clocks change, a time can be skipped or happen twice.
const MINUTE = 6e4;
const DAY = 864e5;

const clock = (minutes: number) => {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
};

// Minutes ahead of UTC in `zone`, at a moment.
function offsetIn(zone: string) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
  return (at: number) => {
    const name = format.formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
    const match = /GMT([+-])(\d\d):(\d\d)/.exec(name);
    return match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  };
}

// Looks a year ahead from `from` for clock changes that skip or repeat `time` ("HH:MM") in `zone`.
export function daylightSavingNotes(time: string, zone: string, from = new Date()): string[] {
  const match = /^(\d\d):(\d\d)$/.exec(time);
  if (!match) return [];
  let offset: (at: number) => number;
  try {
    offset = offsetIn(zone);
  } catch {
    return [];
  }
  const chosen = Number(match[1]) * 60 + Number(match[2]);
  const date = new Intl.DateTimeFormat(undefined, { timeZone: zone, month: "short", day: "numeric", year: "numeric" });
  const notes: string[] = [];
  let at = Math.floor(from.getTime() / MINUTE) * MINUTE;
  let before = offset(at);
  for (let day = 0; day < 366; day++, at += DAY) {
    const after = offset(at + DAY);
    if (after === before) continue;
    // ponytail: assumes at most one clock change per day, which holds for every zone in use.
    let low = at;
    let high = at + DAY;
    while (high - low > MINUTE) {
      const middle = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
      if (offset(middle) === before) low = middle;
      else high = middle;
    }
    const changeAt = high / MINUTE + before; // the clock reading when it changes, e.g. 02:00
    const span = Math.abs(after - before);
    const first = after > before ? changeAt : changeAt - span; // skipped or repeated readings start here
    if ((((chosen - first) % 1440) + 1440) % 1440 < span) {
      const when = date.format(high);
      notes.push(
        after > before
          ? `On ${when}, clocks jump from ${clock(changeAt)} to ${clock(changeAt + span)}, so ${time} doesn't happen that day. GitHub starts that day's scout at ${clock(changeAt + span)}.`
          : `On ${when}, clocks go back from ${clock(changeAt)} to ${clock(first)}, so ${time} happens twice. GitHub doesn't say whether it starts your scout once or twice then. Any time outside ${clock(first)}–${clock(changeAt)} avoids this.`,
      );
    }
    before = after;
  }
  return notes;
}
