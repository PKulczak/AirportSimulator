"""Websocket URL routing (parallel to `api.urls` for HTTP)."""

from django.urls import path

from api.consumers import SimulationStatusConsumer

websocket_urlpatterns = [
    # Global feed: every simulation's status changes (history list).
    path("ws/simulations/", SimulationStatusConsumer.as_asgi()),
    # Per-simulation feed (detail / visualisation pages).
    path("ws/simulations/<int:simulation_id>/", SimulationStatusConsumer.as_asgi()),
]
