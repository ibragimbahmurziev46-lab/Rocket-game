from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import logging
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GRAPHQL_URL = "https://api.newlxp.ru/graphql"
EMAIL = "PogorovSM24@magas.ithub.ru"
PASSWORD = "FuAEP13rvay&"

_cached_token = None
_session = None

def get_session():
    """Создает устойчивую сессию с повторными попытками при обрыве связи"""
    global _session
    if _session:
        return _session

    session = requests.Session()
    # Отключаем системные прокси, которые могут блокировать запрос
    session.trust_env = False 
    
    retry_strategy = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "POST", "OPTIONS"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    # Подменяем User-Agent на реальный браузер, чтобы не попасть под блокировку
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
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
    query = """
    query SignIn($input: SignInInput!) {
      signIn(input: $input) {
        accessToken
      }
    }
    """
    payload = {
        "operationName": "SignIn",
        "variables": {"input": {"email": EMAIL, "password": PASSWORD}},
        "query": query
    }
    
    try:
        response = session.post(GRAPHQL_URL, json=payload, timeout=15)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Сетевая ошибка при авторизации: {e}")
        raise Exception(f"Не удалось подключиться к серверу авторизации: {e}")
    
    if "errors" in data:
        logging.error(f"Ошибка авторизации: {data['errors']}")
        raise Exception("Неверный логин или пароль (NewLXP)")
        
    _cached_token = data["data"]["signIn"]["accessToken"]
    return _cached_token

def fetch_schedule_for_date(date_str: str):
    token = get_access_token()
    session = get_session()
    
    query = """
    query ManyClassesForSchedule($input: ManyClassesInput!) {
      manyClasses(input: $input) {
        id
        from
        learningGroup { name }
        classroom { name }
      }
    }
    """
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "apollographql-client-name": "web"
    }

    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    next_week_str = (date_obj + timedelta(days=7)).strftime("%Y-%m-%d")

    all_classes = []
    page = 1
    page_size = 50

    while True:
        variables = {
            "input": {
                "page": page,
                "pageSize": page_size,
                "filters": {
                    "roles": ["STUDENT"],
                    "interval": {"from": date_str, "to": next_week_str}
                }
            }
        }

        payload = {
            "operationName": "ManyClassesForSchedule",
            "variables": variables,
            "query": query
        }

        try:
            response = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=20)
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.RequestException as e:
            logging.error(f"Сетевая ошибка при запросе расписания (страница {page}): {e}")
            # При обрыве связи пробуем еще раз через 2 секунды
            time.sleep(2)
            continue
            
        if "errors" in data:
            error_msg = data['errors'][0]['message']
            logging.error(f"Ошибка API: {error_msg}")
            raise Exception(f"API вернул ошибку: {error_msg}")
            
        classes = data["data"]["manyClasses"]
        all_classes.extend(classes)
        
        if len(classes) < page_size:
            break
            
        page += 1
        time.sleep(0.5) # Небольшая пауза между страницами, чтобы не злить сервер
        
    filtered_classes = [
        c for c in all_classes 
        if c.get("from") and c["from"].startswith(date_str)
    ]
        
    return filtered_classes

@app.get("/api/schedule")
def get_schedule():
    # Временно запрашиваем расписание на субботу (сегодня + 3 дня)
    target_date = (datetime.now() + timedelta(days=0)).strftime("%Y-%m-%d")
    logging.info(f"Запрашиваем расписание на: {target_date}")
    
    try:
        classes = fetch_schedule_for_date(target_date)
    except Exception as e:
        logging.error(f"Критическая ошибка: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    
    formatted_schedule = []
    for idx, c in enumerate(classes):
        # Получаем сырое имя группы
        raw_group_name = c.get("learningGroup", {}).get("name") if c.get("learningGroup") else "—"
        
        # Отрезаем всё, что идет после первого дефиса, и убираем пробелы по краям
        group_name = raw_group_name.split('-')[0].strip()
        
        room_name = c.get("classroom", {}).get("name") if c.get("classroom") else "—"
        start_time = c.get("from")
        
        if not start_time:
            continue

        formatted_schedule.append({
            "id": c.get("id", str(idx)),
            "group": group_name,
            "start_time": start_time,
            "room": room_name
        })

    formatted_schedule.sort(key=lambda x: x["start_time"])
    
    return {"schedule": formatted_schedule}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)