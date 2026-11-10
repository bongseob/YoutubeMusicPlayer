# 태진·금영 전곡 영상 대조

전체 곡 목록을 두 공식 채널의 공개 업로드 영상과 대조하는 도구입니다. **각 곡에 대응하는 공개 영상이 모두 존재한다는 뜻은 아닙니다.** 목록은 반주기 수록곡 기준이므로 유튜브 미공개·삭제·비공개·다른 버전·번호 누락 등의 이유로 연결되지 않는 곡이 생깁니다.

기존에 지정한 영상 링크는 유지합니다. 2026-11-03에 실제 API 키로 첫 200개 영상과 143곡 추가 연결을 확인한 뒤 전체 채널 조회를 시작했습니다. 최신 진행 상태와 연결 수는 로컬 report.json 및 DB에서 확인하세요.

## 준비

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 선택하거나 만듭니다.
2. API 라이브러리에서 **YouTube Data API v3**를 활성화합니다.
3. 사용자 인증 정보에서 API 키를 만들고, API 제한을 YouTube Data API v3로 설정합니다.
4. 로컬 `.env`의 아래 입력란에 값을 넣고 저장합니다.

```dotenv
YOUTUBE_DATA_API_KEY=발급받은값
```

이 값은 `ADMIN_TOKEN`과 다른 키입니다. 채팅에 보내지 않아도 됩니다. 스크립트는 서버에서 요청하므로 브라우저 HTTP 리퍼러 전용으로 제한한 키는 사용할 수 없습니다. 키는 `.env`에만 저장하며 Git·브라우저 코드·보고서·요청 URL에 넣지 않습니다.

## 실행

MySQL을 실행한 상태로 프로젝트 루트에서:

```sh
npm run videos:plan   # DB/키 준비 여부 확인. YouTube API 호출·DB 수정 없음
npm run videos:sync   # 전체 공개 영상 조회 및 연결 후보·전곡 상태표 생성
npm run videos:apply  # 공개 목록 조회 후 일치하는 미연결 곡에 적용
npm run videos:apply -- --allow-mr --search-backfill # MR 대체 허용 + 과거 영상 검색 보완
npm run videos:export # 현재 DB의 전체/연결곡/상태 CSV 내보내기
```

`videos:apply`는 별도의 `videos:sync` 실행 없이 바로 시작할 수 있습니다. 이전 조회가 있으면 저장된 페이지부터 이어갑니다. `videos:sync`로 조회만 완료한 뒤 `videos:apply`를 실행하면 같은 캐시로 적용할 수 있습니다.

## 대조 방식

- TJ: `UCZUhx8ClCv6paFW7qi3qljg`
- KY: `UCDqaUIUSJP5EVMEI178Zfag`
- `channels.list`로 실제 업로드 재생목록 ID를 얻고, `playlistItems.list`와 `videos.list`로 페이지당 최대 50개를 조회합니다. 기본 조회는 `search.list`를 사용하지 않습니다. 업로드 목록 API가 실측상 채널당 20,000개에서 끝났으므로 `playlists.list`로 두 채널의 공개 재생목록도 전부 조회합니다. `--search-backfill`을 지정하면 과거 날짜 구간을 나누어 공식 검색도 보완합니다.
- 채널 ID, 공개 상태, 임베드 허용 여부, 지역 제한(KR), 제목, 가수를 검사합니다.
- 영상 설명/제목에 공식 곡 번호가 있으면 브랜드와 번호로 대조합니다. 번호가 여러 개로 충돌하면 자동 적용하지 않습니다.
- 번호가 없으면 같은 브랜드·제목·가수가 DB에서 한 곡으로만 식별되는 경우에만 연결합니다. 버전이 여러 개면 확인 대상으로 남깁니다.
- 여러 기본 영상이 같은 곡에 맞으면 번호 대조가 된 후보를 우선하고, 그 안에서는 최근 업로드를 선택합니다.
- 기존 연결을 덮어쓰지 않으며, 새 링크만 트랜잭션으로 적용합니다. 조회 당시와 DB의 제목·가수가 달라진 행은 적용하지 않습니다.
- 키 변경·메들리 등은 연결하지 않습니다. 기본값은 기본 반주만 연결하며, `--allow-mr`를 지정하면 기본 반주 후보가 없는 곡에 한해 번호가 명시된 공식 멜로디 제거 영상을 허용합니다. 이 작업에서는 사용자의 명시적 선택에 따라 MR 대체를 허용했습니다. 실제 스마트폰에서 영상이 재생되는지까지 검증하는 것은 아닙니다.

