"""Websocket status-notification pipeline (Slice 1.4).

Covers the two halves independently:
  * the runner emits a status event on each transition, and
  * the consumer/channel-layer delivers such an event to a connected client.
Uses the in-memory channel layer (see tests/settings_test.py) — no Redis or
running ASGI server required.
"""

import json

import pytest
from asgiref.sync import async_to_sync
from asgiref.testing import ApplicationCommunicator
from channels.layers import get_channel_layer

from api.consumers import SimulationStatusConsumer
from api.models import Simulation, SimulationRunway
from api.notifications import STATUS_MESSAGE_TYPE, simulation_group
from api.simulation import simulation_runner as runner_module
from api.simulation.simulation_runner import SimulationRunner
from tests.base_test import BaseFeatureTest

# NB: `channels.testing` (WebsocketCommunicator) can't be imported here — its
# package __init__ pulls in daphne, which isn't installed in this environment.
# We drive the consumer with asgiref's ApplicationCommunicator directly instead.


def _record_published(monkeypatch):
    """Replace the runner's publish call with a recorder; returns the list of
    (id, status-string) tuples it captures."""
    calls = []
    monkeypatch.setattr(
        runner_module,
        "publish_simulation_status",
        lambda sim_id, status: calls.append((sim_id, str(status))),
    )
    return calls


@pytest.mark.django_db
def test_runner_publishes_running_then_complete(monkeypatch):
    calls = _record_published(monkeypatch)
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(1, random_seed=1)
    helper.create_simulation_runway(simulation=simulation, runway=runway)

    SimulationRunner().run(simulation.id)

    assert calls == [
        (simulation.id, str(Simulation.Status.RUNNING)),
        (simulation.id, str(Simulation.Status.COMPLETE)),
    ]


@pytest.mark.django_db
def test_runner_publishes_error_status_on_failure(monkeypatch):
    calls = _record_published(monkeypatch)
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(1, random_seed=1)
    helper.create_simulation_runway(simulation=simulation, runway=runway)

    def boom(self, simulation):
        raise ValueError("engine exploded")

    monkeypatch.setattr(SimulationRunner, "_execute", boom)

    SimulationRunner().run(simulation.id)

    # Running is announced before the failure, then Error — never left silent.
    assert calls == [
        (simulation.id, str(Simulation.Status.RUNNING)),
        (simulation.id, str(Simulation.Status.ERROR)),
    ]


def test_channel_layer_delivers_status_to_subscribed_group():
    """The per-simulation group name + message shape a publisher uses reaches a
    subscriber. All ops share one event loop to avoid cross-loop layer issues."""
    sim_id = 4242

    async def scenario():
        layer = get_channel_layer()
        channel = await layer.new_channel()
        await layer.group_add(simulation_group(sim_id), channel)
        await layer.group_send(
            simulation_group(sim_id),
            {"type": STATUS_MESSAGE_TYPE, "id": sim_id, "status": "Complete"},
        )
        return await layer.receive(channel)

    message = async_to_sync(scenario)()
    assert message["type"] == STATUS_MESSAGE_TYPE
    assert message["id"] == sim_id
    assert message["status"] == "Complete"


@pytest.mark.django_db(transaction=True)
def test_consumer_forwards_status_to_websocket_client():
    """A client connected to ws/simulations/<id>/ receives a status message
    fanned out to that simulation's group, as id + status only.

    (`transaction=True`: channels runs the sync consumer in a worker thread and
    calls close_old_connections(), which needs DB access allowed in that thread.)
    """
    sim_id = 99

    async def scenario():
        # Scope mirrors what URLRouter would inject (url_route kwargs) for the
        # per-simulation route, so the consumer joins that simulation's group.
        scope = {
            "type": "websocket",
            "path": f"/ws/simulations/{sim_id}/",
            "headers": [],
            "subprotocols": [],
            "url_route": {"args": (), "kwargs": {"simulation_id": sim_id}},
        }
        communicator = ApplicationCommunicator(
            SimulationStatusConsumer.as_asgi(), scope
        )
        await communicator.send_input({"type": "websocket.connect"})
        accept = await communicator.receive_output(timeout=2)
        assert accept["type"] == "websocket.accept"

        await get_channel_layer().group_send(
            simulation_group(sim_id),
            {"type": STATUS_MESSAGE_TYPE, "id": sim_id, "status": "Running"},
        )
        sent = await communicator.receive_output(timeout=2)
        await communicator.send_input({"type": "websocket.disconnect", "code": 1000})
        return sent

    sent = async_to_sync(scenario)()
    assert sent["type"] == "websocket.send"
    # Consumer forwards only id + status (not the internal message `type`).
    assert json.loads(sent["text"]) == {"id": sim_id, "status": "Running"}
