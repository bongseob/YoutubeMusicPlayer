import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, Mic2, ExternalLink } from 'lucide-react';
import { songLabel } from './storage.js';

let apiPromise;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { apiPromise = undefined; reject(new Error('YouTube 연결 시간이 초과되었습니다. 네트워크를 확인해 주세요.')); }, 20000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); apiPromise = undefined; reject(new Error('YouTube 플레이어를 불러올 수 없습니다.')); };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export default function Player({ current, onNext, queueLength, onPlayback, onFallback }) {
  const host = useRef(null), player = useRef(null), latest = useRef({ current, onNext, onPlayback, onFallback });
  latest.current = { current, onNext, onPlayback, onFallback };
  const [ready, setReady] = useState(false), [playing, setPlaying] = useState(false), [error, setError] = useState(''), [blocked, setBlocked] = useState(false);
  const videoId = current?.playback_video_id || current?.youtube_video_id;
  useEffect(() => {
    if (!current) return;
    let cancelled = false, fallbackPending = false;
    setReady(false); setError(''); setBlocked(false); setPlaying(false);
    loadApi().then(YT => {
      if (cancelled || !host.current) return;
      const mount = document.createElement('div');
      host.current.replaceChildren(mount);
      player.current = new YT.Player(mount, {
        width: '100%', height: '100%', videoId,
        playerVars: { playsinline: 1, origin: window.location.origin, autoplay: 1 },
        events: {
          onReady: event => { if (!cancelled) { setReady(true); event.target.playVideo(); } },
          onStateChange: event => {
            if (cancelled) return;
            setPlaying(event.data === YT.PlayerState.PLAYING);
            const status = ({ 1: 'playing', 2: 'paused', 3: 'loading' })[event.data];
            if (status) latest.current.onPlayback?.(status);
            if (event.data === YT.PlayerState.PLAYING) setBlocked(false);
            if (event.data === YT.PlayerState.ENDED) latest.current.onNext();
          },
          onAutoplayBlocked: () => { if (!cancelled) { setBlocked(true); latest.current.onPlayback?.('blocked'); } },
          onError: async event => {
            if (cancelled || fallbackPending) return;
            setPlaying(false);
            const song = latest.current.current;
            if ([101, 150].includes(event.data) && song.brand === 'TJ' && !song.playback_brand && latest.current.onFallback) {
              fallbackPending = true;
              setError('TJ 외부 재생 제한으로 같은 곡의 금영 영상을 찾고 있습니다…');
              try { if (await latest.current.onFallback(song)) return; }
              catch { /* Keep the original error and external link available. */ }
              if (cancelled) return;
              latest.current.onPlayback?.('error');
              setError('TJ 영상의 외부 재생이 제한되었습니다. 사용할 수 있는 동일 곡의 금영 대체 영상을 찾지 못했습니다.');
              return;
            }
            latest.current.onPlayback?.('error');
            setError(({ 2: '영상 주소가 올바르지 않습니다.', 5: '이 브라우저에서 재생할 수 없습니다.', 100: '삭제되었거나 비공개인 영상입니다.', 101: '이 영상은 외부 재생을 허용하지 않습니다.', 150: '이 영상은 외부 재생을 허용하지 않습니다.', 153: 'YouTube가 재생 출처를 확인할 수 없습니다. 브라우저와 접속 주소를 확인해 주세요.' })[event.data] || '영상을 재생할 수 없습니다.');
          },
        },
      });
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; player.current?.destroy(); player.current = null; };
  }, [current?.queueId, videoId]);
  return <section className="player-card" aria-label="노래 재생">
    <div className="section-eyebrow"><span className="live-dot"/> NOW PLAYING <span className="right-label">나만의 작은 노래방</span></div>
    <div className="video-frame">
      {current ? <div className="youtube-host" ref={host}/> : <div className="player-empty"><div className="mic-orbit"><Mic2 size={36}/></div><strong>오늘은 어떤 노래를 부를까요?</strong><span>마음에 드는 곡을 예약하고 시작해 보세요.</span><div className="wave">▂ ▄ ▆ ▃ █ ▅ ▂ ▆ ▄ ▂ ▅ ▃</div></div>}
    </div>
    {error && <div className="player-message" role="alert">{error} {current && <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">YouTube에서 열기 <ExternalLink size={13}/></a>}</div>}
    {current?.playback_brand === 'KY' && <p className="player-message fallback-notice" role="status">TJ 외부 재생 제한 · 금영 KY {current.playback_song_number} 영상으로 대체 재생합니다.</p>}
    {blocked && <p className="player-message" role="status">자동재생이 제한되었습니다. 아래 재생 버튼을 눌러 주세요.</p>}
    <div className="now-info"><div className="now-title"><span className="small-label">{current ? songLabel(current) : 'READY WHEN YOU ARE'}</span><h2>{current?.title || '첫 곡을 골라 주세요'}</h2><p>{current?.artist || '검색 · 예약 · 재생, 이곳에서 한 번에'}</p></div><div className="transport"><button className="play-main" aria-label={playing ? '일시정지' : '재생'} disabled={!current || !ready || !!error} onClick={() => playing ? player.current?.pauseVideo() : player.current?.playVideo()}>{playing ? <Pause fill="currentColor" size={21}/> : <Play fill="currentColor" size={21}/>}</button><button className="icon-button" aria-label="다음 곡" disabled={!current && !queueLength} onClick={onNext}><SkipForward size={23}/></button></div></div>
  </section>;
}
