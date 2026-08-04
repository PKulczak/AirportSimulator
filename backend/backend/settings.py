"""
Django settings for backend project.
"""

from pathlib import Path

import environ

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = env("SECRET_KEY", default="django-insecure-9)du_@0o+@+z2u+1*44&d+1#ot+wzb+l1-m=#3zfk-vk&=p-!%")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = env("DEBUG")

ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "channels",
    "django_dramatiq",
    "api",
]

# `daphne` must sit at the very top of INSTALLED_APPS so its ASGI-capable
# runserver replaces Django's WSGI dev server (websockets need ASGI). The import
# is guarded: the ASGI server dependency is optional at import time, so a missing
# `daphne` never breaks the WSGI dev server or the test suite — only live
# websockets need an ASGI server, and any one works against `backend.asgi`
# (e.g. `daphne backend.asgi:application` or `hypercorn backend.asgi:application`).
try:
    import daphne  # noqa: F401

    INSTALLED_APPS.insert(0, "daphne")
except ImportError:
    pass

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "backend.wsgi.application"
ASGI_APPLICATION = "backend.asgi.application"


# Database
# https://docs.djangoproject.com/en/5.1/ref/settings/#databases

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DATABASE_NAME", default="airportdb"),
        "USER": env("DATABASE_USER", default="postgres"),
        "PASSWORD": env("DATABASE_PASSWORD", default="postgres"),
        "HOST": env("DATABASE_HOST", default="localhost"),
        "PORT": env("DATABASE_PORT", default="5432"),
    }
}


# Password validation
# https://docs.djangoproject.com/en/5.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.1/topics/i18n/

LANGUAGE_CODE = "en-us"

TIME_ZONE = "UTC"

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.1/howto/static-files/

STATIC_URL = "static/"

# Default primary key field type
# https://docs.djangoproject.com/en/5.1/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# CORS
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:3000"])


# Logging
LOG_LEVEL = env("LOG_LEVEL", default="INFO")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": LOG_LEVEL,
    },
}


# Django REST Framework
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": (
        "djangorestframework_camel_case.render.CamelCaseJSONRenderer",
    ),
    "DEFAULT_PARSER_CLASSES": (
        "djangorestframework_camel_case.parser.CamelCaseJSONParser",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 10,
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework.authentication.TokenAuthentication",
        # Only ever actually used via the Django admin / browsable API — the
        # frontend's axios instance never sends session cookies (no
        # `withCredentials`), so this never fires for real SPA traffic.
        "rest_framework.authentication.SessionAuthentication",
    ),
    # Gated by REQUIRE_AUTH (see api.permissions) rather than a flat
    # IsAuthenticated — see Slice 9.1 in nextSteps.md: auth is wired end to
    # end but every endpoint stays open by default until REQUIRE_AUTH is
    # explicitly turned on for a deployment.
    "DEFAULT_PERMISSION_CLASSES": (
        "api.permissions.IsAuthenticatedUnlessAuthDisabled",
    ),
    # Only LoginView (and the Slice B.2 register/password-reset views) opt
    # into this (via ScopedRateThrottle/throttle_scope) — deliberately not a
    # blanket DEFAULT_THROTTLE_CLASSES, since most of the API is meant to
    # stay fully open traffic-wise while REQUIRE_AUTH is off. These are the
    # endpoints that call Django's authenticate()/create a user/send mail
    # from caller-supplied input on every request, so they're the ones that
    # need a brute-force/spam guard regardless of REQUIRE_AUTH. The guarantee
    # is only real across a multi-worker deployment because CACHES (see
    # below) is Redis-backed rather than Django's per-process default.
    "DEFAULT_THROTTLE_RATES": {
        "login": env("LOGIN_THROTTLE_RATE", default="10/min"),
        # Slice B.2 — same brute-force/spam reasoning as "login", guarding
        # self-serve signup and password-reset-request respectively.
        "register": env("REGISTER_THROTTLE_RATE", default="5/hour"),
        "password_reset": env("PASSWORD_RESET_THROTTLE_RATE", default="5/hour"),
    },
}

