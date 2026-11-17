import { useState, useEffect, useRef, useMemo, memo } from 'react';
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
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
};

const getLocalTimeString = (d: Date) => {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

// --- ИНТЕРФЕЙСЫ ПРОПСОВ ---
interface FlipRowProps {
  lesson: Lesson | null;
  currentTime: Date;
  flipTrigger: number;
  index: number;
}

interface FlipTextProps {
  text: string;
  length: number;
  forceEmpty?: boolean;
  flipTrigger: number;
  rowIndex: number;
  charOffset: number;
}

interface FlipCharProps {
  targetChar: string;
  absoluteCharIndex: number;
  rowIndex: number;
  flipTrigger: number;
}

// --- КОМПОНЕНТ ЧАСОВ ---
const Clock = memo(function Clock({ time }: { time: Date }) {
  return <div className="header-time">{time.toLocaleTimeString('ru-RU')}</div>;
});

// --- ГЛАВНЫЙ КОМПОНЕНТ ---
function App() {
  const now = new Date();
  const [currentTime, setCurrentTime] = useState(now);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isActuallyEmpty, setIsActuallyEmpty] = useState(false);
  const [flipTrigger, setFlipTrigger] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);
  const boardBodyRef = useRef<HTMLDivElement>(null);

  const [isMocked, setIsMocked] = useState(false);
  const [mockStartTime, setMockStartTime] = useState(Date.now());
  const [mockBaseDate, setMockBaseDate] = useState(now);

  useEffect(() => {
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const scrollResetTimer = setInterval(() => {
      if (boardBodyRef.current) boardBodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60000);
    return () => clearInterval(scrollResetTimer);
  }, []);

  useEffect(() => {
    const initTimer = setTimeout(() => setFlipTrigger(t => t + 1), 50);
    return () => clearTimeout(initTimer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      let next: Date;
      if (isMocked) {
        const elapsed = Date.now() - mockStartTime;
        next = new Date(mockBaseDate.getTime() + elapsed);
      } else {
        next = new Date();
      }
      
      setCurrentTime(prev => {
        if (next.getSeconds() !== prev.getSeconds() && next.getSeconds() % 10 === 0) {
          setFlipTrigger(t => t + 1);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isMocked, mockStartTime, mockBaseDate]);

  const currentDateString = getLocalDateString(currentTime);
  
  useEffect(() => {
    let controller = new AbortController();

    const fetchData = async () => {
      try {
        const dateParam = currentDateString.split('.').reverse().join('-');
        const response = await fetch(`${API_URL}?date=${dateParam}`, { signal: controller.signal });
        const data = await response.json();
        setLessons(data.schedule || []);
        setIsActuallyEmpty(data.is_empty !== undefined ? data.is_empty : (data.schedule || []).length === 0);
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('Ошибка загрузки расписания:', error);
        }
      }
    };

    fetchData();
    const fetchTimer = setInterval(fetchData, FLIP_INTERVAL_MS);
    
    return () => {
      clearInterval(fetchTimer);
      controller.abort();
    };
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
    if (displayedLessons.length > rowCount) setRowCount(displayedLessons.length);
  }, [displayedLessons.length, rowCount]);

  const rows: (Lesson | null)[] = Array.from({ length: rowCount }, (_, i) => displayedLessons[i] ?? null);

  const isScheduleEmpty = displayedLessons.length === 0;
  const [visibleShowLogo, setVisibleShowLogo] = useState(isScheduleEmpty);
  
  useEffect(() => {
    if (flipTrigger === 0) { setVisibleShowLogo(isScheduleEmpty); return; }
    const timer = setTimeout(() => setVisibleShowLogo(isScheduleEmpty), FLIP_DURATION_MS / 2);
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
    const cellHeightVw = 4;
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

  const applyMockDate = (newDate: Date) => {
    setMockBaseDate(newDate);
    setMockStartTime(Date.now());
    setIsMocked(true);
    setCurrentTime(newDate);
  };

  const resetToNow = () => {
    setIsMocked(false);
    const n = new Date();
    setCurrentTime(n);
    setMockBaseDate(n);
  };

  return (
    <div className="board">
      <div className="header-controls">
        <div className="control-group">
          <DateControl currentTime={currentTime} onDateChange={applyMockDate} isMocked={isMocked} />
        </div>
        
        <button className="now-btn" onClick={resetToNow} title="Сбросить на текущее время">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="clock-icon">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </button>

        <div className="control-group">
          <TimeControl currentTime={currentTime} onTimeChange={applyMockDate} isMocked={isMocked} />
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
            <FlipRow key={index} lesson={lesson} currentTime={snapshotTime} flipTrigger={flipTrigger} index={index} />
          ))
        )}
      </div>
    </div>
  );
}

// --- КОМПОНЕНТЫ УПРАВЛЕНИЯ ---

function DateControl({ currentTime, onDateChange, isMocked }: { currentTime: Date, onDateChange: (d: Date) => void, isMocked: boolean }) {
  const d = String(currentTime.getDate()).padStart(2, '0');
  const m = String(currentTime.getMonth() + 1).padStart(2, '0');
  const y = String(currentTime.getFullYear());

  const handleSegmentChange = (part: 'd' | 'm' | 'y', val: string) => {
    const newDate = new Date(currentTime);
    if (!val || parseInt(val, 10) === 0) {
      const now = new Date();
      if (part === 'd') newDate.setDate(now.getDate());
      if (part === 'm') newDate.setMonth(now.getMonth());
      if (part === 'y') newDate.setFullYear(now.getFullYear());
      onDateChange(newDate);
      return;
    }
    if (part === 'd') newDate.setDate(parseInt(val, 10));
    if (part === 'm') newDate.setMonth(parseInt(val, 10) - 1);
    if (part === 'y') newDate.setFullYear(parseInt(val, 10));
    onDateChange(newDate);
  };

  const adjust = (part: 'd' | 'm' | 'y', amount: number) => {
    const newDate = new Date(currentTime);
    if (part === 'd') newDate.setDate(newDate.getDate() + amount);
    if (part === 'm') newDate.setMonth(newDate.getMonth() + amount);
    if (part === 'y') newDate.setFullYear(newDate.getFullYear() + amount);
    onDateChange(newDate);
  };

  return (
    <div className="segmented-input">
      <Segment value={d} maxLength={2} onChange={(v) => handleSegmentChange('d', v)} onAdjust={(a) => adjust('d', a)} />
      <span className="separator">.</span>
      <Segment value={m} maxLength={2} onChange={(v) => handleSegmentChange('m', v)} onAdjust={(a) => adjust('m', a)} />
      <span className="separator">.</span>
      <Segment value={y} maxLength={4} isYear onChange={(v) => handleSegmentChange('y', v)} onAdjust={(a) => adjust('y', a)} />
    </div>
  );
}

function TimeControl({ currentTime, onTimeChange, isMocked }: { currentTime: Date, onTimeChange: (d: Date) => void, isMocked: boolean }) {
  const h = String(currentTime.getHours()).padStart(2, '0');
  const m = String(currentTime.getMinutes()).padStart(2, '0');
  const s = String(currentTime.getSeconds()).padStart(2, '0');

  const handleSegmentChange = (part: 'h' | 'm' | 's', val: string) => {
    const newDate = new Date(currentTime);
    if (!val) {
      const now = new Date();
      if (part === 'h') newDate.setHours(now.getHours());
      if (part === 'm') newDate.setMinutes(now.getMinutes());
      if (part === 's') newDate.setSeconds(now.getSeconds());
      onTimeChange(newDate);
      return;
    }
    if (part === 'h') newDate.setHours(parseInt(val, 10));
    if (part === 'm') newDate.setMinutes(parseInt(val, 10));
    if (part === 's') newDate.setSeconds(parseInt(val, 10));
    onTimeChange(newDate);
  };

  const adjust = (part: 'h' | 'm' | 's', amount: number) => {
    const newDate = new Date(currentTime);
    if (part === 'h') newDate.setHours(newDate.getHours() + amount);
    if (part === 'm') newDate.setMinutes(newDate.getMinutes() + amount);
    if (part === 's') newDate.setSeconds(newDate.getSeconds() + amount);
    onTimeChange(newDate);
  };

  return (
    <div className="segmented-input">
      <Segment value={h} maxLength={2} onChange={(v) => handleSegmentChange('h', v)} onAdjust={(a) => adjust('h', a)} />
      <span className="separator">:</span>
      <Segment value={m} maxLength={2} onChange={(v) => handleSegmentChange('m', v)} onAdjust={(a) => adjust('m', a)} />
      <span className="separator">:</span>
      <Segment value={s} maxLength={2} onChange={(v) => handleSegmentChange('s', v)} onAdjust={(a) => adjust('s', a)} />
    </div>
  );
}

function Segment({ value, maxLength, onChange, onAdjust, isYear }: { value: string, maxLength: number, onChange: (v: string) => void, onAdjust: (a: number) => void, isYear?: boolean }) {
  return (
    <div className="segment-wrapper">
      <button className="arrow-btn arrow-up" onMouseDown={(e) => { e.preventDefault(); onAdjust(1); }}>▲</button>
      <input
        type="text"
        className={`segment-input ${isYear ? 'year-input' : ''}`}
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
      <button className="arrow-btn arrow-down" onMouseDown={(e) => { e.preventDefault(); onAdjust(-1); }}>▼</button>
    </div>
  );
}

// --- ОПТИМИЗИРОВАННЫЕ КОМПОНЕНТЫ СИМВОЛОВ ---

const FlipRow = memo(function FlipRow({ lesson, currentTime, flipTrigger, index }: FlipRowProps) {
  const [visibleTime, setVisibleTime] = useState<Date>(currentTime);
  const timeRef = useRef(currentTime);

  useEffect(() => { timeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    if (flipTrigger === 0) return;
    const swapTimer = setTimeout(() => setVisibleTime(timeRef.current), index * ROW_STAGGER_MS + FLIP_DURATION_MS / 2);
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
      <div className="col time-col"><FlipText text={start.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} length={TIME_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_TIME} /></div>
      <div className="col group-col"><FlipText text={lesson.group} length={GROUP_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_GROUP} /></div>
      <div className="col room-col"><FlipText text={lesson.room} length={ROOM_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_ROOM} /></div>
      <div className="col status-col"><FlipText text={isOngoing ? 'ИДЕТ' : ''} length={STATUS_LEN} flipTrigger={flipTrigger} rowIndex={index} charOffset={OFFSET_STATUS} /></div>
    </div>
  );
});

const FlipText = memo(function FlipText({ text, length, forceEmpty, flipTrigger, rowIndex, charOffset }: FlipTextProps) {
  const padded = forceEmpty ? ' '.repeat(length) : text.padEnd(length, ' ').slice(0, length);
  return (
    <>
      {padded.split('').map((ch, i) => (
        <FlipChar key={i} targetChar={ch} absoluteCharIndex={charOffset + i} rowIndex={rowIndex} flipTrigger={flipTrigger} />
      ))}
    </>
  );
});

const FlipChar = memo(function FlipChar({ targetChar, absoluteCharIndex, rowIndex, flipTrigger }: FlipCharProps) {
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
  }, [flipTrigger, rowIndex, absoluteCharIndex]); // Убрали currentChar из зависимостей

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
});

export default App;