# MY TJ · 나만의 노래방

스마트폰 하나로 곡 검색·예약·반주 재생을 사용하는 React 앱입니다. YouTube Data API 키 없이, **직접 등록한 MySQL 곡 목록**을 검색합니다. TJ미디어의 공식 서비스가 아닙니다.

## 구성

- React 19 + Vite: 모바일/데스크톱 화면, 예약 순서 변경·취소, 즐겨찾기
- Node.js 22.12+ + Express 5 + MySQL 8.4
- YouTube IFrame Player: 재생·일시정지·건너뛰기, 종료 이벤트로 다음 곡 재생
- 곡 목록은 서버 MySQL, 예약·즐겨찾기는 브라우저 localStorage에 저장
- 관리자 Bearer 토큰으로 링크 등록과 CSV 업로드 보호. 토큰은 관리자 창 메모리에만 보관

## 빠른 실행

필수: Node.js 22.12 이상, 실행 중인 Docker Desktop.

```sh
cp .env.example .env
# .env에서 DB 비밀번호 두 개와 ADMIN_TOKEN(24자 이상)을 각각 변경
npm install
docker compose up -d --wait
npm run dev
```

PC: **http://localhost:5173**

이 작업 환경에는 임의 비밀번호와 관리자 토큰으로 `.env`를 이미 생성했습니다. 덮어쓰지 않고 그대로 사용할 수 있습니다. 토큰은 로컬 `.env`의 `ADMIN_TOKEN` 값을 확인해 앱의 **곡 관리 → 관리자 토큰**에 입력하세요. `.env`는 Git에서 제외됩니다. DB 볼륨이 이미 만들어진 뒤 `.env`의 DB 비밀번호만 바꾸면 기존 계정 비밀번호는 바뀌지 않습니다.

스마트폰: PC와 같은 Wi-Fi에서 **http://PC의-LAN-IP:5173**에 접속합니다. 예: `http://192.168.0.10:5173`. `/api`를 Vite가 프록시하므로 별도 API 주소·CORS 설정이 필요하지 않습니다. 방화벽이 물으면 개발 서버의 로컬 네트워크 접근을 허용하세요. 관리 토큰이 오가는 외부 배포에는 HTTPS를 사용하세요.

## 곡 등록

초기 DB는 비어 있습니다. 곡 관리에서 다음 두 방법 중 하나로 추가합니다.

1. **한 곡 등록**: 브랜드(TJ/태진 또는 KY/금영), 제목, 가수, 곡 번호를 입력합니다. 영상 링크는 선택이며, 곡 번호와 영상 ID 중 하나는 필요합니다. 확인한 영상은 `watch`, `youtu.be`, `shorts`, `live`, `embed` 링크 또는 11자리 ID로 등록할 수 있습니다.
2. **CSV 가져오기**: UTF-8(UTF-8 BOM 허용) CSV를 업로드합니다. 최대 **20MB·120,000행**입니다. Excel에서는 CSV UTF-8로 저장하세요.

**최신 전체 등록 파일: [examples/import/tj-ky-songs-with-videos.csv](examples/import/tj-ky-songs-with-videos.csv)** — 태진·금영 총 114,968곡 중 40,473곡에 영상 링크가 연결되어 있습니다(2026-11-04). 자세한 설명은 [등록용 CSV 안내](examples/import/README.md)를 확인하세요.

```csv
brand,song_number,title,artist,youtube_url
```

- `title`은 필수이며, `song_number` 또는 `youtube_url` 중 하나가 필요합니다. 번호가 있으면 영상 링크 없이도 검색용 곡 목록으로 등록할 수 있습니다.
- **브랜드 + 곡 번호**로 식별합니다. `TJ 12345`와 `KY 12345`는 별개입니다. 같은 브랜드·번호를 다시 가져오면 갱신합니다. 앞자리 0은 표시용으로 보존하지만 `00123`과 `123`은 같은 번호로 식별합니다.
- 같은 브랜드·번호에 여러 영상을 넣으면 마지막으로 지정한 영상 하나를 사용합니다. 번호가 없는 행은 브랜드와 영상 ID로 식별합니다.
- 예전 `title,artist,tj_number,youtube_url` CSV도 지원하며 브랜드를 생략하면 TJ로 처리합니다. `ky_number`를 사용하면 KY로 추론합니다. 번호 열과 브랜드가 불일치하면 오류입니다.
- 링크 없는 행으로 다시 가져와도 기존 영상 링크는 유지합니다. 같은 파일 안에서도 같은 규칙을 적용합니다. 제목·가수는 마지막 행을 사용합니다.
- 데이터 오류가 있으면 전체 취소하고 최대 50개 오류를 표시합니다. 행 번호는 헤더를 1행으로 센 데이터 레코드 번호입니다. DB 저장은 묶음 처리와 트랜잭션을 사용합니다.
- 영상 링크 형식만 검사하며, 공식 채널 소속·제목 정확성·현재 재생 가능 여부를 자동 검증하지 않습니다.

영상이 없는 곡은 검색·즐겨찾기에 사용할 수 있고 **영상 미연결**로 표시됩니다. 곡 옆 **영상 연결**에서 관리자 토큰과 확인한 링크를 입력하면 예약·재생할 수 있습니다. YouTube 채널 전체 자동 수집이나 YouTube 전체 검색 기능은 포함하지 않습니다.

## 사용법

