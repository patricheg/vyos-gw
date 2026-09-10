import asyncio
import uuid
from typing import List, Dict
from pydantic import BaseModel


class StagedChange(BaseModel):
    id: str
    command: str
    description: str
    category: str  # 'interfaces', 'firewall', etc.


class StagingArea:
    def __init__(self):
        self._changes: List[StagedChange] = []

    def add(self, command: str, description: str, category: str = "general") -> StagedChange:
        change = StagedChange(
            id=str(uuid.uuid4())[:8],
            command=command,
            description=description,
            category=category,
        )
        self._changes.append(change)
        return change

    def list(self) -> List[StagedChange]:
        return self._changes.copy()

    def remove(self, change_id: str) -> bool:
        for i, c in enumerate(self._changes):
            if c.id == change_id:
                self._changes.pop(i)
                return True
        return False

    def clear(self):
        self._changes.clear()

    def commit(self, vyos_client) -> str:
        if not self._changes:
            return "No changes to commit"
        commands = [c.command for c in self._changes]
        result = vyos_client.exec_config(commands)
        self._changes.clear()
        return result

    def discard(self):
        self._changes.clear()

    def is_empty(self) -> bool:
        return len(self._changes) == 0

    def count(self) -> int:
        return len(self._changes)


staging_area = StagingArea()
