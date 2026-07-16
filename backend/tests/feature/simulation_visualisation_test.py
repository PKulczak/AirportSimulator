from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from api.models import Aircraft, AircraftEvent, SimulationRunwayEvent
from tests.base_test import BaseFeatureTest


class SimulationVisualisationTest(BaseFeatureTest):
    def test_visualisation_full_timeline_round_trip(self):
        simulation = self.create_simulations(1)
        runway = self.create_runways(1)[0]
        simulation_runway = self.create_simulation_runway(
            simulation=simulation, runway=runway
        )
        now = timezone.now()

        early = self.create_aircraft(
            simulation=simulation,
            runway=runway,
            scheduled_time=now,
            outcome=Aircraft.Outcome.SUCCESS,
        )
        late = self.create_aircraft(
            simulation=simulation,
            scheduled_time=now + timezone.timedelta(minutes=30),
            outcome=Aircraft.Outcome.PENDING,
        )
        self.create_aircraft_event(
            aircraft=early,
            event_type=AircraftEvent.EventType.LOW_FUEL,
            occurred_at=now,
            priority_boost=2,
        )
        self.create_runway_event(
            simulation_runway=simulation_runway,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
        )

        response = self.client.get(
            reverse("simulation-visualisation", kwargs={"pk": simulation.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()

        self.assertEqual(len(body["aircraft"]), 2)
        # Ordered by scheduledTime.
        self.assertEqual(body["aircraft"][0]["id"], early.id)
        self.assertEqual(body["aircraft"][1]["id"], late.id)

        first_aircraft = body["aircraft"][0]
        self.assertEqual(len(first_aircraft["events"]), 1)
        self.assertEqual(first_aircraft["events"][0]["eventType"], "LowFuel")
        self.assertEqual(first_aircraft["events"][0]["priorityBoost"], 2)
        self.assertEqual(first_aircraft["runwayId"], runway.id)

        self.assertEqual(len(body["runways"]), 1)
        runway_body = body["runways"][0]
        self.assertEqual(runway_body["identifier"], runway.identifier)
        self.assertEqual(len(runway_body["closureEvents"]), 1)
        self.assertEqual(runway_body["closureEvents"][0]["eventType"], "Closed")

    def test_visualisation_404_for_unknown_simulation(self):
        response = self.client.get(
            reverse("simulation-visualisation", kwargs={"pk": 999999})
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
