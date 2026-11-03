# 기존 PM2 서버에 배포

기존 PM2 앱을 관리하는 `bitnami` 계정으로 실행합니다. `sudo pm2`는 다른 프로세스 목록을 사용할 수 있습니다. 기존 MySQL을 사용하므로 Docker DB를 새로 실행하지 않습니다.

서버 루트 `.env`에 기존 MYSQL_HOST/USER/PASSWORD를 유지하고 다음 값을 설정합니다. PM2 설정에는 비밀번호를 넣지 않습니다.

```dotenv
HOST=127.0.0.1
PORT=3004
TRUST_PROXY=loopback
MYSQL_PORT=3306
MYSQL_DATABASE=tj_karaoke
```

## 최초 등록

```sh
cd /home/bitnami/projects/YoutubeMusicPlayer
git pull --ff-only origin main
npm ci
npm run build
pm2 list
command -v node
node --version
```

Node 22.12 이상이 필요합니다. 설정은 위 명령을 실행하는 Node의 절대 경로와 프로젝트 위치를 사용합니다. `npm start`로 실행 중이면 해당 창에서 Ctrl+C로 종료합니다. 이 앱을 별도 systemd 서비스로 등록했다면 그 서비스만 중지·비활성화하여 이중 실행을 방지합니다. 기존 `roomselector.service`도 중지된 상태여야 합니다. 3004의 점유 프로세스를 확인하고 다른 앱을 임의로 종료하지 않습니다.

```sh
sudo ss -lntp 'sport = :3004'
pm2 start deploy/pm2/ecosystem.config.js --only youtube-music-player
pm2 status youtube-music-player
curl --fail http://127.0.0.1:3004/api/health
pm2 logs youtube-music-player --lines 50 --nostream
```

같은 이름의 앱이 이미 등록되어 있다면 아래 업데이트 명령을 사용합니다. 단일 fork 프로세스로 실행하며 파일 감시는 끕니다. CSV 등록 중에는 수동 재시작을 피하세요. 종료 신호를 받으면 앱은 진행 중인 요청과 DB 연결을 정리하며 PM2는 최대 600초 후 강제 종료합니다. 이 설정은 Apache의 요청 제한 시간과는 별개입니다.

정상 응답과 기존 앱 목록을 확인한 뒤 현재 전체 PM2 프로세스 목록을 저장합니다. 기존에 중지된 앱 등도 포함되므로 `pm2 list`를 먼저 확인하세요.

```sh
pm2 list
pm2 save
```

이미 PM2 부팅 자동 실행이 설정되어 있으면 그대로 사용합니다. 설정되지 않았다면 `pm2 startup`을 실행하고 출력된 시스템 등록 명령을 실행한 뒤 `pm2 save`를 실행합니다. 재부팅 검증은 다른 사이트와 함께 운영 일정을 잡고 진행합니다.

## 코드와 환경 설정 업데이트

```sh
cd /home/bitnami/projects/YoutubeMusicPlayer
git pull --ff-only origin main
npm ci
npm run build
pm2 restart deploy/pm2/ecosystem.config.js --only youtube-music-player --update-env
curl --fail http://127.0.0.1:3004/api/health
pm2 save
```

변경된 `.env`는 새 Node 프로세스가 읽습니다. 동일한 이름의 환경 변수가 셸이나 기존 PM2 환경에 이미 있으면 dotenv보다 우선하므로 DB 접속 정보 등을 셸에서 export하지 말고 서버 `.env`를 기준으로 관리하세요. `pm2 env` 출력에는 비밀번호가 포함될 수 있으므로 공유하지 마세요.

Apache가 이미 3004를 프록시하면 PM2 전환만으로 Apache를 재로드할 필요는 없습니다. Apache 설정 변경은 [Bitnami 배포 안내](bitnami-apache-deploy.md)를 따릅니다. 이 프로젝트의 독립 systemd 서비스와 PM2를 동시에 실행하지 않습니다.

참고: [PM2 설정](https://pm2.keymetrics.io/docs/usage/application-declaration/), [부팅 자동 실행](https://pm2.io/docs/runtime/guide/startup-hook/).
