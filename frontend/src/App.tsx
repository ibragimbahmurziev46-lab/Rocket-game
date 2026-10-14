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
    const timer = setInterval(() => {
      if (isMocked) {
        setCurrentTime(prev => new Date(prev.getTime() + 1000));
      } else {
        setCurrentTime(new Date());
      }
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

  useEffect(() => {
    const flipTimer = setInterval(() => {
      setFlipTrigger(t => t + 1);
    }, FLIP_INTERVAL_MS);
    return () => clearInterval(flipTimer);
  }, []);

  const displayedLessons = useMemo(() => {
    return lessons
      .filter(lesson => {
        const start = new Date(lesson.start_time);
        const diff = (currentTime.getTime() - start.getTime()) / 60000;
        return diff < EXPIRE_MINUTES;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [lessons, currentTime]);

  // Количество строк только растёт, никогда не уменьшается —
  // иначе последняя строка исчезала бы мгновенно, без анимации.
  useEffect(() => {
    if (displayedLessons.length > rowCount) {
      setRowCount(displayedLessons.length);
    }
  }, [displayedLessons.length, rowCount]);

  // Мгновенный переворот в момент истечения пары.
  const prevLenRef = useRef<number>(0);
  useEffect(() => {
    if (displayedLessons.length < prevLenRef.current) {
      setFlipTrigger(t => t + 1);
    }
    prevLenRef.current = displayedLessons.length;
  }, [displayedLessons.length]);

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
            currentTime={currentTime}
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
  const lessonRef = useRef(lesson);

  useEffect(() => {
    lessonRef.current = lesson;
  }, [lesson]);

  useEffect(() => {
    if (flipTrigger === 0) return;
    const delay = index * 120;
    const startTimer = setTimeout(() => setFlipping(true), delay);
    const swapTimer = setTimeout(() => setVisibleLesson(lessonRef.current), delay + 300);
    const endTimer = setTimeout(() => setFlipping(false), delay + 600);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(swapTimer);
      clearTimeout(endTimer);
    };
  }, [flipTrigger, index]);

  if (visibleLesson === null) {
    return (
      <div className={`row ${flipping ? 'flipping' : ''}`}>
        <div className="col time-col">&nbsp;</div>
        <div className="col group-col">&nbsp;</div>
        <div className="col room-col">&nbsp;</div>
        <div className="col status-col">&nbsp;</div>
      </div>
    );
  }

  const start = new Date(visibleLesson.start_time);
  const end = new Date(start.getTime() + 80 * 60000);
  const isOngoing = currentTime >= start && currentTime <= end;

  return (
    <div className={`row ${flipping ? 'flipping' : ''}`}>
      <div className="col time-col">
        {start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="col group-col">{visibleLesson.group}</div>
      <div className="col room-col">{visibleLesson.room}</div>
      <div className="col status-col">{isOngoing ? 'ИДЕТ' : ''}</div>
    </div>
  );
}

export default App;