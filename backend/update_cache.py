import json
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

GRAPHQL_URL = "https://api.newlxp.ru/graphql"
ORGANIZATION_ID = "04329772-ff8b-4123-a65b-298e1fa799fb"
CACHE_FILE = "students_cache.json"

ACCOUNT = {
    "email": "milanachutieca52@gmail.com", 
    "password": "ITmag.06"
}

def main():
    print("=== СТАРТ ОБНОВЛЕНИЯ КЭША СТУДЕНТОВ ===")
    session = requests.Session()
    session.trust_env = False 
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Origin": "https://newlxp.ru",
        "Referer": "https://newlxp.ru/"
    })

    # 1. Авторизация
    print("Авторизация...")
    auth_query = "query SignIn($input: SignInInput!) { signIn(input: $input) { accessToken } }"
    auth_payload = {
        "operationName": "SignIn", 
        "variables": {"input": {"email": ACCOUNT["email"], "password": ACCOUNT["password"]}}, 
        "query": auth_query
    }
    
    try:
        resp = session.post(GRAPHQL_URL, json=auth_payload, timeout=90)
        data = resp.json()
        if "errors" in data:
            print(f"Ошибка авторизации: {data['errors']}")
            return
        token = data["data"]["signIn"]["accessToken"]
        print("Токен получен.")
    except Exception as e:
        print(f"Сетевая ошибка при авторизации: {e}")
        return

    # 2. Получение групп
    print("Загрузка списка групп (может занять 1-2 минуты)...")
    headers = {"Authorization": f"Bearer {token}", "apollographql-client-name": "web"}
    query = """
    query GetCuratorGroups($input: CuratorGroupsInput!) {
      curatorGroups(input: $input) {
        items {
          name
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
            print(f"Ошибка API: {data['errors']}")
            return
            
        items = data.get("data", {}).get("curatorGroups", {}).get("items", [])
        cache = {}
        for group in items:
            name = group.get("name")
            students = group.get("students", [])
            if name and students:
                cache[name] = [s["id"] for s in students]
        
        # 3. Сохранение
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=4)
        print(f"УСПЕХ. Данные сохранены в {CACHE_FILE}. Всего групп: {len(cache)}")
        
    except Exception as e:
        print(f"Сетевая ошибка при загрузке групп: {e}")

if __name__ == "__main__":
    main()