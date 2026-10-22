-- The server's exercise catalog for the E2E run (CI applies it after the migrations; the API runs with ExerciseCatalog
-- disabled, so nothing downloads ExerciseDB). A single fictitious item: the pair the dictionary gives "Supino reto" (its id),
-- with a GIF URL the test serves itself. No sync mark is written, so the server keeps any well-formed catalog link as is.
INSERT INTO catalog_exercises (id, name, body_parts, target_muscles, secondary_muscles, equipments, gif_url, synced_at)
VALUES ('EIeI8Vf', 'barbell bench press', ARRAY['chest'], ARRAY['pectorals'], ARRAY[]::text[], ARRAY['barbell'],
        'https://static.exercisedb.dev/media/test.gif', '2026-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
