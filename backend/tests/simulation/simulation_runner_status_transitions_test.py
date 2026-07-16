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
