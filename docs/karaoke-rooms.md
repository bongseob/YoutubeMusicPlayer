# 함께하는 노래방

같은 장소에서 방장 휴대폰 한 대가 영상·반주·마이크 소리를 출력합니다. 참가자 휴대폰은 예약과 재생 상태 확인에 사용하며, 별도로 반주를 재생하거나 마이크 음성을 전송하지 않습니다.

## 사용 방법

1. HTTPS 사이트의 ‘함께하는 노래방’에서 닉네임을 입력하고 코드를 비워 둔 채 ‘새 방 만들기’를 누릅니다.
2. 참가자는 자기 휴대폰에서 닉네임과 방장의 8자리 코드를 입력합니다. 방 코드를 아는 사람은 누구나 입장할 수 있으므로 함께 사용할 사람에게만 공유하세요.
3. 각자가 검색한 곡을 예약하면 추가한 순서대로 공유 목록에 들어갑니다. 같은 노래도 여러 번 예약할 수 있습니다.
4. 방장만 시작·일시정지·다음 곡·예약 삭제·전체 비우기를 할 수 있습니다. 곡이 끝나면 다음 예약곡으로 넘어갑니다. 자동재생이 차단되면 방장 기기에서 재생 버튼을 누릅니다.
5. 방장이 ‘방 종료’를 누르면 방과 예약 목록이 삭제됩니다. 참가자는 나가기 후 다시 입장할 수 있습니다.

즐겨찾기와 개인 모드의 예약은 기존대로 기기에 저장됩니다. 방에 있는 동안에는 방 예약을 사용하며 나가면 개인 모드로 돌아옵니다. 방은 최대 50명, 예약은 최대 500곡입니다. 명단은 입장한 사람을 표시하며 실시간 접속 인원을 의미하지 않습니다.

## 카카오톡 초대

방 화면의 ‘카카오톡으로 초대’를 누르면 휴대폰 공유창이 열립니다. 카카오톡과 보낼 대화방을 선택하세요. 기기의 기본 공유 기능을 사용하므로 카카오 개발자 키는 필요하지 않습니다. 카카오톡이 공유 대상에 표시되지 않거나 공유 기능을 지원하지 않는 브라우저에서는 ‘초대 링크 복사’로 링크를 복사해 카카오톡에 붙여넣습니다. 복사 권한이 없으면 화면의 초대 링크를 직접 선택해 복사할 수 있습니다.

링크는 `https://kbigstar.kr/?room=방코드` 형태이며 방장 토큰이나 관리자 토큰은 포함하지 않습니다. 받는 사람이 열면 방 코드가 미리 입력되고 닉네임만 입력해 입장합니다. 닉네임 입력 전에는 방에 자동 입장하지 않습니다. 종료·만료된 방은 입장할 때 오류를 표시합니다. 다른 방에 이미 접속 중이면 기존 방을 유지하고 나가기 또는 방 종료 후 초대받은 방에 입장하도록 안내합니다.

카카오톡 내장 브라우저에서 마이크가 동작하지 않으면 초대 링크를 Android Chrome 또는 iOS Safari로 열어 사용하세요. 카카오톡 실제 공유 대상 표시와 내장 브라우저 동작은 휴대폰에서 확인해야 합니다. 공유창은 [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API)를 사용합니다.

## 재연결과 저장

방 상태와 예약은 `karaoke_rooms` MySQL 테이블에 저장합니다. Node/PM2 재시작 시에도 유지되며, 동시에 들어오는 예약은 DB 행 잠금으로 처리합니다. 화면은 약 2초 간격으로 갱신합니다. 인증은 방 코드와 별도로 발급한 임의 토큰으로 처리하고 서버에는 토큰 해시만 저장합니다. 참가자가 직접 API를 호출해도 방장 권한이 없으면 관리 동작을 거부합니다.

