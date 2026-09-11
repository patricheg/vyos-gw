"""Smoke-test the /api/routes endpoints against the live router.

Stages a test route and removes it from the staging area afterwards —
nothing is committed on the router.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def staged_ids():
    return {c["id"] for c in client.get("/api/staged/").json()}


def cleanup(ids_before):
    for c in client.get("/api/staged/").json():
        if c["id"] not in ids_before:
            client.delete(f"/api/staged/{c['id']}")


def main():
    before = staged_ids()
    try:
        r = client.get("/api/routes/table")
        assert r.status_code == 200, r.text
        table = r.json()
        print(f"routing table: {len(table)} entries")
        for e in table[:5]:
            nh = ", ".join(n["ip"] or n["interface"] or "?" for n in e["nexthops"])
            print(f"  {e['prefix']:<20} {e['protocol']:<10} -> {nh} [{e['distance']}/{e['metric']}] installed={e['installed']}")

        r = client.get("/api/routes/static")
        assert r.status_code == 200, r.text
        print(f"static routes: {[x['prefix'] for x in r.json()]}")

        # validation errors must be rejected before staging
        r = client.post("/api/routes/static", json={"prefix": "bogus", "next_hops": [{"address": "10.0.0.1"}]})
        assert r.status_code == 400, r.text
        print("bad prefix rejected:", r.json()["detail"])
        r = client.post("/api/routes/static", json={"prefix": "192.168.0.0/24", "next_hops": [{"address": "999.0.0.1"}]})
        assert r.status_code == 400, r.text
        print("bad next-hop rejected:", r.json()["detail"])

        # stage a real route, then delete-stage, then clean up
        r = client.post("/api/routes/static", json={
            "prefix": "203.0.113.0/24",
            "description": "test route",
            "next_hops": [{"address": "10.11.12.1", "distance": 5}],
        })
        assert r.status_code == 200, r.text
        print("staged add:", r.json())

        r = client.put("/api/routes/static/203.0.113.0/24/disabled", json={"disabled": True})
        assert r.status_code == 200, r.text
        print("staged disable:", r.json())

        r = client.delete("/api/routes/static/0.0.0.0/0")
        assert r.status_code == 200, r.text
        print("staged delete:", r.json())

        staged = [c["command"] for c in client.get("/api/staged/").json() if c["id"] not in before]
        print("staged commands:")
        for c in staged:
            print("  ", c)
    finally:
        cleanup(before)
        after = staged_ids()
        assert after == before, f"staging not cleaned: {after - before}"
        print("staging area cleaned")


if __name__ == "__main__":
    main()
