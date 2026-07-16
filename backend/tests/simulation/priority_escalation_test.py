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

    # Low but non-zero fuel: the aircraft should get LowFuel (@ fuel-30) and
    # FuelCritical (@ fuel-12) events, then a forced Diverted once fuel
    # reaches zero (@ fuel minutes elapsed) — well before max_wait_minutes.
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
    event_types = list(
        AircraftEvent.objects.filter(aircraft=aircraft).values_list(
            "event_type", flat=True
        )
    )
    assert "LowFuel" in event_types
    assert "FuelCritical" in event_types
    assert aircraft.outcome == Aircraft.Outcome.DIVERTED
    assert aircraft.was_success is False


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
