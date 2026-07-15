from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class HistoryItem(BaseModel):
    product: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=100)
    price: float = Field(ge=0)

    @field_validator("product", "category")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("price")
    @classmethod
    def finite_price(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("must be a finite number")
        return value


class BuyerProfile(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    history: list[HistoryItem]

    @field_validator("user_id")
    @classmethod
    def strip_user_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class Product(HistoryItem):
    product_id: str = Field(min_length=1, max_length=100)
    features: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    category: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("category", "reason")
    @classmethod
    def strip_response_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class RecommendationMetrics(BaseModel):
    confidence: int = Field(ge=0, le=100)
    generated_at: datetime
    thinking_duration_ms: int = Field(ge=0)
    product_match_scores: dict[str, int] = Field(default_factory=dict)
    confidence_basis: str


class Purchase(BaseModel):
    transaction_id: str
    user_id: str
    product: Product
    status: str = "simulated_success"
    purchased_at: datetime


class MemorySnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    purchase_history: list[HistoryItem]
    recommendation: Recommendation
    ranked_products: list[Product]
    purchased_product: Product
    transaction: Purchase
    interactions: list[dict[str, Any]] = Field(default_factory=list)


class RecommendationResponse(BaseModel):
    message: str
    buyer: BuyerProfile
    recommendation: Recommendation
    ranked_products: list[Product]
    recommendation_metrics: RecommendationMetrics
    warnings: list[str] = Field(default_factory=list)


class PurchaseRequest(BaseModel):
    buyer: BuyerProfile
    recommendation: Recommendation
    ranked_products: list[Product] = Field(min_length=1)
    recommendation_metrics: RecommendationMetrics
    product_id: str = Field(min_length=1, max_length=100)


class PurchaseResponse(BaseModel):
    message: str
    selected_product: Product
    purchase: Purchase
    memory: MemorySnapshot
