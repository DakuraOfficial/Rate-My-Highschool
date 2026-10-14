"""Regression tests for source inclusion and safe, reproducible directory imports."""
import importlib.util
import csv
import json
import pathlib
import tempfile
import unittest
import zipfile
from datetime import date

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'import-schools.py'
if SCRIPT.exists():
    spec = importlib.util.spec_from_file_location('school_importer', SCRIPT)
    importer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(importer)
else:
    importer = None


def school(**changes):
    # Synthetic fixture exercises documented NCES fields; it is never app data.
    row = {
        'SCHOOL_YEAR': '2025-2026', 'NCESSCH': '010000500871',
        'SCH_NAME': 'Combined Academy', 'LEA_NAME': 'Example District',
        'LEAID': '0100005', 'ST': 'AL', 'LSTATE': 'AL', 'LCITY': 'Example',
        'LZIP': '01234', 'LSTREET1': '1 Example Road', 'LSTREET2': '',
        'LSTREET3': '', 'SY_STATUS': '1', 'SY_STATUS_TEXT': 'Open',
        'UPDATED_STATUS': '1', 'UPDATED_STATUS_TEXT': 'Open',
        'EFFECTIVE_DATE': '10/01/2025', 'SCH_TYPE': '1', 'CHARTER_TEXT': 'No',
        'GSLO': 'PK', 'GSHI': '12', 'PHONE': '', 'WEBSITE': '',
        'NOGRADES': 'No', 'G_PK_OFFERED': 'Yes', 'G_KG_OFFERED': 'Yes',
        'G_13_OFFERED': 'No', 'G_UG_OFFERED': 'No', 'G_AE_OFFERED': 'No',
    }
    row.update({f'G_{grade}_OFFERED': 'Yes' for grade in range(1, 13)})
    row.update(changes)
    return row


class ImportSchoolsTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importer, 'The directory importer has not been implemented')

    def normalize(self, rows):
        return importer.normalize_dataset(rows, date(2026, 10, 13))

    def test_combined_school_is_included_without_high_in_name_or_level(self):
        records, report = self.normalize([school(LEVEL='Elementary')])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['grades'], 'PK–12')
        self.assertEqual(report['eligibleCount'], 1)

    def test_ids_and_physical_zip_remain_strings_with_leading_zeros(self):
        records, _ = self.normalize([school(MZIP='99999')])
        self.assertEqual(records[0]['id'], '010000500871')
        self.assertEqual(records[0]['districtId'], '0100005')
        self.assertEqual(records[0]['zip'], '01234')

    def test_federal_reporting_agency_is_included_by_physical_state(self):
        records, _ = self.normalize([school(ST='BI', LSTATE='AZ')])
        self.assertEqual(records[0]['state'], 'AZ')

    def test_closed_inactive_and_future_codes_are_excluded(self):
        rows = [school(NCESSCH=f'01000050087{n}', SY_STATUS=str(n),
                       UPDATED_STATUS=str(n)) for n in (1, 2, 3, 4, 5, 6, 7, 8)]
        records, report = self.normalize(rows)
        self.assertEqual([r['statusCode'] for r in records], ['1', '3', '4', '5', '8'])
        self.assertEqual(report['excludedCounts'], {'closed': 1, 'inactive': 1, 'future': 1})

    def test_updated_status_is_applied_only_when_effective_date_arrives(self):
        rows = [school(UPDATED_STATUS='2', EFFECTIVE_DATE='10/13/2026'),
                school(NCESSCH='010000500872', UPDATED_STATUS='2',
                       EFFECTIVE_DATE='10/14/2026')]
        records, report = self.normalize(rows)
        self.assertEqual([r['id'] for r in records], ['010000500872'])
        self.assertEqual(records[0]['sourceStatus']['updatedCode'], '2')
        self.assertEqual(report['excludedCounts'], {'closed': 1})

    def test_invalid_update_date_keeps_start_status_and_is_audited(self):
        records, report = self.normalize([school(UPDATED_STATUS='2', EFFECTIVE_DATE='bad')])
        self.assertEqual(records[0]['statusCode'], '1')
        self.assertEqual(report['invalidStatusDates'][0]['id'], '010000500871')

    def test_explicit_flags_override_a_conflicting_numeric_span(self):
        changes = {f'G_{n}_OFFERED': 'No' for n in (9, 10, 11, 12)}
        records, report = self.normalize([school(**changes, GSLO='09', GSHI='12')])
        self.assertEqual(records, [])
        self.assertEqual(report['excludedCounts'], {'noHighSchoolGrades': 1})

    def test_numeric_span_fallback_is_recorded_when_flags_are_unavailable(self):
        changes = {f'G_{n}_OFFERED': 'Not reported' for n in (9, 10, 11, 12)}
        records, report = self.normalize([school(**changes, GSLO='07', GSHI='12')])
        self.assertEqual(records[0]['grades'], '7–12')
        self.assertEqual(report['gradeFallbackIds'], ['010000500871'])

    def test_entirely_unknown_grades_are_audited_and_not_invented(self):
        row = school(GSLO='M', GSHI='M')
        row.update({key: 'Not reported' for key in row if key.endswith('_OFFERED')})
        records, report = self.normalize([row])
        self.assertEqual(records, [])
        self.assertEqual(report['unknownGradeRecords'][0]['id'], '010000500871')
        self.assertEqual(report['excludedCounts'], {'unknownGrades': 1})

    def test_noncontiguous_flags_do_not_claim_unoffered_grades(self):
        row = school(GSLO='09')
        row.update({key: 'No' for key in row if key.endswith('_OFFERED')})
        row.update(G_9_OFFERED='Yes', G_11_OFFERED='Yes', G_12_OFFERED='Yes')
        records, _ = self.normalize([row])
        self.assertEqual(records[0]['grades'], '9, 11–12')

    def test_territories_are_excluded_using_physical_location(self):
        records, report = self.normalize([school(ST='TX', LSTATE='PR')])
        self.assertEqual(records, [])
        self.assertEqual(report['excludedCounts'], {'outside50StatesAndDC': 1})

    def test_missing_facts_and_unsafe_websites_are_not_fabricated(self):
        records, report = self.normalize([school(WEBSITE='javascript:alert(1)',
                                               LSTREET1='', LEA_NAME='')])
        self.assertEqual(records[0]['website'], '')
        self.assertEqual(records[0]['address'], '')
        self.assertEqual(records[0]['district'], '')
        self.assertEqual(report['invalidWebsiteIds'], ['010000500871'])
        self.assertEqual(report['missingRequiredFields']['address'], 1)

    def test_duplicate_identifiers_block_the_import(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate NCES school IDs'):
            self.normalize([school(), school(SCH_NAME='Different School')])

    def test_counts_reconcile_and_records_sort_deterministically(self):
        rows = [school(NCESSCH='010000500872', SCH_NAME='Zulu', LSTATE='TX'),
                school(SCH_NAME='Alpha'),
                school(NCESSCH='010000500873', LSTATE='PR')]
        records, report = self.normalize(rows)
        self.assertEqual([r['name'] for r in records], ['Alpha', 'Zulu'])
        self.assertEqual(report['totalInputRecords'], 3)
        self.assertEqual(report['countsByState'], {'AL': 1, 'TX': 1})
        self.assertEqual(sum(report['excludedCounts'].values()) + len(records), 3)

    def test_invalid_download_does_not_replace_existing_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            data = root / 'data'
            data.mkdir()
            (data / 'schools.json').write_text('[{"id":"existing"}]', encoding='utf-8')
            (root / 'bad.zip').write_bytes(b'not a zip')
            with self.assertRaises((ValueError, zipfile.BadZipFile)):
                importer.import_file(root / 'bad.zip', data, date(2026, 10, 13),
                                     '2026-10-13T00:00:00Z', require_all_states=False)
            self.assertEqual(json.loads((data / 'schools.json').read_text()),
                             [{'id': 'existing'}])

    def test_successful_import_keeps_detailed_audit_with_documentation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            row = school()
            with (root / 'source.csv').open('w', encoding='utf-8', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(row))
                writer.writeheader()
                writer.writerow(row)
            importer.import_file(root / 'source.csv', root / 'app' / 'data',
                                 date(2026, 10, 13), '2026-10-13T00:00:00Z',
                                 require_all_states=False,
                                 report_path=root / 'docs' / 'data-import-report.md')
            self.assertTrue((root / 'docs' / 'import-report.json').exists())
            self.assertFalse((root / 'app' / 'data' / 'import-report.json').exists())
            records = json.loads((root / 'app' / 'data' / 'schools.json').read_text(encoding='utf-8'))
            self.assertEqual(records[0]['id'], '010000500871')
            self.assertEqual(records[0]['zip'], '01234')
            source = json.loads((root / 'app' / 'data' / 'source.json').read_text(encoding='utf-8'))
            self.assertEqual(source['totalSchools'], 1)
            self.assertEqual(source['countsByState'], {'AL': 1})

    def test_compact_output_preserves_identifiers_and_status_filtering(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            rows = [school(), school(NCESSCH='010000500872', SY_STATUS='7',
                                     UPDATED_STATUS='7')]
            with (root / 'source.csv').open('w', encoding='utf-8', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            importer.import_file(root / 'source.csv', root / 'data',
                                 date(2026, 10, 13), '2026-10-13T00:00:00Z',
                                 require_all_states=False)
            compact_path = root / 'data' / 'compact-schools.json'
            self.assertTrue(compact_path.exists(), 'The application needs a compact directory')
            compact = json.loads(compact_path.read_text(encoding='utf-8'))
            self.assertEqual(compact, [[
                '010000500871', 'Combined Academy', 'Example District', '0100005',
                'Example', 'AL', '01234', '1 Example Road', 'PK–12', 'Regular',
                False, '', '', '2025–26',
            ]])
            self.assertEqual(len(compact[0]), 14)
            self.assertIsInstance(compact[0][10], bool)
            self.assertTrue(all(isinstance(item, str) for index, item in enumerate(compact[0]) if index != 10))
            detailed = json.loads((root / 'data' / 'schools.json').read_text(encoding='utf-8'))
            self.assertEqual([item[0] for item in compact], [item['id'] for item in detailed])


if __name__ == '__main__':
    unittest.main()
