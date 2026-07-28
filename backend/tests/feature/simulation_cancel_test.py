from rest_framework import status

from api.models import Aircraft, Simulation, SimulationRunway
from api.simulation.simulation_runner import SimulationRunner
from tests.base_test import BaseFeatureTest


def _cancel_url(simulation_id):
    return f"/api/simulations/{simulation_id}/cancel/"


class SimulationCancelEndpointTest(BaseFeatureTest):
    def test_cancel_pending_marks_cancelled_immediately(self):
        simulation = self.create_simulations(1, status=Simulation.Status.PENDING)
        response = self.client.post(_cancel_url(simulation.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["status"], Simulation.Status.CANCELLED)
        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.CANCELLED)
        self.assertTrue(simulation.cancel_requested)
        self.assertIsNotNone(simulation.completed_at)

    def test_cancel_running_sets_flag_but_leaves_status_running(self):
        # The web process only requests the cancel; the worker owns `status`.
        simulation = self.create_simulations(1, status=Simulation.Status.RUNNING)
        response = self.client.post(_cancel_url(simulation.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        simulation.refresh_from_db()
        self.assertTrue(simulation.cancel_requested)
        self.assertEqual(simulation.status, Simulation.Status.RUNNING)

    def test_cancel_completed_returns_409(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        response = self.client.post(_cancel_url(simulation.id))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        simulation.refresh_from_db()
        self.assertFalse(simulation.cancel_requested)

    def test_cancel_already_cancelled_returns_409(self):
        simulation = self.create_simulations(1, status=Simulation.Status.CANCELLED)
        response = self.client.post(_cancel_url(simulation.id))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_cancel_unknown_simulation_returns_404(self):
        response = self.client.post(_cancel_url(999999))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SimulationCancelRunnerTest(BaseFeatureTest):
    def _build_running_simulation(self, **overrides):
        runway = self.create_runways(1)[0]
        defaults = dict(
            arrival_rate_per_hour=60,
            departure_rate_per_hour=60,
            duration_minutes=90,
            max_wait_minutes=15,
            aircraft_speed_knots=140,
            include_closures=False,
            random_seed=7,
        )
        defaults.update(overrides)
        simulation = self.create_simulations(1, **defaults)
        SimulationRunway.objects.create(
            simulation=simulation,
            runway=runway,
            operating_mode=SimulationRunway.OperatingMode.MIXED,
        )
        return simulation

    def test_cancel_mid_run_ends_cancelled_without_full_result_set(self):
        # cancel_requested is set before the run; the watchdog fires at the
        # first poll (5 sim-min), long before ~180 aircraft over 90 min resolve.
        simulation = self._build_running_simulation()
        simulation.cancel_requested = True
        simulation.save(update_fields=["cancel_requested"])

        SimulationRunner().run(simulation.id)
        simulation.refresh_from_db()

        self.assertEqual(simulation.status, Simulation.Status.CANCELLED)
        aircraft = Aircraft.objects.filter(simulation=simulation)
        # Aircraft were generated, but the run stopped before resolving them all.
        self.assertGreater(aircraft.count(), 0)
        self.assertTrue(
            aircraft.filter(outcome=Aircraft.Outcome.PENDING).exists(),
            "expected unresolved (Pending) aircraft after a mid-run cancel",
        )

    def test_run_skips_a_simulation_already_cancelled(self):
        # A Pending run the endpoint already moved to Cancelled must not be run.
        simulation = self._build_running_simulation(
            status=Simulation.Status.CANCELLED
        )
        simulation.cancel_requested = True
        simulation.save(update_fields=["cancel_requested"])

        SimulationRunner().run(simulation.id)
        simulation.refresh_from_db()

        self.assertEqual(simulation.status, Simulation.Status.CANCELLED)
        self.assertIsNone(simulation.started_at)
        self.assertEqual(Aircraft.objects.filter(simulation=simulation).count(), 0)

    def test_uncancelled_run_completes_normally(self):
        # Guard: the watchdog must not disturb a normal run.
        simulation = self._build_running_simulation(
            duration_minutes=30, arrival_rate_per_hour=20, departure_rate_per_hour=20
        )
        SimulationRunner().run(simulation.id)
        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.COMPLETE)
        self.assertFalse(
            Aircraft.objects.filter(
                simulation=simulation, outcome=Aircraft.Outcome.PENDING
            ).exists()
        )