## 한도와 이어서 실행

스크립트가 기록하는 요청 한도는 기본 **태평양 시간 날짜당 최대 9,000회**입니다. 검색 보완 요청은 별도로 날짜당 100회로 제한합니다. 검색 API가 최대 500개 결과로 제한되는 경우를 줄이기 위해 결과가 많은 날짜 구간은 더 작은 구간으로 나눕니다. 검색 인덱스 자체의 누락 가능성까지 해소하는 것은 아닙니다. 이는 이 도구가 같은 캐시 안에서 사용한 요청 수이며, 같은 Google 프로젝트의 다른 프로그램 사용량까지 알 수는 없습니다. 실제 API 한도에 도달하면 중단하고 위치를 저장합니다.

```sh
npm run videos:apply -- --allow-mr --search-backfill --max-requests=9000
```

네트워크나 할당량 문제를 해결한 후 같은 명령으로 이어서 실행하세요. 한도가 다음 날 초기화되어도 **프로세스가 자동 재실행되는 것은 아닙니다.** 조회가 멈추면 완료했다고 표시하지 않으며, 미조회 곡은 `pending_scan`으로 남깁니다. 같은 캐시에서 두 작업을 동시에 실행할 수 없습니다.

두 채널을 동시에 조회하고 다음 페이지를 미리 받아 조회 시간을 줄입니다. 상태 파일과 영상 캐시는 순서대로 저장하여 동시 쓰기로 손상되지 않게 합니다.

API 캐시를 29일 넘게 재사용하지 않습니다. 오래된 API 응답 파일을 정리하고 새 캐시 디렉터리에서 다시 조회하세요. 새 캐시 지정 예:

```sh
npm run videos:apply -- --cache-dir=.local/youtube-sync-new
```

## 결과 파일

기본 경로는 `.local/youtube-sync/`이며 Git에서 제외합니다.

| 파일 | 용도 |
| --- | --- |
| `state.json` | 채널별 페이지 위치·완료 여부·도구 요청 수 |
| `videos.jsonl` | 공식 API에서 확인한 영상 메타데이터 |
| `before-apply.json` | 새로 연결할 곡의 원래 DB 행과 후보 근거 |
| `all-songs-status.csv` | DB 전체 곡의 링크와 처리 상태 |
| `matched-import.csv` | 이번 조회에서 찾은 미연결 곡의 등록용 CSV |
| `report.json` | 조회 완료 여부·연결 수·미연결 원인 |

상태표의 의미:

- `linked`: 현재 DB에 영상이 연결됨. 기존 연결을 이번에 다시 검증했다는 의미는 아닙니다.
- `verified_candidate`: 일치하는 후보를 찾았지만 아직 DB에 적용하지 않음.
- `needs_review`: 번호 충돌·제목/가수 불일치 등으로 확인 필요.
- `not_found_in_indexed_public_videos`: 현재까지 확보한 공식 자료에서 자동 연결 조건에 맞는 영상을 찾지 못함. 영상이 절대 없다는 의미는 아닙니다.
- `pending_scan`: 채널 조회가 아직 끝나지 않음.

## 검증 범위

자동 테스트로 브랜드 번호 분리, 다른 채널·가수 거부, 지역 제한, 임베드 금지, 번호 충돌, 모호한 곡 처리, 다중 페이지 순회, 중간 할당량 오류 후 재개를 검사합니다. 실제 API 접근과 일부 페이지의 DB 적용은 검증했습니다. 선택한 조회 단계의 완료 여부는 report.json의 scanComplete 값으로 구분합니다. 전체 채널 공개 영상과의 수집 수 비교는 allPublicVideosCovered, DB 전곡 연결 여부는 allCatalogSongsLinked로 따로 표시합니다. scanComplete=true가 전곡 연결을 뜻하지 않습니다.

