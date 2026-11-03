# Undo

Each release is its own section. None of these sections run DDL. The `person_events` primary key `(person_id, kind, seq)` and the multi-event migration files are in [MIGRATION.md](MIGRATION.md).

## 1.2.41 (repeatable endorsements)

This release is app code only. It adds `endorsement` to `REPEATABLE_EVENT_KINDS` in `app/lib/promote.mjs`, and it adds the person category `endorsement` (label Endorsement, list `/endorsement`, keymap `j`). `people.category` is text. The death-date check allows any non-death category, so this release adds no DDL and no migration file. See [MIGRATION.md](MIGRATION.md). It does not migrate rows and it does not rewrite existing `person_events` rows. An endorsement that was already stored is still `seq` 0 until someone saves that person with a second endorsement while `ET_MULTI_EVENT_WRITES` is exactly `on`. Revert removes the category from the app. A row already stored with `category = endorsement` stays in the database; the reverted app has no list page for it.

There is no migration file for this release. The database already allows any kind to repeat. See [MIGRATION.md](MIGRATION.md). Revert does not need a schema rollback.

With the switch off, the survivor is the stored seq 0 entry of each kind in `FOLD_WHEN_OFF_KINDS` (today `endorsement`). Later rows merge with `mergePersonEvent`: non-empty stored fields stay, and blank fields, cites, media, headcount, age, and screenshot fill from the incoming row. Postgres, the in-memory store, and the file store do this on save, including a save after the switch is turned off. `seq` above 0 is written only when the switch is on. `notable` and `red_folder` are not in that set; a `seq` above 0 row of those kinds is still refused while the switch is off. `/endorsement` lists people whose card category is endorsement. The dashboard endorsement count is that card count.

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
- **Rows exist.** Copy those `person_events` rows and the matching `people.events` before any save after the revert. The reverted app is main's merge: `uniqueEvents` walks the event list newest first and keeps the first endorsement it sees, so the newer date and comments overwrite the stored seq 0 row. That is the opposite of this release's flag-off fold. A save then deletes the `seq` > 0 companion row. Logical replication and gap-upsert carry that delete. The revert itself does not delete anything. Do not save those people until the copy is made and you have decided what to keep.

`seq` 0 endorsement rows are not part of that check. Leave them. Do not `DELETE` from `person_events` as part of this revert.
