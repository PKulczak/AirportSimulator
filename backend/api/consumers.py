"""Websocket consumer for simulation status updates.

A client connecting to ``ws/simulations/`` joins the global group and receives
every simulation's status changes (used by the history list). Connecting to
``ws/simulations/<id>/`` joins that simulation's group only (used by the detail
and visualisation pages). The runner fans out via `api.notifications`.

The socket is push-only — it never reads client messages; the frontend still
loads data over the REST API and just treats a pushed message as "refetch now".
"""

from asgiref.sync import async_to_sync
from channels.generic.websocket import JsonWebsocketConsumer

from api.notifications import GLOBAL_GROUP, simulation_group


class SimulationStatusConsumer(JsonWebsocketConsumer):
    def connect(self):
        simulation_id = self.scope["url_route"]["kwargs"].get("simulation_id")
        self.group_name = (
            simulation_group(simulation_id)
            if simulation_id is not None
            else GLOBAL_GROUP
        )
        async_to_sync(self.channel_layer.group_add)(self.group_name, self.channel_name)
        self.accept()

    def disconnect(self, code):
        group_name = getattr(self, "group_name", None)
        if group_name:
            async_to_sync(self.channel_layer.group_discard)(
                group_name, self.channel_name
            )

    def status_update(self, event):
        """Handler for group messages of type ``status.update``."""
        self.send_json({"id": event["id"], "status": event["status"]})
