import time
import threading
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import logging
import time
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GRAPHQL_URL = "https://api.newlxp.ru/graphql"
ORGANIZATION_ID = "04329772-ff8b-4123-a65b-298e1fa799fb"

ACCOUNT = {
    "email": "milanachutieca52@gmail.com", 
    "password": "ITmag.06"
}

# Словарь для перевода аудиторий
ROOM_TRANSLATIONS = {
    "ЛИССАБОН": "LISBON",
    "АФИНЫ": "ATHENS",
    "АФИНЬ": "ATHENS",
    "ЛОНДОН": "LONDON",
    "ПАРИЖ": "PARIS",
    "МАДРИД": "MADRID",
    "РИМ": "ROME",
    "БЕРЛИН": "BERLIN",
    "ТОКИО": "TOKYO",
    "ДУБАЙ": "DUBAI",
    "СТОКГОЛЬМ": "STOCKHOLM",
    "НЬЮ-ЙОРК": "NEW YORK",
    "ВЕНА": "VIENNA",
    "МЕХИКО": "MEXICO",
    "СИДНЕЙ": "SYDNEY",
    "ДУБЛИН": "DUBLIN",
}

def clean_and_translate_room(raw_name):
    if not raw_name:
        return "—"
    clean_name = re.sub(r'\s*\(\d+\)$', '', raw_name).strip()
    return ROOM_TRANSLATIONS.get(clean_name.upper(), clean_name)

# --- КЭШ ---
_cached_token = None
_session = None
_students_cache = None
_schedule_cache = None
_last_schedule_fetch_time = 0

# Блокировки для предотвращения одновременных запросов
_groups_lock = threading.Lock()
_schedule_lock = threading.Lock()
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
    payload = {"operationName": "SignIn", "variables": {"input": {"email": ACCOUNT["email"], "password": ACCOUNT["password"]}}, "query": query}
    resp = session.post(GRAPHQL_URL, json=payload, timeout=90)
    data = resp.json()
    if "errors" in data:
        raise Exception(f"Ошибка авторизации: {data['errors']}")
    _cached_token = data["data"]["signIn"]["accessToken"]
    return _cached_token

