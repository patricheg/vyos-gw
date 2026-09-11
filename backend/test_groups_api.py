"""Smoke-test firewall address groups against the live router.

Stages a group + a rule referencing it, verifies validation, then removes
everything from the staging area — nothing is committed on the router.
"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def staged():
    return client.get("/api/staged/").json()


def cleanup(ids_before):
    for c in staged():
        if c["id"] not in ids_before:
            client.delete(f"/api/staged/{c['id']}")


def main():
    before = {c["id"] for c in staged()}
    try:
        r = client.get("/api/firewall/groups")
        assert r.status_code == 200, r.text
        print("groups on router:", [g["name"] for g in r.json()])

        # validation
        r = client.post("/api/firewall/groups", json={"name": "bad name!", "addresses": ["10.0.0.1"]})
        assert r.status_code == 400, r.text
        print("bad name rejected:", r.json()["detail"])
        r = client.post("/api/firewall/groups", json={"name": "ok", "addresses": ["999.1.1.1"]})
        assert r.status_code == 400, r.text
        print("bad address rejected:", r.json()["detail"])

        # stage a group
        r = client.post("/api/firewall/groups", json={
            "name": "test-net",
            "description": "smoke test",
            "addresses": ["10.99.0.0/24", "192.168.99.5", "172.16.99.10-172.16.99.20"],
        })
        assert r.status_code == 200, r.text
        print("staged group:", r.json())

        # stage a rule using the group
        r = client.post("/api/firewall/chains/input/rules", json={
            "number": 999, "action": "accept", "protocol": "tcp",
            "source_group": "test-net", "destination_port": "22",
        })
        assert r.status_code == 200, r.text
        print("staged rule with group")

        # group referenced by a staged rule — delete must be refused? (usage check looks at committed rules only)
        r = client.delete("/api/firewall/groups/test-net")
        print("delete group while only staged:", r.status_code, r.json().get("detail") or r.json())

        # address + group together must be rejected
        r = client.post("/api/firewall/chains/input/rules", json={
            "number": 998, "action": "accept", "source_address": "10.0.0.0/8", "source_group": "test-net",
        })
        assert r.status_code == 400, r.text
        print("address+group rejected:", r.json()["detail"])

        print("staged commands:")
        for c in staged():
            if c["id"] not in before:
                print("  ", c["command"])
    finally:
        cleanup(before)
        assert {c["id"] for c in staged()} == before
        print("staging area cleaned")


if __name__ == "__main__":
    main()
