from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, Date, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)

class Event(Base):
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    is_all_day = Column(Boolean, default=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    color = Column(String, default="#FF9A8B")
    comments = Column(String, nullable=True)
    is_completed = Column(Boolean, default=False)
    subtasks = Column(JSONB, default=list) # [{"id": "...", "title": "...", "isCompleted": False}]
    item_type = Column(String, default="event")
    
    # ID родительского события (если сгенерировано из серии)
    parent_id = Column(Integer, ForeignKey("events.id"), nullable=True)