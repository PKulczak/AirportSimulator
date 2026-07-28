from django.urls import reverse
from rest_framework import status

from api.models import Simulation
from api.simulation.simulation_runner import SimulationRunner
from tests.base_test import BaseFeatureTest


class SimulationRerunTest(BaseFeatureTest):
    """End-to-end cover for Slice 3.2's contract: reconstructing a completed
    run's config from its detail response (with the fixed seed and each
    runway's *initial* status) and re-running it reproduces identical metrics.
    Mirrors the frontend's `detailToRerunRequest` + POST flow."""

    def setUp(self):
        super().setUp()
        self.runways = self.create_runways(2)

    def _create_and_run(self, payload):
        response = self.client.post(
            reverse("simulation-list"), payload, format="json"
        )
        self.assertEqual(
            response.status_code, status.HTTP_201_CREATED, response.content
        )
        sim_id = response.json()["id"]
        # create only enqueues; run the engine synchronously here.
        SimulationRunner().run(sim_id)
        return sim_id

    def _detail(self, sim_id):
        response = self.client.get(reverse("simulation-detail", kwargs={"pk": sim_id}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.json()

    @staticmethod
    def _rerun_payload_from_detail(detail):
        # The Python mirror of frontend `detailToRerunRequest`: same config,
        # fixed seed, and each runway's INITIAL status (not the end-of-run one).
        return {
            "name": f"{detail['name']} (re-run)",
            "arrivalRatePerHour": detail["arrivalRatePerHour"],
            "departureRatePerHour": detail["departureRatePerHour"],
            "durationMinutes": detail["durationMinutes"],
            "maxWaitMinutes": detail["maxWaitMinutes"],
            "aircraftSpeedKnots": detail["aircraftSpeedKnots"],
            "includeClosures": detail["includeClosures"],
            "randomSeed": detail["randomSeed"],
            "runways": [
                {
                    "runwayId": rs["runwayId"],
                    "operatingMode": rs["operatingMode"],
                    "operationalStatus": rs["initialOperationalStatus"],
                }
                for rs in detail["runwayStats"]
            ],
        }

    def test_rerun_with_same_seed_reproduces_identical_metrics(self):
        # Closures on + a runway that starts closed (SnowClearance), so the
        # re-run has to restore the *initial* status, not the mutated one.
        payload = {
            "name": "Repro run",
            "arrivalRatePerHour": 40,
            "departureRatePerHour": 40,
            "durationMinutes": 90,
            "maxWaitMinutes": 15,
            "includeClosures": True,
            "randomSeed": 20260728,
            "runways": [
                {
                    "runwayId": self.runways[0].id,
                    "operatingMode": "Mixed",
                    "operationalStatus": "SnowClearance",
                },
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ],
        }

        first_id = self._create_and_run(payload)
        first = self._detail(first_id)

        second_id = self._create_and_run(self._rerun_payload_from_detail(first))
        second = self._detail(second_id)

        self.assertNotEqual(first_id, second_id)
        self.assertEqual(first["randomSeed"], second["randomSeed"])
        self.assertGreater(first["outcomeCounts"]["total"], 0)
        self.assertEqual(first["outcomeCounts"], second["outcomeCounts"])
        self.assertEqual(first["successRate"], second["successRate"])
        self.assertEqual(first["closureEventCount"], second["closureEventCount"])

    def test_rerun_without_seed_defaults_to_random(self):
        # A run with no seed round-trips as null; the (optional) re-run then has
        # no fixed seed either — the frontend only offers re-run when a seed exists.
        payload = {
            "name": "No seed run",
            "arrivalRatePerHour": 20,
            "departureRatePerHour": 20,
            "durationMinutes": 60,
            "maxWaitMinutes": 15,
            "includeClosures": False,
            "runways": [
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
            ],
        }
        sim_id = self._create_and_run(payload)
        detail = self._detail(sim_id)
        self.assertIsNone(detail["randomSeed"])
        sim = Simulation.objects.get(id=sim_id)
        self.assertIsNone(sim.random_seed)
