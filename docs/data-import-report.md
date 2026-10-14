# NCES directory import report

Source: [2025–26 preliminary CCD directory](https://nces.ed.gov/use-work/dataset/2025-26-common-core-data-ccd-preliminary-directory-files).
Snapshot: 2025-10-01. Release data as of: 2026-05-06. Status evaluated as of: 2026-10-13.
Imported at: 2026-10-13T22:17:23Z. Source SHA-256: `b5d8dc341ecdc85549ffa9ba5accf4c4ed4f2a7c4a78a5115bbd281ef3e23bc8`.

Input records: **102,102**. Eligible schools: **28,868**. Duplicate IDs: **0**.
Unknown-grade records across the full source: **2,410**. Numeric grade-span fallbacks: **0**.
Updated statuses applied: **20**. Invalid effective dates: **0**.
Unusable website links omitted: **44**. Invalid physical ZIPs omitted: **0**.

## Coverage notes

- Eligible public schools physically located in the 50 states and Washington, DC, including schools reported by federal agencies. Coverage follows this preliminary release, not every school operating today.
- Directory facts use the October 1, 2025 snapshot. The preliminary files were announced July 14, 2026 and contain submissions available as of May 6, 2026. Status updates are applied only when their documented effective date has arrived by statusAsOf.
- The release notes document no state-specific data quality concerns or whole-state directory omissions. They identify missing grades-offered metadata for American Samoa, which is outside this directory’s geographic scope.
- State notes explain that some correctional facilities, serving schools, career and technical centers, and public centers report no grades because students are counted at their home or sending school. Examples include Alabama, Illinois, Maine, New Jersey, and Virginia. Schools without documented grades 9–12 cannot be classified here.
- Ungraded-only and adult-education-only records are excluded unless grades 9–12 are explicitly offered or a valid numeric span supplies a documented fallback. South Carolina did not submit its ungraded-instruction metadata; its reported school grade flags are used without inference.

[Release notes](https://nces.ed.gov/ccd/doc/SY_2025-26_Preliminary_Data_Release_CCD_Nonfiscal_Release_Notes.docx), [state data notes](https://nces.ed.gov/ccd/xls/SY_2025-26_0a_Preliminary_Directory_Data_Notes.xlsx), and [field definitions](https://nces.ed.gov/ccd/data/txt/Code_to_create_SCH_Directory_File_2025-26_0a.txt) were inspected for this release.

## Exclusions

| Reason | Records |
| --- | ---: |
| closed | 1,189 |
| future | 280 |
| inactive | 453 |
| noHighSchoolGrades | 69,834 |
| outside50StatesAndDC | 1,002 |
| unknownGrades | 476 |

## Missing required facts among eligible schools

| Field | Records |
| --- | ---: |
| None | 0 |

## Eligible schools by physical state

| State | Schools |
| --- | ---: |
| AK | 285 |
| AL | 552 |
| AR | 377 |
| AZ | 965 |
| CA | 2,787 |
| CO | 532 |
| CT | 223 |
| DC | 48 |
| DE | 59 |
| FL | 1,298 |
| GA | 530 |
| HI | 71 |
| IA | 373 |
| ID | 300 |
| IL | 1,073 |
| IN | 507 |
| KS | 410 |
| KY | 514 |
| LA | 380 |
| MA | 419 |
| MD | 280 |
| ME | 124 |
| MI | 1,315 |
| MN | 1,219 |
| MO | 751 |
| MS | 405 |
| MT | 194 |
| NC | 765 |
| ND | 189 |
| NE | 343 |
| NH | 105 |
| NJ | 543 |
| NM | 265 |
| NV | 180 |
| NY | 1,473 |
| OH | 1,077 |
| OK | 490 |
| OR | 364 |
| PA | 789 |
| RI | 73 |
| SC | 332 |
| SD | 200 |
| TN | 508 |
| TX | 2,646 |
| UT | 365 |
| VA | 370 |
| VT | 71 |
| WA | 814 |
| WI | 639 |
| WV | 162 |
| WY | 114 |

## Reproduce the import

```powershell
python scripts/import-schools.py --input path/to/ccd_sch_029_2526_w_0a_050626.zip --as-of 2026-10-13 --imported-at 2026-10-13T22:17:23Z
python -m unittest discover -s tests -p "test_import_schools.py" -v
```

Omit `--input` to download the official source. Keep the ZIP outside versioned application data. Generated `docs/import-report.json` records unknown grades, missing facts, rejected links, and status changes. Detailed `app/data/schools.json` preserves original status codes, descriptions, and dates in `sourceStatus` for source auditing. The application can bundle the smaller `app/data/compact-schools.json` array instead. Invalid sources fail before output replacement.

Compact row order: `id, name, district, districtId, city, state, zip, address, grades, type, charter, website, phone, sourceYear`. Every row has 14 fields; charter is boolean and every other field is a string. The compact directory uses the same sorted, status-filtered eligible records.
