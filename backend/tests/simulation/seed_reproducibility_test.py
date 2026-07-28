import pytest

from api.models import Aircraft, SimulationRunway
from api.simulation.simulation_runner import SimulationRunner
from tests.base_test import BaseFeatureTest


def _run_with_seed(helper, seed, runway_id="RW"):
    """Create + run a fixed-config simulation with the given seed, returning
    the per-aircraft outcome fingerprint (ordered by scheduled_time) so two
    runs can be compared for identical behaviour."""
    # Unique identifier per call — the same test runs this twice, and Runway
    # identifiers are unique.
    runway = helper.create_runways(1, identifier=runway_id)[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=30,
        departure_rate_per_hour=20,
        duration_minutes=60,
        max_wait_minutes=15,
        aircraft_speed_knots=140,
        include_closures=False,
        random_seed=seed,
    )
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )
    SimulationRunner().run(simulation.id)

    aircraft = Aircraft.objects.filter(simulation=simulation).order_by(
        "scheduled_time", "callsign"
    )
    return [
        (
            a.callsign,
            a.operator,
            a.origin_destination,
            a.movement_type,
            a.outcome,
            a.was_success,
        )
        for a in aircraft
    ]


@pytest.mark.django_db
def test_same_seed_produces_identical_outcomes():
    helper = BaseFeatureTest()
    first = _run_with_seed(helper, 12345, runway_id="RW-A")
    second = _run_with_seed(helper, 12345, runway_id="RW-B")

    assert len(first) > 0
    assert first == second


@pytest.mark.django_db
def test_different_seeds_produce_different_outcomes():
    helper = BaseFeatureTest()
    first = _run_with_seed(helper, 12345, runway_id="RW-A")
    second = _run_with_seed(helper, 67890, runway_id="RW-B")

    assert len(first) > 0
    assert len(second) > 0
    assert first != second
