from datetime import timedelta

from django.core.management import call_command
from django.utils import timezone

from api.models import Simulation
from api.simulation import constants
from tests.base_test import BaseFeatureTest


class CheckStalledSimulationsTest(BaseFeatureTest):
    def _running(self, *, heartbeat_age_minutes=None, started_age_minutes=0):
        simulation = self.create_simulations(
            1,
            status=Simulation.Status.RUNNING,
            started_at=timezone.now() - timedelta(minutes=started_age_minutes),
        )
        if heartbeat_age_minutes is not None:
            simulation.last_heartbeat_at = timezone.now() - timedelta(
                minutes=heartbeat_age_minutes
            )
            simulation.save(update_fields=["last_heartbeat_at"])
        return simulation

    def test_marks_a_stalled_running_simulation_as_error(self):
        simulation = self._running(
            heartbeat_age_minutes=constants.STALLED_RUN_TIMEOUT_REAL_MINUTES + 1,
            started_age_minutes=constants.STALLED_RUN_TIMEOUT_REAL_MINUTES + 1,
        )

        call_command("check_stalled_simulations")

        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.ERROR)
        self.assertIsNotNone(simulation.completed_at)
        self.assertIn("stalled", simulation.error_message.lower())

    def test_leaves_a_recently_active_running_simulation_alone(self):
        simulation = self._running(heartbeat_age_minutes=1, started_age_minutes=1)

        call_command("check_stalled_simulations")

        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.RUNNING)
        self.assertIsNone(simulation.completed_at)

    def test_ignores_non_running_simulations_regardless_of_heartbeat_age(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        simulation.last_heartbeat_at = timezone.now() - timedelta(
            minutes=constants.STALLED_RUN_TIMEOUT_REAL_MINUTES + 100
        )
        simulation.save(update_fields=["last_heartbeat_at"])

        call_command("check_stalled_simulations")

        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.COMPLETE)

    def test_falls_back_to_started_at_when_a_running_row_has_no_heartbeat(self):
        # Shouldn't happen for a run started through SimulationRunner (it
        # always seeds last_heartbeat_at), but covers e.g. pre-existing data
        # from before this field existed.
        simulation = self._running(
            heartbeat_age_minutes=None,
            started_age_minutes=constants.STALLED_RUN_TIMEOUT_REAL_MINUTES + 1,
        )
        self.assertIsNone(simulation.last_heartbeat_at)

        call_command("check_stalled_simulations")

        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.ERROR)

    def test_leaves_a_running_row_alone_with_no_heartbeat_and_no_started_at(self):
        # Not enough information to call it stale — conservative default.
        simulation = self.create_simulations(1, status=Simulation.Status.RUNNING)
        self.assertIsNone(simulation.started_at)
        self.assertIsNone(simulation.last_heartbeat_at)

        call_command("check_stalled_simulations")

        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.RUNNING)

    def test_marks_a_simulation_stuck_pending_past_the_timeout_as_error(self):
        # Regression test: a task lost or errored before SimulationRunner.run
        # could persist the Running transition used to leave the row Pending
        # forever with nothing — this command only ever looked at Running
        # rows — to notice and recover it.
        simulation = self.create_simulations(1, status=Simulation.Status.PENDING)
        Simulation.objects.filter(pk=simulation.pk).update(
            created_at=timezone.now()
            - timedelta(minutes=constants.STALLED_RUN_TIMEOUT_REAL_MINUTES + 1)
        )

        call_command("check_stalled_simulations")

        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.ERROR)
        self.assertIsNotNone(simulation.completed_at)
        self.assertIn("queued", simulation.error_message.lower())

    def test_leaves_a_recently_created_pending_simulation_alone(self):
        simulation = self.create_simulations(1, status=Simulation.Status.PENDING)

        call_command("check_stalled_simulations")

        simulation.refresh_from_db()
        self.assertEqual(simulation.status, Simulation.Status.PENDING)
        self.assertIsNone(simulation.completed_at)
