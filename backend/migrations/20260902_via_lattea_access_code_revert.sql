-- Ripristina codice Via Lattea / Mucche Volanti: 050408 → 910689

UPDATE staff_locale_packs
SET access_code = '910689'
WHERE access_code = '050408'
   OR lower(replace(replace(locale_name, '-', ' '), '_', ' ')) LIKE '%via lattea%'
   OR lower(replace(replace(locale_name, '-', ' '), '_', ' ')) LIKE '%mucche volanti%';

INSERT INTO staff_locale_packs (locale_name, members_json, sections_json, access_code)
SELECT 'La Via Lattea', '[]', '[]', '910689'
WHERE NOT EXISTS (
  SELECT 1 FROM staff_locale_packs
  WHERE lower(replace(replace(locale_name, '-', ' '), '_', ' ')) LIKE '%via lattea%'
     OR lower(replace(replace(locale_name, '-', ' '), '_', ' ')) LIKE '%mucche volanti%'
);

UPDATE prima_nota_locale_packs
SET access_code = '910689'
WHERE activity_slug = 'via_lattea'
   OR access_code = '050408';
