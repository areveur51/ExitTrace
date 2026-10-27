# Undo 1.2.37 (repeatable indictments)

This release is app code only. It adds `indictment_civilian` and `indictment_non_civilian` to `REPEATABLE_EVENT_KINDS` in `app/lib/promote.mjs`. It does not run DDL, it does not migrate rows, and it does not rewrite existing `person_events` rows. An indictment that was already stored is still `seq` 0 until someone saves that person with a second indictment.

`notable` and `red_folder` stay repeatable. Every other kind stays one event per kind at `seq` 0.

## Revert the commit

On the default branch, revert the 1.2.37 commit (the commit that sets `package.json` to `1.2.37` and adds the two indictment kinds to `REPEATABLE_EVENT_KINDS`):

```bash
git log --oneline -20
git revert <sha>
```

Deploy that revert the same way as any other app release. Do not run a schema rollback. The primary key stays `(person_id, kind, seq)`. `ET_MULTI_EVENT_WRITES` is unchanged by this release and unchanged by the revert.

## If any indictment row has seq > 0

Before reverting, on lab and on Render, read (do not write):

```sql
SELECT person_id, kind, seq, event_date, unsealed
  FROM public.person_events
 WHERE kind IN ('indictment_civilian', 'indictment_non_civilian')
   AND seq > 0
 ORDER BY person_id, kind, seq;
```

Also look at `people.events` for those people. A second indictment lives in that JSON as well as in `person_events`.

- **No rows.** Revert. Nothing else to check. Existing `seq` 0 indictment rows were not modified by this release.
- **Rows exist and you still want those second indictments.** Do not revert yet. The reverted app treats an indictment kind as one event at `seq` 0. The next save of that person folds the extra indictment into the `seq` 0 event (`uniqueEvents` / `syncPersonEvents`). `syncPersonEvents` deletes that person's `person_events` rows and inserts the folded set, so the `seq` > 0 companion row goes away on that save. Logical replication and gap-upsert then carry that delete. The revert itself does not delete anything.
- **Rows exist and you are reverting on purpose.** Copy the `seq` > 0 rows and the matching `people.events` first (a `SELECT` into a lab-local table, or a file outside the repo). After the revert, do not save those people until you have decided what to keep. A save on the reverted app drops the extra indictment down to one event.

`seq` 0 indictment rows are not part of that check. Leave them. Do not `DELETE` from `person_events` as part of this revert.