# Slice 9.1 — Authentication. False by default so existing dev/CI workflows
# (and every other test in this suite) keep working unauthenticated; flip to
# True once the frontend login flow has been confirmed end to end and at
# least one real user exists to log in as (Django has no self-serve signup —
# provision users via `manage.py createsuperuser` or the admin).
REQUIRE_AUTH = env.bool("REQUIRE_AUTH", default=False)

# Slice C.2 — caps how many Pending/Running runs one authenticated user can
# have queued at once (across single-run *and* sweep creation combined),
# guarding the shared dramatiq queue/worker capacity against one user
# repeatedly queuing more work than it can ever drain, one legitimately-sized
# request at a time — the per-request caps (MAX_RUNWAYS, MAX_SWEEP_RUNS, the
# duration cap) only bound a single request, not the total in flight across
# many. Set comfortably above MAX_SWEEP_RUNS (see
# simulation_sweep_creation_dto.py) so a single full-size sweep always fits
# for a user starting from zero. Anonymous requests (no REQUIRE_AUTH, no
# owner to scope by) are exempt, same precedent as ownership scoping itself.
MAX_IN_FLIGHT_SIMULATIONS_PER_USER = env.int(
    "MAX_IN_FLIGHT_SIMULATIONS_PER_USER", default=100
)

JSON_CAMEL_CASE = {
    "RENDERER_CLASS": "rest_framework.renderers.JSONRenderer",
    "PARSER_CLASS": "rest_framework.parsers.JSONParser",
}


# dramatiq / django-dramatiq
QUEUE_BROKER = env("QUEUE_BROKER", default="dramatiq.brokers.redis.RedisBroker")
QUEUE_URL = env("QUEUE_URL", default="redis://localhost:6379/0")

DRAMATIQ_BROKER = {
    "BROKER": QUEUE_BROKER,
    "OPTIONS": {
        "url": QUEUE_URL,
    },
    "MIDDLEWARE": [
        "dramatiq.middleware.AgeLimit",
        "dramatiq.middleware.TimeLimit",
        "dramatiq.middleware.Callbacks",
        "dramatiq.middleware.Retries",
        "django_dramatiq.middleware.DbConnectionsMiddleware",
    ],
}


# Channels (websockets) — status push to the frontend.
# Cross-process: the dramatiq worker that runs a simulation pushes status
# transitions to websocket clients connected to the web server, so the channel
# layer must be Redis-backed (in-memory only works within a single process).
# Reuses the dramatiq Redis instance by default; override with CHANNEL_LAYER_URL.
CHANNEL_LAYER_URL = env("CHANNEL_LAYER_URL", default=QUEUE_URL)

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [CHANNEL_LAYER_URL]},
    },
}


# Cache (Slice C.1). Backs DRF's throttles — most notably the login/register/
# password-reset rate limits above, which are only a real guarantee if every
# gunicorn/daphne worker process in a deployment shares one counter; Django's
# un-configured default (LocMemCache) is per-process, so each worker would
# otherwise enforce its own independent limit, silently multiplying the
# effective rate by the worker count. Reuses the dramatiq/channels Redis
# instance by default (one more dependency would be redundant); override with
# CACHE_URL to point it elsewhere (e.g. a separate Redis db/instance).
# Uses Django's own built-in Redis backend (available since Django 4.0) —
# no extra package beyond `redis`, already a transitive dependency of
# dramatiq[redis]/channels-redis.
CACHE_URL = env("CACHE_URL", default=QUEUE_URL)

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": CACHE_URL,
        "KEY_PREFIX": "airport",
    }
}


# Simulation engine defaults
AIRCRAFT_SPEED_IN_KNOTS = env.int("AIRCRAFT_SPEED_IN_KNOTS", default=140)


# Email (Slice B.2 — password reset). Defaults to Django's console backend
# (prints to stdout) so dev/CI never needs real SMTP creds; point
# EMAIL_BACKEND at django.core.mail.backends.smtp.EmailBackend (plus the
# EMAIL_HOST_* vars below) for a real deployment that actually delivers mail.
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=25)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="noreply@airport-modelling.local")

# Slice B.2 — base URL of the deployed frontend SPA, used only to build the
# link inside a password-reset email (the backend has no page of its own to
# send someone to). Defaults to the local Vite dev server.
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", default="http://localhost:3000")
