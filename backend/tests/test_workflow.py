import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agents import OllamaRecommendationAgent, RankingAgent, SearchAgent
from app.config import Settings
from app.errors import MemoryError, NoProductsFoundError, OllamaResponseError, OllamaUnavailableError
from app.main import create_app
from app.models import BuyerProfile, Product, Recommendation
from app.orchestrator import MemoryAgent, ShoppingOrchestrator
from app.storage import JsonCatalogRepository, JsonMemoryRepository


class FixedRecommendationAgent:
    def __init__(self, category="fitness_technology"):
        self.category = category

    def recommend(self, buyer, categories):
        return Recommendation(category=self.category, reason="A focused recommendation based on buyer history.")


class FailingRecommendationAgent:
    def __init__(self, error):
        self.error = error

    def recommend(self, buyer, categories):
        raise self.error


class MemoryAwareRecommendationAgent:
    def __init__(self):
        self.history_lengths = []

    def recommend(self, buyer, categories):
        self.history_lengths.append(len(buyer.history))
        previous = {item.category for item in buyer.history}
        category = "outdoor" if "fitness_technology" in previous else "fitness_technology"
        return Recommendation(category=category, reason="Uses accumulated buyer memory.")


@pytest.fixture
def data_dir(tmp_path):
    source = Path(__file__).resolve().parents[1] / "data"
    for name in ("catalog.json", "sample_buyers.json"):
        (tmp_path / name).write_text((source / name).read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "memory.json").write_text('{"buyers": {}}\n', encoding="utf-8")
    return tmp_path


def make_client(data_dir, agent=None, max_upload_bytes=1_000_000):
    settings = Settings(
        data_dir=data_dir,
        ollama_url="http://unused",
        ollama_model="test",
        max_upload_bytes=max_upload_bytes,
    )
    service = ShoppingOrchestrator(
        catalog=JsonCatalogRepository(data_dir / "catalog.json"),
        recommendation_agent=agent or FixedRecommendationAgent(),
        memory_agent=MemoryAgent(JsonMemoryRepository(data_dir / "memory.json")),
    )
    return TestClient(create_app(orchestrator=service, settings=settings))


def buyer_payload():
    return {
        "user_id": "A123",
        "history": [
            {"product": "Bluetooth headphones", "category": "electronics", "price": 120},
            {"product": "Running shoes", "category": "sportswear", "price": 80},
        ],
    }


def purchase_payload(recommendation, product_id="FT-102"):
    return {
        "buyer": recommendation["buyer"],
        "recommendation": recommendation["recommendation"],
        "ranked_products": recommendation["ranked_products"],
        "recommendation_metrics": recommendation["recommendation_metrics"],
        "product_id": product_id,
    }


def test_processes_buyer_without_purchasing_then_purchases_selected_product(data_dir):
    response = make_client(data_dir).post("/api/shopping/process", json=buyer_payload())

    assert response.status_code == 200
    body = response.json()
    assert body["recommendation"]["category"] == "fitness_technology"
    assert [item["product_id"] for item in body["ranked_products"]] == ["FT-102", "FT-101", "FT-103"]
    assert body["recommendation_metrics"]["confidence"] == 95
    assert body["recommendation_metrics"]["product_match_scores"]["FT-102"] == 95
    assert json.loads((data_dir / "memory.json").read_text(encoding="utf-8"))["buyers"] == {}

    purchase = make_client(data_dir).post(
        "/api/shopping/purchase", json=purchase_payload(body, "FT-101")
    )
    assert purchase.status_code == 200
    completed = purchase.json()
    assert completed["selected_product"]["product_id"] == "FT-101"
    assert completed["purchase"]["status"] == "simulated_success"
    assert completed["memory"]["purchase_history"][-1]["product"] == "PulseTrack Fitness Watch"
    memory = json.loads((data_dir / "memory.json").read_text(encoding="utf-8"))
    assert memory["buyers"]["A123"]["transaction"]["transaction_id"] == completed["purchase"]["transaction_id"]


