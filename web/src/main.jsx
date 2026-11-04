import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Search, Heart, ListMusic, Plus, Mic2, Settings2, ArrowUp, ArrowDown, X, Music2, Upload, Check, ExternalLink, ChevronLeft, ChevronRight, Play, Headphones, LogOut } from 'lucide-react';
import Player from './Player.jsx';
import Rooms, { useRoom } from './Rooms.jsx';
import Microphone from './Microphone.jsx';
import { readSongs, moveSong, songKey, songLabel, isPlayable } from './storage.js';
import './style.css';

async function api(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, options); }
  catch { throw new Error('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || '요청에 실패했습니다.'); error.details = data.details; throw error; }
  return data;
}

function App() {
  const [tab, setTab] = useState('search'), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const [songs, setSongs] = useState([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [searchError, setSearchError] = useState(''), [revision, setRevision] = useState(0);
  const [personalQueue, setQueue] = useState(() => readSongs({ getItem: key => window.localStorage.getItem(key) }, 'tj.queue', true));
  const [favorites, setFavorites] = useState(() => readSongs({ getItem: key => window.localStorage.getItem(key) }, 'tj.favorites'));
  const [personalCurrent, setCurrent] = useState(null), [adminOpen, setAdminOpen] = useState(false), [adminSong, setAdminSong] = useState(null), [toast, setToast] = useState(''), [storageError, setStorageError] = useState('');
  const connection = useRoom();
  const room = connection.room;
  const inRoom = !!connection.session;
  const canControl = !inRoom || !!room?.isHost;
  const queue = inRoom ? room?.queue || [] : personalQueue;
  const current = inRoom ? room?.current || null : personalCurrent;
  const queueRef = useRef(queue); queueRef.current = queue;
  const toastTimer = useRef();
  function notify(message) { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 2800); }
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    try { localStorage.setItem('tj.queue', JSON.stringify(personalQueue)); localStorage.setItem('tj.favorites', JSON.stringify(favorites)); setStorageError(''); }
    catch { setStorageError('기기 저장 공간에 접근할 수 없습니다. 예약과 즐겨찾기는 이 화면을 닫으면 사라질 수 있습니다.'); }
  }, [personalQueue, favorites]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setSearchError('');
    const timer = setTimeout(() => api(`/songs?q=${encodeURIComponent(query)}&page=${page}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setSongs(data.songs); setTotal(data.total); setLoading(false); }
    }).catch(err => { if (!controller.signal.aborted) { setSearchError(err.message); setLoading(false); } }), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, revision]);
  function openAdmin(song = null) { setAdminSong(song); setAdminOpen(true); }
  function reserve(song) {
    if (inRoom) { if (room) connection.action('reserve', { songId: song.id }); return; }
    if (!isPlayable(song)) return notify('영상 링크를 연결한 후 예약할 수 있습니다.');
    if (queueRef.current.length >= 500) return notify('예약은 최대 500곡까지 가능합니다.');
    const entry = { ...song, queueId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` };
    const next = [...queueRef.current, entry]; queueRef.current = next; setQueue(next); notify(`‘${song.title}’ 예약했어요`);
  }
  function nextSong() {
    if (inRoom) { if (room?.isHost) connection.action('next', { currentId: current?.queueId || null }); return; }
    const [next, ...rest] = queueRef.current;
    queueRef.current = rest; setQueue(rest); setCurrent(next || null);
  }
  function favorite(song) {
    setFavorites(previous => previous.some(item => songKey(item) === songKey(song)) ? previous.filter(item => songKey(item) !== songKey(song)) : [...previous, song]);
  }
  const favoriteSongs = favorites.filter(song => `${song.title} ${song.artist} ${songLabel(song)}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase()));
  const list = tab === 'favorites' ? favoriteSongs : songs;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="MY TJ 홈"><span className="brand-mark"><Mic2 size={23}/></span><span>MY <b>TJ</b><small>나만의 노래방</small></span></a><div className="header-actions"><span className="private-label"><Headphones size={15}/> 내 손안의 노래방</span><button className="settings-button" onClick={() => openAdmin()} aria-label="곡 관리 열기"><Settings2 size={18}/><span>곡 관리</span></button></div></header>
    <main><div className="intro"><div><span className="eyebrow">SING YOUR MOMENT</span><h1>오늘의 기분을, <span>한 곡에.</span></h1><p>좋아하는 노래를 찾고, 나만의 무대를 시작하세요.</p></div><span className="intro-note">♪</span></div>
      {storageError && <p className="error-box" role="alert">{storageError}</p>}
      <Rooms connection={connection}/>
      <div className="workspace"><div className="left-column">{canControl ? <Player key={inRoom ? room?.code : 'personal'} current={current} onNext={nextSong} queueLength={queue.length} onPlayback={inRoom ? status => connection.action('playback', { currentId: current?.queueId, status }) : undefined}/> : <section className="room-card"><h2>{current?.title || '다음 무대를 기다리고 있어요'}</h2><p>{current?.artist}</p><p>재생 상태: {({ playing: '재생 중', paused: '일시정지', loading: '준비 중', blocked: '방장 기기에서 재생 버튼을 눌러 주세요', error: '영상 재생 오류', ready: '대기 중' })[room?.playback] || '연결 중'}</p><p>소리는 방장 휴대폰에서 나옵니다.</p></section>}{room?.isHost && <Microphone key={room.code}/>}<section className="queue-card" id="queue"><div className="section-heading"><h2><ListMusic size={19}/> 예약 목록 <span className="count-pill">{queue.length}</span></h2>{canControl && queue.length > 0 && <button className="text-button" onClick={() => { if (inRoom) connection.action('clear'); else { queueRef.current = []; setQueue([]); } }}>전체 비우기</button>}</div>
        {!queue.length ? <div className="queue-empty"><ListMusic size={28}/><p>다음 무대가 기다리고 있어요</p><span>곡 옆의 + 버튼을 눌러 예약해 주세요.</span></div> : <><ol className="queue-list">{queue.map((song, index) => <li key={song.queueId}><span className="queue-number">{String(index + 1).padStart(2, '0')}</span><div className="song-copy"><strong>{song.title}</strong><span>{song.artist || '가수 미등록'}{inRoom && ` · 예약: ${song.reservedBy}`}</span></div>{canControl && <div className="queue-actions">{!inRoom && <><button className="icon-button" aria-label={`${song.title} 위로`} disabled={index === 0} onClick={() => setQueue(previous => moveSong(previous, index, -1))}><ArrowUp size={15}/></button><button className="icon-button" aria-label={`${song.title} 아래로`} disabled={index === queue.length - 1} onClick={() => setQueue(previous => moveSong(previous, index, 1))}><ArrowDown size={15}/></button></>}<button className="icon-button" aria-label={`${song.title} 예약 취소`} onClick={() => inRoom ? connection.action('remove', { queueId: song.queueId }) : setQueue(previous => previous.filter(item => item.queueId !== song.queueId))}><X size={16}/></button></div>}</li>)}</ol>{canControl && !current && <button className="primary start-button" onClick={nextSong}><Play size={16} fill="currentColor"/> 노래 시작하기</button>}</>}
        <div className="local-note"><span className="tiny-dot"/> {inRoom ? '예약은 방 전체에 공유됩니다 · 즐겨찾기는 이 기기에 저장됩니다' : '예약과 즐겨찾기는 이 기기에 저장됩니다'}</div></section></div>
      <section className="library-card"><div className="library-tabs" role="tablist" aria-label="곡 목록"><button role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}><Search size={18}/> 노래 찾기</button><button role="tab" aria-selected={tab === 'favorites'} className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}><Heart size={18}/> 즐겨찾기 <span>{favorites.length}</span></button></div>
        <div className="library-content"><form className="search-box" role="search" onSubmit={event => event.preventDefault()}><Search size={21}/><input aria-label="곡 검색" placeholder="제목, 가수 또는 TJ 번호 검색" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} maxLength={200}/>{query && <button type="button" className="icon-button" aria-label="검색어 지우기" onClick={() => { setQuery(''); setPage(1); }}><X size={17}/></button>}</form>
        <div className="results-heading"><h2>{tab === 'favorites' ? '내가 좋아하는 노래' : query ? '검색 결과' : '나의 노래 라이브러리'}</h2><span>{tab === 'favorites' ? favoriteSongs.length : total}곡</span></div>
        {tab === 'search' && searchError ? <div className="empty-library"><p role="alert">{searchError}</p><button className="secondary" onClick={() => setRevision(value => value + 1)}>다시 연결</button></div> : tab === 'search' && loading ? <div className="loading" role="status">곡을 찾고 있어요<span>···</span></div> : list.length ? <div className="song-list">{list.map(song => {
          const saved = favorites.some(item => songKey(item) === songKey(song));
          return <article className="song-row" key={songKey(song)}><div className="song-art"><Music2 size={22}/></div><div className="song-copy"><strong>{song.title}</strong><span>{song.artist || '가수 미등록'} <i>·</i> {songLabel(song)}{!isPlayable(song) && <em className="unlinked-label">영상 미연결</em>}</span></div><button className={`icon-button favorite-button ${saved ? 'saved' : ''}`} aria-label={`${song.title} 즐겨찾기 ${saved ? '해제' : '추가'}`} aria-pressed={saved} onClick={() => favorite(song)}><Heart size={18} fill={saved ? 'currentColor' : 'none'}/></button><button className="reserve-button" disabled={!isPlayable(song)} title={!isPlayable(song) ? '영상 링크를 연결해야 예약할 수 있습니다' : '예약'} onClick={() => reserve(song)} aria-label={`${song.title} 예약`}><Plus size={19}/><span>예약</span></button>{!isPlayable(song) && <button className="link-video-button" onClick={() => openAdmin(song)} aria-label={`${song.title} 영상 연결`}>영상 연결</button>}</article>;
        })}</div> : <div className="empty-library"><div className="empty-icon">{tab === 'favorites' ? <Heart size={30}/> : <Music2 size={32}/>}</div><h3>{query ? '찾으시는 노래가 없어요' : tab === 'favorites' ? '좋아하는 노래를 모아 보세요' : '첫 번째 노래를 담아 보세요'}</h3><p>{tab === 'favorites' ? '노래 옆 하트를 누르면 여기에 모아 드려요.' : 'YouTube 링크나 CSV 파일로 곡을 등록하면\n언제든 검색하고 예약할 수 있어요.'}</p>{tab !== 'favorites' && <button className="primary" onClick={() => openAdmin()}><Plus size={17}/> 곡 등록하기</button>}</div>}
        {tab === 'search' && !loading && !searchError && total > 30 && <div className="pagination"><button className="icon-button" aria-label="이전 페이지" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={19}/></button><span>{page} / {Math.ceil(total / 30)}</span><button className="icon-button" aria-label="다음 페이지" disabled={page * 30 >= total} onClick={() => setPage(value => value + 1)}><ChevronRight size={19}/></button></div>}
        <div className="library-tip"><span>TIP</span><p>등록된 곡에서 검색해요. 새로운 곡은 <button onClick={() => openAdmin()}>곡 관리</button>에서 추가하세요.</p></div></div>
      </section></div>
    </main><footer><span className="footer-logo">MY TJ</span><span>좋은 노래와 함께, 좋은 시간.</span><a href="https://www.youtube.com/channel/UCZUhx8ClCv6paFW7qi3qljg" target="_blank" rel="noreferrer">TJ YouTube 채널 <ExternalLink size={12}/></a><small>TJ미디어와 무관한 개인용 앱입니다.</small></footer>
    <nav className="mobile-nav" aria-label="빠른 이동"><button onClick={() => { setTab('search'); document.querySelector('.library-card')?.scrollIntoView({ behavior: 'smooth' }); }}><Search size={20}/>노래 찾기</button><button onClick={() => document.getElementById('queue').scrollIntoView({ behavior: 'smooth' })}><ListMusic size={20}/>예약 {queue.length > 0 ? queue.length : ''}</button><button onClick={() => { setTab('favorites'); document.querySelector('.library-card')?.scrollIntoView({ behavior: 'smooth' }); }}><Heart size={20}/>즐겨찾기</button></nav>
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {adminOpen && <Admin initialSong={adminSong} onClose={() => setAdminOpen(false)} onSaved={song => { setRevision(value => value + 1); if (song) setFavorites(previous => previous.map(item => songKey(item) === songKey(song) ? song : item)); }}/>}
  </div>;
}

function Admin({ onClose, onSaved, initialSong }) {
  const [token, setToken] = useState(''), [mode, setMode] = useState('single'), [busy, setBusy] = useState(false), [result, setResult] = useState(null), [error, setError] = useState(null), [file, setFile] = useState(null);
  const dialog = useRef(null), tokenInput = useRef(null);
  useEffect(() => { const previous = document.activeElement; dialog.current.showModal(); tokenInput.current.focus(); return () => previous?.focus(); }, []);
  async function submit(event) {
    event.preventDefault(); setError(null); setResult(null); setBusy(true);
    try {
      let data;
      const headers = { Authorization: `Bearer ${token}` };
      if (mode === 'csv') {
        if (!file) throw new Error('CSV 파일을 선택해 주세요.');
        if (file.size > 20 * 1024 * 1024) throw new Error('파일 크기는 20MB 이하여야 합니다.');
        data = await api('/admin/import', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' }, body: await file.text() });
      } else {
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        data = await api('/admin/songs', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      }
      setResult(data); onSaved(data.song);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="admin-dialog" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === dialog.current && !busy) onClose(); }}><div className="dialog-inner"><div className="section-heading"><div><span className="eyebrow">YOUR MUSIC LIBRARY</span><h2>곡 관리</h2></div><button className="icon-button" disabled={busy} aria-label="곡 관리 닫기" onClick={onClose}><X size={22}/></button></div><p className="dialog-description">태진·금영 곡을 등록하고 영상 링크를 연결하세요.</p>
    <label className="field">관리자 토큰<input ref={tokenInput} type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" placeholder="서버에 설정한 ADMIN_TOKEN" disabled={busy}/></label><p className="field-hint">이 창을 닫으면 토큰이 지워집니다.</p>
    <div className="mode-tabs"><button className={mode === 'single' ? 'active' : ''} disabled={busy} onClick={() => { setMode('single'); setResult(null); setError(null); }}><Plus size={16}/> 한 곡 등록</button><button className={mode === 'csv' ? 'active' : ''} disabled={busy} onClick={() => { setMode('csv'); setResult(null); setError(null); }}><Upload size={16}/> CSV 가져오기</button></div>
    <form onSubmit={submit}>{mode === 'single' ? <><label className="field">브랜드<select aria-label="브랜드" name="brand" defaultValue={initialSong?.brand || 'TJ'} disabled={busy}><option value="TJ">태진 (TJ)</option><option value="KY">금영 (KY)</option></select></label><label className="field">YouTube 링크 또는 영상 ID<input name="youtube_url" defaultValue={initialSong?.youtube_video_id || ''} placeholder="https://www.youtube.com/watch?v=…" maxLength={500} disabled={busy}/></label><label className="field">노래 제목 <span>*</span><input name="title" defaultValue={initialSong?.title || ''} required maxLength={200} placeholder="노래 제목을 입력하세요" disabled={busy}/></label><div className="field-pair"><label className="field">가수<input name="artist" defaultValue={initialSong?.artist || ''} maxLength={200} placeholder="가수 이름" disabled={busy}/></label><label className="field">곡 번호<input name="song_number" defaultValue={initialSong?.song_number || initialSong?.tj_number || initialSong?.ky_number || ''} inputMode="numeric" pattern="[0-9]{1,10}" maxLength={10} placeholder="예: 12345" disabled={busy}/></label></div><p className="field-hint">같은 브랜드·곡 번호는 정보를 갱신합니다. 영상 링크는 선택이며, 번호와 영상 중 하나는 필요합니다. 링크 없이 가져오면 기존 영상은 유지됩니다.</p></> : <><label className="file-drop"><Upload size={28}/><strong>{file?.name || 'CSV 파일을 선택하세요'}</strong><span>UTF-8 · 최대 20MB / 120,000행</span><input aria-label="CSV 파일" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => setFile(event.target.files[0] || null)}/></label><p className="field-hint">권장 열: brand, song_number, title, artist, youtube_url<br/>영상 링크 없이 곡 목록만 등록할 수 있습니다.<br/>같은 브랜드·번호는 갱신하고, TJ와 KY의 같은 번호는 별개로 저장합니다. 오류가 있는 파일은 전체 취소됩니다.</p><a className="template-link" href="/songs-template.csv" download>CSV 양식 다운로드 ↓</a></>}
      {error && <div className="error-box" role="alert">{error.message}{error.details?.length > 0 && <ul>{error.details.map(item => <li key={item.row}>데이터 행 {item.row}: {item.message}</li>)}</ul>}</div>}
      {result && <div className="success-box" role="status"><Check size={18}/><span>새 곡 {result.created}개 등록 · 기존 {result.updated}개 처리{result.duplicates ? ` · 파일 중복 ${result.duplicates}개 병합` : ''}</span></div>}
      <button className="primary submit-button" disabled={busy || !token.trim()} type="submit">{busy ? '저장하고 있어요…' : mode === 'single' ? '곡 저장하기' : 'CSV 가져오기'}</button>
    </form><button className="text-button forget-token" onClick={() => setToken('')} disabled={busy || !token}><LogOut size={14}/> 토큰 지우기</button>
  </div></dialog>;
}

createRoot(document.getElementById('root')).render(<App/>);
