import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Help({ onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => previous?.focus();
  }, []);

  return <dialog ref={dialog} className="admin-dialog help-dialog" aria-labelledby="help-title" closedby="none"
    onCancel={event => event.preventDefault()}>
    <div className="dialog-inner">
      <div className="section-heading"><h2 id="help-title">사용 방법</h2><button autoFocus className="icon-button" aria-label="사용 방법 닫기" onClick={onClose}><X size={24}/></button></div>
      <section className="help-section">
        <h3>노래를 부르려면</h3>
        <ol>
          <li><strong>노래 찾기</strong><p>검색 칸에 노래 제목, 가수 이름 또는 TJ·KY 곡 번호를 쓰세요.</p></li>
          <li><strong>노래 담기</strong><p>노래 옆의 <b>＋</b> 버튼을 누르세요.</p></li>
          <li><strong>노래 시작</strong><p>예약 목록의 <b>노래 시작하기</b>를 누르세요.</p></li>
        </ol>
        <p className="help-note">‘영상 미연결’ 노래는 아직 부를 수 없어요. 다른 노래를 골라 주세요.</p>
      </section>
      <section className="help-section">
        <h3>다른 사람과 함께 부르려면</h3>
        <p><b>방 관리</b>를 누르고, 내 이름과 받은 방 코드를 쓴 뒤 <b>방 입장</b>을 누르세요.</p>
        <p>초대 링크로 들어왔다면 내 이름만 쓰고 <b>방 입장</b>을 누르세요.</p>
        <p className="help-note">노래는 각자 담을 수 있어요. 노래 시작과 소리는 <b>방을 만든 사람(방장)</b>이 맡아요.</p>
        <details><summary>내가 방을 만들려면</summary><p><b>방 관리</b>에서 내 이름을 쓰고, 방 코드는 비워 둔 채 <b>새 방 만들기</b>를 누르세요. <b>초대 링크 복사</b>를 눌러 함께 부를 사람에게 보내세요.</p><p>노래가 끝날 때까지 방장 화면을 열어 두세요. <b>방 삭제</b>를 누르면 모두의 방이 없어져요.</p></details>
      </section>
      <section className="help-section">
        <h3>다음 곡 투표</h3>
        <p>방의 예약 목록에서 <b>다음 곡 투표</b>를 누르세요. 한 사람당 한 곡에 투표할 수 있고, 다른 곡을 누르면 선택이 바뀝니다. 같은 곡을 다시 누르면 취소됩니다.</p>
        <p>투표는 예약 순서를 자동으로 바꾸지 않습니다. 방장이 <b>다음 곡으로 지정</b>을 누르면 해당 곡이 예약 맨 앞으로 이동합니다. 재생 중인 곡은 계속됩니다.</p>
        <p>곡이 재생되거나 예약에서 삭제되면 해당 곡의 투표가 끝납니다. 방에서 나가면 내 표도 없어집니다.</p>
      </section>
      <section className="help-section">
        <h3>방장이 없어졌다면</h3>
        <p>방장 기기의 응답이 60초 이상 없으면 <b>방 관리 → 방장 맡기</b>로 새 방장이 될 수 있습니다. 여러 사람이 누르면 먼저 처리된 한 명이 방장이 됩니다.</p>
        <p>현재 방장은 <b>방 관리 → 방장 넘기기</b>에서 접속 중인 참가자에게 권한을 넘길 수 있습니다. 방과 예약은 유지되며 소리는 새 방장 기기에서 나옵니다. 재생 중이던 곡은 처음부터 다시 시작될 수 있습니다.</p>
      </section>
      <section className="help-section">
        <h3>자주 묻는 질문</h3>
        <details><summary>‘영상 미연결’ 곡은 재생할 수 있나요?</summary><p>아직 재생할 수 없습니다. 영상이 연결된 다른 곡을 선택해 주세요.</p></details>
        <details><summary>친구 휴대폰에서도 소리가 나오나요?</summary><p>함께하는 방에서는 방장 기기에서 소리가 나옵니다. 참가자는 곡 예약과 다음 곡 투표에 참여합니다.</p></details>
        <details><summary>즐겨찾기는 친구와 공유되나요?</summary><p>즐겨찾기는 현재 기기의 브라우저에 저장됩니다. 방의 예약 목록은 참가자들과 공유됩니다.</p></details>
        <details><summary>TJ미디어의 공식 서비스인가요?</summary><p>TJ미디어와 무관한 개인용 앱입니다. YouTube 영상은 원본 제공 상태와 재생 제한에 따라 이용하지 못할 수 있습니다.</p></details>
      </section>
    </div>
  </dialog>;
}
