"""Websocket status notifications.

The dramatiq worker running a simulation calls `publish_simulation_status` on
each status transition; connected websocket clients (see `api.consumers`) are
grouped per-simulation and globally, and receive the change so the frontend can
refresh without polling.

Delivery is strictly best-effort: notifications must never affect simulation
correctness. If no channel layer is configured or the broker is unreachable, we
log and move on — the frontend's polling fallback still reflects the change.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)

# All status changes fan out to this group (the history list subscribes here)…
GLOBAL_GROUP = "simulations"


def simulation_group(simulation_id):
    """…and to a per-simulation group (the detail/visualisation pages subscribe here)."""
    return f"simulation_{simulation_id}"


# Group-message `type` -> consumer handler `status_update` (dots become underscores).
STATUS_MESSAGE_TYPE = "status.update"


def publish_simulation_status(simulation_id, status):
    """Push a simulation's new status to the global and per-simulation groups."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    message = {
        "type": STATUS_MESSAGE_TYPE,
        "id": int(simulation_id),
        "status": str(status),
    }
    try:
        send = async_to_sync(channel_layer.group_send)
        send(GLOBAL_GROUP, message)
        send(simulation_group(simulation_id), message)
    except Exception:  # noqa: BLE001 - a failed notification must not fail the run.
        logger.exception(
            "Failed to publish websocket status for simulation %s", simulation_id
        )
