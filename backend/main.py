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

# Список аккаунтов. Первый (куратор) падает с ошибкой 500, второй (студент) забирает данные.
ACCOUNTS = [
    {
        "email": "milanachutieca52@gmail.com", 
        "password": "ITmag.06", 
        "role": "TEACHER"
    },
    {
        "email": "PogorovSM24@magas.ithub.ru", 
        "password": "FuAEP13rvay&", 
        "role": "STUDENT"
    }
]

_cached_tokens = {}
_session = None

def get_session():
    global _session
    if _session:
        return _session

    session = requests.Session()
    session.trust_env = False 
    
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "POST", "OPTIONS"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin": "https://newlxp.ru",
        "Referer": "https://newlxp.ru/"
    })
    
    _session = session
    return _session

def get_access_token(email, password):
    global _cached_tokens
    if email in _cached_tokens:
        return _cached_tokens[email]

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
        "variables": {"input": {"email": email, "password": password}},
        "query": query
    }
    
    try:
        response = session.post(GRAPHQL_URL, json=payload, timeout=15)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Сетевая ошибка при авторизации ({email}): {e}")
        return None
    
    if "errors" in data:
        logging.error(f"Ошибка авторизации ({email}): {data['errors']}")
        return None
        
    token = data["data"]["signIn"]["accessToken"]
    _cached_tokens[email] = token
    return token

def fetch_schedule_for_date(date_str: str):
    query = """
    query ManyClassesForSchedule($input: ManyClassesInput!) {
      manyClasses(input: $input) {
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

    for account in ACCOUNTS:
        logging.info(f"Попытка получить расписание с аккаунта: {account['email']} (Роль: {account['role']})")
        
        token = get_access_token(account["email"], account["password"])
        if not token:
            continue

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "apollographql-client-name": "web"
        }

        all_classes = []
        page = 1
        page_size = 50
        success = True

        while True:
            variables = {
                "input": {
                    "page": page,
                    "pageSize": page_size,
                    "filters": {
                        "roles": [account["role"]], 
                        "interval": {"from": date_str, "to": next_day_str}
                    }
                }
            }

            payload = {
                "operationName": "ManyClassesForSchedule",
                "variables": variables,
                "query": query
            }

            try:
                session = get_session()
                response = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=20)
                response.raise_for_status()
                data = response.json()
            except requests.exceptions.RequestException as e:
                logging.error(f"Сетевая ошибка при запросе расписания ({account['email']}, стр {page}): {e}")
                success = False
                break
                
            if "errors" in data:
                error_msg = data['errors'][0]['message']
                logging.warning(f"Ошибка API ({account['email']}): {error_msg}")
                success = False
                if data['errors'][0].get('extensions', {}).get('code') == 'UNAUTHENTICATED':
                    _cached_tokens.pop(account["email"], None)
                break
                
            classes = data["data"]["manyClasses"]
            all_classes.extend(classes)
            
            if len(classes) < page_size:
                break
                
            page += 1
            time.sleep(0.5) 
            
        if success:
            logging.info(f"Успешно получено {len(all_classes)} записей с аккаунта {account['email']}.")
            filtered_classes = [
                c for c in all_classes 
                if c.get("from") and c["from"].startswith(date_str)
            ]
            return filtered_classes
        else:
            logging.info(f"Не удалось получить данные с {account['email']}. Переход к следующему аккаунту...")

    raise Exception("Не удалось получить расписание ни с одного из доступных аккаунтов.")

@app.get("/api/schedule")
def get_schedule():
    # Запрашиваем расписание на (сегодня + 3 дня), как вы просили
    target_date = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
    logging.info(f"Запрашиваем расписание на: {target_date}")
    
    try:
        classes = fetch_schedule_for_date(target_date)
    except Exception as e:
        logging.error(f"Критическая ошибка: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    
    formatted_schedule = []
    for idx, c in enumerate(classes):
        raw_group_name = c.get("learningGroup", {}).get("name") if c.get("learningGroup") else "—"
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