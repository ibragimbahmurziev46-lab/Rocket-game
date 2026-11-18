import time
import threading
import logging
import re
import json
import os
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GRAPHQL_URL = "https://api.newlxp.ru/graphql"
ORGANIZATION_ID = "04329772-ff8b-4123-a65b-298e1fa799fb"

# Абсолютные пути к файлам, чтобы они всегда лежали в папке backend
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(BASE_DIR, "students_cache.json")
WEEK_CACHE_FILE = os.path.join(BASE_DIR, "week_schedule.json")

ACCOUNT = {
    "email": "milanachutieca52@gmail.com", 
    "password": "ITmag.06"
}

ROOM_TRANSLATIONS = {
    "ЛИССАБОН": "LISBON", "АФИНЫ": "ATHENS", "АФИНЬ": "ATHENS",
    "ЛОНДОН": "LONDON", "ПАРИЖ": "PARIS", "МАДРИД": "MADRID",
    "РИМ": "ROME", "БЕРЛИН": "BERLIN", "ТОКИО": "TOKYO",
    "ДУБАЙ": "DUBAI", "СТОКГОЛЬМ": "STOCKHOLM", "НЬЮ-ЙОРК": "NEW YORK",
    "ВЕНА": "VIENNA", "МЕХИКО": "MEXICO", "СИДНЕЙ": "SYDNEY",
    "ДУБЛИН": "DUBLIN", "КАИР": "CARIO",
}

_cached_token = None
_session = None
_students_cache = None
_last_cache_mtime = 0

_weekly_schedule_cache = {}
_cache_lock = threading.Lock()


def clean_and_translate_room(raw_name):
    if not raw_name:
        return "—"
    clean_name = re.sub(r'\s*\(\d+\)$', '', raw_name).strip()
    return ROOM_TRANSLATIONS.get(clean_name.upper(), clean_name)


def get_session():
    global _session
    if _session:
        return _session
    
    session = requests.Session()
    session.trust_env = False 
    retry_strategy = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Origin": "https://newlxp.ru",
        "Referer": "https://newlxp.ru/"
    })
    _session = session
    return _session


def get_access_token():
    global _cached_token
    if _cached_token:
        return _cached_token
    
    session = get_session()
    query = "query SignIn($input: SignInInput!) { signIn(input: $input) { accessToken } }"
    payload = {
        "operationName": "SignIn", 
        "variables": {"input": {"email": ACCOUNT["email"], "password": ACCOUNT["password"]}}, 
        "query": query
    }
    resp = session.post(GRAPHQL_URL, json=payload, timeout=90)
    data = resp.json()
    
    if "errors" in data:
        raise Exception(f"Ошибка авторизации: {data['errors']}")
        
    _cached_token = data["data"]["signIn"]["accessToken"]
    return _cached_token


def load_all_groups_to_cache():
    global _students_cache, _last_cache_mtime
    
    if not os.path.exists(CACHE_FILE):
        print("=== CACHE FILE NOT FOUND ===")
        return {} 

    try:
        current_mtime = os.path.getmtime(CACHE_FILE)
        
        if _students_cache is not None and current_mtime == _last_cache_mtime:
            return _students_cache
            
        print("=== LOADING GROUPS FROM LOCAL FILE ===")
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            _students_cache = json.load(f)
            
        _last_cache_mtime = current_mtime
        print(f"=== GROUPS LOADED: {len(_students_cache)} ===")
        return _students_cache
        
    except Exception as e:
        print(f"=== ERROR READING FILE: {e} ===")
        return {}


