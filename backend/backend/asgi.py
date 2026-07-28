"""
ASGI config for backend project.

It exposes the ASGI callable as a module-level variable named ``application``.

Routes HTTP to the normal Django app and WebSocket to the Channels consumer that
pushes simulation status changes to the frontend. Serve with any ASGI server,
e.g. ``daphne backend.asgi:application`` or ``hypercorn backend.asgi:application``
(with ``daphne`` in INSTALLED_APPS, ``manage.py runserver`` also serves this).

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/asgi/
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")

# Initialise Django (populate the app registry) BEFORE importing anything that
# touches models/consumers, so those imports don't hit AppRegistryNotReady.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from api.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        # AllowedHostsOriginValidator rejects cross-origin socket attempts whose
        # Origin host isn't in ALLOWED_HOSTS (localhost is, for dev).
        "websocket": AllowedHostsOriginValidator(URLRouter(websocket_urlpatterns)),
    }
)
