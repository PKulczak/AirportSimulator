from backend.settings import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

DRAMATIQ_BROKER = {
    "BROKER": "dramatiq.brokers.stub.StubBroker",
    "OPTIONS": {},
    "MIDDLEWARE": [
        "dramatiq.middleware.AgeLimit",
        "dramatiq.middleware.TimeLimit",
        "dramatiq.middleware.Callbacks",
        "dramatiq.middleware.Retries",
    ],
}

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# In-process channel layer for tests: exercises the websocket publish/consume
# path (single process) without needing a running Redis or ASGI server.
CHANNEL_LAYERS = {
    "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
}

# Pinned rather than inherited from backend.settings's env.bool() read of the
# developer's actual backend/.env — otherwise the test suite's pass/fail
# depends on whatever REQUIRE_AUTH happens to be set to on disk locally.
# Individual tests opt into REQUIRE_AUTH=True via override_settings.
REQUIRE_AUTH = False
