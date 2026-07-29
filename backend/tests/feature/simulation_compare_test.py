from django.urls import reverse
from rest_framework import status

from api.models import Aircraft, Simulation
from tests.base_test import BaseFeatureTest


class SimulationCompareTest(BaseFeatureTest):
    def test_compare_returns_one_metrics_block_per_id(self):
        sim_a, sim_b = self.create_simulations(2, status=Simulation.Status.COMPLETE)
        self.create_aircraft(
            simulation=sim_a,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            wait_minutes=5.0,
        )
        self.create_aircraft(
            simulation=sim_b,
            outcome=Aircraft.Outcome.DIVERTED,
            was_success=False,
        )

        response = self.client.get(
            reverse("simulation-compare"), {"ids": f"{sim_a.id},{sim_b.id}"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(len(body), 2)
        blocks_by_id = {block["id"]: block for block in body}
        self.assertEqual(blocks_by_id[sim_a.id]["outcomeCounts"]["success"], 1)
        self.assertEqual(blocks_by_id[sim_a.id]["outcomeCounts"]["total"], 1)
        self.assertEqual(blocks_by_id[sim_b.id]["outcomeCounts"]["diverted"], 1)
        self.assertEqual(blocks_by_id[sim_b.id]["outcomeCounts"]["total"], 1)

    def test_compare_preserves_requested_order(self):
        sim_a, sim_b, sim_c = self.create_simulations(
            3, status=Simulation.Status.COMPLETE
        )

        response = self.client.get(
            reverse("simulation-compare"),
            {"ids": f"{sim_c.id},{sim_a.id},{sim_b.id}"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual([block["id"] for block in body], [sim_c.id, sim_a.id, sim_b.id])

    def test_compare_silently_omits_unknown_ids(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)

        response = self.client.get(
            reverse("simulation-compare"), {"ids": f"{simulation.id},999999"}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["id"], simulation.id)

    def test_compare_dedupes_repeated_ids(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)

        response = self.client.get(
            reverse("simulation-compare"),
            {"ids": f"{simulation.id},{simulation.id}"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()), 1)

    def test_compare_requires_ids_param(self):
        response = self.client.get(reverse("simulation-compare"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_compare_rejects_non_integer_ids(self):
        response = self.client.get(
            reverse("simulation-compare"), {"ids": "1,not-a-number"}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
