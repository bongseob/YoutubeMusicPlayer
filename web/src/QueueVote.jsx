import { useId } from 'react';
import { ThumbsUp, ArrowUp, Check } from 'lucide-react';

export default function QueueVote({ song, index, isHost, busy, onAction }) {
  const countId = useId();
  return <div className="queue-vote-controls">
    <button type="button" className="queue-vote-button" aria-pressed={song.votedByMe === true}
      aria-label={`${song.title} 다음 곡 투표 (예약 ${index + 1})`} aria-describedby={`queue-vote-help ${countId}`} disabled={busy}
      onClick={() => onAction('vote', { queueId: song.votedByMe ? null : song.queueId })}>
      {song.votedByMe ? <Check size={16} aria-hidden="true"/> : <ThumbsUp size={16} aria-hidden="true"/>}<span>다음 곡 투표</span><strong id={countId}>{song.voteCount || 0}표</strong>
    </button>
    {isHost && <button type="button" className="queue-choose-next" disabled={busy || index === 0}
      aria-label={`${song.title} ${index === 0 ? '다음 재생곡' : '다음 곡으로 지정'} (예약 ${index + 1})`} onClick={() => onAction('chooseNext', { queueId: song.queueId })}>
      <ArrowUp size={14} aria-hidden="true"/>{index === 0 ? '다음 재생곡' : '다음 곡으로 지정'}
    </button>}
  </div>;
}
