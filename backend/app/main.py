import os
import json
from dotenv import load_dotenv
import httpx
import logging
from fastapi import FastAPI, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from datetime import timedelta, datetime
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.database import engine, Base, get_db
from app.models import User, Event
from app.schemas import UserCreate, EventCreate, EventResponse
from app.auth import get_password_hash, verify_password, create_access_token, get_current_user

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Planner API")

# Читаем список разрешенных доменов из .env, по умолчанию разрешаем всё (для локальной разработки)
origins_str = os.getenv("ALLOWED_ORIGINS", "*")
origins = [origin.strip() for origin in origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# --- АВТОРИЗАЦИЯ ---
@app.post("/register", status_code=status.HTTP_201_CREATED)
async def register(user: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == user.username))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")
    
    hashed_pwd = get_password_hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_pwd)
    db.add(new_user)
    await db.commit()
    return {"msg": "Пользователь успешно создан"}

@app.post("/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalars().first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный логин или пароль")
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# --- ИИ АССИСТЕНТ (БЕЗОПАСНЫЙ ЭНДПОИНТ) ---
class AIPrompt(BaseModel):
    text: str
    current_date: str

@app.post("/api/ai/parse")
async def parse_text_with_ai(prompt: AIPrompt, current_user: User = Depends(get_current_user)):
    keys_env = os.getenv("GEMINI_API_KEYS")
    if not keys_env:
        logger.error("КРИТИЧЕСКАЯ ОШИБКА: Переменная GEMINI_API_KEYS не найдена в .env")
        raise HTTPException(status_code=500, detail="API ключи не настроены на сервере")

    api_keys = [k.strip() for k in keys_env.split(",") if k.strip()]
    
    # Вычисляем день недели для ИИ, чтобы он понимал относительные даты ("до среды")
    days_ru = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]
    try:
        dt = datetime.strptime(prompt.current_date, "%Y-%m-%d")
        day_of_week = days_ru[dt.weekday()]
        date_str = f"{prompt.current_date} ({day_of_week})"
    except:
        date_str = prompt.current_date
    
    system_prompt = f"""Ты профессиональный ИИ-ассистент ежедневника. 
    Сегодняшняя дата: {date_str}.
    Проанализируй текст и верни массив JSON объектов.
    
    РАЗДЕЛЕНИЕ НА ЗАДАЧИ И СОБЫТИЯ:
    - Встреча, созвон, смена на работе (имеет начало и конец) -> "type": "event".
    - Задача (нужно сделать ДО какого-то времени/дня или просто в течение дня) -> "type": "task".
    
    ДАТЫ И ДЕДЛАЙНЫ (ОЧЕНЬ ВАЖНО):
    - Внимательно высчитывай даты (завтра, послезавтра, до среды, в четверг), отталкиваясь от сегодняшнего дня ({date_str}).
    - Задача на весь день или до определенного дня (без точного времени) -> "isAllDay": true, "startTime": null.
    - Задача с точным временем дедлайна (до 15:00) -> "isAllDay": false, "startTime": "15:00".
    
    ЗАМЕТКИ:
    - Зарплата, списки покупок, ссылки и любые другие детали ОБЯЗАТЕЛЬНО помещай в "comments".
    
    Формат объекта:
    {{
      "type": "event" | "task",
      "title": "Название",
      "isAllDay": boolean,
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "color": "#FF9A8B",
      "comments": "Текст комментария или пустая строка"
    }}
    ВЕРНИ ТОЛЬКО СЫРОЙ МАССИВ JSON, БЕЗ МАРКДАУНА. Текст: "{prompt.text}"
    """
    
    async with httpx.AsyncClient() as client:
        for index, api_key in enumerate(api_keys):
            masked_key = f"...{api_key[-4:]}" if len(api_key) > 4 else "INVALID"
            logger.info(f"--- ИИ Запрос: Пробуем ключ {index + 1} из {len(api_keys)} ({masked_key}) ---")
            
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key={api_key}"
            try:
                response = await client.post(
                    api_url,
                    json={"contents": [{"parts": [{"text": system_prompt}]}]},
                    timeout=30.0
                )
                
                if response.status_code != 200:
                    logger.error(f"Ошибка от Google (ключ {masked_key}). Статус: {response.status_code}. Ответ: {response.text}")
                    continue 
                    
                result = response.json()
                text_response = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "[]")
                
                clean_json = text_response.replace("```json\n", "").replace("```", "").strip()
                parsed_data = json.loads(clean_json)
                
                logger.info(f"Успешный ответ от ИИ с ключом {masked_key}")
                return parsed_data
                
            except httpx.RequestError as e:
                logger.error(f"Сетевая ошибка при запросе к Google (ключ {masked_key}): {str(e)}")
                continue
            except json.JSONDecodeError as e:
                logger.error(f"Ошибка парсинга JSON от Google. ИИ вернул неверный формат: {text_response}")
                continue
            except Exception as e:
                logger.error(f"Непредвиденная ошибка (ключ {masked_key}): {str(e)}")
                continue
                
    logger.error("Все доступные ключи API были перебраны, но запрос не удался.")
    raise HTTPException(status_code=500, detail="Сбой ИИ-ассистента. Подробности в логах сервера.")