같은 브라우저 탭에서 새로고침하거나 네트워크가 잠시 끊기면 sessionStorage의 방 접속 정보로 재연결합니다. 탭을 완전히 닫거나 브라우저 데이터를 삭제하면 방장 접속 정보를 잃을 수 있습니다. 방장은 대표 기기 탭을 유지하세요. 방장 권한을 다른 기기로 이전하는 기능은 없습니다. 방장이 재입장하면 현재 곡을 처음부터 다시 재생할 수 있으며 마이크는 직접 다시 켜야 합니다.

24시간 동안 인증된 방 요청이 없으면 방이 만료됩니다. 만료된 방은 접근할 수 없고 이후 새 방 생성 시 정리합니다. 방장 종료는 즉시 삭제입니다.

## USB 마이크와 에코

Android Chrome을 우선 대상으로 구현했습니다. iOS Safari에서도 getUserMedia와 Web Audio 지원 여부를 확인해 사용하며 실제 USB 장치 조합에서의 동작은 별도 확인해야 합니다.

- USB 마이크를 연결하고 방장 화면에서 ‘마이크 켜기’를 눌러 권한을 허용합니다. HTTPS가 필요합니다(localhost 개발은 예외).
- 기본 입력을 먼저 활성화하면 허용된 마이크 목록을 확인할 수 있습니다. 다른 입력을 선택하려면 마이크를 끄고 장치를 선택한 뒤 다시 켭니다.
- 볼륨과 짧은 딜레이 에코의 크기를 조절할 수 있습니다. 녹음하거나 음성을 서버에 업로드하지 않습니다.
- 마이크 끄기, 방 종료·퇴장 또는 컴포넌트 종료 시 입력 트랙과 AudioContext를 정리합니다. 브라우저 종료 시 입력도 종료됩니다.
- 출력은 OS의 현재 오디오 경로를 따릅니다. USB 연결 시 USB 장치로 출력이 전환될 수 있고, 브라우저에서 내장 스피커로 강제 전환하는 기능은 제공하지 않습니다.
- 스피커와 마이크 사이의 하울링 및 처리 지연은 장치·브라우저에 따라 다릅니다. 낮은 볼륨부터 확인하고 문제 발생 시 마이크를 끄세요. 화면 잠금·백그라운드 전환은 피하고 중단되면 ‘출력 재개’를 누릅니다.

실제 Android USB 마이크/내장 스피커, iPhone USB 어댑터/Safari 검증은 장치를 연결한 현장에서 진행해야 합니다. 브라우저 자동 테스트는 생성된 오디오 스트림을 사용하므로 하드웨어 호환성이나 실제 지연을 보증하지 않습니다.

## 서버 반영

기존 MySQL 접속 정보는 변경하지 않습니다. 시작할 때 `karaoke_rooms` 테이블을 자동 생성합니다. 기존 앱 계정에 CREATE 및 해당 테이블의 SELECT/INSERT/UPDATE/DELETE 권한이 필요합니다. 관리자가 구조를 확인할 때 사용할 SQL은 다음과 같습니다.

```sql
USE tj_karaoke;
CREATE TABLE IF NOT EXISTS karaoke_rooms (
  code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  state JSON NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX (expires_at)
) ENGINE=InnoDB;
```

기존 앱도 karaoke_songs 테이블에 CREATE TABLE IF NOT EXISTS를 실행하는 방식을 사용합니다. 기존 서버 계정·비밀번호·호스트를 변경할 필요는 없습니다.

```sh
cd /home/bitnami/projects/YoutubeMusicPlayer
git pull --ff-only origin main
npm ci
npm run build
pm2 restart deploy/pm2/ecosystem.config.js --only youtube-music-player --update-env
curl --fail http://127.0.0.1:3004/api/health
pm2 logs youtube-music-player --lines 50 --nostream
pm2 save
```

기존 Apache의 전체 경로 프록시를 그대로 사용합니다. 추가 포트나 WebSocket 설정은 필요하지 않습니다.

참고: [브라우저 마이크 권한과 HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [Web Audio](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext), [YouTube 재생 이벤트](https://developers.google.com/youtube/iframe_api_reference).
