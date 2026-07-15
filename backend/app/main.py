from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .agents import OllamaRecommendationAgent
from .config import Settings
from .errors import (
    NoProductsFoundError,
    OllamaResponseError,
    OllamaUnavailableError,
    StorageError,
)
from .models import BuyerProfile, PurchaseRequest, PurchaseResponse, RecommendationResponse
from .orchestrator import MemoryAgent, ShoppingOrchestrator
from .storage import JsonCatalogRepository, JsonMemoryRepository

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


def build_orchestrator(settings: Settings) -> ShoppingOrchestrator:
    return ShoppingOrchestrator(
        catalog=JsonCatalogRepository(settings.data_dir / "catalog.json"),
        recommendation_agent=OllamaRecommendationAgent(settings.ollama_url, settings.ollama_model),
        memory_agent=MemoryAgent(JsonMemoryRepository(settings.data_dir / "memory.json")),
    )


def create_app(orchestrator: ShoppingOrchestrator | None = None, settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_environment()
    app = FastAPI(title="AI Shopping Assistant", version="2.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )
    app.state.orchestrator = orchestrator or build_orchestrator(settings)
    app.state.settings = settings

    def get_orchestrator() -> ShoppingOrchestrator:
        return app.state.orchestrator

    def run_workflow(buyer: BuyerProfile, service: ShoppingOrchestrator) -> RecommendationResponse:
        try:
            return service.process(buyer)
        except OllamaUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except OllamaResponseError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        except NoProductsFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except StorageError as exc:
            logger.exception("Local storage failure")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/sample-buyers", response_model=list[BuyerProfile])
    def sample_buyers() -> list[BuyerProfile]:
        path: Path = app.state.settings.data_dir / "sample_buyers.json"
        try:
            with path.open("r", encoding="utf-8") as source:
                payload = json.load(source)
            samples = [BuyerProfile.model_validate(item) for item in payload["buyers"]]
            return [app.state.orchestrator.memory_agent.recall(buyer) for buyer in samples]
        except StorageError as exc:
            logger.exception("Sample buyer memory failure")
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except (OSError, json.JSONDecodeError, KeyError, ValidationError) as exc:
            logger.exception("Sample buyer file failure")
            raise HTTPException(status_code=500, detail=f"Sample buyer data is unavailable: {exc}") from exc

    @app.get("/api/catalog/categories", response_model=list[str])
    def catalog_categories() -> list[str]:
        try:
            return app.state.orchestrator.catalog.categories()
        except StorageError as exc:
            logger.exception("Catalog category failure")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    def memory_repository() -> JsonMemoryRepository:
        return app.state.orchestrator.memory_agent.repository

    @app.get("/api/buyers")
    def buyers() -> list[dict]:
        samples = {buyer.user_id: buyer for buyer in sample_buyers()}
        try:
            stored = memory_repository().all()
        except StorageError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        user_ids = sorted(set(samples) | set(stored), key=str.casefold)
        result = []
        for user_id in user_ids:
            saved = stored.get(user_id, {})
            if user_id in samples:
                history = [item.model_dump() for item in samples[user_id].history]
            else:
                history = saved.get("purchase_history")
                if not isinstance(history, list):
                    history = []
            prices = [float(item["price"]) for item in history]
            categories: dict[str, int] = {}
            for item in history:
                category = item["category"]
                categories[category] = categories.get(category, 0) + 1
            favorite = max(categories, key=lambda item: (categories[item], item)) if categories else None
            result.append(
                {
                    "user_id": user_id,
                    "purchase_history": history,
                    "purchase_count": len(history),
                    "interaction_count": len(saved.get("interactions", [])),
                    "average_spending": round(sum(prices) / len(prices), 2) if prices else 0,
                    "favorite_category": favorite,
                    "is_sample": user_id in samples,
                }
            )
        return result

    @app.get("/api/history")
    def history() -> list[dict]:
        try:
            buyers_payload = memory_repository().all()
        except StorageError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        records = []
        for user_id, buyer in buyers_payload.items():
            interactions = buyer.get("interactions", [])
            if not isinstance(interactions, list):
                raise HTTPException(status_code=500, detail="Stored buyer memory contains invalid interactions.")
            for interaction in interactions:
                transaction = interaction.get("transaction", {})
                records.append(
                    {
                        "user_id": user_id,
                        "recommendation": interaction.get("recommendation"),
                        "ranked_products": interaction.get("ranked_products", []),
                        "purchased_product": interaction.get("purchased_product"),
                        "transaction": transaction,
                        "recommendation_metrics": interaction.get("recommendation_metrics"),
                    }
                )
        return sorted(records, key=lambda item: item["transaction"].get("purchased_at", ""), reverse=True)

    @app.get("/api/system-info")
    def system_info() -> dict:
        agent = app.state.orchestrator.recommendation_agent
        ollama_ready = isinstance(agent, OllamaRecommendationAgent) and agent.is_ready()
        return {
            "version": app.version,
            "ollama_model": settings.ollama_model,
            "ollama_ready": ollama_ready,
            "memory_type": "Local JSON memory",
            "memory_location": str(settings.data_dir / "memory.json"),
        }

    @app.delete("/api/history/{user_id}/{transaction_id}", status_code=204)
    def delete_history(user_id: str, transaction_id: str) -> Response:
        try:
            deleted = memory_repository().delete_interaction(user_id, transaction_id)
        except StorageError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="History interaction was not found.")
        return Response(status_code=204)

    @app.post("/api/shopping/process", response_model=RecommendationResponse)
    def process_buyer(
        buyer: BuyerProfile, service: ShoppingOrchestrator = Depends(get_orchestrator)
    ) -> RecommendationResponse:
        return run_workflow(buyer, service)

    @app.post("/api/shopping/upload", response_model=RecommendationResponse)
    async def upload_buyer(
        file: UploadFile = File(...), service: ShoppingOrchestrator = Depends(get_orchestrator)
    ) -> RecommendationResponse:
        if not file.filename or not file.filename.lower().endswith(".json"):
            raise HTTPException(status_code=422, detail="Upload a JSON buyer profile file.")
        try:
            content = await file.read(settings.max_upload_bytes + 1)
            if len(content) > settings.max_upload_bytes:
                raise HTTPException(status_code=413, detail="Buyer JSON file is too large.")
            payload = json.loads(content.decode("utf-8"))
            buyer = BuyerProfile.model_validate(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as exc:
            raise HTTPException(status_code=422, detail=f"Invalid buyer JSON: {exc}") from exc
        return run_workflow(buyer, service)

    @app.post("/api/shopping/purchase", response_model=PurchaseResponse)
    def purchase_product(
        request: PurchaseRequest, service: ShoppingOrchestrator = Depends(get_orchestrator)
    ) -> PurchaseResponse:
        try:
            return service.purchase(request)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except StorageError as exc:
            logger.exception("Local storage failure")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return app


app = create_app()