def test_reuses_saved_purchase_history_on_the_next_request(data_dir):
    agent = MemoryAwareRecommendationAgent()
    client = make_client(data_dir, agent)

    first = client.post("/api/shopping/process", json=buyer_payload())
    assert client.post("/api/shopping/purchase", json=purchase_payload(first.json())).status_code == 200
    second = client.post("/api/shopping/process", json=buyer_payload())

    assert first.status_code == 200
    assert second.status_code == 200
    assert agent.history_lengths == [2, 3]
    assert second.json()["recommendation"]["category"] == "outdoor"
    assert "memory" not in second.json()

    recalled_sample = client.get("/api/sample-buyers").json()
    recalled_a123 = next(item for item in recalled_sample if item["user_id"] == "A123")
    assert len(recalled_a123["history"]) == 3
    assert recalled_a123["history"][-1]["product"] == "Stride GPS Band"


def test_validates_invalid_price_and_missing_fields(data_dir):
    invalid_price = {"user_id": "A123", "history": [{"product": "x", "category": "x", "price": -1}]}
    assert make_client(data_dir).post("/api/shopping/process", json=invalid_price).status_code == 422
    assert make_client(data_dir).post("/api/shopping/process", json={"user_id": "A123"}).status_code == 422


def test_upload_and_sample_endpoints(data_dir):
    client = make_client(data_dir)
    samples = client.get("/api/sample-buyers")
    assert samples.status_code == 200
    assert len(samples.json()) == 8
    categories = client.get("/api/catalog/categories")
    assert categories.status_code == 200
    assert categories.json() == sorted(
        {product.category for product in JsonCatalogRepository(data_dir / "catalog.json").products()},
        key=str.casefold,
    )
    upload = client.post(
        "/api/shopping/upload",
        files={"file": ("buyer.json", json.dumps(buyer_payload()), "application/json")},
    )
    assert upload.status_code == 200
    bad_upload = client.post(
        "/api/shopping/upload",
        files={"file": ("buyer.txt", "{}", "text/plain")},
    )
    assert bad_upload.status_code == 422

    oversized = make_client(data_dir, max_upload_bytes=10).post(
        "/api/shopping/upload",
        files={"file": ("buyer.json", json.dumps(buyer_payload()), "application/json")},
    )
    assert oversized.status_code == 413


def test_catalog_and_sample_buyers_include_high_price_electronics(data_dir):
    products = JsonCatalogRepository(data_dir / "catalog.json").products()
    electronics = [product for product in products if product.category == "electronics"]
    assert [product.product_id for product in electronics] == ["EL-1001", "EL-1002", "EL-1003"]
    assert all(product.price >= 900 for product in electronics)

    samples = make_client(data_dir).get("/api/sample-buyers").json()
    updated = {buyer["user_id"]: buyer for buyer in samples}
    assert any(item["product"] == "VisionMax 65-inch 4K Smart TV" for item in updated["B456"]["history"])
    assert any(item["product"] == "Apex Pro 5G Smartphone" for item in updated["D204"]["history"])
    assert any(item["product"] == "StudioBook OLED Laptop" for item in updated["F808"]["history"])


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (OllamaUnavailableError("Ollama is unavailable."), 503),
        (OllamaResponseError("Invalid Ollama response."), 502),
    ],
)
def test_returns_clear_ollama_errors_without_purchase(data_dir, error, status):
    response = make_client(data_dir, FailingRecommendationAgent(error)).post(
        "/api/shopping/process", json=buyer_payload()
    )
    assert response.status_code == status
    assert response.json()["detail"] == str(error)
    assert json.loads((data_dir / "memory.json").read_text(encoding="utf-8"))["buyers"] == {}


def test_search_no_match_ranking_ties_and_fewer_than_three_results():
    products = [
        Product(product_id="B", product="B", category="target", price=105),
        Product(product_id="A", product="A", category="target", price=105),
    ]
    history = BuyerProfile.model_validate({"user_id": "x", "history": [{"product": "old", "category": "old", "price": 100}]}).history
    assert [item.product_id for item in RankingAgent().rank(products, history)] == ["A", "B"]
    assert len(RankingAgent().rank(products, [])) == 2
    with pytest.raises(NoProductsFoundError):
        SearchAgent().search(products, "missing")