def fetch_week_from_api():
    """Запрашивает расписание у NewLXP сразу на всю текущую неделю."""
    print("=== [BACKGROUND] FETCHING WEEKLY SCHEDULE FROM API ===")
    
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    
    date_from = monday.strftime("%Y-%m-%d")
    date_to = sunday.strftime("%Y-%m-%d")
    
    cache = load_all_groups_to_cache()
    if not cache:
        return

    token = get_access_token()
    session = get_session()
    headers = {"Authorization": f"Bearer {token}", "apollographql-client-name": "web"}
    
    query = """
    query ManyClassesForStudentProfileSchedule($input: ClassesForStudentProfileInput!) {
      classesForStudentProfile(input: $input) {
        id
        from
        learningGroup { name __typename }
        classroom { name __typename }
        __typename
      }
    }
    """
    
    unique_classes = {}

    print(f"=== [BACKGROUND] Fetching data from {date_from} to {date_to} ===")

    for group_name, student_ids in cache.items():
        for student_id in student_ids[:2]:
            payload = {
                "operationName": "ManyClassesForStudentProfileSchedule",
                "variables": {
                    "input": {"studentId": student_id, "from": date_from, "to": date_to}
                },
                "query": query
            }

            try:
                resp = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=30)
                data = resp.json()
                
                if "errors" not in data:
                    classes = data.get("data", {}).get("classesForStudentProfile", [])
                    if classes:
                        for c in classes:
                            # ЗАЩИТА ОТ NULL
                            if not c or not c.get("from"): continue
                            unique_classes[c["id"]] = c
            except Exception as e:
                print(f"Ошибка API для студента {student_id}: {e}")
            
            time.sleep(0.2)

    new_week_data = {}
    
    print(f"=== [BACKGROUND] Processing {len(unique_classes)} unique classes ===")

    for c in unique_classes.values():
        if not c: continue
        
        # ЗАЩИТА ОТ NULL
        raw_classroom = c.get("classroom")
        raw_room_name = raw_classroom.get("name") if raw_classroom else "—"
        
        raw_learning_group = c.get("learningGroup")
        group_name = raw_learning_group.get("name", "—") if raw_learning_group else "—"
        
        # ФИЛЬТР: Если нет названия группы или кабинета, пропускаем
        if raw_room_name == "—" or group_name == "—":
            continue
        
        date_str = c.get("from", "")[:10]
        if not date_str: continue
        
        lesson = {
            "id": c.get("id"),
            "group": group_name.split('-')[0].strip(),
            "start_time": c.get("from"),
            "room": clean_and_translate_room(raw_room_name)
        }
        
        if date_str not in new_week_data:
            new_week_data[date_str] = []
        new_week_data[date_str].append(lesson)

    for date_str in new_week_data:
        new_week_data[date_str].sort(key=lambda x: x["start_time"])

    try:
        # Сохраняем файл
        with open(WEEK_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(new_week_data, f, ensure_ascii=False, indent=4)
            
        with _cache_lock:
            global _weekly_schedule_cache
            _weekly_schedule_cache = new_week_data
            
        print(f"=== [BACKGROUND] WEEK CACHE UPDATED. Total days: {len(new_week_data)} ===")
    except Exception as e:
        print(f"=== ERROR SAVING WEEK CACHE: {e} ===")


def background_updater():
    if os.path.exists(WEEK_CACHE_FILE):
        try:
            with open(WEEK_CACHE_FILE, "r", encoding="utf-8") as f:
                with _cache_lock:
                    global _weekly_schedule_cache
                    _weekly_schedule_cache = json.load(f)
            print("=== INITIAL WEEK CACHE LOADED FROM FILE ===")
        except Exception as e:
            print(f"Ошибка загрузки старого кэша: {e}")

    while True:
        try:
            fetch_week_from_api()
        except Exception as e:
            print(f"Критическая ошибка в фоновом потоке: {e}")
            
        # Ждем 5 минут
        time.sleep(300)


@app.on_event("startup")
def startup_event():
    thread = threading.Thread(target=background_updater, daemon=True)
    thread.start()


@app.get("/api/schedule")
def get_schedule(date: str = None):
    target_date = date if date else datetime.now().strftime("%Y-%m-%d")
    
    with _cache_lock:
        schedule = _weekly_schedule_cache.get(target_date, [])
        
    return {"schedule": schedule, "is_empty": len(schedule) == 0}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)