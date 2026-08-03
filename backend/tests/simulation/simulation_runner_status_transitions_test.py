import pytest

from api.models import Simulation, SimulationRunway
from api.simulation.simulation_runner import SimulationRunner
from tests.base_test import BaseFeatureTest


@pytest.mark.django_db
def test_successful_run_transitions_to_complete():
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=20,
        departure_rate_per_hour=10,
        duration_minutes=30,
        max_wait_minutes=10,
        random_seed=1,
    )
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )
    assert simulation.status == Simulation.Status.PENDING
    assert simulation.started_at is None

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.COMPLETE
    assert simulation.started_at is not None
    assert simulation.completed_at is not None
    assert simulation.error_message is None


@pytest.mark.django_db
def test_exception_during_execute_sets_error_status_not_pending_or_running(
    monkeypatch,
):
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(1, random_seed=1)
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    def boom(self, simulation):
        raise ValueError("engine exploded")

    monkeypatch.setattr(SimulationRunner, "_execute", boom)

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.ERROR
    assert simulation.status not in (
        Simulation.Status.PENDING,
        Simulation.Status.RUNNING,
    )
    assert simulation.error_message == "engine exploded"
    assert simulation.started_at is not None
    assert simulation.completed_at is not None


@pytest.mark.django_db
def test_exception_marking_running_sets_error_status_not_stuck_pending(monkeypatch):
    # Regression test: a failure between fetching the row and persisting the
    # Running transition (e.g. a transient DB blip) used to propagate
    # uncaught, leaving the row Pending forever with nothing to mark it Error
    # (check_stalled_simulations only ever looked at Running rows).
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(1, random_seed=1)
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    def boom(self, simulation):
        raise ValueError("db blip")

    monkeypatch.setattr(SimulationRunner, "_mark_running", boom)

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.ERROR
    assert simulation.status != Simulation.Status.PENDING
    assert simulation.error_message == "db blip"
    assert simulation.completed_at is not None


@pytest.mark.django_db
def test_unknown_simulation_id_does_not_raise():
    # Should log and return quietly rather than propagate — there is no row
    # to mark Error on, so this is the one legitimate case where "never leave
    # it stuck" doesn't apply (there's no "it").
    SimulationRunner().run(999999)


@pytest.mark.django_db
def test_run_sets_started_at_before_completed_at():
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(1, random_seed=1)
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.started_at <= simulation.completed_at


@pytest.mark.django_db
def test_heartbeat_is_seeded_even_if_the_watchdog_never_ticks(monkeypatch):
    # Isolates the seed-at-Running-transition behaviour from the watchdog's
    # own periodic bump (covered separately below) by making the watchdog a
    # no-op — check_stalled_simulations always has a real reference point,
    # never a null one, for any run that actually started, even one whose
    # worker died before the watchdog's first tick.
    def no_op_watchdog(env, simulation):
        return
        yield  # pragma: no cover - makes this a generator function.

    monkeypatch.setattr(SimulationRunner, "_watchdog", staticmethod(no_op_watchdog))

    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(1, random_seed=1)
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.COMPLETE
    assert simulation.last_heartbeat_at == simulation.started_at


@pytest.mark.django_db
def test_heartbeat_advances_past_the_seeded_value_once_the_watchdog_ticks():
    # A run long enough (in sim-minutes) to cross at least one
    # CANCELLATION_POLL_MINUTES tick should show the watchdog's periodic
    # bump, not just the value seeded at the Running transition.
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=20,
        departure_rate_per_hour=20,
        duration_minutes=30,
        max_wait_minutes=10,
        random_seed=1,
    )
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.COMPLETE
    assert simulation.last_heartbeat_at > simulation.started_at
