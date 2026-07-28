import pytest

from api.models import Aircraft, SimulationRunway, SimulationRunwayEvent
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


def _run_with_closures(helper, seed, prefix):
    """Run a two-runway, closures-enabled sim; return (aircraft fingerprint,
    closure-event fingerprint) so a same-seed re-run can be compared. Runway
    identifiers are unique, so each run gets its own prefixed rows."""
    r0 = helper.create_runways(1, identifier=f"{prefix}-0")[0]
    r1 = helper.create_runways(1, identifier=f"{prefix}-1")[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=60,
        departure_rate_per_hour=60,
        duration_minutes=90,
        max_wait_minutes=15,
        aircraft_speed_knots=140,
        include_closures=True,
        random_seed=seed,
    )
    for runway in (r0, r1):
        SimulationRunway.objects.create(
            simulation=simulation,
            runway=runway,
            operating_mode=SimulationRunway.OperatingMode.MIXED,
        )
    SimulationRunner().run(simulation.id)

    aircraft = Aircraft.objects.filter(simulation=simulation).order_by(
        "scheduled_time", "callsign"
    )
    aircraft_fp = [(a.callsign, a.movement_type, a.outcome, a.was_success) for a in aircraft]

    events = SimulationRunwayEvent.objects.filter(
        simulation_runway__simulation=simulation
    ).order_by("occurred_at", "event_type")
    closures_fp = [(e.event_type, e.reason) for e in events]
    return aircraft_fp, closures_fp


@pytest.mark.django_db
def test_same_seed_reproduces_identical_closures():
    # Closures are driven by the same seeded RNG, so a re-run with the same
    # seed must reproduce not just aircraft outcomes but the closure timeline —
    # the invariant that makes "re-run with same seed" meaningful with closures on.
    helper = BaseFeatureTest()
    first_aircraft, first_closures = _run_with_closures(helper, 999, "A")
    second_aircraft, second_closures = _run_with_closures(helper, 999, "B")

    assert len(first_closures) > 0
    assert first_aircraft == second_aircraft
    assert first_closures == second_closures
