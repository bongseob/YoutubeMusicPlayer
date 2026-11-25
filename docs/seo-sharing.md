# 검색과 링크 공유

대표 주소는 `https://www.kbigstar.kr/`입니다. 도메인이 바뀌면 `web/index.html`, `web/public/guide.html`, `web/public/robots.txt`, `web/public/sitemap.xml`, Apache 설정의 절대 주소를 함께 수정하세요.

홈의 초기 HTML은 서비스 소개와 안내 링크를 제공하며 React가 로드되면 앱 화면으로 전환됩니다. `/guide.html`은 JavaScript 없이 읽을 수 있는 공개 사용 안내입니다. 곡별 상세 URL과 검색 결과의 색인 기능은 이번 변경에 포함하지 않았습니다.

## 배포와 확인

1. `npm run build`로 `web/dist`를 생성하고 기존 서버 배포 절차를 따릅니다. 서버 코드의 404 변경을 적용하려면 서버 프로세스도 재시작합니다.
2. `deploy/apache/bigstar.conf`의 HTTPS 비www → www 리다이렉트를 기존 운영 설정에 반영하고 Apache 설정 검사 후 재적용합니다.
3. 홈, `/?room=ABC123`, `/guide.html`, `/robots.txt`, `/sitemap.xml`, `/images/hangokgachi-share.jpg`가 200으로 응답하는지 확인합니다. 존재하지 않는 페이지와 파일은 404여야 합니다.
4. HTTP 및 HTTPS 비www 주소가 HTTPS www 주소로 이동하며 초대 링크의 쿼리 문자열이 유지되는지 확인합니다.
5. Google Search Console과 Bing Webmaster Tools에 사이트맵을 제출하고 URL 검사를 수행합니다. 메타태그와 사이트맵은 색인이나 AI 인용을 보장하지 않습니다.
6. 카카오톡에서 실제 링크 미리보기를 확인합니다. 기존 미리보기가 남아 있으면 카카오 개발자 도구의 공유 디버거에서 URL 캐시를 갱신한 뒤 다시 공유합니다. 생성된 이미지는 배포 후 외부에서 인증 없이 접근할 수 있어야 합니다.

## 공유 대표 이미지

- 파일: `web/public/images/hangokgachi-share.jpg` (1200 × 630, JPEG)
- 제작: 내장 imagegen 도구. 생성 원본을 공유 카드 규격으로 리사이즈하고 JPEG로 저장했습니다.
- 최종 프롬프트: “Create a polished Korean karaoke web app social share cover, landscape aspect ratio 1.91:1, ideally 1200x630. Dark midnight navy #11151c background, luminous lime green #b2ec79 accents, large elegant 3D microphone on right with subtle musical notes and soft lime glow. Left side has beautifully typeset, perfectly readable Korean headline exactly '한곡같이' in large white bold letters and subtitle exactly '함께 부르는 노래방' in smaller light green text. Warm friendly understated premium graphic design, generous safe margins 90px, all words within central safe area. No extra text, no platform logos, no fake interface. Final graphic suitable for KakaoTalk link previews.”
