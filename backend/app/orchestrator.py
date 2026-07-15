from __future__ import annotations

import statistics
import time
from datetime import UTC, datetime
from typing import Any

from .agents import PurchaseAgent, RankingAgent, RecommendationAgent, SearchAgent
from .errors import MemoryError
from .models import (
    BuyerProfile,
    HistoryItem,
    MemorySnapshot,
    PurchaseRequest,
    PurchaseResponse,
    RecommendationMetrics,
    RecommendationResponse,
)
from .storage import JsonCatalogRepository, JsonMemoryRepository


class MemoryAgent:
    def __init__(self, repository: JsonMemoryRepository):
        self.repository = repository

    def recall(self, buyer: BuyerProfile) -> BuyerProfile:
        """Merge persisted purchases into the submitted profile without duplicating its prefix."""
        existing = self.repository.get(buyer.user_id)
        if not existing:
            return buyer
        stored = self._stored_history(existing)
        history = self._merge_history(list(buyer.history), stored)
        return BuyerProfile(user_id=buyer.user_id, history=history)

    @classmethod
    def _merge_history(
        cls, incoming: list[HistoryItem], stored: list[HistoryItem]
    ) -> list[HistoryItem]:
        stored_keys = [cls._history_key(item) for item in stored]
        incoming_keys = [cls._history_key(item) for item in incoming]
        if incoming_keys == stored_keys[: len(incoming_keys)]:
            return list(stored)
        if stored_keys == incoming_keys[: len(stored_keys)]:
            return list(incoming)
        history = list(stored)
        remaining = list(stored_keys)
        for item, key in zip(incoming, incoming_keys):
            if key in remaining:
                remaining.remove(key)
            else:
                history.append(item)
        return history

    @staticmethod
    def _stored_history(existing: dict[str, Any] | None) -> list[HistoryItem]:
        if not existing:
            return []
        try:
            return [HistoryItem.model_validate(item) for item in existing["purchase_history"]]
        except (KeyError, TypeError, ValueError) as exc:
            raise MemoryError("Stored buyer memory contains invalid purchase history.") from exc

    @staticmethod
    def _history_key(item: HistoryItem) -> tuple[str, str, float]:
        return (item.product.casefold(), item.category.casefold(), item.price)

    def update(
        self, buyer: BuyerProfile, recommendation, ranked_products, purchase, metrics=None
    ) -> MemorySnapshot:
        result: MemorySnapshot | None = None

        def build_snapshot(existing: dict[str, Any] | None) -> dict[str, Any]:
            nonlocal result
            history = self._merge_history(
                list(buyer.history), self._stored_history(existing)
            )
            history.append(
                HistoryItem(
                    product=purchase.product.product,
                    category=purchase.product.category,
                    price=purchase.product.price,
                )
            )
            interaction: dict[str, Any] = {
                "recommendation": recommendation.model_dump(),
                "ranked_products": [product.model_dump() for product in ranked_products],
                "purchased_product": purchase.product.model_dump(),
                "transaction": purchase.model_dump(mode="json"),
            }
            if metrics is not None:
                interaction["recommendation_metrics"] = metrics.model_dump(mode="json")
            saved_interactions = (existing or {}).get("interactions", [])
            if not isinstance(saved_interactions, list) or not all(
                isinstance(item, dict) for item in saved_interactions
            ):
                raise MemoryError("Stored buyer memory contains invalid interactions.")
            interactions = list(saved_interactions)
            interactions.append(interaction)
            result = MemorySnapshot(
                user_id=buyer.user_id,
                purchase_history=history,
                recommendation=recommendation,
                ranked_products=ranked_products,
                purchased_product=purchase.product,
                transaction=purchase,
                interactions=interactions,
            )
            return result.model_dump(mode="json")

        self.repository.update(buyer.user_id, build_snapshot)
        if result is None:  # pragma: no cover - repository always invokes the updater
            raise MemoryError("Memory update did not produce a snapshot.")
        return result


class ShoppingOrchestrator:
    def __init__(
        self,
        catalog: JsonCatalogRepository,
        recommendation_agent: RecommendationAgent,
        memory_agent: MemoryAgent,
        search_agent: SearchAgent | None = None,
        ranking_agent: RankingAgent | None = None,
        purchase_agent: PurchaseAgent | None = None,
    ):
        self.catalog = catalog
        self.recommendation_agent = recommendation_agent
        self.memory_agent = memory_agent
        self.search_agent = search_agent or SearchAgent()
        self.ranking_agent = ranking_agent or RankingAgent()
        self.purchase_agent = purchase_agent or PurchaseAgent()

    def process(self, buyer: BuyerProfile) -> RecommendationResponse:
        products = self.catalog.products()
        buyer = self.memory_agent.recall(buyer)
        categories = sorted({product.category for product in products}, key=str.casefold)
        recommendation_started = time.perf_counter()
        recommendation = self.recommendation_agent.recommend(buyer, categories)
        thinking_duration_ms = max(0, round((time.perf_counter() - recommendation_started) * 1000))
        matches = self.search_agent.search(products, recommendation.category)
        ranked_products = self.ranking_agent.rank(matches, buyer.history)
        metrics = self._recommendation_metrics(
            buyer, recommendation.category, ranked_products, thinking_duration_ms
        )
        warnings = []
        if len(ranked_products) < 3:
            warnings.append(f"Only {len(ranked_products)} matching product(s) were available.")
        return RecommendationResponse(
            message="Recommendation ready. Choose a product to purchase.",
            buyer=buyer,
            recommendation=recommendation,
            ranked_products=ranked_products,
            recommendation_metrics=metrics,
            warnings=warnings,
        )

    def purchase(self, request: PurchaseRequest) -> PurchaseResponse:
        ranked_ids = {product.product_id for product in request.ranked_products}
        if request.product_id not in ranked_ids:
            raise ValueError("Choose a product from the current recommendation.")
        catalog_products = {product.product_id: product for product in self.catalog.products()}
        selected_product = catalog_products.get(request.product_id)
        if selected_product is None:
            raise ValueError("The selected product is no longer available in the catalog.")
        purchase = self.purchase_agent.purchase(request.buyer, selected_product)
        memory = self.memory_agent.update(
            request.buyer,
            request.recommendation,
            request.ranked_products,
            purchase,
            request.recommendation_metrics,
        )
        return PurchaseResponse(
            message=f"Simulated purchase successful: {selected_product.product}.",
            selected_product=selected_product,
            purchase=purchase,
            memory=memory,
        )

    @staticmethod
    def _recommendation_metrics(
        buyer: BuyerProfile, category: str, products, thinking_duration_ms: int
    ) -> RecommendationMetrics:
        previous_categories = {item.category.casefold() for item in buyer.history}
        confidence = 65
        if not buyer.history or category.casefold() not in previous_categories:
            confidence += 10
        if len(products) >= 3:
            confidence += 10
        if buyer.history:
            confidence += 10
        confidence = min(confidence, 95)

        scores: dict[str, int] = {}
        if buyer.history:
            target_price = statistics.fmean(item.price for item in buyer.history)
            for product in products:
                distance_ratio = abs(product.price - target_price) / max(target_price, 1)
                scores[product.product_id] = max(0, round(100 * (1 - distance_ratio)))
        return RecommendationMetrics(
            confidence=confidence,
            generated_at=datetime.now(UTC),
            thinking_duration_ms=thinking_duration_ms,
            product_match_scores=scores,
            confidence_basis=(
                "Engineering score based on category novelty, buyer-history signal, "
                "and catalog match availability; product price matches are percentage "
                "closeness to the buyer's historical mean price."
            ),
        )
