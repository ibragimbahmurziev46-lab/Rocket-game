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
CACHE_FILE = "students_cache.json"

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
    "ДУБЛИН": "DUBLIN","КАИР": "CARIO",
}

_cached_token = None
_session = None
_students_cache = None
_schedule_caches = {} # Теперь это словарь для кэша по датам
_last_schedule_fetch_time = {}

_groups_lock = threading.Lock()
_schedule_lock = threading.Lock()


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
    """
    Загружает данные о группах и студентах.
    Сначала проверяет наличие локального файла кэша.
    Если файла нет, запрашивает данные у API и сохраняет их в файл.
    """
    global _students_cache
    
    if _students_cache is not None:
        return _students_cache

    if os.path.exists(CACHE_FILE):
        print("=== LOADING GROUPS FROM LOCAL FILE ===")
        try:
            print("=== TRYING TO OPEN FILE ===")
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                print("=== FILE OPENED. READING JSON... ===")
                _students_cache = json.load(f)
            print("=== JSON READ SUCCESSFULLY ===")
            return _students_cache
        except Exception as e:
            print(f"=== ERROR READING FILE: {e} ===")
            print("=== FALLING BACK TO API ===")

    # Если файла нет или произошла ошибка, качаем из API
    with _groups_lock:
        if _students_cache is not None:
            return _students_cache

        print("=== FETCHING GROUPS FROM API (THIS MAY TAKE 1-2 MINUTES) ===")
        token = get_access_token()
        session = get_session()
        headers = {"Authorization": f"Bearer {token}", "apollographql-client-name": "web"}
        
        query = """
        query GetCuratorGroups($input: CuratorGroupsInput!) {
          curatorGroups(input: $input) {
            items {
              name
              isArchived
              students { id __typename }
              __typename
            }
            __typename
          }
        }
        """
        
        payload = {
            "operationName": "GetCuratorGroups",
            "variables": {"input": {"organizationId": ORGANIZATION_ID}},
            "query": query
        }

        try:
            resp = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=120)
            data = resp.json()
            
            if "errors" in data:
                print(f"=== API ERROR (GROUPS): {data['errors']} ===")
                return {}
                
            groups_data = data.get("data", {}).get("curatorGroups", {})
            items = groups_data.get("items", [])
            
            cache = {}
            for group in items:
                name = group.get("name")
                students = group.get("students", [])
                if name and students:
                    cache[name] = [s["id"] for s in students]
            
            # Сохраняем в файл
            try:
                with open(CACHE_FILE, "w", encoding="utf-8") as f:
                    json.dump(cache, f, ensure_ascii=False, indent=4)
                print(f"=== CACHE SAVED TO FILE. Groups: {len(cache)} ===")
            except Exception as e:
                print(f"=== ERROR SAVING TO FILE: {e} ===")
            
            _students_cache = cache
            return _students_cache

        except Exception as e:
            print(f"=== ERROR LOADING GROUPS: {e} ===")
            return {}


def fetch_schedule(date_str):
    """
    Собирает расписание на указанную дату. Кэширует результат на 5 минут.
    """
    global _schedule_caches, _last_schedule_fetch_time
    
    now = time.time()
    if date_str in _schedule_caches and (now - _last_schedule_fetch_time.get(date_str, 0) < 300):
        print(f"=== GIVING SCHEDULE FOR {date_str} FROM CACHE ===")
        return _schedule_caches[date_str]

    # Захватываем блокировку ТОЛЬКО для сбора расписания.
    with _schedule_lock:
        # Проверяем еще раз (вдруг другой поток уже собрал)
        now = time.time()
        if date_str in _schedule_caches and (now - _last_schedule_fetch_time.get(date_str, 0) < 300):
            print(f"=== GIVING SCHEDULE FOR {date_str} FROM CACHE (AFTER WAITING) ===")
            return _schedule_caches[date_str]
            
        print(f"=== COLLECTING SCHEDULE FOR ALL GROUPS ON {date_str} ===")
        
        # ВАЖНО: Вызываем load_all_groups_to_cache ДО того, как начнем долгие запросы.
        cache = load_all_groups_to_cache()
        
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
        
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        next_day_str = (date_obj + timedelta(days=1)).strftime("%Y-%m-%d")

        unique_classes = {}

        for group_name, student_ids in cache.items():
            print(f"=== Проверка группы: {group_name} ===")
            for student_id in student_ids[:15]:
                payload = {
                    "operationName": "ManyClassesForStudentProfileSchedule",
                    "variables": {
                        "input": {"studentId": student_id, "from": date_str, "to": next_day_str}
                    },
                    "query": query
                }

                try:
                    resp = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=20)
                    data = resp.json()
                    
                    if "errors" not in data:
                        classes = data.get("data", {}).get("classesForStudentProfile", [])
                        if classes:
                            for c in classes:
                                if not c.get("from"): continue
                                unique_classes[c["id"]] = c
                            break
                except Exception as e:
                    print(f"Ошибка при запросе для {student_id}: {e}")
                
                time.sleep(0.3)

        formatted = []
        for c in unique_classes.values():
            raw_room = c.get("classroom", {}).get("name") if c.get("classroom") else "—"
            formatted.append({
                "id": c.get("id"),
                "group": c.get("learningGroup", {}).get("name", "—").split('-')[0].strip(),
                "start_time": c.get("from"),
                "room": clean_and_translate_room(raw_room)
            })
            
        formatted.sort(key=lambda x: x["start_time"])
        
        _schedule_caches[date_str] = formatted
        _last_schedule_fetch_time[date_str] = time.time()
        
        print(f"=== СБОР ЗАВЕРШЕН. Пар на {date_str}: {len(formatted)} ===")
        return formatted


@app.get("/api/schedule")
def get_schedule(date: str = None):
    """
    Эндпоинт расписания. Принимает дату из query-параметра (например, ?date=2026-11-07).
    Если дата не передана, берет текущую.
    """
    target_date = date if date else datetime.now().strftime("%Y-%m-%d")
    
    try:
        schedule = fetch_schedule(target_date)
        return {"schedule": schedule}
    except Exception as e:
        logging.error(f"Критическая ошибка: {e}")
        raise HTTPException(status_code=502, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)