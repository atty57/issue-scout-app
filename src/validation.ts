import type { Profile } from "./types";

export function profileErrors(profile: Profile): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!profile.work_types.length)
    fields.work_types = "Choose at least one kind of work.";
  if (
    !Number.isInteger(profile.scouting.min_stars) ||
    profile.scouting.min_stars < 1
  )
    fields["scouting.min_stars"] = "Enter a positive whole number.";
  if (
    !Number.isInteger(profile.scouting.shortlist_size) ||
    profile.scouting.shortlist_size < 1 ||
    profile.scouting.shortlist_size > 8
  )
    fields["scouting.shortlist_size"] = "Choose a whole number from 1 to 8.";
  profile.watchlist.forEach((repo, index) => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
      fields[`watchlist.${index}`] =
        "Use owner/repository, for example example-org/trace-kit.";
  });
  profile.skills.forEach((skill, index) => {
    if (!skill.value.trim())
      fields[`skills.${index}.value`] = "Enter a skill or remove this row.";
  });
  return fields;
}
