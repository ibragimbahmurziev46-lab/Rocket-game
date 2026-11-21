import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import './App.css';

interface Lesson {
  id: string;
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

const TOTAL_COLS = TIME_LEN + GROUP_LEN + ROOM_LEN + STATUS_LEN;

const OFFSET_TIME = 0;
const OFFSET_GROUP = OFFSET_TIME + TIME_LEN;
const OFFSET_ROOM = OFFSET_GROUP + GROUP_LEN;
const OFFSET_STATUS = OFFSET_ROOM + ROOM_LEN;

const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getInitialTime = (): Date => {
  const params = new URLSearchParams(window.location.search);
  const mockTime = params.get('mockTime');
  const mockDate = params.get('mockDate');
  const d = new Date();

  if (mockDate) {
    const [year, month, day] = mockDate.split('-').map(Number);
    d.setFullYear(year, month - 1, day);
  }
  if (mockTime && /^\d{1,2}:\d{2}$/.test(mockTime)) {
    const [h, m] = mockTime.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
};

const getInitialDate = (): Date => {
  const params = new URLSearchParams(window.location.search);
  const mockDate = params.get('mockDate');
  if (mockDate) {
    const [year, month, day] = mockDate.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date();
};

function App() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [currentTime, setCurrentTime] = useState<Date>(getInitialTime);
  const [viewDate, setViewDate] = useState<Date>(getInitialDate);
  const [flipTrigger, setFlipTrigger] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const [isTimeEditing, setIsTimeEditing] = useState(false);
  const boardBodyRef = useRef<HTMLDivElement>(null);
  
  const [isMocked, setIsMocked] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('mockTime') || params.has('mockDate');
  });
  
