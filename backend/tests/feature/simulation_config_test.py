from rest_framework import status

from api.models import Simulation
from tests.base_test import BaseFeatureTest


def _config_url(simulation_id):
    return f"/api/simulations/{simulation_id}/config/"


class SimulationConfigTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        self.runways = self.create_runways(2)

    def _create_payload(self, **overrides):
        payload = {
            "name": "Config source",
            "arrivalRatePerHour": 25,
            "departureRatePerHour": 18,
            "durationMinutes": 120,
            "maxWaitMinutes": 20,
            "includeClosures": True,
            "randomSeed": 4242,
            "runways": [
                {
                    "runwayId": self.runways[0].id,
                    "operatingMode": "ArrivalsOnly",
                    "operationalStatus": "SnowClearance",
                },
                {
                    "runwayId": self.runways[1].id,
                    "operatingMode": "Mixed",
                    "operationalStatus": "Available",
                },
            ],
        }
        payload.update(overrides)
        return payload

    def test_config_exposes_all_create_fields(self):
        create = self.client.post(
            "/api/simulations/", self._create_payload(), format="json"
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.content)
        sim_id = create.json()["id"]

        response = self.client.get(_config_url(sim_id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()

        self.assertEqual(body["name"], "Config source")
        self.assertEqual(body["arrivalRatePerHour"], 25)
        self.assertEqual(body["departureRatePerHour"], 18)
        self.assertEqual(body["durationMinutes"], 120)
        self.assertEqual(body["maxWaitMinutes"], 20)
        self.assertEqual(body["includeClosures"], True)
        self.assertEqual(body["randomSeed"], 4242)
        self.assertIn("aircraftSpeedKnots", body)

        runways = {r["runwayId"]: r for r in body["runways"]}
        self.assertEqual(
            runways[self.runways[0].id]["operatingMode"], "ArrivalsOnly"
        )
        self.assertEqual(
            runways[self.runways[0].id]["operationalStatus"], "SnowClearance"
        )
        self.assertEqual(runways[self.runways[1].id]["operatingMode"], "Mixed")
        self.assertEqual(
            runways[self.runways[1].id]["operationalStatus"], "Available"
        )

    def test_config_round_trips_back_into_create(self):
        # The core slice guarantee: config output is directly usable as create
        # input, and a run built from it has an identical config.
        create = self.client.post(
            "/api/simulations/", self._create_payload(), format="json"
        )
        source_id = create.json()["id"]
        source_config = self.client.get(_config_url(source_id)).json()

        # Re-submit the fetched config verbatim (the frontend's Duplicate flow).
        clone_payload = {k: v for k, v in source_config.items() if k != "id"}
        clone = self.client.post("/api/simulations/", clone_payload, format="json")
        self.assertEqual(clone.status_code, status.HTTP_201_CREATED, clone.content)
        clone_id = clone.json()["id"]

        clone_config = self.client.get(_config_url(clone_id)).json()

        self.assertNotEqual(source_id, clone_id)
        # Everything but the id must match, including the runway list.
        source_no_id = {k: v for k, v in source_config.items() if k != "id"}
        clone_no_id = {k: v for k, v in clone_config.items() if k != "id"}
        self.assertEqual(source_no_id, clone_no_id)

    def test_config_reports_initial_status_not_end_of_run_closure(self):
        # A runway left closed by a trailing run closure must still report its
        # initial (Available) status, so a clone reproduces the start config.
        from django.utils import timezone

        from api.models import SimulationRunway, SimulationRunwayEvent

        started_at = timezone.now()
        simulation = self.create_simulations(
            1, status=Simulation.Status.COMPLETE, started_at=started_at
        )
        sr = self.create_simulation_runway(
            simulation=simulation,
            runway=self.runways[0],
            operational_status=SimulationRunway.OperationalStatus.EQUIPMENT_FAILURE,
        )
        self.create_runway_event(
            simulation_runway=sr,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=started_at + timezone.timedelta(minutes=30),
        )

        response = self.client.get(_config_url(simulation.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.json()["runways"][0]["operationalStatus"], "Available"
        )

    def test_config_404_for_unknown_simulation(self):
        response = self.client.get(_config_url(999999))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_config_exposes_a_custom_weight_class_mix(self):
        create = self.client.post(
            "/api/simulations/",
            self._create_payload(
                heavyPercentage=30, mediumPercentage=50, lightPercentage=20
            ),
            format="json",
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED, create.content)
        sim_id = create.json()["id"]

        response = self.client.get(_config_url(sim_id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["heavyPercentage"], 30)
        self.assertEqual(body["mediumPercentage"], 50)
        self.assertEqual(body["lightPercentage"], 20)
