from __future__ import annotations

import json
import statistics
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from typing import Protocol

from .errors import NoProductsFoundError, OllamaResponseError, OllamaUnavailableError
from .models import BuyerProfile, Product, Purchase, Recommendation


def normalized(value: str) -> str:
    return value.strip().casefold()


class RecommendationAgent(Protocol):
    def recommend(self, buyer: BuyerProfile, categories: list[str]) -> Recommendation: ...


class OllamaRecommendationAgent:
    """Uses Ollama only for history analysis, category choice, and reasoning."""

    def __init__(self, base_url: str, model: str, timeout_seconds: int = 45):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds

    def is_ready(self) -> bool:
        request = urllib.request.Request(f"{self.base_url}/api/tags", method="GET")
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
            return False
        available = {
            model.get("name") or model.get("model")
            for model in payload.get("models", [])
            if isinstance(model, dict)
        }
        return self.model in available

    def recommend(self, buyer: BuyerProfile, categories: list[str]) -> Recommendation:
        diversity_priority = self._diversity_priority(buyer, categories)
        if not diversity_priority:
            raise OllamaResponseError(
                "No new catalog category is available for this buyer."
            )
        previous = {normalized(item.category) for item in buyer.history}
        reuse_favorite = normalized(diversity_priority[0]) in previous
        prompt = {
            "buyer_id": buyer.user_id,
            "buyer_history": [item.model_dump() for item in buyer.history],
            "previous_categories": sorted(
                {item.category for item in buyer.history}, key=str.casefold
            ),
            "catalog_categories": diversity_priority,
            "recommendation_mode": "reuse_most_used" if reuse_favorite else "new_category",
            "history_status": "available" if buyer.history else "empty",
            "instruction": (
                "You, the LLM, must analyze the products, categories, and prices in buyer_history. "
                "Recommend exactly one product category from catalog_categories. In new_category mode these "
                "are local catalog categories not present in previous_categories. In reuse_most_used mode the "
                "buyer has exhausted every catalog category, so recommend the single supplied most-used category. "
                "The order of catalog_categories carries "
                "no preference or ranking signal. Select the category with the strongest concrete support in "
                "buyer_history; being new by itself is not a justification. Do not default "
                "to personal_care or creative_hobbies without a concrete supporting history signal. Return "
                "only JSON with keys category and reason. In reason, justify the recommendation in natural "
                "language using only facts present in buyer_history, and explicitly name the selected "
                "category exactly as written. Do not invent purchases or interests. If history_status is empty, "
                "explicitly say there is no prior purchase history and that the choice is exploratory; do not "
                "claim that the buyer previously purchased, preferred, or showed interest in anything."
            ),
        }
        schema = Recommendation.model_json_schema()
        schema["properties"]["category"]["enum"] = diversity_priority
        last_error: OllamaResponseError | None = None
        for attempt in range(2):
            if attempt:
                prompt["correction"] = (
                    f"The previous response was rejected: {last_error}. "
                    "Choose one category exactly as written in catalog_categories and use only evidence "
                    "that appears verbatim in buyer_history."
                )
            recommendation = self._request_recommendation(prompt, schema)
            try:
                self._validate_recommendation(recommendation, buyer, diversity_priority)
                return recommendation
            except OllamaResponseError as exc:
                last_error = exc
        raise last_error or OllamaResponseError("Ollama could not produce a valid recommendation.")

    def _request_recommendation(self, prompt: dict, schema: dict) -> Recommendation:
        payload = {
            "model": self.model,
            "stream": False,
            "format": schema,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a careful personalized shopping recommendation agent.",
                },
                {"role": "user", "content": json.dumps(prompt)},
            ],
        }
        request = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise OllamaUnavailableError(
                f"Ollama could not run model '{self.model}': {exc.reason}."
            ) from exc
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            raise OllamaUnavailableError(
                f"Ollama is unavailable at {self.base_url}. Start Ollama and pull {self.model}."
            ) from exc
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise OllamaResponseError("Ollama returned a non-JSON response.") from exc

        try:
            content = body["message"]["content"]
            recommendation = Recommendation.model_validate_json(content)
        except (KeyError, TypeError, ValueError) as exc:
            raise OllamaResponseError(
                "Ollama returned an invalid recommendation; expected JSON with category and reason."
            ) from exc
        return recommendation

    @staticmethod
    def _diversity_priority(buyer: BuyerProfile, categories: list[str]) -> list[str]:
        """Return unbiased new choices, or the buyer's most-used catalog category if exhausted."""
        previous = {normalized(item.category) for item in buyer.history}
        eligible = sorted(
            (category for category in categories if normalized(category) not in previous),
            key=str.casefold,
        )
        if eligible:
            return eligible

        category_map = {normalized(category): category for category in categories}
        counts: dict[str, int] = {}
        last_seen: dict[str, int] = {}
        for index, item in enumerate(buyer.history):
            key = normalized(item.category)
            if key in category_map:
                counts[key] = counts.get(key, 0) + 1
                last_seen[key] = index
        if not counts:
            return []
        favorite = max(counts, key=lambda key: (counts[key], last_seen[key]))
        return [category_map[favorite]]

    @staticmethod
    def _validate_recommendation(
        recommendation: Recommendation, buyer: BuyerProfile, categories: list[str]
    ) -> None:
        category_map = {normalized(category): category for category in categories}
        recommended = normalized(recommendation.category)
        if recommended not in category_map:
            raise OllamaResponseError("Ollama recommended a category that is not in the local catalog.")
        previous = {normalized(item.category) for item in buyer.history}
        unseen = set(category_map) - previous
        if unseen and recommended in previous:
            raise OllamaResponseError("Ollama recommended a category already present in buyer history.")
        recommendation.category = category_map[recommended]
        category_name = normalized(recommendation.category).replace("_", " ")
        reason = normalized(recommendation.reason).replace("_", " ")
        if category_name not in reason:
            raise OllamaResponseError(
                "Ollama reasoning did not explain the selected recommendation category."
            )
        contradictions = (
            "not relevant",
            "not directly relevant",
            "unrelated",
            "no relation",
            "no connection",
            "merely because it is new",
            "since it is an option",
        )
        if any(phrase in reason for phrase in contradictions):
            raise OllamaResponseError(
                "Ollama reasoning contradicted the selected recommendation category."
            )
        if not buyer.history:
            honest_empty_history = (
                "no prior purchase history",
                "no previous purchase history",
                "no purchase history",
                "new buyer",
            )
            if not any(phrase in reason for phrase in honest_empty_history):
                raise OllamaResponseError(
                    "Ollama reasoning invented evidence for a buyer with no purchase history."
                )
            return

        evidence_text = reason.replace(category_name, " ")
        evidence_terms = {
            normalized(value).replace("_", " ")
            for item in buyer.history
            for value in (item.product, item.category)
        }
        if not any(term in evidence_text for term in evidence_terms):
            raise OllamaResponseError(
                "Ollama reasoning did not cite a product or category from buyer history."
            )


class SearchAgent:
    def search(self, products: list[Product], category: str) -> list[Product]:
        matches = [product for product in products if normalized(product.category) == normalized(category)]
        if not matches:
            raise NoProductsFoundError(f"No products found for recommended category '{category}'.")
        return matches


class RankingAgent:
    """Ranks products by historical-average-price distance, then lower price and ID."""

    def rank(self, products: list[Product], history: list[Product | object]) -> list[Product]:
        prices = [item.price for item in history]
        if prices:
            target_price = statistics.fmean(prices)
            ranked = sorted(
                products,
                key=lambda product: (abs(product.price - target_price), product.price, product.product_id),
            )
        else:
            ranked = sorted(products, key=lambda product: (product.price, product.product_id))
        return ranked[:3]


class PurchaseAgent:
    def purchase(self, buyer: BuyerProfile, product: Product) -> Purchase:
        return Purchase(
            transaction_id=f"SIM-{uuid.uuid4().hex[:12].upper()}",
            user_id=buyer.user_id,
            product=product,
            purchased_at=datetime.now(UTC),
        )
