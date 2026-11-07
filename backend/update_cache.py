import json
import requests
import sys
import time
import os


GRAPHQL_URL = "https://api.newlxp.ru/graphql"
ORGANIZATION_ID = "04329772-ff8b-4123-a65b-298e1fa799fb"
CACHE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(CACHE_DIR, "students_cache.json")

ACCOUNT = {
    "email": "milanachutieca52@gmail.com", 
    "password": "ITmag.06"
}

def is_group_active(group_name):
    try:
        parts = group_name.split('-')
        if len(parts) != 2: return True
        course = int(parts[0][0])
        year_suffix = int(parts[1].split('.')[1])
        admission_year = 2000 + year_suffix
        current_year = datetime.now().year
        
        # Группа активна, если год поступления + курс >= текущий год - 1 
        # (минус 1, чтобы не отсеять группы, которые поступили в прошлом году, но еще учатся)
        return admission_year + course >= current_year - 1
    except:
        return True

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
            sys.exit(1)
        token = data["data"]["signIn"]["accessToken"]
        print("Токен получен.")
    except Exception as e:
        print(f"Сетевая ошибка при авторизации: {e}")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {token}", "apollographql-client-name": "web"}
    
    # Запрашиваем isArchived у сервера
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

    cache = {}
    # Ищем по конкретным комбинациям "Курс + Специальность"
    search_queries = [
        "1Д", "1П", "1ИБ", "1Р",
        "2Д", "2П", "2ИБ", "2Р",
        "3Д", "3П", "3ИБ", "3Р",
        "4Д", "4П", "4ИБ", "4Р"
    ]
    
    for query_term in search_queries:
        print(f" -> Запрос групп по специальности: {query_term}...")
        
        payload = {
            "operationName": "GetCuratorGroups",
            "variables": {
                "input": {
                    "organizationId": ORGANIZATION_ID,
                    "search": query_term
                }
            },
            "query": query
        }

        try:
            resp = session.post(GRAPHQL_URL, json=payload, headers=headers, timeout=120)
            data = resp.json()
            
            if "errors" in data:
                print(f"   Ошибка API: {data['errors'][0]['message']}")
                continue
                
            items = data.get("data", {}).get("curatorGroups", {}).get("items", [])
            print(f"   Получено групп: {len(items)}")
            
            for group in items:
                name = group.get("name")
                students = group.get("students", [])
                is_archived_server = group.get("isArchived", False)
                
                if not name or not students:
                    continue

                # ПРИМЕНЯЕМ ДВОЙНУЮ ПРОВЕРКУ:
                # 1. Сервер говорит, что группа архивная?
                # 2. Наша математическая формула говорит, что группа старая?
                if is_archived_server or not is_group_active(name):
                    print(f"    [x] Отсеяна архивная группа: {name}")
                    continue
                
                # Если проверки пройдены, сохраняем
                cache[name] = [s["id"] for s in students]
            
            time.sleep(0.5)
            
        except Exception as e:
            print(f"   Сетевая ошибка: {e}")

    # 3. Сохранение
    if cache:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=4)
            
        print(f"\nУСПЕХ. Данные сохранены в {CACHE_FILE}.")
        print(f"Всего активных групп в файле: {len(cache)}")
        for g_name in cache.keys():
            print(f" - {g_name}")
    else:
        print("Не удалось получить ни одной группы.")

if __name__ == "__main__":
    main()