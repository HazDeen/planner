from pydantic import BaseModel
from typing import List, Optional
from datetime import date, time

class UserCreate(BaseModel):
    username: str
    password: str

class SubtaskSchema(BaseModel):
    id: str
    title: str
    isCompleted: bool

class EventBase(BaseModel):
    title: str
    is_all_day: bool
    start_date: date
    end_date: date
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    color: str = "#FF9A8B"
    comments: Optional[str] = ""
    subtasks: List[SubtaskSchema] = []
    repeat: Optional[str] = "none" # daily, weekly, none
    item_type: str = "event"

class EventCreate(EventBase):
    pass

class EventResponse(EventBase):
    id: int
    is_completed: bool

    class Config:
        from_attributes = True