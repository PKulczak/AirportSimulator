import numpy as np
import pytest
import simpy
from django.utils import timezone

from api.models import Aircraft, AircraftEvent, SimulationRunway
from api.simulation.priority import PriorityTracker
from api.simulation.simulation_runner import SimulationRunner
from api.simulation.simulation_runway_wrapper import SimulationRunwayWrapper
from tests.base_test import BaseFeatureTest


# -- PriorityTracker (pure unit tests) -----------------------------------


def test_boost_reduces_score():
    tracker = PriorityTracker()
    initial = tracker.score
    new_score = tracker.boost("FuelCritical")
    assert new_score < initial
    assert tracker.score == new_score


def test_bigger_emergency_boosts_more():
    low = PriorityTracker()
    critical = PriorityTracker()
    low.boost("LowFuel")
    critical.boost("FuelCritical")
    # FuelCritical carries a bigger boost than LowFuel, so ends up with a
    # lower (higher-priority) score.
    assert critical.score < low.score


def test_score_never_goes_negative():
    tracker = PriorityTracker()
    for _ in range(50):
        tracker.boost("FuelCritical")
    assert tracker.score >= 0


def test_unknown_event_type_does_not_change_score():
    tracker = PriorityTracker()
    initial = tracker.score
    tracker.boost("SomethingUnrecognised")
    assert tracker.score == initial


# -- Threshold-triggered emergency events + forced diversion ----------------


@pytest.mark.django_db
def test_low_fuel_and_fuel_critical_fire_before_forced_diversion():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(
        1, max_wait_minutes=300, duration_minutes=300, random_seed=1
    )
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    # 60 minutes of fuel: LowFuel fires once remaining fuel hits 20 minutes
    # (elapsed 40), FuelCritical once it hits 15 (elapsed 45), then a forced
    # Diverted once remaining fuel would drop below the 10-minute forced-divert
    # reserve (elapsed 50) — well before max_wait_minutes.
    aircraft = helper.create_aircraft(
        simulation=simulation,
        movement_type=Aircraft.MovementType.ARRIVAL,
        initial_fuel_minutes=60,
        scheduled_time=timezone.now(),
    )

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)

    # A blocker aircraft grabs the only runway first (higher priority = lower
    # number) and holds it for the whole horizon, so our test aircraft can
    # never be assigned and is forced to ride out its full fuel-based wait.
    def blocker():
        req = wrapper.resource.request(priority=0)
        yield req
        yield env.timeout(300)

    env.process(blocker())

    runner = SimulationRunner()
    operation_minutes = runner._operation_minutes(simulation.aircraft_speed_knots)

    def to_datetime(now):
        return timezone.now()

    runner._spawn_aircraft_process(
        env,
        np.random.default_rng(1),
        simulation,
        aircraft,
        [wrapper],
        0,
        to_datetime,
        operation_minutes,
    )

    env.run(until=100)

    aircraft.refresh_from_db()
    events = list(
        AircraftEvent.objects.filter(aircraft=aircraft).order_by("occurred_at")
    )
    event_types = [e.event_type for e in events]
    assert "LowFuel" in event_types
    assert "FuelCritical" in event_types
    # LowFuel (20 min remaining) must fire strictly before FuelCritical
    # (15 min remaining), which must fire strictly before the forced divert
    # (10 min remaining) — the fixed-checkpoint escalation order.
    assert event_types.index("LowFuel") < event_types.index("FuelCritical")
    assert aircraft.outcome == Aircraft.Outcome.DIVERTED
    assert aircraft.was_success is False


@pytest.mark.django_db
def test_low_fuel_fires_at_fixed_twenty_minutes_remaining():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(
        1, max_wait_minutes=300, duration_minutes=300, random_seed=6
    )
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    # 45 minutes of fuel: LowFuel (20 min remaining) should fire at elapsed
    # 25, well before FuelCritical (15 min remaining, elapsed 30) or the
    # forced-divert reserve (10 min remaining, elapsed 35).
    aircraft = helper.create_aircraft(
        simulation=simulation,
        movement_type=Aircraft.MovementType.ARRIVAL,
        initial_fuel_minutes=45,
        scheduled_time=timezone.now(),
    )

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)

    def blocker():
        req = wrapper.resource.request(priority=0)
        yield req
        yield env.timeout(300)

    env.process(blocker())

    runner = SimulationRunner()
    operation_minutes = runner._operation_minutes(simulation.aircraft_speed_knots)

    def to_datetime(now):
        return timezone.now()

    runner._spawn_aircraft_process(
        env,
        np.random.default_rng(6),
        simulation,
        aircraft,
        [wrapper],
        0,
        to_datetime,
        operation_minutes,
    )

    # Stop just after the LowFuel threshold (elapsed 25) but before
    # FuelCritical (elapsed 30) to prove LowFuel fires exactly at its own
    # fixed checkpoint, not at some fraction-derived time.
    env.run(until=26)

    event_types = set(
        AircraftEvent.objects.filter(aircraft=aircraft).values_list(
            "event_type", flat=True
        )
    )
    assert "LowFuel" in event_types
    assert "FuelCritical" not in event_types


