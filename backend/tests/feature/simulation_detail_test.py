from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from api.models import Aircraft, Simulation, SimulationRunway, SimulationRunwayEvent
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
        self.assertEqual(body["delayStats"]["arrival"]["averageMinutes"], None)
        self.assertEqual(body["delayStats"]["departure"]["averageMinutes"], None)
        self.assertEqual(body["queueDepthStats"]["arrival"], 0)
        self.assertEqual(body["queueDepthStats"]["departure"], 0)
        self.assertEqual(body["runwayStats"], [])

    def test_detail_aggregate_correctness(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        runway_a, runway_b = self.create_runways(2)
        sr_a = self.create_simulation_runway(simulation=simulation, runway=runway_a)
        sr_b = self.create_simulation_runway(simulation=simulation, runway=runway_b)

        queue_entry_time = timezone.now()

        self.create_aircraft(
            simulation=simulation,
            runway=runway_a,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            wait_minutes=5.0,
            queue_entry_time=queue_entry_time,
            completion_time=queue_entry_time + timezone.timedelta(minutes=10),
        )
        self.create_aircraft(
            simulation=simulation,
            runway=runway_a,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            wait_minutes=15.0,
            queue_entry_time=queue_entry_time,
            completion_time=queue_entry_time + timezone.timedelta(minutes=20),
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
        self.assertEqual(body["delayStats"]["arrival"]["averageMinutes"], 15.0)
        self.assertEqual(body["delayStats"]["arrival"]["maxMinutes"], 20.0)
        self.assertEqual(body["delayStats"]["departure"]["averageMinutes"], None)
        self.assertEqual(body["closureEventCount"], 1)

        runway_stats_by_id = {rs["runwayId"]: rs for rs in body["runwayStats"]}
        self.assertEqual(runway_stats_by_id[runway_a.id]["totalAssigned"], 2)
        self.assertEqual(runway_stats_by_id[runway_a.id]["successCount"], 2)
        self.assertEqual(runway_stats_by_id[runway_a.id]["closureCount"], 1)
        self.assertEqual(runway_stats_by_id[runway_b.id]["totalAssigned"], 1)
        self.assertEqual(runway_stats_by_id[runway_b.id]["successCount"], 0)
        self.assertEqual(runway_stats_by_id[runway_b.id]["closureCount"], 0)

    def test_delay_stats_split_by_movement_type_and_excludes_non_success(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        queue_entry_time = timezone.now()

        # Arrival, Success: 10 minute delay (queue entry -> landing).
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.ARRIVAL,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            queue_entry_time=queue_entry_time,
            completion_time=queue_entry_time + timezone.timedelta(minutes=10),
        )
        # Departure, Success: 6 minute delay.
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.DEPARTURE,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            queue_entry_time=queue_entry_time,
            completion_time=queue_entry_time + timezone.timedelta(minutes=6),
        )
        # Arrival, Diverted: spent 200 minutes queued before diverting — must
        # NOT drag the arrival delay average up, since it never landed.
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.ARRIVAL,
            outcome=Aircraft.Outcome.DIVERTED,
            was_success=False,
            queue_entry_time=queue_entry_time,
            completion_time=queue_entry_time + timezone.timedelta(minutes=200),
        )

        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["delayStats"]["arrival"]["averageMinutes"], 10.0)
        self.assertEqual(body["delayStats"]["arrival"]["maxMinutes"], 10.0)
        self.assertEqual(body["delayStats"]["departure"]["averageMinutes"], 6.0)
        self.assertEqual(body["delayStats"]["departure"]["maxMinutes"], 6.0)

    def test_queue_depth_stats_peak_concurrent_occupancy(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        t0 = timezone.now()

        def minutes(n):
            return t0 + timezone.timedelta(minutes=n)

        # Arrivals: A1 [0,10) and A2 [2,12) overlap for [2,10) -> peak 2.
        # A3 [20,25) is isolated -> doesn't raise the peak.
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.ARRIVAL,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            queue_entry_time=minutes(0),
            completion_time=minutes(10),
        )
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.ARRIVAL,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            queue_entry_time=minutes(2),
            completion_time=minutes(12),
        )
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.ARRIVAL,
            outcome=Aircraft.Outcome.DIVERTED,
            was_success=False,
            queue_entry_time=minutes(20),
            completion_time=minutes(25),
        )

        # Departures: D1 [0,30), D2 [5,15), D3 [8,12) all overlap on [8,12)
        # -> peak 3. D4 enters at 30, exactly when D1 exits -> must NOT be
        # counted as a fourth simultaneous occupant.
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.DEPARTURE,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            queue_entry_time=minutes(0),
            completion_time=minutes(30),
        )
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.DEPARTURE,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            queue_entry_time=minutes(5),
            completion_time=minutes(15),
        )
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.DEPARTURE,
            outcome=Aircraft.Outcome.CANCELLED,
            was_success=False,
            queue_entry_time=minutes(8),
            completion_time=minutes(12),
        )
        self.create_aircraft(
            simulation=simulation,
            movement_type=Aircraft.MovementType.DEPARTURE,
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            queue_entry_time=minutes(30),
            completion_time=minutes(35),
        )

        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["queueDepthStats"]["arrival"], 2)
        self.assertEqual(body["queueDepthStats"]["departure"], 3)

    def test_runway_open_minutes_reflects_closures(self):
        started_at = timezone.now()
        simulation = self.create_simulations(
            1,
            status=Simulation.Status.COMPLETE,
            started_at=started_at,
            duration_minutes=60,
        )
        rw_open, rw_window, rw_trailing = self.create_runways(3)
        sr_open = self.create_simulation_runway(simulation=simulation, runway=rw_open)
        sr_window = self.create_simulation_runway(simulation=simulation, runway=rw_window)
        sr_trailing = self.create_simulation_runway(
            simulation=simulation, runway=rw_trailing
        )

        # rw_window: closed 8 -> 18 (10 minutes down) -> 50 open.
        self.create_runway_event(
            simulation_runway=sr_window,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=started_at + timezone.timedelta(minutes=8),
        )
        self.create_runway_event(
            simulation_runway=sr_window,
            event_type=SimulationRunwayEvent.EventType.REOPENED,
            occurred_at=started_at + timezone.timedelta(minutes=18),
        )
        # rw_trailing: closed at 50 and never reopened -> down 50..60 -> 50 open.
        self.create_runway_event(
            simulation_runway=sr_trailing,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=started_at + timezone.timedelta(minutes=50),
        )

        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        stats = {rs["runwayId"]: rs for rs in response.json()["runwayStats"]}
        self.assertAlmostEqual(stats[rw_open.id]["openMinutes"], 60, delta=0.01)
        self.assertAlmostEqual(stats[rw_window.id]["openMinutes"], 50, delta=0.01)
        self.assertAlmostEqual(stats[rw_trailing.id]["openMinutes"], 50, delta=0.01)

    def test_detail_exposes_random_seed(self):
        simulation = self.create_simulations(
            1, status=Simulation.Status.COMPLETE, random_seed=4242
        )
        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["randomSeed"], 4242)

    def test_detail_random_seed_null_when_unset(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.json()["randomSeed"])

    def test_detail_exposes_batch_id_for_a_batched_run(self):
        from api.models import SimulationBatch

        batch = SimulationBatch.objects.create(swept_variable="arrivalRatePerHour")
        simulation = self.create_simulations(
            1, status=Simulation.Status.COMPLETE, batch=batch
        )
        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["batchId"], batch.id)

    def test_detail_reports_null_batch_id_for_a_standalone_run(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.json()["batchId"])

    def test_initial_operational_status_ignores_trailing_run_closure(self):
        # A runway that started Available but was left closed by a trailing
        # (never-reopened) run closure must still report Available as its
        # *initial* status, so a re-run reproduces the original start config.
        started_at = timezone.now()
        simulation = self.create_simulations(
            1, status=Simulation.Status.COMPLETE, started_at=started_at
        )
        runway = self.create_runways(1)[0]
        sr = self.create_simulation_runway(
            simulation=simulation,
            runway=runway,
            operational_status=SimulationRunway.OperationalStatus.EQUIPMENT_FAILURE,
        )
        # Closure happened mid-run (offset > 0), i.e. NOT a start closure.
        self.create_runway_event(
            simulation_runway=sr,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=started_at + timezone.timedelta(minutes=20),
        )
        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        stat = response.json()["runwayStats"][0]
        self.assertEqual(stat["operationalStatus"], "EquipmentFailure")
        self.assertEqual(stat["initialOperationalStatus"], "Available")

    def test_initial_operational_status_reports_start_closure(self):
        # A runway closed at the start (CLOSED event stamped at started_at) is
        # reported with its configured closed status as the initial status.
        started_at = timezone.now()
        simulation = self.create_simulations(
            1, status=Simulation.Status.COMPLETE, started_at=started_at
        )
        runway = self.create_runways(1)[0]
        sr = self.create_simulation_runway(
            simulation=simulation,
            runway=runway,
            operational_status=SimulationRunway.OperationalStatus.SNOW_CLEARANCE,
        )
        self.create_runway_event(
            simulation_runway=sr,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=started_at,
            reason="Snow clearance at simulation start",
        )
        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        stat = response.json()["runwayStats"][0]
        self.assertEqual(stat["initialOperationalStatus"], "SnowClearance")

    def test_detail_404_for_unknown_simulation(self):
        response = self.client.get(reverse("simulation-detail", kwargs={"pk": 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_timeline_events_includes_diversions_cancellations_closures_and_reopenings(self):
        started_at = timezone.now()
        simulation = self.create_simulations(
            1, status=Simulation.Status.COMPLETE, started_at=started_at
        )
        runway = self.create_runways(1)[0]
        sr = self.create_simulation_runway(simulation=simulation, runway=runway)

        self.create_aircraft(
            simulation=simulation,
            callsign="DIV001",
            outcome=Aircraft.Outcome.DIVERTED,
            was_success=False,
            completion_time=started_at + timezone.timedelta(minutes=12),
        )
        self.create_aircraft(
            simulation=simulation,
            callsign="CAN001",
            movement_type=Aircraft.MovementType.DEPARTURE,
            outcome=Aircraft.Outcome.CANCELLED,
            was_success=False,
            completion_time=started_at + timezone.timedelta(minutes=30),
        )
        # A Success aircraft's completion should never appear on the timeline.
        self.create_aircraft(
            simulation=simulation,
            callsign="SUC001",
            outcome=Aircraft.Outcome.SUCCESS,
            was_success=True,
            completion_time=started_at + timezone.timedelta(minutes=5),
        )
        self.create_runway_event(
            simulation_runway=sr,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=started_at + timezone.timedelta(minutes=8),
            reason="Snow clearance",
        )
        self.create_runway_event(
            simulation_runway=sr,
            event_type=SimulationRunwayEvent.EventType.REOPENED,
            occurred_at=started_at + timezone.timedelta(minutes=18),
            reason="Snow clearance resolved",
        )

        response = self.client.get(
            reverse("simulation-detail", kwargs={"pk": simulation.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        events = response.json()["timelineEvents"]
        self.assertEqual(len(events), 4)
        # Sorted ascending by time.
        self.assertEqual(
            [e["type"] for e in events],
            ["Closed", "Diverted", "Reopened", "Cancelled"],
        )
        self.assertAlmostEqual(events[0]["timeMinutes"], 8, delta=0.01)
        self.assertEqual(events[0]["runwayIdentifier"], runway.identifier)
        self.assertEqual(events[0]["detail"], "Snow clearance")
        self.assertAlmostEqual(events[1]["timeMinutes"], 12, delta=0.01)
        self.assertAlmostEqual(events[2]["timeMinutes"], 18, delta=0.01)
        self.assertEqual(events[2]["runwayIdentifier"], runway.identifier)
        self.assertEqual(events[2]["detail"], "Snow clearance resolved")
        self.assertAlmostEqual(events[3]["timeMinutes"], 30, delta=0.01)
