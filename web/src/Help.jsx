import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Help({ onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => previous?.focus();
  }, []);

  return <dialog ref={dialog} className="admin-dialog help-dialog" aria-labelledby="help-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="dialog-inner">
      <div className="section-heading"><h2 id="help-title">사용 방법</h2><button autoFocus className="icon-button" aria-label="사용 방법 닫기" onClick={onClose}><X size={24}/></button></div>
      <section className="help-section">
        <h3>노래를 부르려면</h3>
        <ol>
          <li><strong>노래 찾기</strong><p>검색 칸에 노래 제목이나 가수 이름을 쓰세요.</p></li>
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
        <details><summary>내가 방을 만들려면</summary><p><b>방 관리</b>에서 내 이름을 쓰고, 방 코드는 비워 둔 채 <b>새 방 만들기</b>를 누르세요. <b>초대 링크 복사</b>를 눌러 함께 부를 사람에게 보내세요.</p><p>노래가 끝날 때까지 방장 화면을 열어 두세요. <b>방 종료</b>를 누르면 모두의 방이 없어져요.</p></details>
      </section>
      <button className="primary help-done" onClick={onClose}>알겠어요</button>
    </div>
  </dialog>;
}
