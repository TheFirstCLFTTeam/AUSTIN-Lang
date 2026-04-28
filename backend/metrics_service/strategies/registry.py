from typing import Dict, List, Type

from .base import MetricStrategy

_REGISTRY: Dict[str, MetricStrategy] = {}


def register_strategy(cls: Type[MetricStrategy]) -> Type[MetricStrategy]:
    name = getattr(cls, "name", None)
    if not name:
        raise ValueError(f"{cls.__name__} must set a non-empty `name` class attribute")
    if name in _REGISTRY:
        raise ValueError(f"Strategy {name!r} is already registered")
    _REGISTRY[name] = cls()
    return cls


def get_strategy(name: str) -> MetricStrategy:
    try:
        return _REGISTRY[name]
    except KeyError as err:
        known = ", ".join(sorted(_REGISTRY)) or "<none>"
        raise KeyError(f"Unknown strategy {name!r}. Known: {known}") from err


def list_strategies() -> List[str]:
    return sorted(_REGISTRY)
