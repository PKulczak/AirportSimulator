from django.urls import reverse
from rest_framework import status

from api.models import Simulation, SimulationBatch
from tests.base_test import BaseFeatureTest


class SimulationListTest(BaseFeatureTest):
    def test_list_returns_paginated_results(self):
        self.create_simulations(15)

        response = self.client.get(reverse("simulation-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn("count", body)
        self.assertIn("next", body)
        self.assertIn("previous", body)
        self.assertIn("results", body)
        self.assertEqual(body["count"], 15)
        self.assertEqual(len(body["results"]), 10)  # PAGE_SIZE = 10

    def test_list_second_page(self):
        self.create_simulations(15)

        response = self.client.get(reverse("simulation-list"), {"page": 2})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(len(body["results"]), 5)

    def test_list_search_by_name(self):
        self.create_simulations(1, name="Alpha Run")
        self.create_simulations(1, name="Beta Run")

        response = self.client.get(reverse("simulation-list"), {"search": "Alpha"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["name"], "Alpha Run")

    def test_list_item_shape_is_camel_case(self):
        self.create_simulations(1, name="Shape Check")

        response = self.client.get(reverse("simulation-list"))

        body = response.json()
        item = body["results"][0]
        for key in [
            "id",
            "name",
            "status",
            "arrivalRatePerHour",
            "departureRatePerHour",
            "durationMinutes",
            "maxWaitMinutes",
            "aircraftSpeedKnots",
            "includeClosures",
            "createdAt",
            "completedAt",
        ]:
            self.assertIn(key, item)

    def test_list_ordering_newest_first(self):
        first = self.create_simulations(1, name="First")
        second = self.create_simulations(1, name="Second")

        response = self.client.get(reverse("simulation-list"))

        body = response.json()
        ids = [item["id"] for item in body["results"]]
        self.assertEqual(ids[0], second.id)
        self.assertEqual(ids[1], first.id)

    def test_list_includes_batch_id_for_a_batched_run(self):
        batch = SimulationBatch.objects.create()
        simulation = self.create_simulations(1, name="Batched", batch=batch)

        response = self.client.get(reverse("simulation-list"), {"search": "Batched"})

        body = response.json()
        self.assertEqual(body["results"][0]["id"], simulation.id)
        self.assertEqual(body["results"][0]["batchId"], batch.id)

    def test_list_reports_null_batch_id_for_a_standalone_run(self):
        self.create_simulations(1, name="Standalone")

        response = self.client.get(reverse("simulation-list"), {"search": "Standalone"})

        self.assertIsNone(response.json()["results"][0]["batchId"])

    def test_list_collapses_a_batch_to_one_row(self):
        batch = SimulationBatch.objects.create(swept_variable="arrivalRatePerHour")
        first = self.create_simulations(
            1, name="Sweep run", batch=batch, arrival_rate_per_hour=10
        )
        self.create_simulations(1, name="Sweep run", batch=batch, arrival_rate_per_hour=20)
        self.create_simulations(1, name="Sweep run", batch=batch, arrival_rate_per_hour=30)
        self.create_simulations(1, name="Standalone run")

        response = self.client.get(reverse("simulation-list"))

        body = response.json()
        self.assertEqual(body["count"], 2)
        ids = [item["id"] for item in body["results"]]
        self.assertIn(first.id, ids)
        self.assertEqual(Simulation.objects.filter(batch=batch).count(), 3)

    def test_list_batch_row_summarises_run_count_status_and_range(self):
        batch = SimulationBatch.objects.create(swept_variable="arrivalRatePerHour")
        first = self.create_simulations(
            1,
            batch=batch,
            arrival_rate_per_hour=10,
            status=Simulation.Status.COMPLETE,
        )
        self.create_simulations(
            1,
            batch=batch,
            arrival_rate_per_hour=20,
            status=Simulation.Status.COMPLETE,
        )
        self.create_simulations(
            1,
            batch=batch,
            arrival_rate_per_hour=30,
            status=Simulation.Status.PENDING,
        )

        response = self.client.get(reverse("simulation-list"))

        body = response.json()
        item = next(i for i in body["results"] if i["id"] == first.id)
        summary = item["batchSummary"]
        self.assertEqual(summary["sweptVariable"], "arrivalRatePerHour")
        self.assertEqual(summary["runCount"], 3)
        self.assertEqual(summary["statusCounts"]["Complete"], 2)
        self.assertEqual(summary["statusCounts"]["Pending"], 1)
        self.assertEqual(summary["rangeMin"], 10)
        self.assertEqual(summary["rangeMax"], 30)

    def test_list_reports_null_batch_summary_for_a_standalone_run(self):
        self.create_simulations(1, name="Standalone summary check")

        response = self.client.get(
            reverse("simulation-list"), {"search": "Standalone summary check"}
        )

        self.assertIsNone(response.json()["results"][0]["batchSummary"])
