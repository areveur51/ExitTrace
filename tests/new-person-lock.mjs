/** Shared lock fields for new person inserts. Existing gold annotate stays empty. */

export const NEW_PERSON_LOCK = {
  birth_date: "1985-03-12",
  country_of_origin: "United States",
  position: "Analyst",
  organization: "Example Desk",
  comments: "Public-role exit after contemporaneous news reports",
};

export function withNewPersonLock(input = {}) {
  return { ...NEW_PERSON_LOCK, ...input };
}

export const LOCK_CLI_FLAGS = [
  "--birth-date",
  NEW_PERSON_LOCK.birth_date,
  "--country-of-origin",
  NEW_PERSON_LOCK.country_of_origin,
  "--position",
  NEW_PERSON_LOCK.position,
  "--organization",
  NEW_PERSON_LOCK.organization,
  "--comments",
  NEW_PERSON_LOCK.comments,
];
