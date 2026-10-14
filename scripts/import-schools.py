#!/usr/bin/env python3
"""Import the official 2025–26 NCES CCD directory with Python's standard library.

Run from the project directory:
  python scripts/import-schools.py --input /path/to/ccd.zip --as-of 2026-10-13
Omit --input to download the pinned official release into .cache/nces.
Use the same --as-of and --imported-at values for byte-identical regeneration.
No output is replaced until the entire source and generated directory validate.
"""
import argparse
import collections
import csv
import hashlib
import io
import json
import os
import pathlib
import re
import tempfile
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timezone

SOURCE_URL = 'https://nces.ed.gov/ccd/data/zip/ccd_sch_029_2526_w_0a_050626.zip'
RELEASE_URL = 'https://nces.ed.gov/use-work/dataset/2025-26-common-core-data-ccd-preliminary-directory-files'
FIELD_URL = 'https://nces.ed.gov/ccd/data/txt/Code_to_create_SCH_Directory_File_2025-26_0a.txt'
RELEASE_NOTES_URL = 'https://nces.ed.gov/ccd/doc/SY_2025-26_Preliminary_Data_Release_CCD_Nonfiscal_Release_Notes.docx'
STATE_NOTES_URL = 'https://nces.ed.gov/ccd/xls/SY_2025-26_0a_Preliminary_Directory_Data_Notes.xlsx'
SOURCE_YEAR = '2025–26'
COMPACT_COLUMNS = ('id', 'name', 'district', 'districtId', 'city', 'state', 'zip',
                   'address', 'grades', 'type', 'charter', 'website', 'phone', 'sourceYear')
STATES = set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split())
ACTIVE_STATUSES = {'1', '3', '4', '5', '8'}
STATUS_NAMES = {'1': 'Open', '2': 'Closed', '3': 'New', '4': 'Added',
                '5': 'Changed boundary/agency', '6': 'Inactive', '7': 'Future', '8': 'Reopened'}
SCHOOL_TYPES = {'1': 'Regular', '2': 'Special education',
                '3': 'Career and technical', '4': 'Alternative'}
GRADE_CODES = ['PK', 'KG'] + [str(n) for n in range(1, 14)]
MISSING = {'', 'Not reported', 'Not applicable', 'Missing', 'M', 'N', '-1', '-2', '-9'}
COVERAGE_NOTES = [
    'Eligible public schools physically located in the 50 states and Washington, DC, including schools reported by federal agencies. Coverage follows this preliminary release, not every school operating today.',
    'Directory facts use the October 1, 2025 snapshot. The preliminary files were announced July 14, 2026 and contain submissions available as of May 6, 2026. Status updates are applied only when their documented effective date has arrived by statusAsOf.',
    'The release notes document no state-specific data quality concerns or whole-state directory omissions. They identify missing grades-offered metadata for American Samoa, which is outside this directory’s geographic scope.',
    'State notes explain that some correctional facilities, serving schools, career and technical centers, and public centers report no grades because students are counted at their home or sending school. Examples include Alabama, Illinois, Maine, New Jersey, and Virginia. Schools without documented grades 9–12 cannot be classified here.',
    'Ungraded-only and adult-education-only records are excluded unless grades 9–12 are explicitly offered or a valid numeric span supplies a documented fallback. South Carolina did not submit its ungraded-instruction metadata; its reported school grade flags are used without inference.',
]


def value(row, key):
    text = (row.get(key) or '').strip()
    return '' if text in MISSING else text


def numeric_span(row):
    low, high = value(row, 'GSLO'), value(row, 'GSHI')
    if not (low.isdecimal() and high.isdecimal()):
        return None
    low, high = int(low), int(high)
    return (low, high) if 1 <= low <= high <= 13 else None


