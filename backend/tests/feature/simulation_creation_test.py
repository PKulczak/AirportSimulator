import dramatiq
from django.urls import reverse
from rest_framework import status

from api.models import Simulation, SimulationRunway
from tests.base_test import BaseFeatureTest


class SimulationCreationTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        dramatiq.get_broker().flush_all()
        self.runways = self.create_runways(2)

    def _payload(self, **overrides):
        payload = {
            "name": "Morning rush",
            "arrivalRatePerHour": 20,
            "departureRatePerHour": 15,
            "durationMinutes": 120,
            "maxWaitMinutes": 20,
            "includeClosures": False,
            "runways": [
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ],
        }
        payload.update(overrides)
        return payload

    def test_create_simulation_returns_201_and_camel_case_body(self):
        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.assertIn("id", body)
        self.assertEqual(body["name"], "Morning rush")
        self.assertEqual(body["status"], Simulation.Status.PENDING)
        self.assertEqual(body["arrivalRatePerHour"], 20)
        self.assertEqual(body["departureRatePerHour"], 15)
        self.assertIn("createdAt", body)

    def test_create_simulation_persists_runways(self):
        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        simulation = Simulation.objects.get(id=response.json()["id"])
        self.assertEqual(
            SimulationRunway.objects.filter(simulation=simulation).count(), 2
        )

    def test_create_simulation_defaults_runway_operational_status_to_open(self):
        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        simulation = Simulation.objects.get(id=response.json()["id"])
        statuses = set(
            SimulationRunway.objects.filter(simulation=simulation).values_list(
                "operational_status", flat=True
            )
        )
        self.assertEqual(statuses, {SimulationRunway.OperationalStatus.OPEN})

    def test_create_simulation_persists_runway_operational_status(self):
        payload = self._payload(
            runways=[
                {
                    "runwayId": self.runways[0].id,
                    "operatingMode": "Mixed",
                    "operationalStatus": "Closed",
                },
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        simulation = Simulation.objects.get(id=response.json()["id"])
        sr_closed = SimulationRunway.objects.get(
            simulation=simulation, runway=self.runways[0]
        )
        sr_open = SimulationRunway.objects.get(
            simulation=simulation, runway=self.runways[1]
        )
        self.assertEqual(sr_closed.operational_status, SimulationRunway.OperationalStatus.CLOSED)
        self.assertEqual(sr_open.operational_status, SimulationRunway.OperationalStatus.OPEN)

    def test_create_simulation_defaults_aircraft_speed_from_settings(self):
        from django.conf import settings

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.json()["aircraftSpeedKnots"], settings.AIRCRAFT_SPEED_IN_KNOTS
        )

    def test_create_simulation_enqueues_run_simulation_task(self):
        broker = dramatiq.get_broker()
        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        queue_name = "default"
        self.assertGreaterEqual(broker.queues[queue_name].qsize(), 1)

    def test_create_simulation_requires_at_least_one_runway(self):
        response = self.client.post(
            reverse("simulation-list"), self._payload(runways=[]), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_rejects_duplicate_runway_ids(self):
        payload = self._payload(
            runways=[
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
            ]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_rejects_unknown_runway_id(self):
        payload = self._payload(
            runways=[{"runwayId": 999999, "operatingMode": "Mixed"}]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_rejects_one_directional_mismatch(self):
        # All runways ArrivalsOnly, but departureRatePerHour > 0 with no runway
        # able to accept departures.
        payload = self._payload(
            departureRatePerHour=10,
            runways=[
                {"runwayId": self.runways[0].id, "operatingMode": "ArrivalsOnly"},
                {"runwayId": self.runways[1].id, "operatingMode": "ArrivalsOnly"},
            ],
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_allows_one_directional_when_rates_match(self):
        payload = self._payload(
            arrivalRatePerHour=10,
            departureRatePerHour=10,
            runways=[
                {"runwayId": self.runways[0].id, "operatingMode": "ArrivalsOnly"},
                {"runwayId": self.runways[1].id, "operatingMode": "DeparturesOnly"},
            ],
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