@pytest.mark.django_db
def test_departure_never_receives_fuel_events():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(
        1, max_wait_minutes=20, duration_minutes=60, random_seed=2
    )
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    aircraft = helper.create_aircraft(
        simulation=simulation,
        movement_type=Aircraft.MovementType.DEPARTURE,
        initial_fuel_minutes=60,
        scheduled_time=timezone.now(),
    )

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)

    def blocker():
        req = wrapper.resource.request(priority=0)
        yield req
        yield env.timeout(60)

    env.process(blocker())

    runner = SimulationRunner()
    operation_minutes = runner._operation_minutes(simulation.aircraft_speed_knots)

    def to_datetime(now):
        return timezone.now()

    runner._spawn_aircraft_process(
        env,
        np.random.default_rng(2),
        simulation,
        aircraft,
        [wrapper],
        0,
        to_datetime,
        operation_minutes,
    )

    env.run(until=60)

    aircraft.refresh_from_db()
    event_types = set(
        AircraftEvent.objects.filter(aircraft=aircraft).values_list(
            "event_type", flat=True
        )
    )
    assert "LowFuel" not in event_types
    assert "FuelCritical" not in event_types
    assert aircraft.outcome == Aircraft.Outcome.CANCELLED


class _AlwaysFireRng:
    """Stub rng whose `.random()` always returns 0.0, so any probabilistic
    "should an emergency fire?" check always evaluates true. Used to prove a
    departure's emergency-event process never even performs that roll, rather
    than relying on a real rng seed happening not to fire."""

    def random(self):
        return 0.0


class _ForceEmergencyRng:
    """Stub rng whose `.random()` always returns 0.0, so both the
    mechanical-failure and passenger-health coin flips always succeed."""

    def random(self):
        return 0.0


class _NeverFireRng:
    """Stub rng whose `.random()` always returns 1.0, so any probabilistic
    "should this fire?" check always evaluates false."""

    def random(self):
        return 1.0


@pytest.mark.django_db
def test_departure_never_receives_mechanical_or_passenger_health_events():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(
        1, max_wait_minutes=60, duration_minutes=120, random_seed=3
    )
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    aircraft = helper.create_aircraft(
        simulation=simulation,
        movement_type=Aircraft.MovementType.DEPARTURE,
        initial_fuel_minutes=60,
        scheduled_time=timezone.now(),
    )

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)

    # Blocker holds the only runway for the whole horizon so the departure
    # rides out its full max-wait window, giving the (stubbed, always-firing)
    # probabilistic emergency check many opportunities to fire if it ran.
    def blocker():
        req = wrapper.resource.request(priority=0)
        yield req
        yield env.timeout(120)

    env.process(blocker())

    runner = SimulationRunner()
    operation_minutes = runner._operation_minutes(simulation.aircraft_speed_knots)

    def to_datetime(now):
        return timezone.now()

    runner._spawn_aircraft_process(
        env,
        _AlwaysFireRng(),
        simulation,
        aircraft,
        [wrapper],
        0,
        to_datetime,
        operation_minutes,
    )

    env.run(until=120)

    aircraft.refresh_from_db()
    event_types = set(
        AircraftEvent.objects.filter(aircraft=aircraft).values_list(
            "event_type", flat=True
        )
    )
    assert "MechanicalFailure" not in event_types
    assert "PassengerHealth" not in event_types
    assert aircraft.outcome == Aircraft.Outcome.CANCELLED


@pytest.mark.django_db
def test_arrival_can_receive_both_mechanical_and_passenger_health_events():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(
        1, max_wait_minutes=60, duration_minutes=120, random_seed=4
    )
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    aircraft = helper.create_aircraft(
        simulation=simulation,
        movement_type=Aircraft.MovementType.ARRIVAL,
        initial_fuel_minutes=60,
        scheduled_time=timezone.now(),
    )

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)

    def blocker():
        req = wrapper.resource.request(priority=0)
        yield req
        yield env.timeout(60)

    env.process(blocker())

    runner = SimulationRunner()
    operation_minutes = runner._operation_minutes(simulation.aircraft_speed_knots)

    def to_datetime(now):
        return timezone.now()

    runner._spawn_aircraft_process(
        env,
        _ForceEmergencyRng(),
        simulation,
        aircraft,
        [wrapper],
        0,
        to_datetime,
        operation_minutes,
    )

    env.run(until=60)

    aircraft.refresh_from_db()
    event_types = set(
        AircraftEvent.objects.filter(aircraft=aircraft).values_list(
            "event_type", flat=True
        )
    )
    assert "MechanicalFailure" in event_types
    assert "PassengerHealth" in event_types


@pytest.mark.django_db
def test_arrival_receives_no_mechanical_or_passenger_health_when_roll_fails():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(
        1, max_wait_minutes=60, duration_minutes=120, random_seed=5
    )
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    aircraft = helper.create_aircraft(
        simulation=simulation,
        movement_type=Aircraft.MovementType.ARRIVAL,
        initial_fuel_minutes=60,
        scheduled_time=timezone.now(),
    )

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)

    def blocker():
        req = wrapper.resource.request(priority=0)
        yield req
        yield env.timeout(60)

    env.process(blocker())

    runner = SimulationRunner()
    operation_minutes = runner._operation_minutes(simulation.aircraft_speed_knots)

    def to_datetime(now):
        return timezone.now()

    runner._spawn_aircraft_process(
        env,
        _NeverFireRng(),
        simulation,
        aircraft,
        [wrapper],
        0,
        to_datetime,
        operation_minutes,
    )

    env.run(until=60)

    aircraft.refresh_from_db()
    event_types = set(
        AircraftEvent.objects.filter(aircraft=aircraft).values_list(
            "event_type", flat=True
        )
    )
    assert "MechanicalFailure" not in event_types
    assert "PassengerHealth" not in event_types