def offered_grades(row):
    """Return high-school eligibility, faithful label, and fallback indicator."""
    high_flags = [value(row, f'G_{n}_OFFERED') for n in (9, 10, 11, 12)]
    if 'Yes' in high_flags:
        eligible = True
    elif all(flag == 'No' for flag in high_flags):
        eligible = False
    else:
        span = numeric_span(row)
        if all(flag not in ('Yes', 'No') for flag in high_flags) and span:
            low, high = span
            return low <= 12 and high >= 9, f'{low}–{high}' if low != high else str(low), True
        return None, '', False
    codes = [code for code in GRADE_CODES if value(row, f'G_{code}_OFFERED') == 'Yes']
    parts = []
    index = 0
    while index < len(codes):
        end = index
        while end + 1 < len(codes) and GRADE_CODES.index(codes[end + 1]) == GRADE_CODES.index(codes[end]) + 1:
            end += 1
        label = lambda code: 'K' if code == 'KG' else code
        parts.append(label(codes[index]) if index == end else f'{label(codes[index])}–{label(codes[end])}')
        index = end + 1
    for code, label in [('UG', 'Ungraded'), ('AE', 'Adult education')]:
        if value(row, f'G_{code}_OFFERED') == 'Yes':
            parts.append(label)
    return eligible, ', '.join(parts), False


def effective_status(row, as_of):
    start, updated = value(row, 'SY_STATUS'), value(row, 'UPDATED_STATUS')
    raw_date = value(row, 'EFFECTIVE_DATE')
    effective = None
    if raw_date:
        for pattern in ('%m/%d/%Y', '%Y-%m-%d'):
            try:
                effective = datetime.strptime(raw_date, pattern).date()
                break
            except ValueError:
                pass
    use_update = updated in STATUS_NAMES and effective is not None and effective <= as_of
    return updated if use_update else start, updated in STATUS_NAMES and effective is None


def safe_website(raw):
    if not raw or any(ord(c) < 33 for c in raw):
        return ''
    try:
        url = urllib.parse.urlsplit(raw)
        if url.scheme.lower() in ('http', 'https') and url.hostname and '.' in url.hostname and not url.username and not url.password:
            url.port  # Invalid port declarations are rejected as well.
            return raw
    except ValueError:
        pass
    return ''


def normalized_sort(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))