def test_recommendation_priority_is_stable_diverse_and_excludes_bought_categories():
    categories = ["creative_hobbies", "outdoor", "personal_care", "sportswear", "smart_home"]
    first = BuyerProfile.model_validate(buyer_payload())
    second = BuyerProfile.model_validate({**buyer_payload(), "user_id": "B456"})

    first_priority = OllamaRecommendationAgent._diversity_priority(first, categories)
    assert first_priority == OllamaRecommendationAgent._diversity_priority(first, categories)
    assert "sportswear" not in first_priority
    assert set(first_priority) == set(categories) - {"sportswear"}
    assert first_priority == sorted(first_priority, key=str.casefold)
    assert first_priority == OllamaRecommendationAgent._diversity_priority(second, categories)


def test_recommendation_retries_a_category_outside_the_allowed_choices(monkeypatch):
    buyer = BuyerProfile.model_validate(buyer_payload())
    categories = ["creative_hobbies", "electronics", "fitness_technology", "outdoor", "personal_care"]
    agent = OllamaRecommendationAgent("http://unused", "test")
    allowed = agent._diversity_priority(buyer, categories)
    responses = iter(
        [
            Recommendation(category="electronics", reason="Invalid repeated category."),
            Recommendation(
                category=allowed[0],
                reason=f"Running shoes from sportswear support the {allowed[0]} category.",
            ),
        ]
    )
    calls = []

    def fake_request(prompt, schema):
        calls.append((prompt.copy(), schema))
        return next(responses)

    monkeypatch.setattr(agent, "_request_recommendation", fake_request)
    recommendation = agent.recommend(buyer, categories)

    assert recommendation.category == allowed[0]
    assert len(calls) == 2
    assert calls[0][0]["buyer_history"] == [item.model_dump() for item in buyer.history]
    assert calls[0][0]["previous_categories"] == ["electronics", "sportswear"]
    assert calls[0][0]["catalog_categories"] == allowed
    assert calls[0][1]["properties"]["category"]["enum"] == allowed
    assert "justify the recommendation in natural language" in calls[0][0]["instruction"]
    assert "do not invent purchases" in calls[0][0]["instruction"].lower()
    assert "previous response was rejected" in calls[1][0]["correction"].lower()


@pytest.mark.parametrize(
    "invalid_reason",
    [
        "A kitchen category would be useful.",
        "The {category} category is not directly relevant but is an option.",
    ],
)
def test_recommendation_retries_invalid_justification(monkeypatch, invalid_reason):
    buyer = BuyerProfile.model_validate(buyer_payload())
    categories = ["creative_hobbies", "electronics", "fitness_technology", "outdoor"]
    agent = OllamaRecommendationAgent("http://unused", "test")
    selected = agent._diversity_priority(buyer, categories)[0]
    responses = iter(
        [
            Recommendation(
                category=selected,
                reason=invalid_reason.format(category=selected),
            ),
            Recommendation(
                category=selected,
                reason=f"Running shoes from sportswear support the {selected} category.",
            ),
        ]
    )
    monkeypatch.setattr(agent, "_request_recommendation", lambda prompt, schema: next(responses))

    recommendation = agent.recommend(buyer, categories)

    assert recommendation.category == selected
    assert selected in recommendation.reason


def test_recommendation_reuses_most_used_category_when_all_categories_are_exhausted(monkeypatch):
    buyer = BuyerProfile.model_validate({
        "user_id": "FULL",
        "history": [
            {"product": "Phone", "category": "electronics", "price": 500},
            {"product": "TV", "category": "electronics", "price": 900},
            {"product": "Shoes", "category": "sportswear", "price": 80},
        ],
    })
    agent = OllamaRecommendationAgent("http://unused", "test")
    calls = []

    def fake_request(prompt, schema):
        calls.append(prompt.copy())
        return Recommendation(
            category="electronics",
            reason="Phone and TV purchases make electronics the buyer's most-used category.",
        )

    monkeypatch.setattr(agent, "_request_recommendation", fake_request)

    recommendation = agent.recommend(buyer, ["electronics", "sportswear"])

    assert recommendation.category == "electronics"
    assert calls[0]["catalog_categories"] == ["electronics"]
    assert calls[0]["recommendation_mode"] == "reuse_most_used"


