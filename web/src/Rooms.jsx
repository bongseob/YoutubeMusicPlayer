import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

async function request(path, token, body, signal) {
  const response = await fetch(`/api/rooms${path}`, { method: body ? 'POST' : 'GET', signal, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '방 요청에 실패했습니다.'), { status: response.status });
  return data;
}
function savedSession() { try { const s = JSON.parse(sessionStorage.getItem('tj.room')); return /^[A-F0-9]{8}$/.test(s?.code) && /^[a-f0-9]{64}$/.test(s?.token) ? s : null; } catch { return null; } }
export function useRoom() {
  const [session, setSession] = useState(savedSession), [room, setRoom] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  function remember(value) { generation.current++; setSession(value); setRoom(null); try { if (value) sessionStorage.setItem('tj.room', JSON.stringify(value)); else sessionStorage.removeItem('tj.room'); } catch { setError('재입장 정보를 저장할 수 없습니다. 이 창을 유지하세요.'); } }
  function accept(next) { setRoom(old => !old || next.revision >= old.revision ? next : old); }
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController(); let timer;
    async function poll() {
      try { const data = await request(`/${session.code}`, session.token, null, controller.signal); if (!controller.signal.aborted) { accept(data.room); setError(''); } }
      catch (e) { if (!controller.signal.aborted) { setError(e.message); if ([401, 404].includes(e.status)) remember(null); } }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 2000); }
    }
    poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [session]);
  async function enter(nickname, code, options = {}) {
    setBusy(true); setError('');
    try { const data = await request(code ? `/${code}/join` : '/', null, { nickname, ...(code ? {} : options) }); remember({ code: data.room.code, token: data.token }); setRoom(data.room); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function action(action, fields = {}) {
    if (!session) return;
    const version = generation.current;
    try {
      const data = await request(`/${session.code}/actions`, session.token, { action, ...fields });
      if (generation.current !== version) return;
      if (['close', 'leave'].includes(action)) remember(null); else accept(data.room);
      setError(''); return data.room;
    } catch (e) { if (generation.current === version) setError(e.message); return false; }
  }
  return { room, session, busy, error, enter, action, forget: () => remember(null) };
}
export function invitationCode() {
  const code = new URLSearchParams(window.location.search).get('room')?.toUpperCase() || '';
  return /^[A-F0-9]{8}$/.test(code) ? code : '';
}
export default function Rooms({ connection, onClose }) {
  const [name, setName] = useState(''), [code, setCode] = useState(invitationCode);
  const [shareMessage, setShareMessage] = useState('');
  const [title, setTitle] = useState(''), [isPublic, setIsPublic] = useState(true), [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilityChoice, setVisibilityChoice] = useState(null);
  const nicknameInput = useRef(null), dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    nicknameInput.current?.focus();
    return () => previous?.focus();
  }, []);
  const [buttonFeedback, setButtonFeedback] = useState({});
  const feedbackTimers = useRef({});
  useEffect(() => () => Object.values(feedbackTimers.current).forEach(clearTimeout), []);
  function flashButton(button, text) {
    clearTimeout(feedbackTimers.current[button]);
    setButtonFeedback(previous => ({ ...previous, [button]: text }));
    feedbackTimers.current[button] = setTimeout(() => {
      setButtonFeedback(previous => ({ ...previous, [button]: '' }));
    }, 2000);
  }
  const invitedCode = invitationCode();
  const { room, session, error, busy, enter, action, forget } = connection;
  const inviteUrl = room ? new URL(`/?room=${room.code}`, window.location.origin).href : '';
  async function copyInvite() {
    flashButton('copy', '✓ 눌렀어요');
    try { await navigator.clipboard.writeText(inviteUrl); flashButton('copy', '✓ 복사됨'); setShareMessage('초대 링크를 복사했습니다. 원하는 곳에 붙여넣어 보내세요.'); }
    catch { flashButton('copy', '직접 복사해 주세요'); setShareMessage('초대 링크를 길게 누르거나 선택하여 복사해 주세요.'); }
  }
  return <dialog ref={dialog} className="admin-dialog room-dialog" aria-labelledby="room-dialog-title" onCancel={e => { e.preventDefault(); if (!busy && !visibilityBusy) onClose(); }} onClick={e => { if (e.target === dialog.current && !busy && !visibilityBusy) onClose(); }}><div className="dialog-inner">
    <div className="section-heading"><div><span className="eyebrow">SING TOGETHER</span><h2 id="room-dialog-title">방 관리{room && <span className="room-title">/ {room.title}</span>}</h2></div><button className="icon-button" disabled={busy || visibilityBusy} aria-label="방 관리 닫기" onClick={onClose}><X size={22}/></button></div>
    {room ? <p className="room-members">참가자 {room.members.length}명 · {room.members.map(m => `${m.name}${m.host ? ' (방장)' : ''}`).join(', ')}</p> : <p className="dialog-description">방을 만들거나 찾아 입장하세요.</p>}
    {invitedCode && session && session.code !== invitedCode && <p className="error-box">다른 방의 초대 링크입니다. 현재 방에서 나간 뒤 코드 {invitedCode}로 입장하세요. 방장은 먼저 방을 종료해야 합니다.</p>}
    {room ? <>{room.isHost && <label className="room-visibility"><input type="checkbox" aria-label="방 공개" checked={visibilityChoice ?? room.isPublic} disabled={visibilityBusy} onChange={async e => { const checked = e.target.checked; setVisibilityChoice(checked); setVisibilityBusy(true); try { await action('visibility', { isPublic: checked }); } finally { setVisibilityBusy(false); setVisibilityChoice(null); } }}/>방 찾기에 공개</label>}<p>입장 코드 <strong className="room-code">{room.code}</strong></p><div className="room-share">
      <button aria-label="초대 링크 복사" className={`secondary ${buttonFeedback.copy ? 'share-feedback' : ''}`} onClick={copyInvite}>{buttonFeedback.copy || '초대 링크 복사'}</button>
      <input className="room-invite-url" aria-label="초대 링크" readOnly value={inviteUrl} onFocus={e => e.target.select()}/>
    </div>{shareMessage && <p className="room-share-status" role="status">{shareMessage}</p>}
    <button className="primary room-exit" onClick={() => { if (!room.isHost || window.confirm('방과 예약 목록을 모두 삭제할까요?')) action(room.isHost ? 'close' : 'leave'); }}>{room.isHost ? '방 종료' : '나가기'}</button></> : session ? <><p>방에 다시 연결하고 있습니다…</p><button className="secondary" onClick={forget}>재입장 취소</button></> : <>{invitedCode && <p className="invite-notice">노래방에 초대받았어요! 닉네임을 입력하고 입장하세요.</p>}<p>방장 휴대폰 한 대로 재생하고, 각자 휴대폰에서 예약하세요.</p><form className="room-entry" onSubmit={e => { e.preventDefault(); enter(name, code, { title, isPublic }); }}><label>닉네임<input ref={nicknameInput} aria-label="방 닉네임" required maxLength={30} value={name} onChange={e => setName(e.target.value)}/></label><label>방 코드<input aria-label="방 코드" maxLength={8} value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, ''))}/></label>{!code && <div className="room-create-options"><label className="field">방 이름 (선택)<input aria-label="새 방 이름" maxLength={60} placeholder="예: 오늘의 한곡 모임" value={title} onChange={e => setTitle(e.target.value)}/></label><label className="room-visibility"><input type="checkbox" aria-label="새 방 공개" checked={isPublic} onChange={e => setIsPublic(e.target.checked)}/>공개 방으로 만들기 (방 찾기에 표시)</label></div>}<button className="primary" disabled={busy || !name.trim() || (code.length > 0 && code.length !== 8)}>{busy ? '연결 중…' : code ? '방 입장' : '새 방 만들기'}</button></form><small>코드를 비워 두면 새 방을 만듭니다. 기본은 공개이며, 방장만 공개 여부를 변경할 수 있습니다.</small><PublicRooms onSelect={selected => { setCode(selected.code); nicknameInput.current?.focus(); }}/></>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </div></dialog>;
}