# --- СОБЫТИЯ (EVENTS) ---
@app.post("/events/", response_model=List[EventResponse])
async def create_event(event: EventCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    events_to_create = []
    
    base_event = Event(
        user_id=current_user.id, title=event.title, is_all_day=event.is_all_day,
        start_date=event.start_date, end_date=event.end_date, start_time=event.start_time,
        end_time=event.end_time, color=event.color, comments=event.comments,
        subtasks=[s.model_dump() for s in event.subtasks],
        item_type=event.item_type
    )
    db.add(base_event)
    await db.flush() 
    
    events_to_create.append(base_event)

    if event.repeat != "none":
        current_date = event.start_date
        limit = 365 if event.repeat == "daily" else 52 
        
        for _ in range(1, limit):
            if event.repeat == "daily":
                current_date += timedelta(days=1)
            elif event.repeat == "weekly":
                current_date += timedelta(weeks=1)
                
            new_instance = Event(
                user_id=current_user.id, parent_id=base_event.id, title=event.title,
                is_all_day=event.is_all_day, start_date=current_date, end_date=current_date,
                start_time=event.start_time, end_time=event.end_time, color=event.color,
                comments=event.comments, subtasks=[s.model_dump() for s in event.subtasks],
                item_type=event.item_type
            )
            db.add(new_instance)
            events_to_create.append(new_instance)
            
    await db.commit()
    return events_to_create

@app.get("/events/", response_model=list[EventResponse])
async def read_events(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Event).where(Event.user_id == current_user.id))
    return result.scalars().all()

@app.put("/events/{event_id}", response_model=EventResponse)
async def update_event(event_id: int, event_data: EventCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Event).where(Event.id == event_id, Event.user_id == current_user.id))
    db_event = result.scalars().first()
    
    if not db_event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    
    db_event.title = event_data.title
    db_event.is_all_day = event_data.is_all_day
    db_event.start_date = event_data.start_date
    db_event.end_date = event_data.end_date
    db_event.start_time = event_data.start_time
    db_event.end_time = event_data.end_time
    db_event.color = event_data.color
    db_event.comments = event_data.comments
    db_event.subtasks = [s.model_dump() for s in event_data.subtasks]
    db_event.item_type = event_data.item_type
    
    await db.commit()
    await db.refresh(db_event)
    return db_event

@app.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Event).where(Event.id == event_id, Event.user_id == current_user.id))
    db_event = result.scalars().first()
    
    if not db_event:
        raise HTTPException(status_code=404, detail="Событие не найдено")
        
    await db.delete(db_event)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)