# --- ЗАГРУЗКА ВСЕХ СТУДЕНТОВ В КЭШ (ВЫПОЛНЯЕТСЯ 1 РАЗ) ---
def load_all_groups_to_cache():
    global _students_cache
    
    # Если кэш уже есть, отдаем его без блокировок
    if _students_cache is not None:
        return _students_cache

    # Захватываем блокировку. Если другой поток уже грузит группы, этот будет ждать.
    with _groups_lock:
        # Проверяем еще раз, вдруг другой поток уже загрузил данные, пока мы ждали
        if _students_cache is not None:
            return _students_cache

        print("=== LOADING ALL GROUPS (THIS MAY TAKE 1-2 MINUTES) ===")
        token = get_access_token()
        session = get_session()
        headers = {"Authorization": f"Bearer {token}", "apollographql-client-name": "web"}
        
        query = """
        query GetCuratorGroups($input: CuratorGroupsInput!, $organizationId: UUID) {
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
        
        # Убрали $organizationId из запроса, так как он не используется, чтобы не было ошибки 400
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
                is_archived = group.get("isArchived", False)
                
                if name and students:
                    cache[name] = [s["id"] for s in students]
            
            _students_cache = cache
            print(f"=== CACHE LOADED. Active groups found: {len(cache)} ===")
            return _students_cache

        except Exception as e:
            print(f"=== ERROR LOADING GROUPS: {e} ===")
            return {}


_schedule_cache = None
_last_schedule_fetch_time = 0

# --- ПОЛУЧЕНИЕ РАСПИСАНИЯ ---
def fetch_schedule(date_str):
    global _schedule_cache, _last_schedule_fetch_time
    import time as time_module
    
    # Если с момента последнего запроса прошло меньше 5 минут, отдаем данные из кэша
    if _schedule_cache is not None and (time_module.time() - _last_schedule_fetch_time < 300):
        print("=== GIVING SCHEDULE FROM CACHE ===")
        return _schedule_cache

    # Захватываем блокировку для сбора расписания
    with _schedule_lock:
        # Проверяем еще раз (вдруг другой поток уже собрал данные)
        if _schedule_cache is not None and (time_module.time() - _last_schedule_fetch_time < 300):
            print("=== GIVING SCHEDULE FROM CACHE (AFTER WAITING) ===")
            return _schedule_cache
            
    print(f"=== COLLECTING SCHEDULE FOR ALL GROUPS ON {date_str} ===")
    # ... ДАЛЬШЕ ИДЕТ ОСТАЛЬНОЙ КОД ФУНКЦИИ БЕЗ ИЗМЕНЕНИЙ ...


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

    unique_classes = {} # Сюда собираем уникальные пары (по ID), чтобы убрать дубликаты

    for group_name, student_ids in cache.items():
        print(f"=== Проверка группы: {group_name} (студентов: {len(student_ids)}) ===")
        
        group_has_data = False
        
        # Проверяем первых 5 студентов из группы. 
        # Если у них есть пары, считаем, что мы получили расписание группы.
        for student_id in student_ids[:15]:
            payload = {
                "operationName": "ManyClassesForStudentProfileSchedule",
                "variables": {
                    "input": {"studentId": student_id, "from": date_str, "to": next_day_str}
                },
                "query": query
            }

            try:
                resp = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=60)
                data = resp.json()
                
                if "errors" not in data:
                    classes = data.get("data", {}).get("classesForStudentProfile", [])
                    if classes:
                        for c in classes:
                            if not c.get("from"): continue
                            # Добавляем в словарь уникальных пар (ключ - ID пары)
                            unique_classes[c["id"]] = c
                        group_has_data = True
                        break # Если нашли пары у студента, переходим к следующей группе
            except Exception as e:
                print(f"Ошибка при запросе для {student_id}: {e}")
            
            time.sleep(0.3) # Пауза между запросами, чтобы не злить сервер

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
    
    # Сохраняем в кэш
    _schedule_cache = formatted
    _last_schedule_fetch_time = time_module.time()
    
    print(f"=== СБОР ЗАВЕРШЕН. Всего уникальных пар: {len(formatted)} ===")
    return formatted

@app.get("/api/schedule")
@app.get("/api/schedule")
def get_schedule():
    target_date = datetime.now().strftime("%Y-%m-%d")
    
    try:
        # Передаем только дату, без названия группы
        schedule = fetch_schedule(target_date)
        return {"schedule": schedule}
    except Exception as e:
        logging.error(f"Критическая ошибка: {e}")
        raise HTTPException(status_code=502, detail=str(e))

@app.get("/api/debug_schedule")
def debug_schedule():
    print("=== СТАРТ ДЕБАГА РАСПИСАНИЯ (ИЗОЛИРОВАННЫЙ ЗАПРОС) ===")
    
    token = get_access_token()
    session = get_session()
    headers = {"Authorization": f"Bearer {token}", "apollographql-client-name": "web"}
    
    # Убрали переменную $isAdministrationSchedule из заголовка
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
    
    # ЖЕСТКО ЗАДАЕМ РАБОЧИЙ ID И РАБОЧУЮ ДАТУ (СУББОТА)
    student_id = "019e6cdb-e7c0-4b7e-a325-59c3c3c63b5d" 
    date_from = "2026-11-07"
    date_to = "2026-11-08"

    payload = {
        "operationName": "ManyClassesForStudentProfileSchedule",
        "variables": {
            # Убрали isAdministrationSchedule
            "input": {
                "studentId": student_id, 
                "from": date_from, 
                "to": date_to
            }
        },
        "query": query
    }

    print(f"=== Отправка запроса для ID: {student_id} на дату: {date_from} ===")
    try:
        resp = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=20)
        data = resp.json()
        
        if "errors" in data:
            print(f"=== ОШИБКА API: {data['errors']} ===")
            return {"error": data['errors']}
            
        classes = data.get("data", {}).get("classesForStudentProfile", [])
        print(f"=== УСПЕХ: Сервер вернул {len(classes)} пар ===")
        
        return {"schedule": classes}
    except Exception as e:
        print(f"=== ОШИБКА: {e} ===")
        return {"error": str(e)}
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)