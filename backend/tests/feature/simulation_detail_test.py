from django.urls import reverse
from rest_framework import status

from api.models import Aircraft, Simulation, SimulationRunway
from tests.base_test import BaseFeatureTest


class SimulationDetailTest(BaseFeatureTest):
    def test_detail_zero_aircraft_edge_case(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)

        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["successRate"], 0.0)
        self.assertEqual(body["outcomeCounts"]["total"], 0)
        self.assertEqual(body["waitTimeStats"]["averageMinutes"], None)
        self.assertEqual(body["runwayStats"], [])

    def test_detail_aggregate_correctness(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        runway_a, runway_b = self.create_runways(2)
        sr_a = self.create_simulation_runway(simulation=simulation, runway=runway_a)
        sr_b = self.create_simulation_runway(simulation=simulation, runway=runway_b)

        self.create_aircraft(
            simulation=simulation,
            runway=runway_a,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            wait_minutes=5.0,
        )
        self.create_aircraft(
            simulation=simulation,
            runway=runway_a,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            wait_minutes=15.0,
        )
        self.create_aircraft(
            simulation=simulation,
            runway=runway_b,
            outcome=Aircraft.Outcome.DIVERTED,
            was_success=False,
            wait_minutes=None,
        )
        self.create_aircraft(
            simulation=simulation,
            outcome=Aircraft.Outcome.CANCELLED,
            was_success=False,
        )
        self.create_runway_event(simulation_runway=sr_a)

        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["outcomeCounts"]["total"], 4)
        self.assertEqual(body["outcomeCounts"]["success"], 2)
        self.assertEqual(body["outcomeCounts"]["diverted"], 1)
        self.assertEqual(body["outcomeCounts"]["cancelled"], 1)
        self.assertEqual(body["successRate"], 50.0)
        self.assertEqual(body["waitTimeStats"]["averageMinutes"], 10.0)
        self.assertEqual(body["waitTimeStats"]["maxMinutes"], 15.0)
        self.assertEqual(body["closureEventCount"], 1)

        runway_stats_by_id = {rs["runwayId"]: rs for rs in body["runwayStats"]}
        self.assertEqual(runway_stats_by_id[runway_a.id]["totalAssigned"], 2)
        self.assertEqual(runway_stats_by_id[runway_a.id]["successCount"], 2)
        self.assertEqual(runway_stats_by_id[runway_a.id]["closureCount"], 1)
        self.assertEqual(runway_stats_by_id[runway_b.id]["totalAssigned"], 1)
        self.assertEqual(runway_stats_by_id[runway_b.id]["successCount"], 0)
        self.assertEqual(runway_stats_by_id[runway_b.id]["closureCount"], 0)

    def test_detail_404_for_unknown_simulation(self):
        response = self.client.get(reverse("simulation-detail", kwargs={"pk": 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