def normalize_dataset(rows, as_of):
    records, seen, duplicates = [], set(), set()
    report = {
        'totalInputRecords': 0, 'eligibleCount': 0, 'countsByState': {},
        'excludedCounts': {}, 'duplicateIds': [], 'missingRequiredFields': {},
        'unknownGradeRecords': [], 'gradeFallbackIds': [], 'invalidStatusDates': [],
        'invalidWebsiteIds': [], 'invalidZipIds': [], 'missingFieldRecords': [],
        'statusChanges': [],
    }
    excluded, missing, counts = collections.Counter(), collections.Counter(), collections.Counter()
    for row in rows:
        report['totalInputRecords'] += 1
        school_id = value(row, 'NCESSCH')
        if school_id in seen:
            duplicates.add(school_id)
        if school_id:
            seen.add(school_id)
        if value(row, 'SCHOOL_YEAR') != '2025-2026':
            raise ValueError(f'Unexpected source year for {school_id or "unidentified record"}')
        high_school, grade_label, fallback = offered_grades(row)
        status, invalid_date = effective_status(row, as_of)
        if invalid_date:
            report['invalidStatusDates'].append({'id': school_id, 'effectiveDate': row.get('EFFECTIVE_DATE', '')})
        if status != value(row, 'SY_STATUS'):
            report['statusChanges'].append({'id': school_id, 'startCode': row.get('SY_STATUS', ''),
                                           'updatedCode': row.get('UPDATED_STATUS', ''),
                                           'effectiveDate': row.get('EFFECTIVE_DATE', '')})
        if high_school is None:
            report['unknownGradeRecords'].append({'id': school_id, 'name': value(row, 'SCH_NAME'),
                                                  'state': value(row, 'LSTATE'), 'statusCode': status,
                                                  'lowestGrade': row.get('GSLO', ''), 'highestGrade': row.get('GSHI', '')})
        if fallback:
            report['gradeFallbackIds'].append(school_id)
        if value(row, 'LSTATE') not in STATES:
            excluded['outside50StatesAndDC'] += 1
            continue
        if status not in ACTIVE_STATUSES:
            excluded[{'2': 'closed', '6': 'inactive', '7': 'future'}.get(status, 'unknownStatus')] += 1
            continue
        if high_school is None:
            excluded['unknownGrades'] += 1
            continue
        if not high_school:
            excluded['noHighSchoolGrades'] += 1
            continue
        if not re.fullmatch(r'\d{12}', school_id):
            raise ValueError(f'Missing or invalid NCES school ID: {school_id!r}')
        raw_website = value(row, 'WEBSITE')
        website = safe_website(raw_website)
        if raw_website and not website:
            report['invalidWebsiteIds'].append(school_id)
        postal_code = value(row, 'LZIP')
        if postal_code and not re.fullmatch(r'\d{5}', postal_code):
            report['invalidZipIds'].append(school_id)
            postal_code = ''
        record = {
            'id': school_id, 'name': value(row, 'SCH_NAME'),
            'district': value(row, 'LEA_NAME'), 'districtId': value(row, 'LEAID'),
            'city': value(row, 'LCITY'), 'state': value(row, 'LSTATE'), 'zip': postal_code,
            'address': ', '.join(value(row, key) for key in ('LSTREET1', 'LSTREET2', 'LSTREET3') if value(row, key)),
            'grades': grade_label, 'type': SCHOOL_TYPES.get(value(row, 'SCH_TYPE'), ''),
            'charter': value(row, 'CHARTER_TEXT') == 'Yes',
            'website': website, 'phone': value(row, 'PHONE'), 'sourceYear': SOURCE_YEAR,
            'status': STATUS_NAMES[status], 'statusCode': status,
            'sourceStatus': {'startCode': row.get('SY_STATUS', ''), 'startText': row.get('SY_STATUS_TEXT', ''),
                             'updatedCode': row.get('UPDATED_STATUS', ''), 'updatedText': row.get('UPDATED_STATUS_TEXT', ''),
                             'effectiveDate': row.get('EFFECTIVE_DATE', '')},
        }
        missing_fields = [key for key in ('name', 'district', 'districtId', 'city', 'state', 'zip', 'address', 'grades', 'type') if not record[key]]
        missing.update(missing_fields)
        if missing_fields:
            report['missingFieldRecords'].append({'id': school_id, 'fields': missing_fields})
        records.append(record)
        counts[record['state']] += 1
    if duplicates:
        raise ValueError('Duplicate NCES school IDs: ' + ', '.join(sorted(duplicates)))
    records.sort(key=lambda school: (normalized_sort(school['name']), school['state'], normalized_sort(school['city']), school['id']))
    report.update(eligibleCount=len(records), countsByState=dict(sorted(counts.items())),
                  excludedCounts=dict(sorted(excluded.items())), missingRequiredFields=dict(sorted(missing.items())))
    if report['totalInputRecords'] != len(records) + sum(excluded.values()):
        raise ValueError('Import counts do not reconcile')
    return records, report


def read_rows(input_path):
    def parse(stream):
        reader = csv.DictReader(stream)
        required = {'SCHOOL_YEAR', 'NCESSCH', 'SCH_NAME', 'LEA_NAME', 'LEAID',
                    'LSTATE', 'LCITY', 'LZIP', 'LSTREET1', 'SY_STATUS',
                    'UPDATED_STATUS', 'EFFECTIVE_DATE', 'GSLO', 'GSHI', 'SCH_TYPE'}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError('Missing source columns: ' + ', '.join(sorted(missing)))
        rows = list(reader)
        if not rows or any(None in row for row in rows):
            raise ValueError('Empty or malformed directory CSV')
        return rows
    if input_path.suffix.lower() == '.zip':
        with zipfile.ZipFile(input_path) as archive:
            corrupt = archive.testzip()
            if corrupt:
                raise ValueError('Corrupt source ZIP member: ' + corrupt)
            names = [name for name in archive.namelist() if name.lower().endswith('.csv')]
            if len(names) != 1:
                raise ValueError('Expected exactly one CSV in the source ZIP')
            with io.TextIOWrapper(archive.open(names[0]), encoding='utf-8-sig', newline='') as stream:
                return parse(stream)
    with input_path.open(encoding='utf-8-sig', newline='') as stream:
        return parse(stream)