  useEffect(() => {
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const scrollResetTimer = setInterval(() => {
      if (boardBodyRef.current) {
        boardBodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 60000);
    return () => clearInterval(scrollResetTimer);
  }, []);

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

  const dateString = useMemo(() => formatDate(viewDate), [viewDate]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}?date=${dateString}`);
        const data = await response.json();
        setLessons(data.schedule || []);
      } catch (error) {
        console.error('Ошибка загрузки расписания:', error);
      }
    };
    fetchData();
    const fetchTimer = setInterval(fetchData, FLIP_INTERVAL_MS);
    return () => clearInterval(fetchTimer);
  }, [dateString]);

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

  const isToday = dateString === formatDate(new Date());

  const displayedLessons = useMemo(() => {
    return snapshotLessons
      .filter(lesson => {
        if (!isToday) return true; 
        const start = new Date(lesson.start_time);
        const diff = (snapshotTime.getTime() - start.getTime()) / 60000;
        return diff < EXPIRE_MINUTES;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [snapshotLessons, snapshotTime, isToday]);

  useEffect(() => {
    if (displayedLessons.length > rowCount) {
      setRowCount(displayedLessons.length);
    }
  }, [displayedLessons.length, rowCount]);

  const rows: (Lesson | null)[] = useMemo(() => Array.from(
    { length: rowCount },
    (_, i) => displayedLessons[i] ?? null
  ), [rowCount, displayedLessons]);

  const isScheduleEmpty = displayedLessons.length === 0;
  const [visibleShowLogo, setVisibleShowLogo] = useState(isScheduleEmpty);
  
  useEffect(() => {
    if (flipTrigger === 0) {
      setVisibleShowLogo(isScheduleEmpty);
      return;
    }
    const timer = setTimeout(() => {
      setVisibleShowLogo(isScheduleEmpty);
    }, FLIP_DURATION_MS / 2);
    return () => clearTimeout(timer);
  }, [flipTrigger, isScheduleEmpty]);

  const logoRows = useMemo(() => {
    if (!visibleShowLogo) return [];
    
    // Используем ваш массив
    const logoArt = [
      "",
      "  ███ █████ █  █ █  █ ███  ",
      "   █    █   █  █ █  █ █  █ ",
      "   █    █   ████ █  █ ███  ",
      "   █    █   █  █ █  █ █  █ ",
      "  ███   █   █  █  ██  ███  ",
      "",
      "",
      "  █   █  ██   ██   ██   ███ ",
      "  ██ ██ █  █ █    █  █ █    ",
      "  █ █ █ ████ █ ██ ████  ██  ",
      "  █   █ █  █ █  █ █  █    █ ",
      "  █   █ █  █  ██  █  █ ███  ",
      ""
    ];
    
    const cellHeightVw = 3.5; 
    const rowGapVw = 0.15;    
    const totalRowHeightVw = cellHeightVw + rowGapVw;
    const pixelsPerVw = window.innerWidth / 100;
    const rowHeightPx = totalRowHeightVw * pixelsPerVw;
    
    const headerHeightPx = 16 * pixelsPerVw; 
    const availableHeightPx = windowHeight - headerHeightPx;
    const totalScreenRows = Math.floor(availableHeightPx / rowHeightPx);
    
    const paddingTop = Math.max(0, Math.floor((totalScreenRows - logoArt.length) / 2));
    const paddingBottom = Math.max(0, totalScreenRows - logoArt.length - paddingTop);
    
    // Находим самую длинную строку, чтобы выровнять все остальные по ней
    const maxLength = Math.max(...logoArt.map(l => l.length));
    // Вычисляем единый отступ слева для всего блока
    const paddingLeft = Math.max(0, Math.floor((TOTAL_COLS - maxLength) / 2));

    const result: { text: string, isPurple: boolean }[] = [];
    
    // Пустые строки сверху
    for (let i = 0; i < paddingTop; i++) result.push({ text: ' '.repeat(TOTAL_COLS), isPurple: false });
    
    logoArt.forEach((line, index) => {
      // Строки с индексами 1, 2, 3, 4, 5 — это ITHUB (делаем их фиолетовыми)
      const isPurple = index > 0 && index < 6;
      
      // Добавляем единый отступ слева и добиваем пробелами справа до TOTAL_COLS
      const paddedLine = ' '.repeat(paddingLeft) + line.padEnd(TOTAL_COLS - paddingLeft, ' ');
      
      result.push({ text: paddedLine, isPurple });
    });
    
    // Пустые строки снизу
    for (let i = 0; i < paddingBottom; i++) result.push({ text: ' '.repeat(TOTAL_COLS), isPurple: false });
    
    return result;
  }, [visibleShowLogo, windowHeight]);

  const handlePrevDay = useCallback(() => {
    setViewDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() - 1);
      return newDate;
    });
  }, []);

  const handleNextDay = useCallback(() => {
    setViewDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + 1);
      return newDate;
    });
  }, []);

  const adjustTimePart = useCallback((part: 'hours' | 'minutes' | 'seconds', amount: number) => {
    setIsMocked(true);
    setCurrentTime(prev => {
      const next = new Date(prev);
      if (part === 'hours') next.setHours(next.getHours() + amount);
      if (part === 'minutes') next.setMinutes(next.getMinutes() + amount);
      if (part === 'seconds') next.setSeconds(next.getSeconds() + amount);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    const now = new Date();
    setCurrentTime(now);
    setViewDate(now);
    setIsMocked(false);
    setIsTimeEditing(false);
  }, []);

  return (
    <div className="board">
      <div className="header-container">
        <div className="header-group">
          <div className="clock-row">
            <button onClick={handleReset} className="reset-btn" title="Сбросить на текущее время">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </button>

            <div className="clock-container" onClick={() => setIsTimeEditing(!isTimeEditing)}>
              {isTimeEditing ? (
                <div className="time-editor">
                  <div className="time-column">
                    <button onClick={(e) => { e.stopPropagation(); adjustTimePart('hours', 1); }} className="arrow-btn">▲</button>
                    <span className="time-val">{String(currentTime.getHours()).padStart(2, '0')}</span>
                    <button onClick={(e) => { e.stopPropagation(); adjustTimePart('hours', -1); }} className="arrow-btn">▼</button>
                  </div>
                  <span className="time-sep">:</span>
                  <div className="time-column">
                    <button onClick={(e) => { e.stopPropagation(); adjustTimePart('minutes', 1); }} className="arrow-btn">▲</button>
                    <span className="time-val">{String(currentTime.getMinutes()).padStart(2, '0')}</span>
                    <button onClick={(e) => { e.stopPropagation(); adjustTimePart('minutes', -1); }} className="arrow-btn">▼</button>
                  </div>
                  <span className="time-sep">:</span>
                  <div className="time-column">
                    <button onClick={(e) => { e.stopPropagation(); adjustTimePart('seconds', 1); }} className="arrow-btn">▲</button>
                    <span className="time-val">{String(currentTime.getSeconds()).padStart(2, '0')}</span>
                    <button onClick={(e) => { e.stopPropagation(); adjustTimePart('seconds', -1); }} className="arrow-btn">▼</button>
                  </div>
                </div>
              ) : (
                <div className="clock-display">
                  {currentTime.toLocaleTimeString('ru-RU')}
                </div>
              )}
            </div>
            <div className="spacer-btn"></div>
          </div>
          
          <div className="date-controls">
            <button onClick={handlePrevDay} className="nav-btn">◀</button>
            <span className="current-date">
              {viewDate.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={handleNextDay} className="nav-btn">▶</button>
          </div>
        </div>
      </div>

      <div className="board-header">
        <div className="col time-col">Время</div>
        <div className="col group-col">Группа</div>
        <div className="col room-col">Аудитория</div>
        <div className="col status-col">Статус</div>
      </div>

      <div className="board-body" ref={boardBodyRef}>
        {visibleShowLogo ? (
          logoRows.map((rowData, rowIndex) => (
             <div className="row logo-row" key={`logo-${rowIndex}`}>
                {rowData.text.split('').map((char, charIndex) => (
                  <span className={`col logo-col ${rowData.isPurple ? 'purple-char' : ''}`} key={`logo-char-${rowIndex}-${charIndex}`}>
                    <FlipChar 
                      targetChar={char} 
                      absoluteCharIndex={charIndex} 
                      rowIndex={rowIndex} 
                      flipTrigger={flipTrigger} 
                      isRowVisible={true} 
                    />
                  </span>
                ))}
             </div>
          ))
        ) : (
          rows.map((lesson, index) => (
            <MemoizedFlipRow
              key={index}
              lesson={lesson}
              currentTime={snapshotTime}
              flipTrigger={flipTrigger}
              index={index}
            />
          ))
        )}
      </div>
    </div>
  );
}

// --- МЕМОИЗИРОВАННЫЕ КОМПОНЕНТЫ ---

interface FlipRowProps {
  lesson: Lesson | null;
  currentTime: Date;
  flipTrigger: number;
  index: number;
}

const MemoizedFlipRow = memo(({ lesson, currentTime, flipTrigger, index }: FlipRowProps) => {
  const [visibleTime, setVisibleTime] = useState<Date>(currentTime);
  const [isRowVisible, setIsRowVisible] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(currentTime);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsRowVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    if (rowRef.current) observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { timeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    if (flipTrigger === 0) return;
    const delay = index * ROW_STAGGER_MS;
    const half = FLIP_DURATION_MS / 2;
    const swapTimer = setTimeout(() => setVisibleTime(timeRef.current), delay + half);
    return () => clearTimeout(swapTimer);
  }, [flipTrigger, index]);

  if (lesson === null) {
    return (
      <div className="row" ref={rowRef}>
        <div className="col time-col"><FlipText text="" length={TIME_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_TIME} isRowVisible={isRowVisible} /></div>
        <div className="col group-col"><FlipText text="" length={GROUP_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_GROUP} isRowVisible={isRowVisible} /></div>
        <div className="col room-col"><FlipText text="" length={ROOM_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_ROOM} isRowVisible={isRowVisible} /></div>
        <div className="col status-col"><FlipText text="" length={STATUS_LEN} forceEmpty flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_STATUS} isRowVisible={isRowVisible} /></div>
      </div>
    );
  }

  const start = new Date(lesson.start_time);
  const end = new Date(start.getTime() + 80 * 60000);
  const isOngoing = visibleTime >= start && visibleTime <= end;

  return (
    <div className="row" ref={rowRef}>
      <div className="col time-col">
        <FlipText text={start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} length={TIME_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_TIME} isRowVisible={isRowVisible} />
      </div>
      <div className="col group-col">
        <FlipText text={lesson.group} length={GROUP_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_GROUP} isRowVisible={isRowVisible} />
      </div>
      <div className="col room-col">
        <FlipText text={lesson.room} length={ROOM_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_ROOM} isRowVisible={isRowVisible} />
      </div>
      <div className="col status-col">
        <FlipText text={isOngoing ? 'ИДЕТ' : ''} length={STATUS_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_STATUS} isRowVisible={isRowVisible} />
      </div>
    </div>
  );
});

interface FlipTextProps {
  text: string;
  length: number;
  forceEmpty?: boolean;
  flipTrigger: number;
  rowIndex: number;
  charOffset: number;
  isRowVisible: boolean;
}

const FlipText = memo(({ text, length, forceEmpty, flipTrigger, rowIndex, charOffset, isRowVisible }: FlipTextProps) => {
  const padded = forceEmpty ? ' '.repeat(length) : text.padEnd(length, ' ').slice(0, length);
  return (
    <>
      {padded.split('').map((ch, i) => (
        <FlipChar key={i} targetChar={ch} absoluteCharIndex={charOffset + i} rowIndex={rowIndex} flipTrigger={flipTrigger} isRowVisible={isRowVisible} />
      ))}
    </>
  );
});

interface FlipCharProps {
  targetChar: string;
  absoluteCharIndex: number;
  rowIndex: number;
  flipTrigger: number;
  isRowVisible: boolean;
}

const FlipChar = memo(({ targetChar, absoluteCharIndex, rowIndex, flipTrigger, isRowVisible }: FlipCharProps) => {
  const [currentChar, setCurrentChar] = useState(targetChar);
  const [nextChar, setNextChar] = useState(targetChar);
  const [isFlipping, setIsFlipping] = useState(false);
  const targetRef = useRef(targetChar);
  const currentCharRef = useRef(currentChar);

  useEffect(() => { targetRef.current = targetChar; }, [targetChar]);
  useEffect(() => { currentCharRef.current = currentChar; }, [currentChar]);

  useEffect(() => {
    if (flipTrigger === 0) {
      setCurrentChar(targetRef.current);
      setNextChar(targetRef.current);
      return;
    }
    if (!isRowVisible) {
      setCurrentChar(targetRef.current);
      setNextChar(targetRef.current);
      return;
    }
    if (currentCharRef.current === ' ' && targetRef.current === ' ') return; 

    const totalDelay = (rowIndex * ROW_STAGGER_MS) + (absoluteCharIndex * CHAR_STAGGER_MS);
    const half = FLIP_DURATION_MS / 2;

    const startTimer = setTimeout(() => { setNextChar(targetRef.current); setIsFlipping(true); }, totalDelay);
    const swapTimer = setTimeout(() => { setCurrentChar(targetRef.current); }, totalDelay + half);
    const endTimer = setTimeout(() => { setIsFlipping(false); }, totalDelay + FLIP_DURATION_MS);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(swapTimer);
      clearTimeout(endTimer);
    };
  }, [flipTrigger, rowIndex, absoluteCharIndex, isRowVisible]);

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
});

export default App;