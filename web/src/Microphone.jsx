import { useEffect, useRef, useState } from 'react';

export default function Microphone() {
  const audio = useRef(null), pendingContext = useRef(null), starting = useRef(false), alive = useRef(true);
  const [enabled, setEnabled] = useState(false), [error, setError] = useState(''), [devices, setDevices] = useState([]), [device, setDevice] = useState('');
  const [volume, setVolume] = useState(0.3), [echo, setEcho] = useState(0.15), [status, setStatus] = useState('');
  const settings = useRef({ volume, echo }); settings.current = { volume, echo };
  function stop() {
    pendingContext.current?.close().catch(() => {}); pendingContext.current = null;
    const a = audio.current; audio.current = null;
    if (a) { a.stream?.getTracks().forEach(t => t.stop()); a.context?.close().catch(() => {}); }
    if (alive.current) { setEnabled(false); setStatus(''); }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; stop(); }; }, []);
  useEffect(() => { if (audio.current?.gain) { const a = audio.current; a.gain.gain.setTargetAtTime(volume, a.context.currentTime, 0.02); a.wet.gain.setTargetAtTime(echo, a.context.currentTime, 0.02); } }, [volume, echo]);
  async function refresh() { const list = await navigator.mediaDevices.enumerateDevices(); if (alive.current) setDevices(list.filter(d => d.kind === 'audioinput')); }
  async function start() {
    if (starting.current) return; starting.current = true; setError('');
    let context, stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('HTTPS와 마이크를 지원하는 브라우저에서 사용하세요.');
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('이 브라우저는 실시간 마이크 출력을 지원하지 않습니다.');
      context = new Audio({ latencyHint: 'interactive' }); pendingContext.current = context; await context.resume();
      if (!alive.current) { await context.close(); return; }
      stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(device ? { deviceId: { exact: device } } : {}), echoCancellation: true, noiseSuppression: false, autoGainControl: false }, video: false });
      if (!alive.current) { stream.getTracks().forEach(t => t.stop()); await context.close(); return; }
      const source = context.createMediaStreamSource(stream), gain = context.createGain(), delay = context.createDelay(1), wet = context.createGain(), limiter = context.createDynamicsCompressor();
      gain.gain.value = settings.current.volume; wet.gain.value = settings.current.echo; delay.delayTime.value = 0.18;
      source.connect(gain); gain.connect(limiter); gain.connect(delay); delay.connect(wet); wet.connect(limiter); limiter.connect(context.destination);
      audio.current = { context, stream, gain, wet }; pendingContext.current = null; setEnabled(true);
      stream.getAudioTracks()[0].onended = () => { stop(); if (alive.current) setError('마이크 연결이 끊겼습니다. 다시 연결해 주세요.'); };
      context.onstatechange = () => { if (alive.current && audio.current) setStatus(context.state === 'running' ? '출력 중' : '출력 일시 중단 · 재개를 눌러 주세요'); };
      setStatus(context.state === 'running' ? '출력 중' : '출력 일시 중단 · 재개를 눌러 주세요');
      await refresh().catch(() => {});
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop()); context?.close().catch(() => {}); audio.current = null; pendingContext.current = null;
      if (alive.current) { setEnabled(false); setError(e.name === 'NotAllowedError' ? '마이크 권한을 허용해 주세요.' : e.message || '마이크를 켤 수 없습니다.'); }
    } finally { starting.current = false; }
  }
  return <section className="room-card microphone-card" aria-label="마이크 설정"><h2>마이크 · 에코</h2><p>USB 마이크를 연결하고 낮은 볼륨으로 시작하세요. 출력 장치는 휴대폰의 오디오 설정을 따릅니다.</p><label className="field">입력 마이크<select aria-label="입력 마이크" value={device} disabled={enabled} onChange={e => setDevice(e.target.value)}><option value="">기기 기본 마이크</option>{devices.filter(d => d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `마이크 ${i + 1}`}</option>)}</select></label><button className="primary" onClick={enabled ? stop : start}>{enabled ? '마이크 끄기' : '마이크 켜기'}</button>{enabled && <><p role="status">{status}</p><button className="secondary" onClick={() => audio.current?.context.resume().catch(() => setError('오디오 출력을 재개하지 못했습니다.'))}>출력 재개</button></>}<label className="mic-slider">마이크 볼륨 {Math.round(volume * 100)}%<input aria-label="마이크 볼륨" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))}/></label><label className="mic-slider">에코 {Math.round(echo * 100)}%<input aria-label="에코" type="range" min="0" max="0.5" step="0.01" value={echo} onChange={e => setEcho(Number(e.target.value))}/></label><small>반주는 YouTube에서, 목소리는 이 기기에서 출력됩니다. 화면 잠금·다른 앱 전환 시 중단될 수 있습니다. 하울링이 나면 마이크를 끄세요.</small>{error && <p className="error-box" role="alert">{error}</p>}</section>;
}
