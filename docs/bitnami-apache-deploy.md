# Bitnami Apache에서 YoutubeMusicPlayer 실행

제공된 `bigstar.conf`를 기준으로 검토했습니다. 서버에 직접 접속하거나 적용하지 않았으므로 포트 점유, 인증서, 다른 가상호스트의 실제 설정은 서버에서 확인해야 합니다.

이 문서의 배포 파일과 앱 변경을 서버 프로젝트에 전달한 후 명령을 실행하세요. 로컬에서 작성한 파일이 GitHub나 서버에 자동으로 반영되는 것은 아닙니다.

## 검토 결과

1. 붙여주신 내용 그대로라면 HTTP `DocumentRoot`의 닫는 따옴표가 빠졌습니다. 이 문법 오류는 Apache 전체 설정 검사에 영향을 줍니다.
2. 프로젝트 소스 폴더를 DocumentRoot로 지정할 필요가 없습니다. 이 앱은 `npm run build`로 만든 `web/dist`와 `/api`를 Node 프로세스가 함께 제공합니다.
3. 현재 Apache는 `127.0.0.1:3004`로 전달하므로 앱도 `PORT=3004`여야 합니다. 앱 기본값은 3001입니다. 주석의 3002는 실제 설정과 다릅니다.
4. HTTPS vhost의 DocumentRoot는 모두 주석 처리되어 있습니다. 전체 프록시가 정상 작동하면 Node가 응답하지만, 명시적으로 `web/dist`를 지정하고 소스 폴더의 직접 접근을 막는 구성이 명확합니다.
5. Express에는 로컬 Apache를 신뢰하도록 `TRUST_PROXY=loopback`을 추가했습니다. 없으면 관리자 API의 IP별 요청 제한이 Apache의 루프백 주소를 기준으로 공유될 수 있습니다.
6. HTTP/HTTPS 모두 ACME 경로를 유지합니다. HTTPS에서는 ACME 경로를 root ProxyPass보다 먼저 제외합니다.
7. Node는 `HOST=127.0.0.1`로 서버 내부에서만 열고, Apache가 HTTPS를 처리합니다. 5173은 개발 서버용 포트입니다.

## 파일

- [Apache vhost](../deploy/apache/bigstar.conf)
- [systemd 서비스](../deploy/systemd/youtube-music-player.service)
- [서버 .env 양식](../deploy/server.env.example)

가상호스트가 4개 있어도 80/443 포트는 공유할 수 있습니다. `ServerName`/`ServerAlias`로 요청을 구분하며, 각 백엔드 앱은 서로 다른 내부 포트를 사용합니다. 이 구성에서는 `kbigstar.kr`와 `www.kbigstar.kr`만 이 앱으로 전달합니다. 다른 vhost 파일, 전역 Listen, 다른 앱의 포트는 변경하지 않습니다. 같은 도메인을 선언한 vhost가 중복되면 먼저 선택된 설정으로 연결될 수 있으므로 `apachectl -S`로 확인하세요.

## 1. 서버 상태 확인

서버에서 실행합니다.

```sh
sudo /opt/bitnami/apache/bin/apachectl -S
sudo /opt/bitnami/apache/bin/apachectl -M
sudo ss -lntp
command -v node
node --version
npm --version
docker compose version
```

필수 Apache 모듈: `ssl_module`, `rewrite_module`, `headers_module`, `proxy_module`, `proxy_http_module`, `alias_module`, `authz_core_module`, `log_config_module`.

Node는 프로젝트 기준 22.12 이상이 필요합니다. `3004`와 `3307`의 점유 프로세스를 확인하세요. 기존 KBIGSTAR 서비스가 3004를 쓰는 경우 해당 서비스의 전환 계획이 필요합니다. 프로세스 전체를 종료하거나 다른 앱의 포트를 임의로 바꾸지 마세요. 다른 포트를 선택하면 `.env`의 PORT와 이 vhost의 ProxyPass/ProxyPassReverse를 함께 맞춥니다.

인증서에 두 도메인이 포함되어 있고 만료되지 않았는지도 확인합니다.

```sh
sudo openssl x509 \
  -in /opt/bitnami/letsencrypt/certificates/kbigstar.kr.crt \
  -noout -dates -ext subjectAltName
```

## 2. 앱과 DB 준비

프로젝트와 배포 파일이 `/home/bitnami/projects/YoutubeMusicPlayer`에 준비된 상태에서:

```sh
cd /home/bitnami/projects/YoutubeMusicPlayer
npm ci
npm run build
test -f web/dist/index.html
```

