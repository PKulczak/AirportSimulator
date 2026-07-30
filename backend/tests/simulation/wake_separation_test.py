import simpy
import pytest

import api.simulation.aircraft_data_generator as generator_module
from api.models import Aircraft, SimulationRunway
from api.simulation import constants
from api.simulation.simulation_runner import SimulationRunner
from api.simulation.simulation_runway_wrapper import SimulationRunwayWrapper
from tests.base_test import BaseFeatureTest


class _FakeWrapper:
    """A bare stand-in carrying only the two attributes
    `_wake_separation_extra_minutes` reads — avoids needing a full SimPy
    Environment/SimulationRunway just to exercise the calculation."""

    def __init__(self, last_operation_class, last_operation_end_time):
        self.last_operation_class = last_operation_class
        self.last_operation_end_time = last_operation_end_time


def test_no_extra_separation_before_any_operation_has_run():
    wrapper = _FakeWrapper(last_operation_class=None, last_operation_end_time=None)
    assert SimulationRunner._wake_separation_extra_minutes(wrapper, "Light", now=0.0) == 0.0


def test_heavy_leading_light_requires_full_matrix_separation():
    wrapper = _FakeWrapper(last_operation_class="Heavy", last_operation_end_time=6.0)
    extra = SimulationRunner._wake_separation_extra_minutes(wrapper, "Light", now=6.0)
    assert extra == constants.WAKE_SEPARATION_EXTRA_MINUTES[("Heavy", "Light")]
    assert extra > 0


def test_same_class_pair_needs_no_extra_separation():
    wrapper = _FakeWrapper(last_operation_class="Medium", last_operation_end_time=6.0)
    extra = SimulationRunner._wake_separation_extra_minutes(wrapper, "Medium", now=6.0)
    assert extra == 0.0


def test_elapsed_idle_time_reduces_the_remaining_separation_owed():
    wrapper = _FakeWrapper(last_operation_class="Heavy", last_operation_end_time=6.0)
    required = constants.WAKE_SEPARATION_EXTRA_MINUTES[("Heavy", "Medium")]
    assert required > 0
    # Runway sat idle for half the required gap before the next request.
    partially_elapsed_now = 6.0 + required / 2
    extra = SimulationRunner._wake_separation_extra_minutes(
        wrapper, "Medium", now=partially_elapsed_now
    )
    assert extra == pytest.approx(required / 2)


def test_no_extra_separation_once_enough_idle_time_has_elapsed():
    wrapper = _FakeWrapper(last_operation_class="Heavy", last_operation_end_time=6.0)
    required = constants.WAKE_SEPARATION_EXTRA_MINUTES[("Heavy", "Light")]
    extra = SimulationRunner._wake_separation_extra_minutes(
        wrapper, "Light", now=6.0 + required + 10.0
    )
    assert extra == 0.0


def _make_runway_wrapper():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations()
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation, runway=runway, operating_mode=SimulationRunway.OperatingMode.MIXED
    )
    env = simpy.Environment()
    return SimulationRunwayWrapper(env, simulation_runway)


@pytest.mark.django_db
def test_fresh_wrapper_starts_with_no_recorded_operation():
    wrapper = _make_runway_wrapper()
    assert wrapper.last_operation_class is None
    assert wrapper.last_operation_end_time is None


