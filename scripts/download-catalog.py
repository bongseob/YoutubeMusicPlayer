"""Export all available TJ/KY metadata from the documented public API.

This is a metadata snapshot, not a YouTube playlist or an official completeness
certification. It deliberately leaves youtube_url blank.
"""
import argparse
import csv
import hashlib
import json
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ENDPOINT = 'https://api.manana.kr/v2/karaoke/search.json'
FIELDS = ['brand', 'song_number', 'title', 'artist', 'tj_number', 'ky_number',
          'youtube_url', 'release_date', 'composer', 'lyricist', 'source_url']


def get_page(page, size):
    url = ENDPOINT + '?' + urlencode({'limit': size, 'page': page, 'orderBy': 'brand ASC, no ASC'})
    for attempt in range(3):
        try:
            request = Request(url, headers={'User-Agent': 'MyTJKaraoke-CatalogExporter/1.0'})
            with urlopen(request, timeout=60) as response:
                result = json.load(response)
            if result.get('page') != page or result.get('limit') != size or not isinstance(result.get('data'), list):
                raise ValueError('API pagination did not match the request')
            return result
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='examples/catalog')
    parser.add_argument('--page-size', type=int, default=20000)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc).isoformat()
    records = {}
    seen = Counter()
    skipped = []
    duplicate_count = 0
    totals = []
    page = 1
    while True:
        payload = get_page(page, args.page_size)
        total = int(payload['total']['row'])
        pages = int(payload['total']['page'])
        totals.append(total)
        for row in payload['data']:
            brand = row.get('brand')
            seen[brand] += 1
            if brand not in ('tj', 'kumyoung'):
                continue
            number = str(row.get('no') or '').strip()
            title = str(row.get('title') or '').strip()
            if not number or not title:
                skipped.append({'brand': brand, 'song_number': number, 'title': title, 'reason': 'missing_number_or_title'})
                continue
            key = (brand, number)
            if key in records:
                duplicate_count += 1
            records[key] = {
                'brand': 'TJ' if brand == 'tj' else 'KY',
                'song_number': number,
                'title': title,
                'artist': str(row.get('singer') or ''),
                'tj_number': number if brand == 'tj' else '',
                'ky_number': number if brand == 'kumyoung' else '',
                'youtube_url': '',
                'release_date': str(row.get('release') or ''),
                'composer': str(row.get('composer') or ''),
                'lyricist': str(row.get('lyricist') or ''),
                'source_url': ENDPOINT,
            }
        print(f'Page {page}/{pages}; TJ/KY unique valid records: {len(records):,}', flush=True)
        if page >= pages:
            break
        page += 1
        time.sleep(0.25)

    rows = sorted(records.values(), key=lambda r: (r['brand'], len(r['song_number']), r['song_number']))
    files = {}
    for name, selected in [('tj-catalog.csv', [r for r in rows if r['brand'] == 'TJ']),
                           ('ky-catalog.csv', [r for r in rows if r['brand'] == 'KY']),
                           ('tj-ky-combined-catalog.csv', rows)]:
        path = output / name
        with path.open('w', encoding='utf-8-sig', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator='\r\n')
            writer.writeheader()
            writer.writerows(selected)
        # Validate persisted CSV, including BOM, quoted fields and row counts.
        with path.open(encoding='utf-8-sig', newline='') as handle:
            readback = list(csv.DictReader(handle))
        assert len(readback) == len(selected)
        assert all(r['title'] and r['song_number'] and not r['youtube_url'] for r in readback)
        assert len({(r['brand'], r['song_number']) for r in readback}) == len(readback)
        files[name] = {'rows': len(selected), 'bytes': path.stat().st_size,
                       'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

    report = {
        'started_at_utc': started, 'finished_at_utc': datetime.now(timezone.utc).isoformat(),
        'source': ENDPOINT, 'source_docs': 'https://api.manana.kr/v2/karaoke/search',
        'official_vendor_catalog': False, 'vendor_completeness_verified': False,
        'youtube_links_included': False, 'pages_downloaded': page,
        'api_total_first': totals[0], 'api_total_last': totals[-1],
        'api_total_changed_during_download': len(set(totals)) > 1,
        'rows_seen_by_brand': dict(seen), 'skipped_invalid_rows': skipped,
        'duplicate_brand_numbers': duplicate_count, 'files': files,
    }
    (output / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': files, 'skipped': len(skipped), 'duplicates': duplicate_count}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
