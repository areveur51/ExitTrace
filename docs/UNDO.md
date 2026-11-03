# Undo 1.2.41 (repeatable endorsements)

This release is app code only. It adds `endorsement` to `REPEATABLE_EVENT_KINDS` in `app/lib/promote.mjs`. It does not run DDL, it does not migrate rows, and it does not rewrite existing `person_events` rows. An endorsement that was already stored is still `seq` 0 until someone saves that person with a second endorsement.

There is no migration file for this release. `person_events` already has `PRIMARY KEY (person_id, kind, seq)`. The database already allows any kind to repeat. The app was what kept `endorsement` at one row: `eventSeq` stored `seq` 0, and `uniqueEvents` folded a second endorsement into that row. Revert does not need a schema rollback.

`notable` and `red_folder` stay repeatable. Every other kind stays one event per kind at `seq` 0.

## Revert the commit

On the default branch, revert the 1.2.41 commit (the commit that sets `package.json` to `1.2.41` and adds `endorsement` to `REPEATABLE_EVENT_KINDS`):

```bash
git log --oneline -20
git revert <sha>
```

Deploy that revert the same way as any other app release. Do not run a schema rollback. The primary key stays `(person_id, kind, seq)`. `ET_MULTI_EVENT_WRITES` is unchanged by this release and unchanged by the revert.

## If any endorsement row has seq > 0

Before reverting, on lab and on Render, read (do not write):

```sql
SELECT person_id, kind, seq, event_date
  FROM public.person_events
 WHERE kind = 'endorsement'
   AND seq > 0
 ORDER BY person_id, seq;
```

Also look at `people.events` for those people. A second endorsement lives in that JSON as well as in `person_events`.

- **No rows.** Revert. Nothing else to check. Existing `seq` 0 endorsement rows were not modified by this release.
- **Rows exist and you still want those second endorsements.** Do not revert yet. The reverted app treats `endorsement` as one event at `seq` 0. The next save of that person folds the extra endorsement into the `seq` 0 event (`uniqueEvents` / `syncPersonEvents`). `syncPersonEvents` deletes that person's `person_events` rows and inserts the folded set, so the `seq` > 0 companion row goes away on that save. Logical replication and gap-upsert then carry that delete. The revert itself does not delete anything.
- **Rows exist and you are reverting on purpose.** Copy the `seq` > 0 rows and the matching `people.events` first (a `SELECT` into a lab-local table, or a file outside the repo). After the revert, do not save those people until you have decided what to keep. A save on the reverted app drops the extra endorsement down to one event.

`seq` 0 endorsement rows are not part of that check. Leave them. Do not `DELETE` from `person_events` as part of this revert.
