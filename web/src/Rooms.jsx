import { useEffect, useRef, useState } from 'react';

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
  async function enter(nickname, code) {
    setBusy(true); setError('');
    try { const data = await request(code ? `/${code}/join` : '/', null, { nickname }); remember({ code: data.room.code, token: data.token }); setRoom(data.room); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function action(action, fields = {}) {
    if (!session) return;
    const version = generation.current;
    try {
      const data = await request(`/${session.code}/actions`, session.token, { action, ...fields });
      if (generation.current !== version) return;
      if (['close', 'leave'].includes(action)) remember(null); else accept(data.room);
      setError(''); return true;
    } catch (e) { if (generation.current === version) setError(e.message); return false; }
  }
  return { room, session, busy, error, enter, action, forget: () => remember(null) };
}
export default function Rooms({ connection }) {
  const [name, setName] = useState(''), [code, setCode] = useState('');
  const { room, session, error, busy, enter, action, forget } = connection;
  return <section className="room-card" aria-label="함께하는 노래방">
    <h2>함께하는 노래방</h2>
    {room ? <><p><strong>{room.title}</strong> · {room.members.length}명 · {room.isHost ? '방장 · 이 기기에서 소리가 나옵니다' : '참가자 · 방장 기기에서 함께 들어요'}</p><p>입장 코드 <strong className="room-code">{room.code}</strong></p><p>참가자: {room.members.map(m => `${m.name}${m.host ? ' (방장)' : ''}`).join(', ')}</p><button className="secondary" onClick={() => { if (!room.isHost || window.confirm('방과 예약 목록을 모두 삭제할까요?')) action(room.isHost ? 'close' : 'leave'); }}>{room.isHost ? '방 종료' : '나가기'}</button></> : session ? <><p>방에 다시 연결하고 있습니다…</p><button className="secondary" onClick={forget}>재입장 취소</button></> : <><p>방장 휴대폰 한 대로 재생하고, 각자 휴대폰에서 예약하세요.</p><form className="room-entry" onSubmit={e => { e.preventDefault(); enter(name, code); }}><label>닉네임<input aria-label="방 닉네임" required maxLength={30} value={name} onChange={e => setName(e.target.value)}/></label><label>방 코드<input aria-label="방 코드" maxLength={8} value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-F0-9]/g, ''))}/></label><button className="primary" disabled={busy || !name.trim() || (code.length > 0 && code.length !== 8)}>{busy ? '연결 중…' : code ? '방 입장' : '새 방 만들기'}</button></form><small>코드를 비워 두면 새 방을 만듭니다.</small></>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </section>;
}
