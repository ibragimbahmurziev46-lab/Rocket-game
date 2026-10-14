from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ВНИМАНИЕ: Чтобы тестовые данные отображались на экране прямо сейчас,
# дата генерируется динамически для текущего дня. Время берется из вашего ТЗ.
@app.get("/api/schedule")
def get_schedule():
    today = datetime.now().date()
    
    def make_time(hour, minute):
        return datetime.combine(today, datetime.min.time().replace(hour=hour, minute=minute)).isoformat()

    schedule = [
        {"id": 1, "group": "3П2", "start_time": make_time(9, 0), "room": "Sydney"},
        {"id": 2, "group": "3П2", "start_time": make_time(10, 30), "room": "Singapore"},
        {"id": 3, "group": "3П2", "start_time": make_time(12, 30), "room": "Stockholm"},
        {"id": 4, "group": "3П2", "start_time": make_time(14, 0), "room": "New-York"},
        {"id": 5, "group": "3П1", "start_time": make_time(9, 0), "room": "Tokyo"},
        {"id": 6, "group": "3П1", "start_time": make_time(10, 30), "room": "Brussels"},
        {"id": 7, "group": "3П1", "start_time": make_time(12, 30), "room": "Brussels"},
    ]
    return {"schedule": schedule}