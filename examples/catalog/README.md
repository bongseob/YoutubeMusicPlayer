# 태진·금영 곡 정보 CSV

API Manana의 공개 노래목록 API를 페이지 끝까지 조회하고, `tj`와 `kumyoung` 브랜드의 유효한 곡 정보를 CSV로 변환한 스냅샷입니다. **제조사가 인증한 전체 카탈로그가 아니며, 실제 금영·태진 수록곡 전체와 일치하는지는 검증하지 않았습니다.**

## 파일

- `tj-catalog.csv`: 태진(TJ) 곡 목록
- `ky-catalog.csv`: 금영(KY) 곡 목록
- `tj-ky-combined-catalog.csv`: 두 브랜드 통합 목록
- `manifest.json`: 조회 시각·실제 행 수·파일 SHA-256·중복 및 결측 검증 결과

세 CSV는 Excel에서 한글을 열 수 있도록 UTF-8 BOM/CRLF로 저장합니다. 동일 곡도 브랜드가 다르면 별도 행으로 유지합니다. 브랜드와 곡 번호가 같은 행은 한 행으로 합칩니다. 곡 번호나 제목이 없는 원본 행은 제외하고 `manifest.json`에 기록합니다. 원본 데이터가 다운로드 중 갱신되어 전체 건수가 변했는지도 기록합니다.

## 열

| 열 | 의미 |
| --- | --- |
| brand | TJ 또는 KY |
| song_number | 해당 브랜드 곡 번호 |
| title | 곡 제목 |
| artist | 가수 |
| tj_number | TJ 행의 곡 번호, KY 행은 공란 |
| ky_number | KY 행의 곡 번호, TJ 행은 공란 |
| youtube_url | 공란: 이 API는 영상 링크를 제공하지 않음 |
| release_date | 원본 API의 release 값. `0000-00-00` 등은 원본 미상 값 |
| composer | 작곡가 |
| lyricist | 작사가 |
| source_url | 데이터 출처 API |

## 앱 등록용 파일

이 폴더는 출처 메타데이터를 보존하는 원본 카탈로그입니다. 앱에서 바로 가져오려면 [../import/README.md](../import/README.md)의 등록 전용 CSV를 사용하세요. 새 앱은 브랜드·번호를 구분하고, 영상 링크 없는 곡도 검색 목록으로 등록할 수 있습니다. 영상 연결 후 예약·재생할 수 있습니다.

기존 `../tj-songs-starter-20.csv`도 그대로 사용할 수 있습니다.

## 출처 및 재생성

- [API 제공자의 검색 API 문서](https://api.manana.kr/v2/karaoke/search)
- [API 제공자의 이용 안내](https://api.manana.kr/) — 무료 공개 API 안내
- 제조사 사이트나 YouTube 채널을 대량 크롤링하지 않았으며 음원·영상·가사는 내려받지 않았습니다.
- API의 최신성·누락·폐곡 여부·제조사 전곡 일치 여부는 보장하지 않습니다. 정확한 수록 여부는 제조사 검색에서 확인하세요.

프로젝트 루트에서 다음 명령으로 다시 생성할 수 있습니다. Python 3 표준 라이브러리만 사용합니다. 기존 생성 CSV는 새 스냅샷으로 덮어씁니다.

```sh
python3 scripts/download-catalog.py
```
