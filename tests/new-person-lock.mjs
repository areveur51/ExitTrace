/** Shared lock fields for new person inserts. Existing gold annotate stays empty.
 *  birth_date is optional on insert (null when unknown); tests that need age set it.
 *  A new person also needs an eligible portrait. The fixture is copied into a temp media dir. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LOCK_PORTRAIT = path.join(HERE, "fixtures", "people", "lock-portrait.jpg");
export const LOCK_MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "et-lock-media-"));
fs.mkdirSync(path.join(LOCK_MEDIA_DIR, "people"), { recursive: true });

export const NEW_PERSON_LOCK = {
  birth_date: "1985-03-12",
  country_of_origin: "United States",
  position: "Analyst",
  organization: "Example Desk",
  comments: "Public-role exit after contemporaneous news reports",
  photo: LOCK_PORTRAIT,
  photo_credit: "Test portrait",
  mediaDir: LOCK_MEDIA_DIR,
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
  "--photo",
  LOCK_PORTRAIT,
  "--photo-credit",
  "Test portrait",
];
