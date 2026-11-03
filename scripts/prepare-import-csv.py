"""Prepare application-importable TJ/KY CSV files from the catalog snapshot."""
import csv
import hashlib
import json
import re
from pathlib import Path

base = Path(__file__).resolve().parent.parent
source = base / 'examples/catalog/tj-ky-combined-catalog.csv'
output = base / 'examples/import'
output.mkdir(exist_ok=True)

def clean(value):
    return re.sub(r'[\x00-\x1f\x7f]', ' ', value).strip()

with (base / 'examples/tj-songs-starter-20.csv').open(encoding='utf-8-sig', newline='') as handle:
    starter = {str(int(row['tj_number'])): row for row in csv.DictReader(handle)}

records = []
linked = 0
cleaned = 0
with source.open(encoding='utf-8-sig', newline='') as handle:
    for row in csv.DictReader(handle):
        title, artist = clean(row['title']), clean(row['artist'])
        cleaned += (title != row['title'] or artist != row['artist'])
        song = dict(brand=row['brand'], song_number=row['song_number'], title=title, artist=artist, youtube_url='')
        known = starter.get(str(int(row['song_number']))) if row['brand'] == 'TJ' else None
        # Never assign a link using a coincident number from a different brand/artist.
        if known and clean(known['artist']).replace(' ', '').casefold() == artist.replace(' ', '').casefold():
            song['youtube_url'] = known['youtube_url']
            linked += 1
        records.append(song)

files = {}
for name, rows in [('tj-songs-import.csv', [r for r in records if r['brand'] == 'TJ']),
                   ('ky-songs-import.csv', [r for r in records if r['brand'] == 'KY']),
                   ('tj-ky-songs-import.csv', records)]:
    path = output / name
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=['brand', 'song_number', 'title', 'artist', 'youtube_url'], lineterminator='\r\n')
        writer.writeheader()
        writer.writerows(rows)
    assert path.stat().st_size <= 20 * 1024 * 1024
    assert len(rows) <= 120000
    files[name] = {'rows': len(rows), 'bytes': path.stat().st_size,
                   'with_video': sum(bool(row['youtube_url']) for row in rows),
                   'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

report = {'source': str(source.relative_to(base)), 'whitespace_normalized_rows': cleaned,
          'starter_video_links_reused': linked, 'files': files}
(output / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(report, ensure_ascii=False, indent=2))