def test_empty_history_requires_an_honest_exploratory_reason(monkeypatch):
    buyer = BuyerProfile(user_id="NEW", history=[])
    agent = OllamaRecommendationAgent("http://unused", "test")
    responses = iter([
        Recommendation(category="outdoor", reason="The buyer previously enjoyed travel products, so outdoor fits."),
        Recommendation(category="outdoor", reason="With no prior purchase history, outdoor is an exploratory category."),
    ])
    monkeypatch.setattr(agent, "_request_recommendation", lambda prompt, schema: next(responses))

    recommendation = agent.recommend(buyer, ["outdoor", "personal_care"])

    assert recommendation.category == "outdoor"
    assert "no prior purchase history" in recommendation.reason.lower()


def test_corrupted_memory_is_reported(data_dir):
    (data_dir / "memory.json").write_text("not-json", encoding="utf-8")
    with pytest.raises(MemoryError):
        JsonMemoryRepository(data_dir / "memory.json").get("A123")


def test_portfolio_read_endpoints_include_legacy_records(data_dir):
    client = make_client(data_dir)
    recommendation = client.post("/api/shopping/process", json=buyer_payload()).json()
    assert client.post("/api/shopping/purchase", json=purchase_payload(recommendation)).status_code == 200

    buyers = client.get("/api/buyers")
    history = client.get("/api/history")
    info = client.get("/api/system-info")

    assert buyers.status_code == 200
    assert next(item for item in buyers.json() if item["user_id"] == "A123")["interaction_count"] == 1
    assert history.status_code == 200
    assert history.json()[0]["recommendation_metrics"]["confidence"] == 95
    assert info.json() == {
        "version": "2.0.0",
        "ollama_model": "test",
        "ollama_ready": False,
        "memory_type": "Local JSON memory",
        "memory_location": str(data_dir / "memory.json"),
    }


def test_deletes_one_interaction_and_rebuilds_latest_snapshot(data_dir):
    agent = MemoryAwareRecommendationAgent()
    client = make_client(data_dir, agent)
    first_recommendation = client.post("/api/shopping/process", json=buyer_payload()).json()
    first = client.post("/api/shopping/purchase", json=purchase_payload(first_recommendation)).json()
    second_recommendation = client.post("/api/shopping/process", json=buyer_payload()).json()
    second = client.post("/api/shopping/purchase", json=purchase_payload(second_recommendation, "OD-302")).json()

    deleted = client.delete(f'/api/history/A123/{second["purchase"]["transaction_id"]}')
    assert deleted.status_code == 204
    payload = json.loads((data_dir / "memory.json").read_text(encoding="utf-8"))["buyers"]["A123"]
    assert payload["transaction"]["transaction_id"] == first["purchase"]["transaction_id"]
    assert len(payload["interactions"]) == 1
    assert len(payload["purchase_history"]) == 3
    assert client.delete("/api/history/A123/missing").status_code == 404


def test_deleting_final_interaction_removes_persisted_buyer(data_dir):
    client = make_client(data_dir)
    recommendation = client.post("/api/shopping/process", json=buyer_payload()).json()
    transaction = client.post("/api/shopping/purchase", json=purchase_payload(recommendation)).json()["purchase"]
    assert client.delete(f'/api/history/A123/{transaction["transaction_id"]}').status_code == 204
    assert "A123" not in json.loads((data_dir / "memory.json").read_text(encoding="utf-8"))["buyers"]


def test_rejects_purchase_outside_current_recommendation(data_dir):
    client = make_client(data_dir)
    recommendation = client.post("/api/shopping/process", json=buyer_payload()).json()
    response = client.post(
        "/api/shopping/purchase", json=purchase_payload(recommendation, "OD-301")
    )
    assert response.status_code == 422
    assert json.loads((data_dir / "memory.json").read_text(encoding="utf-8"))["buyers"] == {}
