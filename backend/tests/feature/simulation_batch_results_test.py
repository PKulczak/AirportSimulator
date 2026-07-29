from django.urls import reverse
from rest_framework import status

from api.models import Aircraft, Simulation, SimulationBatch
from tests.base_test import BaseFeatureTest


class SimulationBatchResultsTest(BaseFeatureTest):
    def test_batch_results_returns_one_detail_block_per_simulation_in_batch_order(self):
        batch = SimulationBatch.objects.create(swept_variable="arrivalRatePerHour")
        first, second = self.create_simulations(
            2, status=Simulation.Status.COMPLETE, batch=batch
        )
        self.create_aircraft(simulation=first, outcome=Aircraft.Outcome.SUCCESS, was_success=True)
        self.create_aircraft(simulation=second, outcome=Aircraft.Outcome.DIVERTED)

        response = self.client.get(reverse("simulation-batch"), {"id": batch.id})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["batchId"], batch.id)
        self.assertEqual([s["id"] for s in body["simulations"]], [first.id, second.id])
        self.assertEqual(body["simulations"][0]["outcomeCounts"]["success"], 1)
        self.assertEqual(body["simulations"][1]["outcomeCounts"]["diverted"], 1)

    def test_batch_results_includes_swept_variable(self):
        batch = SimulationBatch.objects.create(swept_variable="durationMinutes")
        self.create_simulations(1, batch=batch)

        response = self.client.get(reverse("simulation-batch"), {"id": batch.id})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["sweptVariable"], "durationMinutes")

    def test_batch_results_reports_null_swept_variable_when_absent(self):
        batch = SimulationBatch.objects.create()
        self.create_simulations(1, batch=batch)

        response = self.client.get(reverse("simulation-batch"), {"id": batch.id})

        self.assertIsNone(response.json()["sweptVariable"])

    def test_batch_results_excludes_simulations_from_other_batches(self):
        batch = SimulationBatch.objects.create()
        other_batch = SimulationBatch.objects.create()
        in_batch = self.create_simulations(1, batch=batch)
        self.create_simulations(1, batch=other_batch)
        self.create_simulations(1)  # unbatched

        response = self.client.get(reverse("simulation-batch"), {"id": batch.id})

        body = response.json()
        self.assertEqual([s["id"] for s in body["simulations"]], [in_batch.id])

    def test_batch_results_requires_id_param(self):
        response = self.client.get(reverse("simulation-batch"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_batch_results_rejects_non_integer_id(self):
        response = self.client.get(reverse("simulation-batch"), {"id": "not-a-number"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_batch_results_404_for_unknown_batch(self):
        response = self.client.get(reverse("simulation-batch"), {"id": 999999})
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_sweep_creates_a_batch_whose_results_are_retrievable(self):
        runways = self.create_runways(2)
        payload = {
            "name": "Batch results sweep",
            "arrivalRatePerHour": 10,
            "departureRatePerHour": 10,
            "durationMinutes": 120,
            "maxWaitMinutes": 20,
            "includeClosures": False,
            "runways": [
                {"runwayId": runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": runways[1].id, "operatingMode": "Mixed"},
            ],
            "variable": "arrivalRatePerHour",
            "rangeEnd": 30,
            "rangeStep": 10,
        }
        sweep_response = self.client.post(
            reverse("simulation-sweep"), payload, format="json"
        )
        self.assertEqual(sweep_response.status_code, status.HTTP_201_CREATED)
        batch_id = sweep_response.json()["batchId"]

        response = self.client.get(reverse("simulation-batch"), {"id": batch_id})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["sweptVariable"], "arrivalRatePerHour")
        self.assertEqual(len(body["simulations"]), 3)