function PublicRooms({ onSelect }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [rooms, setRooms] = useState([]), [hasMore, setHasMore] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let timer;
    setLoading(true);
    async function refresh() {
      try {
        const data = await request(`/?q=${encodeURIComponent(query)}&page=${page}`, null, null, controller.signal);
        if (!controller.signal.aborted) { setRooms(data.rooms); setHasMore(data.hasMore); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError('방 목록을 불러오지 못했습니다. 다시 시도해 주세요.'); }
      finally { if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(refresh, 10000); } }
    }
    timer = setTimeout(refresh, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, page, revision]);
  return <div className="public-rooms"><div className="section-heading"><h3>방 찾기</h3><button className="text-button" onClick={() => setRevision(v => v + 1)}>목록 새로고침</button></div><label className="field">방 이름 · 방장 검색<input aria-label="공개 방 검색" maxLength={100} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/></label>{error ? <p role="alert">{error}</p> : loading ? <p role="status">공개 방을 찾고 있습니다…</p> : rooms.length ? <ul className="public-room-list">{rooms.map(room => <li key={room.code}><div><strong>{room.title}</strong><span>방장 {room.hostName} · {room.memberCount}명 입장</span></div><button className="secondary" aria-label={`${room.title} 방 선택`} onClick={() => onSelect(room)}>선택</button></li>)}</ul> : <p>검색된 공개 방이 없습니다.</p>}<div className="room-pages"><button className="secondary" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>이전 방 목록</button><span>{page}페이지</span><button className="secondary" disabled={!hasMore || loading || !!error} onClick={() => setPage(p => p + 1)}>다음 방 목록</button></div><small>방을 선택하고 위에서 닉네임을 입력해 입장하세요. 비공개 방은 코드나 초대 링크로 입장할 수 있습니다.</small></div>;
}
