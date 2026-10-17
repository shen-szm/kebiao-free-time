"""Export public timetable rows for browsers that cannot reach Supabase."""

import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
config = (ROOT / "cloud-config.js").read_text(encoding="utf-8")
url = "https://nmflngzabwirqlantxru.supabase.co"
key = re.search(r"publishableKey:\s*'([^']+)'", config).group(1)


def fetch(table, columns, order=None):
    rows = []
    offset = 0
    while True:
        query = {"select": columns, "limit": "1000", "offset": str(offset)}
        if order:
            query["order"] = order
        endpoint = f"{url}/rest/v1/{table}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(endpoint, headers={"apikey": key})
        with urllib.request.urlopen(request, timeout=30) as response:
            page = json.load(response)
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


snapshot = {
    "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "schedules": fetch(
        "schedules", "id,owner_id,name,cls,data,source,source_path,updated_at", "updated_at.desc"
    ),
    "departments": fetch("departments", "id,name", "name.asc"),
    "assignments": fetch("schedule_departments", "schedule_id,department_id"),
}
output = ROOT / "data" / "public-snapshot.json"
output.parent.mkdir(exist_ok=True)
if output.exists():
    current = json.loads(output.read_text(encoding="utf-8"))
    if all(current.get(key) == snapshot[key] for key in ("schedules", "departments", "assignments")):
        print(f"Public snapshot unchanged: {len(snapshot['schedules'])} schedules")
        raise SystemExit(0)
output.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Exported {len(snapshot['schedules'])} schedules to {output.name}")
