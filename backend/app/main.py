import os
import json
import httpx
from fastapi import FastAPI, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from datetime import timedelta
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.database import engine, Base, get_db
from app.models import User, Event
from app.schemas import UserCreate, EventCreate, EventResponse
from app.auth import get_password_hash, verify_password, create_access_token, get_current_user

app = FastAPI(title="Planner API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # В будущем заменить на URL фронтенда
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
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="API ключ не настроен на сервере")

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}"
    
    system_prompt = f"""Ты ИИ-ассистент ежедневника. Текущая дата: {prompt.current_date}.
    Проанализируй текст и верни массив JSON объектов. Формат объекта:
    {{
      "type": "event" | "task",
      "title": "Название",
      "isAllDay": boolean,
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "color": "#FF9A8B"
    }}
    ВЕРНИ ТОЛЬКО СЫРОЙ МАССИВ JSON, БЕЗ МАРКДАУНА. Текст: "{prompt.text}"
    """

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                api_url,
                json={"contents": [{"parts": [{"text": system_prompt}]}]},
                timeout=15.0
            )
            response.raise_for_status()
            result = response.json()
            text_response = result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "[]")
            
            clean_json = text_response.replace("```json\n", "").replace("```", "").strip()
            return json.loads(clean_json)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Ошибка обработки ИИ: {str(e)}")

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