기존 서버 `.env`가 있다면 덮어쓰지 말고 필요한 항목을 수정하세요. 새 설치라면 `deploy/server.env.example`을 `.env`로 복사한 뒤 비밀번호·토큰을 설정합니다.

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3004
TRUST_PROXY=loopback
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_DATABASE=tj_karaoke
MYSQL_USER=karaoke
MYSQL_PASSWORD=서버_DB_비밀번호
MYSQL_ROOT_PASSWORD=서버_DB_ROOT_비밀번호
ADMIN_TOKEN=24자_이상의_서버_관리자_토큰
```

`.env`는 Git에서 제외되므로 서버에서 별도로 준비해야 합니다. `YOUTUBE_DATA_API_KEY`는 영상 메타데이터 동기화를 실행할 때만 필요하며, 일반 검색·기존 연결 영상 재생에는 필요하지 않습니다.

```sh
chmod 600 .env
docker compose up -d --wait
docker compose ps
```

Compose는 이 프로젝트 전용 MySQL을 호스트의 `127.0.0.1:3307`에 제공합니다. Bitnami의 기존 MySQL/MariaDB를 중지하거나 수정하지 않습니다. 이미 DB 볼륨이 만들어졌다면 `.env`의 비밀번호만 바꿔도 기존 DB 계정의 비밀번호가 바뀌지는 않습니다.

기존 Bitnami DB를 함께 사용하려면 Compose를 실행하는 대신 별도 DB와 사용자 계정을 만들고 실제 서버의 MYSQL_PORT 등을 지정해야 합니다. 현재 안내는 프로젝트 전용 Compose DB를 기준으로 합니다.

## 3. Node를 서비스로 실행

`deploy/systemd/youtube-music-player.service`의 `ExecStart`를 서버의 `command -v node` 절대 경로에 맞추세요. 예를 들어 Node가 `/opt/bitnami/node/bin/node`에 있다면 템플릿의 `/usr/bin/node`를 해당 경로로 바꿉니다. systemd는 대화형 셸의 nvm 설정을 자동으로 읽지 않습니다.

```sh
sudo cp deploy/systemd/youtube-music-player.service /etc/systemd/system/youtube-music-player.service
sudo systemctl daemon-reload
sudo systemctl enable --now youtube-music-player
sudo systemctl status youtube-music-player --no-pager
curl --fail http://127.0.0.1:3004/api/health
curl --fail -I http://127.0.0.1:3004/
```

health의 예상 응답은 `{"status":"ok"}`입니다. DB가 준비되지 않았거나 포트 충돌이 있으면 Apache 적용 전에 해결하세요. 서비스는 앱의 루트 `.env`를 직접 읽습니다. `After=docker.service`는 DB 준비 완료를 보장하지 않지만, DB 연결 실패 시 5초 뒤 재시작하도록 설정했습니다.

```sh
sudo journalctl -u youtube-music-player -n 100 --no-pager
```

## 4. bigstar.conf만 교체

백업은 Apache가 vhost 설정으로 다시 읽지 않는 별도 디렉터리에 만듭니다. 기존 인증서와 ACME 경로가 실제로 존재하는지 확인한 후 진행하세요.

```sh
sudo mkdir -p /home/bitnami/config-backups
backup_file="/home/bitnami/config-backups/bigstar.conf.$(date +%Y%m%d-%H%M%S)"
sudo cp -a /opt/bitnami/apache/conf/vhosts/bigstar.conf "$backup_file"
sudo cp deploy/apache/bigstar.conf /opt/bitnami/apache/conf/vhosts/bigstar.conf
sudo /opt/bitnami/apache/bin/apachectl -t
sudo /opt/bitnami/apache/bin/apachectl -S
```

**`Syntax OK`가 나오고 4개 사이트의 도메인 배정이 올바른지 확인한 뒤** 설정을 다시 읽습니다.

```sh
sudo /opt/bitnami/apache/bin/apachectl -k graceful
```

이 재로드는 하나의 Apache 프로세스 전체에 적용됩니다. 다른 가상호스트의 설정을 수정하지 않더라도 설정 검사와 기존 사이트 접속 확인은 필요합니다. Apache 전체 stop/start보다 graceful을 사용해 기존 요청 처리를 유지합니다.

검사 실패 시 백업 파일을 복원하고 재검사하세요. 아래 명령은 같은 셸의 `backup_file` 변수가 유지되어 있는 경우입니다.

```sh
sudo cp "$backup_file" /opt/bitnami/apache/conf/vhosts/bigstar.conf
sudo /opt/bitnami/apache/bin/apachectl -t
```

## 5. 도메인과 기존 사이트 검증

서버 내부에서도 실제 도메인과 TLS SNI를 지정해 확인할 수 있습니다.

```sh
curl --resolve www.kbigstar.kr:443:127.0.0.1 https://www.kbigstar.kr/api/health
curl --resolve kbigstar.kr:443:127.0.0.1 https://kbigstar.kr/api/health
curl --resolve www.kbigstar.kr:80:127.0.0.1 -I http://www.kbigstar.kr/
curl --resolve www.kbigstar.kr:443:127.0.0.1 -I https://www.kbigstar.kr/
```

HTTPS health 200, HTTP의 HTTPS 리다이렉트, React 화면, 검색·관리자 등록·CSV 업로드를 확인합니다. 다른 세 사이트도 실제 각 도메인으로 접속해 확인하세요. 3004/3307을 인터넷에 별도로 개방할 필요는 없습니다.

ACME 경로는 현재 인증서 갱신 설정과 경로가 일치해야 합니다. 제공된 경로를 유지했지만 실제 Bitnami 설치에서 갱신 도구가 다른 webroot나 standalone 방식을 쓰고 있다면 해당 갱신 설정을 기준으로 확인해야 합니다.

## 곡 데이터

새 서버의 MySQL은 처음에는 비어 있습니다. 로컬 Docker DB나 `.local` 캐시는 Git push만으로 서버에 복사되지 않습니다.

배포 후 HTTPS 앱의 곡 관리에서 서버 ADMIN_TOKEN을 사용해 `examples/import/tj-ky-songs-with-videos.csv`를 가져오면 전체 곡 정보와 연결된 영상 링크를 함께 등록할 수 있습니다. 전체 현황은 해당 CSV 생성 시점 기준이며, 로컬 사용자 예약·즐겨찾기는 기기 브라우저에만 있습니다.

참고: [Apache 이름 기반 가상호스트](https://httpd.apache.org/docs/2.4/vhosts/name-based.html), [Apache reverse proxy](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html), [Express 프록시 설정](https://expressjs.com/en/guide/behind-proxies/).
