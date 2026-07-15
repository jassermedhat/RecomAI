from __future__ import annotations

import copy
import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, Callable

from .errors import CatalogError, MemoryError
from .models import Product


def _read_json(path: Path, error_type: type[Exception], label: str) -> Any:
    if not path.exists():
        raise error_type(f"{label} file is missing: {path}")
    try:
        with path.open("r", encoding="utf-8") as source:
            return json.load(source)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise error_type(f"{label} file cannot be read: {exc}") from exc


class JsonCatalogRepository:
    def __init__(self, path: Path):
        self.path = path

    def products(self) -> list[Product]:
        payload = _read_json(self.path, CatalogError, "Catalog")
        if not isinstance(payload, dict) or not isinstance(payload.get("products"), list):
            raise CatalogError("Catalog file must contain a 'products' array")
        try:
            return [Product.model_validate(item) for item in payload["products"]]
        except Exception as exc:
            raise CatalogError(f"Catalog contains an invalid product: {exc}") from exc

    def categories(self) -> list[str]:
        return sorted({product.category for product in self.products()}, key=str.casefold)


class JsonMemoryRepository:
    _locks_guard = threading.Lock()
    _locks: dict[Path, threading.RLock] = {}

    def __init__(self, path: Path):
        self.path = path
        lock_key = path.resolve()
        with self._locks_guard:
            self._lock = self._locks.setdefault(lock_key, threading.RLock())

    def get(self, user_id: str) -> dict[str, Any] | None:
        with self._lock:
            payload = self._load()
            buyer = payload["buyers"].get(user_id)
            return copy.deepcopy(buyer) if buyer else None

    def save(self, snapshot: dict[str, Any]) -> None:
        with self._lock:
            payload = self._load()
            payload["buyers"][snapshot["user_id"]] = snapshot
            self._atomic_write(payload)

    def all(self) -> dict[str, dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._load()["buyers"])

    def delete_interaction(self, user_id: str, transaction_id: str) -> bool:
        with self._lock:
            payload = self._load()
            buyer = payload["buyers"].get(user_id)
            if not isinstance(buyer, dict):
                return False
            interactions = buyer.get("interactions")
            if not isinstance(interactions, list):
                raise MemoryError("Stored buyer memory contains invalid interactions.")
            target_index = next(
                (
                    index
                    for index, item in enumerate(interactions)
                    if isinstance(item, dict)
                    and item.get("transaction", {}).get("transaction_id") == transaction_id
                ),
                None,
            )
            if target_index is None:
                return False
            removed = interactions.pop(target_index)
            if not interactions:
                del payload["buyers"][user_id]
                self._atomic_write(payload)
                return True

            purchased = removed.get("purchased_product", {})
            history = buyer.get("purchase_history", [])
            if not isinstance(history, list):
                raise MemoryError("Stored buyer memory contains invalid purchase history.")
            for index in range(len(history) - 1, -1, -1):
                item = history[index]
                if all(item.get(key) == purchased.get(key) for key in ("product", "category", "price")):
                    history.pop(index)
                    break

            latest = interactions[-1]
            buyer.update(
                {
                    "purchase_history": history,
                    "recommendation": latest["recommendation"],
                    "ranked_products": latest["ranked_products"],
                    "purchased_product": latest["purchased_product"],
                    "transaction": latest["transaction"],
                    "interactions": interactions,
                }
            )
            self._atomic_write(payload)
            return True

    def update(
        self,
        user_id: str,
        updater: Callable[[dict[str, Any] | None], dict[str, Any]],
    ) -> dict[str, Any]:
        """Atomically update one buyer within this repository instance."""
        with self._lock:
            payload = self._load()
            existing = payload["buyers"].get(user_id)
            snapshot = updater(copy.deepcopy(existing) if existing else None)
            if snapshot.get("user_id") != user_id:
                raise MemoryError("Memory update returned a mismatched user ID.")
            payload["buyers"][user_id] = snapshot
            self._atomic_write(payload)
            return copy.deepcopy(snapshot)

    def _load(self) -> dict[str, Any]:
        payload = _read_json(self.path, MemoryError, "Memory")
        if not isinstance(payload, dict) or not isinstance(payload.get("buyers"), dict):
            raise MemoryError("Memory file must contain a 'buyers' object")
        return payload

    def _atomic_write(self, payload: dict[str, Any]) -> None:
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", delete=False, dir=self.path.parent, suffix=".tmp"
            ) as temporary:
                json.dump(payload, temporary, ensure_ascii=False, indent=2)
                temporary.write("\n")
                temporary_path = Path(temporary.name)
            os.replace(temporary_path, self.path)
        except (OSError, TypeError, ValueError) as exc:
            raise MemoryError(f"Memory file cannot be updated: {exc}") from exc
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