공식 문서: [업로드 목록](https://developers.google.com/youtube/data/reference/rest/v3/channels), [재생목록 조회](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list), [영상 조회](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), [할당량](https://developers.google.com/youtube/data/determine_quota_cost).

## 2026-11-04 작업 결과

- DB 전체 114,968곡 중 40,473곡 연결, 74,495곡 미연결.
- 공식 공개 재생목록 804개를 대조했고, 과거 검색 보완 100회를 사용한 시점에서 검색 단계를 중단했습니다.
- 최신 배포용 결과는 [영상 링크 포함 전체 CSV](../examples/import/tj-ky-songs-with-videos.csv), [연결곡 전용 CSV](../examples/import/linked-songs-only.csv), [전곡 상태표](../examples/import/tj-ky-video-link-status.csv)에 있습니다.
- 진행 상태는 `.local/youtube-sync/state.json`에 저장했습니다. 할당량 초기화 후 `npm run videos:apply -- --allow-mr --search-backfill` 명령으로 이어서 실행할 수 있습니다. 자동 재실행 스케줄은 설정하지 않았습니다.
- 제목·가수 불일치, 번호 충돌, 임베드 금지, 공개 목록에서 찾지 못한 곡 등이 남아 있으므로 **전체 곡 연결 완료가 아닙니다**. 임베드 금지 영상이나 공개되지 않은 영상을 앱에서 재생할 수 있다고 가정하지 않습니다.

## 2026-11-07 추가 작업 결과

- 공식 검색 보완 100회와 기존 캐시 재대조로 1,050곡을 추가 연결했습니다(TJ 1,006곡, KY 44곡).
- 연결 41,523곡, 미연결 73,445곡이며 배포용 CSV와 상태표를 갱신했습니다.
- 가수명의 끝에 붙은 `[성인가요]`만 장르 주석으로 처리하도록 개선했습니다. 커버·키 변경·번호 충돌·임베드 불가 검사는 유지합니다.
- 오늘 검색 한도에 도달해 체크포인트를 저장했으며 수집은 아직 미완료입니다. 운영 DB 반영 및 실제 기기 재생 검증은 수행하지 않았습니다.
- 상세 내용은 [미연결 검토 및 작업 결과](unlinked-video-review.md)를 참고하세요.

## 2026-11-08 추가 작업 결과

공식 검색 보완 100회로 TJ 1,320곡을 추가 연결했습니다. 전체 연결은 42,843곡, 미연결은 72,125곡입니다. 오늘 검색 한도에 도달하여 저장 후 중단했으며 아직 수집 미완료입니다. 배포용 전체 CSV와 상태표를 갱신했고 [이번 추가분 CSV](../examples/import/video-links-added-2026-11-08.csv)도 별도로 생성했습니다. 로컬 DB에만 적용했으며 운영 반영은 별도로 수행해야 합니다. 자세한 내용은 [작업 결과](unlinked-video-review.md)를 참고하세요.

## 2026-11-09 금영 우선 수집

금영 203곡을 추가 연결하여 전체 연결 43,046곡, 미연결 71,922곡입니다. 오늘 검색 한도 100회에 도달해 중단했으며 수집은 아직 미완료입니다. [이번 추가분 CSV](../examples/import/video-links-added-2026-11-09.csv)로 운영 반영할 수 있습니다. 운영 DB에는 아직 적용하지 않았습니다.

브랜드 우선 검색 옵션은 다음과 같습니다. 기존 캐시의 미완료 검색 구간 중 KY를 먼저 선택하고, KY 구간이 모두 끝나면 나머지 브랜드를 조회합니다. TJ도 지정할 수 있으며, 옵션을 생략하면 기존 순서를 사용합니다.

```sh
npm run videos:apply -- --allow-mr --search-backfill --priority-brand=KY
```

## 2026-11-10 금영 우선 수집 결과

한국 시간 17시 이후 검색을 재개하여 금영 224곡을 추가 연결했습니다. 전체 연결 43,270곡, 미연결 71,698곡입니다. 검색 요청 100회째 YouTube API의 HTTP 429 (rateLimitExceeded)로 중단해 위치를 저장했습니다. 수집은 아직 미완료이며 운영 DB에는 적용하지 않았습니다. [이번 추가분 CSV](../examples/import/video-links-added-2026-11-10.csv)를 별도로 생성했습니다.
