import dramatiq
from django.urls import reverse
from rest_framework import status

from api.models import Runway, Simulation, SimulationRunway
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

    @staticmethod
    def _make_runways(count, prefix):
        return [
            Runway.objects.create(
                identifier=f"{prefix}{i}",
                heading_degrees=90,
                length_metres=3000,
                is_active=True,
            )
            for i in range(count)
        ]

    def test_create_simulation_accepts_exactly_ten_runways(self):
        runways = self._make_runways(10, "CAP10-")
        payload = self._payload(
            runways=[
                {"runwayId": runway.id, "operatingMode": "Mixed"} for runway in runways
            ]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_simulation_rejects_more_than_ten_runways(self):
        runways = self._make_runways(11, "CAP11-")
        payload = self._payload(
            runways=[
                {"runwayId": runway.id, "operatingMode": "Mixed"} for runway in runways
            ]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("runways", response.json())

    def test_create_simulation_defaults_runway_operational_status_to_available(self):
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
        self.assertEqual(statuses, {SimulationRunway.OperationalStatus.AVAILABLE})

    def test_create_simulation_persists_runway_operational_status(self):
        payload = self._payload(
            runways=[
                {
                    "runwayId": self.runways[0].id,
                    "operatingMode": "Mixed",
                    "operationalStatus": "SnowClearance",
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
        self.assertEqual(
            sr_closed.operational_status, SimulationRunway.OperationalStatus.SNOW_CLEARANCE
        )
        self.assertEqual(sr_open.operational_status, SimulationRunway.OperationalStatus.AVAILABLE)

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

    def test_create_simulation_rejects_rate_over_100(self):
        payload = self._payload(arrivalRatePerHour=101)
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("arrivalRatePerHour", response.json())

    def test_create_simulation_accepts_rate_at_exactly_100(self):
        payload = self._payload(arrivalRatePerHour=100)
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_simulation_rejects_zero_arrival_and_departure_rate(self):
        payload = self._payload(arrivalRatePerHour=0, departureRatePerHour=0)
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_allows_zero_arrival_rate_with_departures(self):
        payload = self._payload(
            arrivalRatePerHour=0,
            departureRatePerHour=10,
            runways=[
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ],
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_simulation_rejects_single_runway_with_closures_enabled(self):
        payload = self._payload(
            includeClosures=True,
            runways=[{"runwayId": self.runways[0].id, "operatingMode": "Mixed"}],
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_allows_single_runway_without_closures(self):
        payload = self._payload(
            includeClosures=False,
            runways=[{"runwayId": self.runways[0].id, "operatingMode": "Mixed"}],
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_simulation_allows_two_runways_with_closures_enabled(self):
        payload = self._payload(includeClosures=True)
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_simulation_rejects_arrival_runway_not_available(self):
        payload = self._payload(
            runways=[
                {
                    "runwayId": self.runways[0].id,
                    "operatingMode": "Mixed",
                    "operationalStatus": "EquipmentFailure",
                },
                {"runwayId": self.runways[1].id, "operatingMode": "DeparturesOnly"},
            ]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_rejects_departure_runway_not_available(self):
        payload = self._payload(
            runways=[
                {"runwayId": self.runways[0].id, "operatingMode": "ArrivalsOnly"},
                {
                    "runwayId": self.runways[1].id,
                    "operatingMode": "Mixed",
                    "operationalStatus": "SnowClearance",
                },
            ]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_allows_when_one_of_several_runways_is_available(self):
        payload = self._payload(
            runways=[
                {
                    "runwayId": self.runways[0].id,
                    "operatingMode": "Mixed",
                    "operationalStatus": "EquipmentFailure",
                },
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ]
        )
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_simulation_rejects_max_wait_over_90_percent_of_duration(self):
        payload = self._payload(durationMinutes=100, maxWaitMinutes=91)
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_simulation_allows_max_wait_at_exactly_90_percent(self):
        payload = self._payload(durationMinutes=100, maxWaitMinutes=90)
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_create_simulation_rejects_name_with_invalid_characters(self):
        payload = self._payload(name="Bad \U0001F600 emoji run")
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.json())

    def test_create_simulation_allows_name_with_basic_punctuation(self):
        payload = self._payload(name="LHR Run #3 (v2), take-two")
        response = self.client.post(reverse("simulation-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
