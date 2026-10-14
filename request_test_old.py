from fastapi import FastAPI
from fastapi.responses import JSONResponse
import requests
from datetime import datetime

app = FastAPI()

# Твой токен. Лучше вынести в переменную окружения, но для примера — так.
AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NmVkZDZlYi1kMTM3LTQ0MzAtYjcwYy1hYjZlOWRmNzUyYzMiLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzkxODMzNjM4LCJleHAiOjE3OTE5MjAwMzh9.IrrgMraRFFnWuTvLbM3WoqU9XPAsoShFjWu3q-7O0gk"
GRAPHQL_URL = "https://api.newlxp.ru/graphql"

@app.get("/schedule")
def get_schedule(from_date: str = "2026-10-11", to_date: str = "2026-10-20"):
    """
    Телевизор обращается сюда: /schedule?from_date=...&to_date=...
    Мы идём в API колледжа и возвращаем уже готовый JSON.
    """
    query = """
    query ManyClassesForSchedule($input: ManyClassesInput!) {
      manyClasses(input: $input) {
        id
        from
        to
        discipline { name }
        teachers { user { firstName lastName } }
        classroom { name buildingArea { name } }
        learningGroup { name }
      }
    }
    """
    
    variables = {
        "input": {
            "page": 1,
            "pageSize": 50,
            "filters": {
                "roles": ["STUDENT", "TEACHER", "STUDENT_PARENT"],
                "interval": {"from": from_date, "to": to_date}
            }
        }
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
    }
    
    payload = {
        "operationName": "ManyClassesForSchedule",
        "query": query,
        "variables": variables
    }
    try:
        resp = requests.post(GRAPHQL_URL, json=payload, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        print("СТАТУС:", resp.status_code)
        print("ОТВЕТ:", resp.text)

        if not data or not data.get("data"):
            # Сервер вернул ошибку — покажем её
            errors = (data or {}).get("errors", "нет данных")
            return JSONResponse(status_code=500, content={"error": errors})

        classes = data["data"].get("manyClasses") or []

        result = []
        for cls in classes:
            result.append({
                "start": cls["from"],
                "end": cls["to"],
                "group": cls["learningGroup"]["name"] if cls["learningGroup"] else "—",
                "discipline": cls["discipline"]["name"] if cls["discipline"] else "—",
                "teacher": (
                    f'{cls["teachers"][0]["user"]["firstName"]} '
                    f'{cls["teachers"][0]["user"]["lastName"]}'
                    if cls["teachers"] else "—"
                ),
                "room": cls["classroom"]["name"] if cls["classroom"] else "—",
                "building": (
                    cls["classroom"]["buildingArea"]["name"]
                    if cls["classroom"] and cls["classroom"].get("buildingArea")
                    else "—"
                ),
            })
        return JSONResponse(content={"classes": result})

    except requests.exceptions.RequestException as e:
        return JSONResponse(status_code=500, content={"error": str(e)})    



# Запускается так: uvicorn main:app --reload