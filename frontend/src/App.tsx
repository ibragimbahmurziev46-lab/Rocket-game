import { useState, useEffect, useRef, useMemo } from 'react';
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
const GROUP_LEN = 5; 
const ROOM_LEN = 14;
const STATUS_LEN = 5;

const TOTAL_COLS = TIME_LEN + GROUP_LEN + ROOM_LEN + STATUS_LEN;

const OFFSET_TIME = 0;
const OFFSET_GROUP = OFFSET_TIME + TIME_LEN;
const OFFSET_ROOM = OFFSET_GROUP + GROUP_LEN;
const OFFSET_STATUS = OFFSET_ROOM + ROOM_LEN;

const getLocalDateString = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getLocalTimeString = (d: Date) => {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

function App() {
  const now = new Date();
  const [currentTime, setCurrentTime] = useState(now);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isActuallyEmpty, setIsActuallyEmpty] = useState(false);
  const [flipTrigger, setFlipTrigger] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const boardBodyRef = useRef<HTMLDivElement>(null);

  // Состояние для тестового (mock) времени
  const [isMocked, setIsMocked] = useState(false);
  const [mockStartTime, setMockStartTime] = useState(Date.now());
  const [mockBaseDate, setMockBaseDate] = useState(now);

  // Состояние для инпутов
  const [timeInput, setTimeInput] = useState(getLocalTimeString(now));
  const [dateInput, setDateInput] = useState(getLocalDateString(now));
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [isEditingDate, setIsEditingDate] = useState(false);

  // Отслеживание размера окна
  useEffect(() => {
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Автоматический возврат скролла наверх каждую минуту
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

  // Логика хода времени (с защитой от остановки в фоновых вкладках)
  useEffect(() => {
    const timer = setInterval(() => {
      let next: Date;
      if (isMocked) {
        // Вычисляем прошедшее время с момента старта mock-времени
        const elapsed = Date.now() - mockStartTime;
        next = new Date(mockBaseDate.getTime() + elapsed);
      } else {
        next = new Date();
      }
      
      setCurrentTime(prev => {
        // Триггер переворота строго в момент смены секунды на кратную 10
        if (next.getSeconds() !== prev.getSeconds() && next.getSeconds() % 10 === 0) {
          setFlipTrigger(t => t + 1);
        }
        return next;
      });

      // Обновляем инпуты, только если пользователь их не редактирует
      if (!isEditingTime) setTimeInput(getLocalTimeString(next));
      if (!isEditingDate) setDateInput(getLocalDateString(next));
    }, 1000);

    return () => clearInterval(timer);
  }, [isMocked, mockStartTime, mockBaseDate, isEditingTime, isEditingDate]);

  // Загрузка данных (зависит только от текущей ДАТЫ, чтобы не спамить бэкенд)
  const currentDateString = getLocalDateString(currentTime);
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}?date=${currentDateString}`);
        const data = await response.json();
        setLessons(data.schedule || []);
        setIsActuallyEmpty(data.is_empty !== undefined ? data.is_empty : (data.schedule || []).length === 0);
      } catch (error) {
        console.error('Ошибка загрузки расписания:', error);
      }
    };
    fetchData();
    const fetchTimer = setInterval(fetchData, FLIP_INTERVAL_MS);
    return () => clearInterval(fetchTimer);
  }, [currentDateString]);

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

  // Логика появления логотипа
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

  let logoRows: string[] = [];
  if (visibleShowLogo) {
    const logoArt = [
      " ███ ██████  █ █  █ ███ █████",
      "  █    █  █  █ █  █ █  ██   █",
      "  █    █  ████ █  █ ███ █ █ █",
      "  █    █  █  █ █  █ █  ██   █",
      " ███   █  █  █  ██  ███ █████",
      "",
    ];
    const cellHeightVw = 3.4;
    const rowGapVw = 0.15;    
    const totalRowHeightVw = cellHeightVw + rowGapVw;
    const pixelsPerVw = window.innerWidth / 100;
    const rowHeightPx = totalRowHeightVw * pixelsPerVw;
    const headerHeightPx = 12 * pixelsPerVw; 
    const availableHeightPx = windowHeight - headerHeightPx;
    const totalScreenRows = Math.floor(availableHeightPx / rowHeightPx);
    const paddingTop = Math.max(0, Math.floor((totalScreenRows - logoArt.length) / 2));
    const paddingBottom = Math.max(0, totalScreenRows - logoArt.length - paddingTop);
    
    for (let i = 0; i < paddingTop; i++) logoRows.push(' '.repeat(TOTAL_COLS));
    logoArt.forEach(line => logoRows.push(line.padEnd(TOTAL_COLS, ' ').slice(0, TOTAL_COLS)));
    for (let i = 0; i < paddingBottom; i++) logoRows.push(' '.repeat(TOTAL_COLS));
  }

  // Обработчики инпутов
  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTimeInput(val);
    if (!val) {
      setIsMocked(false);
    } else {
      const [h, m, s] = val.split(':').map(Number);
      const newDate = new Date(mockBaseDate);
      newDate.setHours(h || 0, m || 0, s || 0);
      setMockBaseDate(newDate);
      setMockStartTime(Date.now());
      setIsMocked(true);
    }
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDateInput(val);
    if (!val) {
      const n = new Date();
      const newDate = new Date(mockBaseDate);
      newDate.setFullYear(n.getFullYear(), n.getMonth(), n.getDate());
      setMockBaseDate(newDate);
      setMockStartTime(Date.now());
    } else {
      const [y, m, d] = val.split('-').map(Number);
      if (y && m && d) {
        const newDate = new Date(mockBaseDate);
        newDate.setFullYear(y, m - 1, d);
        setMockBaseDate(newDate);
        setMockStartTime(Date.now());
      }
    }
  };

  // Кнопки изменения
  const adjustTime = (unit: 'h'|'m'|'s', amount: number) => {
    const newDate = new Date(mockBaseDate.getTime() + (Date.now() - mockStartTime));
    if (unit === 'h') newDate.setHours(newDate.getHours() + amount);
    if (unit === 'm') newDate.setMinutes(newDate.getMinutes() + amount);
    if (unit === 's') newDate.setSeconds(newDate.getSeconds() + amount);
    setMockBaseDate(newDate);
    setMockStartTime(Date.now());
    setIsMocked(true);
    setTimeInput(getLocalTimeString(newDate));
  };

  const adjustDate = (unit: 'y'|'m'|'d', amount: number) => {
    const newDate = new Date(mockBaseDate.getTime() + (Date.now() - mockStartTime));
    if (unit === 'y') newDate.setFullYear(newDate.getFullYear() + amount);
    if (unit === 'm') newDate.setMonth(newDate.getMonth() + amount);
    if (unit === 'd') newDate.setDate(newDate.getDate() + amount);
    setMockBaseDate(newDate);
    setMockStartTime(Date.now());
    setDateInput(getLocalDateString(newDate));
  };

  return (
    <div className="board">
      {/* Шапка с инпутами */}
      <div className="header">
        <div className="input-group">
          <input 
            type="date" 
            value={dateInput} 
            onChange={handleDateChange}
            onFocus={() => setIsEditingDate(true)}
            onBlur={() => setTimeout(() => setIsEditingDate(false), 200)}
            className="input-field"
          />
          {isEditingDate && (
            <div className="controls-popup">
              <div className="control-column">
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustDate('y', 1); }}>▲</button>
                <span className="unit-label">Y</span>
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustDate('y', -1); }}>▼</button>
              </div>
              <div className="control-column">
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustDate('m', 1); }}>▲</button>
                <span className="unit-label">M</span>
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustDate('m', -1); }}>▼</button>
              </div>
              <div className="control-column">
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustDate('d', 1); }}>▲</button>
                <span className="unit-label">D</span>
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustDate('d', -1); }}>▼</button>
              </div>
            </div>
          )}
        </div>

        <div className="input-group">
          <input 
            type="time" 
            step="1"
            value={timeInput} 
            onChange={handleTimeChange}
            onFocus={() => setIsEditingTime(true)}
            onBlur={() => setTimeout(() => setIsEditingTime(false), 200)}
            className="input-field"
          />
          {isEditingTime && (
            <div className="controls-popup">
              <div className="control-column">
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustTime('h', 1); }}>▲</button>
                <span className="unit-label">H</span>
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustTime('h', -1); }}>▼</button>
              </div>
              <div className="control-column">
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustTime('m', 1); }}>▲</button>
                <span className="unit-label">M</span>
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustTime('m', -1); }}>▼</button>
              </div>
              <div className="control-column">
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustTime('s', 1); }}>▲</button>
                <span className="unit-label">S</span>
                <button className="arrow-btn" onMouseDown={e => { e.preventDefault(); adjustTime('s', -1); }}>▼</button>
              </div>
            </div>
          )}
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
          logoRows.map((str, rowIndex) => (
             <div className="row" key={`logo-${rowIndex}`}>
                <div className="col time-col"><FlipText text={str.slice(OFFSET_TIME, OFFSET_GROUP)} length={TIME_LEN} flipTrigger={flipTrigger} rowIndex={rowIndex} charOffset={OFFSET_TIME} /></div>
                <div className="col group-col"><FlipText text={str.slice(OFFSET_GROUP, OFFSET_ROOM)} length={GROUP_LEN} flipTrigger={flipTrigger} rowIndex={rowIndex} charOffset={OFFSET_GROUP} /></div>
                <div className="col room-col"><FlipText text={str.slice(OFFSET_ROOM, OFFSET_STATUS)} length={ROOM_LEN} flipTrigger={flipTrigger} rowIndex={rowIndex} charOffset={OFFSET_ROOM} /></div>
                <div className="col status-col"><FlipText text={str.slice(OFFSET_STATUS)} length={STATUS_LEN} flipTrigger={flipTrigger} rowIndex={rowIndex} charOffset={OFFSET_STATUS} /></div>
             </div>
          ))
        ) : (
          rows.map((lesson, index) => (
            <FlipRow
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

// ... Остальные компоненты FlipRow, FlipText, FlipChar остаются без изменений ...

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
        <FlipText text={start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} length={TIME_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_TIME} />
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
  const padded = forceEmpty ? ' '.repeat(length) : text.padEnd(length, ' ').slice(0, length);
  return (
    <>
      {padded.split('').map((ch, i) => (
        <FlipChar key={i} targetChar={ch} absoluteCharIndex={charOffset + i} rowIndex={rowIndex} flipTrigger={flipTrigger} />
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

  useEffect(() => { targetRef.current = targetChar; }, [targetChar]);

  useEffect(() => {
    if (flipTrigger === 0) {
      setCurrentChar(targetRef.current);
      setNextChar(targetRef.current);
      return;
    }
    const totalDelay = (rowIndex * ROW_STAGGER_MS) + (absoluteCharIndex * CHAR_STAGGER_MS);
    const half = FLIP_DURATION_MS / 2;
    const startTimer = setTimeout(() => { setNextChar(targetRef.current); setIsFlipping(true); }, totalDelay);
    const swapTimer = setTimeout(() => { setCurrentChar(targetRef.current); }, totalDelay + half);
    const endTimer = setTimeout(() => { setIsFlipping(false); }, totalDelay + FLIP_DURATION_MS);
    return () => { clearTimeout(startTimer); clearTimeout(swapTimer); clearTimeout(endTimer); };
  }, [flipTrigger, rowIndex, absoluteCharIndex]);

  const isCurrentEmpty = currentChar === ' ';
  const isNextEmpty = nextChar === ' ';

  return (
    <span className={`cell ${isFlipping ? 'flipping' : ''}`}>
      <span className={`half top-static ${isNextEmpty ? 'empty' : ''}`}><span className="char">{isNextEmpty ? '\u00A0' : nextChar}</span></span>
      <span className={`half bottom-static ${isCurrentEmpty ? 'empty' : ''}`}><span className="char">{isCurrentEmpty ? '\u00A0' : currentChar}</span></span>
      <span className={`half top-flap ${isCurrentEmpty ? 'empty' : ''}`}><span className="char">{isCurrentEmpty ? '\u00A0' : currentChar}</span></span>
      <span className={`half bottom-flap ${isNextEmpty ? 'empty' : ''}`}><span className="char">{isNextEmpty ? '\u00A0' : nextChar}</span></span>
    </span>
  );
}

export default App;