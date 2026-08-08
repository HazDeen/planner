import React, { useState, useEffect, useRef } from 'react';
import { 
  Check, Plus, Clock, Calendar as CalendarIcon, Inbox, User, 
  Sun, Moon, X, Trash2, Repeat, ListTodo, 
  AlignLeft, Mic, Sparkles, Send, ChevronDown, CalendarDays,
  ChevronLeft, ChevronRight, Loader2
} from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

// --- НАСТРОЙКИ API ---
const API_URL = import.meta.env.VITE_API_URL || '';

// --- ТИПИЗАЦИЯ ---
interface Subtask {
  id: string;
  title: string;
  isCompleted: boolean;
}

interface AppEvent {
  id: number;
  title: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  color: string;
  comments: string;
  subtasks: Subtask[];
  isCompleted: boolean;
  repeat: string;
  type: string; // "event" | "task"
  isDeadline?: boolean;
  col?: number;
  numColumns?: number;
}

interface ParsedAiItem {
  _tempId: number;
  type: 'event' | 'task';
  title: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  color: string;
  comments: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// --- КОНСТАНТЫ И УТИЛИТЫ ---
const REAL_TODAY = '2026-08-08';
const COLORS = ['#FF9A8B', '#A7C957', '#3b82f6', '#a855f7', '#E56B6F'];
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const timeToPixels = (timeString: string | null): number => {
  if (!timeString) return 0;
  const parts = timeString.split(':');
  if (parts.length < 2) return 0;
  return (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
};

// ДОБАВИТЬ ЭТУ ФУНКЦИЮ:
const addOneHour = (timeStr: string) => {
  if (!timeStr) return '10:00';
  const [h, m] = timeStr.split(':').map(Number);
  const newH = (h + 1) % 24;
  return `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

const formatPillDate = (dateStr: string) => {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
};

// Конвертеры между API и React
const mapFromDB = (dbItem: any): AppEvent => ({
  id: dbItem.id,
  title: dbItem.title,
  isAllDay: dbItem.is_all_day,
  startDate: dbItem.start_date,
  endDate: dbItem.end_date,
  startTime: dbItem.start_time ? dbItem.start_time.substring(0, 5) : '00:00',
  endTime: dbItem.end_time ? dbItem.end_time.substring(0, 5) : '00:00',
  color: dbItem.color,
  comments: dbItem.comments || '',
  subtasks: dbItem.subtasks || [],
  isCompleted: dbItem.is_completed,
  repeat: dbItem.repeat || 'none',
  // Если из базы пришел deadline, для React это задача с галочкой isDeadline
  type: (dbItem.item_type === 'deadline' || dbItem.item_type === 'task') ? 'task' : 'event',
  isDeadline: dbItem.item_type === 'deadline'
});

const mapToDB = (item: any, type: string) => ({
  title: item.title,
  is_all_day: item.isAllDay,
  start_date: item.startDate,
  end_date: item.endDate,
  start_time: item.isAllDay ? null : (item.startTime + ':00'),
  end_time: item.isAllDay ? null : (item.endTime + ':00'),
  color: item.color,
  comments: item.comments,
  subtasks: item.subtasks,
  repeat: item.repeat || 'none',
  // Если сохраняем задачу с дедлайном, отправляем тип deadline
  item_type: (type === 'task' && item.isDeadline) ? 'deadline' : type,
  is_completed: item.isCompleted || false
});

// --- КОМПОНЕНТЫ UI ---
const AnimatedStrikethrough = ({ text, isCompleted, className = '' }: { text: string, isCompleted: boolean, className?: string }) => (
  <span className={`relative inline-block w-fit ${className}`}>
    <span className={`transition-colors duration-300 ${isCompleted ? 'text-textMuted' : 'text-textMain'}`}>{text}</span>
    <span className={`absolute left-0 top-1/2 h-[1.5px] bg-textMuted transition-all duration-300 ease-out rounded-full ${isCompleted ? 'w-full' : 'w-0'}`}></span>
  </span>
);

const IOSPickerPill = ({ type, value, onChange, options = [] }: any) => {
  if (type === 'select') {
    const selectedLabel = options.find((o: any) => o.value === value)?.label || 'Выбрать';
    return (
      <div className="relative bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors rounded-xl px-3 py-1.5 flex items-center justify-center cursor-pointer overflow-hidden group">
        <span className="text-[15px] font-medium text-textMain group-active:opacity-70 transition-opacity">{selectedLabel}</span>
        <select value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
          {options.map((o: any) => <option key={o.value} value={o.value} className="text-black">{o.label}</option>)}
        </select>
      </div>
    );
  }

  return (
    <div className="relative bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors rounded-xl px-3 py-1.5 flex items-center justify-center cursor-pointer overflow-hidden group">
      <span className="text-[15px] font-medium text-textMain group-active:opacity-70 transition-opacity">
        {type === 'date' ? formatPillDate(value) : (value || '00:00')}
      </span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
    </div>
  );
};

// --- ОСНОВНОЙ КОМПОНЕНТ ---
export default function App() {
  const [appStage, setAppStage] = useState<'loading' | 'auth' | 'app'>('auth');
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');

  const [currentDate, setCurrentDate] = useState<string>(REAL_TODAY);
  const [activeTab, setActiveTab] = useState<'today' | 'calendar' | 'tasks' | 'profile'>('today');
  const [isAllDayExpanded, setIsAllDayExpanded] = useState<boolean>(false);
  
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [tasks, setTasks] = useState<AppEvent[]>([]); // Tasks and Events share the same DB format now
  
  // Проверяем сохраненную тему при первой загрузке
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  // Сохраняем новую тему в память браузера при переключении
  const toggleDark = () => {
    setIsDark(prev => {
      const newTheme = !prev;
      localStorage.setItem('theme', newTheme ? 'dark' : 'light');
      return newTheme;
    });
  };

  useEffect(() => {
    // 1. Ищем или создаем мета-тег theme-color
    let metaThemeColor = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }
    
    // 2. Удаляем старые теги из index.html, которые реагировали на систему телефона
    document.querySelectorAll('meta[name="theme-color"][media]').forEach(el => el.remove());

    // 3. Красим шторку в зависимости от нашей переменной
    const bgColor = isDark ? '#09090B' : '#FFF5F3';
    metaThemeColor.setAttribute('content', bgColor);
    
    // 4. Заодно красим сам `body`. Это нужно для того, чтобы при 
    // скролле (когда тянешь экран вниз до "резинового" отскока) 
    // фон за пределами приложения не оставался белым.
    document.body.style.backgroundColor = bgColor;
  }, [isDark]);
  // --- КОНЕЦ ДОБАВЛЕННОГО БЛОКА ---

  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [calendarViewDate, setCalendarViewDate] = useState<Date>(new Date(REAL_TODAY));
  
  const [sheetState, setSheetState] = useState<{ isOpen: boolean; id: number | null; type: 'event' | 'task' }>({ isOpen: false, id: null, type: 'event' });
  const [formData, setFormData] = useState({
    title: '', isAllDay: false, startDate: REAL_TODAY, endDate: REAL_TODAY, 
    startTime: '09:00', endTime: '10:00', repeat: 'none', color: '#FF9A8B', 
    comments: '', subtasks: [] as Subtask[], isDeadline: false
  });

  const [aiModalOpen, setAiModalOpen] = useState<boolean>(false);
  const [aiText, setAiText] = useState<string>('');
  const [isListening, setIsListening] = useState<boolean>(false);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [parsedItems, setParsedItems] = useState<ParsedAiItem[] | null>(null); 
  const [expandedAiItemId, setExpandedAiItemId] = useState<number | null>(null); // <-- ДОБАВИЛИ ЭТУ СТРОКУ
  
  const [currentTimePixels, setCurrentTimePixels] = useState<number>(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  const timelineRef = useRef<HTMLDivElement>(null);

  // Auto-login check
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUsername(payload.sub);
        setAppStage('loading');
      } catch (e) {
        localStorage.removeItem('token');
      }
    }
  }, []);

  useEffect(() => {
    // Таймер обновляет позицию линии каждую минуту (60000 мс)
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentTimePixels(now.getHours() * 60 + now.getMinutes());
    }, 60000);

    // Очищаем таймер, если компонент будет размонтирован
    return () => clearInterval(interval);
  }, []);

  // Fetch Data on Loading Stage
  useEffect(() => {
    if (appStage === 'loading') {
      const loadData = async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`${API_URL}/events/`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (res.status === 401) {
            localStorage.removeItem('token');
            setAppStage('auth');
            return;
          }
          
          if (res.ok) {
            const data = await res.json();
            const mapped = data.map(mapFromDB);
            setEvents(mapped.filter((d: AppEvent) => d.type === 'event'));
            setTasks(mapped.filter((d: AppEvent) => d.type === 'task'));
          }
        } catch (e) {
          console.error('Failed to fetch from API', e);
        } finally {
          setTimeout(() => setAppStage('app'), 1500);
        }
      };
      loadData();
    }
  }, [appStage]);

  useEffect(() => {
    if (appStage === 'app' && activeTab === 'today' && timelineRef.current) {
      timelineRef.current.scrollTop = 8 * 60;
    }
  }, [activeTab, currentDate, appStage]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      let res = await fetch(`${API_URL}/token`, { method: 'POST', body: formData });

      if (res.status === 400 || res.status === 401) {
        // Auto-register fallback
        const regRes = await fetch(`${API_URL}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        if (regRes.ok) {
          res = await fetch(`${API_URL}/token`, { method: 'POST', body: formData });
        } else {
          return toast.error('Ошибка авторизации или пароль неверен.');
        }
      }

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('token', data.access_token);
        setAppStage('loading');
        toast.success('Успешный вход!');
      } else {
        toast.error('Ошибка сервера');
      }
    } catch (err) {
      toast.error('Нет связи с сервером. Бэкенд запущен?');
    }
  };

  const calculateOverlaps = (dayEvents: AppEvent[]): AppEvent[] => {
    const timed = [...dayEvents].filter(e => !e.isAllDay).sort((a, b) => timeToPixels(a.startTime) - timeToPixels(b.startTime));
    let columns: AppEvent[][] = [];
    let lastEventEnding: number | null = null;
    
    timed.forEach(ev => {
      if (lastEventEnding !== null && timeToPixels(ev.startTime) >= lastEventEnding) {
        columns.forEach(col => col.forEach(e => { e.numColumns = columns.length; }));
        columns = [];
        lastEventEnding = null;
      }
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        let col = columns[i];
        if (timeToPixels(col[col.length - 1].endTime) <= timeToPixels(ev.startTime)) {
          ev.col = i;
          col.push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev.col = columns.length;
        columns.push([ev]);
      }
      if (lastEventEnding === null || timeToPixels(ev.endTime) > lastEventEnding) {
        lastEventEnding = Math.max(lastEventEnding || 0, timeToPixels(ev.endTime));
      }
    });
    if (columns.length > 0) columns.forEach(col => col.forEach(e => { e.numColumns = columns.length; }));
    return timed;
  };

  const toggleTaskCompletion = async (id: number, type: 'event' | 'task') => {
    const item = type === 'event' ? events.find(e => e.id === id) : tasks.find(t => t.id === id);
    if (!item) return;

    const updatedItem = { ...item, isCompleted: !item.isCompleted };
    
    if (type === 'event') setEvents(events.map(e => e.id === id ? updatedItem : e));
    else setTasks(tasks.map(t => t.id === id ? updatedItem : t));

    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/events/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(mapToDB(updatedItem, type))
      });
    } catch(e) { console.error(e); }
  };

  const toggleSubtaskCompletion = async (taskId: number, subtaskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const updatedTask = { ...task, subtasks: task.subtasks.map(s => s.id === subtaskId ? { ...s, isCompleted: !s.isCompleted } : s) };
    setTasks(tasks.map(t => t.id === taskId ? updatedTask : t));

    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/events/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(mapToDB(updatedTask, 'task'))
      });
    } catch(e) {}
  };

  const toggleTaskExpand = (id: number) => setExpandedTasks(prev => ({ ...prev, [id]: !prev[id] }));

  const openSheet = (id: number | null = null, type: 'event' | 'task' = 'event') => {
    if (id) {
      const obj = type === 'event' ? events.find(e => e.id === id) : tasks.find(t => t.id === id);
      if (obj) {
        setFormData({
          title: obj.title || '', isAllDay: obj.isAllDay, startDate: obj.startDate || currentDate, endDate: obj.endDate || currentDate,
          startTime: obj.startTime || '09:00', endTime: obj.endTime || '10:00', repeat: obj.repeat || 'none', color: obj.color || '#FF9A8B',
          comments: obj.comments || '', subtasks: obj.subtasks || [], 
          isDeadline: obj.isDeadline || false // <-- ПОДТЯГИВАЕМ ИЗ БАЗЫ
        });
      }
    } else {
      setFormData({
        title: '', isAllDay: type === 'task', startDate: currentDate, endDate: currentDate,
        startTime: '09:00', endTime: '10:00', repeat: 'none', color: '#FF9A8B', comments: '', subtasks: [],
        isDeadline: false
      });
    }
    setSheetState({ isOpen: true, id, type });
  };

  const closeSheet = () => setSheetState({ isOpen: false, id: null, type: 'event' });

  const saveTask = async () => {
    if (!formData.title.trim()) return toast.error('Введите название!');
    const validSubtasks = formData.subtasks.filter(s => s.title.trim() !== '');
    const payload = mapToDB({ ...formData, subtasks: validSubtasks }, sheetState.type);

    try {
      const token = localStorage.getItem('token');
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

      if (sheetState.id) {
        const res = await fetch(`${API_URL}/events/${sheetState.id}`, { method: 'PUT', headers, body: JSON.stringify(payload) });
        if (res.ok) {
          const updated = mapFromDB(await res.json());
          if (sheetState.type === 'event') setEvents(events.map(e => e.id === sheetState.id ? updated : e));
          else setTasks(tasks.map(t => t.id === sheetState.id ? updated : t));
        }
      } else {
        const res = await fetch(`${API_URL}/events/`, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (res.ok) {
          const createdArr = (await res.json()).map(mapFromDB);
          if (sheetState.type === 'event') setEvents([...events, ...createdArr]);
          else setTasks([...tasks, ...createdArr]);
        }
      }
      toast.success('Сохранено!');
      closeSheet();
    } catch (e) {
      toast.error("Ошибка сохранения");
    }
  };

  const deleteTask = async () => {
    if (!sheetState.id) return closeSheet();
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/events/${sheetState.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
      
      if (sheetState.type === 'event') setEvents(events.filter(e => e.id !== sheetState.id));
      else setTasks(tasks.filter(t => t.id !== sheetState.id));
      
      toast.success("Удалено!");
      closeSheet();
    } catch (e) {
      toast.error("Ошибка удаления");
    }
  };

  const toggleListening = () => {
    if (isListening) return setIsListening(false);
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ru-RU';
      recognition.interimResults = false;
      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (e: any) => setAiText(prev => prev + ' ' + e.results[0][0].transcript);
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } else toast.error('Голосовой ввод не поддерживается.');
  };

  const processAIText = async () => {
    if (!aiText.trim()) return;
    setIsProcessing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/ai/parse`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          text: aiText, 
          current_date: REAL_TODAY 
        })
      });

      if (!response.ok) {
        throw new Error('Ошибка обработки на сервере');
      }

      const parsed = await response.json();
      setParsedItems(Array.isArray(parsed) ? parsed.map((item: any) => ({...item, _tempId: Math.random()})) : []);
    } catch (error) { 
      toast.error('Ошибка при обращении к ИИ-ассистенту.'); 
    } finally { 
      setIsProcessing(false); 
    }
  };

  const confirmAiTasks = async () => {
    if (!parsedItems) return;
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    try {
      for (const item of parsedItems) {
        // Умный расчет времени для ИИ
        const start = item.startTime || '09:00';
        const end = item.endTime || addOneHour(start);

        const payload = mapToDB({
           title: item.title, isAllDay: item.isAllDay || false, startDate: item.startDate, endDate: item.endDate || item.startDate,
           startTime: start, endTime: end, color: item.color || '#FF9A8B', comments: item.comments || '', subtasks: [], isCompleted: false, repeat: 'none',
           isDeadline: item.type === 'task' && !item.isAllDay // ИИ автоматически делает задачу дедлайном, если нашел точное время
        }, item.type);

        const res = await fetch(`${API_URL}/events/`, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (res.ok) {
          const createdArr = (await res.json()).map(mapFromDB);
          if (item.type === 'event') setEvents(prev => [...prev, ...createdArr]);
          else setTasks(prev => [...prev, ...createdArr]);
        }
      }
      toast.success("Задачи добавлены!");
    } catch (e) { toast.error("Ошибка при сохранении ИИ-задач"); }
    
    setParsedItems(null); setAiText(''); setAiModalOpen(false);
  };

  const currentYear = calendarViewDate.getFullYear();
  const currentMonth = calendarViewDate.getMonth();
  const prevMonth = () => setCalendarViewDate(new Date(currentYear, currentMonth - 1, 1));
  const nextMonth = () => setCalendarViewDate(new Date(currentYear, currentMonth + 1, 1));
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const daysInCurrentMonth = getDaysInMonth(currentYear, currentMonth);
  const daysInPrevMonth = getDaysInMonth(currentYear, currentMonth - 1);
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  const startDayOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const calendarDays = [];
  for (let i = startDayOffset - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = currentMonth === 0 ? 11 : currentMonth - 1;
    const y = currentMonth === 0 ? currentYear - 1 : currentYear;
    calendarDays.push({ day: d, isCurrentMonth: false, dateKey: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  for (let i = 1; i <= daysInCurrentMonth; i++) {
    calendarDays.push({ day: i, isCurrentMonth: true, dateKey: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
  }
  const remainingCells = 42 - calendarDays.length;
  for (let i = 1; i <= remainingCells; i++) {
    const m = currentMonth === 11 ? 0 : currentMonth + 1;
    const y = currentMonth === 11 ? currentYear + 1 : currentYear;
    calendarDays.push({ day: i, isCurrentMonth: false, dateKey: `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
  }

  const todaysEvents = events.filter(e => e.startDate === currentDate);
  const todaysTasks = tasks.filter(t => t.startDate === currentDate);
  
  // Собираем все дела на весь день (и задачи, и события) для закрепленной шапки
  const allDayItems = [...todaysEvents, ...todaysTasks].filter(item => item.isAllDay);
  
  // Только события с точным временем отправляются в сетку часов
  const timedEvents = calculateOverlaps(todaysEvents.filter(e => !e.isAllDay));
  const headerDateString = new Date(currentDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  const renderTimeline = () => (
    <div className="flex-1 flex flex-col h-full relative w-full max-w-5xl mx-auto overflow-hidden">
      
      {/* ЗАКРЕПЛЕННЫЙ БЛОК СВЕРХУ (Задачи на день) */}
      {allDayItems.length > 0 && (
        <div className="w-full flex flex-col space-y-2 px-6 md:px-10 pt-4 pb-2 bg-transparent z-40 flex-shrink-0">
          
          {/* Показываем либо все элементы (если раскрыто), либо только первые 2 */}
          {(isAllDayExpanded ? allDayItems : allDayItems.slice(0, 1)).map(item => (
            <div key={item.id} onClick={() => openSheet(item.id, item.type as 'event' | 'task')}
                 className={`bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm border border-black/5 dark:border-white/5 p-3.5 flex items-center justify-between cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md ${item.isCompleted ? 'opacity-50' : ''}`}>
              <div className="flex items-center space-x-4 w-full">
                <div onClick={(e) => { e.stopPropagation(); toggleTaskCompletion(item.id, item.type as 'event' | 'task'); }}
                     className={`w-6 h-6 min-w-[24px] rounded-full border-2 flex items-center justify-center transition-colors ${item.isCompleted ? 'bg-primary border-primary' : 'border-textMuted'}`}>
                  <Check className={`w-4 h-4 text-white transition-opacity ${item.isCompleted ? 'opacity-100' : 'opacity-0'}`} />
                </div>
                <div className="flex flex-col flex-1 overflow-hidden">
                  <AnimatedStrikethrough text={item.title} isCompleted={item.isCompleted} className="font-bold text-[16px] leading-tight truncate block text-textMain" />
                  <span className="text-[11px] font-bold mt-1 tracking-wide" style={{ color: item.color }}>
                     {item.type === 'task' ? 'ЗАДАЧА НА ДЕНЬ' : 'ВЕСЬ ДЕНЬ'}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {/* Кнопка "Скрыть / Ещё X задачи" появляется только если элементов больше 2 */}
          {allDayItems.length > 1 && (
            <button 
              onClick={() => setIsAllDayExpanded(!isAllDayExpanded)}
              className="w-full py-2.5 mt-1 bg-black/5 dark:bg-white/5 rounded-xl text-[12px] font-bold text-textMuted hover:bg-black/10 dark:hover:bg-white/10 hover:text-textMain transition-colors flex items-center justify-center"
            >
              {isAllDayExpanded ? (
                <><ChevronDown className="w-4 h-4 mr-1 rotate-180"/> Скрыть</>
              ) : (
                <><ChevronDown className="w-4 h-4 mr-1"/> Ещё {allDayItems.length - 1}</>
              )}
            </button>
          )}
          
        </div>
      )}

      {/* СКРОЛЛИРУЕМАЯ СЕТКА ЧАСОВ */}
      <div className="flex-1 overflow-y-auto relative px-3 md:px-10 pb-32 md:pb-10 custom-scrollbar" ref={timelineRef}>
        <div className="relative flex mt-6 pb-10">
          <div className="w-14 relative" style={{ height: '1440px' }}>
            {Array.from({length: 25}).map((_, i) => (
               <span key={i} className="absolute right-3 text-[11px] font-bold text-textMuted" style={{ top: `${i * 60}px`, transform: 'translateY(-50%)' }}>
                 {i < 10 ? '0'+i : i}:00
               </span>
            ))}
          </div>
          <div className="flex-1 relative border-l border-black/5 dark:border-white/5" style={{ height: '1440px' }}>
            {Array.from({length: 25}).map((_, i) => (
              <div key={i} className="absolute w-full border-t border-black/5 dark:border-white/5" style={{ top: `${i * 60}px` }}></div>
            ))}
            
            {/* Пульсирующая линия времени */}
            <div className="absolute w-full flex items-center z-20 pointer-events-none" style={{ top: `${currentTimePixels}px` }}>
               <div className="w-full border-t-[2px] border-primary border-dashed relative">
                  <div className="absolute w-2.5 h-2.5 bg-primary rounded-full -left-1.5 -top-[5.5px] shadow-[0_0_12px_rgba(255,154,139,0.9)] animate-pulse"></div>
               </div>
            </div>

            {/* Блоки событий с точным временем */}
            {timedEvents.map(evt => {
              const topPx = timeToPixels(evt.startTime);
              const heightPx = Math.max(timeToPixels(evt.endTime) - topPx, 30);
              const widthPercent = 100 / (evt.numColumns || 1);
              const leftPercent = (evt.col || 0) * widthPercent;

              return (
                <div key={evt.id} onClick={() => openSheet(evt.id, 'event')}
                     className={`absolute bg-white/90 dark:bg-zinc-800/90 backdrop-blur-md rounded-xl shadow-sm border border-white/40 dark:border-zinc-600 p-2.5 flex flex-col cursor-pointer hover:shadow-md transition-all z-10 border-l-4 overflow-hidden ${evt.isCompleted ? 'opacity-60' : ''}`}
                     style={{ top: `${topPx}px`, height: `${heightPx}px`, width: `calc(${widthPercent}% - 8px)`, left: `calc(${leftPercent}% + 4px)`, borderLeftColor: evt.color }}>
                  <div className="flex items-start space-x-2 h-full">
                    <div onClick={(e) => { e.stopPropagation(); toggleTaskCompletion(evt.id, 'event'); }}
                         className={`w-4 h-4 min-w-[16px] rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${evt.isCompleted ? 'bg-primary border-primary' : 'border-textMuted'}`}>
                      <Check className={`w-2.5 h-2.5 text-white transition-opacity ${evt.isCompleted ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                    <div className="flex-1 overflow-hidden h-full flex flex-col">
                      <AnimatedStrikethrough text={evt.title} isCompleted={evt.isCompleted} className="font-bold text-[13px] leading-tight truncate block" />
                      {heightPx >= 45 && <p className={`text-[10px] mt-0.5 font-medium transition-colors ${evt.isCompleted ? 'text-textMuted/60' : 'text-textMuted'}`}>{evt.startTime} - {evt.endTime}</p>}
                      {heightPx >= 65 && evt.comments && <p className={`text-[10px] truncate mt-auto mb-1 bg-black/5 dark:bg-white/5 rounded px-1.5 py-0.5 w-fit transition-colors ${evt.isCompleted ? 'text-textMuted/60' : 'text-textMuted'}`}><AlignLeft className="w-2.5 h-2.5 inline mr-1"/>{evt.comments}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const renderTasks = () => (
    <div className="flex-1 overflow-y-auto pb-32 md:pb-10 p-5 space-y-4 max-w-4xl mx-auto w-full">
      {tasks.length === 0 ? (
        <div className="text-center text-textMuted text-sm mt-10">Все задачи выполнены! 🎉</div>
      ) : tasks.map(task => {
        const completedSubs = task.subtasks.filter(s => s.isCompleted).length;
        const isExpanded = expandedTasks[task.id]; 

        return (
          <div key={task.id} className={`bg-white/80 dark:bg-zinc-800/80 backdrop-blur-xl rounded-2xl border border-white/50 dark:border-zinc-700 shadow-sm transition-all overflow-hidden hover:shadow-md ${task.isCompleted ? 'opacity-70' : ''}`}>
            <div className="p-4 md:p-5 flex flex-col cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors" onClick={() => toggleTaskExpand(task.id)}>
              <div className="flex items-start justify-between w-full">
                <div className="flex items-start space-x-3 flex-1">
                  <div onClick={(e) => { e.stopPropagation(); toggleTaskCompletion(task.id, 'task'); }}
                       className={`w-6 h-6 min-w-[24px] rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors ${task.isCompleted ? 'bg-primary border-primary' : 'border-textMuted'}`}>
                    <Check className={`w-4 h-4 text-white transition-opacity ${task.isCompleted ? 'opacity-100' : 'opacity-0'}`} />
                  </div>
                  <div className="flex flex-col flex-1 overflow-hidden" onClick={(e) => { e.stopPropagation(); openSheet(task.id, 'task'); }}>
                    <AnimatedStrikethrough text={task.title} isCompleted={task.isCompleted} className="font-bold text-[16px] truncate block" />
                    {task.startDate && (
                      <div className="flex items-center space-x-2 mt-2">
                        <span className="text-[11px] font-semibold bg-black/5 dark:bg-white/5 text-textMuted px-2 py-1 rounded-md flex items-center">
                          <CalendarIcon className="w-3 h-3 mr-1.5" style={{ color: task.color }}/> 
                          {task.isDeadline ? 'До ' : ''}{formatPillDate(task.startDate)} 
                          {!task.isAllDay && task.startTime && task.startTime !== '00:00' ? ` ${task.startTime}` : ''}
                        </span>
                        {task.subtasks.length > 0 && <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-md">{completedSubs}/{task.subtasks.length}</span>}
                      </div>
                    )}
                  </div>
                </div>
                {task.subtasks.length > 0 && <ChevronDown className={`w-5 h-5 text-textMuted transition-transform duration-300 mt-1 ${isExpanded ? 'rotate-180' : ''}`} />}
              </div>
            </div>
            <div className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${isExpanded && task.subtasks.length > 0 ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="border-t border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-4 md:px-5 space-y-3">
                  {task.subtasks.map(sub => (
                    <div key={sub.id} className="flex items-center space-x-3">
                      <div onClick={() => toggleSubtaskCompletion(task.id, sub.id)}
                           className={`w-5 h-5 min-w-[20px] rounded-md border-2 flex items-center justify-center cursor-pointer transition-colors ${sub.isCompleted ? 'bg-primary border-primary' : 'border-textMuted'}`}>
                        <Check className={`w-3.5 h-3.5 text-white transition-opacity ${sub.isCompleted ? 'opacity-100' : 'opacity-0'}`} />
                      </div>
                      <AnimatedStrikethrough text={sub.title} isCompleted={sub.isCompleted} className="text-sm font-medium" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={`h-[100dvh] w-full transition-colors duration-500 relative overflow-hidden ${isDark ? 'dark bg-zinc-950' : 'bg-[#FFF5F3]'}`}>
      
      <Toaster 
        position="top-center" 
        toastOptions={{
          style: {
            background: isDark ? '#27272a' : '#fff',
            color: isDark ? '#F4F4F5' : '#2D333A',
            borderRadius: '16px',
            fontWeight: 'bold'
          }
        }} 
      />

      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className={`absolute -top-[20%] -left-[10%] w-[70%] h-[70%] rounded-full blur-[120px] opacity-60 transition-colors duration-700 ${isDark ? 'bg-rose-900/30' : 'bg-rose-200/50'}`}></div>
        <div className={`absolute top-[40%] -right-[10%] w-[60%] h-[60%] rounded-full blur-[100px] opacity-60 transition-colors duration-700 ${isDark ? 'bg-indigo-900/20' : 'bg-blue-200/40'}`}></div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { display: none; }
        .text-textMain { color: ${isDark ? '#F4F4F5' : '#2D333A'}; }
        .text-textMuted { color: ${isDark ? '#A1A1AA' : '#8D949E'}; }
        input[type="date"]::-webkit-calendar-picker-indicator, input[type="time"]::-webkit-calendar-picker-indicator { opacity: 0; position: absolute; inset: 0; width: 100%; height: 100%; cursor: pointer; }
      `}} />

      {appStage === 'auth' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/40 dark:bg-zinc-900/60 backdrop-blur-3xl p-6 animate-in zoom-in-95 duration-500">
           <form onSubmit={handleLoginSubmit} className="flex flex-col w-full max-w-sm bg-white/60 dark:bg-zinc-900/60 backdrop-blur-2xl p-8 rounded-[40px] border border-white/20 shadow-2xl">
              <div className="flex justify-center mb-6">
                 <div className="w-16 h-16 bg-gradient-to-tr from-[#FF8573] to-[#FF9A8B] rounded-2xl flex items-center justify-center shadow-lg">
                    <User className="w-8 h-8 text-white" />
                 </div>
              </div>
              <h2 className="text-2xl font-extrabold text-center mb-2 text-textMain">Добро пожаловать</h2>
              <p className="text-center text-textMuted text-sm font-medium mb-8">Войдите, чтобы продолжить работу</p>
              
              <div className="space-y-4">
                 <input required value={username} onChange={e=>setUsername(e.target.value)} placeholder="Имя пользователя" className="w-full bg-black/5 dark:bg-white/5 rounded-2xl px-5 py-4 outline-none font-bold text-textMain placeholder:text-textMuted focus:ring-2 focus:ring-primary/50 transition-all" />
                 <input required type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Пароль" className="w-full bg-black/5 dark:bg-white/5 rounded-2xl px-5 py-4 outline-none font-bold text-textMain placeholder:text-textMuted focus:ring-2 focus:ring-primary/50 transition-all" />
              </div>
              
              <button type="submit" className="w-full bg-gradient-to-r from-[#FF8573] to-[#FF9A8B] text-white font-extrabold py-4 rounded-2xl mt-8 active:scale-95 transition-all shadow-[0_8px_20px_rgba(255,154,139,0.4)] hover:opacity-90">Войти</button>
           </form>
        </div>
      )}

      {appStage === 'loading' && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/40 dark:bg-zinc-900/60 backdrop-blur-3xl animate-in fade-in duration-1000">
           <div className="relative mb-6">
              <div className="w-20 h-20 bg-gradient-to-tr from-[#FF8573] to-[#FF9A8B] rounded-3xl flex items-center justify-center shadow-[0_10px_40px_rgba(255,154,139,0.6)] animate-pulse">
                 <CalendarIcon className="w-10 h-10 text-white" />
              </div>
              <div className="absolute -inset-4 border-2 border-primary/30 rounded-[35px] animate-[spin_3s_linear_infinite]"></div>
           </div>
           <h1 className="text-2xl font-extrabold text-textMain tracking-tight">Ежедневник</h1>
           <div className="flex items-center space-x-2 mt-4 text-textMuted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm font-semibold">Синхронизация данных...</span>
           </div>
        </div>
      )}

      {appStage === 'app' && (
        <div className="absolute inset-0 bg-white/40 dark:bg-zinc-900/60 backdrop-blur-3xl flex flex-col md:flex-row z-10 animate-in fade-in duration-500">
          
          <nav className="fixed md:relative bottom-0 w-full md:w-24 md:h-full bg-white/70 dark:bg-zinc-900/80 backdrop-blur-2xl border-t md:border-t-0 md:border-r border-black/5 dark:border-white/10 flex md:flex-col justify-between md:justify-start items-center px-6 md:px-0 pb-8 md:pb-6 pt-3 md:pt-[calc(env(safe-area-inset-top,48px)+24px)] z-30 md:space-y-8 flex-shrink-0 order-2 md:order-1 transition-colors">
            <button onClick={() => { setActiveTab('today'); setCurrentDate(REAL_TODAY); setCalendarViewDate(new Date(REAL_TODAY)); }} className={`flex flex-col items-center space-y-1 w-12 transition-colors ${activeTab === 'today' ? 'text-primary' : 'text-textMuted hover:text-textMain'}`}>
              <Clock className="w-6 h-6" /><span className="text-[10px] font-bold">Сегодня</span>
            </button>
            <button onClick={() => setActiveTab('calendar')} className={`flex flex-col items-center space-y-1 w-12 transition-colors ${activeTab === 'calendar' ? 'text-primary' : 'text-textMuted hover:text-textMain'}`}>
              <CalendarIcon className="w-6 h-6" /><span className="text-[10px] font-bold">Месяц</span>
            </button>
            
            <div className="relative md:static w-16 md:w-full flex justify-center md:flex-col md:items-center md:space-y-6 md:my-4">
              <button onClick={() => openSheet()} className="absolute -top-12 md:static w-14 h-14 bg-gradient-to-tr from-[#FF8573] to-[#FF9A8B] text-white rounded-full shadow-[0_10px_25px_rgba(255,154,139,0.5)] flex items-center justify-center transform hover:scale-105 active:scale-95 transition-all z-40">
                <Plus className="w-7 h-7" />
              </button>
              <button onClick={() => setAiModalOpen(true)} className="absolute -top-[70px] -right-[15px] md:static md:-mt-2 w-8 h-8 md:w-10 md:h-10 bg-white dark:bg-zinc-800 text-purple-500 rounded-full shadow-lg flex items-center justify-center active:scale-90 transition-all z-40 border border-purple-100 dark:border-purple-900/50 hover:bg-purple-50 dark:hover:bg-purple-900/30">
                <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
              </button>
            </div>
            
            <button onClick={() => setActiveTab('tasks')} className={`flex flex-col items-center space-y-1 w-12 transition-colors ${activeTab === 'tasks' ? 'text-primary' : 'text-textMuted hover:text-textMain'}`}>
              <Inbox className="w-6 h-6" /><span className="text-[10px] font-bold">Задачи</span>
            </button>
            <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center space-y-1 w-12 transition-colors ${activeTab === 'profile' ? 'text-primary' : 'text-textMuted hover:text-textMain'}`}>
              <User className="w-6 h-6" /><span className="text-[10px] font-bold">Профиль</span>
            </button>
          </nav>

          <main className="flex-1 flex flex-col relative h-[100dvh] md:h-full order-1 md:order-2 overflow-hidden w-full transition-colors">
            <header className="pt-[calc(env(safe-area-inset-top,48px)+16px)] md:pt-10 pb-4 px-6 md:px-10 bg-transparent z-20 flex justify-between items-center max-w-5xl mx-auto w-full">
              {activeTab === 'today' && (
                 <div>
                   <h2 className="text-2xl md:text-3xl font-extrabold text-textMain tracking-tight capitalize">{headerDateString}</h2>
                   <p className="text-[12px] md:text-sm font-semibold text-primary uppercase tracking-wider">{events.filter(e => e.startDate === currentDate).length} событий сегодня</p>
                 </div>
              )}
              {activeTab === 'calendar' && (
                 <div className="flex items-center space-x-4">
                   <h2 className="text-2xl md:text-3xl font-extrabold text-textMain capitalize">
                      {MONTH_NAMES[currentMonth]} {currentYear}
                   </h2>
                   <div className="flex space-x-1.5">
                     <button onClick={prevMonth} className="p-1.5 md:p-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-textMain transition-all"><ChevronLeft className="w-5 h-5"/></button>
                     <button onClick={nextMonth} className="p-1.5 md:p-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-textMain transition-all"><ChevronRight className="w-5 h-5"/></button>
                   </div>
                 </div>
              )}
              {activeTab === 'tasks' && (
                 <div>
                   <h2 className="text-2xl md:text-3xl font-extrabold text-textMain">Входящие</h2>
                   <p className="text-[12px] md:text-sm font-semibold text-textMuted uppercase tracking-wider">{tasks.length} активных задач</p>
                 </div>
              )}
              {activeTab === 'profile' && <h2 className="text-2xl md:text-3xl font-extrabold text-textMain">Профиль</h2>}
              
              <button onClick={() => { localStorage.removeItem('token'); setAppStage('auth'); setUsername(''); setPassword(''); }} className="p-2 bg-black/5 dark:bg-white/5 hover:bg-red-500/20 text-red-500 rounded-full active:scale-95 transition-all">
                <X className="w-5 h-5" />
              </button>
            </header>

            {activeTab === 'today' && renderTimeline()}
            {activeTab === 'tasks' && renderTasks()}
            {activeTab === 'calendar' && (
              <div className="p-6 md:p-10 max-w-5xl mx-auto w-full flex-1 overflow-y-auto">
                 <div className="grid grid-cols-7 gap-2 mb-4 text-center">
                   {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((d, i) => <div key={d} className={`text-[11px] md:text-sm font-bold uppercase ${i>=5 ? 'text-[#E56B6F]' : 'text-textMuted'}`}>{d}</div>)}
                 </div>
                 <div className="grid grid-cols-7 gap-y-4 gap-x-2 md:gap-4 text-center text-sm md:text-lg font-bold">
                   {calendarDays.map((item, i) => {
                     const dayEventsCount = events.filter(e => e.startDate === item.dateKey).length;
                     const dayTasksCount = tasks.filter(t => t.startDate === item.dateKey).length;
                     const totalThings = dayEventsCount + dayTasksCount;
                     const isSel = item.dateKey === currentDate;
                     
                     return (
                       <div key={i} onClick={() => { setCurrentDate(item.dateKey); setCalendarViewDate(new Date(item.dateKey)); setActiveTab('today'); }}
                            className={`relative py-3 md:py-5 rounded-2xl md:rounded-3xl cursor-pointer transition-all border border-transparent flex flex-col items-center justify-center 
                            ${isSel ? 'bg-primary text-white shadow-md' : item.isCurrentMonth ? 'bg-white/40 dark:bg-zinc-800/40 hover:border-black/5 dark:hover:border-white/5 active:scale-95 text-textMain' : 'text-textMuted opacity-50 hover:bg-white/20 dark:hover:bg-zinc-800/20 active:scale-95'}`}>
                         <span>{item.day}</span>
                         {totalThings > 0 && <div className={`text-[9px] md:text-[11px] font-bold mt-0.5 md:mt-1 ${isSel ? 'text-white/80' : 'text-primary'}`}>{totalThings}</div>}
                       </div>
                     );
                   })}
                 </div>
              </div>
            )}
            
            {activeTab === 'profile' && (
              <div className="p-6 md:p-10 space-y-8 overflow-y-auto pb-32 max-w-2xl mx-auto w-full">
                <div className="flex flex-col items-center">
                  <img src={`https://ui-avatars.com/api/?name=${username}&background=FFD6CC&color=FF9A8B&rounded=true&size=128`} alt="Avatar" className="w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-white dark:border-zinc-800 shadow-xl" />
                  <h2 className="text-xl md:text-2xl font-extrabold text-textMain mt-4">{username}</h2>
                </div>
                <div className="flex space-x-4">
                  <div className="flex-1 bg-white/60 dark:bg-zinc-800/60 p-4 md:p-6 rounded-3xl text-center shadow-sm border border-white/20">
                    <div className="text-3xl md:text-4xl font-black text-primary">{events.length + tasks.length}</div>
                    <div className="text-[10px] md:text-xs font-bold text-textMuted uppercase mt-1">Всего дел</div>
                  </div>
                  <div className="flex-1 bg-white/60 dark:bg-zinc-800/60 p-4 md:p-6 rounded-3xl text-center shadow-sm border border-white/20">
                    <div className="text-3xl md:text-4xl font-black text-[#a855f7]">12</div>
                    <div className="text-[10px] md:text-xs font-bold text-textMuted uppercase mt-1">Дней подряд</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-[11px] md:text-sm font-bold text-textMuted uppercase tracking-wider ml-2">Настройки</h3>
                  <div onClick={toggleDark} className="bg-white/60 dark:bg-zinc-800/60 p-4 md:p-5 rounded-3xl flex justify-between items-center cursor-pointer shadow-sm border border-white/20 hover:bg-white/80 dark:hover:bg-zinc-800/80 transition-all">
                    <div className="flex items-center space-x-3 text-textMain font-bold md:text-lg">
                      <div className="p-2.5 bg-black/5 dark:bg-white/5 rounded-xl">{isDark ? <Moon className="w-5 h-5"/> : <Sun className="w-5 h-5"/>}</div>
                      <span>Темная тема</span>
                    </div>
                    <div className={`w-12 h-7 rounded-full p-1 transition-colors ${isDark ? 'bg-primary' : 'bg-black/10 dark:bg-white/10'}`}>
                      <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform ${isDark ? 'translate-x-5' : ''}`}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* Шторка редактирования (Bottom Sheet / Side Panel) */}
      <div className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300 ${(appStage === 'app' && sheetState.isOpen) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={closeSheet}></div>
      
      <div className={`fixed bottom-0 md:top-0 md:right-0 md:bottom-auto w-full md:w-[450px] bg-white dark:bg-zinc-900 rounded-t-[40px] md:rounded-t-none md:rounded-l-[40px] shadow-[0_-20px_40px_rgba(0,0,0,0.15)] md:shadow-[-20px_0_40px_rgba(0,0,0,0.15)] z-50 flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] 
        ${(appStage === 'app' && sheetState.isOpen) ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full'}`} 
        style={{ height: window.innerWidth >= 768 ? '100dvh' : '88dvh' }}>
        
        <div className="w-full flex justify-center pt-5 pb-4 md:hidden cursor-pointer flex-shrink-0" onClick={closeSheet}>
          <div className="w-12 h-1.5 bg-black/10 dark:bg-white/10 rounded-full"></div>
        </div>
        
        <div className="hidden md:flex justify-end p-6 pb-0 flex-shrink-0">
           <button onClick={closeSheet} className="p-2 bg-black/5 dark:bg-white/5 rounded-full text-textMuted hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <X className="w-5 h-5"/>
           </button>
        </div>
        
        <div className="px-6 flex-1 overflow-y-auto pb-32 space-y-7 custom-scrollbar md:pt-4">
          <div className="flex p-1 bg-black/5 dark:bg-white/5 rounded-2xl">
            <button onClick={() => setSheetState({...sheetState, type: 'event'})} className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${sheetState.type === 'event' ? 'bg-white dark:bg-zinc-800 shadow-sm text-textMain' : 'text-textMuted'}`}>В расписание</button>
            <button onClick={() => setSheetState({...sheetState, type: 'task'})} className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${sheetState.type === 'task' ? 'bg-white dark:bg-zinc-800 shadow-sm text-textMain' : 'text-textMuted'}`}>В задачи</button>
          </div>

          <input type="text" placeholder="Что нужно сделать?" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full text-2xl font-extrabold text-textMain bg-transparent border-none outline-none placeholder:text-black/20 dark:placeholder:text-white/20" />

          <div>
            <h4 className="text-[11px] font-bold text-textMuted uppercase mb-3 ml-1 tracking-wider">Метка</h4>
            <div className="flex space-x-4">
              {COLORS.map(c => (
                <div key={c} onClick={() => setFormData({...formData, color: c})} className={`w-10 h-10 rounded-full cursor-pointer transition-all flex items-center justify-center ${formData.color === c ? 'scale-110 shadow-lg' : 'opacity-50 scale-90 hover:opacity-80'}`} style={{ backgroundColor: c }}>
                   {formData.color === c && <div className="w-full h-full rounded-full border-4 border-white/30 dark:border-zinc-800/80"></div>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-bold text-textMuted uppercase mb-3 flex items-center tracking-wider ml-1"><CalendarDays className="w-3.5 h-3.5 mr-1.5"/> Быстрый перенос</h4>
            <div className="flex space-x-2">
              <button onClick={() => setFormData({...formData, startDate: REAL_TODAY, endDate: REAL_TODAY})} className="flex-1 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-textMain text-xs font-bold py-2 rounded-xl transition-colors">Сегодня</button>
              <button onClick={() => setFormData({...formData, startDate: addDays(REAL_TODAY, 1), endDate: addDays(REAL_TODAY, 1)})} className="flex-1 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-textMain text-xs font-bold py-2 rounded-xl transition-colors">Завтра</button>
              <button onClick={() => setFormData({...formData, startDate: addDays(REAL_TODAY, 7), endDate: addDays(REAL_TODAY, 7)})} className="flex-1 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-textMain text-xs font-bold py-2 rounded-xl transition-colors">Ч/з неделю</button>
            </div>
          </div>

          <div className="bg-black/5 dark:bg-white/5 rounded-3xl overflow-hidden flex flex-col">
            {sheetState.type === 'event' ? (
              <>
                <div className="flex justify-between items-center px-5 py-4 bg-transparent cursor-pointer border-b border-black/5 dark:border-white/5" onClick={() => setFormData({...formData, isAllDay: !formData.isAllDay})}>
                  <div className="flex items-center space-x-3 text-textMain"><Sun className="w-5 h-5 text-primary"/><span className="font-bold">Весь день</span></div>
                  <div className={`w-12 h-7 rounded-full p-1 transition-colors ${formData.isAllDay ? 'bg-primary' : 'bg-black/10 dark:bg-white/10'}`}>
                    <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform ${formData.isAllDay ? 'translate-x-5' : ''}`}></div>
                  </div>
                </div>
                
                <div className="flex justify-between items-center px-5 py-3 border-b border-black/5 dark:border-white/5 bg-transparent">
                  <span className="font-bold text-textMain">Начало</span>
                  <div className="flex space-x-2 items-center">
                    <IOSPickerPill type="date" value={formData.startDate} onChange={(val: string) => setFormData({...formData, startDate: val})} />
                    {!formData.isAllDay && <IOSPickerPill type="time" value={formData.startTime} onChange={(val: string) => {
                        let newEndTime = formData.endTime;
                        // Если "Начало" стало больше или равно "Концу", сдвигаем конец на час вперед
                        if (timeToPixels(val) >= timeToPixels(formData.endTime)) {
                            newEndTime = addOneHour(val);
                        }
                        setFormData({...formData, startTime: val, endTime: newEndTime});
                    }} />}
                  </div>
                </div>

                <div className="flex justify-between items-center px-5 py-3 bg-transparent">
                  <span className="font-bold text-textMain">Конец</span>
                  <div className="flex space-x-2 items-center">
                    <IOSPickerPill type="date" value={formData.endDate} onChange={(val: string) => setFormData({...formData, endDate: val})} />
                    {!formData.isAllDay && <IOSPickerPill type="time" value={formData.endTime} onChange={(val: string) => setFormData({...formData, endTime: val})} />}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center px-5 py-4 bg-transparent cursor-pointer border-b border-black/5 dark:border-white/5" onClick={() => setFormData({...formData, isDeadline: !formData.isDeadline})}>
                  <div className="flex items-center space-x-3 text-textMain"><CalendarDays className="w-5 h-5 text-primary"/><span className="font-bold">Дедлайн</span></div>
                  <div className={`w-12 h-7 rounded-full p-1 transition-colors ${formData.isDeadline ? 'bg-primary' : 'bg-black/10 dark:bg-white/10'}`}>
                    <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform ${formData.isDeadline ? 'translate-x-5' : ''}`}></div>
                  </div>
                </div>

                <div className="flex justify-between items-center px-5 py-4 bg-transparent cursor-pointer border-b border-black/5 dark:border-white/5" onClick={() => setFormData({...formData, isAllDay: !formData.isAllDay})}>
                  <div className="flex items-center space-x-3 text-textMain"><Clock className="w-5 h-5 text-primary"/><span className="font-bold">Точное время</span></div>
                  <div className={`w-12 h-7 rounded-full p-1 transition-colors ${!formData.isAllDay ? 'bg-primary' : 'bg-black/10 dark:bg-white/10'}`}>
                    <div className={`w-5 h-5 bg-white rounded-full shadow-md transition-transform ${!formData.isAllDay ? 'translate-x-5' : ''}`}></div>
                  </div>
                </div>
                
                <div className="flex justify-between items-center px-5 py-3 bg-transparent">
                  <span className="font-bold text-textMain">{formData.isDeadline ? 'До какого' : 'Дата'}</span>
                  <div className="flex space-x-2 items-center">
                     <IOSPickerPill type="date" value={formData.startDate} onChange={(val: string) => setFormData({...formData, startDate: val})} />
                     {!formData.isAllDay && <IOSPickerPill type="time" value={formData.startTime} onChange={(val: string) => setFormData({...formData, startTime: val})} />}
                  </div>
                </div>
              </>
            )}
          </div>
            
          <div className="bg-black/5 dark:bg-white/5 rounded-3xl overflow-hidden flex flex-col">
            <div className="flex justify-between items-center px-5 py-3 bg-transparent">
               <div className="flex items-center space-x-3 text-textMain"><Repeat className="w-5 h-5 text-textMuted"/><span className="font-bold">Повтор</span></div>
               <IOSPickerPill 
                 type="select" 
                 value={formData.repeat} 
                 onChange={(val: string) => setFormData({...formData, repeat: val})} 
                 options={[ {value: 'none', label: 'Никогда'}, {value: 'daily', label: 'Каждый день'}, {value: 'weekly', label: 'Каждую неделю'} ]} 
               />
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-bold text-textMuted uppercase mb-3 ml-1 tracking-wider flex items-center"><AlignLeft className="w-3.5 h-3.5 mr-1.5"/> Комментарии</h4>
            <textarea value={formData.comments} onChange={e=>setFormData({...formData, comments: e.target.value})} className="w-full bg-black/5 dark:bg-white/5 rounded-2xl p-4 text-sm font-medium text-textMain outline-none min-h-[100px] resize-none placeholder:text-textMuted" placeholder="ДЗ, заметки, ссылки..."></textarea>
          </div>

          <div>
            <h4 className="text-[11px] font-bold text-textMuted uppercase mb-3 ml-1 tracking-wider flex items-center"><ListTodo className="w-3.5 h-3.5 mr-1.5"/> Подзадачи (Чеклист)</h4>
            <div className="space-y-3 mb-3">
              {formData.subtasks.map((sub, idx) => (
                 <div key={sub.id} className="flex items-center space-x-3 bg-black/5 dark:bg-white/5 p-3 rounded-xl">
                    <input type="text" value={sub.title} onChange={e => {
                        const newSubs = [...formData.subtasks];
                        newSubs[idx].title = e.target.value;
                        setFormData({...formData, subtasks: newSubs});
                    }} placeholder="Название..." className="flex-1 bg-transparent text-sm text-textMain outline-none font-medium"/>
                    <button onClick={() => setFormData({...formData, subtasks: formData.subtasks.filter(s => s.id !== sub.id)})} className="text-textMuted hover:text-red-500 transition-colors"><X className="w-4 h-4"/></button>
                 </div>
              ))}
            </div>
            <button onClick={() => setFormData({...formData, subtasks: [...formData.subtasks, {id: 'sub_temp_' + Date.now(), title: '', isCompleted: false}]})} className="text-[12px] font-bold text-primary flex items-center px-4 py-2.5 bg-primary/10 rounded-xl hover:bg-primary/20 transition-colors">
               <Plus className="w-4 h-4 mr-1.5"/> Добавить пункт
            </button>
          </div>
        </div>
        
        <div className="absolute bottom-0 md:static w-full bg-white dark:bg-zinc-900 px-6 pb-8 md:pb-6 pt-4 flex space-x-3 border-t border-black/5 dark:border-white/5 flex-shrink-0">
          {sheetState.id && (
            <button onClick={deleteTask} className="w-16 bg-red-50 dark:bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center active:scale-95 transition-transform hover:bg-red-100 dark:hover:bg-red-500/20">
              <Trash2 className="w-6 h-6" />
            </button>
          )}
          <button onClick={saveTask} className="flex-1 bg-gradient-to-r from-[#FF8573] to-[#FF9A8B] hover:opacity-90 text-white py-4 rounded-2xl font-extrabold text-lg shadow-[0_8px_20px_rgba(255,154,139,0.4)] active:scale-[0.98] transition-all">
            Сохранить
          </button>
        </div>
      </div>

      {/* Модальное окно ИИ */}
      <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${(appStage === 'app' && aiModalOpen) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setAiModalOpen(false)}></div>
        <div className={`bg-white/90 dark:bg-zinc-900/90 backdrop-blur-2xl w-full max-w-md rounded-[35px] shadow-2xl p-6 md:p-8 relative flex flex-col border border-white/20 transition-transform duration-300 ${(appStage === 'app' && aiModalOpen) ? 'scale-100 translate-y-0' : 'scale-95 translate-y-10'}`}>
           <button onClick={() => setAiModalOpen(false)} className="absolute top-4 md:top-6 right-4 md:right-6 p-2 bg-black/5 dark:bg-white/5 rounded-full text-textMuted hover:bg-black/10 dark:hover:bg-white/10"><X className="w-5 h-5"/></button>
           
           <div className="flex items-center space-x-3 mb-6">
              <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-500"><Sparkles className="w-6 h-6"/></div>
              <div>
                 <h3 className="text-xl md:text-2xl font-extrabold text-textMain">ИИ Ассистент</h3>
                 <p className="text-xs font-semibold text-textMuted">Голосовой ввод задач</p>
              </div>
           </div>

           {!parsedItems ? (
             <>
               <div className="relative mb-4">
                 <textarea value={aiText} onChange={e=>setAiText(e.target.value)} placeholder="Например: Завтра в 13:00 маникюр..." className="w-full bg-black/5 dark:bg-white/5 rounded-2xl p-4 text-sm text-textMain outline-none min-h-[120px] resize-none"></textarea>
                 <button onClick={toggleListening} className={`absolute bottom-3 right-3 p-3 rounded-full text-white shadow-lg transition-all ${isListening ? 'bg-red-500 animate-pulse' : 'bg-primary hover:bg-primaryHover'}`}>
                   <Mic className="w-5 h-5"/>
                 </button>
               </div>
               <button onClick={processAIText} disabled={!aiText.trim() || isProcessing} className="w-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3.5 rounded-2xl font-bold flex items-center justify-center disabled:opacity-50 transition-all hover:opacity-90">
                 {isProcessing ? <div className="w-5 h-5 border-2 border-white/30 dark:border-zinc-900/30 border-t-white dark:border-t-zinc-900 rounded-full animate-spin"></div> : <><Send className="w-4 h-4 mr-2"/> Распознать</>}
               </button>
             </>
           ) : (
             <div className="flex flex-col max-h-[600px]">
               <p className="text-sm font-bold text-primary mb-3">Распознано {parsedItems.length} задач(и):</p>
               
               <div className="overflow-y-auto space-y-3 mb-4 flex-1 custom-scrollbar px-1 pb-2">
                  {parsedItems.map((item, i) => {
                    const isExp = expandedAiItemId === item._tempId;
                    
                    return (
                      <div 
                        key={item._tempId} 
                        onClick={() => !isExp && setExpandedAiItemId(item._tempId)}
                        className={`bg-black/5 dark:bg-white/5 rounded-2xl border-l-4 transition-all duration-300 ease-in-out ${isExp ? 'p-5 shadow-lg bg-white/60 dark:bg-zinc-800/80 scale-[1.02]' : 'p-3 hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer'}`} 
                        style={{ borderLeftColor: item.color || '#FF9A8B' }}
                      >
                        {!isExp ? (
                          // Свернутый вид (Превью)
                          <div className="flex flex-col pointer-events-none">
                            <p className="font-bold text-sm text-textMain truncate">{item.title}</p>
                            <div className="flex items-center space-x-2 mt-1.5">
                              <span className="text-[10px] font-bold bg-black/5 dark:bg-white/10 px-2 py-0.5 rounded-md text-textMuted">
                                {formatPillDate(item.startDate)} 
                                {item.type === 'event' && !item.isAllDay && item.startTime ? ` с ${item.startTime}` : ''}
                                {item.type === 'task' && !item.isAllDay && item.startTime ? ` до ${item.startTime}` : ''}
                              </span>
                              {item.comments && <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-md"><AlignLeft className="w-3 h-3 inline mr-1"/>Заметки</span>}
                            </div>
                          </div>
                        ) : (
                          // Развернутый вид (Редактирование)
                          <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                             <div className="flex justify-between items-center mb-1">
                               <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Редактирование</span>
                               <button onClick={(e) => { e.stopPropagation(); setExpandedAiItemId(null); }} className="p-1.5 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-textMuted transition-colors">
                                  <ChevronDown className="w-4 h-4 rotate-180"/>
                               </button>
                             </div>
                             
                             <input value={item.title} onChange={e => { const newItems = [...parsedItems]; newItems[i].title = e.target.value; setParsedItems(newItems); }} placeholder="Название..." className="font-bold text-base text-textMain bg-transparent w-full outline-none border-b border-black/10 dark:border-white/10 pb-1.5 focus:border-primary transition-colors"/>
                             
                             <textarea value={item.comments || ''} onChange={e => { const newItems = [...parsedItems]; newItems[i].comments = e.target.value; setParsedItems(newItems); }} className="w-full bg-black/5 dark:bg-white/5 rounded-xl p-3 text-xs font-medium text-textMain outline-none min-h-[70px] resize-none placeholder:text-textMuted/60" placeholder="Заметки, списки или пояснения..."></textarea>
                             
                             <div className="flex items-center space-x-2">
                                <IOSPickerPill type="date" value={item.startDate} onChange={(val: string) => { const newItems = [...parsedItems]; newItems[i].startDate = val; setParsedItems(newItems); }} />
                                
                                {/* Время для события (Начало - Конец) */}
                                {item.type === 'event' && !item.isAllDay && (
                                  <>
                                    <IOSPickerPill type="time" value={item.startTime || '09:00'} onChange={(val: string) => { 
                                       const newItems = [...parsedItems]; 
                                       newItems[i].startTime = val; 
                                       if (timeToPixels(val) >= timeToPixels(newItems[i].endTime || addOneHour(val))) {
                                          newItems[i].endTime = addOneHour(val);
                                       }
                                       setParsedItems(newItems); 
                                    }} />
                                    <span className="text-textMuted font-bold">-</span>
                                    <IOSPickerPill type="time" value={item.endTime || addOneHour(item.startTime || '09:00')} onChange={(val: string) => { const newItems = [...parsedItems]; newItems[i].endTime = val; setParsedItems(newItems); }} />
                                  </>
                                )}

                                {/* Время дедлайна для задачи */}
                                {item.type === 'task' && !item.isAllDay && (
                                    <IOSPickerPill type="time" value={item.startTime || '09:00'} onChange={(val: string) => { 
                                       const newItems = [...parsedItems]; 
                                       newItems[i].startTime = val; 
                                       setParsedItems(newItems); 
                                    }} />
                                )}
                             </div>
                             
                             <div className="flex space-x-3 pt-1">
                                {COLORS.map(c => (
                                  <div key={c} onClick={() => { const newItems = [...parsedItems]; newItems[i].color = c; setParsedItems(newItems); }} className={`w-7 h-7 rounded-full cursor-pointer transition-all flex items-center justify-center ${item.color === c ? 'scale-110 shadow-md ring-2 ring-offset-2 ring-offset-transparent ring-primary' : 'opacity-60 scale-90 hover:opacity-100'}`} style={{ backgroundColor: c }}>
                                     {item.color === c && <div className="w-full h-full rounded-full border-2 border-white/50 dark:border-zinc-800/50"></div>}
                                  </div>
                                ))}
                             </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
               </div>
               
               <button onClick={confirmAiTasks} className="w-full bg-gradient-to-r from-[#A7C957] to-[#8eb33b] text-white py-4 rounded-2xl font-extrabold shadow-[0_8px_20px_rgba(167,201,87,0.4)] hover:opacity-90 active:scale-95 transition-all mt-2">
                 Применить ({parsedItems.length})
               </button>
             </div>
           )}
        </div>
      </div>
    </div>
  );
}