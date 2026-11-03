# Undo

Each release is its own section. None of these sections run DDL. The `person_events` primary key `(person_id, kind, seq)` and the multi-event migration files are in [MIGRATION.md](MIGRATION.md).

## 1.2.41 (repeatable endorsements)

This release is app code only. It adds `endorsement` to `REPEATABLE_EVENT_KINDS` in `app/lib/promote.mjs`, and it adds the person category `endorsement` (label Endorsement, list `/endorsement`, keymap `j`). `people.category` is text. The death-date check allows any non-death category, so this release adds no DDL and no migration file. See [MIGRATION.md](MIGRATION.md). It does not migrate rows and it does not rewrite existing `person_events` rows. An endorsement that was already stored is still `seq` 0 until someone saves that person with a second endorsement while `ET_MULTI_EVENT_WRITES` is exactly `on`. Revert removes the category from the app. A row already stored with `category = endorsement` stays in the database; the reverted app has no list page for it.

There is no migration file for this release. The database already allows any kind to repeat. See [MIGRATION.md](MIGRATION.md). Revert does not need a schema rollback.

With the switch off, a Postgres save folds every endorsement on that person into one `seq` 0 event: the first endorsement in the event list keeps its date and comments, and later endorsements merge their cites into that row. The save succeeds. `seq` above 0 is written only when the switch is on. `notable` and `red_folder` are not folded; a `seq` above 0 row of those kinds is still refused while the switch is off.

`notable` and `red_folder` stay repeatable. Every other kind stays one event per kind at `seq` 0.

### Revert the commit

On the default branch, revert the 1.2.41 commit (the commit that sets `package.json` to `1.2.41` and adds `endorsement` to `REPEATABLE_EVENT_KINDS`):

```bash
git log --oneline -20
git revert <sha>
```

Deploy that revert the same way as any other app release. Do not run a schema rollback. The primary key stays `(person_id, kind, seq)`. `ET_MULTI_EVENT_WRITES` is unchanged by this release and unchanged by the revert.

### If any endorsement row has seq > 0

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
- **Rows exist and you still want those second endorsements.** Do not revert yet. The reverted app treats `endorsement` as one event at `seq` 0. The next save of that person folds the extra endorsement into the `seq` 0 event (`uniqueEvents` / `syncPersonEvents`). `syncPersonEvents` deletes that person's `person_events` rows and inserts the folded set, so the `seq` > 0 companion row goes away on that save. Logical replication and gap-upsert then carry that delete. The revert itself does not delete anything. The same fold already happens on a Postgres save while `ET_MULTI_EVENT_WRITES` is off, without reverting.
- **Rows exist and you are reverting on purpose.** Copy the `seq` > 0 rows and the matching `people.events` first (a `SELECT` into a lab-local table, or a file outside the repo). After the revert, do not save those people until you have decided what to keep. A save on the reverted app drops the extra endorsement down to one event.

`seq` 0 endorsement rows are not part of that check. Leave them. Do not `DELETE` from `person_events` as part of this revert.

## 1.2.37 (repeatable indictments)

This section is the undo for the earlier indictment-repeatable change (commit `df038f6` on `cursor/repeatable-indictments-0cd4`, PR #245). That change is not on `main`. It is included here so this file and that PR's `docs/UNDO.md` are the same kind of section and can be merged as two release sections. It is app code only. It adds `indictment_civilian` and `indictment_non_civilian` to `REPEATABLE_EVENT_KINDS` in `app/lib/promote.mjs`. It does not run DDL, it does not migrate rows, and it does not rewrite existing `person_events` rows. An indictment that was already stored is still `seq` 0 until someone saves that person with a second indictment. Schema context is [MIGRATION.md](MIGRATION.md).

`notable` and `red_folder` stay repeatable. Every other kind stays one event per kind at `seq` 0.

### Revert the commit

On the default branch, revert the 1.2.37 commit (the commit that sets `package.json` to `1.2.37` and adds the two indictment kinds to `REPEATABLE_EVENT_KINDS`):

```bash
git log --oneline -20
git revert <sha>
```

Deploy that revert the same way as any other app release. Do not run a schema rollback. The primary key stays `(person_id, kind, seq)`. `ET_MULTI_EVENT_WRITES` is unchanged by this release and unchanged by the revert.

### If any indictment row has seq > 0

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
