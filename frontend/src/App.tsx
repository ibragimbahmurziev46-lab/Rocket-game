import { useState, useEffect, useRef, useMemo } from 'react';
import './App.css';

interface Lesson {
  id: number;
  group: string;
  start_time: string;
  room: string;
}

const API_URL = 'http://localhost:8000/api/schedule';
const EXPIRE_MINUTES = 10;
const FLIP_INTERVAL_MS = 10000;
const FLIP_DURATION_MS = 600;
const FLIP_STAGGER_MS = 120;

const TIME_LEN = 5;
const GROUP_LEN = 6;
const ROOM_LEN = 14;
const STATUS_LEN = 5;

const getInitialTime = (): Date => {
  const params = new URLSearchParams(window.location.search);
  const mock = params.get('mockTime');
  if (mock && /^\d{1,2}:\d{2}$/.test(mock)) {
    const [h, m] = mock.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }
  return new Date();
};

function CharCells({ text, length, forceEmpty }: { text: string; length: number; forceEmpty?: boolean }) {
  const padded = forceEmpty
    ? ' '.repeat(length)
    : text.padEnd(length, ' ').slice(0, length);

  return (
    <>
      {padded.split('').map((ch, i) => {
        const isEmpty = ch === ' ';
        return (
          <span key={i} className={`cell ${isEmpty ? 'empty' : ''}`}>
            {isEmpty ? '\u00A0' : ch}
          </span>
        );
      })}
    </>
  );
}

function App() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(getInitialTime);
  const [flipTrigger, setFlipTrigger] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const [isMocked] = useState<boolean>(() =>
    new URLSearchParams(window.location.search).has('mockTime')
  );

  useEffect(() => {
    const initTimer = setTimeout(() => setFlipTrigger(t => t + 1), 50);
    return () => clearTimeout(initTimer);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setFlipTrigger(t => t + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(prev => {
        const next = isMocked ? new Date(prev.getTime() + 1000) : new Date();
        if (next.getSeconds() % 10 === 0) {
          setFlipTrigger(t => t + 1);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isMocked]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(API_URL);
        const data = await response.json();
        setLessons(data.schedule);
      } catch (error) {
        console.error('Ошибка загрузки расписания:', error);
      }
    };
    fetchData();
    const fetchTimer = setInterval(fetchData, FLIP_INTERVAL_MS);
    return () => clearInterval(fetchTimer);
  }, []);

  const [snapshotTime, setSnapshotTime] = useState<Date>(currentTime);
  const [snapshotLessons, setSnapshotLessons] = useState<Lesson[]>([]);
  const lessonsRef = useRef<Lesson[]>(lessons);
  const timeRef = useRef<Date>(currentTime);

  useEffect(() => { lessonsRef.current = lessons; }, [lessons]);
  useEffect(() => { timeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    setSnapshotTime(timeRef.current);
    setSnapshotLessons(lessonsRef.current);
  }, [flipTrigger, lessons]);

  const displayedLessons = useMemo(() => {
    return snapshotLessons
      .filter(lesson => {
        const start = new Date(lesson.start_time);
        const diff = (snapshotTime.getTime() - start.getTime()) / 60000;
        return diff < EXPIRE_MINUTES;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [snapshotLessons, snapshotTime]);

  useEffect(() => {
    if (displayedLessons.length > rowCount) {
      setRowCount(displayedLessons.length);
    }
  }, [displayedLessons.length, rowCount]);

  const rows: (Lesson | null)[] = Array.from(
    { length: rowCount },
    (_, i) => displayedLessons[i] ?? null
  );

  return (
    <div className="board">
      <div className="header">
        {currentTime.toLocaleTimeString('ru-RU')}
      </div>

      <div className="board-header">
        <div className="col time-col">Время</div>
        <div className="col group-col">Группа</div>
        <div className="col room-col">Аудитория</div>
        <div className="col status-col">Статус</div>
      </div>

      <div className="board-body">
        {rows.map((lesson, index) => (
          <FlipRow
            key={index}
            lesson={lesson}
            currentTime={snapshotTime}
            flipTrigger={flipTrigger}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

interface FlipRowProps {
  lesson: Lesson | null;
  currentTime: Date;
  flipTrigger: number;
  index: number;
}

function FlipRow({ lesson, currentTime, flipTrigger, index }: FlipRowProps) {
  const [flipping, setFlipping] = useState(false);
  const [visibleLesson, setVisibleLesson] = useState<Lesson | null>(lesson);
  const [visibleTime, setVisibleTime] = useState<Date>(currentTime);
  const lessonRef = useRef(lesson);
  const timeRef = useRef(currentTime);

  useEffect(() => {
    lessonRef.current = lesson;
  }, [lesson]);

  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (flipTrigger === 0) return;
    const delay = index * FLIP_STAGGER_MS;
    const half = FLIP_DURATION_MS / 2;

    const startTimer = setTimeout(() => setFlipping(true), delay);
    const swapTimer = setTimeout(() => {
      setVisibleLesson(lessonRef.current);
      setVisibleTime(timeRef.current);
    }, delay + half);
    const endTimer = setTimeout(() => setFlipping(false), delay + FLIP_DURATION_MS);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(swapTimer);
      clearTimeout(endTimer);
    };
  }, [flipTrigger, index]);

  if (visibleLesson === null) {
    return (
      <div className={`row ${flipping ? 'flipping' : ''}`}>
        <div className="col time-col"><CharCells text="" length={TIME_LEN} forceEmpty /></div>
        <div className="col group-col"><CharCells text="" length={GROUP_LEN} forceEmpty /></div>
        <div className="col room-col"><CharCells text="" length={ROOM_LEN} forceEmpty /></div>
        <div className="col status-col"><CharCells text="" length={STATUS_LEN} forceEmpty /></div>
      </div>
    );
  }

  const start = new Date(visibleLesson.start_time);
  const end = new Date(start.getTime() + 80 * 60000);
  const isOngoing = visibleTime >= start && visibleTime <= end;

  return (
    <div className={`row ${flipping ? 'flipping' : ''}`}>
      <div className="col time-col">
        <CharCells
          text={start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          length={TIME_LEN}
        />
      </div>
      <div className="col group-col">
        <CharCells text={visibleLesson.group} length={GROUP_LEN} />
      </div>
      <div className="col room-col">
        <CharCells text={visibleLesson.room} length={ROOM_LEN} />
      </div>
      <div className="col status-col">
        <CharCells text={isOngoing ? 'ИДЕТ' : ''} length={STATUS_LEN} />
      </div>
    </div>
  );
}

export default App;