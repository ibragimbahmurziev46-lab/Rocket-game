import requests
import json

GRAPHQL_URL = "https://api.newlxp.ru/graphql"
# Вставьте сюда токен куратора (можно взять из логов или получить заново)
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3MThhNmQ2Yy1lZmVjLTQwYjMtODMzMi0wNDA2YzY1NDM4NzEiLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzkzODE3OTU5LCJleHAiOjE3OTM5MDQzNTl9.pQPIyYtVuV7Pjm8cU0jfJ1DVVClCpamLH-ObM457MEM" 

query = """
query IntrospectionQuery {
  __schema {
    types {
      name
      inputFields {
        name
        type {
          name
        }
      }
    }
  }
}
"""

headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
response = requests.post(GRAPHQL_URL, json={"query": query}, headers=headers)
data = response.json()

for t in data.get("data", {}).get("__schema", {}).get("types", []):
    if t["name"] == "CuratorGroupsInput":
        print("Доступные поля для фильтрации групп:")
        for field in t.get("inputFields", []):
            print(f"- {field['name']}: {field['type']['name']}")