def markdown_report(source, audit):
    lines = [
        '# NCES directory import report', '',
        f"Source: [{source['sourceYear']} preliminary CCD directory]({RELEASE_URL}).",
        f"Snapshot: {source['snapshotDate']}. Release data as of: {source['releaseAsOfDate']}. Status evaluated as of: {source['statusAsOf']}.",
        f"Imported at: {source['importedAt']}. Source SHA-256: `{source['sourceSha256']}`.", '',
        f"Input records: **{audit['totalInputRecords']:,}**. Eligible schools: **{audit['eligibleCount']:,}**. Duplicate IDs: **0**.",
        f"Unknown-grade records across the full source: **{len(audit['unknownGradeRecords']):,}**. Numeric grade-span fallbacks: **{len(audit['gradeFallbackIds']):,}**.",
        f"Updated statuses applied: **{len(audit['statusChanges']):,}**. Invalid effective dates: **{len(audit['invalidStatusDates']):,}**.",
        f"Unusable website links omitted: **{len(audit['invalidWebsiteIds']):,}**. Invalid physical ZIPs omitted: **{len(audit['invalidZipIds']):,}**.", '',
        '## Coverage notes', '',
    ]
    lines.extend('- ' + note for note in source['coverageNotes'])
    lines.extend(['', f'[Release notes]({RELEASE_NOTES_URL}), [state data notes]({STATE_NOTES_URL}), and [field definitions]({FIELD_URL}) were inspected for this release.', '',
                  '## Exclusions', '', '| Reason | Records |', '| --- | ---: |'])
    lines.extend(f'| {key} | {count:,} |' for key, count in audit['excludedCounts'].items())
    lines.extend(['', '## Missing required facts among eligible schools', '', '| Field | Records |', '| --- | ---: |'])
    lines.extend(f'| {key} | {count:,} |' for key, count in audit['missingRequiredFields'].items())
    if not audit['missingRequiredFields']:
        lines.append('| None | 0 |')
    lines.extend(['', '## Eligible schools by physical state', '', '| State | Schools |', '| --- | ---: |'])
    lines.extend(f'| {state} | {count:,} |' for state, count in source['countsByState'].items())
    lines.extend(['', '## Reproduce the import', '', '```powershell',
                  f'python scripts/import-schools.py --input path/to/ccd_sch_029_2526_w_0a_050626.zip --as-of {source["statusAsOf"]} --imported-at {source["importedAt"]}',
                  'python -m unittest discover -s tests -p "test_import_schools.py" -v', '```', '',
                  'Omit `--input` to download the official source. Keep the ZIP outside versioned application data. Generated `docs/import-report.json` records unknown grades, missing facts, rejected links, and status changes. Detailed `app/data/schools.json` preserves original status codes, descriptions, and dates in `sourceStatus` for source auditing. The application can bundle the smaller `app/data/compact-schools.json` array instead. Invalid sources fail before output replacement.', '',
                  'Compact row order: `id, name, district, districtId, city, state, zip, address, grades, type, charter, website, phone, sourceYear`. Every row has 14 fields; charter is boolean and every other field is a string. The compact directory uses the same sorted, status-filtered eligible records.', ''])
    return '\n'.join(lines)


