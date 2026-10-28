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
const ROW_STAGGER_MS = 120;
const CHAR_STAGGER_MS = 25;

const TIME_LEN = 5;
const GROUP_LEN = 6;
const ROOM_LEN = 14;
const STATUS_LEN = 5;

const OFFSET_TIME = 0;
const OFFSET_GROUP = OFFSET_TIME + TIME_LEN;
const OFFSET_ROOM = OFFSET_GROUP + GROUP_LEN;
const OFFSET_STATUS = OFFSET_ROOM + ROOM_LEN;

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
  const [visibleTime, setVisibleTime] = useState<Date>(currentTime);
  const timeRef = useRef(currentTime);

  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (flipTrigger === 0) return;
    const delay = index * ROW_STAGGER_MS;
    const half = FLIP_DURATION_MS / 2;

    const swapTimer = setTimeout(() => {
      setVisibleTime(timeRef.current);
    }, delay + half);

    return () => clearTimeout(swapTimer);
  }, [flipTrigger, index]);

  if (lesson === null) {
    return (
      <div className="row">
        <div className="col time-col"><FlipText text="" length={TIME_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_TIME} /></div>
        <div className="col group-col"><FlipText text="" length={GROUP_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_GROUP} /></div>
        <div className="col room-col"><FlipText text="" length={ROOM_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_ROOM} /></div>
        <div className="col status-col"><FlipText text="" length={STATUS_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_STATUS} /></div>
      </div>
    );
  }

  const start = new Date(lesson.start_time);
  const end = new Date(start.getTime() + 80 * 60000);
  const isOngoing = visibleTime >= start && visibleTime <= end;

  return (
    <div className="row">
      <div className="col time-col">
        <FlipText
          text={start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          length={TIME_LEN}
          flipTrigger={flipTrigger}
          rowIndex={index}
          charOffset={OFFSET_TIME}
        />
      </div>
      <div className="col group-col">
        <FlipText text={lesson.group} length={GROUP_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_GROUP} />
      </div>
      <div className="col room-col">
        <FlipText text={lesson.room} length={ROOM_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_ROOM} />
      </div>
      <div className="col status-col">
        <FlipText text={isOngoing ? 'ИДЕТ' : ''} length={STATUS_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_STATUS} />
      </div>
    </div>
  );
}

interface FlipTextProps {
  text: string;
  length: number;
  forceEmpty?: boolean;
  flipTrigger: number;
  rowIndex: number;
  charOffset: number;
}

function FlipText({ text, length, forceEmpty, flipTrigger, rowIndex, charOffset }: FlipTextProps) {
  const padded = forceEmpty
    ? ' '.repeat(length)
    : text.padEnd(length, ' ').slice(0, length);

  return (
    <>
      {padded.split('').map((ch, i) => (
        <FlipChar
          key={i}
          targetChar={ch}
          absoluteCharIndex={charOffset + i}
          rowIndex={rowIndex}
          flipTrigger={flipTrigger}
        />
      ))}
    </>
  );
}

interface FlipCharProps {
  targetChar: string;
  absoluteCharIndex: number;
  rowIndex: number;
  flipTrigger: number;
}

function FlipChar({ targetChar, absoluteCharIndex, rowIndex, flipTrigger }: FlipCharProps) {
  const [currentChar, setCurrentChar] = useState(targetChar);
  const [nextChar, setNextChar] = useState(targetChar);
  const [isFlipping, setIsFlipping] = useState(false);
  const targetRef = useRef(targetChar);

  useEffect(() => {
    targetRef.current = targetChar;
  }, [targetChar]);

  useEffect(() => {
    if (flipTrigger === 0) {
      setCurrentChar(targetRef.current);
      setNextChar(targetRef.current);
      return;
    }

    const totalDelay = (rowIndex * ROW_STAGGER_MS) + (absoluteCharIndex * CHAR_STAGGER_MS);
    const half = FLIP_DURATION_MS / 2;

    const startTimer = setTimeout(() => {
      setNextChar(targetRef.current);
      setIsFlipping(true);
    }, totalDelay);

    const swapTimer = setTimeout(() => {
      setCurrentChar(targetRef.current);
    }, totalDelay + half);

    const endTimer = setTimeout(() => {
      setIsFlipping(false);
    }, totalDelay + FLIP_DURATION_MS);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(swapTimer);
      clearTimeout(endTimer);
    };
  }, [flipTrigger, rowIndex, absoluteCharIndex]);

  const isCurrentEmpty = currentChar === ' ';
  const isNextEmpty = nextChar === ' ';

  return (
    <span className={`cell ${isFlipping ? 'flipping' : ''}`}>
      <span className={`half top-static ${isNextEmpty ? 'empty' : ''}`}>
        <span className="char">{isNextEmpty ? '\u00A0' : nextChar}</span>
      </span>
      <span className={`half bottom-static ${isCurrentEmpty ? 'empty' : ''}`}>
        <span className="char">{isCurrentEmpty ? '\u00A0' : currentChar}</span>
      </span>
      <span className={`half top-flap ${isCurrentEmpty ? 'empty' : ''}`}>
        <span className="char">{isCurrentEmpty ? '\u00A0' : currentChar}</span>
      </span>
      <span className={`half bottom-flap ${isNextEmpty ? 'empty' : ''}`}>
        <span className="char">{isNextEmpty ? '\u00A0' : nextChar}</span>
      </span>
    </span>
  );
}

export default App;