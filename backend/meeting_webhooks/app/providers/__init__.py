"""Provider registry — adding a new platform is one decorator + one class.

```python
from .base import register_provider, BaseProvider

@register_provider
class GoogleMeetProvider(BaseProvider):
    id = "google_meet"
    display_name = "Google Meet"
    ...
```

Importing this package eagerly imports every provider module so the registry
is populated at FastAPI startup. Order doesn't matter — providers are keyed
by their `id` attribute.
"""
from .base import (  # noqa: F401  (re-export)
    BaseProvider,
    ConnectInitResponse,
    RecordingEvent,
    WebhookVerification,
    register_provider,
    get_provider,
    list_providers,
)

# eager imports register the concrete providers
from . import teams  # noqa: F401
from . import zoom  # noqa: F401
