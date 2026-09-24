-- Corona PersonEventSection attrs (notable_group, title_note, status).
-- status enum app-normalized: tested_positive | died | self_quarantine.
-- Died status is corona section only — never auto death KEEP.
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS notable_group TEXT;
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS title_note TEXT;
ALTER TABLE person_events ADD COLUMN IF NOT EXISTS status TEXT;

-- Epstein flight legs (lab → Render checklist B). Hide person-detail when empty.
CREATE TABLE IF NOT EXISTS epstein_flight_legs (
  id BIGSERIAL PRIMARY KEY,
  passenger_name_raw TEXT NOT NULL,
  passenger_first TEXT,
  passenger_last TEXT,
  passenger_first_last TEXT,
  flight_date DATE NOT NULL,
  dep_code TEXT,
  arr_code TEXT,
  dep TEXT NOT NULL DEFAULT '',
  arr TEXT NOT NULL DEFAULT '',
  aircraft_model TEXT,
  aircraft_tail TEXT,
  aircraft_type TEXT,
  aircraft TEXT NOT NULL DEFAULT '',
  flight_no TEXT,
  pass_no TEXT,
  unique_key TEXT,
  comment TEXT,
  data_source TEXT,
  source_url TEXT,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS epstein_flight_legs_uniq
  ON epstein_flight_legs (
    passenger_name_raw,
    flight_date,
    dep,
    arr,
    aircraft
  );

CREATE INDEX IF NOT EXISTS epstein_flight_legs_person_idx
  ON epstein_flight_legs (person_id)
  WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS epstein_flight_legs_passenger_idx
  ON epstein_flight_legs (passenger_name_raw);