def _run_with_fixed_aircraft(simulation, weight_classes, movement_type):
    """Monkeypatches AircraftDataGenerator.generate to return one aircraft per
    weight class in `weight_classes`, all scheduled at/near t=0 in order, on
    the single configured runway — deterministic stand-in for the random
    class assignment `AircraftDataGenerator` would otherwise perform, so the
    engine test can control exactly which class leads which."""

    def fake_generate(self):
        entries = []
        for index, weight_class in enumerate(weight_classes):
            aircraft = Aircraft(
                simulation=self.simulation,
                callsign=f"TST{index}",
                operator="Test Airways",
                origin_destination="LHR",
                movement_type=movement_type,
                weight_class=weight_class,
                initial_fuel_minutes=120,
                scheduled_time=self.base_time,
                outcome=Aircraft.Outcome.PENDING,
            )
            # Small, strictly-increasing offsets: each aircraft only joins the
            # queue once the previous one already holds/has released the
            # runway, so requests are never simultaneous/racing for order.
            entries.append((aircraft, index * 0.5))
        return entries

    original = generator_module.AircraftDataGenerator.generate
    generator_module.AircraftDataGenerator.generate = fake_generate
    try:
        SimulationRunner().run(simulation.id)
    finally:
        generator_module.AircraftDataGenerator.generate = original

    simulation.refresh_from_db()
    return {
        a.callsign: a
        for a in Aircraft.objects.filter(simulation=simulation).order_by("id")
    }


@pytest.mark.django_db
def test_operation_immediately_after_a_heavy_takes_longer_than_the_base_time():
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=0,
        departure_rate_per_hour=0,
        duration_minutes=60,
        max_wait_minutes=30,
        aircraft_speed_knots=constants.REFERENCE_SPEED_KNOTS,
        random_seed=1,
    )
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    # Departures never roll for emergencies (arrivals-only), so using
    # Departure here keeps the scenario fully deterministic.
    aircraft_by_callsign = _run_with_fixed_aircraft(
        simulation,
        weight_classes=[Aircraft.WeightClass.HEAVY, Aircraft.WeightClass.LIGHT],
        movement_type=Aircraft.MovementType.DEPARTURE,
    )
    leader = aircraft_by_callsign["TST0"]
    follower = aircraft_by_callsign["TST1"]

    assert leader.outcome == Aircraft.Outcome.SUCCESS
    assert follower.outcome == Aircraft.Outcome.SUCCESS

    base_operation_minutes = SimulationRunner._operation_minutes(
        simulation.aircraft_speed_knots
    )
    leader_duration = (
        leader.completion_time - leader.runway_assigned_time
    ).total_seconds() / 60.0
    follower_duration = (
        follower.completion_time - follower.runway_assigned_time
    ).total_seconds() / 60.0

    # Nothing preceded the leader, so its own occupancy is exactly the base
    # (speed-scaled) operation time.
    assert leader_duration == pytest.approx(base_operation_minutes, abs=0.01)
    # The follower is stuck behind a Heavy — its occupancy is inflated by
    # exactly the Heavy->Light wake separation minima.
    expected_follower_duration = base_operation_minutes + constants.WAKE_SEPARATION_EXTRA_MINUTES[
        ("Heavy", "Light")
    ]
    assert follower_duration == pytest.approx(expected_follower_duration, abs=0.01)


@pytest.mark.django_db
def test_successive_operations_of_the_same_class_need_no_extra_separation():
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=0,
        departure_rate_per_hour=0,
        duration_minutes=60,
        max_wait_minutes=30,
        aircraft_speed_knots=constants.REFERENCE_SPEED_KNOTS,
        random_seed=2,
    )
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    aircraft_by_callsign = _run_with_fixed_aircraft(
        simulation,
        weight_classes=[Aircraft.WeightClass.MEDIUM, Aircraft.WeightClass.MEDIUM],
        movement_type=Aircraft.MovementType.DEPARTURE,
    )
    leader = aircraft_by_callsign["TST0"]
    follower = aircraft_by_callsign["TST1"]

    base_operation_minutes = SimulationRunner._operation_minutes(
        simulation.aircraft_speed_knots
    )
    follower_duration = (
        follower.completion_time - follower.runway_assigned_time
    ).total_seconds() / 60.0

    assert constants.WAKE_SEPARATION_EXTRA_MINUTES[("Medium", "Medium")] == 0.0
    assert follower_duration == pytest.approx(base_operation_minutes, abs=0.01)
    assert follower.runway_assigned_time == leader.completion_time
