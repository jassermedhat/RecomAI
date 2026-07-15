class ShoppingAssistantError(Exception):
    """Base exception for all application-specific errors."""


class StorageError(ShoppingAssistantError):
    """Raised when persistent storage cannot be accessed or updated."""


class CatalogError(StorageError):
    """Raised when the product catalog is invalid or unavailable."""


class MemoryError(StorageError):
    """Raised when buyer memory cannot be read or written."""


class OllamaUnavailableError(ShoppingAssistantError):
    """Raised when the Ollama service cannot be reached."""


class OllamaResponseError(ShoppingAssistantError):
    """Raised when Ollama returns an invalid or unexpected response."""


class NoProductsFoundError(ShoppingAssistantError):
    """Raised when no products match the search criteria."""