전체 공식 채널과 곡 목록을 대조하려면 [전곡 영상 대조 안내](docs/youtube-full-sync.md)를 참고하세요. YouTube Data API 키를 `.env`에 설정한 뒤 `npm run videos:apply -- --allow-mr --search-backfill`로 공개 목록 조회·MR 대체·과거 검색 보완을 이어서 실행할 수 있습니다. 현재 전체 연결은 완료되지 않았으며, 검색 한도로 중단한 위치를 저장했습니다. API 키는 일반 검색·기존 영상 재생에는 필요하지 않습니다.

검색 결과의 `+ 예약`으로 대기열에 추가한 뒤 **노래 시작하기**를 누릅니다. 같은 곡도 여러 번 예약할 수 있습니다. 위·아래 버튼으로 순서를 바꾸고 `×`로 취소합니다. 재생 중인 곡과 대기열은 별개이며 다음 곡 버튼은 현재 곡을 마치고 첫 예약곡을 시작합니다. 예약곡이 없으면 재생을 종료합니다.

하트로 즐겨찾기를 추가합니다. 새로고침 후 대기열과 즐겨찾기는 복원하고, 재생 중이던 곡은 자동 복원하지 않습니다. 브라우저 데이터 삭제, 시크릿 모드, 다른 기기에서는 목록이 공유되지 않습니다. 로컬 즐겨찾기는 저장 당시 곡 정보의 사본입니다.

모바일 브라우저가 자동재생을 막으면 재생 버튼을 다시 눌러야 합니다. 삭제·비공개·외부 재생 금지 영상은 안내와 YouTube 링크를 표시하며 자동으로 건너뛰지 않습니다. 음정/템포 변경, 보컬 제거, 백그라운드 재생 기능은 제공하지 않습니다.

## 빌드 / 운영 실행

Bitnami Apache에서 여러 가상호스트와 함께 운영하는 설정은 [Bitnami 배포 안내](docs/bitnami-apache-deploy.md)를 참고하세요. `kbigstar.kr → 127.0.0.1:3004` 전용 vhost와 systemd 예제를 포함합니다.

```sh
npm run build
npm start
```

빌드한 웹 화면과 API를 **http://localhost:3001**에서 함께 제공합니다. 운영 배포 시 HTTPS 리버스 프록시를 앞에 두고 `/api`와 웹을 같은 출처로 연결하세요. Node 프로세스 실행 전 MySQL이 준비되어 있어야 합니다. 서버 시작 시 테이블을 초기화하고 기존 TJ 전용 스키마를 자동 업그레이드합니다. 기존 곡 ID와 영상 링크는 유지합니다. 기존 DB에 같은 TJ 번호의 여러 행이 있으면 임의로 병합하지 않고 시작을 중단하므로 중복을 정리해야 합니다. 스키마 업그레이드 전에는 DB를 백업하세요.

MySQL 포트는 `127.0.0.1:3307`에만 열립니다. 기존 DB를 쓰려면 `.env`에 `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`를 설정합니다. 예약·즐겨찾기 API나 사용자 계정은 없습니다. 공개 서버에서는 관리자 토큰을 신뢰하는 관리자에게만 제공하세요. 관리자 쓰기 API에는 IP 기준 분당 30회 제한이 있습니다.

```sh
docker compose stop         # 데이터 보존하며 DB 중지
docker compose up -d --wait # 다시 실행
```

`docker compose down -v`는 곡 DB 볼륨까지 삭제하므로 사용하지 마세요. 곡 정보는 Docker named volume `youtubemusicplayer_mysql_data`에 저장됩니다. 중요한 곡 목록은 원본 CSV와 DB 덤프를 별도 보관하세요.

## 검증

```sh
npm test                 # 입력·CSV·API 인증·로컬 저장·예약 순서 테스트
npm run build            # 프로덕션 번들
npm run test:integration # 실행 중인 MySQL 필요. 별도 임시 DB 생성 후 제거
npm run test:e2e         # 로컬 Google Chrome 필요. Vite는 자동 실행
npm run verify:running   # localhost:3001에서 실행 중인 앱 확인
```

통합 테스트는 root 계정으로 임시 테스트 DB를 만들고 삭제하며 실제 곡 목록에는 쓰지 않습니다. 브라우저 테스트는 API 응답과 YouTube 플레이어를 모의 처리하여 모바일 예약·재생 전환·오류·관리자 동작을 검증합니다. 실제 YouTube 영상 재생이나 실제 스마트폰에서의 자동재생 검증을 대신하지 않습니다. Chrome이 없다면 `npx playwright install chromium` 실행 후 `playwright.config.js`의 `channel: 'chrome'`을 제거해 Playwright Chromium을 사용할 수 있습니다.

## API

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| GET | `/api/health` | DB 연결 상태(실패 시 503) |
| GET | `/api/songs?q=검색어&page=1` | 제목·가수·태진/금영 번호 부분 검색, 30곡씩 |
| POST | `/api/admin/songs` | JSON 개별 등록 |
| POST | `/api/admin/import` | `Content-Type: text/csv`, CSV 원문 |

관리자 API에는 `Authorization: Bearer <ADMIN_TOKEN>`이 필요합니다. `ADMIN_TOKEN`을 클라이언트 번들 또는 `VITE_` 환경 변수에 넣지 마세요. 검색은 파라미터 바인딩 및 LIKE 특수문자 이스케이프를 사용합니다. 현재는 부분 검색이므로 대규모 카탈로그에서는 검색 인덱스 설계를 추가로 검토하세요.

공식 참고: [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [Vite](https://vite.dev/guide/), [Express 오류 처리](https://expressjs.com/en/guide/error-handling/).
