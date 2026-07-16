import pytest

from api.models import Aircraft, Simulation, SimulationRunway
from api.simulation.simulation_runner import SimulationRunner
from tests.base_test import BaseFeatureTest


def _run(helper, **overrides):
    runway = helper.create_runways(1)[0]
    defaults = dict(
        arrival_rate_per_hour=30,
        departure_rate_per_hour=20,
        duration_minutes=60,
        max_wait_minutes=15,
        aircraft_speed_knots=140,
        include_closures=False,
        random_seed=42,
    )
    defaults.update(overrides)
    simulation = helper.create_simulations(1, **defaults)
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )
    SimulationRunner().run(simulation.id)
    simulation.refresh_from_db()
    return simulation


@pytest.mark.django_db
def test_every_aircraft_reaches_a_terminal_outcome():
    helper = BaseFeatureTest()
    simulation = _run(helper)

    aircraft = Aircraft.objects.filter(simulation=simulation)
    assert aircraft.count() > 0
    assert not aircraft.filter(outcome=Aircraft.Outcome.PENDING).exists()
    for a in aircraft:
        assert a.was_success is not None
        assert a.completion_time is not None


@pytest.mark.django_db
def test_successful_aircraft_get_a_runway_assigned():
    helper = BaseFeatureTest()
    simulation = _run(helper)

    successes = Aircraft.objects.filter(
        simulation=simulation, outcome=Aircraft.Outcome.SUCCESS
    )
    assert successes.count() > 0
    for a in successes:
        assert a.runway_id is not None
        assert a.runway_assigned_time is not None
        assert a.was_success is True


@pytest.mark.django_db
def test_diverted_only_applies_to_arrivals_and_cancelled_only_to_departures():
    helper = BaseFeatureTest()
    # Force heavy contention (one runway, one-directional-mixed but low
    # max_wait) so we reliably get both Diverted and Cancelled outcomes.
    simulation = _run(
        helper,
        arrival_rate_per_hour=120,
        departure_rate_per_hour=120,
        duration_minutes=30,
        max_wait_minutes=5,
    )

    diverted = Aircraft.objects.filter(
        simulation=simulation, outcome=Aircraft.Outcome.DIVERTED
    )
    cancelled = Aircraft.objects.filter(
        simulation=simulation, outcome=Aircraft.Outcome.CANCELLED
    )
    assert all(a.movement_type == Aircraft.MovementType.ARRIVAL for a in diverted)
    assert all(a.movement_type == Aircraft.MovementType.DEPARTURE for a in cancelled)


@pytest.mark.django_db
def test_no_candidate_runway_forces_immediate_terminal_outcome():
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=20,
        departure_rate_per_hour=20,
        duration_minutes=30,
        max_wait_minutes=10,
        random_seed=3,
    )
    # Runway only accepts arrivals -> every departure has zero candidate runways.
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.ARRIVALS_ONLY,
    )

    SimulationRunner().run(simulation.id)
    simulation.refresh_from_db()

    departures = Aircraft.objects.filter(
        simulation=simulation, movement_type=Aircraft.MovementType.DEPARTURE
    )
    assert departures.count() > 0
    assert all(a.outcome == Aircraft.Outcome.CANCELLED for a in departures)
    assert all(a.queue_entry_time is None for a in departures)


@pytest.mark.django_db
def test_zero_traffic_completes_with_no_aircraft():
    helper = BaseFeatureTest()
    simulation = _run(
        helper, arrival_rate_per_hour=0, departure_rate_per_hour=0
    )
    assert simulation.status == Simulation.Status.COMPLETE
    assert Aircraft.objects.filter(simulation=simulation).count() == 0