def import_file(input_path, output_dir, as_of, imported_at, require_all_states=True, report_path=None):
    rows = read_rows(pathlib.Path(input_path))
    records, audit = normalize_dataset(rows, as_of)
    if not records:
        raise ValueError('The import produced no eligible schools')
    absent = STATES - set(audit['countsByState'])
    if require_all_states and absent:
        raise ValueError('No eligible schools for states: ' + ', '.join(sorted(absent)))
    source = {
        'sourceYear': SOURCE_YEAR, 'snapshotDate': '2025-10-01', 'releaseDate': '2026-07-14',
        'releaseAsOfDate': '2026-05-06', 'statusAsOf': as_of.isoformat(),
        'sourceUrl': SOURCE_URL, 'releaseUrl': RELEASE_URL, 'fieldDefinitionsUrl': FIELD_URL,
        'releaseNotesUrl': RELEASE_NOTES_URL, 'stateDataNotesUrl': STATE_NOTES_URL,
        'sourceSha256': hashlib.sha256(pathlib.Path(input_path).read_bytes()).hexdigest(),
        'importedAt': imported_at, 'totalSchools': len(records),
        'totalInputRecords': audit['totalInputRecords'], 'countsByState': audit['countsByState'],
        'coverageNotes': COVERAGE_NOTES, 'excludedCounts': audit['excludedCounts'],
        'unknownGradeCount': len(audit['unknownGradeRecords']),
        'gradeFallbackCount': len(audit['gradeFallbackIds']), 'duplicateIds': [],
        'missingRequiredFields': audit['missingRequiredFields'],
    }
    output_dir = pathlib.Path(output_dir)
    audit_path = pathlib.Path(report_path).with_name('import-report.json') if report_path is not None else output_dir / 'import-report.json'
    compact = [[record[column] for column in COMPACT_COLUMNS] for record in records]
    if any(len(row) != 14 or not isinstance(row[10], bool)
           or any(not isinstance(item, str) for index, item in enumerate(row) if index != 10)
           for row in compact):
        raise ValueError('Invalid compact directory row length or types')
    payloads = {output_dir / 'schools.json': json.dumps(records, ensure_ascii=False, separators=(',', ':')) + '\n',
                output_dir / 'compact-schools.json': json.dumps(compact, ensure_ascii=False, separators=(',', ':')) + '\n',
                output_dir / 'source.json': json.dumps(source, ensure_ascii=False, separators=(',', ':')) + '\n',
                audit_path: json.dumps(audit, ensure_ascii=False, indent=2) + '\n'}
    if report_path is not None:
        payloads[pathlib.Path(report_path)] = markdown_report(source, audit)
    staged = []
    try:
        for target, content in payloads.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n',
                                             dir=target.parent, delete=False, suffix='.tmp') as stream:
                stream.write(content)
                staged.append((pathlib.Path(stream.name), target))
        for temporary, target in staged:
            os.replace(temporary, target)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    return source, audit


def download_source(destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(SOURCE_URL, headers={'User-Agent': 'RateMyHighschool-CCD-Importer/1.0'})
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False, suffix='.zip') as stream:
        temporary = pathlib.Path(stream.name)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
        except Exception:
            stream.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        read_rows(temporary)  # Validate before caching a downloaded source.
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def main():
    project = pathlib.Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=pathlib.Path, help='Official CCD ZIP or extracted CSV')
    parser.add_argument('--output', type=pathlib.Path, default=project / 'app' / 'data')
    parser.add_argument('--report', type=pathlib.Path, default=project / 'docs' / 'data-import-report.md')
    parser.add_argument('--as-of', type=date.fromisoformat, default=date.today())
    parser.add_argument('--imported-at', default=datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'))
    args = parser.parse_args()
    input_path = args.input or download_source(project / '.cache' / 'nces' / pathlib.Path(SOURCE_URL).name)
    source, audit = import_file(input_path, args.output, args.as_of, args.imported_at, report_path=args.report)
    print(json.dumps({'totalInputRecords': audit['totalInputRecords'], 'totalSchools': source['totalSchools'],
                      'states': len(source['countsByState']), 'excludedCounts': source['excludedCounts'],
                      'fileBytes': {name: (args.output / name).stat().st_size
                                    for name in ('schools.json', 'compact-schools.json', 'source.json')}}, indent=2))


if __name__ == '__main__':
    main()
